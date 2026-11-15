import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { traduireErreur } from "../../src/commun/erreurs.js";
import { chargerConfiguration } from "../../src/config/configuration.js";
import {
  chiffrerPiece, decoderBase64, dechiffrerPiece, LONGUEUR_BASE64_MAX, TAILLE_PIECE_MAX, TYPE_CLASSEUR, typeReel, verifierPiece,
} from "../../src/modules/demandes-site/piece.js";
import * as piecesApi from "../../src/modules/demandes-site/pieces-site.js";
import { archive, classeurAvecMacro, classeurMinimal } from "../fixtures/zip.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");

describe("Pièce jointe d'une demande du site", () => {
  it("reconnaît JPEG, PNG, PDF et archive ZIP (classeur) d'après leurs premiers octets, et rien d'autre", () => {
    expect(typeReel(JPEG)).toBe("image/jpeg");
    expect(typeReel(PNG)).toBe("image/png");
    expect(typeReel(PDF)).toBe("application/pdf");
    expect(typeReel(classeurMinimal())).toBe(TYPE_CLASSEUR);
    expect(typeReel(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(typeReel(Buffer.from("GIF89a"))).toBeNull();
    expect(typeReel(Buffer.alloc(0))).toBeNull();
  });

  it("n'accepte un classeur que lisible, en .xlsx et sans macro", () => {
    expect(verifierPiece(TYPE_CLASSEUR, classeurMinimal().toString("base64"))).toMatchObject({ ok: true, type: TYPE_CLASSEUR });
    expect(verifierPiece(TYPE_CLASSEUR, classeurAvecMacro().toString("base64"))).toEqual({ ok: false, raison: "classeur_illisible" });
    // Archive ZIP qui n'est pas un classeur, classeur protégé par mot de passe
    expect(verifierPiece(TYPE_CLASSEUR, archive({ "mimetype": Buffer.from("x") }).toString("base64"))).toEqual({ ok: false, raison: "classeur_illisible" });
    expect(verifierPiece(TYPE_CLASSEUR, archive({ "xl/workbook.xml": Buffer.from("<workbook/>") }, { chiffre: true }).toString("base64")))
      .toEqual({ ok: false, raison: "classeur_illisible" });
    // Un classeur annoncé comme PDF, ou l'inverse, est refusé comme avant
    expect(verifierPiece("application/pdf", classeurMinimal().toString("base64"))).toEqual({ ok: false, raison: "type_refuse" });
    expect(verifierPiece(TYPE_CLASSEUR, PDF.toString("base64"))).toEqual({ ok: false, raison: "type_refuse" });
  });

  it("décode le base64 strictement : un caractère parasite rend la pièce illisible", () => {
    expect(decoderBase64(PNG.toString("base64"))?.equals(PNG)).toBe(true);
    expect(decoderBase64("iVBO R0==")).toBeNull();
    expect(decoderBase64("iVBORw0")).toBeNull();
    expect(decoderBase64("")).toBeNull();
  });

  it("refuse une pièce dont le contenu ne correspond pas au type annoncé, ou trop lourde", () => {
    expect(verifierPiece("image/png", PNG.toString("base64"))).toMatchObject({ ok: true, type: "image/png" });
    expect(verifierPiece("application/pdf", PNG.toString("base64"))).toEqual({ ok: false, raison: "type_refuse" });
    const tropLourde = Buffer.concat([JPEG, Buffer.alloc(TAILLE_PIECE_MAX)]);
    expect(verifierPiece("image/jpeg", tropLourde.toString("base64"))).toEqual({ ok: false, raison: "trop_volumineuse" });
    expect(LONGUEUR_BASE64_MAX).toBeGreaterThanOrEqual(Math.ceil(TAILLE_PIECE_MAX / 3) * 4);
  });

  it("chiffre la pièce, liée à son identifiant, et détecte une altération", () => {
    const cle = randomBytes(32);
    const { id, contenuChiffre, empreinte } = chiffrerPiece(cle, PDF);
    expect(contenuChiffre.length).toBe(PDF.length + 29);
    expect(dechiffrerPiece(cle, id, contenuChiffre, empreinte).equals(PDF)).toBe(true);
    expect(() => dechiffrerPiece(cle, chiffrerPiece(cle, PDF).id, contenuChiffre, empreinte)).toThrow();
    const altere = Buffer.from(contenuChiffre);
    altere[altere.length - 1]! ^= 0x01;
    expect(() => dechiffrerPiece(cle, id, altere, empreinte)).toThrow();
  });
});

describe("Pièces jointes selon l'assurance", () => {
  it("chaque assurance propose au moins « autre document », et seules les listes acceptent un classeur", () => {
    for (const natures of Object.values(piecesApi.PIECES_PAR_BRANCHE)) {
      expect(natures).toContain("autre");
      expect(new Set(natures).size).toBe(natures.length);
    }
    expect(piecesApi.NATURES_AVEC_CLASSEUR).toEqual(["liste_vehicules", "liste_materiel"]);
    expect(piecesApi.PIECES_PAR_BRANCHE.automobile[0]).toBe("carte_grise");
    expect(piecesApi.PIECES_PAR_BRANCHE.flotte[0]).toBe("liste_vehicules");
  });

  it("donne des noms de fichiers sûrs", () => {
    expect(piecesApi.slugNature("carte_grise")).toBe("carte-grise");
    expect(piecesApi.slugNature("registre_commerce")).toBe("registre-de-commerce-ou-patente");
    expect(piecesApi.slugNature("attestation_precedente")).toBe("attestation-ou-contrat-d-assurance-actuel");
    for (const nature of piecesApi.NATURES_PIECE) expect(piecesApi.slugNature(nature)).toMatch(/^[a-z0-9-]+$/);
  });

  it("le site et l'API parlent le même vocabulaire", async () => {
    // Chemin calculé : le fichier du site n'entre pas dans la compilation de l'API, seulement dans ce test
    const chemin = new URL("../../../site-vitrine/src/donnees/pieces.ts", import.meta.url).pathname;
    const site = (await import(/* @vite-ignore */ chemin)) as typeof piecesApi & { TAILLE_PIECE_MAX: number; AIDES_NATURE: Record<string, string> };
    expect(site.NATURES_PIECE).toEqual(piecesApi.NATURES_PIECE);
    expect(site.LIBELLES_NATURE).toEqual(piecesApi.LIBELLES_NATURE);
    expect(site.NATURES_AVEC_CLASSEUR).toEqual(piecesApi.NATURES_AVEC_CLASSEUR);
    expect(site.PIECES_PAR_BRANCHE).toEqual(piecesApi.PIECES_PAR_BRANCHE);
    expect(site.PIECES_RAPPEL).toEqual(piecesApi.PIECES_RAPPEL);
    expect(site.PIECES_APPEL_OFFRES).toEqual(piecesApi.PIECES_APPEL_OFFRES);
    expect(site.PIECES_MAX).toBe(piecesApi.PIECES_MAX);
    expect(site.TAILLE_PIECE_MAX).toBe(TAILLE_PIECE_MAX);
    expect(site.TAILLE_PIECES_TOTAL_MAX).toBe(piecesApi.TAILLE_PIECES_TOTAL_MAX);
    for (const nature of piecesApi.NATURES_PIECE) expect(site.AIDES_NATURE[nature]).toBeTruthy();
  });
});

describe("Configuration du site vitrine", () => {
  const valide = {
    DATABASE_URL: "postgres://dbs_application:secret@db:5432/dbs",
    CLE_CHIFFREMENT_DONNEES: randomBytes(32).toString("base64"),
    URL_BACK_OFFICE: "https://gestion.exemple.ci",
  };

  it("sans adresse du site, la route publique des demandes n'est pas ouverte", () => {
    expect(chargerConfiguration(valide).origineSite).toBeNull();
    expect(chargerConfiguration({ ...valide, URL_SITE_VITRINE: "https://www.exemple.ci/devis/" }).origineSite).toBe("https://www.exemple.ci");
  });

  it("refuse une adresse invalide, en http en production, ou identique au back-office", () => {
    expect(() => chargerConfiguration({ ...valide, URL_SITE_VITRINE: "www.exemple.ci" })).toThrow("URL_SITE_VITRINE");
    expect(() => chargerConfiguration({ ...valide, NODE_ENV: "production", URL_SITE_VITRINE: "http://www.exemple.ci" }))
      .toThrow("https");
    expect(() => chargerConfiguration({ ...valide, URL_SITE_VITRINE: "https://gestion.exemple.ci/site" })).toThrow("différentes");
  });

  it("exige l'antivirus en production dès que le site envoie des demandes", () => {
    const production = { ...valide, NODE_ENV: "production", URL_SITE_VITRINE: "https://www.exemple.ci" };
    expect(() => chargerConfiguration(production)).toThrow("ANTIVIRUS_ADRESSE est obligatoire");
    expect(chargerConfiguration({ ...production, ANTIVIRUS_ADRESSE: "clamav:3310" }).antivirus).toEqual({ hote: "clamav", port: 3310 });
    expect(chargerConfiguration({ ...valide, NODE_ENV: "production" }).antivirus).toBeNull();
    expect(() => chargerConfiguration({ ...valide, ANTIVIRUS_ADRESSE: "tcp://clamav" })).toThrow("ANTIVIRUS_ADRESSE");
  });

  it("traduit les limites de la base en messages pour le visiteur", () => {
    const parAdresse = traduireErreur({ code: "23514", severity: "ERROR", constraint: "demandes_site_limite_adresse", message: "x" });
    expect(parAdresse).toMatchObject({ statut: 429, corps: { code: "trop_de_demandes" } });
    const parJour = traduireErreur({ code: "23514", severity: "ERROR", constraint: "demandes_site_limite_jour", message: "x" });
    expect(parJour).toMatchObject({ statut: 503, corps: { code: "formulaire_indisponible" } });
  });
});
