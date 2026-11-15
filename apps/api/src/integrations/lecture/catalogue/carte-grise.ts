// Carte grise (certificat d'immatriculation) : de quoi créer le véhicule, le rattacher à son titulaire et le coter.

import {
  chaine, chassis, controleChassis, controleDateFuture, controleImmatriculation, date, dateValide, definir, entier, entierSchema,
  immatriculation, ouNul, texte, type Commun,
} from "./outils.js";

export interface ChampsCarteGrise extends Commun {
  immatriculation: string | null;
  numeroChassis: string | null;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  energie: string | null;
  puissanceFiscale: number | null;
  placesAssises: number | null;
  datePremiereMiseEnCirculation: string | null;
  proprietaire: string | null;
  usage: string | null;
}

export const carteGrise = definir<ChampsCarteGrise>({
  libelle: "Carte grise",
  signes: "certificat d'immatriculation d'un véhicule : numéro d'immatriculation, numéro de châssis, marque, genre, puissance fiscale, titulaire",
  demande: "Ce document devrait être une carte grise (certificat d'immatriculation) d'un véhicule. Recopie ses champs.",
  proprietes: {
    immatriculation: ouNul(texte), numeroChassis: ouNul(texte), marque: ouNul(texte), modele: ouNul(texte), genre: ouNul(texte),
    energie: ouNul(texte), puissanceFiscale: ouNul(entierSchema), placesAssises: ouNul(entierSchema),
    datePremiereMiseEnCirculation: ouNul(date), proprietaire: ouNul(texte), usage: ouNul(texte),
  },
  descriptions: {
    numeroChassis: "numéro d'identification du véhicule (numéro de série ou VIN), sans espaces",
    modele: "type ou dénomination commerciale",
    genre: "genre du véhicule (voiture particulière, camionnette, tracteur routier…)",
    puissanceFiscale: "puissance fiscale en chevaux (CV)",
    proprietaire: "nom du titulaire de la carte grise",
  },
  nettoyer: (brut) => ({
    immatriculation: immatriculation(brut.immatriculation),
    numeroChassis: chassis(brut.numeroChassis),
    marque: chaine(brut.marque, 40), modele: chaine(brut.modele, 40), genre: chaine(brut.genre, 60), energie: chaine(brut.energie, 30),
    puissanceFiscale: entier(brut.puissanceFiscale, 1, 99), placesAssises: entier(brut.placesAssises, 1, 120),
    datePremiereMiseEnCirculation: dateValide(brut.datePremiereMiseEnCirculation),
    proprietaire: chaine(brut.proprietaire, 160), usage: chaine(brut.usage, 60),
  }),
  controler: (c, aujourdhui) => [
    ...controleImmatriculation("immatriculation", c.immatriculation, "la carte grise"),
    ...controleChassis("numeroChassis", c.numeroChassis, "la carte grise"),
    ...controleDateFuture("datePremiereMiseEnCirculation", c.datePremiereMiseEnCirculation, aujourdhui,
      "Date de première mise en circulation à venir : vérifiez-la."),
  ],
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", marque: "Toyota", modele: "Corolla", genre: "Voiture particulière",
    energie: "Essence", puissanceFiscale: 8, placesAssises: 5, datePremiereMiseEnCirculation: "2019-03-14", proprietaire: "Koné Mariam",
    usage: "Promenade et affaires",
  },
});

