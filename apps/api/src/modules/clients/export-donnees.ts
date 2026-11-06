// Droit d'accès (loi ivoirienne n° 2013-450, tâche 12) : toutes les données que l'agence tient sur un client,
// en un fichier, pour répondre à sa demande. Réservé au gérant ; chaque export est consigné. La demande elle-même
// se trace dans le registre des réclamations (objet « Données personnelles »).
// Les contenus chiffrés (pièces, n° d'identité) ne sont pas recopiés : la fin du n° les identifie, et les pièces
// se remettent sur demande, depuis la fiche.

import type { FastifyInstance } from "fastify";
import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { erreurs } from "../../commun/erreurs.js";
import { parametreId } from "../../commun/schemas.js";
import { nomDeFichier } from "../../commun/zip.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { consignerEvenement } from "../../securite/limitation.js";

// Chaque rubrique : une requête qui rend un tableau JSON pour le client $1
const RUBRIQUES: Record<string, string> = {
  vehicules: "SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.immatriculation), '[]') FROM app.vehicules v WHERE v.client_id = $1",
  contrats: "SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.date_effet), '[]') FROM app.contrats k WHERE k.client_id = $1",
  vehiculesAssures: `SELECT coalesce(jsonb_agg(to_jsonb(cv) ORDER BY cv.ajoute_le), '[]') FROM app.contrats_vehicules cv
                     JOIN app.contrats k ON k.id = cv.contrat_id WHERE k.client_id = $1`,
  encaissements: `SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.encaisse_le), '[]') FROM app.encaissements e
                  JOIN app.contrats k ON k.id = e.contrat_id WHERE k.client_id = $1`,
  sinistres: `SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.survenu_le), '[]') FROM app.sinistres s
              JOIN app.contrats k ON k.id = s.contrat_id WHERE k.client_id = $1`,
  devis: "SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.cree_le), '[]') FROM app.devis d WHERE d.client_id = $1",
  echanges: "SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.cree_le), '[]') FROM app.echanges x WHERE x.client_id = $1",
  consentements: "SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.enregistre_le), '[]') FROM app.consentements x WHERE x.client_id = $1",
  relances: "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.planifiee_le), '[]') FROM app.relances r WHERE r.client_id = $1",
  reclamations: "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.recue_le), '[]') FROM app.reclamations r WHERE r.client_id = $1",
  identification: `SELECT coalesce(jsonb_agg(to_jsonb(f) - 'numero_piece_chiffre'), '[]') FROM app.identifications_clients f
                   WHERE f.client_id = $1`,
  dirigeantsEtBeneficiaires: "SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.cree_le), '[]') FROM app.dirigeants_beneficiaires d WHERE d.client_id = $1",
  justificatifs: `SELECT coalesce(jsonb_agg(to_jsonb(j) - 'contenu_chiffre' - 'empreinte' ORDER BY j.depose_le), '[]')
                  FROM app.justificatifs_identification j WHERE j.client_id = $1`,
  accesEspaceClient: `SELECT coalesce(jsonb_agg(jsonb_build_object('nom', g.nom, 'telephone', g.telephone, 'role', g.role, 'actif', g.actif,
                        'cree_le', g.cree_le, 'derniere_connexion_le', g.derniere_connexion_le) ORDER BY g.cree_le), '[]')
                      FROM app.gestionnaires_portail g WHERE g.client_id = $1`,
  paiementsEnLigne: `SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.cree_le), '[]') FROM app.paiements_en_ligne p
                     JOIN app.contrats k ON k.id = p.contrat_id WHERE k.client_id = $1`,
};

export async function routesExportDonnees(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;

  app.get<{ Params: { id: string } }>(
    "/clients/:id/donnees.json",
    { preHandler: gardes.roles("gerant"), schema: { params: parametreId } },
    async (requete, reponse) => {
      const moi = utilisateurDe(requete);
      const { nom, donnees } = await transactionUtilisateur(pool, moi.id, async (client) => {
        const { rows } = await client.query<{ fiche: Record<string, unknown>; nom: string }>(
          "SELECT to_jsonb(c) - 'piece_identite_chiffree' AS fiche, c.nom FROM app.clients c WHERE c.id = $1",
          [requete.params.id],
        );
        if (!rows[0]) throw erreurs.introuvable();
        const rubriques: Record<string, unknown> = {};
        for (const [rubrique, sql] of Object.entries(RUBRIQUES)) {
          rubriques[rubrique] = (await client.query<{ donnees: unknown }>(`SELECT (${sql}) AS donnees`, [requete.params.id])).rows[0]?.donnees ?? [];
        }
        await consignerEvenement(client, "export_donnees", { utilisateurId: moi.id, ip: requete.ip, objet: `Données personnelles de ${rows[0].nom}` });
        return {
          nom: rows[0].nom,
          donnees: { exporteLe: new Date().toISOString(), responsable: "DBS-ASSURANCES", client: rows[0].fiche, ...rubriques },
        };
      });
      return reponse
        .type("application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="donnees-${nomDeFichier(nom).toLowerCase()}.json"`)
        .send(JSON.stringify(donnees, null, 2));
    },
  );
}
