// Fichiers CSV lisibles directement par Excel en français (point-virgule, UTF-8 avec BOM).
// Protection contre l'injection de formules : un texte qui commence par =, +, -, @, une tabulation
// ou un retour chariot serait exécuté comme une formule par le tableur ; il est préfixé d'une apostrophe.
// Exemple : un client enregistré sous le nom « =HYPERLINK(…) » ne devient pas un lien piégé.

export type Cellule = string | number | null | undefined;

export function celluleCsv(valeur: Cellule): string {
  if (valeur === null || valeur === undefined) return "";
  let texte = String(valeur);
  if (typeof valeur === "string" && /^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  if (/[";\n\r]/.test(texte)) texte = `"${texte.replace(/"/g, '""')}"`;
  return texte;
}

export function documentCsv(lignes: Cellule[][]): string {
  return `﻿${lignes.map((ligne) => ligne.map(celluleCsv).join(";")).join("\r\n")}\r\n`;
}
