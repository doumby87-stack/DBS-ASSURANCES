// Reversements à la compagnie : primes à reverser avec le compte à rebours des 30 jours (Code CIMA, art. 542),
// bordereaux préparés par la caisse, validés par une autre personne, versés, figés ; export pour la compagnie.

import type { FastifyInstance } from "fastify";
import type { Client, Pool } from "../../base-de-donnees/connexion.js";
import { transactionUtilisateur } from "../../base-de-donnees/connexion.js";
import { AGENCE } from "../../commun/agence.js";
import { documentCsv } from "../../commun/csv.js";
import { ErreurApi, erreurs } from "../../commun/erreurs.js";
import { date, parametreId, texteCourt } from "../../commun/schemas.js";
import type { Gardes } from "../../securite/gardes.js";
import { utilisateurDe } from "../../securite/gardes.js";
import { totauxParMode, type Mode } from "../encaissements/routes.js";

/** Alerte quand il reste 5 jours ou moins (soit J+25 après l'encaissement). */
export const SEUIL_ALERTE_JOURS = 5;

const LIBELLES_MODE: Record<Mode, string> = {
  especes: "Espèces", cheque: "Chèque", mobile_money: "Mobile Money", virement: "Virement",
};

function aujourdHuiAbidjan(): string {
  // Abidjan vit à l'heure UTC toute l'année
  return new Date().toISOString().slice(0, 10);
}

const COLONNES_BORDEREAU = `r.id, r.numero_bordereau AS "numero", r.periode_debut AS "periodeDebut", r.periode_fin AS "periodeFin",
  r.prepare_le AS "prepareLe", r.prepare_par AS "prepareParId", p.nom AS "preparePar",
  r.valide_le AS "valideLe", v.nom AS "validePar", r.verse_le AS "verseLe", r.reference_virement AS "referenceVirement",
  r.annule_le AS "annuleLe", a.nom AS "annulePar", r.motif_annulation AS "motifAnnulation",
  CASE WHEN r.annule_le IS NOT NULL THEN 'annule' WHEN r.verse_le IS NOT NULL THEN 'verse'
       WHEN r.valide_le IS NOT NULL THEN 'valide' ELSE 'prepare' END AS statut,
  (SELECT count(*) FROM app.encaissements e WHERE e.reversement_id = r.id)::integer AS "nombre",
  (SELECT coalesce(sum(e.montant), 0) FROM app.encaissements e WHERE e.reversement_id = r.id)::bigint AS "total"`;
const JOINTURES_BORDEREAU = `FROM app.reversements r
  JOIN app.utilisateurs p ON p.id = r.prepare_par
  LEFT JOIN app.utilisateurs v ON v.id = r.valide_par
  LEFT JOIN app.utilisateurs a ON a.id = r.annule_par`;

interface LigneBordereau {
  numeroRecu: number;
  encaisseLe: Date;
  clientNom: string;
  numeroPolice: string | null;
  branche: string;
  mode: Mode;
  reference: string | null;
  montant: number;
}

async function lireBordereau(client: Client, id: string) {
  const { rows } = await client.query<{ numero: string; periodeDebut: string; periodeFin: string; prepareParId: string }>(
    `SELECT ${COLONNES_BORDEREAU} ${JOINTURES_BORDEREAU} WHERE r.id = $1`,
    [id],
  );
  const bordereau = rows[0];
  if (!bordereau) throw erreurs.introuvable();
  const lignes = await client.query<LigneBordereau>(
    `SELECT e.id, e.numero_recu AS "numeroRecu", e.encaisse_le AS "encaisseLe", c.nom AS "clientNom",
            k.numero_police AS "numeroPolice", k.branche, e.mode, e.reference_externe AS "reference", e.montant
     FROM app.encaissements e
     JOIN app.contrats k ON k.id = e.contrat_id
     JOIN app.clients c ON c.id = k.client_id
     WHERE e.reversement_id = $1
     ORDER BY e.numero_recu`,
    [id],
  );
  return { bordereau, lignes: lignes.rows, totaux: totauxParMode(lignes.rows) };
}

export async function routesReversements(app: FastifyInstance, options: { pool: Pool; gardes: Gardes }): Promise<void> {
  const { pool, gardes } = options;
  const lecteurs = gardes.roles("gerant", "caissier", "auditeur");

  // Primes pas encore versées à la compagnie, de la plus urgente à la moins urgente
  app.get("/reversements/a-reverser", { preHandler: lecteurs }, async (requete) => {
    const lignes = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const { rows } = await client.query<{ montant: number; mode: Mode; joursRestants: number; enRetard: boolean; reversementId: string | null; dateLimite: string }>(
        `SELECT v.encaissement_id AS id, v.numero_recu AS "numeroRecu", v.montant, v.mode, v.encaisse_le AS "encaisseLe",
                v.date_limite AS "dateLimite", v.jours_restants AS "joursRestants", v.en_retard AS "enRetard",
                v.reversement_id AS "reversementId", v.numero_bordereau AS "numeroBordereau",
                c.nom AS "clientNom", k.numero_police AS "numeroPolice", k.branche
         FROM app.v_encaissements_a_reverser v
         JOIN app.contrats k ON k.id = v.contrat_id
         JOIN app.clients c ON c.id = k.client_id
         ORDER BY v.date_limite, v.numero_recu`,
      );
      return rows;
    });
    const nonRattaches = lignes.filter((l) => !l.reversementId);
    const plusUrgente = lignes[0];
    return {
      resume: {
        total: lignes.reduce((s, l) => s + l.montant, 0),
        nombre: lignes.length,
        totalNonRattache: nonRattaches.reduce((s, l) => s + l.montant, 0),
        nombreNonRattache: nonRattaches.length,
        prochaineDateLimite: plusUrgente?.dateLimite ?? null,
        joursRestants: plusUrgente?.joursRestants ?? null,
        enRetard: lignes.filter((l) => l.enRetard).length,
        alerte: plusUrgente ? plusUrgente.joursRestants <= SEUIL_ALERTE_JOURS : false,
      },
      encaissements: lignes,
    };
  });

  // Préparation : un bordereau reprend tous les encaissements pas encore rattachés, jusqu'à la date choisie
  app.post<{ Body: { jusquAu: string } }>(
    "/reversements",
    {
      preHandler: gardes.roles("gerant", "caissier"),
      schema: {
        body: { type: "object", required: ["jusquAu"], additionalProperties: false, properties: { jusquAu: date } },
      },
    },
    async (requete, reponse) => {
      const { jusquAu } = requete.body;
      if (jusquAu > aujourdHuiAbidjan()) throw new ErreurApi(422, "date_future", "Choisissez une date qui n'est pas dans le futur.");
      const resultat = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        // Une préparation à la fois : deux bordereaux ne se disputent jamais les mêmes encaissements
        await client.query("SELECT pg_advisory_xact_lock(hashtext('app.preparation_bordereau'))");
        const { rows } = await client.query<{ debut: string | null; nombre: number }>(
          `SELECT min((e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date) AS debut, count(*)::integer AS nombre
           FROM app.encaissements e
           WHERE e.reversement_id IS NULL AND (e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date <= $1`,
          [jusquAu],
        );
        const { debut, nombre } = rows[0]!;
        if (!debut || nombre === 0) throw new ErreurApi(422, "rien_a_reverser", "Aucun encaissement à reverser jusqu'à cette date.");
        const insertion = await client.query<{ id: string }>(
          "INSERT INTO app.reversements (periode_debut, periode_fin) VALUES ($1, $2) RETURNING id",
          [debut, jusquAu],
        );
        const id = insertion.rows[0]!.id;
        await client.query(
          `UPDATE app.encaissements SET reversement_id = $1
           WHERE reversement_id IS NULL AND (encaisse_le AT TIME ZONE 'Africa/Abidjan')::date <= $2`,
          [id, jusquAu],
        );
        return lireBordereau(client, id);
      });
      return reponse.status(201).send(resultat);
    },
  );

  app.get("/reversements", { preHandler: lecteurs }, async (requete) => {
    const bordereaux = await transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
      const { rows } = await client.query(`SELECT ${COLONNES_BORDEREAU} ${JOINTURES_BORDEREAU} ORDER BY r.prepare_le DESC LIMIT 100`);
      return rows;
    });
    return { bordereaux };
  });

  app.get<{ Params: { id: string } }>(
    "/reversements/:id",
    { preHandler: lecteurs, schema: { params: parametreId } },
    async (requete) =>
      transactionUtilisateur(pool, utilisateurDe(requete).id, (client) => lireBordereau(client, requete.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    "/reversements/:id/validation",
    { preHandler: gardes.roles("gerant"), schema: { params: parametreId } },
    async (requete) => {
      const moi = utilisateurDe(requete).id;
      return transactionUtilisateur(pool, moi, async (client) => {
        const { bordereau } = await lireBordereau(client, requete.params.id);
        if (bordereau.prepareParId === moi) {
          throw new ErreurApi(
            403, "quatre_yeux",
            "Principe des quatre yeux : une autre personne que celle qui a préparé le bordereau doit le valider.",
          );
        }
        await client.query("UPDATE app.reversements SET valide_le = now() WHERE id = $1", [requete.params.id]);
        return lireBordereau(client, requete.params.id);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { verseLe: string; referenceVirement: string } }>(
    "/reversements/:id/versement",
    {
      preHandler: gardes.roles("gerant"),
      schema: {
        params: parametreId,
        body: {
          type: "object",
          required: ["verseLe", "referenceVirement"],
          additionalProperties: false,
          properties: { verseLe: date, referenceVirement: texteCourt(60, 3) },
        },
      },
    },
    async (requete) => {
      const { verseLe } = requete.body;
      const referenceVirement = requete.body.referenceVirement.trim();
      if (verseLe > aujourdHuiAbidjan()) throw new ErreurApi(422, "date_future", "La date du versement ne peut pas être dans le futur.");
      if (referenceVirement.length < 3) throw new ErreurApi(422, "reference_obligatoire", "Indiquez la référence du virement.");
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await lireBordereau(client, requete.params.id);
        await client.query("UPDATE app.reversements SET verse_le = $2, reference_virement = $3 WHERE id = $1", [
          requete.params.id, verseLe, referenceVirement,
        ]);
        return lireBordereau(client, requete.params.id);
      });
    },
  );

  // Annulation d'un bordereau pas encore validé : ses encaissements redeviennent à reverser
  app.post<{ Params: { id: string }; Body: { motif: string } }>(
    "/reversements/:id/annulation",
    {
      preHandler: gardes.roles("gerant", "caissier"),
      schema: {
        params: parametreId,
        body: { type: "object", required: ["motif"], additionalProperties: false, properties: { motif: texteCourt(500, 5) } },
      },
    },
    async (requete) => {
      const motif = requete.body.motif.trim();
      if (motif.length < 5) throw new ErreurApi(422, "motif_obligatoire", "Expliquez en quelques mots pourquoi le bordereau est annulé.");
      return transactionUtilisateur(pool, utilisateurDe(requete).id, async (client) => {
        await lireBordereau(client, requete.params.id);
        await client.query("SELECT app.annuler_bordereau($1, $2)", [requete.params.id, motif]);
        return lireBordereau(client, requete.params.id);
      });
    },
  );

  // Export pour la compagnie (Excel en français). Le format définitif suivra celui de SanlamAllianz.
  app.get<{ Params: { id: string } }>(
    "/reversements/:id/export.csv",
    { preHandler: lecteurs, schema: { params: parametreId } },
    async (requete, reponse) => {
      const { bordereau, lignes, totaux } = await transactionUtilisateur(pool, utilisateurDe(requete).id, (client) =>
        lireBordereau(client, requete.params.id),
      );
      const csv = documentCsv([
        [`Bordereau de reversement ${bordereau.numero}`],
        [`${AGENCE.nom} — ${AGENCE.qualite} — code agence ${AGENCE.codeAgence}`],
        [`Période du ${bordereau.periodeDebut} au ${bordereau.periodeFin}`],
        [],
        ["N° de reçu", "Date", "Client", "N° de police", "Branche", "Mode", "Référence", "Montant (F CFA)"],
        ...lignes.map((l) => [
          l.numeroRecu, l.encaisseLe.toISOString().slice(0, 10), l.clientNom, l.numeroPolice, l.branche, LIBELLES_MODE[l.mode], l.reference, l.montant,
        ]),
        [],
        ["Total", null, null, null, null, null, `${totaux.nombre} encaissement(s)`, totaux.total],
      ]);
      return reponse
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="bordereau-${bordereau.numero.replace(/[^A-Za-z0-9-]/g, "")}.csv"`)
        .send(csv);
    },
  );
}
