import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chiffrer, dechiffrer } from "../../src/securite/chiffrement.js";

describe("Chiffrement AES-256-GCM", () => {
  const cle = randomBytes(32);
  const clair = Buffer.from("secret du deuxième facteur");

  it("retrouve le texte d'origine", () => {
    expect(dechiffrer(cle, chiffrer(cle, clair, "totp:a"), "totp:a").equals(clair)).toBe(true);
  });

  it("ne produit jamais deux fois le même texte chiffré", () => {
    expect(chiffrer(cle, clair, "totp:a").equals(chiffrer(cle, clair, "totp:a"))).toBe(false);
  });

  it("ne laisse pas apparaître le texte clair", () => {
    expect(chiffrer(cle, clair, "totp:a").includes(clair)).toBe(false);
  });

  it("détecte toute modification", () => {
    const chiffre = chiffrer(cle, clair, "totp:a");
    chiffre[chiffre.length - 1]! ^= 1;
    expect(() => dechiffrer(cle, chiffre, "totp:a")).toThrow();
  });

  it("refuse une valeur recopiée d'un autre utilisateur (contexte différent)", () => {
    expect(() => dechiffrer(cle, chiffrer(cle, clair, "totp:a"), "totp:b")).toThrow();
  });

  it("refuse une autre clé", () => {
    expect(() => dechiffrer(randomBytes(32), chiffrer(cle, clair, "totp:a"), "totp:a")).toThrow();
  });

  it("refuse une donnée tronquée", () => {
    expect(() => dechiffrer(cle, Buffer.from([1, 2, 3]), "totp:a")).toThrow("illisible");
  });
});
