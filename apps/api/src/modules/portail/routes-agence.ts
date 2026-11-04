// Portail des entreprises, côté agence (back-office) :
//   · accès au portail d'une entreprise : titulaire et collaborateurs, désactivation ;
//   · dépôt de l'attestation (PDF de l'ASACI) d'un véhicule couvert, analysée par l'antivirus, chiffrée ;
//   · lecture d'une attestation déposée.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import { nomDeFichier } from "../../commun/zip.js";
import type { Antivirus } from "../../integrations/antivirus/clamav.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { exigerClientVisible } from "../clients/visibilite.js";
import {
  chiffrerAttestation, dechiffrerAttestation, FORMAT_NUMERO_ATTESTATION, LONGUEUR_BASE64_ATTESTATION_MAX, lireAttestation,
} from "./attestations.js";

const COLONNES_GESTIONNAIRE = `g.id, g.nom, g.telephone, g.role, g.actif, g.cree_le AS "creeLe", g.desactive_le AS "desactiveLe",
  g.derniere_connexion_le AS "derniereConnexionLe", coalesce(u.nom, t.nom) AS "creePar"`;

export async function routesPortailAgence(
  app: FastifyInstance,
  options: { pool: Pool; gardes: Gardes; cleChiffrement: Buffer; antivirus: Antivirus },
): Promise<void> {
  const { pool, gardes, cleChiffrement, antivirus } = options;
  const gestionnaires = gardes.roles("gerant", "charge_clientele");

  // --- Accès au portail d'une entreprise -------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    "/clients/:id/acces-portail",
    { preHandler: gardes.roles("gerant", "charge_clientele", "commercial", "auditeur"), schema: { params: parametreId } },
    async (requete) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `SELECT ${COLONNES_GESTIONNAIRE}
           FROM app.gestionnaires_portail g
           LEFT JOIN app.utilisateurs u ON u.id = g.cree_par
           LEFT JOIN app.gestionnaires_portail t ON t.id = g.cree_par_gestionnaire
           WHERE g.client_id = $1 ORDER BY g.actif DESC, g.role, g.nom`,
          [requete.params.id],
        );
      });
      return { acces: rows };
    },
  );

  app.post<{ Params: { id: string }; Body: { nom: string; telephone: string; role: "titulaire" | "gestionnaire" } }>(
    "/clients/:id/acces-portail",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["nom", "telephone", "role"],
          additionalProperties: false,
          properties: {
            nom: texteCourt(120, 2),
            telephone: texteCourt(30, 8),
            role: { type: "string", enum: ["titulaire", "gestionnaire"] },
          },
        },
      },
    },
    async (requete, reponse) => {
      const telephone = normaliserTelephone(requete.body.telephone);
      if (!telephone) throw new ErreurApi(400, "telephone_invalide", "Numéro de téléphone invalide.");
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        return client.query(
          `INSERT INTO app.gestionnaires_portail (client_id, nom, telephone, role) VALUES ($1, btrim($2), $3, $4)
           RETURNING id, nom, telephone, role, actif`,
          [requete.params.id, requete.body.nom, telephone, requete.body.role],
        );
      });
      return reponse.status(201).send({ acces: rows[0] });
    },
  );

  // Désactiver (départ d'un employé), réactiver, changer de rôle
  app.patch<{ Params: { id: string }; Body: { actif?: boolean; role?: "titulaire" | "gestionnaire" } }>(
    "/acces-portail/:id",
    {
      preHandler: gestionnaires,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: { actif: { type: "boolean" }, role: { type: "string", enum: ["titulaire", "gestionnaire"] } },
        },
      },
    },
    async (requete) => {
      const { actif, role } = requete.body;
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `UPDATE app.gestionnaires_portail SET actif = coalesce($2, actif), role = coalesce($3::app.role_gestionnaire, role)
           WHERE id = $1 RETURNING id, nom, telephone, role, actif`,
          [requete.params.id, actif ?? null, role ?? null],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return { acces: rows[0] };
    },
  );

  // --- Attestations ----------------------------------------------------------------------------------

  // Dépôt (ou remplacement) de l'attestation du véhicule couvert par ce contrat
  app.post<{ Params: { id: string; vehiculeId: string }; Body: { numero: string; fichier: string } }>(
    "/contrats/:id/vehicules/:vehiculeId/attestation",
    {
      preHandler: gestionnaires,
      bodyLimit: LONGUEUR_BASE64_ATTESTATION_MAX + 4096,
      schema: {
        params: {
          type: "object",
          required: ["id", "vehiculeId"],
          properties: { id: { type: "string", format: "uuid" }, vehiculeId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["numero", "fichier"],
          additionalProperties: false,
          properties: {
            numero: { type: "string", pattern: FORMAT_NUMERO_ATTESTATION },
            fichier: texteCourt(LONGUEUR_BASE64_ATTESTATION_MAX, 4),
          },
        },
      },
    },
    async (requete, reponse) => {
      const lecture = lireAttestation(requete.body.fichier);
      if (!lecture.ok) throw new ErreurApi(422, "fichier_refuse", lecture.message);
      const numero = requete.body.numero.trim().toUpperCase();

      // Analyse avant tout enregistrement : un fichier infecté n'entre jamais dans la base
      let etat: "saine" | "a_analyser" = "a_analyser";
      if (antivirus.configure) {
        const verdict = await antivirus.analyser(lecture.contenu);
        if (verdict.etat === "infectee") {
          requete.log.warn({ signature: verdict.signature }, "attestation infectée refusée au dépôt");
          throw new ErreurApi(422, "fichier_infecte", "Ce fichier contient un virus : il a été refusé. Téléchargez de nouveau l'attestation depuis la plateforme de l'ASACI.");
        }
        if (verdict.etat === "indisponible") {
          throw new ErreurApi(503, "antivirus_indisponible", "Analyse antivirus momentanément impossible : réessayez dans quelques minutes.");
        }
        etat = "saine";
      }

      const attestation = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const { rows } = await client.query<{ id: string; immatriculation: string; statut: string }>(
          `SELECT cv.id, v.immatriculation, k.statut FROM app.contrats_vehicules cv
           JOIN app.vehicules v ON v.id = cv.vehicule_id JOIN app.contrats k ON k.id = cv.contrat_id
           WHERE cv.contrat_id = $1 AND cv.vehicule_id = $2 AND cv.retire_le IS NULL`,
          [requete.params.id, requete.params.vehiculeId],
        );
        const ligne = rows[0];
        if (!ligne) throw new ErreurApi(404, "introuvable", "Ce véhicule n'est pas couvert par ce contrat.");
        // Code CIMA, art. 13 : pas d'attestation tant que la prime n'est pas payée
        if (ligne.statut !== "en_vigueur") {
          throw new ErreurApi(422, "regle_metier", "Contrat pas en vigueur : l'attestation se dépose une fois la prime payée.");
        }
        await client.query("UPDATE app.contrats_vehicules SET numero_attestation = $2 WHERE id = $1", [ligne.id, numero]);
        const { contenuChiffre, empreinte } = chiffrerAttestation(cleChiffrement, ligne.id, lecture.contenu);
        await client.query(
          `INSERT INTO app.attestations_vehicules (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (contrat_vehicule_id) DO UPDATE SET contenu_chiffre = EXCLUDED.contenu_chiffre,
             empreinte = EXCLUDED.empreinte, taille = EXCLUDED.taille, etat_analyse = EXCLUDED.etat_analyse`,
          [ligne.id, contenuChiffre, empreinte, lecture.contenu.length, etat],
        );
        return { ligneId: ligne.id, immatriculation: ligne.immatriculation, numero, taille: lecture.contenu.length, etatAnalyse: etat };
      });
      return reponse.status(201).send({ attestation });
    },
  );

  // Lecture d'une attestation déposée (contrôle avant de l'envoyer au client, réimpression)
  app.get<{ Params: { id: string } }>(
    "/attestations/:id",
    { preHandler: gardes.roles("gerant", "charge_clientele", "commercial"), schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const fichier = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<{
          immatriculation: string; numero: string; contenu_chiffre: Buffer; empreinte: Buffer; etat_analyse: string;
        }>(
          `SELECT v.immatriculation, cv.numero_attestation AS numero, a.contenu_chiffre, a.empreinte, a.etat_analyse
           FROM app.attestations_vehicules a
           JOIN app.contrats_vehicules cv ON cv.id = a.contrat_vehicule_id
           JOIN app.vehicules v ON v.id = cv.vehicule_id
           WHERE a.contrat_vehicule_id = $1`,
          [requete.params.id],
        );
        const ligne = rows[0];
        if (!ligne) throw erreurs.introuvable();
        if (ligne.etat_analyse !== "saine") throw new ErreurApi(503, "analyse_en_attente", "Attestation pas encore analysée par l'antivirus.");
        await consignerEvenement(client, "piece_telechargee", {
          utilisateurId: moi.id, ip: requete.ip, objet: `Attestation ${ligne.numero} (${ligne.immatriculation})`,
        });
        return {
          contenu: dechiffrerAttestation(cleChiffrement, requete.params.id, ligne.contenu_chiffre, ligne.empreinte),
          nom: `attestation-${nomDeFichier(ligne.immatriculation)}-${nomDeFichier(ligne.numero)}.pdf`,
        };
      });
      return reponse
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${fichier.nom}"`)
        .send(fichier.contenu);
    },
  );
}
