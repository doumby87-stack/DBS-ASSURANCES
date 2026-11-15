// Attestation (ou conditions particulières) d'assurance en cours, souvent chez une autre compagnie : la date
// d'échéance dit quand proposer un devis, les garanties et la prime disent quoi reprendre et à quel prix comparer.

import {
  chaine, chassis, controleChassis, controleDatePassee, controleImmatriculation, date, dateValide, definir, entier, entierSchema,
  immatriculation, liste, ouNul, texte, textes, type Commun, type Controle,
} from "./outils.js";

export interface ChampsAttestation extends Commun {
  assureur: string | null;
  intermediaire: string | null;
  numeroPolice: string | null;
  numeroAttestation: string | null;
  souscripteur: string | null;
  risque: string | null;
  dateEffet: string | null;
  dateEcheance: string | null;
  immatriculation: string | null;
  numeroChassis: string | null;
  marque: string | null;
  usage: string | null;
  garanties: string[];
  primeTtc: number | null;
}

export const attestationAssurance = definir<ChampsAttestation>({
  libelle: "Attestation d'assurance",
  signes: "attestation, carte ou conditions particulières d'un contrat d'assurance : nom de la compagnie, numéro de police, période de validité, assuré",
  demande: "Ce document devrait être une attestation d'assurance (ou les conditions particulières d'un contrat d'assurance), automobile ou non. Recopie ses champs.",
  proprietes: {
    assureur: ouNul(texte), intermediaire: ouNul(texte), numeroPolice: ouNul(texte), numeroAttestation: ouNul(texte),
    souscripteur: ouNul(texte), risque: ouNul(texte), dateEffet: ouNul(date), dateEcheance: ouNul(date),
    immatriculation: ouNul(texte), numeroChassis: ouNul(texte), marque: ouNul(texte), usage: ouNul(texte),
    garanties: liste(texte), primeTtc: ouNul(entierSchema),
  },
  descriptions: {
    assureur: "compagnie d'assurance qui délivre le document",
    intermediaire: "agent général ou courtier indiqué, s'il y en a un",
    souscripteur: "nom de l'assuré ou du souscripteur",
    risque: "ce qui est assuré, en quelques mots (automobile, habitation, multirisque professionnelle…)",
    dateEffet: "début de la période de garantie",
    dateEcheance: "fin de la période de garantie (date d'échéance ou de fin de validité)",
    immatriculation: "immatriculation du véhicule assuré, pour une assurance automobile ; null sinon",
    garanties: "garanties souscrites, une par élément, telles qu'écrites (responsabilité civile, vol, incendie, bris de glace…) ; liste vide si aucune n'est indiquée",
    primeTtc: "prime totale toutes taxes comprises, en F CFA, sans séparateur ; null si elle n'est pas indiquée",
  },
  nettoyer: (brut) => ({
    assureur: chaine(brut.assureur, 120), intermediaire: chaine(brut.intermediaire, 120),
    numeroPolice: chaine(brut.numeroPolice, 60), numeroAttestation: chaine(brut.numeroAttestation, 60),
    souscripteur: chaine(brut.souscripteur, 160), risque: chaine(brut.risque, 120),
    dateEffet: dateValide(brut.dateEffet), dateEcheance: dateValide(brut.dateEcheance),
    immatriculation: immatriculation(brut.immatriculation), numeroChassis: chassis(brut.numeroChassis),
    marque: chaine(brut.marque, 60), usage: chaine(brut.usage, 60),
    garanties: textes(brut.garanties, 20), primeTtc: entier(brut.primeTtc, 1, 10_000_000_000),
  }),
  controler: (a, aujourdhui) => {
    const controles: Controle[] = [
      ...controleImmatriculation("immatriculation", a.immatriculation, "l'attestation"),
      ...controleChassis("numeroChassis", a.numeroChassis, "l'attestation"),
      ...controleDatePassee("dateEcheance", a.dateEcheance, aujourdhui, "Attestation échue : ce contrat ne couvre plus le risque. Vérifiez qu'il n'y a pas plus récent."),
    ];
    if (a.dateEffet && a.dateEcheance && a.dateEffet >= a.dateEcheance) {
      controles.push({ champ: "dateEcheance", niveau: "attention", message: "Date d'échéance avant la date d'effet : vérifiez les deux dates." });
    }
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: ["numeroAttestation"],
    assureur: "Compagnie Exemple Assurances", intermediaire: null, numeroPolice: "AUT-2026-004521", numeroAttestation: "CI-0045211",
    souscripteur: "Koné Mariam", risque: "Automobile", dateEffet: "2026-01-01", dateEcheance: "2026-12-31",
    immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", marque: "Toyota Corolla", usage: "Promenade et affaires",
    garanties: ["Responsabilité civile", "Défense et recours", "Vol", "Incendie"], primeTtc: 285_000,
  },
});
