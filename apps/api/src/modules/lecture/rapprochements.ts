// Rapprochement des valeurs lues avec les fiches de l'agence (ADR 0018) : ce que la lecture apprend de neuf, ou ce
// qui ne colle pas. Le véhicule est-il déjà connu, et chez quel client ? Est-il déjà assuré par l'agence ? Le
// titulaire de la carte grise est-il le client ? L'attestation d'une autre compagnie arrive-t-elle à échéance ? La
// visite technique lue est-elle plus récente que l'échéance enregistrée ?
//
// Tout se lit sous l'identité de la personne (sécurité au niveau des lignes) : elle ne découvre ainsi aucune fiche
// qu'elle ne pourrait pas déjà ouvrir. Rien n'est modifié ici : une mise à jour est seulement proposée, et la
// personne l'applique elle-même après avoir vérifié le document.

import type { Client } from "../../base-de-donnees/connexion.js";
import { motifRecherche } from "../../commun/formats.js";
import type {
  ChampsAttestation, ChampsCarteGrise, ChampsCarteTransport, ChampsConstat, ChampsListeVehicules, ChampsParDocument,
  ChampsPieceIdentite, ChampsRegistreCommerce, ChampsVisiteTechnique, TypeDocument,
} from "../../integrations/lecture/documents.js";
import { cleImmatriculation } from "../flottes/import.js";

export interface Rapprochement {
  niveau: "info" | "attention";
  message: string;
  /** Fiche à ouvrir */
  lien?: { type: "client" | "contrat"; id: string };
  /** Mise à jour proposée à la personne (jamais appliquée sans elle) */
  proposition?: {
    type: "echeances_vehicule";
    vehiculeId: string;
    clientId: string;
    immatriculation: string;
    valeurs: { echeanceVisiteTechnique?: string; echeanceCarteTransport?: string };
  };
}

export interface Contexte {
  /** Client dont on traite le dossier, quand la lecture part de sa fiche */
  clientId?: string;
  aujourdhui: string;
}

// ---------------------------------------------------------------------------------------------------------
// Noms : « KONÉ Mariam » et « Mariam Kone épouse Traoré » désignent la même personne ; « SARL » ne compte pas
// ---------------------------------------------------------------------------------------------------------
const MOTS_IGNORES = new Set([
  "SARL", "SA", "SAS", "SASU", "SARLU", "SCS", "SNC", "GIE", "SCI", "EI", "ETS", "ETABLISSEMENTS", "STE", "SOCIETE", "CIE",
  "EPOUSE", "EP", "VEUVE", "VVE", "NEE", "M", "MME", "MLLE", "MR", "DE", "DU", "DES", "LA", "LE", "LES", "ET",
]);

export function motsDuNom(nom: string): string[] {
  // L'apostrophe ne sépare pas : « N'Guessan » est un seul mot
  return nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/['’]/g, "").replace(/[^A-Z0-9]+/g, " ").trim().split(" ")
    .filter((mot) => mot.length >= 2 && !MOTS_IGNORES.has(mot));
}

/** Même personne ou même entreprise : tous les mots du nom le plus court se retrouvent dans l'autre */
export function memeNom(a: string, b: string): boolean {
  const [court, long] = [motsDuNom(a), motsDuNom(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  if (court.length === 0) return false;
  const reste = new Set(long);
  return court.every((mot) => reste.has(mot));
}

const dateFr = (iso: string) => iso.split("-").reverse().join("/");
const joursEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------------------------------------------------
// Recherches dans les fiches
// ---------------------------------------------------------------------------------------------------------
interface VehiculeConnu {
  id: string;
  clientId: string;
  client: string;
  immatriculation: string;
  numeroChassis: string | null;
  echeanceVisiteTechnique: string | null;
  echeanceCarteTransport: string | null;
  cle: string;
  contratId: string | null;
  numeroPolice: string | null;
}

async function vehiculesConnus(client: Client, immatriculations: (string | null)[], chassis: (string | null)[] = []): Promise<VehiculeConnu[]> {
  const cles = [...new Set(immatriculations.filter((i): i is string => !!i).map(cleImmatriculation))];
  const vins = [...new Set(chassis.filter((c): c is string => !!c))];
  if (cles.length === 0 && vins.length === 0) return [];
  const { rows } = await client.query<VehiculeConnu>(
    `SELECT v.id, v.client_id AS "clientId", c.nom AS client, v.immatriculation, v.numero_chassis AS "numeroChassis",
            v.echeance_visite_technique AS "echeanceVisiteTechnique", v.echeance_carte_transport AS "echeanceCarteTransport",
            regexp_replace(upper(v.immatriculation), '[[:space:]-]', '', 'g') AS cle,
            k.id AS "contratId", k.numero_police AS "numeroPolice"
     FROM app.vehicules v
     JOIN app.clients c ON c.id = v.client_id
     LEFT JOIN LATERAL (
       SELECT k.id, k.numero_police FROM app.contrats_vehicules cv JOIN app.contrats k ON k.id = cv.contrat_id
       WHERE cv.vehicule_id = v.id AND cv.retire_le IS NULL AND k.statut IN ('en_vigueur', 'en_attente_paiement', 'suspendu')
       ORDER BY k.date_echeance DESC LIMIT 1
     ) k ON true
     WHERE regexp_replace(upper(v.immatriculation), '[[:space:]-]', '', 'g') = ANY($1::text[])
        OR (v.numero_chassis IS NOT NULL AND v.numero_chassis = ANY($2::text[]))
     ORDER BY v.immatriculation
     LIMIT 500`,
    [cles, vins],
  );
  return rows;
}

async function nomDuClient(client: Client, clientId: string): Promise<{ nom: string; rccm: string | null } | null> {
  const { rows } = await client.query<{ nom: string; rccm: string | null }>("SELECT nom, rccm FROM app.clients WHERE id = $1", [clientId]);
  return rows[0] ?? null;
}

/** Clients dont le nom correspond (au plus 3) : recherche large sur le mot le plus long, puis comparaison exacte des mots */
async function clientsDuNom(client: Client, nom: string): Promise<{ id: string; nom: string }[]> {
  const mots = motsDuNom(nom);
  const plusLong = [...mots].sort((a, b) => b.length - a.length)[0];
  if (!plusLong || plusLong.length < 3) return [];
  const { rows } = await client.query<{ id: string; nom: string }>(
    "SELECT id, nom FROM app.clients WHERE nom ILIKE $1 ORDER BY nom LIMIT 50", [motifRecherche(plusLong)],
  );
  return rows.filter((c) => memeNom(c.nom, nom)).slice(0, 3);
}

// ---------------------------------------------------------------------------------------------------------
// Constats réutilisés d'un document à l'autre
// ---------------------------------------------------------------------------------------------------------
/** Le véhicule lu est-il connu ? Chez qui ? Assuré par l'agence ? */
function constatsVehicule(
  connus: VehiculeConnu[], lu: { immatriculation: string | null; numeroChassis?: string | null }, contexte: Contexte,
): Rapprochement[] {
  const cle = lu.immatriculation ? cleImmatriculation(lu.immatriculation) : null;
  const trouves = connus.filter((v) => (cle && v.cle === cle) || (lu.numeroChassis && v.numeroChassis === lu.numeroChassis));
  if (trouves.length === 0) {
    return lu.immatriculation || lu.numeroChassis
      ? [{ niveau: "info", message: "Véhicule inconnu de l'agence : aucune fiche ne porte cette immatriculation ni ce numéro de châssis." }]
      : [];
  }
  const constats: Rapprochement[] = [];
  for (const v of trouves.slice(0, 3)) {
    const chez = contexte.clientId && v.clientId === contexte.clientId ? "sur la fiche de ce client" : `chez ${v.client}`;
    if (cle && v.cle !== cle) {
      constats.push({
        niveau: "attention", lien: { type: "client", id: v.clientId },
        message: `Même numéro de châssis que le véhicule ${v.immatriculation} ${chez} : véhicule réimmatriculé, ou numéro mal lu ?`,
      });
      continue;
    }
    const ailleurs = contexte.clientId !== undefined && v.clientId !== contexte.clientId;
    constats.push({
      niveau: ailleurs ? "attention" : "info", lien: { type: "client", id: v.clientId },
      message: `Véhicule ${v.immatriculation} déjà enregistré ${chez}${ailleurs ? " : vérifiez qu'il a bien changé de propriétaire" : ""}.`,
    });
    if (v.contratId) {
      constats.push({
        niveau: "info", lien: { type: "contrat", id: v.contratId },
        message: `Véhicule ${v.immatriculation} déjà assuré par l'agence (contrat ${v.numeroPolice ?? "sans numéro de police"}).`,
      });
    }
  }
  return constats;
}

/** Le nom lu est-il celui du client du dossier ? Sans dossier : est-ce déjà un client ? */
async function constatsNom(client: Client, nomLu: string | null, quoi: string, contexte: Contexte): Promise<Rapprochement[]> {
  if (!nomLu) return [];
  if (contexte.clientId) {
    const fiche = await nomDuClient(client, contexte.clientId);
    if (!fiche || memeNom(fiche.nom, nomLu)) return [];
    return [{ niveau: "attention", message: `${quoi} (${nomLu}) n'est pas le client du dossier (${fiche.nom}) : vérifiez avant d'enregistrer.` }];
  }
  return (await clientsDuNom(client, nomLu)).map((c) => ({
    niveau: "info" as const, lien: { type: "client" as const, id: c.id }, message: `${quoi} est déjà client de l'agence : ${c.nom}.`,
  }));
}

/** Échéance lue plus récente que celle de la fiche du véhicule : mise à jour proposée */
function constatEcheance(
  connus: VehiculeConnu[], immatriculation: string | null, date: string | null,
  champ: "echeanceVisiteTechnique" | "echeanceCarteTransport", libelle: string,
): Rapprochement[] {
  if (!immatriculation || !date) return [];
  const v = connus.find((c) => c.cle === cleImmatriculation(immatriculation));
  if (!v) return [];
  const enregistree = v[champ];
  if (enregistree === date) return [{ niveau: "info", message: `Échéance de ${libelle} déjà à jour sur la fiche du véhicule (${dateFr(date)}).` }];
  if (enregistree && enregistree > date) {
    return [{ niveau: "info", message: `La fiche du véhicule porte une échéance de ${libelle} plus récente (${dateFr(enregistree)}) que ce document (${dateFr(date)}).` }];
  }
  return [{
    niveau: "info",
    message: `Échéance de ${libelle} à mettre à jour sur la fiche du véhicule ${v.immatriculation} : ${enregistree ? dateFr(enregistree) : "aucune"} → ${dateFr(date)}.`,
    proposition: { type: "echeances_vehicule", vehiculeId: v.id, clientId: v.clientId, immatriculation: v.immatriculation, valeurs: { [champ]: date } },
  }];
}

// ---------------------------------------------------------------------------------------------------------
// Par document
// ---------------------------------------------------------------------------------------------------------
type Rapprocheur<K extends TypeDocument> = (client: Client, champs: ChampsParDocument[K], contexte: Contexte) => Promise<Rapprochement[]>;

const carteGrise: Rapprocheur<"carte_grise"> = async (client, c: ChampsCarteGrise, contexte) => [
  ...constatsVehicule(await vehiculesConnus(client, [c.immatriculation], [c.numeroChassis]), c, contexte),
  ...await constatsNom(client, c.proprietaire, "Le titulaire de la carte grise", contexte),
];

const pieceIdentite: Rapprocheur<"piece_identite"> = async (client, p: ChampsPieceIdentite, contexte) => {
  const nom = [p.nom, p.prenoms].filter(Boolean).join(" ") || null;
  const constats = await constatsNom(client, nom, "La personne de la pièce", contexte);
  if (!contexte.clientId) return constats;
  const { rows: [fiche] } = await client.query<{ fin: string | null; naissance: string | null }>(
    `SELECT numero_piece_fin AS fin, date_naissance AS naissance FROM app.identifications_clients WHERE client_id = $1`, [contexte.clientId],
  );
  const numero = p.numero?.replace(/[\s-]/g, "").toUpperCase();
  if (fiche?.fin && numero && !numero.endsWith(fiche.fin)) {
    constats.push({ niveau: "attention", message: `La pièce enregistrée pour ce client se termine par ${fiche.fin} : celle-ci est une autre pièce (renouvelée ?).` });
  }
  if (fiche?.naissance && p.dateNaissance && fiche.naissance !== p.dateNaissance) {
    constats.push({ niveau: "attention", message: `Date de naissance différente de celle de la fiche (${dateFr(fiche.naissance)}) : vérifiez.` });
  }
  return constats;
};

const constat: Rapprocheur<"constat_amiable"> = async (client, k: ChampsConstat) => {
  const connus = await vehiculesConnus(client, k.vehicules.map((v) => v.immatriculation));
  const polices = k.vehicules.map((v) => v.numeroPolice?.replace(/\s/g, "").toUpperCase()).filter((p): p is string => !!p);
  const { rows: contrats } = polices.length === 0 ? { rows: [] } : await client.query<{ id: string; police: string; client: string }>(
    `SELECT k.id, upper(regexp_replace(k.numero_police, '[[:space:]]', '', 'g')) AS police, c.nom AS client
     FROM app.contrats k JOIN app.clients c ON c.id = k.client_id
     WHERE upper(regexp_replace(k.numero_police, '[[:space:]]', '', 'g')) = ANY($1::text[])`,
    [polices],
  );
  const constats: Rapprochement[] = [];
  for (const v of k.vehicules) {
    const connu = v.immatriculation ? connus.find((c) => c.cle === cleImmatriculation(v.immatriculation!)) : undefined;
    const contrat = v.numeroPolice ? contrats.find((c) => c.police === v.numeroPolice!.replace(/\s/g, "").toUpperCase()) : undefined;
    if (connu?.contratId) {
      constats.push({
        niveau: "info", lien: { type: "contrat", id: connu.contratId },
        message: `Véhicule ${v.lettre} (${connu.immatriculation}) assuré par l'agence : contrat ${connu.numeroPolice ?? "sans numéro"}, client ${connu.client}.`,
      });
    } else if (contrat) {
      constats.push({
        niveau: "info", lien: { type: "contrat", id: contrat.id },
        message: `Véhicule ${v.lettre} : le numéro de police lu est celui d'un contrat de l'agence (client ${contrat.client}).`,
      });
    } else if (connu) {
      constats.push({
        niveau: "attention", lien: { type: "client", id: connu.clientId },
        message: `Véhicule ${v.lettre} (${connu.immatriculation}) connu de l'agence (client ${connu.client}), mais sans contrat en cours.`,
      });
    }
  }
  if (constats.length === 0 && k.vehicules.length > 0) {
    constats.push({ niveau: "info", message: "Aucun des véhicules n'est assuré par l'agence (d'après l'immatriculation et le numéro de police lus)." });
  }
  return constats;
};

const attestation: Rapprocheur<"attestation_assurance"> = async (client, a: ChampsAttestation, contexte) => {
  const constats: Rapprochement[] = [];
  const police = a.numeroPolice?.replace(/\s/g, "").toUpperCase();
  const { rows: [contrat] } = police ? await client.query<{ id: string; echeance: string; client: string }>(
    `SELECT k.id, k.date_echeance AS echeance, c.nom AS client FROM app.contrats k JOIN app.clients c ON c.id = k.client_id
     WHERE upper(regexp_replace(k.numero_police, '[[:space:]]', '', 'g')) = $1`,
    [police],
  ) : { rows: [] };
  if (contrat) {
    constats.push({ niveau: "info", lien: { type: "contrat", id: contrat.id }, message: `Contrat de l'agence (client ${contrat.client}).` });
    if (a.dateEcheance && a.dateEcheance !== contrat.echeance) {
      constats.push({
        niveau: "attention", lien: { type: "contrat", id: contrat.id },
        message: `L'échéance lue (${dateFr(a.dateEcheance)}) n'est pas celle du contrat enregistré (${dateFr(contrat.echeance)}) : vérifiez.`,
      });
    }
  } else if (a.dateEcheance && a.dateEcheance >= contexte.aujourdhui) {
    // Contrat d'une autre compagnie : c'est l'échéance qui dit quand proposer un devis
    const jours = joursEntre(contexte.aujourdhui, a.dateEcheance);
    constats.push({
      niveau: jours <= 60 ? "attention" : "info",
      message: `Contrat ${a.assureur ? `chez ${a.assureur} ` : ""}à échéance le ${dateFr(a.dateEcheance)} (dans ${jours} jour${jours > 1 ? "s" : ""}) : proposez un devis avant cette date${a.primeTtc ? ` ; prime actuelle : ${a.primeTtc.toLocaleString("fr-FR")} F CFA` : ""}.`,
    });
  }
  if (a.immatriculation || a.numeroChassis) {
    constats.push(...constatsVehicule(await vehiculesConnus(client, [a.immatriculation], [a.numeroChassis]), a, contexte));
  }
  constats.push(...await constatsNom(client, a.souscripteur, "L'assuré de l'attestation", contexte));
  return constats;
};

const registre: Rapprocheur<"registre_commerce"> = async (client, r: ChampsRegistreCommerce, contexte) => {
  const constats: Rapprochement[] = [];
  const rccm = r.numeroRccm?.replace(/\s/g, "").toUpperCase();
  if (contexte.clientId) {
    const fiche = await nomDuClient(client, contexte.clientId);
    const rccmFiche = fiche?.rccm?.replace(/\s/g, "").toUpperCase();
    if (rccm && rccmFiche && rccm !== rccmFiche) {
      constats.push({ niveau: "attention", message: `Le RCCM de la fiche (${fiche!.rccm}) n'est pas celui du document : vérifiez.` });
    } else if (rccm && !rccmFiche) {
      constats.push({ niveau: "info", message: "Le numéro RCCM n'est pas encore sur la fiche du client : reportez-le." });
    }
    return [...constats, ...await constatsNom(client, r.raisonSociale, "L'entreprise du document", contexte)];
  }
  if (rccm) {
    const { rows } = await client.query<{ id: string; nom: string }>(
      `SELECT id, nom FROM app.clients WHERE upper(regexp_replace(rccm, '[[:space:]]', '', 'g')) = $1 LIMIT 3`, [rccm],
    );
    for (const c of rows) constats.push({ niveau: "info", lien: { type: "client", id: c.id }, message: `Entreprise déjà cliente (même RCCM) : ${c.nom}.` });
    if (rows.length > 0) return constats;
  }
  return [...constats, ...await constatsNom(client, r.raisonSociale, "L'entreprise du document", contexte)];
};

const carteTransport: Rapprocheur<"carte_transport"> = async (client, c: ChampsCarteTransport, contexte) => {
  const connus = await vehiculesConnus(client, [c.immatriculation]);
  return [
    ...constatsVehicule(connus, c, contexte),
    ...constatEcheance(connus, c.immatriculation, c.dateExpiration, "echeanceCarteTransport", "la carte de transport"),
    ...await constatsNom(client, c.titulaire, "Le titulaire de la carte de transport", contexte),
  ];
};

const visiteTechnique: Rapprocheur<"visite_technique"> = async (client, v: ChampsVisiteTechnique, contexte) => {
  const connus = await vehiculesConnus(client, [v.immatriculation], [v.numeroChassis]);
  return [
    ...constatsVehicule(connus, v, contexte),
    // Visite refusée : rien à reporter comme échéance
    ...(v.resultat === "defavorable" || v.resultat === "contre_visite" ? []
      : constatEcheance(connus, v.immatriculation, v.dateValidite, "echeanceVisiteTechnique", "la visite technique")),
  ];
};

const liste: Rapprocheur<"liste_vehicules"> = async (client, l: ChampsListeVehicules, contexte) => {
  const connus = await vehiculesConnus(client, l.vehicules.map((v) => v.immatriculation));
  const constats: Rapprochement[] = [];
  const parCle = new Map(connus.map((v) => [v.cle, v]));
  const lus = l.vehicules.filter((v) => v.immatriculation).map((v) => parCle.get(cleImmatriculation(v.immatriculation!)));
  const nouveaux = lus.filter((v) => !v).length;
  const ici = lus.filter((v) => v && v.clientId === contexte.clientId).length;
  const ailleurs = lus.filter((v): v is VehiculeConnu => !!v && v.clientId !== contexte.clientId);
  if (nouveaux > 0) constats.push({ niveau: "info", message: `${nouveaux} véhicule(s) inconnu(s) de l'agence.` });
  if (ici > 0) constats.push({ niveau: "info", message: `${ici} véhicule(s) déjà sur la fiche de ce client.` });
  if (ailleurs.length > 0) {
    const exemples = ailleurs.slice(0, 3).map((v) => `${v.immatriculation} (${v.client})`).join(", ");
    constats.push({
      niveau: contexte.clientId ? "attention" : "info",
      message: `${ailleurs.length} véhicule(s) déjà enregistré(s) ${contexte.clientId ? "chez un autre client" : "à l'agence"} : ${exemples}${ailleurs.length > 3 ? "…" : ""}.`,
    });
  }
  const assures = lus.filter((v) => v?.contratId).length;
  if (assures > 0) constats.push({ niveau: "info", message: `${assures} véhicule(s) déjà assuré(s) par l'agence.` });
  constats.push(...await constatsNom(client, l.proprietaire, "Le propriétaire du parc", contexte));
  return constats;
};

const RAPPROCHEURS: { [K in TypeDocument]: Rapprocheur<K> } = {
  carte_grise: carteGrise,
  piece_identite: pieceIdentite,
  constat_amiable: constat,
  attestation_assurance: attestation,
  registre_commerce: registre,
  carte_transport: carteTransport,
  visite_technique: visiteTechnique,
  liste_vehicules: liste,
};

export async function rapprocher<K extends TypeDocument>(
  client: Client, document: K, champs: ChampsParDocument[K], contexte: Contexte,
): Promise<Rapprochement[]> {
  // Un document qui n'est pas celui attendu n'est pas rapproché : ses valeurs n'ont pas de sens
  if (!champs.documentReconnu) return [];
  return (RAPPROCHEURS[document] as Rapprocheur<K>)(client, champs, contexte);
}
