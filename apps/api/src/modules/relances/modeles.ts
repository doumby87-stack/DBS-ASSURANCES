// Textes des relances. Sur WhatsApp, une entreprise ne peut écrire en premier qu'avec un modèle validé
// par Meta : les textes ci-dessous sont, mot pour mot, ceux à faire valider
// (docs/metier/modeles-de-messages.md ; un test vérifie que les deux restent identiques).
// Le SMS reprend le même texte, suivi de la façon de se désinscrire.

import { AGENCE } from "../../commun/agence.js";
import type { ModeleWhatsApp } from "../../integrations/whatsapp/whatsapp.js";

export const TYPES_RELANCE = [
  "echeance_j30", "echeance_j15", "echeance_j7", "echeance_jour", "contrat_expire", "devis_sans_reponse", "sinistre_avancement",
] as const;
export type TypeRelance = (typeof TYPES_RELANCE)[number];

/** Ce que la base fournit pour rédiger le message (app.v_relances_dues). */
export interface ParametresRelance {
  nom?: string;
  branche?: string;
  numeroPolice?: string | null;
  dateEcheance?: string;
  statut?: string;
  survenuLe?: string;
}

const TELEPHONE_AGENCE = AGENCE.telephone.replace(/^\+225\s*/, "");

/** Corps des modèles WhatsApp : {{1}}, {{2}}… sont remplacés par les paramètres, dans l'ordre. */
export const MODELES = {
  dbs_echeance_contrat:
    "Bonjour {{1}}, votre assurance {{2}} arrive à échéance le {{3}}. Pour la renouveler sans interruption de garantie, "
    + `répondez à ce message ou appelez DBS-ASSURANCES au ${TELEPHONE_AGENCE}.`,
  dbs_contrat_expire:
    "Bonjour {{1}}, votre assurance {{2}} a expiré le {{3}} : vous n'êtes plus couvert. "
    + `Pour la renouveler, répondez à ce message ou appelez DBS-ASSURANCES au ${TELEPHONE_AGENCE}.`,
  dbs_devis_sans_reponse:
    "Bonjour {{1}}, avez-vous pu étudier notre devis d'assurance {{2}} ? Nous restons à votre disposition : "
    + `répondez à ce message ou appelez DBS-ASSURANCES au ${TELEPHONE_AGENCE}.`,
  dbs_sinistre_avancement:
    "Bonjour {{1}}, votre sinistre du {{2}} (assurance {{3}}) : {{4}}. Pour toute question, "
    + `répondez à ce message ou appelez DBS-ASSURANCES au ${TELEPHONE_AGENCE}.`,
} as const;
export type NomModele = keyof typeof MODELES;

/** Pied de page des modèles WhatsApp (texte fixe, validé avec le modèle). */
export const PIED_WHATSAPP = "Répondez STOP pour ne plus recevoir ces messages.";
/** Fin des SMS : l'opérateur n'est pas encore choisi, la désinscription passe par l'agence. */
export const PIED_SMS = `Ne plus recevoir ces SMS : ${TELEPHONE_AGENCE}.`;

const MODELE_PAR_TYPE: Record<TypeRelance, NomModele> = {
  echeance_j30: "dbs_echeance_contrat",
  echeance_j15: "dbs_echeance_contrat",
  echeance_j7: "dbs_echeance_contrat",
  echeance_jour: "dbs_echeance_contrat",
  contrat_expire: "dbs_contrat_expire",
  devis_sans_reponse: "dbs_devis_sans_reponse",
  sinistre_avancement: "dbs_sinistre_avancement",
};

/** Branches telles qu'on les écrit dans une phrase : « votre assurance multirisque habitation ». */
const BRANCHES: Record<string, string> = {
  automobile: "automobile",
  deux_roues: "deux-roues",
  flotte: "flotte",
  habitation: "multirisque habitation",
  multirisque_professionnelle: "multirisque professionnelle",
  incendie_risques_divers: "incendie et risques divers",
  responsabilite_civile: "responsabilité civile",
  individuelle_accident: "individuelle accident",
  transport_marchandises: "transport de marchandises",
  chantier_construction: "chantier et construction",
  industrie_bris_de_machines: "industrie et bris de machines",
  agricole: "agricole",
  evenementiel: "événementiel",
  autre: "sur mesure",
};

/** Où en est le sinistre, dit au client. */
const ETAPES_SINISTRE: Record<string, string> = {
  declare: "votre déclaration est bien enregistrée",
  transmis_compagnie: "votre dossier a été transmis à SanlamAllianz",
  expertise: "l'expertise est en cours",
  offre_recue: "la compagnie a fait une offre d'indemnisation, contactez-nous pour en parler",
  regle: "votre dossier est réglé",
  refuse: "la compagnie a refusé la prise en charge, contactez-nous pour en connaître les raisons",
  classe_sans_suite: "votre dossier est classé sans suite",
};

export class ErreurRedaction extends Error {
  constructor(manque: string) {
    super(`Relance impossible à rédiger : ${manque} manquant`);
    this.name = "ErreurRedaction";
  }
}

function exiger(valeur: string | null | undefined, nom: string): string {
  if (typeof valeur !== "string" || valeur.trim() === "") throw new ErreurRedaction(nom);
  return valeur;
}

/** « 2026-11-29 » → « 29/11/2026 » */
function date(valeur: string | undefined, nom: string): string {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exiger(valeur, nom));
  if (!correspondance) throw new ErreurRedaction(nom);
  return `${correspondance[3]}/${correspondance[2]}/${correspondance[1]}`;
}

function assurance(p: ParametresRelance): string {
  const branche = BRANCHES[exiger(p.branche, "branche")] ?? "sur mesure";
  return p.numeroPolice ? `${branche} (police ${p.numeroPolice})` : branche;
}

function parametresDe(type: TypeRelance, p: ParametresRelance): string[] {
  const nom = exiger(p.nom, "nom");
  switch (type) {
    case "devis_sans_reponse":
      return [nom, BRANCHES[exiger(p.branche, "branche")] ?? "sur mesure"];
    case "sinistre_avancement":
      return [nom, date(p.survenuLe, "date du sinistre"), assurance(p), ETAPES_SINISTRE[exiger(p.statut, "statut")] ?? "votre dossier avance"];
    default:
      return [nom, assurance(p), date(p.dateEcheance, "date d'échéance")];
  }
}

function remplir(modele: string, parametres: string[]): string {
  return modele.replace(/\{\{(\d)\}\}/g, (_tout, rang: string) => parametres[Number(rang) - 1] ?? "");
}

export interface Redaction {
  whatsapp: ModeleWhatsApp;
  /** Texte tel que le client le lit (corps du modèle rempli), sans pied de page. */
  texte: string;
  sms: string;
}

export function rediger(type: TypeRelance, parametres: ParametresRelance): Redaction {
  const nom = MODELE_PAR_TYPE[type];
  const valeurs = parametresDe(type, parametres).map((v) => v.replace(/\s+/g, " ").trim());
  const texte = remplir(MODELES[nom], valeurs);
  return { whatsapp: { nom, parametres: valeurs }, texte, sms: `${texte} ${PIED_SMS}` };
}

/** Texte tel que le client le lit (ou le lirait), pour l'écran et pour une relance faite à la main. */
export function texteRelance(type: TypeRelance, parametres: ParametresRelance): string | null {
  try {
    return rediger(type, parametres).texte;
  } catch {
    return null;
  }
}
