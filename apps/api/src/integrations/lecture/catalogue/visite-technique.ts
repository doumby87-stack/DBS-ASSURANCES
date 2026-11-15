// Certificat (ou vignette) de visite technique : sa date de fin de validité alimente l'échéance suivie sur le
// véhicule ; un résultat défavorable doit alerter avant d'assurer.

import {
  chaine, chassis, controleChassis, controleDatePassee, controleImmatriculation, date, dateValide, definir, immatriculation, ouNul, parmi,
  texte, type Commun, type Controle,
} from "./outils.js";

const RESULTATS = ["favorable", "defavorable", "contre_visite"] as const;

export interface ChampsVisiteTechnique extends Commun {
  immatriculation: string | null;
  numeroChassis: string | null;
  centre: string | null;
  dateVisite: string | null;
  dateValidite: string | null;
  resultat: (typeof RESULTATS)[number] | null;
}

export const visiteTechnique = definir<ChampsVisiteTechnique>({
  libelle: "Visite technique",
  signes: "certificat, procès-verbal ou vignette de contrôle technique d'un véhicule : centre de contrôle, date de visite, date de prochaine visite, résultat",
  demande: "Ce document devrait être un certificat (ou une vignette) de visite technique d'un véhicule. Recopie ses champs.",
  proprietes: {
    immatriculation: ouNul(texte), numeroChassis: ouNul(texte), centre: ouNul(texte), dateVisite: ouNul(date), dateValidite: ouNul(date),
    resultat: ouNul({ type: "string", enum: [...RESULTATS] }),
  },
  descriptions: {
    centre: "centre de contrôle technique",
    dateValidite: "date de fin de validité, ou date limite de la prochaine visite",
    resultat: "favorable : véhicule accepté ; defavorable : refusé ; contre_visite : à représenter après réparations ; null si non indiqué",
  },
  nettoyer: (brut) => ({
    immatriculation: immatriculation(brut.immatriculation), numeroChassis: chassis(brut.numeroChassis), centre: chaine(brut.centre, 120),
    dateVisite: dateValide(brut.dateVisite), dateValidite: dateValide(brut.dateValidite), resultat: parmi(brut.resultat, RESULTATS),
  }),
  controler: (v, aujourdhui) => {
    const controles: Controle[] = [
      ...controleImmatriculation("immatriculation", v.immatriculation, "le certificat"),
      ...controleChassis("numeroChassis", v.numeroChassis, "le certificat"),
      ...controleDatePassee("dateValidite", v.dateValidite, aujourdhui, "Visite technique périmée : le véhicule doit repasser au contrôle."),
    ];
    if (v.resultat === "defavorable" || v.resultat === "contre_visite") {
      controles.push({
        champ: "resultat", niveau: "attention",
        message: v.resultat === "defavorable" ? "Résultat défavorable : le véhicule a été refusé au contrôle." : "Contre-visite exigée : le véhicule doit repasser après réparations.",
      });
    }
    if (v.dateVisite && v.dateValidite && v.dateVisite >= v.dateValidite) {
      controles.push({ champ: "dateValidite", niveau: "attention", message: "Fin de validité avant la date de visite : vérifiez les deux dates." });
    }
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    immatriculation: "7310 HJ 01", numeroChassis: null, centre: "Centre de contrôle de Yopougon", dateVisite: "2026-09-12",
    dateValidite: "2027-03-11", resultat: "favorable",
  },
});
