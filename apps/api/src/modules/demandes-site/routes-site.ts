// Route publique du formulaire de devis du site vitrine (tâche 7).
//   · seule l'origine du site est acceptée (protection.ts), avec les en-têtes CORS correspondants ;
//   · aucune session, aucune lecture : la route ne fait qu'enregistrer, par la seule fonction que la base
//     lui ouvre (app.enregistrer_demande_site), qui limite les envois par adresse et par jour ;
//   · l'adresse IP n'est pas gardée : seule son empreinte HMAC, avec une clé dérivée de la clé de l'API ;
//   · la carte grise éventuelle est vérifiée (type réel, taille), analysée par l'antivirus (refusée si elle est
//     infectée ; gardée « à analyser » si l'antivirus ne répond pas), puis chiffrée avant d'entrer en base ;
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
import { chiffrerPiece, LONGUEUR_BASE64_MAX, TYPES_PIECE, verifierPiece, type TypePiece } from "./piece.js";

export const CHEMIN_DEMANDE = "/site/demandes-devis";
const PROFILS = ["particulier", "professionnel", "entreprise"] as const;
/** Assurances pour lesquelles une carte grise a un sens */
export const BRANCHES_AVEC_CARTE_GRISE: readonly Branche[] = ["automobile", "deux_roues", "flotte"];
/** Corps maximal : la pièce en base64 et les champs du formulaire */
const TAILLE_CORPS_MAX = LONGUEUR_BASE64_MAX + 16 * 1024;

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
  piece?: { type: TypePiece; contenu: string };
  siteWeb?: string;
}

const MESSAGES_PIECE = {
  illisible: "La carte grise n'a pas pu être lue. Envoyez une photo (JPEG ou PNG) ou un PDF.",
  trop_volumineuse: "La carte grise dépasse 5 Mo. Envoyez une photo moins lourde.",
  type_refuse: "La carte grise doit être une photo (JPEG ou PNG) ou un PDF.",
} as const;

export async function routesDemandesSite(
  app: FastifyInstance,
  options: { pool: Pool; cleChiffrement: Buffer; origineSite: string; antivirus: Antivirus },
): Promise<void> {
  const { pool, cleChiffrement, origineSite, antivirus } = options;
  // Clé dédiée aux empreintes d'adresses : jamais la clé de chiffrement elle-même
  const cleEmpreinte = Buffer.from(hkdfSync("sha256", cleChiffrement, Buffer.alloc(0), "dbs:empreinte-adresse-ip", 32));

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

      let piece: ReturnType<typeof chiffrerPiece> & { type: TypePiece; taille: number; saine: boolean } | null = null;
      if (d.piece) {
        if (!BRANCHES_AVEC_CARTE_GRISE.includes(d.assurance)) {
          throw new ErreurApi(422, "piece_inattendue", "Une carte grise ne se joint qu'à une demande pour un véhicule.");
        }
        const verifiee = verifierPiece(d.piece.type, d.piece.contenu);
        if (!verifiee.ok) throw new ErreurApi(422, "piece_invalide", MESSAGES_PIECE[verifiee.raison]);
        const verdict = await antivirus.analyser(verifiee.contenu);
        if (verdict.etat === "infectee") {
          requete.log.warn({ signature: verdict.signature }, "carte grise refusée par l'antivirus");
          throw new ErreurApi(422, "piece_infectee",
            "Ce fichier a été refusé par notre antivirus. Envoyez une autre photo de la carte grise, ou envoyez votre demande sans elle.");
        }
        if (verdict.etat === "indisponible") requete.log.warn({ raison: verdict.raison }, "carte grise gardée en attente d'analyse antivirus");
        piece = {
          ...chiffrerPiece(cleChiffrement, verifiee.contenu), type: verifiee.type, taille: verifiee.contenu.length,
          saine: verdict.etat === "saine",
        };
      }

      const empreinteIp = createHmac("sha256", cleEmpreinte).update(requete.ip).digest();
      const { rows } = await transactionSysteme(pool, async (client) => {
        const resultat = await client.query<{ numero: number }>(
          `SELECT numero FROM app.enregistrer_demande_site($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [d.assurance, d.profil, d.nom, telephone, email, d.commune ?? null, d.besoin ?? null,
           d.accordTraitement.trim(), d.accordWhatsApp?.trim() ?? null, empreinteIp,
           piece?.id ?? null, piece?.type ?? null, piece?.taille ?? null, piece?.contenuChiffre ?? null, piece?.empreinte ?? null],
        );
        if (piece?.saine) await client.query("SELECT app.enregistrer_analyse_piece($1, true, NULL)", [piece.id]);
        return resultat;
      });
      requete.log.info({ numero: rows[0]?.numero, piece: piece !== null }, "demande de devis reçue du site");
      return reponse.status(201).send({ numero: rows[0]?.numero ?? null });
    },
  );
}
