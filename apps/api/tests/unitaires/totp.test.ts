import { describe, expect, it } from "vitest";
import {
  codeTotp, decoderBase32, encoderBase32, pasDeTemps, uriOtpauth, verifierCodeTotp,
} from "../../src/securite/totp.js";

describe("TOTP (RFC 6238)", () => {
  // Vecteurs de test officiels de la RFC 6238, annexe B (SHA-1, 8 chiffres)
  const secretRfc = Buffer.from("12345678901234567890", "ascii");
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("à %i s, le code est %s", (secondes, attendu) => {
    expect(codeTotp(secretRfc, pasDeTemps(secondes * 1000), 8)).toBe(attendu);
  });

  it("encode et décode en base32 (RFC 4648)", () => {
    expect(encoderBase32(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(decoderBase32("mzxw 6ytb oi").toString()).toBe("foobar");
    expect(() => decoderBase32("MZXW1")).toThrow();
  });

  const secret = Buffer.from("secret-de-test-0123456789", "utf8");
  const maintenant = 1_800_000_000_000;
  const pas = pasDeTemps(maintenant);

  it("accepte le code courant et tolère 30 secondes de décalage", () => {
    expect(verifierCodeTotp(secret, codeTotp(secret, pas), maintenant, null)).toBe(pas);
    expect(verifierCodeTotp(secret, codeTotp(secret, pas - 1), maintenant, null)).toBe(pas - 1);
    expect(verifierCodeTotp(secret, codeTotp(secret, pas + 1), maintenant, null)).toBe(pas + 1);
  });

  it("refuse un code trop ancien ou trop en avance", () => {
    expect(verifierCodeTotp(secret, codeTotp(secret, pas - 2), maintenant, null)).toBeNull();
    expect(verifierCodeTotp(secret, codeTotp(secret, pas + 2), maintenant, null)).toBeNull();
  });

  it("refuse un code déjà utilisé, ou d'un pas antérieur au dernier accepté", () => {
    expect(verifierCodeTotp(secret, codeTotp(secret, pas), maintenant, pas)).toBeNull();
    expect(verifierCodeTotp(secret, codeTotp(secret, pas - 1), maintenant, pas)).toBeNull();
    expect(verifierCodeTotp(secret, codeTotp(secret, pas + 1), maintenant, pas)).toBe(pas + 1);
  });

  it("refuse tout ce qui n'est pas 6 chiffres", () => {
    for (const code of ["", "12345", "1234567", "12345a", " 123456"]) {
      expect(verifierCodeTotp(secret, code, maintenant, null)).toBeNull();
    }
  });

  it("produit l'adresse à scanner pour l'application d'authentification", () => {
    const uri = uriOtpauth(Buffer.from("foobar"), "gerant@exemple.ci");
    expect(uri).toBe(
      "otpauth://totp/DBS-ASSURANCES%3Agerant%40exemple.ci?secret=MZXW6YTBOI&issuer=DBS-ASSURANCES&algorithm=SHA1&digits=6&period=30",
    );
  });
});
