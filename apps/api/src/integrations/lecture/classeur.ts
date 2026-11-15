// Liste de véhicules envoyée en classeur Excel (.xlsx) : elle se lit sans modèle, cellule par cellule, avec les
// mêmes règles que l'import des flottes (en-têtes reconnus, dates Excel, immatriculations, doublons). Plus sûr,
// plus rapide et gratuit : le modèle n'est appelé que pour les photos et les PDF.

import { ErreurTableur, lireTableau } from "../../commun/tableur.js";
import { analyserTableau } from "../../modules/flottes/import.js";
import { VEHICULES_LUS_MAX, type ChampsListeVehicules } from "./catalogue/liste-vehicules.js";

export type LectureClasseur = { ok: true; champs: ChampsListeVehicules } | { ok: false };

export function lireClasseurVehicules(contenu: Buffer): LectureClasseur {
  let analyse;
  try {
    analyse = analyserTableau(lireTableau(contenu));
  } catch (erreur) {
    if (erreur instanceof ErreurTableur) return { ok: false };
    throw erreur;
  }
  const vehicules = analyse.lignes.slice(0, VEHICULES_LUS_MAX).map((l) => l.vehicule);
  const premieres = analyse.erreurs.slice(0, 3).map((e) => (e.colonne ? `ligne ${e.ligne}, ${e.colonne} : ${e.message}` : e.message));
  const remarques = analyse.erreurs.length === 0 ? null
    : `${analyse.erreurs.length} erreur(s) dans le fichier (${premieres.join(" ; ")}${analyse.erreurs.length > 3 ? " ; …" : ""}).`;
  const champs: ChampsListeVehicules = {
    documentReconnu: analyse.colonnes.includes("Immatriculation"),
    lisibilite: analyse.erreurs.length === 0 ? "bonne" : "partielle",
    remarques: remarques?.slice(0, 300) ?? null,
    champsIncertains: [],
    proprietaire: null,
    nombreVehiculesDocument: analyse.lignes.length,
    vehicules,
  };
  return { ok: true, champs };
}
