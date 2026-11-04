import { describe, expect, it } from "vitest";
import { motifRecherche, normaliserImmatriculation, normaliserTelephone } from "../../src/commun/formats.js";
import { categorieEcheance } from "../../src/modules/contrats/routes.js";

describe("Téléphone", () => {
  it.each([
    ["07 49 36 07 02", "+2250749360702"],
    ["0749360702", "+2250749360702"],
    ["07.49.36.07.02", "+2250749360702"],
    ["+225 07 49 36 07 02", "+2250749360702"],
    ["00225 07 49 36 07 02", "+2250749360702"],
    ["225 0749360702", "+2250749360702"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("« %s » devient %s", (saisie, attendu) => {
    expect(normaliserTelephone(saisie)).toBe(attendu);
  });

  it.each(["49 36 07 02", "+225 49 36 07 02", "07 49 36 07 0", "abc", "07-49-36-07-02 poste 3", "+0 12345678"])(
    "« %s » est refusé",
    (saisie) => {
      expect(normaliserTelephone(saisie)).toBeNull();
    },
  );
});

describe("Immatriculation", () => {
  it("passe en majuscules et réduit les espaces", () => {
    expect(normaliserImmatriculation("  1234  ab 01 ")).toBe("1234 AB 01");
    expect(normaliserImmatriculation("AB-1234-CI")).toBe("AB-1234-CI");
  });
  it("refuse les caractères inattendus", () => {
    expect(normaliserImmatriculation("12'; DROP")).toBeNull();
    expect(normaliserImmatriculation("ab")).toBeNull();
  });
});

describe("Recherche", () => {
  it("neutralise les jokers % et _", () => {
    expect(motifRecherche(" 100%_ ")).toBe("%100\\%\\_%");
  });
});

describe("Catégories d'échéance", () => {
  it.each([
    [-1, "expire"], [0, "j7"], [7, "j7"], [8, "j15"], [15, "j15"], [16, "j30"], [30, "j30"], [31, "j60"],
  ] as const)("%i jours : %s", (jours, categorie) => {
    expect(categorieEcheance(jours)).toBe(categorie);
  });
});
