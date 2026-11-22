// Reconnaissance de caractères sur le serveur de l'agence (tâche 14, ADR 0015) : Tesseract, logiciel libre, compilé en
// WebAssembly (tesseract.js), avec le modèle français livré par npm. Rien ne sort du serveur : ni appel réseau (le
// modèle est lu sur le disque), ni fichier écrit (pas de cache).
//
// Les photos reçues sont souvent petites (envoyées par WhatsApp), penchées, sur des fonds de couleur : avant la
// lecture, l'image est remise à l'endroit (orientation du téléphone), agrandie, passée en niveaux de gris et
// contrastée (sharp), puis Tesseract la binarise par zones (méthode de Sauvola) plutôt que d'un seul seuil. Pour
// les documents qui écrivent en blanc sur fond sombre (colonne grise de la carte grise), une seconde lecture se fait
// sur l'image inversée.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { createWorker, OEM, type Worker } from "tesseract.js";

export interface Mot {
  texte: string;
  /** Bords gauche et droit, en pixels de l'image lue */
  x0: number;
  x1: number;
}

export interface LigneLue {
  texte: string;
  /** Confiance de Tesseract, de 0 à 100 */
  confiance: number;
  mots: Mot[];
  /** Hauteur de la ligne en pixels : sert d'unité pour reconnaître les colonnes */
  hauteur: number;
}

export interface TexteLu {
  /** Lecture de l'image normale */
  lignes: LigneLue[];
  /** Lectures de l'image inversée (texte clair sur fond sombre), une par seuil ; vide si elles n'ont pas été demandées */
  lignesClaires: LigneLue[][];
  /** Confiance moyenne de la lecture normale, de 0 à 100 */
  confiance: number;
}

export interface Ocr {
  lire(image: Buffer, options?: { texteClair?: boolean }): Promise<TexteLu>;
  fermer(): Promise<void>;
}

/** Au-delà, une photo de 5 Mo au plus peut se décompresser en gigaoctets : elle n'est pas lue */
export const PIXELS_MAX = 60_000_000;

const require = createRequire(import.meta.url);
/** Modèle français « best_int » (rapide, entiers) : il lit aussi les chiffres et la zone lisible par machine */
const DOSSIER_MODELE = join(dirname(require.resolve("@tesseract.js-data/fra/package.json")), "4.0.0_best_int");

// Aucune image gardée en mémoire par sharp d'une lecture à l'autre
sharp.cache(false);

/** Grand côté visé pour la lecture : le texte d'une carte photographiée de loin doit y faire une vingtaine de pixels */
const COTE_LECTURE = { min: 3000, max: 4000 };
const COTE_CLAIR = 2400;
/** Seuils de l'image inversée : deux essais, car la teinte du fond varie d'une photo à l'autre */
const SEUILS_CLAIRS = [205, 215];

function source(image: Buffer) {
  return sharp(image, { limitInputPixels: PIXELS_MAX, failOn: "error" });
}

/** Images à lire : la normale, et si demandé les inversées ; refuse ce qui n'est ni JPEG ni PNG */
async function preparer(image: Buffer, texteClair: boolean): Promise<{ normale: Buffer; claires: Buffer[] }> {
  const meta = await source(image).metadata();
  if (meta.format !== "jpeg" && meta.format !== "png") throw new Error("Format d'image non lu");
  const cote = Math.min(Math.max(meta.width ?? 0, meta.height ?? 0, COTE_LECTURE.min), COTE_LECTURE.max);
  const grise = (taille: number) => source(image)
    .rotate()
    .resize({ width: taille, height: taille, fit: "inside", kernel: "lanczos3" })
    .grayscale()
    .normalise();
  const normale = await grise(cote).png().toBuffer();
  const claires = texteClair
    ? await Promise.all(SEUILS_CLAIRS.map((seuil) => grise(COTE_CLAIR).median(3).threshold(seuil).negate({ alpha: false }).png().toBuffer()))
    : [];
  return { normale, claires };
}

interface BlocTesseract {
  paragraphs: {
    lines: { confidence: number; bbox: { y0: number; y1: number }; words: { text: string; bbox: { x0: number; x1: number } }[] }[];
  }[];
}

function lignesDe(blocs: BlocTesseract[] | null): LigneLue[] {
  const lignes: LigneLue[] = [];
  for (const bloc of blocs ?? []) {
    for (const paragraphe of bloc.paragraphs) {
      for (const ligne of paragraphe.lines) {
        const mots = ligne.words.map((m) => ({ texte: m.text.trim(), x0: m.bbox.x0, x1: m.bbox.x1 })).filter((m) => m.texte);
        if (mots.length === 0) continue;
        lignes.push({
          texte: mots.map((m) => m.texte).join(" "), confiance: ligne.confidence, mots, hauteur: Math.max(1, ligne.bbox.y1 - ligne.bbox.y0),
        });
      }
    }
  }
  return lignes;
}

/** Un seul moteur, créé à la première lecture et gardé : il traite les images l'une après l'autre */
export function creerOcr(): Ocr {
  let moteur: Promise<Worker> | null = null;
  let file: Promise<unknown> = Promise.resolve();
  const demarrer = () => {
    moteur ??= createWorker("fra", OEM.LSTM_ONLY, {
      langPath: DOSSIER_MODELE, gzip: true, cacheMethod: "none",
      // Sans lui, une image que le moteur ne sait pas décoder lèverait une exception hors de toute requête et
      // arrêterait l'API ; l'erreur est déjà rendue à la lecture concernée
      errorHandler: () => {},
    }).catch((erreur: unknown) => {
      moteur = null;
      throw erreur;
    });
    return moteur;
  };
  const reconnaitre = async (worker: Worker, image: Buffer, sauvola: boolean) => {
    // 2 : seuil par zones (Sauvola) ; 0 : seuil unique, pour une image déjà en noir et blanc
    // Les messages de mise au point du moteur (« Image too small to scale »…) ne vont pas dans le journal de l'API
    await worker.setParameters({ thresholding_method: sauvola ? "2" : "0", debug_file: "/dev/null" } as Record<string, string>);
    const { data } = await worker.recognize(image, {}, { text: false, blocks: true });
    return { lignes: lignesDe(data.blocks as unknown as BlocTesseract[] | null), confiance: data.confidence };
  };
  return {
    lire(image, options = {}) {
      // Les réglages du moteur valent pour toutes ses lectures : une seule lecture à la fois
      const lecture = file.then(async () => {
        const { normale, claires } = await preparer(image, options.texteClair ?? false);
        const worker = await demarrer();
        const principale = await reconnaitre(worker, normale, true);
        const lignesClaires: LigneLue[][] = [];
        for (const claire of claires) lignesClaires.push((await reconnaitre(worker, claire, false)).lignes);
        return { lignes: principale.lignes, lignesClaires, confiance: principale.confiance };
      });
      file = lecture.catch(() => undefined);
      return lecture;
    },
    async fermer() {
      const enCours = moteur;
      moteur = null;
      if (enCours) await (await enCours.catch(() => null))?.terminate();
    },
  };
}

/** Largeur et hauteur annoncées par l'en-tête d'un PNG ou d'un JPEG, sans décoder l'image ; null si inconnues */
export function dimensions(image: Buffer): { largeur: number; hauteur: number } | null {
  if (image.length >= 24 && image.readUInt32BE(0) === 0x89504e47 && image.toString("latin1", 12, 16) === "IHDR") {
    return { largeur: image.readUInt32BE(16), hauteur: image.readUInt32BE(20) };
  }
  if (image[0] !== 0xff || image[1] !== 0xd8) return null;
  let position = 2;
  while (position + 9 < image.length) {
    if (image[position] !== 0xff) return null;
    const marqueur = image[position + 1]!;
    // Début d'image (SOF0 à SOF15, sauf DHT, JPG et DAC) : hauteur puis largeur
    if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
      return { hauteur: image.readUInt16BE(position + 5), largeur: image.readUInt16BE(position + 7) };
    }
    position += 2 + image.readUInt16BE(position + 2);
  }
  return null;
}

/**
 * Un PDF de scanner ou de téléphone contient la photo de chaque page en JPEG : on reprend la plus grande, telle
 * quelle. Un PDF sans photo (texte, dessin) n'est pas lu : il faut alors envoyer une photo.
 */
export function imageDuPdf(pdf: Buffer): Buffer | null {
  const texte = pdf.toString("latin1");
  let meilleure: Buffer | null = null;
  const debutFlux = /stream\r?\n/g;
  let trouve: RegExpExecArray | null;
  while ((trouve = debutFlux.exec(texte)) !== null) {
    const dictionnaire = texte.slice(Math.max(0, trouve.index - 600), trouve.index);
    const ouverture = dictionnaire.lastIndexOf("<<");
    const entete = ouverture >= 0 ? dictionnaire.slice(ouverture) : "";
    if (!/\/Subtype\s*\/Image/.test(entete) || !/\/DCTDecode/.test(entete)) continue;
    const debut = trouve.index + trouve[0].length;
    const fin = texte.indexOf("endstream", debut);
    if (fin < 0) break;
    debutFlux.lastIndex = fin + "endstream".length;
    // Longueur donnée par le dictionnaire si elle est directe ; sinon jusqu'à « endstream », sans le saut de ligne
    const longueur = /\/Length\s+(\d+)(?!\d)(?!\s+\d+\s+R)/.exec(entete);
    let finImage = longueur ? Math.min(debut + Number(longueur[1]), fin) : fin;
    while (finImage > debut && (pdf[finImage - 1] === 0x0a || pdf[finImage - 1] === 0x0d) && !longueur) finImage -= 1;
    const image = pdf.subarray(debut, finImage);
    if (image[0] === 0xff && image[1] === 0xd8 && (!meilleure || image.length > meilleure.length)) meilleure = Buffer.from(image);
  }
  return meilleure;
}
