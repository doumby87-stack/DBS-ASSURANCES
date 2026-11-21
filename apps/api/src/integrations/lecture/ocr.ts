// Reconnaissance de caractères sur le serveur de l'agence (tâche 14, ADR 0015) : Tesseract, logiciel libre, compilé en
// WebAssembly (tesseract.js), avec le modèle français livré par npm. Rien ne sort du serveur : ni appel réseau (le
// modèle est lu sur le disque), ni fichier écrit (pas de cache). L'image est décodée dans le bac à sable WebAssembly,
// après l'analyse antivirus.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createWorker, OEM, type Worker } from "tesseract.js";

export interface LigneLue {
  texte: string;
  /** Confiance de Tesseract, de 0 à 100 */
  confiance: number;
}

export interface TexteLu {
  lignes: LigneLue[];
  /** Confiance moyenne de la page, de 0 à 100 */
  confiance: number;
}

export interface Ocr {
  lire(image: Buffer): Promise<TexteLu>;
  fermer(): Promise<void>;
}

const require = createRequire(import.meta.url);
/** Modèle français « best_int » (rapide, entiers) : il lit aussi les chiffres et la zone lisible par machine */
const DOSSIER_MODELE = join(dirname(require.resolve("@tesseract.js-data/fra/package.json")), "4.0.0_best_int");

/** Un seul moteur, créé à la première lecture et gardé : il traite les images l'une après l'autre */
export function creerOcr(): Ocr {
  let moteur: Promise<Worker> | null = null;
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
  return {
    async lire(image) {
      const worker = await demarrer();
      const { data } = await worker.recognize(image, {}, { text: false, blocks: true });
      const lignes: LigneLue[] = [];
      for (const bloc of data.blocks ?? []) {
        for (const paragraphe of bloc.paragraphs) {
          for (const ligne of paragraphe.lines) {
            const texte = ligne.text.replace(/\s+/g, " ").trim();
            if (texte) lignes.push({ texte, confiance: ligne.confidence });
          }
        }
      }
      return { lignes, confiance: data.confidence };
    },
    async fermer() {
      const enCours = moteur;
      moteur = null;
      if (enCours) await (await enCours.catch(() => null))?.terminate();
    },
  };
}

/** Au-delà, une photo de 5 Mo au plus peut se décompresser en gigaoctets : elle n'est pas lue */
export const PIXELS_MAX = 60_000_000;

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
