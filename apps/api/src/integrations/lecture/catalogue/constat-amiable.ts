// Constat amiable d'accident automobile, rempli à la main : de quoi préparer la déclaration de sinistre.

import {
  booleen, booleenSchema, chaine, controleDateFuture, date, dateValide, definir, entierSchema, immatriculation, liste, objet, objets,
  ouNul, parmi, texte, type Commun, type Controle,
} from "./outils.js";

export interface VehiculeConstat {
  lettre: "A" | "B" | "C";
  conducteur: string | null;
  assure: string | null;
  assureur: string | null;
  numeroPolice: string | null;
  numeroAttestation: string | null;
  immatriculation: string | null;
  marque: string | null;
  circonstances: number[];
  pointDeChoc: string | null;
  degatsApparents: string | null;
  observations: string | null;
}

export interface ChampsConstat extends Commun {
  date: string | null;
  heure: string | null;
  lieu: string | null;
  blesses: boolean | null;
  degatsAutres: boolean | null;
  temoins: string | null;
  vehicules: VehiculeConstat[];
  croquis: string | null;
}

const LETTRES = ["A", "B", "C"] as const;

export const constatAmiable = definir<ChampsConstat>({
  libelle: "Constat amiable",
  signes: "formulaire de constat amiable d'accident automobile en deux colonnes (véhicule A, véhicule B), cases de circonstances numérotées, croquis",
  demande: "Ce document devrait être un constat amiable d'accident automobile, rempli à la main. Recopie ses champs, véhicule par véhicule, avec les numéros des cases de circonstances cochées.",
  proprietes: {
    date: ouNul(date), heure: ouNul(texte), lieu: ouNul(texte), blesses: ouNul(booleenSchema), degatsAutres: ouNul(booleenSchema),
    temoins: ouNul(texte),
    vehicules: liste(objet({
      lettre: { type: "string", enum: [...LETTRES] },
      conducteur: ouNul(texte), assure: ouNul(texte), assureur: ouNul(texte), numeroPolice: ouNul(texte), numeroAttestation: ouNul(texte),
      immatriculation: ouNul(texte), marque: ouNul(texte), circonstances: liste(entierSchema),
      pointDeChoc: ouNul(texte), degatsApparents: ouNul(texte), observations: ouNul(texte),
    }, {
      circonstances: "numéros des cases de circonstances cochées pour ce véhicule",
      pointDeChoc: "point de choc initial indiqué, en quelques mots",
    })),
    croquis: ouNul(texte),
  },
  descriptions: {
    heure: "heure de l'accident au format HH:MM",
    blesses: "case « blessés même légers » : true si oui, false si non",
    degatsAutres: "dégâts matériels à d'autres véhicules ou objets que A et B : true si oui",
    temoins: "noms et coordonnées des témoins, tels qu'écrits",
    croquis: "description du croquis en une ou deux phrases (positions, sens de circulation)",
  },
  nettoyer: (brut) => ({
    date: dateValide(brut.date),
    heure: typeof brut.heure === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(brut.heure.trim()) ? brut.heure.trim() : null,
    lieu: chaine(brut.lieu, 300), blesses: booleen(brut.blesses), degatsAutres: booleen(brut.degatsAutres), temoins: chaine(brut.temoins, 500),
    vehicules: objets(brut.vehicules, 3).map((v, i) => ({
      lettre: parmi(v.lettre, LETTRES) ?? LETTRES[i]!,
      conducteur: chaine(v.conducteur, 160), assure: chaine(v.assure, 160), assureur: chaine(v.assureur, 120),
      numeroPolice: chaine(v.numeroPolice, 60), numeroAttestation: chaine(v.numeroAttestation, 60),
      immatriculation: immatriculation(v.immatriculation), marque: chaine(v.marque, 60),
      circonstances: Array.isArray(v.circonstances)
        ? [...new Set(v.circonstances.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 30))].sort((a, b) => a - b)
        : [],
      pointDeChoc: chaine(v.pointDeChoc, 200), degatsApparents: chaine(v.degatsApparents, 300), observations: chaine(v.observations, 500),
    })),
    croquis: chaine(brut.croquis, 500),
  }),
  controler: (k, aujourdhui) => {
    const controles: Controle[] = [...controleDateFuture("date", k.date, aujourdhui, "Date de l'accident à venir : vérifiez-la.")];
    if (k.vehicules.length < 2) {
      controles.push({ champ: null, niveau: "attention", message: "Un seul véhicule lu : vérifiez la colonne de l'autre conducteur." });
    }
    if (k.blesses) {
      controles.push({ champ: "blesses", niveau: "attention", message: "Blessés indiqués : le sinistre comporte des dommages corporels." });
    }
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "partielle", remarques: "Écriture manuscrite difficile à lire dans la partie observations.",
    champsIncertains: ["temoins"],
    date: "2026-10-28", heure: "08:40", lieu: "Carrefour de la Siporex, Yopougon", blesses: false, degatsAutres: false, temoins: null,
    vehicules: [
      { lettre: "A", conducteur: "Koné Mariam", assure: "Koné Mariam", assureur: "SanlamAllianz", numeroPolice: "AUTO-KM-2026", numeroAttestation: null,
        immatriculation: "2024 KM 01", marque: "Toyota Yaris", circonstances: [8], pointDeChoc: "Arrière", degatsApparents: "Pare-chocs arrière enfoncé",
        observations: null },
      { lettre: "B", conducteur: "Traoré Ali", assure: "Traoré Ali", assureur: "Autre compagnie", numeroPolice: null, numeroAttestation: null,
        immatriculation: "7712 GH 01", marque: "Nissan Sunny", circonstances: [8], pointDeChoc: "Avant", degatsApparents: "Capot", observations: null },
    ],
    croquis: "Le véhicule B, roulant derrière A sur la même voie, l'a heurté à l'arrière à l'arrêt au feu.",
  },
});
