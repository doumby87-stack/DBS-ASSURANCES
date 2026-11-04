// Montant écrit en toutes lettres, comme sur un reçu ou un chèque : « cinquante-deux mille francs CFA ».
// Orthographe traditionnelle : traits d'union sous cent, « et » pour 21…71, accords de « vingt » et « cent »
// (« quatre-vingts », « deux cents », mais « quatre-vingt mille », « deux cent mille »), « mille » invariable.

const UNITES = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
] as const;
const DIZAINES = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"] as const;

function moinsDeCent(n: number): string {
  if (n < 17) return UNITES[n]!;
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  if (n < 70) {
    const dizaine = DIZAINES[Math.floor(n / 10)]!;
    const unite = n % 10;
    if (unite === 0) return dizaine;
    if (unite === 1) return `${dizaine} et un`;
    return `${dizaine}-${UNITES[unite]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante-${moinsDeCent(n - 60)}`;
  return n === 80 ? "quatre-vingts" : `quatre-vingt-${moinsDeCent(n - 80)}`;
}

/** De 1 à 999. Devant « mille », « cents » et « quatre-vingts » perdent leur s. */
function moinsDeMille(n: number, devantMille = false): string {
  const centaines = Math.floor(n / 100);
  const reste = n % 100;
  let texte: string;
  if (centaines === 0) texte = moinsDeCent(reste);
  else if (centaines === 1) texte = reste ? `cent ${moinsDeCent(reste)}` : "cent";
  else texte = reste ? `${UNITES[centaines]} cent ${moinsDeCent(reste)}` : `${UNITES[centaines]} cents`;
  return devantMille ? texte.replace(/(cent|vingt)s$/, "$1") : texte;
}

/** Nombre entier positif ou nul en lettres. */
export function nombreEnLettres(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("Entier positif attendu");
  if (n === 0) return "zéro";
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor(n / 1_000_000) % 1000;
  const milliers = Math.floor(n / 1000) % 1000;
  const reste = n % 1000;
  const morceaux: string[] = [];
  if (milliards) morceaux.push(`${nombreEnLettres(milliards)} milliard${milliards > 1 ? "s" : ""}`);
  if (millions) morceaux.push(`${moinsDeMille(millions)} million${millions > 1 ? "s" : ""}`);
  if (milliers) morceaux.push(milliers === 1 ? "mille" : `${moinsDeMille(milliers, true)} mille`);
  if (reste) morceaux.push(moinsDeMille(reste));
  return morceaux.join(" ");
}

/** « 52000 » → « cinquante-deux mille francs CFA » ; « -32000 » → « moins trente-deux mille francs CFA ». */
export function montantEnLettres(montant: number): string {
  const valeur = Math.abs(montant);
  const lettres = nombreEnLettres(valeur);
  // « un million de francs », mais « un million deux cents francs »
  const de = /(million|milliard)s?$/.test(lettres) ? "de " : "";
  const francs = valeur > 1 ? "francs" : "franc";
  return `${montant < 0 ? "moins " : ""}${lettres} ${de}${francs} CFA`;
}
