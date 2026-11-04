// Portail des entreprises et des transporteurs (tâche 10), appelé depuis l'adresse du portail seulement :
//   · connexion par un code envoyé sur WhatsApp au numéro de l'accès (aucun mot de passe) ;
//   · tableau de bord de la flotte : véhicules, contrats et reste à payer, échéances des documents,
//     attestations, sinistres ;
//   · historique des sinistres d'un véhicule ;
//   · attestations téléchargées une à une ou en lot (archive ZIP), liste de la flotte en CSV ;
//   · accès des collaborateurs, gérés par le titulaire.
// Toutes les lectures passent par transactionPortail : la base ne montre que l'entreprise de la personne
// connectée (rôle dbs_portail, database/migrations/0012), même si une requête oubliait de filtrer.

import type { FastifyInstance } from "fastify";
import type { Client, Pool } from "../../base-de-donnees/connexion.js";
import { transactionPortail, transactionSysteme } from "../../base-de-donnees/connexion.js";
import { documentCsv } from "../../commun/csv.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { normaliserTelephone } from "../../commun/formats.js";
import { parametreId, texteCourt } from "../../commun/schemas.js";
import { creerZip, nomDeFichier } from "../../commun/zip.js";
import { genererJeton } from "../../securite/jetons.js";
import { dechiffrerAttestation } from "./attestations.js";
import {
  creerEmpreinteCode, DUREE_CODE, DUREE_SESSION_PORTAIL, effacerCookiePortail, type EnvoiCodes, gardePortail,
  genererCode, gestionnaireDe, INACTIVITE_PORTAIL, lireSessionPortail, poserCookiePortail,
} from "./connexion.js";

const STATUTS_SINISTRE_CLOS = ["regle", "refuse", "classe_sans_suite"];

/** « 2026-11-29 » → « 29/11/2026 » */
const jour = (valeur: string | null) => (valeur ? valeur.split("-").reverse().join("/") : "");

interface VehiculePortail {
  id: string;
  immatriculation: string;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
  sinistresEnCours: number;
  [cle: string]: unknown;
}

async function lireVehicules(client: Client, clientId: string): Promise<VehiculePortail[]> {
  const { rows } = await client.query<VehiculePortail>(
    `SELECT v.id, v.immatriculation, v.numero_chassis AS "numeroChassis", v.marque, v.modele, v.genre, v.usage,
            v.puissance_fiscale AS "puissanceFiscale",
            v.echeance_visite_technique AS "echeanceVisiteTechnique", v.echeance_vignette AS "echeanceVignette",
            v.echeance_carte_transport AS "echeanceCarteTransport",
            l.id AS "ligneId", l.numero_police AS "numeroPolice", l.statut AS "statutContrat",
            l.numero_attestation AS "numeroAttestation",
            coalesce(a.etat_analyse = 'saine', false) AS "attestationDisponible",
            (SELECT count(*)::int FROM app.sinistres s WHERE s.vehicule_id = v.id) AS sinistres,
            (SELECT count(*)::int FROM app.sinistres s WHERE s.vehicule_id = v.id AND s.statut::text <> ALL ($2)) AS "sinistresEnCours"
     FROM app.vehicules v
     LEFT JOIN LATERAL (
       SELECT cv.id, cv.numero_attestation, k.numero_police, k.statut
       FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = cv.contrat_id
       WHERE cv.vehicule_id = v.id AND cv.retire_le IS NULL AND k.statut IN ('en_attente_paiement', 'en_vigueur')
       ORDER BY k.date_echeance DESC LIMIT 1
     ) l ON true
     LEFT JOIN app.attestations_vehicules a ON a.contrat_vehicule_id = l.id
     WHERE v.client_id = $1
     ORDER BY v.immatriculation`,
    [clientId, STATUTS_SINISTRE_CLOS],
  );
  return rows;
}

export async function routesPortail(
  app: FastifyInstance,
  options: { pool: Pool; cleChiffrement: Buffer; envoiCodes: EnvoiCodes },
): Promise<void> {
  const { pool, cleChiffrement, envoiCodes } = options;
  const empreinteCode = creerEmpreinteCode(cleChiffrement);
  const garde = gardePortail(pool);
  const config = { appeleeParLePortail: true };
  const telephone = texteCourt(30, 8);

  // --- Connexion -------------------------------------------------------------------------------------

  // Demande de code : même réponse, et même délai, que le numéro ait un accès ou non
  app.post<{ Body: { telephone: string } }>(
    "/portail/connexion/code",
    {
      config,
      schema: { body: { type: "object", required: ["telephone"], additionalProperties: false, properties: { telephone } } },
    },
    async (requete, reponse) => {
      if (!envoiCodes.disponible) {
        throw new ErreurApi(503, "portail_indisponible", "Connexion au portail momentanément indisponible : appelez l'agence au 07 49 36 07 02.");
      }
      const numero = normaliserTelephone(requete.body.telephone);
      if (!numero) throw new ErreurApi(400, "telephone_invalide", "Numéro de téléphone invalide.");
      const code = genererCode();
      const { rows } = await transactionSysteme(pool, (client) =>
        client.query<{ statut: "envoyer" | "inconnu" | "trop_de_demandes" }>(
          "SELECT statut FROM portail.preparer_code($1, $2, $3, $4)",
          [numero, empreinteCode(numero, code), requete.ip, DUREE_CODE],
        ),
      );
      const statut = rows[0]?.statut;
      if (statut === "trop_de_demandes") {
        throw new ErreurApi(429, "trop_de_demandes", "Trop de demandes de code : réessayez dans quelques minutes.");
      }
      if (statut === "envoyer") {
        // Envoi sans l'attendre : le délai de la réponse ne trahit pas l'existence de l'accès
        void envoiCodes.envoyer(numero, code)
          .then((envoi) => {
            if (!envoi.ok) requete.log.warn({ erreur: envoi.erreur }, "code de connexion au portail non envoyé");
          })
          .catch((erreur: unknown) => requete.log.error({ err: erreur }, "code de connexion au portail non envoyé"));
      }
      return reponse.status(202).send({
        message: "Si ce numéro a un accès au portail, il vient de recevoir un code sur WhatsApp, valable 10 minutes.",
      });
    },
  );

  app.post<{ Body: { telephone: string; code: string } }>(
    "/portail/connexion",
    {
      config,
      schema: {
        body: {
          type: "object",
          required: ["telephone", "code"],
          additionalProperties: false,
          properties: { telephone, code: { type: "string", pattern: "^[0-9]{6}$" } },
        },
      },
    },
    async (requete, reponse) => {
      const numero = normaliserTelephone(requete.body.telephone);
      if (!numero) throw erreurs.codeInvalide();
      type Resultat =
        | { statut: "invalide" | "trop_de_tentatives" }
        | { statut: "valide"; jeton: string; session: { nom: string; role: string; entreprise: string; telephone: string; expire_le: Date } };
      const resultat = await transactionSysteme(pool, async (client): Promise<Resultat> => {
        const { rows } = await client.query<{ statut: "valide" | "invalide" | "trop_de_tentatives"; gestionnaire_id: string | null }>(
          "SELECT * FROM portail.verifier_code($1, $2, $3)",
          [numero, empreinteCode(numero, requete.body.code), requete.ip],
        );
        const verification = rows[0];
        if (!verification || verification.statut !== "valide" || !verification.gestionnaire_id) {
          return { statut: verification?.statut === "trop_de_tentatives" ? "trop_de_tentatives" : "invalide" };
        }
        const { jeton, empreinte } = genererJeton();
        await client.query("SELECT portail.ouvrir_session($1, $2, $3, $4, $5)",
          [verification.gestionnaire_id, empreinte, DUREE_SESSION_PORTAIL, requete.ip, requete.headers["user-agent"] ?? null]);
        const session = await client.query<{ nom: string; role: string; entreprise: string; telephone: string; expire_le: Date }>(
          "SELECT nom, role, entreprise, telephone, expire_le FROM portail.lire_session($1, $2)", [empreinte, INACTIVITE_PORTAIL]);
        return { statut: "valide", jeton, session: session.rows[0]! };
      });
      if (resultat.statut === "trop_de_tentatives") throw erreurs.tropDeTentatives();
      if (resultat.statut !== "valide") {
        throw new ErreurApi(401, "code_invalide", "Code incorrect ou expiré : vérifiez-le, ou demandez-en un nouveau.");
      }
      const { expire_le: expireLe, ...session } = resultat.session;
      poserCookiePortail(reponse, resultat.jeton, expireLe);
      return { session };
    },
  );

  app.post("/portail/deconnexion", { config }, async (requete, reponse) => {
    const session = await lireSessionPortail(pool, requete);
    if (session) await transactionSysteme(pool, (client) => client.query("SELECT portail.fermer_session($1)", [session.empreinte]));
    effacerCookiePortail(reponse);
    return reponse.status(204).send();
  });

  app.get("/portail/session", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    return { session: { nom: moi.nom, role: moi.role, entreprise: moi.entreprise, telephone: moi.telephone } };
  });

  // --- Tableau de bord de la flotte ------------------------------------------------------------------

  app.get("/portail/flotte", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    return transactionPortail(pool, moi.gestionnaireId, async (client) => {
      const vehicules = await lireVehicules(client, moi.clientId);
      const { rows: contrats } = await client.query<{ statut: string; resteAPayer: number }>(
        `SELECT s.contrat_id AS id, s.numero_police AS "numeroPolice", s.branche, s.statut, k.date_effet AS "dateEffet",
                k.date_echeance AS "dateEcheance", s.prime_due AS "primeDue", s.reste_a_payer AS "resteAPayer",
                (SELECT count(*)::int FROM app.contrats_vehicules cv WHERE cv.contrat_id = k.id AND cv.retire_le IS NULL) AS vehicules
         FROM app.v_soldes_contrats s JOIN app.contrats k ON k.id = s.contrat_id
         WHERE k.client_id = $1 AND (s.statut IN ('en_attente_paiement', 'en_vigueur', 'suspendu')
                                     OR k.date_echeance >= (now() AT TIME ZONE 'Africa/Abidjan')::date - 90)
         ORDER BY k.date_echeance DESC`,
        [moi.clientId],
      );
      const aujourdHui = Date.parse(new Date().toISOString().slice(0, 10));
      const documentsARenouveler = vehicules.reduce((total, v) => total + [v.echeanceVisiteTechnique, v.echeanceVignette, v.echeanceCarteTransport]
        .filter((date) => date !== null && (Date.parse(date) - aujourdHui) / 86_400_000 <= 30).length, 0);
      return {
        entreprise: moi.entreprise,
        vehicules,
        contrats,
        resume: {
          vehicules: vehicules.length,
          vehiculesAssures: vehicules.filter((v) => v.ligneId).length,
          documentsARenouveler,
          sinistresEnCours: vehicules.reduce((total, v) => total + v.sinistresEnCours, 0),
          resteAPayer: contrats.filter((k) => k.statut !== "resilie").reduce((total, k) => total + Math.max(k.resteAPayer, 0), 0),
        },
      };
    });
  });

  // Un véhicule : ses périodes de couverture et l'historique de ses sinistres
  app.get<{ Params: { id: string } }>("/portail/vehicules/:id", { preHandler: garde, schema: { params: parametreId } }, async (requete) => {
    const moi = gestionnaireDe(requete);
    return transactionPortail(pool, moi.gestionnaireId, async (client) => {
      const vehicule = (await lireVehicules(client, moi.clientId)).find((v) => v.id === requete.params.id);
      if (!vehicule) throw erreurs.introuvable();
      const { rows: periodes } = await client.query(
        `SELECT cv.id AS "ligneId", k.numero_police AS "numeroPolice", k.branche, k.statut AS "statutContrat",
                cv.ajoute_le AS "ajouteLe", coalesce(cv.retire_le, k.date_echeance) AS "jusquAu", cv.retire_le IS NOT NULL AS retire,
                cv.numero_attestation AS "numeroAttestation", coalesce(a.etat_analyse = 'saine', false) AS "attestationDisponible"
         FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = cv.contrat_id
         LEFT JOIN app.attestations_vehicules a ON a.contrat_vehicule_id = cv.id
         WHERE cv.vehicule_id = $1 ORDER BY cv.ajoute_le DESC`,
        [vehicule.id],
      );
      const { rows: sinistres } = await client.query(
        `SELECT s.id, s.survenu_le AS "survenuLe", s.declare_le AS "declareLe", s.nature, s.statut,
                s.dommages_corporels AS "dommagesCorporels", s.reference_compagnie AS "referenceCompagnie",
                k.numero_police AS "numeroPolice"
         FROM app.sinistres s JOIN app.contrats k ON k.id = s.contrat_id
         WHERE s.vehicule_id = $1 ORDER BY s.survenu_le DESC`,
        [vehicule.id],
      );
      return { vehicule, periodes, sinistres };
    });
  });

  // --- Attestations et export ------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    "/portail/attestations/:id",
    { preHandler: garde, schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const fichier = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
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
        if (ligne.etat_analyse !== "saine") throw new ErreurApi(503, "analyse_en_attente", "Attestation en cours de vérification : réessayez plus tard.");
        const contenu = dechiffrerAttestation(cleChiffrement, requete.params.id, ligne.contenu_chiffre, ligne.empreinte);
        await client.query("SELECT portail.consigner('attestation_telechargee', $1, $2)",
          [`Attestation ${ligne.numero} (${ligne.immatriculation})`, requete.ip]);
        return { contenu, nom: `attestation-${nomDeFichier(ligne.immatriculation)}-${nomDeFichier(ligne.numero)}.pdf` };
      });
      return reponse
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${fichier.nom}"`)
        .send(fichier.contenu);
    },
  );

  // Toutes les attestations en cours, en une archive : de quoi les imprimer pour chaque camion
  app.get("/portail/attestations.zip", { preHandler: garde }, async (requete, reponse) => {
    const moi = gestionnaireDe(requete);
    const archive = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
      const { rows } = await client.query<{
        ligne_id: string; immatriculation: string; numero: string; contenu_chiffre: Buffer; empreinte: Buffer;
      }>(
        `SELECT cv.id AS ligne_id, v.immatriculation, cv.numero_attestation AS numero, a.contenu_chiffre, a.empreinte
         FROM app.attestations_vehicules a
         JOIN app.contrats_vehicules cv ON cv.id = a.contrat_vehicule_id
         JOIN app.contrats k ON k.id = cv.contrat_id
         JOIN app.vehicules v ON v.id = cv.vehicule_id
         WHERE k.client_id = $1 AND cv.retire_le IS NULL AND k.statut IN ('en_attente_paiement', 'en_vigueur')
           AND a.etat_analyse = 'saine'
         ORDER BY v.immatriculation`,
        [moi.clientId],
      );
      if (rows.length === 0) throw new ErreurApi(404, "aucune_attestation", "Aucune attestation disponible pour l'instant.");
      const fichiers = rows.map((l) => ({
        nom: `attestation-${nomDeFichier(l.immatriculation)}-${nomDeFichier(l.numero)}.pdf`,
        contenu: dechiffrerAttestation(cleChiffrement, l.ligne_id, l.contenu_chiffre, l.empreinte),
      }));
      await client.query("SELECT portail.consigner('attestations_telechargees', $1, $2)", [`${rows.length} attestation(s) en lot`, requete.ip]);
      return creerZip(fichiers);
    });
    return reponse
      .type("application/zip")
      .header("Content-Disposition", `attachment; filename="attestations-${nomDeFichier(moi.entreprise).toLowerCase()}.zip"`)
      .send(archive);
  });

  app.get("/portail/flotte.csv", { preHandler: garde }, async (requete, reponse) => {
    const moi = gestionnaireDe(requete);
    const vehicules = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
      const lignes = await lireVehicules(client, moi.clientId);
      await client.query("SELECT portail.consigner('export_flotte', $1, $2)", [`Liste de ${lignes.length} véhicule(s)`, requete.ip]);
      return lignes;
    });
    const entetes = ["Immatriculation", "Marque", "Modèle", "Genre", "Contrat", "N° d'attestation", "Visite technique", "Vignette",
      "Carte de transport", "Sinistres"];
    const lignes = vehicules.map((v) => [v.immatriculation, v.marque, v.modele, v.genre, v.numeroPolice, v.numeroAttestation,
      jour(v.echeanceVisiteTechnique), jour(v.echeanceVignette), jour(v.echeanceCarteTransport), v.sinistres] as (string | number | null)[]);
    return reponse
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="flotte-${nomDeFichier(moi.entreprise).toLowerCase()}.csv"`)
      .send(documentCsv([entetes, ...lignes]));
  });

  // --- Accès des collaborateurs (le titulaire les gère ; la base le vérifie) ------------------------

  app.get("/portail/gestionnaires", { preHandler: garde }, async (requete) => {
    const moi = gestionnaireDe(requete);
    const { rows } = await transactionPortail(pool, moi.gestionnaireId, (client) =>
      client.query(
        `SELECT id, nom, telephone, role, actif, cree_le AS "creeLe", derniere_connexion_le AS "derniereConnexionLe",
                id = $2 AS moi
         FROM app.gestionnaires_portail WHERE client_id = $1 AND actif ORDER BY role, nom`,
        [moi.clientId, moi.gestionnaireId],
      ),
    );
    return { gestionnaires: rows };
  });

  app.post<{ Body: { nom: string; telephone: string } }>(
    "/portail/gestionnaires",
    {
      preHandler: garde,
      config,
      schema: {
        body: {
          type: "object",
          required: ["nom", "telephone"],
          additionalProperties: false,
          properties: { nom: texteCourt(120, 2), telephone },
        },
      },
    },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      const numero = normaliserTelephone(requete.body.telephone);
      if (!numero) throw new ErreurApi(400, "telephone_invalide", "Numéro de téléphone invalide.");
      const id = await transactionPortail(pool, moi.gestionnaireId, async (client) => {
        const { rows } = await client.query<{ id: string }>("SELECT portail.ajouter_gestionnaire($1, $2, $3) AS id",
          [requete.body.nom.trim(), numero, requete.ip]);
        return rows[0]!.id;
      });
      return reponse.status(201).send({ gestionnaire: { id, nom: requete.body.nom.trim(), telephone: numero, role: "gestionnaire" } });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/portail/gestionnaires/:id",
    { preHandler: garde, config, schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = gestionnaireDe(requete);
      if (requete.params.id === moi.gestionnaireId) {
        throw new ErreurApi(422, "regle_metier", "Vous ne pouvez pas retirer votre propre accès : demandez-le à l'agence.");
      }
      await transactionPortail(pool, moi.gestionnaireId, (client) =>
        client.query("SELECT portail.desactiver_gestionnaire($1, $2)", [requete.params.id, requete.ip]));
      return reponse.status(204).send();
    },
  );
}
