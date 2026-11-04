// Véhicules d'un client, avec les échéances administratives suivies pour les transporteurs
// (visite technique, vignette, carte de transport).

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi } from "../../commun/erreurs.js";
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
}
