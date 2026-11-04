// Flottes (tâche 8) : véhicules d'un client et leurs échéances, import d'une liste Excel ou CSV contrôlée
// ligne par ligne, export pour la cotation en lot, composition des contrats et avenants au prorata
// (incorporation, retrait, réintégration, annulation). Les règles (prorata, contrat en vigueur, véhicule du
// bon client, périodes sans chevauchement, ajout seul) sont appliquées par la base.

import type { FastifyInstance } from "fastify";
import type { Client as ClientBase, Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { documentCsv } from "../../commun/csv.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, montant, parametreId, texteCourt } from "../../commun/schemas.js";
import { ErreurTableur, lireTableau, TAILLE_FICHIER_MAX } from "../../commun/tableur.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";
import { exigerClientVisible } from "../clients/visibilite.js";
import { decoderBase64 } from "../demandes-site/piece.js";
import { analyserTableau, cleImmatriculation, ENTETES_MODELE, type ErreurLigne, type VehiculeImporte } from "./import.js";

const COLONNES_VEHICULE = `v.id, v.immatriculation, v.numero_chassis AS "numeroChassis", v.marque, v.modele, v.genre, v.usage,
  v.puissance_fiscale AS "puissanceFiscale", v.valeur_venale AS "valeurVenale",
  v.echeance_visite_technique AS "echeanceVisiteTechnique", v.echeance_vignette AS "echeanceVignette",
  v.echeance_carte_transport AS "echeanceCarteTransport"`;

const COLONNES_AVENANT = `a.id, a.numero, a.contrat_id AS "contratId", a.nature, a.date_effet AS "dateEffet", a.montant,
  a.motif, a.annule_numero AS "annuleNumero", a.annule_par_numero AS "annuleParNumero", a.regle, a.cree_le AS "creeLe",
  u.nom AS "creePar"`;

/** « 2026-11-29 » → « 29/11/2026 » pour l'export */
const jour = (valeur: string | null) => (valeur ? valeur.split("-").reverse().join("/") : "");

export async function routesFlottes(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const gestionnaires = gardes.roles("gerant", "charge_clientele", "commercial");

  // Flotte d'un client : véhicules et échéances, contrats avec leur composition et leurs avenants
  app.get<{ Params: { id: string } }>(
    "/clients/:id/flotte",
    { preHandler: gardes.sessionComplete(), schema: { params: parametreId } },
    async (requete) => {
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        const vehicules = await client.query(
          `SELECT ${COLONNES_VEHICULE},
                  (SELECT k.numero_police FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = cv.contrat_id
                   WHERE cv.vehicule_id = v.id AND cv.retire_le IS NULL AND k.statut IN ('en_attente_paiement', 'en_vigueur')
                   ORDER BY k.date_echeance DESC LIMIT 1) AS "policeEnCours",
                  -- Historique des sinistres du véhicule, du plus récent au plus ancien
                  coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'survenuLe', s.survenu_le, 'nature', s.nature,
                                                                'statut', s.statut) ORDER BY s.survenu_le DESC)
                            FROM app.sinistres s WHERE s.vehicule_id = v.id), '[]'::jsonb) AS sinistres
           FROM app.vehicules v WHERE v.client_id = $1 ORDER BY v.immatriculation`,
          [requete.params.id],
        );
        const contrats = await client.query(
          `SELECT k.id, k.numero_police AS "numeroPolice", k.branche, k.statut, k.date_effet AS "dateEffet",
                  k.date_echeance AS "dateEcheance", k.prime_ttc AS "primeTtc", k.primes_avenants AS "primesAvenants"
           FROM app.contrats k
           WHERE k.client_id = $1 AND (k.branche = 'flotte' OR EXISTS (SELECT 1 FROM app.contrats_vehicules cv WHERE cv.contrat_id = k.id))
           ORDER BY k.date_effet DESC`,
          [requete.params.id],
        );
        const composition = await client.query(
          `SELECT cv.id AS "ligneId", cv.contrat_id AS "contratId", cv.vehicule_id AS "vehiculeId", v.immatriculation,
                  cv.ajoute_le AS "ajouteLe", cv.retire_le AS "retireLe", cv.prime_vehicule AS "primeVehicule",
                  cv.numero_attestation AS "numeroAttestation", a.etat_analyse AS "attestation"
           FROM app.contrats_vehicules cv JOIN app.vehicules v ON v.id = cv.vehicule_id
           LEFT JOIN app.attestations_vehicules a ON a.contrat_vehicule_id = cv.id
           WHERE cv.contrat_id = ANY($1) ORDER BY v.immatriculation, cv.ajoute_le`,
          [contrats.rows.map((k: { id: string }) => k.id)],
        );
        const avenants = await lireAvenants(client, contrats.rows.map((k: { id: string }) => k.id));
        return {
          vehicules: vehicules.rows,
          contrats: contrats.rows.map((k: { id: string }) => ({
            ...k,
            vehicules: composition.rows.filter((c: { contratId: string }) => c.contratId === k.id),
            avenants: avenants.filter((a) => a.contratId === k.id),
          })),
        };
      });
    },
  );

  // Modèle à remplir, en CSV lisible par Excel
  app.get("/flottes/modele-import.csv", { preHandler: gardes.sessionComplete() }, async (_requete, reponse) => {
    const exemple = ["1234 AB 01", "", "Renault Trucks", "T 480", "Tracteur routier", "Transport de marchandises", 12, 45000000,
      "24/11/2026", "31/03/2027", "31/01/2027"];
    return reponse
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="modele-flotte-dbs-assurances.csv"')
      .send(documentCsv([ENTETES_MODELE, exemple]));
  });

  // Import d'une liste de véhicules : aperçu (contrôle de chaque ligne), puis enregistrement tout ou rien
  app.post<{ Params: { id: string }; Body: { fichier: string; confirmer?: boolean } }>(
    "/clients/:id/vehicules/import",
    {
      preHandler: gestionnaires,
      bodyLimit: Math.ceil(TAILLE_FICHIER_MAX / 3) * 4 + 4096,
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["fichier"],
          additionalProperties: false,
          properties: {
            fichier: texteCourt(Math.ceil(TAILLE_FICHIER_MAX / 3) * 4, 4),
            confirmer: { type: "boolean" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const contenu = decoderBase64(requete.body.fichier);
      if (!contenu) throw new ErreurApi(422, "fichier_illisible", "Le fichier n'a pas pu être lu. Réessayez.");
      let analyse;
      try {
        analyse = analyserTableau(lireTableau(contenu));
      } catch (erreur) {
        if (erreur instanceof ErreurTableur) throw new ErreurApi(422, "fichier_illisible", erreur.message);
        throw erreur;
      }

      const moi = utilisateurDe(requete);
      const resultat = await transactionUtilisateur(pool, moi.id, async (client) => {
        await exigerClientVisible(client, requete.params.id);
        // Véhicules déjà connus (même plaque, écrite avec ou sans tirets) : mis à jour s'ils sont à ce client,
        // refusés s'ils sont à un autre ; la fiche garde l'immatriculation déjà enregistrée
        const existants = await client.query<{ id: string; immatriculation: string; client_id: string; cle: string }>(
          `SELECT id, immatriculation, client_id, regexp_replace(upper(immatriculation), '[[:space:]-]', '', 'g') AS cle
           FROM app.vehicules WHERE regexp_replace(upper(immatriculation), '[[:space:]-]', '', 'g') = ANY($1)`,
          [analyse.lignes.map((l) => cleImmatriculation(l.vehicule.immatriculation))],
        );
        const parImmatriculation = new Map(existants.rows.map((v) => [v.cle, v]));
        const erreursLignes: ErreurLigne[] = [...analyse.erreurs];
        const lignes = analyse.lignes.map((l) => {
          const existant = parImmatriculation.get(cleImmatriculation(l.vehicule.immatriculation));
          if (existant && existant.client_id !== requete.params.id) {
            erreursLignes.push({
              ligne: l.ligne, colonne: "Immatriculation", valeur: l.vehicule.immatriculation,
              message: "Véhicule déjà enregistré pour un autre client de l'agence.",
            });
          }
          return { ...l, action: existant ? ("mise_a_jour" as const) : ("creation" as const), id: existant?.id ?? null };
        });
        erreursLignes.sort((a, b) => a.ligne - b.ligne);

        const resume = {
          creations: lignes.filter((l) => l.action === "creation").length,
          misesAJour: lignes.filter((l) => l.action === "mise_a_jour").length,
        };
        if (!requete.body.confirmer || erreursLignes.length > 0) {
          return { enregistre: false, lignes, erreurs: erreursLignes, colonnes: analyse.colonnes, ignorees: analyse.ignorees, resume };
        }

        for (const ligne of lignes) {
          const v: VehiculeImporte = ligne.vehicule;
          const valeurs = [v.numeroChassis, v.marque, v.modele, v.genre, v.usage, v.puissanceFiscale, v.valeurVenale,
            v.echeanceVisiteTechnique, v.echeanceVignette, v.echeanceCarteTransport];
          if (ligne.action === "creation") {
            await client.query(
              `INSERT INTO app.vehicules (client_id, immatriculation, numero_chassis, marque, modele, genre, usage,
                 puissance_fiscale, valeur_venale, echeance_visite_technique, echeance_vignette, echeance_carte_transport)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [requete.params.id, v.immatriculation, ...valeurs],
            );
          } else {
            // Une cellule vide ne remplace rien : le fichier complète ou met à jour la fiche du véhicule
            await client.query(
              `UPDATE app.vehicules SET numero_chassis = coalesce($2, numero_chassis), marque = coalesce($3, marque),
                 modele = coalesce($4, modele), genre = coalesce($5, genre), usage = coalesce($6, usage),
                 puissance_fiscale = coalesce($7, puissance_fiscale), valeur_venale = coalesce($8, valeur_venale),
                 echeance_visite_technique = coalesce($9, echeance_visite_technique),
                 echeance_vignette = coalesce($10, echeance_vignette),
                 echeance_carte_transport = coalesce($11, echeance_carte_transport)
               WHERE id = $1`,
              [ligne.id, ...valeurs],
            );
          }
        }
        return { enregistre: true, lignes, erreurs: [], colonnes: analyse.colonnes, ignorees: analyse.ignorees, resume };
      });

      if (requete.body.confirmer && !resultat.enregistre) {
        return reponse.status(422).send({
          code: "import_invalide",
          message: "Le fichier contient des erreurs : rien n'a été enregistré. Corrigez-les puis importez de nouveau.",
          ...resultat,
        });
      }
      return reponse.status(resultat.enregistre ? 201 : 200).send(resultat);
    },
  );

  // Export pour la cotation en lot : véhicules du client et leurs caractéristiques, consigné au journal de sécurité
  app.get<{ Params: { id: string } }>(
    "/clients/:id/flotte/export.csv",
    { preHandler: gestionnaires, schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const { nom, vehicules } = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows: clients } = await client.query<{ nom: string }>("SELECT nom FROM app.clients WHERE id = $1", [requete.params.id]);
        if (!clients[0]) throw erreurs.introuvable();
        const { rows } = await client.query<Record<string, string | number | null>>(
          `SELECT ${COLONNES_VEHICULE},
                  (SELECT k.numero_police FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = cv.contrat_id
                   WHERE cv.vehicule_id = v.id AND cv.retire_le IS NULL AND k.statut IN ('en_attente_paiement', 'en_vigueur')
                   ORDER BY k.date_echeance DESC LIMIT 1) AS "policeEnCours"
           FROM app.vehicules v WHERE v.client_id = $1 ORDER BY v.immatriculation`,
          [requete.params.id],
        );
        await consignerEvenement(client, "export_donnees", {
          utilisateurId: moi.id, ip: requete.ip, objet: `Flotte de ${clients[0].nom} (${rows.length} véhicules)`,
        });
        return { nom: clients[0].nom, vehicules: rows };
      });
      const lignes = vehicules.map((v) => [
        v.immatriculation, v.numeroChassis, v.marque, v.modele, v.genre, v.usage, v.puissanceFiscale, v.valeurVenale,
        jour(v.echeanceVisiteTechnique as string | null), jour(v.echeanceVignette as string | null),
        jour(v.echeanceCarteTransport as string | null), v.policeEnCours,
      ]);
      const fichier = `flotte-${nom.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "client"}.csv`;
      return reponse
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${fichier}"`)
        .send(documentCsv([[...ENTETES_MODELE, "Contrat en cours"], ...lignes]));
    },
  );

  // Composition de départ d'un contrat (avant son paiement) : le véhicule est couvert pour toute la période
  app.post<{ Params: { id: string }; Body: { vehiculeId: string; primeVehicule?: number } }>(
    "/contrats/:id/vehicules",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["vehiculeId"],
          additionalProperties: false,
          properties: { vehiculeId: { type: "string", format: "uuid" }, primeVehicule: montant },
        },
      },
    },
    async (requete, reponse) => {
      const { rows } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query(
          `INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule)
           SELECT k.id, $2, k.date_effet, $3 FROM app.contrats k WHERE k.id = $1
           RETURNING contrat_id AS "contratId", vehicule_id AS "vehiculeId", ajoute_le AS "ajouteLe", prime_vehicule AS "primeVehicule"`,
          [requete.params.id, requete.body.vehiculeId, requete.body.primeVehicule ?? null],
        ),
      );
      if (!rows[0]) throw erreurs.introuvable();
      return reponse.status(201).send({ vehicule: rows[0] });
    },
  );

  // Véhicule rattaché par erreur : il se détache tant que le contrat n'est pas payé (la base le vérifie)
  app.delete<{ Params: { id: string; vehiculeId: string } }>(
    "/contrats/:id/vehicules/:vehiculeId",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: {
          type: "object",
          required: ["id", "vehiculeId"],
          properties: { id: { type: "string", format: "uuid" }, vehiculeId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (requete, reponse) => {
      const { rowCount } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        client.query("DELETE FROM app.contrats_vehicules WHERE contrat_id = $1 AND vehicule_id = $2 AND retire_le IS NULL",
          [requete.params.id, requete.params.vehiculeId]),
      );
      if (!rowCount) throw erreurs.introuvable();
      return reponse.status(204).send();
    },
  );

  const parametresAvenant = {
    type: "object",
    required: ["id", "avenantId"],
    properties: { id: { type: "string", format: "uuid" }, avenantId: { type: "string", format: "uuid" } },
  } as const;

  // Avenant de mouvement : incorporation ou retrait d'un ou plusieurs véhicules à une même date. Sans
  // « confirmer », la base contrôle et calcule sans rien écrire (aperçu) ; avec, elle enregistre l'avenant,
  // met à jour la composition et la prime due. Le calcul est le même dans les deux cas.
  app.post<{
    Params: { id: string };
    Body: { dateEffet: string; lignes: LigneAvenant[]; observation?: string; confirmer?: boolean };
  }>(
    "/contrats/:id/avenants",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["dateEffet", "lignes"],
          additionalProperties: false,
          properties: {
            dateEffet: date,
            lignes: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: {
                type: "object",
                required: ["vehiculeId", "mouvement"],
                additionalProperties: false,
                properties: {
                  vehiculeId: { type: "string", format: "uuid" },
                  mouvement: { type: "string", enum: ["incorporation", "retrait"] },
                  primeVehicule: montant,
                },
              },
            },
            observation: texteCourt(500, 0),
            confirmer: { type: "boolean" },
          },
        },
      },
    },
    async (requete, reponse) => {
      const { dateEffet, lignes, observation, confirmer = false } = requete.body;
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await exigerContratVisible(client, requete.params.id);
        const { rows } = await client.query<{ r: { id: string | null } }>(
          "SELECT app.avenant_flotte($1, $2, $3::jsonb, $4, $5) AS r",
          [requete.params.id, dateEffet, JSON.stringify(lignes), observation?.trim() || null, confirmer],
        );
        const calcul = rows[0]!.r;
        return calcul.id ? { avenant: (await lireAvenants(client, [requete.params.id], calcul.id))[0] } : { apercu: calcul };
      });
      return reponse.status(confirmer ? 201 : 200).send(resultat);
    },
  );

  // Avenant d'annulation : défait exactement un avenant saisi par erreur (aperçu, puis confirmation)
  app.post<{ Params: { id: string; avenantId: string }; Body: { motif: string; confirmer?: boolean } }>(
    "/contrats/:id/avenants/:avenantId/annulation",
    {
      preHandler: gardes.roles("gerant", "charge_clientele"),
      schema: {
        params: parametresAvenant,
        body: {
          type: "object",
          required: ["motif"],
          additionalProperties: false,
          properties: { motif: texteCourt(500, 5), confirmer: { type: "boolean" } },
        },
      },
    },
    async (requete, reponse) => {
      const { motif, confirmer = false } = requete.body;
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        const existe = await client.query("SELECT 1 FROM app.avenants_flotte WHERE id = $1 AND contrat_id = $2",
          [requete.params.avenantId, requete.params.id]);
        if (!existe.rowCount) throw erreurs.introuvable();
        const { rows } = await client.query<{ r: { id: string | null } }>(
          "SELECT app.annuler_avenant_flotte($1, $2, $3) AS r",
          [requete.params.avenantId, motif.trim(), confirmer],
        );
        const calcul = rows[0]!.r;
        return calcul.id ? { avenant: (await lireAvenants(client, [requete.params.id], calcul.id))[0] } : { apercu: calcul };
      });
      return reponse.status(confirmer ? 201 : 200).send(resultat);
    },
  );
}

interface LigneAvenant {
  vehiculeId: string;
  mouvement: "incorporation" | "retrait";
  primeVehicule?: number;
}

interface Avenant {
  id: string;
  numero: number;
  contratId: string;
  nature: "mouvement" | "annulation";
  annuleParNumero: number | null;
  lignes: { vehiculeId: string }[];
  /** Annulable depuis l'écran : avenant de mouvement, pas encore annulé, sur lequel aucun avenant postérieur ne
   * s'est appuyé (la base refusera aussi un véhicule déjà attesté ou sinistré, avec le motif) */
  annulable?: boolean;
}

async function exigerContratVisible(client: ClientBase, contratId: string): Promise<void> {
  const { rowCount } = await client.query("SELECT 1 FROM app.contrats WHERE id = $1", [contratId]);
  if (!rowCount) throw erreurs.introuvable();
}

/** Avenants des contrats, du plus récent au plus ancien, avec leurs lignes (ou le seul avenant demandé) */
async function lireAvenants(client: ClientBase, contrats: string[], seul?: string): Promise<Avenant[]> {
  const avenants = await client.query<Avenant>(
    `SELECT ${COLONNES_AVENANT}, k.statut = 'en_vigueur' AS "contratEnVigueur"
     FROM app.v_avenants_flotte a JOIN app.utilisateurs u ON u.id = a.cree_par JOIN app.contrats k ON k.id = a.contrat_id
     WHERE a.contrat_id = ANY($1) AND ($2::uuid IS NULL OR a.id = $2) ORDER BY a.numero DESC`,
    [contrats, seul ?? null],
  );
  const lignes = await client.query<{ avenantId: string; vehiculeId: string }>(
    `SELECT l.avenant_id AS "avenantId", l.vehicule_id AS "vehiculeId", v.immatriculation, l.mouvement,
            l.prime_vehicule AS "primeVehicule", l.jours_restants AS "joursRestants", l.jours_periode AS "joursPeriode", l.montant
     FROM app.avenants_flotte_lignes l JOIN app.vehicules v ON v.id = l.vehicule_id
     WHERE l.avenant_id = ANY($1) ORDER BY v.immatriculation`,
    [avenants.rows.map((a) => a.id)],
  );
  const resultat = avenants.rows.map((a) => ({
    ...a,
    lignes: lignes.rows.filter((l) => l.avenantId === a.id).map(({ avenantId: _avenantId, ...l }) => l),
  }));
  if (seul) return resultat.map(({ contratEnVigueur: _c, ...a }: Avenant & { contratEnVigueur?: boolean }) => a);

  // Un avenant s'annule s'il n'a pas déjà été annulé et qu'aucun avenant de mouvement postérieur, non annulé,
  // ne porte sur l'un de ses véhicules
  return resultat.map(({ contratEnVigueur, ...a }: Avenant & { contratEnVigueur?: boolean }) => {
    const vehicules = new Set(a.lignes.map((l) => l.vehiculeId));
    const posterieur = resultat.some((b) => b.contratId === a.contratId && b.numero > a.numero && b.nature === "mouvement"
      && b.annuleParNumero === null && b.lignes.some((l) => vehicules.has(l.vehiculeId)));
    return { ...a, annulable: Boolean(contratEnVigueur) && a.nature === "mouvement" && a.annuleParNumero === null && !posterieur };
  });
}
