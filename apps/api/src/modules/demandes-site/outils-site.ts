// Outils du site vitrine (tâche 13, ADR 0014) : rappel d'échéance gratuit, assistant « appel d'offres », demande
// de rendez-vous. Mêmes protections que la demande de devis (routes-site.ts), dont ces routes partagent le
// contexte : origine du site seule (en-têtes CORS compris), aucune session, empreinte HMAC de l'adresse IP,
// champ piège pour les robots, et limites par adresse et par jour communes à toutes les demandes, tenues par la base.
// Les règles de dates (échéance, date limite, jour ouvré) sont celles de la base : ses messages reviennent tels quels.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { BRANCHES, date, texteCourt, type Branche } from "../../commun/schemas.js";

export const CHEMIN_RAPPEL = "/site/rappels-echeance";
export const CHEMIN_APPEL_OFFRES = "/site/appels-offres";
export const CHEMIN_RENDEZ_VOUS = "/site/rendez-vous";

const PROFILS = ["particulier", "professionnel", "entreprise"] as const;

/** Assurances qu'un appel d'offres peut exiger, avec la branche du devis, dans l'ordre de priorité */
export const GARANTIES_APPEL_OFFRES = {
  trc: { libelle: "Tous risques chantier", branche: "chantier_construction" },
  decennale: { libelle: "Responsabilité civile décennale", branche: "chantier_construction" },
  rc_pro: { libelle: "Responsabilité civile professionnelle ou d'exploitation", branche: "responsabilite_civile" },
  flotte: { libelle: "Véhicules et engins affectés au marché", branche: "flotte" },
  engins: { libelle: "Bris de machines et engins", branche: "industrie_bris_de_machines" },
  transport: { libelle: "Transport des fournitures ou marchandises", branche: "transport_marchandises" },
  personnel: { libelle: "Individuelle accident du personnel", branche: "individuelle_accident" },
  a_determiner: { libelle: "À déterminer d'après le cahier des charges", branche: "autre" },
} as const satisfies Record<string, { libelle: string; branche: Branche }>;
export type Garantie = keyof typeof GARANTIES_APPEL_OFFRES;
const GARANTIES = Object.keys(GARANTIES_APPEL_OFFRES) as Garantie[];

export const TYPES_MARCHE = {
  travaux: "Travaux", fournitures: "Fournitures", services: "Services", prestations_intellectuelles: "Prestations intellectuelles",
} as const;

export const MOTIFS_RENDEZ_VOUS = ["devis", "renouvellement", "sinistre", "appel_offres", "flotte", "autre"] as const;
export const MODES_RENDEZ_VOUS = ["agence", "telephone", "chez_le_client"] as const;
const CRENEAUX = ["matin", "apres_midi"] as const;

/** Description du marché, telle qu'elle est gardée avec la demande */
export interface Marche {
  typeMarche: keyof typeof TYPES_MARCHE;
  maitreOuvrage: string;
  objet: string;
  lieu?: string;
  montant?: number;
  dureeMois?: number;
  garanties: Garantie[];
}

interface Coordonnees {
  profil: (typeof PROFILS)[number];
  nom: string;
  telephone: string;
  email?: string;
  accordTraitement: string;
  accordWhatsApp?: string;
  siteWeb?: string;
}

const proprietesCoordonnees = {
  profil: { type: "string", enum: PROFILS },
  nom: texteCourt(160, 2),
  telephone: texteCourt(25, 8),
  email: texteCourt(254, 0),
  accordTraitement: texteCourt(300, 10),
  accordWhatsApp: texteCourt(300, 10),
  siteWeb: texteCourt(200, 0),
} as const;
const requisCoordonnees = ["profil", "nom", "telephone", "accordTraitement"] as const;

/** Téléphone et e-mail vérifiés, comme pour la demande de devis */
function verifierCoordonnees(d: Coordonnees): { telephone: string; email: string | null } {
  const telephone = normaliserTelephone(d.telephone);
  if (!telephone) {
    throw new ErreurApi(422, "telephone_invalide", "Numéro invalide : 10 chiffres (07 49 36 07 02) ou numéro étranger commençant par +.");
  }
  const email = d.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    throw new ErreurApi(422, "email_invalide", "Cette adresse e-mail semble incomplète.");
  }
  return { telephone, email };
}

/** Branche du devis : la première garantie demandée, dans l'ordre de priorité */
export function brancheAppelOffres(garanties: readonly Garantie[]): Branche {
  const premiere = GARANTIES.find((g) => garanties.includes(g));
  return premiere ? GARANTIES_APPEL_OFFRES[premiere].branche : "autre";
}

export async function routesOutilsSite(app: FastifyInstance, options: { pool: Pool; empreinte: (ip: string) => Buffer }): Promise<void> {
  const { pool, empreinte } = options;

  // Requêtes préalables du navigateur avant chaque envoi en JSON depuis le site
  for (const chemin of [CHEMIN_RAPPEL, CHEMIN_APPEL_OFFRES, CHEMIN_RENDEZ_VOUS]) {
    app.options(chemin, { config: { appeleeParLeSite: true } }, async (_requete, reponse) =>
      reponse
        .header("Access-Control-Allow-Methods", "POST")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .header("Access-Control-Max-Age", "600")
        .status(204)
        .send(),
    );
  }

  // Rappel d'échéance : l'agence rappelle un mois avant l'échéance du contrat actuel (chez n'importe quel assureur)
  app.post<{ Body: Coordonnees & { assurance: Branche; echeance: string } }>(
    CHEMIN_RAPPEL,
    {
      config: { appeleeParLeSite: true },
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: "object",
          required: [...requisCoordonnees, "assurance", "echeance"],
          additionalProperties: false,
          properties: { ...proprietesCoordonnees, assurance: { type: "string", enum: BRANCHES }, echeance: date },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      if (d.siteWeb) return reponse.status(201).send({ numero: null, aTraiterLe: null });
      const { telephone, email } = verifierCoordonnees(d);
      const { rows } = await transactionSysteme(pool, (client) =>
        client.query<{ numero: number; a_traiter_le: string }>(
          `SELECT numero, to_char(a_traiter_le, 'YYYY-MM-DD') AS a_traiter_le
           FROM app.enregistrer_rappel_echeance($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [d.assurance, d.profil, d.nom, telephone, email, d.echeance, d.accordTraitement.trim(), d.accordWhatsApp?.trim() ?? null,
           empreinte(requete.ip)],
        ),
      );
      requete.log.info({ numero: rows[0]?.numero }, "rappel d'échéance reçu du site");
      return reponse.status(201).send({ numero: rows[0]?.numero ?? null, aTraiterLe: rows[0]?.a_traiter_le ?? null });
    },
  );

  // Assistant « appel d'offres » : le marché, les garanties exigées et la date limite de dépôt
  app.post<{ Body: Coordonnees & { commune?: string; besoin?: string; dateLimite: string; marche: Omit<Marche, "garanties">; garanties: Garantie[] } }>(
    CHEMIN_APPEL_OFFRES,
    {
      config: { appeleeParLeSite: true },
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: "object",
          required: [...requisCoordonnees, "dateLimite", "marche", "garanties"],
          additionalProperties: false,
          properties: {
            ...proprietesCoordonnees,
            profil: { type: "string", enum: ["professionnel", "entreprise"] },
            commune: texteCourt(80, 0),
            besoin: texteCourt(1500, 0),
            dateLimite: date,
            marche: {
              type: "object",
              required: ["typeMarche", "maitreOuvrage", "objet"],
              additionalProperties: false,
              properties: {
                typeMarche: { type: "string", enum: Object.keys(TYPES_MARCHE) },
                maitreOuvrage: texteCourt(160, 2),
                objet: texteCourt(300, 3),
                lieu: texteCourt(120, 0),
                montant: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
                dureeMois: { type: "integer", minimum: 1, maximum: 120 },
              },
            },
            garanties: { type: "array", minItems: 1, maxItems: GARANTIES.length, uniqueItems: true, items: { type: "string", enum: GARANTIES } },
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      if (d.siteWeb) return reponse.status(201).send({ numero: null });
      const { telephone, email } = verifierCoordonnees(d);
      const marche: Marche = {
        typeMarche: d.marche.typeMarche,
        maitreOuvrage: d.marche.maitreOuvrage.trim(),
        objet: d.marche.objet.trim(),
        ...(d.marche.lieu?.trim() ? { lieu: d.marche.lieu.trim() } : {}),
        ...(d.marche.montant !== undefined ? { montant: d.marche.montant } : {}),
        ...(d.marche.dureeMois !== undefined ? { dureeMois: d.marche.dureeMois } : {}),
        garanties: GARANTIES.filter((g) => d.garanties.includes(g)),
      };
      const { rows } = await transactionSysteme(pool, (client) =>
        client.query<{ numero: number }>(
          "SELECT numero FROM app.enregistrer_appel_offres($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [brancheAppelOffres(marche.garanties), d.profil, d.nom, telephone, email, d.commune ?? null, d.besoin ?? null, d.dateLimite,
           JSON.stringify(marche), d.accordTraitement.trim(), d.accordWhatsApp?.trim() ?? null, empreinte(requete.ip)],
        ),
      );
      requete.log.info({ numero: rows[0]?.numero }, "appel d'offres reçu du site");
      return reponse.status(201).send({ numero: rows[0]?.numero ?? null });
    },
  );

  // Demande de rendez-vous : un jour et une demi-journée ; l'agence confirme l'heure
  app.post<{
    Body: Coordonnees & {
      motif: (typeof MOTIFS_RENDEZ_VOUS)[number]; mode: (typeof MODES_RENDEZ_VOUS)[number]; jour: string;
      creneau: (typeof CRENEAUX)[number]; message?: string;
    };
  }>(
    CHEMIN_RENDEZ_VOUS,
    {
      config: { appeleeParLeSite: true },
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: "object",
          required: [...requisCoordonnees, "motif", "mode", "jour", "creneau"],
          additionalProperties: false,
          properties: {
            ...proprietesCoordonnees,
            motif: { type: "string", enum: MOTIFS_RENDEZ_VOUS },
            mode: { type: "string", enum: MODES_RENDEZ_VOUS },
            jour: date,
            creneau: { type: "string", enum: CRENEAUX },
            message: texteCourt(1000, 0),
          },
        },
      },
    },
    async (requete, reponse) => {
      const d = requete.body;
      if (d.siteWeb) return reponse.status(201).send({ numero: null });
      const { telephone, email } = verifierCoordonnees(d);
      const { rows } = await transactionSysteme(pool, (client) =>
        client.query<{ numero: number }>(
          "SELECT numero FROM app.demander_rendez_vous($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [d.motif, d.mode, d.profil, d.nom, telephone, email, d.message ?? null, d.jour, d.creneau, d.accordTraitement.trim(),
           d.accordWhatsApp?.trim() ?? null, empreinte(requete.ip)],
        ),
      );
      requete.log.info({ numero: rows[0]?.numero }, "demande de rendez-vous reçue du site");
      return reponse.status(201).send({ numero: rows[0]?.numero ?? null });
    },
  );
}
