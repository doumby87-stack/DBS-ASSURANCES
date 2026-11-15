// Contrôles faits par l'API sur les valeurs lues, avant de les proposer : ils ne corrigent rien, ils signalent à la
// personne ce qu'elle doit regarder de plus près (pièce expirée, zone lisible par machine en désaccord, numéro de
// châssis mal formé, attestation échue, visite technique défavorable…). Les contrôles propres à chaque document
// sont dans son fichier du catalogue ; ici, ceux qui valent pour tous.

import { CATALOGUE, LIBELLES_DOCUMENTS, type Champs, type Controle, type TypeDocument } from "./documents.js";

export type { Controle } from "./documents.js";

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
  const definition = CATALOGUE[document] as { controler(champs: Champs, aujourdhui: Date): Controle[] };
  controles.push(...definition.controler(champs, aujourdhui));
  for (const champ of champs.champsIncertains) {
    controles.push({ champ, niveau: "attention", message: "Lecture douteuse : vérifiez cette valeur sur le document." });
  }
  return controles;
}
