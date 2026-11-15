// Pièce d'identité : de quoi compléter l'identification du client (ou d'un dirigeant). La zone lisible par machine,
// quand elle est visible, est vérifiée par ses chiffres de contrôle et fait foi pour le numéro et les dates.

import { analyserMrz } from "../mrz.js";
import {
  chaine, controleDatePassee, date, dateValide, definir, liste, ouNul, parmi, texte, type Commun, type Controle,
} from "./outils.js";

export const TYPES_PIECE_IDENTITE = [
  "cni", "passeport", "carte_sejour", "carte_consulaire", "permis_conduire", "attestation_identite", "autre",
] as const;

export interface ChampsPieceIdentite extends Commun {
  typePiece: (typeof TYPES_PIECE_IDENTITE)[number] | null;
  numero: string | null;
  nom: string | null;
  prenoms: string | null;
  dateNaissance: string | null;
  lieuNaissance: string | null;
  sexe: "F" | "M" | null;
  nationalite: string | null;
  dateDelivrance: string | null;
  dateExpiration: string | null;
  /** Lignes de la zone lisible par machine (bas du passeport, dos de la carte biométrique), recopiées telles quelles */
  mrz: string[] | null;
}

export const pieceIdentite = definir<ChampsPieceIdentite>({
  libelle: "Pièce d'identité",
  signes: "carte nationale d'identité, passeport, carte de résident, carte consulaire ou permis de conduire : photo, nom, prénoms, date de naissance, numéro",
  demande: "Ce document devrait être une pièce d'identité (carte nationale d'identité, passeport, carte de résident, carte consulaire ou permis de conduire). Recopie ses champs, et la zone lisible par machine si elle est visible.",
  proprietes: {
    typePiece: ouNul({ type: "string", enum: [...TYPES_PIECE_IDENTITE] }),
    numero: ouNul(texte), nom: ouNul(texte), prenoms: ouNul(texte), dateNaissance: ouNul(date), lieuNaissance: ouNul(texte),
    sexe: ouNul({ type: "string", enum: ["F", "M"] }), nationalite: ouNul(texte), dateDelivrance: ouNul(date), dateExpiration: ouNul(date),
    mrz: ouNul(liste(texte)),
  },
  descriptions: {
    typePiece: "cni : carte nationale d'identité ; carte_sejour : carte de résident ; autre : tout autre document",
    numero: "numéro du document, tel qu'il est imprimé",
    nationalite: "nationalité en toutes lettres, en français",
    mrz: "lignes de la zone lisible par machine (caractères <), recopiées exactement, une ligne par élément ; null s'il n'y en a pas",
  },
  nettoyer: (brut) => {
    const mrz = Array.isArray(brut.mrz)
      ? brut.mrz.map((l) => (typeof l === "string" ? l.replace(/\s/g, "").toUpperCase().slice(0, 44) : "")).filter(Boolean).slice(0, 3)
      : [];
    return {
      typePiece: parmi(brut.typePiece, TYPES_PIECE_IDENTITE),
      numero: chaine(brut.numero, 40), nom: chaine(brut.nom, 120), prenoms: chaine(brut.prenoms, 160),
      dateNaissance: dateValide(brut.dateNaissance), lieuNaissance: chaine(brut.lieuNaissance, 120),
      sexe: parmi(brut.sexe, ["F", "M"] as const), nationalite: chaine(brut.nationalite, 60),
      dateDelivrance: dateValide(brut.dateDelivrance), dateExpiration: dateValide(brut.dateExpiration),
      mrz: mrz.length > 0 ? mrz : null,
    };
  },
  controler: (p, aujourdhui) => {
    const controles: Controle[] = [
      ...controleDatePassee("dateExpiration", p.dateExpiration, aujourdhui, "Pièce expirée : demandez une pièce en cours de validité."),
    ];
    if (!p.mrz) return controles;
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
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    typePiece: "passeport", numero: "L898902C3", nom: "ERIKSSON", prenoms: "ANNA MARIA", dateNaissance: "1974-08-12", lieuNaissance: null,
    sexe: "F", nationalite: "Utopienne", dateDelivrance: null, dateExpiration: "2034-04-15",
    // Spécimen de la norme ICAO 9303 (pays fictif « UTO »), date d'expiration ajustée et chiffres de contrôle recalculés
    mrz: ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F3404159ZE184226B<<<<<16"],
  },
});
