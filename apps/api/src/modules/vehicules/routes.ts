// Véhicules d'un client, avec les échéances administratives suivies pour les transporteurs
// (visite technique, vignette, carte de transport).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { normaliserImmatriculation } from "../../commun/formats.js";
import { date, montant, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { exigerClientVisible } from "../clients/visibilite.js";

interface CorpsVehicule {
  immatriculation: string;
  numeroChassis?: string;
  marque?: string;
  modele?: string;
  genre?: string;
  usage?: string;
  puissanceFiscale?: number;
  valeurVenale?: number;
  echeanceVisiteTechnique?: string;
  echeanceVignette?: string;
  echeanceCarteTransport?: string;
}

/** Champs modifiables d'un véhicule (l'immatriculation, qui l'identifie, ne change pas ici) et leur affectation */
const MODIFIABLES = {
  numeroChassis: "numero_chassis = upper(nullif(btrim($X), ''))",
  marque: "marque = btrim($X)",
  modele: "modele = btrim($X)",
  genre: "genre = btrim($X)",
  usage: "usage = btrim($X)",
  puissanceFiscale: "puissance_fiscale = $X",
  valeurVenale: "valeur_venale = $X",
  echeanceVisiteTechnique: "echeance_visite_technique = $X",
  echeanceVignette: "echeance_vignette = $X",
  echeanceCarteTransport: "echeance_carte_transport = $X",
} as const satisfies Record<Exclude<keyof CorpsVehicule, "immatriculation">, string>;

const RETOUR = `id, client_id AS "clientId", immatriculation, numero_chassis AS "numeroChassis", marque, modele, genre, usage,
  puissance_fiscale AS "puissanceFiscale", valeur_venale AS "valeurVenale", echeance_visite_technique AS "echeanceVisiteTechnique",
  echeance_vignette AS "echeanceVignette", echeance_carte_transport AS "echeanceCarteTransport"`;

export async function routesVehicules(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.post<{ Params: { id: string }; Body: CorpsVehicule }>(
    "/clients/:id/vehicules",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["immatriculation"],
          additionalProperties: false,
          properties: {
            immatriculation: texteCourt(20, 3),
            numeroChassis: texteCourt(40),
            marque: texteCourt(40),
            modele: texteCourt(40),
            genre: texteCourt(60),
            usage: texteCourt(60),
            puissanceFiscale: { type: "integer", minimum: 1, maximum: 99 },
            valeurVenale: montant,
            echeanceVisiteTechnique: date,
            echeanceVignette: date,
            echeanceCarteTransport: date,
          },
        },
      },
    },
    async (requete, reponse) => {
      const v = requete.body;
      const immatriculation = normaliserImmatriculation(v.immatriculation);
      if (!immatriculation) {
        throw new ErreurApi(422, "immatriculation_invalide", "Immatriculation invalide (lettres, chiffres, espaces et tirets).");
      }
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `INSERT INTO app.vehicules (client_id, immatriculation, numero_chassis, marque, modele, genre, usage,
             puissance_fiscale, valeur_venale, echeance_visite_technique, echeance_vignette, echeance_carte_transport)
           VALUES ($1, $2, upper(nullif(btrim($3), '')), btrim($4), btrim($5), btrim($6), btrim($7), $8, $9, $10, $11, $12)
           RETURNING id, immatriculation, marque, modele, genre, usage, puissance_fiscale AS "puissanceFiscale",
             valeur_venale AS "valeurVenale", echeance_visite_technique AS "echeanceVisiteTechnique",
             echeance_vignette AS "echeanceVignette", echeance_carte_transport AS "echeanceCarteTransport"`,
          [requete.params.id, immatriculation, v.numeroChassis ?? null, v.marque ?? null, v.modele ?? null, v.genre ?? null,
           v.usage ?? null, v.puissanceFiscale ?? null, v.valeurVenale ?? null, v.echeanceVisiteTechnique ?? null,
           v.echeanceVignette ?? null, v.echeanceCarteTransport ?? null],
        );
      });
      return reponse.status(201).send({ vehicule: rows[0] });
    },
  );

  // Mise à jour d'un véhicule : échéances relues sur une visite technique ou une carte de transport (lecture
  // automatique, ADR 0018), châssis ou valeur complétés. Seuls les champs envoyés changent ; le journal d'audit
  // de la base garde l'ancienne et la nouvelle valeur.
  app.patch<{ Params: { id: string }; Body: Omit<CorpsVehicule, "immatriculation"> }>(
    "/vehicules/:id",
    {
      preHandler: gardes.roles("gerant", "charge_clientele", "commercial"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: {
            numeroChassis: texteCourt(40),
            marque: texteCourt(40),
            modele: texteCourt(40),
            genre: texteCourt(60),
            usage: texteCourt(60),
            puissanceFiscale: { type: "integer", minimum: 1, maximum: 99 },
            valeurVenale: montant,
            echeanceVisiteTechnique: date,
            echeanceVignette: date,
            echeanceCarteTransport: date,
          },
        },
      },
    },
    async (requete) => {
      const corps = requete.body as Record<string, unknown>;
      const valeurs: unknown[] = [requete.params.id];
      const affectations = Object.entries(MODIFIABLES)
        .filter(([champ]) => corps[champ] !== undefined)
        .map(([champ, affectation]) => {
          valeurs.push(corps[champ]);
          return affectation.replace("$X", `$${valeurs.length}`);
        });
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        // La sécurité au niveau des lignes limite la mise à jour aux véhicules des clients que la personne voit
        client.query(`UPDATE app.vehicules SET ${affectations.join(", ")} WHERE id = $1 RETURNING ${RETOUR}`, valeurs));
      if (!rows[0]) throw erreurs.introuvable();
      return { vehicule: rows[0] };
    },
  );
}
