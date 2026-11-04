// Demandes de devis reçues par le site, au back-office (tâche 7) : liste, détail avec les clients qui ont
// déjà ce numéro, carte grise à télécharger, conversion en client et devis, ou classement sans suite.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { BRANCHES, parametreId, texteCourt, type Branche } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { exigerClientVisible } from "../clients/visibilite.js";
import { dechiffrerPiece, EXTENSIONS, type TypePiece } from "./piece.js";

const STATUTS = ["nouvelle", "convertie", "sans_suite"] as const;
const COLONNES = `d.id, d.numero, d.branche, d.profil, d.nom, d.telephone, d.email, d.commune, d.besoin,
  d.accord_traitement AS "accordTraitement", d.accord_whatsapp AS "accordWhatsApp", d.recue_le AS "recueLe",
  d.statut, d.motif, d.client_id AS "clientId", d.devis_id AS "devisId", d.traitee_le AS "traiteeLe",
  u.nom AS "traiteePar"`;

const dejaTraitee = () => new ErreurApi(409, "deja_traitee", "Cette demande a déjà été traitée.");
const pieceInfectee = () =>
  new ErreurApi(409, "piece_infectee", "L'antivirus a détecté une menace dans cette pièce : elle a été supprimée. Demandez une autre photo au client.");
const analyseEnAttente = () =>
  new ErreurApi(503, "analyse_en_attente", "L'antivirus n'a pas encore pu analyser cette pièce. Réessayez dans quelques minutes.");

export async function routesDemandesSiteBackOffice(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer; antivirus: Antivirus },
): Promise<void> {
  const { pool, gardes, cleChiffrement, antivirus } = options;

  app.get<{ Querystring: { statut?: (typeof STATUTS)[number] } }>(
    "/demandes-site",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "auditeur"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { statut: { type: "string", enum: STATUTS } },
        },
      },
    },
    async (requete) => {
      const statut = requete.query.statut ?? "nouvelle";
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows: demandes } = await client.query(
          `SELECT ${COLONNES}, EXISTS (SELECT 1 FROM app.pieces_demandes_site p WHERE p.demande_id = d.id AND p.etat_analyse <> 'infectee') AS "aUnePiece"
           FROM app.demandes_site d LEFT JOIN app.utilisateurs u ON u.id = d.traitee_par
           WHERE d.statut = $1
           ORDER BY CASE WHEN d.statut = 'nouvelle' THEN d.recue_le END ASC, d.traitee_le DESC NULLS LAST
           LIMIT 200`,
          [statut],
        );
        const { rows: compte } = await client.query<{ nouvelles: number }>(
          "SELECT count(*)::int AS nouvelles FROM app.demandes_site WHERE statut = 'nouvelle'",
        );
        return { demandes, nouvelles: compte[0]?.nouvelles ?? 0 };
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/demandes-site/:id",
    { preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "auditeur"), schema: { params: parametreId } },
    async (requete) => {
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query(
          `SELECT ${COLONNES} FROM app.demandes_site d LEFT JOIN app.utilisateurs u ON u.id = d.traitee_par WHERE d.id = $1`,
          [requete.params.id],
        );
        const demande = rows[0] as { telephone: string } | undefined;
        if (!demande) return null;
        // Invisible pour l'auditeur (droits de la base) : la pièce apparaît alors absente
        const piece = await client.query(
          `SELECT type_contenu AS type, taille, etat_analyse AS "etatAnalyse", analysee_le AS "analyseeLe",
                  signature_detectee AS "signatureDetectee"
           FROM app.pieces_demandes_site WHERE demande_id = $1`,
          [requete.params.id],
        );
        // Même numéro déjà enregistré : probablement le même client, à rattacher plutôt qu'à recréer
        const clients = await client.query(
          "SELECT id, nom, type FROM app.clients WHERE telephone = $1 ORDER BY nom LIMIT 5",
          [demande.telephone],
        );
        return { demande, piece: piece.rows[0] ?? null, clientsMemeNumero: clients.rows };
      });
      if (!resultat) throw erreurs.introuvable();
      return resultat;
    },
  );

  // Carte grise : déchiffrée à la demande, analysée de nouveau par l'antivirus (signatures du jour), téléchargée
  // (jamais affichée par le navigateur), et consignée. Sans analyse réussie, elle ne sort pas.
  app.get<{ Params: { id: string } }>(
    "/demandes-site/:id/piece",
    { preHandler: gardes.roles("gerant", "charge_clientele", "commercial"), schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const piece = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<{
          id: string; type: TypePiece; contenu: Buffer | null; empreinte: Buffer; numero: number; etat: string;
        }>(
          `SELECT p.id, p.type_contenu AS type, p.contenu_chiffre AS contenu, p.empreinte, d.numero, p.etat_analyse AS etat
           FROM app.pieces_demandes_site p JOIN app.demandes_site d ON d.id = p.demande_id
           WHERE p.demande_id = $1`,
          [requete.params.id],
        );
        return rows[0] ?? null;
      });
      if (!piece) throw erreurs.introuvable();
      if (piece.etat === "infectee" || !piece.contenu) throw pieceInfectee();
      const contenu = dechiffrerPiece(cleChiffrement, piece.id, piece.contenu, piece.empreinte);

      const verdict = await antivirus.analyser(contenu);
      if (verdict.etat === "indisponible") {
        requete.log.warn({ raison: verdict.raison }, "analyse antivirus impossible au téléchargement");
        // Déjà déclarée saine : elle peut sortir, l'antivirus la reverra au prochain téléchargement
        if (piece.etat !== "saine") throw analyseEnAttente();
      }
      await transactionUtilisateur(pool, moi.id, async (client) => {
        if (verdict.etat !== "indisponible") {
          await client.query("SELECT app.enregistrer_analyse_piece($1, $2, $3)", [
            piece.id, verdict.etat === "saine", verdict.etat === "infectee" ? verdict.signature : null,
          ]);
        }
        if (verdict.etat !== "infectee") {
          await consignerEvenement(client, "piece_telechargee", {
            utilisateurId: moi.id, ip: requete.ip, objet: `Carte grise, demande du site n° ${piece.numero}`,
          });
        }
      });
      if (verdict.etat === "infectee") {
        requete.log.warn({ signature: verdict.signature }, "carte grise infectée découverte au téléchargement");
        throw pieceInfectee();
      }
      return reponse
        .type(piece.type)
        .header("Content-Disposition", `attachment; filename="carte-grise-demande-${piece.numero}.${EXTENSIONS[piece.type]}"`)
        .send(contenu);
    },
  );

  // Conversion : client existant (même numéro) ou nouveau client, devis « site », et accord WhatsApp
  // si le visiteur l'a donné sur le formulaire (sa preuve : la case cochée, le numéro et la date de la demande)
  app.post<{
    Params: { id: string };
    Body: { clientId?: string; confirmerNouveauClient?: boolean; branche?: Branche; enregistrerAccordWhatsApp?: boolean };
  }>(
    "/demandes-site/:id/conversion",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            confirmerNouveauClient: { type: "boolean" },
            branche: { type: "string", enum: BRANCHES },
            enregistrerAccordWhatsApp: { type: "boolean" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const corps = requete.body;
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{
          statut: string; branche: Branche; profil: string; nom: string; telephone: string; email: string | null;
          commune: string | null; besoin: string | null; accordWhatsApp: boolean;
        }>(
          `SELECT statut, branche, profil, nom, telephone, email, commune, besoin, accord_whatsapp IS NOT NULL AS "accordWhatsApp"
           FROM app.demandes_site WHERE id = $1 FOR UPDATE`,
          [requete.params.id],
        );
        const demande = rows[0];
        if (!demande) throw erreurs.introuvable();
        if (demande.statut !== "nouvelle") throw dejaTraitee();

        let clientId = corps.clientId;
        if (clientId) {
          await exigerClientVisible(client, clientId);
        } else {
          const doublons = await client.query<{ id: string; nom: string }>(
            "SELECT id, nom FROM app.clients WHERE telephone = $1 ORDER BY nom LIMIT 5",
            [demande.telephone],
          );
          if (doublons.rows.length > 0 && !corps.confirmerNouveauClient) return { doublons: doublons.rows };
          const cree = await client.query<{ id: string }>(
            `INSERT INTO app.clients (type, nom, telephone, email, commune) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [demande.profil, demande.nom, demande.telephone, demande.email, demande.commune],
          );
          clientId = cree.rows[0]!.id;
        }

        const devis = await client.query<{ id: string }>(
          `INSERT INTO app.devis (client_id, branche, origine, description) VALUES ($1, $2, 'site', $3) RETURNING id`,
          [clientId, corps.branche ?? demande.branche, demande.besoin],
        );
        const devisId = devis.rows[0]!.id;

        const accordWhatsApp = demande.accordWhatsApp && corps.enregistrerAccordWhatsApp !== false;
        if (accordWhatsApp) {
          await client.query(
            `INSERT INTO app.consentements (client_id, canal, accorde, preuve)
             SELECT $1, 'whatsapp', true,
                    'Case « rappels WhatsApp » cochée sur le site, demande n° ' || d.numero || ' du '
                      || to_char(d.recue_le AT TIME ZONE 'Africa/Abidjan', 'DD/MM/YYYY')
             FROM app.demandes_site d WHERE d.id = $2`,
            [clientId, requete.params.id],
          );
        }

        await client.query(
          `UPDATE app.demandes_site SET statut = 'convertie', client_id = $2, devis_id = $3 WHERE id = $1`,
          [requete.params.id, clientId, devisId],
        );
        return { clientId, devisId, accordWhatsApp };
      });

      if ("doublons" in resultat) {
        return reponse.status(409).send({
          code: "doublon_possible",
          message: "Un client avec ce numéro existe déjà : rattachez la demande à sa fiche, ou confirmez qu'il s'agit d'une autre personne.",
          doublons: resultat.doublons,
        });
      }
      return reponse.status(201).send(resultat);
    },
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>(
    "/demandes-site/:id/sans-suite",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: { type: "object", required: ["motif"], additionalProperties: false, properties: { motif: texteCourt(300, 3) } },
      },
    },
    async (requete) => {
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ statut: string }>(
          "SELECT statut FROM app.demandes_site WHERE id = $1 FOR UPDATE",
          [requete.params.id],
        );
        if (!rows[0]) throw erreurs.introuvable();
        if (rows[0].statut !== "nouvelle") throw dejaTraitee();
        await client.query(
          "UPDATE app.demandes_site SET statut = 'sans_suite', motif = btrim($2) WHERE id = $1",
          [requete.params.id, requete.body.motif],
        );
        return { statut: "sans_suite" };
      });
    },
  );
}
