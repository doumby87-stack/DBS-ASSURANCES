import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { traduireErreur } from "../../src/commun/erreurs.js";
import { chargerConfiguration } from "../../src/config/configuration.js";
import {
  chiffrerPiece, decoderBase64, dechiffrerPiece, LONGUEUR_BASE64_MAX, TAILLE_PIECE_MAX, typeReel, verifierPiece,
} from "../../src/modules/demandes-site/piece.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");

describe("Pièce jointe d'une demande du site", () => {
  it("reconnaît JPEG, PNG et PDF d'après leurs premiers octets, et rien d'autre", () => {
    expect(typeReel(JPEG)).toBe("image/jpeg");
    expect(typeReel(PNG)).toBe("image/png");
    expect(typeReel(PDF)).toBe("application/pdf");
    expect(typeReel(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(typeReel(Buffer.from("GIF89a"))).toBeNull();
    expect(typeReel(Buffer.alloc(0))).toBeNull();
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

  it("traduit les limites de la base en messages pour le visiteur", () => {
    const parAdresse = traduireErreur({ code: "23514", severity: "ERROR", constraint: "demandes_site_limite_adresse", message: "x" });
    expect(parAdresse).toMatchObject({ statut: 429, corps: { code: "trop_de_demandes" } });
    const parJour = traduireErreur({ code: "23514", severity: "ERROR", constraint: "demandes_site_limite_jour", message: "x" });
    expect(parJour).toMatchObject({ statut: 503, corps: { code: "formulaire_indisponible" } });
  });
});
