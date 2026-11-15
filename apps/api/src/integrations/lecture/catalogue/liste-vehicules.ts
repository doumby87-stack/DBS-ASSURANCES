// Liste des véhicules d'une flotte (photo, PDF ou classeur Excel) : une ligne par véhicule, avec les mêmes colonnes
// que l'import des flottes (modules/flottes/import.ts), pour que le back-office puisse la passer telle quelle à
// l'aperçu de l'import, qui fait les contrôles complets avant tout enregistrement.

import {
  chaine, chassis, date, dateValide, definir, entier, entierSchema, immatriculation, liste, objet, objets, ouNul, REGEX_VIN, texte,
  type Commun, type Controle,
} from "./outils.js";

/** Lignes lues au plus : au-delà, découper la liste ou envoyer le classeur Excel */
export const VEHICULES_LUS_MAX = 300;

export interface VehiculeLu {
  immatriculation: string | null;
  numeroChassis: string | null;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  usage: string | null;
  puissanceFiscale: number | null;
  valeurVenale: number | null;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
}

export interface ChampsListeVehicules extends Commun {
  proprietaire: string | null;
  /** Nombre de véhicules que compte le document, pour savoir si la lecture est complète */
  nombreVehiculesDocument: number | null;
  vehicules: VehiculeLu[];
}

export function nettoyerVehicule(v: Record<string, unknown>): VehiculeLu {
  return {
    immatriculation: immatriculation(v.immatriculation), numeroChassis: chassis(v.numeroChassis),
    marque: chaine(v.marque, 40), modele: chaine(v.modele, 40), genre: chaine(v.genre, 60), usage: chaine(v.usage, 60),
    puissanceFiscale: entier(v.puissanceFiscale, 1, 99), valeurVenale: entier(v.valeurVenale, 0, 1_000_000_000_000),
    echeanceVisiteTechnique: dateValide(v.echeanceVisiteTechnique), echeanceVignette: dateValide(v.echeanceVignette),
    echeanceCarteTransport: dateValide(v.echeanceCarteTransport),
  };
}

export const listeVehicules = definir<ChampsListeVehicules>({
  libelle: "Liste de véhicules",
  signes: "tableau de plusieurs véhicules (parc, flotte), une ligne par véhicule avec au moins l'immatriculation",
  demande: "Ce document devrait être la liste des véhicules d'une flotte (un tableau, une ligne par véhicule). Recopie chaque ligne, dans l'ordre, sans en sauter.",
  proprietes: {
    proprietaire: ouNul(texte), nombreVehiculesDocument: ouNul(entierSchema),
    vehicules: liste(objet({
      immatriculation: ouNul(texte), numeroChassis: ouNul(texte), marque: ouNul(texte), modele: ouNul(texte), genre: ouNul(texte),
      usage: ouNul(texte), puissanceFiscale: ouNul(entierSchema), valeurVenale: ouNul(entierSchema),
      echeanceVisiteTechnique: ouNul(date), echeanceVignette: ouNul(date), echeanceCarteTransport: ouNul(date),
    }, {
      puissanceFiscale: "puissance fiscale en chevaux (CV)",
      valeurVenale: "valeur du véhicule en F CFA, sans séparateur",
      echeanceVisiteTechnique: "fin de validité de la visite technique",
      echeanceCarteTransport: "fin de validité de la carte de transport",
    })),
  },
  descriptions: {
    proprietaire: "entreprise ou personne à qui appartient le parc, si le document l'indique",
    nombreVehiculesDocument: "nombre de véhicules (lignes) que compte le document en entier",
  },
  nettoyer: (brut) => ({
    proprietaire: chaine(brut.proprietaire, 160),
    nombreVehiculesDocument: entier(brut.nombreVehiculesDocument, 0, 100_000),
    vehicules: objets(brut.vehicules, VEHICULES_LUS_MAX).map(nettoyerVehicule).filter((v) => v.immatriculation || v.numeroChassis),
  }),
  controler: (l) => controlerListe(l),
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    proprietaire: "Transports Exemple Lagunaires", nombreVehiculesDocument: 3,
    vehicules: [
      { immatriculation: "7310 HJ 01", numeroChassis: "JHDFD2JLUXXX10234", marque: "Hino", modele: "FD", genre: "Camion", usage: "Transport de marchandises",
        puissanceFiscale: 18, valeurVenale: 32_000_000, echeanceVisiteTechnique: "2027-03-11", echeanceVignette: "2026-12-31", echeanceCarteTransport: "2027-01-31" },
      { immatriculation: "7311 HJ 01", numeroChassis: null, marque: "Isuzu", modele: "NQR", genre: "Camion", usage: "Transport de marchandises",
        puissanceFiscale: 14, valeurVenale: 21_500_000, echeanceVisiteTechnique: "2026-12-02", echeanceVignette: "2026-12-31", echeanceCarteTransport: null },
      { immatriculation: "2290 GF 01", numeroChassis: null, marque: "Toyota", modele: "Hilux", genre: "Camionnette", usage: "Affaires",
        puissanceFiscale: 11, valeurVenale: 14_000_000, echeanceVisiteTechnique: null, echeanceVignette: "2026-12-31", echeanceCarteTransport: null },
    ],
  },
  sortieLongue: true,
});

/** Contrôles de la liste : lecture complète, lignes en double, numéros à revoir (aussi pour un classeur lu sans modèle) */
export function controlerListe(l: ChampsListeVehicules): Controle[] {
  const controles: Controle[] = [];
  if (l.vehicules.length === 0) {
    controles.push({ champ: "vehicules", niveau: "attention", message: "Aucun véhicule lu : vérifiez que le document est bien une liste de véhicules." });
    return controles;
  }
  if (l.nombreVehiculesDocument !== null && l.nombreVehiculesDocument > l.vehicules.length) {
    controles.push({
      champ: "vehicules", niveau: "attention",
      message: `${l.vehicules.length} véhicule(s) lu(s) sur ${l.nombreVehiculesDocument} : complétez la liste, ou envoyez le classeur Excel.`,
    });
  }
  const vues = new Map<string, number>();
  const doublons = new Set<string>();
  for (const v of l.vehicules) {
    if (!v.immatriculation) continue;
    const cle = v.immatriculation.replace(/[\s-]/g, "");
    if (vues.has(cle)) doublons.add(v.immatriculation);
    vues.set(cle, (vues.get(cle) ?? 0) + 1);
  }
  if (doublons.size > 0) {
    controles.push({ champ: "vehicules", niveau: "attention", message: `Immatriculation(s) en double : ${[...doublons].slice(0, 5).join(", ")}.` });
  }
  const sansImmatriculation = l.vehicules.filter((v) => !v.immatriculation).length;
  if (sansImmatriculation > 0) {
    controles.push({ champ: "vehicules", niveau: "attention", message: `${sansImmatriculation} ligne(s) sans immatriculation : complétez-les avant l'import.` });
  }
  const chassisDouteux = l.vehicules.filter((v) => v.numeroChassis && !REGEX_VIN.test(v.numeroChassis)).length;
  if (chassisDouteux > 0) {
    controles.push({ champ: "vehicules", niveau: "attention", message: `${chassisDouteux} numéro(s) de châssis à revoir (un VIN compte 17 caractères, sans I, O ni Q).` });
  }
  return controles;
}
