// Formats saisis au guichet, normalisés avant d'entrer en base.

/**
 * Numéro de téléphone au format international E.164 (+2250749360702), ou null s'il est invalide.
 * Accepte « 07 49 36 07 02 », « 0749360702 », « +225 07 49 36 07 02 », « 00225… », « 225… »
 * et les numéros étrangers commençant par + ou 00.
 */
export function normaliserTelephone(saisie: string): string | null {
  const brut = saisie.trim();
  if (!/^[+0-9\s().-]+$/.test(brut)) return null;
  let chiffres = brut.replace(/\D/g, "");
  const international = brut.startsWith("+") || brut.startsWith("00");
  if (brut.startsWith("00")) chiffres = chiffres.slice(2);

  if (!international) {
    if (chiffres.length === 10) return `+225${chiffres}`;
    if (chiffres.length === 13 && chiffres.startsWith("225")) return `+${chiffres}`;
    return null;
  }
  if (chiffres.startsWith("225") && chiffres.length !== 13) return null;
  return /^[1-9][0-9]{7,14}$/.test(chiffres) ? `+${chiffres}` : null;
}

/** Immatriculation en majuscules, espaces simples (« 1234 ab 01 » → « 1234 AB 01 »), ou null. */
export function normaliserImmatriculation(saisie: string): string | null {
  const valeur = saisie.trim().toUpperCase().replace(/\s+/g, " ");
  return /^[A-Z0-9][A-Z0-9 -]{2,14}$/.test(valeur) ? valeur : null;
}

/** Texte recherché, protégé pour un ILIKE : % et _ y perdent leur sens de joker. */
export function motifRecherche(saisie: string): string {
  return `%${saisie.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const nombre = new Intl.NumberFormat("fr-FR");

/** « 100000 » → « 100 000 F CFA », pour les messages rédigés par l'API. */
export function formaterMontant(montant: number): string {
  return `${nombre.format(montant)} F CFA`;
}
