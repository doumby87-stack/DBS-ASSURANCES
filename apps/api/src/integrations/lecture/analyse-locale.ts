// Lecteur local (tâche 14, ADR 0015) : du texte reconnu par Tesseract aux champs d'un document. Les libellés sont
// retrouvés malgré les accents et une faute de reconnaissance par mot ; les valeurs qui ont une forme connue
// (immatriculation, numéro de châssis, dates, zone lisible par machine) sont cherchées d'après cette forme et
// corrigées des confusions habituelles (O et 0, I et 1…). Le résultat passe ensuite par le même nettoyage que les
// autres lecteurs, puis par les contrôles, et une personne vérifie tout avant d'enregistrer.

import type { TypeDocument } from "./documents.js";
import { analyserMrz, extraireMrz } from "./mrz.js";
import type { TexteLu } from "./ocr.js";

type Brut = Record<string, unknown>;

/** Majuscules sans accents, caractère par caractère : les positions restent celles de la ligne d'origine */
function normaliser(texte: string): string {
  return [...texte].map((c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()[0] ?? " ").join("");
}

/** Distance d'édition, bornée : seuls 0, 1 et « plus » nous intéressent */
function procheDe(mot: string, cible: string): boolean {
  if (mot === cible) return true;
  if (cible.length < 6 || Math.abs(mot.length - cible.length) > 1) return false;
  let i = 0;
  let j = 0;
  let ecarts = 0;
  while (i < mot.length && j < cible.length) {
    if (mot[i] === cible[j]) {
      i += 1;
      j += 1;
      continue;
    }
    ecarts += 1;
    if (ecarts > 1) return false;
    if (mot.length > cible.length) i += 1;
    else if (mot.length < cible.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return ecarts + (mot.length - i) + (cible.length - j) <= 1;
}

interface Ligne {
  texte: string;
  normal: string;
}

/** Position juste après le mot-clé dans la ligne, ou -1 */
function apresMotCle(ligne: Ligne, motCle: string): number {
  for (const mot of ligne.normal.matchAll(/[A-Z0-9°]+/g)) {
    if (procheDe(mot[0], motCle)) return mot.index + mot[0].length;
  }
  return -1;
}

const LIBELLE_SEUL = /^[\s:.;,\-–—|/)]*(\([^)]*\))?[\s:.;,\-–—|/]*/;

interface Recherche {
  /** Ne regarder que les lignes qui passent ce filtre */
  ligne?: (ligne: Ligne) => boolean;
  /** Forme attendue de la valeur (un chiffre, une date…) : sinon, la valeur est cherchée sur la ligne suivante */
  forme?: (valeur: string) => boolean;
}

/** Valeur qui suit le premier mot-clé trouvé : sur la même ligne, sinon sur la suivante */
function valeurApres(lignes: Ligne[], motsCles: string[], { ligne: accepter = () => true, forme = () => true }: Recherche = {}): string | null {
  for (const motCle of motsCles) {
    for (let n = 0; n < lignes.length; n += 1) {
      const ligne = lignes[n]!;
      if (!accepter(ligne)) continue;
      const position = apresMotCle(ligne, motCle);
      if (position < 0) continue;
      const reste = ligne.texte.slice(position).replace(LIBELLE_SEUL, "").trim();
      if (reste && forme(reste)) return reste;
      const suivante = lignes[n + 1]?.texte.trim();
      if (suivante && forme(suivante)) return suivante;
    }
  }
  return null;
}
const avecChiffre = (valeur: string) => /\d/.test(chiffres(valeur));
const avecDate = (valeur: string) => dateDans(valeur) !== null;

/** Dans une valeur numérique, un O est un 0 et un I ou un l est un 1 */
const chiffres = (texte: string) => texte.replace(/(?<=\d)[OoQD]|[OoQD](?=\d)/g, "0").replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, "1");

/** JJ/MM/AAAA (ou avec des points, des tirets, des espaces) → AAAA-MM-JJ */
function dateDans(texte: string | null, aujourdhui = new Date()): string | null {
  if (!texte) return null;
  const trouve = /(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{4}|\d{2})(?!\d)/.exec(chiffres(texte));
  if (!trouve) return null;
  const jour = Number(trouve[1]);
  const mois = Number(trouve[2]);
  let annee = Number(trouve[3]);
  if (trouve[3]!.length === 2) annee += annee > aujourdhui.getUTCFullYear() % 100 ? 1900 : 2000;
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

function entierDans(texte: string | null): number | null {
  const trouve = texte ? /\d{1,3}/.exec(chiffres(texte)) : null;
  return trouve ? Number(trouve[0]) : null;
}

/** Immatriculation ivoirienne : 1 à 4 chiffres, 2 lettres, 2 chiffres (code de la région) */
const IMMATRICULATION = /(?<![A-Z0-9])(\d{1,4}) ?([A-Z]{2}) ?(\d{2})(?![A-Z0-9])/;
function immatriculationDans(texte: string | null): string | null {
  const trouve = texte ? IMMATRICULATION.exec(normaliser(texte)) : null;
  return trouve ? `${trouve[1]} ${trouve[2]} ${trouve[3]}` : null;
}

/**
 * Numéro de châssis (VIN) : 17 caractères, jamais I, O ni Q (ce sont des 1 et des 0 mal lus). Il peut être imprimé
 * en plusieurs groupes : on essaie les mots consécutifs de la ligne qui, mis bout à bout, font 17 caractères.
 */
function vinDans(texte: string | null): string | null {
  if (!texte) return null;
  const mots = normaliser(texte).split(/[^A-Z0-9]+/).filter(Boolean).map((m) => m.replace(/I/g, "1").replace(/[OQ]/g, "0"));
  for (let i = 0; i < mots.length; i += 1) {
    let candidat = "";
    for (let j = i; j < mots.length && candidat.length < 17; j += 1) {
      candidat += mots[j];
      if (candidat.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(candidat) && /\d/.test(candidat) && /[A-Z]/.test(candidat)) return candidat;
    }
  }
  return null;
}

const premiereValeur = (texte: string | null, max = 60) => {
  const propre = texte?.replace(/\s+/g, " ").replace(/^[\s:.;,\-–—|]+|[\s:.;,\-–—|]+$/g, "").trim();
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
  if (confiance >= 75 && trouves >= attendus) return { lisibilite: "bonne", remarques: null };
  if (trouves >= Math.ceil(attendus / 2)) return { lisibilite: "partielle", remarques: "Certains champs n'ont pas été reconnus" };
  return { lisibilite: "mauvaise", remarques: "Peu de champs reconnus : photo floue, penchée, mal cadrée ou avec un reflet ?" };
}
const compter = (valeurs: unknown[]) => valeurs.filter((v) => v !== null && v !== undefined).length;

// ---------------------------------------------------------------------------------------------------------
function carteGrise(lignes: Ligne[], confiance: number): Brut {
  const tout = lignes.map((l) => l.texte).join("\n");
  const ligneImmat = (l: Ligne) => apresMotCle(l, "IMMATRICULATION") >= 0 || apresMotCle(l, "IMMAT") >= 0;
  const immatriculation = immatriculationDans(lignes.filter(ligneImmat).map((l) => l.texte).join(" ")) ?? immatriculationDans(tout);
  const numeroChassis = vinDans(valeurApres(lignes, ["SERIE", "CHASSIS", "VIN", "IDENTIFICATION"]))
    ?? lignes.map((l) => vinDans(l.texte)).find((vin) => vin !== null) ?? null;
  const genreLu = premiereValeur(valeurApres(lignes, ["GENRE"]));
  const energieLue = premiereValeur(valeurApres(lignes, ["ENERGIE", "CARBURANT"]), 30);
  const energie = energieLue ? ENERGIES.find(([motif]) => motif.test(normaliser(energieLue)))?.[1] ?? energieLue : null;
  const champs = {
    immatriculation,
    numeroChassis,
    marque: premiereValeur(valeurApres(lignes, ["MARQUE"]), 40),
    modele: premiereValeur(valeurApres(lignes, ["DENOMINATION", "MODELE", "TYPE"]), 40),
    genre: genreLu ? GENRES[normaliser(genreLu).replace(/[^A-Z]/g, "")] ?? genreLu : null,
    energie,
    puissanceFiscale: entierDans(valeurApres(lignes, ["PUISSANCE"], { forme: avecChiffre })),
    placesAssises: entierDans(valeurApres(lignes, ["PLACES", "ASSISES"], { forme: avecChiffre })),
    datePremiereMiseEnCirculation: dateDans(valeurApres(lignes, ["CIRCULATION", "MEC"], { forme: avecDate })),
    proprietaire: premiereValeur(valeurApres(lignes, ["SOCIALE", "TITULAIRE", "PROPRIETAIRE", "NOM"]), 160),
    usage: premiereValeur(valeurApres(lignes, ["USAGE"])),
  };
  const trouves = compter(Object.values(champs));
  const titre = /IMMATRICULATION|CARTE GRISE|CERTIFICAT/.test(normaliser(tout));
  return { documentReconnu: titre || trouves >= 4, ...qualite(confiance, trouves, 8), ...champs };
}

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
  const mrz = extraireMrz(lignes.map((l) => l.texte));
  const zone = mrz ? analyserMrz(mrz, aujourdhui) : null;
  // Les lignes de la zone lisible par machine ne sont pas des libellés
  const visuelles = mrz ? lignes.filter((l) => !/^[A-Z0-9<\s]{26,}$/.test(l.normal) || !l.normal.includes("<")) : lignes;
  const sauf = (...exclus: string[]) => (l: Ligne) => exclus.every((m) => apresMotCle(l, m) < 0);

  const numeroVisuel = (() => {
    for (const l of visuelles) {
      if (!/(^|[^A-Z])N[°O0](?![A-Z0-9])|NUMERO/.test(l.normal)) continue;
      const jetons = l.texte.split(/\s+/).map((j) => j.replace(/[^A-Za-z0-9]/g, "")).filter((j) => /^[A-Z0-9]{5,20}$/i.test(j) && /\d.*\d/.test(j));
      if (jetons.length > 0) return jetons[jetons.length - 1]!.toUpperCase();
    }
    return null;
  })();
  const nomVisuel = premiereValeur(valeurApres(visuelles, ["NOM"], { ligne: sauf("PRENOMS", "PRENOM") }), 120);
  const prenomsVisuels = premiereValeur(valeurApres(visuelles, ["PRENOMS", "PRENOM"]), 160);
  const naissance = dateDans(valeurApres(visuelles, ["NAISSANCE", "NE", "NEE"], { ligne: sauf("LIEU"), forme: avecDate }));
  const lieu = premiereValeur(valeurApres(visuelles, ["NAISSANCE"], { ligne: (l) => apresMotCle(l, "LIEU") >= 0 }), 120);
  const sexeLu = valeurApres(visuelles, ["SEXE"]);
  const nationaliteLue = premiereValeur(valeurApres(visuelles, ["NATIONALITE"]));

  // Zone lisible par machine juste (chiffres de contrôle) : elle fait foi pour le numéro et les dates
  const sure = zone?.valide ? zone : null;
  const champs = {
    typePiece: typeDePiece(normal, mrz),
    numero: sure?.numero ?? numeroVisuel,
    nom: nomVisuel ?? (zone?.nom || null),
    prenoms: prenomsVisuels ?? (zone?.prenoms || null),
    dateNaissance: sure?.dateNaissance ?? naissance,
    lieuNaissance: lieu && !dateDans(lieu) ? lieu : null,
    sexe: sure?.sexe ?? (sexeLu ? (/^\s*F/i.test(sexeLu) ? "F" : /^\s*[MH]/i.test(sexeLu) ? "M" : null) : null),
    nationalite: nationaliteLue ?? (zone ? NATIONALITES[zone.nationalite] ?? (zone.nationalite || null) : null),
    dateDelivrance: dateDans(valeurApres(visuelles, ["DELIVRANCE", "DELIVRE", "DELIVREE", "EMISSION", "ETABLI", "ETABLIE"], { forme: avecDate })),
    dateExpiration: sure?.dateExpiration ?? dateDans(valeurApres(visuelles, ["EXPIRATION", "EXPIRE", "VALABLE", "VALIDITE"], { forme: avecDate })),
    mrz,
  };
  const trouves = compter([champs.numero, champs.nom, champs.prenoms, champs.dateNaissance, champs.dateExpiration, champs.sexe]);
  return { documentReconnu: Boolean(mrz) || champs.typePiece !== null, ...qualite(confiance, trouves, 5), ...champs };
}

// ---------------------------------------------------------------------------------------------------------
const HEURE = /(?<!\d)([01]?\d|2[0-3]) ?[H:h] ?([0-5]\d)(?!\d)/;

function constat(lignes: Ligne[], confiance: number): Brut {
  const tout = lignes.map((l) => l.texte).join("\n");
  const plaques: string[] = [];
  for (const l of lignes) {
    const plaque = immatriculationDans(l.texte);
    if (plaque && !plaques.includes(plaque)) plaques.push(plaque);
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
  const lignes = lu.lignes.map((l) => ({ texte: l.texte, normal: normaliser(l.texte) }));
  if (document === "carte_grise") return carteGrise(lignes, lu.confiance);
  if (document === "piece_identite") return pieceIdentite(lignes, lu.confiance, aujourdhui);
  return constat(lignes, lu.confiance);
}
