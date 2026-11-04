// Lecture des tableaux envoyés par l'agence ou les transporteurs, et contrôle des lignes d'import de véhicules.
// Le classeur .xlsx de test est produit par LibreOffice (tests/fixtures/flotte-libreoffice.fods → .xlsx) :
// un autre logiciel que le nôtre, pour ne pas tester notre lecteur contre notre propre écriture.

import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dateExcel, ErreurTableur, lireCsv, lireTableau } from "../../src/commun/tableur.js";
import { analyserTableau, lireDate, lireEntier, normaliserEntete } from "../../src/modules/flottes/import.js";

const XLSX_LIBREOFFICE = readFileSync(new URL("../fixtures/flotte-libreoffice.xlsx", import.meta.url));

/** Archive ZIP minimale (éléments compressés), pour fabriquer des classeurs piégés */
function archive(elements: Record<string, Buffer>, options: { chiffre?: boolean } = {}): Buffer {
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

describe("Lecture d'un classeur Excel (.xlsx)", () => {
  it("lit un vrai classeur LibreOffice : textes partagés, accents, nombres, dates en série, cellules vides", () => {
    const tableau = lireTableau(XLSX_LIBREOFFICE);
    expect(tableau.format).toBe("xlsx");
    expect(tableau.lignes[0]).toEqual([
      "Immatriculation", "Marque", "Modèle", "Genre", "Puissance fiscale (CV)", "Valeur vénale",
      "Visite technique", "Vignette", "Carte de transport",
    ]);
    expect(tableau.lignes[1]?.slice(0, 6)).toEqual(["1234 AB 01", "Renault & Trucks", "Série T", "Tracteur routier", "12", "45000000"]);
    expect(dateExcel(Number(tableau.lignes[1]?.[6]))).toBe("2026-11-24");
    expect(tableau.lignes[1]?.[7]).toBe("");
    expect(dateExcel(Number(tableau.lignes[1]?.[8]))).toBe("2027-01-31");
    expect(tableau.lignes[2]?.[6]).toBe("05/03/2027");
  });

  it("refuse les classeurs piégés : bombe de décompression, mot de passe, ancien format, archive cassée", () => {
    const enorme = Buffer.alloc(30 * 1024 * 1024, 0x41);
    expect(() => lireTableau(archive({ "xl/workbook.xml": enorme }))).toThrow(/trop volumineux/);
    expect(() => lireTableau(archive({ "xl/workbook.xml": Buffer.from("<workbook/>") }, { chiffre: true }))).toThrow(/mot de passe/);
    expect(() => lireTableau(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toThrow(/Ancien format Excel/);
    expect(() => lireTableau(XLSX_LIBREOFFICE.subarray(0, 2000))).toThrow(ErreurTableur);
    expect(() => lireTableau(archive({ "mimetype": Buffer.from("x") }))).toThrow(/pas un classeur Excel/);
    expect(() => lireTableau(Buffer.alloc(3 * 1024 * 1024, 0x41))).toThrow(/2 Mo/);
  });

  it("convertit les numéros de série Excel en dates, calendrier 1904 compris", () => {
    expect(dateExcel(46350)).toBe("2026-11-24");
    expect(dateExcel(46350 - 1462, true)).toBe("2026-11-24");
    expect(dateExcel(0)).toBeNull();
  });
});

describe("Lecture d'un CSV", () => {
  it("point-virgule (Excel en français), BOM, guillemets avec séparateurs et retours à la ligne", () => {
    const csv = Buffer.from('﻿Immatriculation;Marque;Usage\r\n1234 AB 01;"Renault; Trucks";"Livraison\nurbaine"\r\n', "utf8");
    expect(lireCsv(csv)).toEqual([["Immatriculation", "Marque", "Usage"], ["1234 AB 01", "Renault; Trucks", "Livraison\nurbaine"]]);
  });

  it("virgule ou tabulation, et fichiers enregistrés en Windows-1252", () => {
    expect(lireCsv(Buffer.from("Immatriculation,Marque\n1234 AB 01,Toyota\n"))).toEqual([["Immatriculation", "Marque"], ["1234 AB 01", "Toyota"]]);
    expect(lireCsv(Buffer.from("Immatriculation\tMarque\n1234 AB 01\tIsuzu\n"))[1]).toEqual(["1234 AB 01", "Isuzu"]);
    expect(lireCsv(Buffer.from("Immatriculation;Modèle\n1234 AB 01;Série T\n", "latin1"))[0]).toEqual(["Immatriculation", "Modèle"]);
  });
});

describe("Contrôle des lignes d'import", () => {
  it("reconnaît les en-têtes, avec ou sans accents ni majuscules", () => {
    expect(normaliserEntete("  Puissance fiscale (CV) ")).toBe("puissance fiscale cv");
    expect(normaliserEntete("N° de CHÂSSIS")).toBe("n de chassis");
    expect(normaliserEntete("Échéance visite technique")).toBe("echeance visite technique");
  });

  it("lit les dates et les montants comme on les écrit", () => {
    const csv = { format: "csv" as const, calendrier1904: false };
    expect(lireDate("24/11/2026", csv)).toBe("2026-11-24");
    expect(lireDate("4-1-2027", csv)).toBe("2027-01-04");
    expect(lireDate("2026-11-24", csv)).toBe("2026-11-24");
    expect(lireDate("31/02/2027", csv)).toBeNull();
    expect(lireDate("46350", csv)).toBeNull();
    expect(lireDate("46350", { format: "xlsx", calendrier1904: false })).toBe("2026-11-24");
    expect(lireEntier("45 000 000")).toBe(45000000);
    expect(lireEntier("45.000.000 F CFA")).toBe(45000000);
    expect(lireEntier("12 CV")).toBe(12);
    expect(lireEntier("12,5")).toBeNull();
    expect(lireEntier("-3")).toBeNull();
  });

  it("le classeur LibreOffice passe sans erreur", () => {
    const analyse = analyserTableau(lireTableau(XLSX_LIBREOFFICE));
    expect(analyse.erreurs).toEqual([]);
    expect(analyse.lignes.map((l) => l.vehicule)).toEqual([
      {
        immatriculation: "1234 AB 01", numeroChassis: null, marque: "Renault & Trucks", modele: "Série T", genre: "Tracteur routier",
        usage: null, puissanceFiscale: 12, valeurVenale: 45000000, echeanceVisiteTechnique: "2026-11-24", echeanceVignette: null,
        echeanceCarteTransport: "2027-01-31",
      },
      {
        immatriculation: "5678 CD 01", numeroChassis: null, marque: "Toyota", modele: "Hilux", genre: "Camionnette",
        usage: null, puissanceFiscale: 9, valeurVenale: null, echeanceVisiteTechnique: "2027-03-05", echeanceVignette: "2026-12-15",
        echeanceCarteTransport: null,
      },
    ]);
  });

  it("rend toutes les erreurs d'un coup, avec la ligne, la colonne et la valeur", () => {
    const csv = Buffer.from([
      "Immat;Marque;CV;Valeur vénale;Vignette;Remarque",
      "1234 AB 01;Toyota;9;12 000 000;31/03/2027;ok",
      ";Isuzu;;;;",
      "",
      "1234-ab-01;Isuzu;150;douze millions;31/02/2027;",
      "AB;Renault;12;;;",
    ].join("\n"));
    const analyse = analyserTableau(lireTableau(csv));
    expect(analyse.colonnes).toEqual(["Immatriculation", "Marque", "Puissance fiscale (CV)", "Valeur vénale", "Vignette"]);
    expect(analyse.ignorees).toEqual(["Remarque"]);
    expect(analyse.lignes.map((l) => l.ligne)).toEqual([2]);
    expect(analyse.erreurs.map((e) => [e.ligne, e.colonne, e.message.split(" ")[0]])).toEqual([
      [3, "Immatriculation", "Immatriculation"],
      [5, "Immatriculation", "Véhicule"],
      [5, "Puissance fiscale (CV)", "Puissance"],
      [5, "Valeur vénale", "Valeur"],
      [5, "Vignette", "Date"],
      [6, "Immatriculation", "Immatriculation"],
    ]);
    expect(analyse.erreurs[1]?.message).toBe("Véhicule déjà présent à la ligne 2 du fichier.");
  });

  it("sans colonne Immatriculation, le fichier est refusé d'emblée", () => {
    const analyse = analyserTableau(lireTableau(Buffer.from("Plaque minéralogique;Marque\nAB 12;Toyota\n")));
    expect(analyse.erreurs).toEqual([
      { ligne: 1, colonne: "", valeur: "", message: "Colonne « Immatriculation » introuvable dans la première ligne du fichier." },
    ]);
  });
});
