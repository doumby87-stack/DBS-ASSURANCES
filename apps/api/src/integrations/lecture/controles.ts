// Contrôles faits par l'API sur les valeurs lues, avant de les proposer : ils ne corrigent rien, ils signalent à la
// personne ce qu'elle doit regarder de plus près (pièce expirée, zone lisible par machine en désaccord, numéro de
// châssis mal formé, date d'accident à venir…).

import type { ChampsCarteGrise, ChampsConstat, ChampsPieceIdentite, Champs, TypeDocument } from "./documents.js";
import { LIBELLES_DOCUMENTS } from "./documents.js";
import { analyserMrz } from "./mrz.js";

export interface Controle {
  /** Champ concerné, ou null pour le document entier */
  champ: string | null;
  niveau: "ok" | "attention";
  message: string;
}

const jourDe = (d: Date) => d.toISOString().slice(0, 10);

export function controler(document: TypeDocument, champs: Champs, aujourdhui = new Date()): Controle[] {
  const controles: Controle[] = [];
  if (!champs.documentReconnu) {
    controles.push({ champ: null, niveau: "attention", message: `Ce document ne semble pas être : ${LIBELLES_DOCUMENTS[document].toLowerCase()}.` });
  }
  if (champs.lisibilite !== "bonne") {
    controles.push({
      champ: null, niveau: "attention",
      message: `Lecture ${champs.lisibilite === "partielle" ? "partielle" : "difficile"}${champs.remarques ? ` : ${champs.remarques}` : ""}. Vérifiez chaque champ.`,
    });
  }
  const aujourdhuiIso = jourDe(aujourdhui);

  if (document === "piece_identite") {
    const p = champs as ChampsPieceIdentite;
    if (p.dateExpiration && p.dateExpiration < aujourdhuiIso) {
      controles.push({ champ: "dateExpiration", niveau: "attention", message: "Pièce expirée : demandez une pièce en cours de validité." });
    }
    if (p.mrz) {
      const mrz = analyserMrz(p.mrz, aujourdhui);
      if (!mrz) {
        controles.push({ champ: "numero", niveau: "attention", message: "Zone lisible par machine incomplète : relisez le numéro et les dates sur la pièce." });
      } else if (!mrz.valide) {
        controles.push({
          champ: "numero", niveau: "attention",
          message: `Zone lisible par machine mal lue (${mrz.erreurs.join(", ")}) : relisez le numéro et les dates sur la pièce.`,
        });
      } else {
        // Chiffres de contrôle justes : la zone fait foi pour le numéro et les dates
        const ecarts: string[] = [];
        if (p.numero && p.numero.replace(/[\s-]/g, "").toUpperCase() !== mrz.numero) ecarts.push("numéro");
        if (p.dateNaissance && mrz.dateNaissance && p.dateNaissance !== mrz.dateNaissance) ecarts.push("date de naissance");
        if (p.dateExpiration && mrz.dateExpiration && p.dateExpiration !== mrz.dateExpiration) ecarts.push("date d'expiration");
        controles.push(ecarts.length === 0
          ? { champ: "numero", niveau: "ok", message: "Numéro et dates confirmés par la zone lisible par machine (chiffres de contrôle justes)." }
          : { champ: "numero", niveau: "attention",
              message: `La zone lisible par machine, dont les chiffres de contrôle sont justes, ne donne pas la même valeur pour : ${ecarts.join(", ")}. Vérifiez sur la pièce.` });
      }
    }
  }

  if (document === "carte_grise") {
    const c = champs as ChampsCarteGrise;
    if (c.immatriculation && !/^[A-Z0-9][A-Z0-9 -]{2,14}$/.test(c.immatriculation)) {
      controles.push({ champ: "immatriculation", niveau: "attention", message: "Immatriculation inhabituelle : vérifiez-la sur la carte grise." });
    }
    if (c.numeroChassis && !/^[A-HJ-NPR-Z0-9]{17}$/.test(c.numeroChassis)) {
      controles.push({
        champ: "numeroChassis", niveau: "attention",
        message: "Un numéro de châssis (VIN) compte 17 caractères, sans les lettres I, O et Q : vérifiez-le sur la carte grise.",
      });
    }
    if (c.datePremiereMiseEnCirculation && c.datePremiereMiseEnCirculation > aujourdhuiIso) {
      controles.push({ champ: "datePremiereMiseEnCirculation", niveau: "attention", message: "Date de première mise en circulation à venir : vérifiez-la." });
    }
  }

  if (document === "constat_amiable") {
    const k = champs as ChampsConstat;
    if (k.date && k.date > aujourdhuiIso) controles.push({ champ: "date", niveau: "attention", message: "Date de l'accident à venir : vérifiez-la." });
    if (k.vehicules.length < 2) {
      controles.push({ champ: null, niveau: "attention", message: "Un seul véhicule lu : vérifiez la colonne de l'autre conducteur." });
    }
    if (k.blesses) {
      controles.push({ champ: "blesses", niveau: "attention", message: "Blessés indiqués : le sinistre comporte des dommages corporels." });
    }
  }
  return controles;
}
