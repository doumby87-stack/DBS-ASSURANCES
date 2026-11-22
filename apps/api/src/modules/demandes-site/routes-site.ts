// Route publique du formulaire de devis du site vitrine (tâche 7).
//   · seule l'origine du site est acceptée (protection.ts), avec les en-têtes CORS correspondants ;
//   · aucune session, aucune lecture : la route ne fait qu'enregistrer, par la seule fonction que la base
//     lui ouvre (app.enregistrer_demande_site), qui limite les envois par adresse et par jour ;
//   · l'adresse IP n'est pas gardée : seule son empreinte HMAC, avec une clé dérivée de la clé de l'API ;
//   · les réponses au questionnaire de l'assurance choisie sont contrôlées (questionnaires.ts) ;
//   · les documents joints, choisis selon l'assurance (pieces-site.ts), sont vérifiés (type réel, taille), analysés
//     par l'antivirus (refusés s'ils sont infectés ; gardés « à analyser » si l'antivirus ne répond pas), puis
//     chiffrés avant d'entrer en base ;
//   · un champ invisible pour les visiteurs (« siteWeb ») piège les robots : rempli, la demande est
//     acceptée en apparence et n'est pas enregistrée.

import { createHmac, hkdfSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { BRANCHES, texteCourt, type Branche } from "../../commun/schemas.js";
import { routesOutilsSite } from "./outils-site.js";
import { LONGUEUR_BASE64_MAX, TYPES_PIECE, type TypePiece } from "./piece.js";
import { type PieceEnvoyee, preparerPieces, schemaPieces, tableauxPourLaBase, TAILLE_CORPS_MAX } from "./pieces-site.js";
import { type Details, schemaDetails, validerDetails } from "./questionnaires.js";

export const CHEMIN_DEMANDE = "/site/demandes-devis";
const PROFILS = ["particulier", "professionnel", "entreprise"] as const;

export interface CorpsDemande {
  assurance: Branche;
  profil: (typeof PROFILS)[number];
  nom: string;
  telephone: string;
  email?: string;
  commune?: string;
  besoin?: string;
  accordTraitement: string;
  accordWhatsApp?: string;
  /** Réponses aux questions de l'assurance choisie */
  details?: Record<string, unknown>;
  pieces?: PieceEnvoyee[];
  /** Ancien formulaire : une carte grise seule */
  piece?: { type: TypePiece; contenu: string };
  siteWeb?: string;
}

export async function routesDemandesSite(
  app: FastifyInstance,
  options: { pool: Pool; cleChiffrement: Buffer; origineSite: string; antivirus: Antivirus },
): Promise<void> {
  const { pool, cleChiffrement, origineSite, antivirus } = options;
  // Clé dédiée aux empreintes d'adresses : jamais la clé de chiffrement elle-même
  const cleEmpreinte = Buffer.from(hkdfSync("sha256", cleChiffrement, Buffer.alloc(0), "dbs:empreinte-adresse-ip", 32));
  const empreinte = (ip: string) => createHmac("sha256", cleEmpreinte).update(ip).digest();

  // Réponses lisibles par le site, et par lui seul (erreurs comprises, pour afficher le bon message)
  app.addHook("onSend", async (requete, reponse, charge) => {
    if (requete.headers.origin === origineSite) {
      reponse.header("Access-Control-Allow-Origin", origineSite);
      reponse.header("Vary", "Origin");
    }
    return charge;
  });

  // Requête préalable du navigateur avant l'envoi en JSON depuis une autre adresse
  app.options(CHEMIN_DEMANDE, { config: { appeleeParLeSite: true } }, async (_requete, reponse) =>
    reponse
      .header("Access-Control-Allow-Methods", "POST")
      .header("Access-Control-Allow-Headers", "Content-Type")
      .header("Access-Control-Max-Age", "600")
      .status(204)
      .send(),
  );

  app.post<{ Body: CorpsDemande }>(
    CHEMIN_DEMANDE,
    {
      config: { appeleeParLeSite: true },
      bodyLimit: TAILLE_CORPS_MAX,
      schema: {
        body: {
          type: "object",
          required: ["assurance", "profil", "nom", "telephone", "accordTraitement"],
          additionalProperties: false,
          properties: {
            assurance: { type: "string", enum: BRANCHES },
            profil: { type: "string", enum: PROFILS },
            nom: texteCourt(160, 2),
            telephone: texteCourt(25, 8),
            email: texteCourt(254, 0),
            commune: texteCourt(80, 0),
            besoin: texteCourt(1500, 0),
            accordTraitement: texteCourt(300, 10),
            accordWhatsApp: texteCourt(300, 10),
            details: schemaDetails,
            pieces: schemaPieces,
            piece: {
              type: "object",
              required: ["type", "contenu"],
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: TYPES_PIECE },
                contenu: texteCourt(LONGUEUR_BASE64_MAX, 4),
              },
            },
            siteWeb: texteCourt(200, 0),
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      // Piège à robots : réponse identique à un envoi réussi, rien n'est enregistré
      if (d.siteWeb) {
        requete.log.info("demande du site ignorée : champ piège rempli");
        return reponse.status(201).send({ numero: null });
      }

      const telephone = normaliserTelephone(d.telephone);
      if (!telephone) {
        throw new ErreurApi(422, "telephone_invalide",
          "Numéro invalide : 10 chiffres (07 49 36 07 02) ou numéro étranger commençant par +.");
      }
      const email = d.email?.trim().toLowerCase() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
        throw new ErreurApi(422, "email_invalide", "Cette adresse e-mail semble incomplète.");
      }

      const details: Details | null = d.details ? validerDetails(d.assurance, d.details) : null;
      // L'ancien formulaire envoyait la carte grise seule, sous « piece »
      const envoyees: PieceEnvoyee[] = [
        ...(d.piece ? [{ nature: "carte_grise" as const, ...d.piece }] : []),
        ...(d.pieces ?? []),
      ];
      const pieces = await preparerPieces(envoyees, d.assurance, { antivirus, cleChiffrement, journal: requete.log });

      const empreinteIp = empreinte(requete.ip);
      const { rows } = await transactionSysteme(pool, async (client) => {
        const resultat = await client.query<{ numero: number }>(
          `SELECT numero FROM app.enregistrer_demande_site($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [d.assurance, d.profil, d.nom, telephone, email, d.commune ?? null, d.besoin ?? null,
           d.accordTraitement.trim(), d.accordWhatsApp?.trim() ?? null, empreinteIp, details, ...tableauxPourLaBase(pieces)],
        );
        for (const piece of pieces) {
          if (piece.saine) await client.query("SELECT app.enregistrer_analyse_piece($1, true, NULL)", [piece.id]);
        }
        return resultat;
      });
      requete.log.info({ numero: rows[0]?.numero, pieces: pieces.length, details: details !== null }, "demande de devis reçue du site");
      return reponse.status(201).send({ numero: rows[0]?.numero ?? null });
    },
  );

  // Rappel d'échéance, appel d'offres, rendez-vous (tâche 13) : dans ce même contexte, pour les mêmes en-têtes
  await routesOutilsSite(app, { pool, empreinte });
}
