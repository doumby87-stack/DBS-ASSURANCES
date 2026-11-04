// Archive ZIP des attestations : structure lisible par tout logiciel (en-têtes, répertoire central, CRC-32),
// noms en UTF-8, et codes de connexion du portail.

import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import { creerZip, nomDeFichier } from "../../src/commun/zip.js";
import { creerEmpreinteCode, genererCode } from "../../src/modules/portail/connexion.js";

/** Lecture indépendante d'une archive « stored » : répertoire central, puis chaque en-tête local. */
function lireZip(zip: Buffer): { nom: string; contenu: Buffer; crc: number }[] {
  const fin = zip.length - 22;
  expect(zip.readUInt32LE(fin)).toBe(0x06054b50);
  const nombre = zip.readUInt16LE(fin + 10);
  let position = zip.readUInt32LE(fin + 16);
  const fichiers = [];
  for (let i = 0; i < nombre; i += 1) {
    expect(zip.readUInt32LE(position)).toBe(0x02014b50);
    expect(zip.readUInt16LE(position + 8) & 0x0800).toBe(0x0800);
    const crc = zip.readUInt32LE(position + 16);
    const taille = zip.readUInt32LE(position + 24);
    const longueurNom = zip.readUInt16LE(position + 28);
    const decalage = zip.readUInt32LE(position + 42);
    const nom = zip.subarray(position + 46, position + 46 + longueurNom).toString("utf8");
    expect(zip.readUInt32LE(decalage)).toBe(0x04034b50);
    const debut = decalage + 30 + zip.readUInt16LE(decalage + 26) + zip.readUInt16LE(decalage + 28);
    fichiers.push({ nom, contenu: zip.subarray(debut, debut + taille), crc });
    position += 46 + longueurNom;
  }
  return fichiers;
}

describe("Archive ZIP", () => {
  it("range chaque fichier tel quel, avec son nom et sa somme de contrôle", () => {
    const pdf1 = Buffer.from("%PDF-1.4 attestation 1");
    const pdf2 = Buffer.from("%PDF-1.4 attestation 2 — véhicule 1234 AB 01");
    const zip = creerZip([{ nom: "attestation-1234-AB-01.pdf", contenu: pdf1 }, { nom: "attestation-éèà.pdf", contenu: pdf2 }],
      new Date("2026-11-04T10:30:00Z"));
    const fichiers = lireZip(zip);
    expect(fichiers.map((f) => f.nom)).toEqual(["attestation-1234-AB-01.pdf", "attestation-éèà.pdf"]);
    expect(fichiers[0]!.contenu.equals(pdf1)).toBe(true);
    expect(fichiers[1]!.contenu.equals(pdf2)).toBe(true);
    expect(fichiers[1]!.crc).toBe(crc32(pdf2) >>> 0);
  });

  it("une archive vide reste valide", () => {
    expect(lireZip(creerZip([]))).toEqual([]);
  });

  it("nomme les fichiers sans espace ni caractère spécial", () => {
    expect(nomDeFichier("1234 AB 01")).toBe("1234-AB-01");
    expect(nomDeFichier("Transports Kouamé & Fils")).toBe("Transports-Kouame-Fils");
    expect(nomDeFichier("../../etc/passwd")).toBe("etc-passwd");
    expect(nomDeFichier("///")).toBe("document");
  });
});

describe("Codes de connexion au portail", () => {
  it("six chiffres, tirés au hasard", () => {
    const codes = new Set(Array.from({ length: 200 }, () => genererCode()));
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(codes.size).toBeGreaterThan(190);
  });

  it("l'empreinte dépend de la clé et du numéro : le même code pour un autre numéro ne marche pas", () => {
    const empreinte = creerEmpreinteCode(Buffer.alloc(32, 7));
    const autreCle = creerEmpreinteCode(Buffer.alloc(32, 8));
    expect(empreinte("+2250716000001", "123456").equals(empreinte("+2250716000001", "123456"))).toBe(true);
    expect(empreinte("+2250716000001", "123456").equals(empreinte("+2250716000002", "123456"))).toBe(false);
    expect(empreinte("+2250716000001", "123456").equals(autreCle("+2250716000001", "123456"))).toBe(false);
    expect(empreinte("+2250716000001", "123456")).toHaveLength(32);
  });
});
