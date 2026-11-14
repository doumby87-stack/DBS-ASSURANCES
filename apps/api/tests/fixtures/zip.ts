// Archives ZIP et classeurs .xlsx fabriqués à la main, pour les tests : classeurs piégés (tableur.test.ts) et
// pièces jointes des demandes du site (listes de véhicules ou de matériel, avec ou sans macro).

import { deflateRawSync } from "node:zlib";

/** Archive ZIP minimale (éléments compressés) */
export function archive(elements: Record<string, Buffer>, options: { chiffre?: boolean } = {}): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, contenu] of Object.entries(elements)) {
    const compresse = deflateRawSync(contenu);
    const nomOctets = Buffer.from(nom);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(options.chiffre ? 1 : 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compresse.length, 18);
    local.writeUInt32LE(contenu.length, 22);
    local.writeUInt16LE(nomOctets.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(options.chiffre ? 1 : 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compresse.length, 20);
    central.writeUInt32LE(contenu.length, 24);
    central.writeUInt16LE(nomOctets.length, 28);
    central.writeUInt32LE(decalage, 42);
    locaux.push(local, nomOctets, compresse);
    centraux.push(central, nomOctets);
    decalage += 30 + nomOctets.length + compresse.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(elements).length, 8);
  fin.writeUInt16LE(Object.keys(elements).length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

const TYPES_CONTENU = (classeur: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.${classeur}.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

/** Classeur .xlsx minimal : une feuille, des cellules en texte en ligne */
export function classeurMinimal(lignes: string[][] = [["Immatriculation", "Marque"], ["AB-123-CD", "Toyota"]]): Buffer {
  const feuille = lignes
    .map((cellules, i) => `<row r="${i + 1}">${cellules.map((c, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${c}</t></is></c>`).join("")}</row>`)
    .join("");
  return archive({
    "[Content_Types].xml": Buffer.from(TYPES_CONTENU("openxmlformats-officedocument.spreadsheetml.sheet")),
    "xl/workbook.xml": Buffer.from('<workbook><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": Buffer.from(`<worksheet><sheetData>${feuille}</sheetData></worksheet>`),
  });
}

/** Classeur à macros (.xlsm renommé en .xlsx) : même structure, avec un projet VBA */
export function classeurAvecMacro(): Buffer {
  return archive({
    "[Content_Types].xml": Buffer.from(TYPES_CONTENU("ms-excel.sheet.macroEnabled")),
    "xl/workbook.xml": Buffer.from('<workbook><sheets><sheet name="Feuil1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": Buffer.from("<worksheet><sheetData/></worksheet>"),
    "xl/vbaProject.bin": Buffer.from("macro"),
  });
}
