// Archive ZIP sans dépendance, pour télécharger des documents en lot (attestations du portail).
// Les fichiers sont rangés tels quels (méthode « stored ») : un PDF est déjà compressé. Noms en UTF-8.
// Format : https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (en-têtes locaux, répertoire central,
// fin du répertoire central), sans ZIP64 : 65 535 fichiers et 4 Go au plus, très au-delà de nos besoins.

import { crc32 } from "node:zlib";

export interface FichierZip {
  nom: string;
  contenu: Buffer;
}

const TAILLE_MAX = 0xffff_fffe;

/** Date et heure au format MS-DOS (heure locale de l'agence : Abidjan, UTC+0). */
function dateDos(date: Date): { heure: number; jour: number } {
  return {
    heure: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    jour: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function creerZip(fichiers: FichierZip[], date = new Date()): Buffer {
  if (fichiers.length > 0xffff) throw new Error("Trop de fichiers pour une archive ZIP");
  const { heure, jour } = dateDos(date);
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;

  for (const fichier of fichiers) {
    const nom = Buffer.from(fichier.nom, "utf8");
    const taille = fichier.contenu.length;
    if (taille > TAILLE_MAX || decalage > TAILLE_MAX) throw new Error("Archive ZIP trop volumineuse");
    const somme = crc32(fichier.contenu) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature de l'en-tête local
    local.writeUInt16LE(20, 4); // version nécessaire : 2.0
    local.writeUInt16LE(0x0800, 6); // nom en UTF-8
    local.writeUInt16LE(0, 8); // méthode : stored
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(jour, 12);
    local.writeUInt32LE(somme, 14);
    local.writeUInt32LE(taille, 18);
    local.writeUInt32LE(taille, 22);
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);
    locaux.push(local, nom, fichier.contenu);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature du répertoire central
    central.writeUInt16LE(20, 4); // créé par : 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(heure, 12);
    central.writeUInt16LE(jour, 14);
    central.writeUInt32LE(somme, 16);
    central.writeUInt32LE(taille, 20);
    central.writeUInt32LE(taille, 24);
    central.writeUInt16LE(nom.length, 28);
    // extra, commentaire, disque, attributs internes : zéro ; attributs externes : zéro
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, nom);

    decalage += local.length + nom.length + taille;
  }

  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); // fin du répertoire central
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

/** Nom de fichier sûr : lettres, chiffres, tirets ; « 1234 AB 01 » → « 1234-AB-01 ». */
export function nomDeFichier(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
}
