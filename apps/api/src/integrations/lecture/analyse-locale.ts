// Lecteur local (tâche 14, ADR 0015) : du texte reconnu par Tesseract aux champs d'un document.
//
// Les documents réels mettent tantôt la valeur à droite de son libellé, tantôt en dessous, sur plusieurs colonnes
// (la carte grise ivoirienne : « Marque | Genre » puis « DAF | Tracteur Routier »). Chaque ligne est donc découpée en
// colonnes d'après les blancs entre les mots ; une valeur se cherche dans la même colonne, à droite, puis dessous.
// Les libellés sont retrouvés malgré les accents et une ou deux fautes de reconnaissance par mot. Les valeurs qui
// ont une forme connue (immatriculation, numéro de châssis, dates, zone lisible par machine) sont cherchées d'après
// cette forme, corrigées des confusions habituelles (O et 0, I et 1…) et départagées par un vote entre les
// lectures. Le résultat passe ensuite par le même nettoyage que les autres lecteurs, puis par les contrôles, et une
// personne vérifie tout avant d'enregistrer.

import type { TypeDocument } from "./documents.js";
import { analyserMrz, extraireMrz } from "./mrz.js";
import type { LigneLue, TexteLu } from "./ocr.js";

type Brut = Record<string, unknown>;

/** Majuscules sans accents, caractère par caractère : les positions restent celles du texte d'origine */
function normaliser(texte: string): string {
  return [...texte].map((c) => {
    if (/[æÆ]/.test(c)) return "A";
    if (/[œŒ]/.test(c)) return "O";
    return c.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()[0] ?? " ";
  }).join("");
}

/**
 * Distance d'édition au plus 1 pour un mot de 5 à 11 lettres, au plus 2 au-delà ; exacte en dessous (sinon
 * « NATIONALE » passerait pour « NATIONALITE »)
 */
function procheDe(mot: string, cible: string): boolean {
  if (mot === cible) return true;
  const tolerance = cible.length >= 12 ? 2 : cible.length >= 5 ? 1 : 0;
  if (tolerance === 0 || Math.abs(mot.length - cible.length) > tolerance) return false;
  let precedente = Array.from({ length: cible.length + 1 }, (_, j) => j);
  for (let i = 1; i <= mot.length; i += 1) {
    const courante = [i];
    for (let j = 1; j <= cible.length; j += 1) {
      courante[j] = Math.min(precedente[j]! + 1, courante[j - 1]! + 1, precedente[j - 1]! + (mot[i - 1] === cible[j - 1] ? 0 : 1));
    }
    if (Math.min(...courante) > tolerance) return false;
    precedente = courante;
  }
  return precedente[cible.length]! <= tolerance;
}

// ---------------------------------------------------------------------------------------------------------
// Lignes, colonnes et libellés
// ---------------------------------------------------------------------------------------------------------
interface Mot {
  texte: string;
  normal: string;
  x0: number;
  x1: number;
}
interface Colonne {
  mots: Mot[];
  x0: number;
  x1: number;
  texte: string;
}
interface Ligne {
  texte: string;
  normal: string;
  confiance: number;
  hauteur: number;
  colonnes: Colonne[];
}

const mediane = (valeurs: number[]) => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? 0;

/**
 * Deux colonnes sont séparées par un blanc nettement plus large que les blancs entre les mots d'une même phrase :
 * plus de trois fois l'écart habituel de la ligne et plus d'une demi-hauteur de ligne, ou plus d'une hauteur et
 * demie. La hauteur de référence est celle de la page (une ligne qui en mêle deux, sur une photo penchée, est haute).
 */
function preparerLignes(lues: LigneLue[]): Ligne[] {
  const hauteurPage = mediane(lues.map((l) => l.hauteur)) || 1;
  return lues.map((lue) => {
    const mots = lue.mots.map((m) => ({ ...m, normal: normaliser(m.texte) }));
    const ecarts = mots.slice(1).map((m, i) => m.x0 - mots[i]!.x1);
    const hauteur = Math.min(lue.hauteur, hauteurPage);
    const seuil = Math.min(1.5 * hauteur, Math.max(0.5 * hauteur, 3 * mediane(ecarts)));
    const colonnes: Colonne[] = [];
    for (const mot of mots) {
      const derniere = colonnes.at(-1);
      if (derniere && mot.x0 - derniere.x1 <= seuil) {
        derniere.mots.push(mot);
        derniere.x1 = mot.x1;
      } else {
        colonnes.push({ mots: [mot], x0: mot.x0, x1: mot.x1, texte: "" });
      }
    }
    for (const c of colonnes) c.texte = c.mots.map((m) => m.texte).join(" ");
    return { texte: lue.texte, normal: normaliser(lue.texte), confiance: lue.confiance, hauteur, colonnes };
  });
}

/** Mots des libellés des documents lus : ils ne sont jamais pris pour une valeur */
const MOTS_LIBELLES = [
  "NUMERO", "IMMATRICULATION", "CARTE", "GRISE", "DATE", "PREMIERE", "MISE", "CIRCULATION", "EDITION", "IDENTITE", "PROPRIETAIRE",
  "RAISON", "SOCIALE", "TITULAIRE", "MARQUE", "GENRE", "TYPE", "COMMERCIAL", "TECHNIQUE", "COULEUR", "CARROSSERIE", "ENERGIE", "USAGE",
  "VEHICULE", "NOMBRE", "ESSIEUX", "PLACES", "ASSISES", "PUISSANCE", "FISCALE", "CYLINDREE", "PTAC", "VIN", "CHASSIS", "SERIE", "MOTEUR",
  "PRECEDENT", "SOCIETE", "CREDIT", "DENOMINATION", "MODELE", "NOM", "NOMS", "PRENOM", "PRENOMS", "NAISSANCE", "LIEU", "SEXE", "TAILLE",
  "NATIONALITE", "DELIVRANCE", "EXPIRATION", "PROFESSION", "DOMICILE", "ADRESSE", "PASSEPORT", "HEURE", "SIGNATURE", "AUTORITE",
];
const PETITS_MOTS = new Set(["N°", "NO", "D", "DE", "DU", "DES", "LA", "LE", "ET", "OU", "EN", "A", "1ERE", "1RE", "CV", "CC", "KG", "PV", "CU"]);
const lettresDe = (mot: Mot) => mot.normal.replace(/[^A-Z0-9°]/g, "");
const enMinuscules = (mot: Mot) => /^[a-zà-ÿ'’.()]+$/.test(mot.texte);

const estMotDeLibelle = (mot: Mot) => {
  const lettres = lettresDe(mot);
  return lettres === "" || PETITS_MOTS.has(lettres) || MOTS_LIBELLES.some((l) => procheDe(lettres, l));
};
/** Une colonne de libellé : elle contient un mot de libellé, et la plupart de ses mots en sont ou sont en minuscules */
function estLibelle(colonne: Colonne): boolean {
  const libelles = colonne.mots.filter((m) => estMotDeLibelle(m) || enMinuscules(m));
  return colonne.mots.some((m) => MOTS_LIBELLES.some((l) => procheDe(lettresDe(m), l))) && libelles.length * 2 >= colonne.mots.length;
}

interface Recherche {
  /** Ne regarder que les lignes qui passent ce filtre */
  ligne?: (ligne: Ligne) => boolean;
  /** Forme attendue de la valeur (un chiffre, une date…) : sinon, elle est cherchée plus loin */
  forme?: (valeur: string) => boolean;
  /** Une seule lettre majuscule est une valeur (le sexe) */
  lettreSeule?: boolean;
}

/** Indice du mot-clé dans une colonne, ou -1 */
function ancreDans(colonne: Colonne, motCle: string): number {
  return colonne.mots.findIndex((m) => procheDe(lettresDe(m), motCle));
}

const alignee = (colonne: Colonne, reference: Colonne, hauteur: number) =>
  colonne.x0 >= reference.x0 - 2 * hauteur && colonne.x0 <= Math.max(reference.x1, reference.x0 + 2 * hauteur);

/** Une valeur imprimée : un chiffre, ou au moins deux lettres pas toutes en minuscules ; sinon, c'est du bruit de lecture */
const plausible = (valeur: string) => /\d/.test(valeur) || ((valeur.match(/\p{L}/gu)?.length ?? 0) >= 2 && !/^[\p{Ll}\s'’.,:;()\-]+$/u.test(valeur));

/**
 * Disposition du document, au vote de ses libellés : valeurs à droite des libellés (tableau, passeport) ou en
 * dessous (cartes récentes, en plusieurs colonnes). Elle décide où regarder d'abord : un libellé mal lu, juste
 * dessous ou juste à droite, ne doit pas être pris pour la valeur.
 */
const dispositions = new WeakMap<Ligne[], "droite" | "dessous">();
function disposition(lignes: Ligne[]): "droite" | "dessous" {
  const connue = dispositions.get(lignes);
  if (connue) return connue;
  let droite = 0;
  let dessous = 0;
  lignes.forEach((ligne, n) => ligne.colonnes.forEach((colonne, c) => {
    if (!estLibelle(colonne)) return;
    const voisine = ligne.colonnes[c + 1];
    if (voisine && !estLibelle(voisine)) droite += 1;
    const juste = lignes[n + 1]?.colonnes.find((d) => alignee(d, colonne, ligne.hauteur));
    if (juste && !estLibelle(juste)) dessous += 1;
  }));
  const resultat = droite > dessous ? "droite" : "dessous";
  dispositions.set(lignes, resultat);
  return resultat;
}

/**
 * Valeur du premier libellé trouvé : à la suite du libellé dans sa colonne ; puis juste dessous et dans la colonne à
 * droite, dans l'ordre que donne la disposition du document ; enfin deux lignes plus bas. Une colonne qui est
 * elle-même un libellé n'est jamais une valeur.
 */
function valeurApres(
  lignes: Ligne[], motsCles: string[], { ligne: accepter = () => true, forme: formeAttendue = () => true, lettreSeule = false }: Recherche = {},
): string | null {
  const forme = (valeur: string) => (plausible(valeur) || (lettreSeule && /^\p{Lu}$/u.test(valeur.trim()))) && formeAttendue(valeur);
  for (const motCle of motsCles) {
    for (let n = 0; n < lignes.length; n += 1) {
      const ligne = lignes[n]!;
      if (!accepter(ligne)) continue;
      for (let c = 0; c < ligne.colonnes.length; c += 1) {
        const colonne = ligne.colonnes[c]!;
        const ancre = ancreDans(colonne, motCle);
        if (ancre < 0) continue;
        // Fin du libellé : mots de libellé, unités, mots en minuscules (« commercial », « fiscale (CV) »)
        let debut = ancre + 1;
        while (debut < colonne.mots.length && (estMotDeLibelle(colonne.mots[debut]!) || enMinuscules(colonne.mots[debut]!))) debut += 1;
        const reste = colonne.mots.slice(debut).map((m) => m.texte).join(" ").replace(/^[\s:.;,\-–—|/)]+/, "").trim();
        if (reste && forme(reste)) return reste;
        const dessous = (k: number) => lignes[n + k]?.colonnes.find((d) => alignee(d, colonne, ligne.hauteur));
        const juste = dessous(1);
        const voisine = ligne.colonnes[c + 1];
        const candidates = disposition(lignes) === "droite" ? [voisine, juste] : [juste, voisine];
        for (const candidate of candidates) {
          if (candidate && !estLibelle(candidate) && forme(candidate.texte)) return candidate.texte;
        }
        const plusBas = dessous(2);
        if ((!juste || !estLibelle(juste)) && plusBas && !estLibelle(plusBas) && forme(plusBas.texte)) return plusBas.texte;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Formes connues
// ---------------------------------------------------------------------------------------------------------
/** Dans une valeur numérique, un O est un 0 et un I ou un l est un 1 */
const chiffres = (texte: string) => texte.replace(/(?<=\d)[OoQD]|[OoQD](?=\d)/g, "0").replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, "1");
const avecChiffre = (valeur: string) => /\d/.test(chiffres(valeur));

/** Toutes les dates JJ/MM/AAAA (ou avec des points, des tirets, des espaces) du texte → AAAA-MM-JJ */
function datesDans(texte: string, aujourdhui = new Date()): string[] {
  const dates: string[] = [];
  for (const trouve of chiffres(texte).matchAll(/(?<!\d)(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})(?!\d)/g)) {
    const jour = Number(trouve[1]);
    const mois = Number(trouve[2]);
    let annee = Number(trouve[3]);
    if (trouve[3]!.length === 2) annee += annee > aujourdhui.getUTCFullYear() % 100 ? 1900 : 2000;
    const d = new Date(Date.UTC(annee, mois - 1, jour));
    if (d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour) {
      dates.push(`${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`);
    }
  }
  return dates;
}
const dateDans = (texte: string | null) => (texte ? datesDans(texte)[0] ?? null : null);
const avecDate = (valeur: string) => dateDans(valeur) !== null;

function entierDans(texte: string | null): number | null {
  const trouve = texte ? /\d{1,3}/.exec(chiffres(texte)) : null;
  return trouve ? Number(trouve[0]) : null;
}

/**
 * Immatriculations ivoiriennes : le système de 2023 (AB-123-CD, suivi sur la carte grise du code de la région) et
 * l'ancien (1234 AB 01). Dans les positions de chiffres, un O est un 0 ; dans celles de lettres, un 0 est un O.
 */
const NOUVELLE = /(?<![A-Z0-9])([A-Z0-9]{2}) ?[-–—]? ?([0-9OQIL]{3}) ?[-–—]? ?([A-Z0-9]{2})(?: ?[-–—]? ?([0-9OQIL]{2}))?(?![A-Z0-9])/g;
const ANCIENNE = /(?<![A-Z0-9])(\d{1,4}) ?([A-Z]{2}) ?(\d{2})(?![A-Z0-9])/g;
const enChiffres = (t: string) => t.replace(/[OQ]/g, "0").replace(/[IL]/g, "1");
const enLettres = (t: string) => t.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");

function immatriculationsDans(texte: string): string[] {
  const normal = normaliser(texte);
  const trouvees: string[] = [];
  for (const t of normal.matchAll(NOUVELLE)) {
    const [lettres1, nombre, lettres2] = [enLettres(t[1]!), enChiffres(t[2]!), enLettres(t[3]!)];
    if (!/^[A-Z]{2}$/.test(lettres1) || !/^[A-Z]{2}$/.test(lettres2) || !/\d/.test(t[2]!)) continue;
    // Sans tirets, seules de vraies lettres de part et d'autre : sinon c'est une autre suite de caractères
    if (!/[-–—]/.test(t[0]) && !(/^[A-Z]{2}$/.test(t[1]!) && /^[A-Z]{2}$/.test(t[3]!))) continue;
    trouvees.push([lettres1, nombre, lettres2, t[4] ? enChiffres(t[4]) : null].filter(Boolean).join("-"));
  }
  for (const t of normal.matchAll(ANCIENNE)) trouvees.push(`${t[1]} ${t[2]} ${t[3]}`);
  return trouvees;
}

/** La valeur la plus souvent lue ; à égalité, celle de la lecture la plus sûre */
function vote(candidats: { valeur: string; confiance: number }[]): string | null {
  const comptes = new Map<string, { nombre: number; confiance: number }>();
  for (const { valeur, confiance } of candidats) {
    const actuel = comptes.get(valeur) ?? { nombre: 0, confiance: 0 };
    comptes.set(valeur, { nombre: actuel.nombre + 1, confiance: Math.max(actuel.confiance, confiance) });
  }
  return [...comptes.entries()].sort((a, b) => b[1].nombre - a[1].nombre || b[1].confiance - a[1].confiance)[0]?.[0] ?? null;
}

/**
 * Numéro de châssis (VIN) : 17 caractères, jamais I, O ni Q (ce sont des 1 et des 0 mal lus), qui finit par son
 * numéro de série en chiffres. Il peut être imprimé en plusieurs groupes : on essaie les mots consécutifs de la
 * ligne qui, mis bout à bout, font 17 caractères. Des mots ordinaires mis bout à bout (« DU VEHICULE NOMBRE D »)
 * n'ont pas assez de vrais chiffres pour passer.
 */
function vinDans(texte: string | null): string | null {
  if (!texte) return null;
  const mots = normaliser(texte).split(/[^A-Z0-9]+/).filter(Boolean);
  for (let i = 0; i < mots.length; i += 1) {
    let brut = "";
    for (let j = i; j < mots.length && brut.length < 17; j += 1) {
      brut += mots[j];
      if (brut.length !== 17) continue;
      const candidat = brut.replace(/I/g, "1").replace(/[OQ]/g, "0");
      const vraisChiffres = brut.replace(/\D/g, "").length;
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(candidat) && /[A-Z]/.test(candidat) && vraisChiffres >= 5 && /\d{4}$/.test(candidat)) return candidat;
    }
  }
  return null;
}

const premiereValeur = (texte: string | null, max = 60) => {
  const propre = texte?.replace(/\s+/g, " ").replace(/^[\s:.;,\-–—|=_]+|[\s:.;,\-–—|=_]+$/g, "").trim();
  return propre ? propre.slice(0, max) : null;
};

const GENRES: Record<string, string> = {
  VP: "Voiture particulière", VU: "Véhicule utilitaire", CTTE: "Camionnette", CAM: "Camion", TRR: "Tracteur routier", TR: "Tracteur routier",
  REM: "Remorque", SREM: "Semi-remorque", MTL: "Motocyclette", MOTO: "Motocyclette", TCP: "Transport en commun", CYCLO: "Cyclomoteur",
};
const ENERGIES: [RegExp, string][] = [
  [/^(ES|ESS|ESSENCE|SUPER)\b/, "Essence"], [/^(GO|GAS|GASOIL|GAZOLE|DIESEL)\b/, "Gasoil"], [/^(EL|ELEC|ELECTRIQUE)\b/, "Électrique"],
  [/^(HY|HYBRIDE)/, "Hybride"], [/^(GPL|GAZ)\b/, "GPL"],
];

function qualite(confiance: number, trouves: number, attendus: number): Pick<Brut, "lisibilite" | "remarques"> {
  if (confiance >= 60 && trouves >= attendus) return { lisibilite: "bonne", remarques: null };
  if (trouves >= Math.ceil(attendus / 2)) return { lisibilite: "partielle", remarques: "Certains champs n'ont pas été reconnus" };
  return { lisibilite: "mauvaise", remarques: "Peu de champs reconnus : photo floue, penchée, mal cadrée ou avec un reflet ?" };
}
const compter = (valeurs: unknown[]) => valeurs.filter((v) => v !== null && v !== undefined).length;

// ---------------------------------------------------------------------------------------------------------
// Carte grise
// ---------------------------------------------------------------------------------------------------------
function carteGrise(lectures: Ligne[][], confiance: number): Brut {
  const tout = lectures.flat().map((l) => l.texte).join("\n");
  // Les libellés se cherchent dans la lecture normale seulement : les lectures inversées mêlent les rangées et
  // ne servent qu'aux valeurs de forme connue (immatriculation, dates, châssis), départagées par un vote
  const chercher = (motsCles: string[], recherche: Recherche = {}) => valeurApres(lectures[0] ?? [], motsCles, recherche);

  // L'immatriculation précédente (verso de la carte) n'est pas celle du véhicule
  const precedente = (liste: Ligne[], n: number) => [liste[n], liste[n - 1]].some((l) => l && /PRECEDENT|ANCIEN/.test(l.normal));
  const plaques = lectures.flatMap((liste) => liste.flatMap((l, n) => (precedente(liste, n) ? [] : immatriculationsDans(l.texte)
    .map((valeur) => ({ valeur, confiance: l.confiance })))));

  // Première mise en circulation : d'après son libellé ; sinon, la plus ancienne des dates lues hors date d'édition
  // (elle la précède toujours), s'il y en a au moins deux
  const edition = (liste: Ligne[], n: number) => [liste[n], liste[n - 1]].some((l) => l && /EDITION|DELIVR|EXPIR/.test(l.normal));
  const datesLibres = [...new Set(lectures.flatMap((liste) => liste.flatMap((l, n) => (edition(liste, n) ? [] : datesDans(l.texte)))))].sort();
  const miseEnCirculation = dateDans(chercher(["CIRCULATION", "MEC"], { forme: avecDate }))
    ?? (datesLibres.length >= 2 ? datesLibres[0]! : null);

  const genreLu = premiereValeur(chercher(["GENRE"]));
  // L'énergie est l'une des valeurs connues : une lecture qui n'en donne aucune n'est pas retenue
  const energieConnue = (valeur: string) => ENERGIES.find(([motif]) => motif.test(normaliser(premiereValeur(valeur) ?? "")))?.[1] ?? null;
  const energieLue = chercher(["ENERGIE", "CARBURANT"], { forme: (v) => energieConnue(v) !== null });
  const energie = energieLue ? energieConnue(energieLue) : null;
  const pasTechnique = (l: Ligne) => !/TECHNIQUE|MINE/.test(l.normal);
  // Châssis : d'après son libellé, sinon le plus souvent lu parmi les suites de 17 caractères de toutes les lectures
  const chassis = vinDans(chercher(["VIN", "CHASSIS", "SERIE", "IDENTIFICATION"], { forme: (v) => vinDans(v) !== null }))
    ?? vote(lectures.flat().flatMap((l) => {
      const vin = vinDans(l.texte);
      return vin ? [{ valeur: vin, confiance: l.confiance }] : [];
    }));
  const champs = {
    immatriculation: vote(plaques),
    numeroChassis: chassis,
    marque: premiereValeur(chercher(["MARQUE"]), 40),
    modele: premiereValeur(chercher(["DENOMINATION", "COMMERCIAL", "MODELE", "TYPE"], { ligne: pasTechnique }), 40),
    genre: genreLu ? GENRES[normaliser(genreLu).replace(/[^A-Z]/g, "")] ?? genreLu : null,
    energie,
    puissanceFiscale: entierDans(chercher(["PUISSANCE"], { forme: avecChiffre })),
    placesAssises: entierDans(chercher(["PLACES", "ASSISES"], { forme: avecChiffre })),
    datePremiereMiseEnCirculation: miseEnCirculation,
    proprietaire: premiereValeur(chercher(["PROPRIETAIRE", "SOCIALE", "TITULAIRE", "NOM"]), 160),
    usage: premiereValeur(chercher(["USAGE"])),
  };
  const trouves = compter(Object.values(champs));
  const titre = /IMMATRICULATION|CARTE GRISE|CERTIFICAT|VIN ?\/ ?CHASSIS/.test(normaliser(tout));
  return { documentReconnu: titre || trouves >= 4, ...qualite(confiance, trouves, 8), ...champs };
}

// ---------------------------------------------------------------------------------------------------------
// Pièce d'identité
// ---------------------------------------------------------------------------------------------------------
const NATIONALITES: Record<string, string> = {
  CIV: "Ivoirienne", BFA: "Burkinabè", MLI: "Malienne", SEN: "Sénégalaise", GIN: "Guinéenne", GHA: "Ghanéenne", NGA: "Nigériane",
  BEN: "Béninoise", TGO: "Togolaise", NER: "Nigérienne", LBR: "Libérienne", SLE: "Sierra-léonaise", MRT: "Mauritanienne", CMR: "Camerounaise",
  TCD: "Tchadienne", GAB: "Gabonaise", COG: "Congolaise", COD: "Congolaise (RDC)", MAR: "Marocaine", TUN: "Tunisienne", DZA: "Algérienne",
  LBN: "Libanaise", FRA: "Française", BEL: "Belge", CHE: "Suisse", DEU: "Allemande", ITA: "Italienne", ESP: "Espagnole", PRT: "Portugaise",
  GBR: "Britannique", USA: "Américaine", CAN: "Canadienne", CHN: "Chinoise", IND: "Indienne", TUR: "Turque",
};

function typeDePiece(normal: string, mrz: string[] | null): string | null {
  if (mrz?.length === 2 && mrz[0]!.startsWith("P")) return "passeport";
  if (mrz?.length === 3) {
    const code = mrz[0]!.slice(0, 2);
    if (code === "ID" || code === "I<") return "cni";
    if (["IR", "AR", "RP", "CR"].includes(code)) return "carte_sejour";
  }
  if (/PASSEPORT|PASSPORT/.test(normal)) return "passeport";
  if (/CONSULAIRE/.test(normal)) return "carte_consulaire";
  if (/RESIDEN|SEJOUR/.test(normal)) return "carte_sejour";
  if (/PERMIS DE CONDUIRE|DRIVING/.test(normal)) return "permis_conduire";
  if (/ATTESTATION/.test(normal)) return "attestation_identite";
  if (/IDENTITE|IDENTITY/.test(normal)) return "cni";
  return mrz ? "autre" : null;
}

function pieceIdentite(lignes: Ligne[], confiance: number, aujourdhui: Date): Brut {
  const normal = lignes.map((l) => l.normal).join("\n");
  // Les lignes de la zone lisible par machine ne sont pas des libellés
  const visuelles = lignes.filter((l) => !(l.normal.includes("<") && /^[^a-z]*$/.test(l.texte) && l.texte.replace(/[^A-Z0-9<]/g, "").length >= 26));
  const contient = (l: Ligne, motCle: string) => l.colonnes.some((c) => ancreDans(c, motCle) >= 0);
  const sauf = (...exclus: string[]) => (l: Ligne) => exclus.every((m) => !contient(l, m));

  // Numéro du document : un mot de 5 à 20 lettres et chiffres, dont au moins deux chiffres, à droite ou sous son libellé
  const jetonsNumero = (texte: string) =>
    texte.split(/\s+/).map((j) => j.replace(/[^A-Za-z0-9]/g, "")).filter((j) => /^[A-Z0-9]{5,20}$/i.test(j) && /\d.*\d/.test(j));
  const numeroLu = valeurApres(visuelles, ["NUMERO", "N°", "NO"], { forme: (v) => jetonsNumero(v).length > 0 });
  const numeroVisuel = numeroLu ? jetonsNumero(numeroLu).at(-1)!.toUpperCase() : null;
  // Le numéro imprimé départage les corrections possibles du numéro de la zone lisible par machine
  const mrz = extraireMrz(lignes.map((l) => l.texte), numeroVisuel ? [numeroVisuel] : []);
  const zone = mrz ? analyserMrz(mrz, aujourdhui) : null;
  const nomVisuel = premiereValeur(valeurApres(visuelles, ["NOM", "NOMS"], { ligne: sauf("PRENOMS", "PRENOM") }), 120);
  const prenomsVisuels = premiereValeur(valeurApres(visuelles, ["PRENOMS", "PRENOM"]), 160);
  const naissance = dateDans(valeurApres(visuelles, ["NAISSANCE", "NE", "NEE"], { ligne: sauf("LIEU"), forme: avecDate }));
  const lieu = premiereValeur(valeurApres(visuelles, ["NAISSANCE"], { ligne: (l) => contient(l, "LIEU"), forme: (v) => !avecDate(v) }), 120);
  const sexeLu = valeurApres(visuelles, ["SEXE"], { lettreSeule: true });
  const nationaliteLue = premiereValeur(valeurApres(visuelles, ["NATIONALITE"]));

  // Zone lisible par machine juste (chiffres de contrôle) : elle fait foi pour le numéro et les dates
  const sure = zone?.valide ? zone : null;
  const champs = {
    typePiece: typeDePiece(normal, mrz),
    numero: sure?.numero ?? numeroVisuel,
    nom: nomVisuel ?? (zone?.nom || null),
    prenoms: prenomsVisuels ?? (zone?.prenoms || null),
    dateNaissance: sure?.dateNaissance ?? naissance,
    lieuNaissance: lieu,
    sexe: sure?.sexe ?? (sexeLu ? (/^\s*F/i.test(sexeLu) ? "F" : /^\s*[MH]/i.test(sexeLu) ? "M" : null) : null),
    // Le code du pays n'est pas couvert par un chiffre de contrôle à lui seul, mais il ne fait que trois lettres
    nationalite: (sure ? NATIONALITES[sure.nationalite] : undefined) ?? nationaliteLue
      ?? (zone ? NATIONALITES[zone.nationalite] ?? (zone.nationalite || null) : null),
    dateDelivrance: dateDans(valeurApres(visuelles, ["DELIVRANCE", "DELIVRE", "DELIVREE", "EMISSION", "ETABLI", "ETABLIE"], { forme: avecDate })),
    dateExpiration: sure?.dateExpiration ?? dateDans(valeurApres(visuelles, ["EXPIRATION", "EXPIRE", "VALABLE", "VALIDITE"], { forme: avecDate })),
    mrz,
  };
  const trouves = compter([champs.numero, champs.nom, champs.prenoms, champs.dateNaissance, champs.dateExpiration, champs.sexe]);
  const lecture = qualite(confiance, trouves, 5);
  // Numéro imprimé différent de celui de la zone, pourtant juste : la personne doit regarder la pièce
  if (sure && numeroVisuel && numeroVisuel !== sure.numero) {
    Object.assign(lecture, { lisibilite: "partielle", remarques: `le numéro imprimé se lit ${numeroVisuel}, la zone lisible par machine donne ${sure.numero}` });
  }
  return { documentReconnu: Boolean(mrz) || champs.typePiece !== null, ...lecture, ...champs };
}

// ---------------------------------------------------------------------------------------------------------
// Constat amiable
// ---------------------------------------------------------------------------------------------------------
const HEURE = /(?<!\d)([01]?\d|2[0-3]) ?[H:h] ?([0-5]\d)(?!\d)/;

function constat(lignes: Ligne[], confiance: number): Brut {
  const tout = lignes.map((l) => l.texte).join("\n");
  const plaques: string[] = [];
  for (const l of lignes) {
    for (const plaque of immatriculationsDans(l.texte)) if (!plaques.includes(plaque)) plaques.push(plaque);
  }
  const heureTrouvee = HEURE.exec(chiffres(valeurApres(lignes, ["HEURE"], { forme: (v) => HEURE.test(chiffres(v)) }) ?? tout));
  const champs = {
    date: dateDans(valeurApres(lignes, ["DATE"], { forme: avecDate })) ?? dateDans(tout),
    heure: heureTrouvee ? `${heureTrouvee[1]!.padStart(2, "0")}:${heureTrouvee[2]}` : null,
    lieu: premiereValeur(valeurApres(lignes, ["LIEU", "LOCALISATION"]), 300),
    blesses: null,
    degatsAutres: null,
    temoins: null,
    vehicules: plaques.slice(0, 2).map((immatriculation, i) => ({
      lettre: i === 0 ? "A" : "B", immatriculation, conducteur: null, assure: null, assureur: null, numeroPolice: null, numeroAttestation: null,
      marque: null, circonstances: [], pointDeChoc: null, degatsApparents: null, observations: null,
    })),
    croquis: null,
  };
  return {
    documentReconnu: /CONSTAT|AMIABLE|ACCIDENT/.test(normaliser(tout)),
    // Un constat est rempli à la main : la lecture locale n'en reprend que les valeurs bien formées
    lisibilite: confiance >= 40 && (champs.date || plaques.length > 0) ? "partielle" : "mauvaise",
    remarques: "Lecture locale d'un document manuscrit : seules la date, l'heure, le lieu et les immatriculations sont repris. Complétez le reste avec le constat",
    ...champs,
  };
}

/** Champs bruts d'un document, à partir du texte reconnu (à passer ensuite par `nettoyer`) */
export function analyserTexte(document: TypeDocument, lu: TexteLu, aujourdhui = new Date()): Brut {
  const lignes = preparerLignes(lu.lignes);
  if (document === "carte_grise") return carteGrise([lignes, ...lu.lignesClaires.map(preparerLignes)], lu.confiance);
  if (document === "piece_identite") return pieceIdentite(lignes, lu.confiance, aujourdhui);
  return constat(lignes, lu.confiance);
}

/** Plusieurs faces d'un même document (recto et verso) : pour chaque champ, la première valeur lue */
export function fusionner(faces: Brut[]): Brut {
  if (faces.length <= 1) return faces[0] ?? {};
  const ordre: Record<string, number> = { bonne: 0, partielle: 1, mauvaise: 2 };
  const meilleure = [...faces].sort((a, b) => (ordre[String(a.lisibilite)] ?? 3) - (ordre[String(b.lisibilite)] ?? 3))[0]!;
  const fusion: Brut = { ...meilleure, documentReconnu: faces.some((f) => f.documentReconnu === true) };
  for (const cle of new Set(faces.flatMap((f) => Object.keys(f)))) {
    if (["documentReconnu", "lisibilite", "remarques"].includes(cle)) continue;
    const valeur = faces.map((f) => f[cle]).find((v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0));
    fusion[cle] = valeur ?? faces[0]![cle] ?? null;
  }
  return fusion;
}
