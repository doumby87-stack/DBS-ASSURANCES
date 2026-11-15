// Extrait du registre du commerce et du crédit mobilier (RCCM) : de quoi identifier une entreprise cliente
// (forme juridique, siège, activité) et ses dirigeants, pour la connaissance du client.

import {
  chaine, controleDateFuture, date, dateValide, definir, entier, entierSchema, liste, objet, objets, ouNul, texte,
  type Commun, type Controle,
} from "./outils.js";

export interface DirigeantLu {
  nom: string;
  fonction: string | null;
}

export interface ChampsRegistreCommerce extends Commun {
  raisonSociale: string | null;
  sigle: string | null;
  formeJuridique: string | null;
  numeroRccm: string | null;
  dateImmatriculation: string | null;
  siege: string | null;
  activite: string | null;
  capital: number | null;
  numeroContribuable: string | null;
  dirigeants: DirigeantLu[];
}

export const registreCommerce = definir<ChampsRegistreCommerce>({
  libelle: "Registre de commerce (RCCM)",
  signes: "extrait ou attestation d'immatriculation au registre du commerce et du crédit mobilier : numéro RCCM, dénomination, forme juridique, siège, dirigeants",
  demande: "Ce document devrait être un extrait du registre du commerce et du crédit mobilier (RCCM), une attestation d'immatriculation ou une déclaration fiscale d'existence d'une entreprise. Recopie ses champs.",
  proprietes: {
    raisonSociale: ouNul(texte), sigle: ouNul(texte), formeJuridique: ouNul(texte), numeroRccm: ouNul(texte),
    dateImmatriculation: ouNul(date), siege: ouNul(texte), activite: ouNul(texte), capital: ouNul(entierSchema),
    numeroContribuable: ouNul(texte),
    dirigeants: liste(objet({ nom: texte, fonction: ouNul(texte) }, { fonction: "gérant, président, directeur général, administrateur…" })),
  },
  descriptions: {
    raisonSociale: "dénomination sociale ou nom commercial",
    formeJuridique: "forme juridique en toutes lettres ou en sigle (SARL, SA, SAS, entreprise individuelle…)",
    numeroRccm: "numéro d'immatriculation au RCCM, tel qu'il est imprimé (par exemple CI-ABJ-2019-B-12345)",
    siege: "adresse du siège social ou du principal établissement",
    activite: "activité principale déclarée",
    capital: "capital social en F CFA, sans séparateur ; null s'il n'est pas indiqué",
    numeroContribuable: "numéro de compte contribuable (NCC), s'il figure sur le document",
    dirigeants: "personnes qui dirigent ou engagent l'entreprise, avec leur fonction ; liste vide si aucune n'est indiquée",
  },
  nettoyer: (brut) => ({
    raisonSociale: chaine(brut.raisonSociale, 160), sigle: chaine(brut.sigle, 40), formeJuridique: chaine(brut.formeJuridique, 60),
    numeroRccm: chaine(brut.numeroRccm, 60)?.toUpperCase() ?? null, dateImmatriculation: dateValide(brut.dateImmatriculation),
    siege: chaine(brut.siege, 300), activite: chaine(brut.activite, 300), capital: entier(brut.capital, 1, 1_000_000_000_000),
    numeroContribuable: chaine(brut.numeroContribuable, 30)?.toUpperCase() ?? null,
    dirigeants: objets(brut.dirigeants, 12)
      .map((d) => ({ nom: chaine(d.nom, 160), fonction: chaine(d.fonction, 80) }))
      .filter((d): d is DirigeantLu => d.nom !== null),
  }),
  controler: (r, aujourdhui) => {
    const controles: Controle[] = [
      ...controleDateFuture("dateImmatriculation", r.dateImmatriculation, aujourdhui, "Date d'immatriculation à venir : vérifiez-la."),
    ];
    // En Côte d'Ivoire (OHADA) : CI-<greffe>-<année>-<lettre>-<numéro>, par exemple CI-ABJ-2019-B-12345
    if (r.numeroRccm && !/^CI-[A-Z]{3}-/.test(r.numeroRccm.replace(/\s/g, ""))) {
      controles.push({ champ: "numeroRccm", niveau: "attention", message: "Numéro RCCM inhabituel (en Côte d'Ivoire : CI-ABJ-…) : vérifiez-le sur le document." });
    }
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    raisonSociale: "Transports Exemple Lagunaires", sigle: "TEL", formeJuridique: "SARL", numeroRccm: "CI-ABJ-2019-B-12345",
    dateImmatriculation: "2019-05-06", siege: "Zone industrielle de Yopougon, Abidjan", activite: "Transport routier de marchandises",
    capital: 10_000_000, numeroContribuable: null,
    dirigeants: [{ nom: "Bamba Issouf", fonction: "Gérant" }],
  },
});
