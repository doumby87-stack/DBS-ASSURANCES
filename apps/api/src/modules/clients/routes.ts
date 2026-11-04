// Clients : liste et recherche, création (avec détection des doublons par téléphone),
// fiche complète (avec les consentements et les relances), modification, historique des échanges.
// Les droits sont appliqués par la base : un apporteur ne voit et ne crée que ses propres clients.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { motifRecherche, normaliserTelephone } from "../../commun/formats.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { ROLES_LECTURE_CAISSE } from "../encaissements/routes.js";
import { texteRelance, type ParametresRelance, type TypeRelance } from "../relances/modeles.js";
import { exigerClientVisible } from "./visibilite.js";

const TYPES = ["particulier", "professionnel", "entreprise"] as const;
const CANAUX = ["appel", "whatsapp", "email", "sms", "visite", "note"] as const;
const COLONNES_CLIENT = `c.id, c.type, c.nom, c.telephone, c.email, c.commune, c.rccm,
  c.apporteur_id AS "apporteurId", c.cree_le AS "creeLe"`;

const champsClient = {
  type: { type: "string", enum: TYPES },
  nom: texteCourt(160, 2),
  telephone: texteCourt(25, 8),
  email: { type: "string", format: "email", maxLength: 254 },
  commune: texteCourt(80),
  rccm: texteCourt(40),
} as const;

interface CorpsClient {
  type?: (typeof TYPES)[number];
  nom?: string;
  telephone?: string;
  email?: string;
  commune?: string;
  rccm?: string;
}

function telephoneOuErreur(saisie: string): string {
  const telephone = normaliserTelephone(saisie);
  if (!telephone) {
    throw new ErreurApi(422, "telephone_invalide",
      "Numéro invalide : 10 chiffres (07 49 36 07 02) ou numéro étranger commençant par +.");
  }
  return telephone;
}

export async function routesClients(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get<{ Querystring: { recherche?: string } }>(
    "/clients",
    {
      preHandler: gardes.sessionComplete(),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { recherche: { type: "string", maxLength: 80 } },
        },
      },
    },
    async (requete) => {
      const recherche = requete.query.recherche?.trim() ?? "";
      const chiffres = recherche.replace(/\D/g, "");
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `SELECT ${COLONNES_CLIENT},
                  (SELECT count(*)::int FROM app.contrats k WHERE k.client_id = c.id AND k.statut = 'en_vigueur') AS "contratsEnVigueur"
           FROM app.clients c
           WHERE $1 = '' OR c.nom ILIKE $2 OR (length($3) >= 4 AND c.telephone LIKE '%' || $3 || '%')
           ORDER BY c.nom
           LIMIT 100`,
          [recherche, motifRecherche(recherche), chiffres],
        ),
      );
      return { clients: rows };
    },
  );

  app.post<{ Body: CorpsClient & { confirmerDoublon?: boolean } }>(
    "/clients",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "apporteur"),
      schema: {
        body: {
          type: "object",
          required: ["type", "nom", "telephone"],
          additionalProperties: false,
          properties: { ...champsClient, confirmerDoublon: { type: "boolean" } },
        },
      },
    },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const corps = requete.body;
      const telephone = telephoneOuErreur(corps.telephone!);

      const resultat = await transactionUtilisateur(pool, moi.id, async (client) => {
        // Même numéro déjà enregistré : probablement la même personne
        const doublons = await client.query<{ id: string; nom: string }>(
          "SELECT id, nom FROM app.clients WHERE telephone = $1 ORDER BY nom LIMIT 5",
          [telephone],
        );
        if (doublons.rows.length > 0 && !corps.confirmerDoublon) return { doublons: doublons.rows };

        const { rows } = await client.query(
        `INSERT INTO app.clients AS c (type, nom, telephone, email, commune, rccm, apporteur_id)
         VALUES ($1, btrim($2), $3, lower(btrim($4)), nullif(btrim($5), ''), nullif(btrim($6), ''), $7)
         RETURNING ${COLONNES_CLIENT}`,
        [corps.type, corps.nom, telephone, corps.email ?? null, corps.commune ?? null, corps.rccm ?? null,
         moi.role === "apporteur" ? moi.id : null],
      );
      return { client: rows[0] };
    });

    if ("doublons" in resultat) {
      return reponse.status(409).send({
        code: "doublon_possible",
        message: "Un client avec ce numéro existe déjà. Vérifiez avant d'en créer un nouveau.",
        doublons: resultat.doublons,
      });
    }
    return reponse.status(201).send({ client: resultat.client });
  },
);

// Fiche client : tout ce que l'utilisateur a le droit de voir sur ce client, en une fois
app.get<{ Params: { id: string } }>(
  "/clients/:id",
  { preHandler: gardes.sessionComplete(), schema: { params: parametreId } },
  async (requete) => {
    const { id } = requete.params;
    const utilisateur = utilisateurDe(requete);
    // Le reste à payer n'a de sens que pour qui voit la caisse : pour les autres, la base masque les encaissements
    const voitLaCaisse = (ROLES_LECTURE_CAISSE as readonly string[]).includes(utilisateur.role);
    const fiche = await transactionUtilisateur(pool, utilisateur.id, async (client) => {
      const { rows } = await client.query(`SELECT ${COLONNES_CLIENT} FROM app.clients c WHERE c.id = $1`, [id]);
      if (!rows[0]) return null;
        // Requêtes successives : une connexion n'exécute qu'une requête à la fois
        const contrats = await client.query(
          `SELECT k.id, k.numero_police AS "numeroPolice", k.branche, k.date_effet AS "dateEffet",
                  k.date_echeance AS "dateEcheance", k.prime_ttc AS "primeTtc", k.prime_nette AS "primeNette", k.statut,
                  k.renouvelle_id AS "renouvelleId",
                  EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = k.id) AS "renouvele",
                  CASE WHEN $2 THEN (k.prime_ttc + k.primes_avenants - coalesce((SELECT sum(e.montant) FROM app.encaissements e
                                                            WHERE e.contrat_id = k.id), 0))::bigint END AS "resteAPayer"
           FROM app.contrats k WHERE k.client_id = $1 ORDER BY k.date_echeance DESC`,
          [id, voitLaCaisse],
        );
        const vehicules = await client.query(
          `SELECT v.id, v.immatriculation, v.marque, v.modele, v.genre, v.usage,
                  v.puissance_fiscale AS "puissanceFiscale", v.valeur_venale AS "valeurVenale",
                  v.echeance_visite_technique AS "echeanceVisiteTechnique", v.echeance_vignette AS "echeanceVignette",
                  v.echeance_carte_transport AS "echeanceCarteTransport"
           FROM app.vehicules v WHERE v.client_id = $1 ORDER BY v.immatriculation`,
          [id],
        );
        const devis = await client.query(
          `SELECT d.id, d.branche, d.origine, d.description, d.prime_proposee AS "primeProposee", d.statut,
                  d.motif_refus AS "motifRefus", d.cree_le AS "creeLe", d.modifie_le AS "modifieLe"
           FROM app.devis d WHERE d.client_id = $1 ORDER BY d.cree_le DESC`,
          [id],
        );
        const echanges = await client.query(
          `SELECT e.id, e.canal, e.resume, e.survenu_le AS "survenuLe", u.nom AS "auteur"
           FROM app.echanges e JOIN app.utilisateurs u ON u.id = e.cree_par
           WHERE e.client_id = $1 ORDER BY e.survenu_le DESC LIMIT 50`,
          [id],
        );
        // Dernier choix du client pour chaque canal de relance (preuve comprise)
        const consentements = await client.query(
          `SELECT v.canal, v.accorde, v.source, v.preuve, v.enregistre_le AS "enregistreLe", u.nom AS "enregistrePar"
           FROM app.v_consentements v LEFT JOIN app.utilisateurs u ON u.id = v.enregistre_par
           WHERE v.client_id = $1 ORDER BY v.canal`,
          [id],
        );
        // Relances récentes (visibles seulement des rôles qui suivent les relances : la base filtre)
        const relances = await client.query<{ type: TypeRelance; parametres: ParametresRelance }>(
          `SELECT r.id, r.type, r.canal, r.statut, r.parametres, r.motif, r.planifiee_le AS "planifieeLe",
                  r.envoyee_le AS "envoyeeLe"
           FROM app.relances r WHERE r.client_id = $1 ORDER BY r.planifiee_le DESC LIMIT 20`,
          [id],
        );
        return {
          client: rows[0],
          contrats: contrats.rows,
          vehicules: vehicules.rows,
          devis: devis.rows,
          echanges: echanges.rows,
          consentements: consentements.rows,
          relances: relances.rows.map(({ parametres, ...relance }) => ({ ...relance, texte: texteRelance(relance.type, parametres) })),
        };
      });
      if (!fiche) throw erreurs.introuvable();
      return fiche;
    },
  );

  app.patch<{ Params: { id: string }; Body: CorpsClient }>(
    "/clients/:id",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: { type: "object", additionalProperties: false, minProperties: 1, properties: champsClient },
      },
    },
    async (requete) => {
      const corps = requete.body;
      const telephone = corps.telephone !== undefined ? telephoneOuErreur(corps.telephone) : null;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.clients AS c SET
             type = coalesce($2, type), nom = coalesce(btrim($3), nom), telephone = coalesce($4, telephone),
             email = coalesce(lower(btrim($5)), email), commune = coalesce(btrim($6), commune), rccm = coalesce(btrim($7), rccm)
           WHERE c.id = $1
           RETURNING ${COLONNES_CLIENT}`,
          [requete.params.id, corps.type ?? null, corps.nom ?? null, telephone, corps.email ?? null,
           corps.commune ?? null, corps.rccm ?? null],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { client: rows[0] };
    },
  );

  app.post<{ Params: { id: string }; Body: { canal: (typeof CANAUX)[number]; resume: string; survenuLe?: string } }>(
    "/clients/:id/echanges",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "caissier", "commercial", "apporteur"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["canal", "resume"],
          additionalProperties: false,
          properties: {
            canal: { type: "string", enum: CANAUX },
            resume: texteCourt(2000, 2),
            survenuLe: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const { canal, resume, survenuLe } = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `INSERT INTO app.echanges (client_id, canal, resume, survenu_le)
           VALUES ($1, $2, btrim($3), coalesce($4::timestamptz, now()))
           RETURNING id, canal, resume, survenu_le AS "survenuLe"`,
          [requete.params.id, canal, resume, survenuLe ?? null],
        );
      });
      return reponse.status(201).send({ echange: rows[0] });
    },
  );
}
