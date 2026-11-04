// Montant en lettres (reçus) et export CSV protégé contre l'injection de formules.

import { describe, expect, it } from "vitest";
import { celluleCsv, documentCsv } from "../../src/commun/csv.js";
import { montantEnLettres, nombreEnLettres } from "../../src/commun/montant-en-lettres.js";

describe("Nombre en lettres", () => {
  it.each([
    [0, "zéro"],
    [1, "un"],
    [16, "seize"],
    [17, "dix-sept"],
    [21, "vingt et un"],
    [22, "vingt-deux"],
    [61, "soixante et un"],
    [70, "soixante-dix"],
    [71, "soixante et onze"],
    [77, "soixante-dix-sept"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent un"],
    [200, "deux cents"],
    [201, "deux cent un"],
    [1000, "mille"],
    [1001, "mille un"],
    [2000, "deux mille"],
    [52_000, "cinquante-deux mille"],
    [80_000, "quatre-vingt mille"],
    [200_000, "deux cent mille"],
    [280_000, "deux cent quatre-vingt mille"],
    [1_000_000, "un million"],
    [2_500_000, "deux millions cinq cent mille"],
    [280_000_000, "deux cent quatre-vingts millions"],
    [1_000_000_000, "un milliard"],
    [1_000_000_000_000, "mille milliards"],
  ])("%i → %s", (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  it("refuse les nombres négatifs ou décimaux", () => {
    expect(() => nombreEnLettres(-1)).toThrow(RangeError);
    expect(() => nombreEnLettres(1.5)).toThrow(RangeError);
  });
});

describe("Montant en lettres", () => {
  it("accorde « franc » et ajoute « de » après million et milliard", () => {
    expect(montantEnLettres(1)).toBe("un franc CFA");
    expect(montantEnLettres(52_000)).toBe("cinquante-deux mille francs CFA");
    expect(montantEnLettres(1_000_000)).toBe("un million de francs CFA");
    expect(montantEnLettres(1_000_200)).toBe("un million deux cents francs CFA");
  });

  it("écrit une contre-passation en négatif", () => {
    expect(montantEnLettres(-32_000)).toBe("moins trente-deux mille francs CFA");
  });
});

describe("CSV", () => {
  it("neutralise les formules en tête de texte", () => {
    expect(celluleCsv("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(celluleCsv("+225 07")).toBe("'+225 07");
    expect(celluleCsv("-Koné")).toBe("'-Koné");
    expect(celluleCsv("@SOMME")).toBe("'@SOMME");
    expect(celluleCsv("\tcache")).toBe("'\tcache");
  });

  it("laisse les nombres négatifs intacts et entoure les séparateurs de guillemets", () => {
    expect(celluleCsv(-32_000)).toBe("-32000");
    expect(celluleCsv("Bamba; Fils")).toBe("\"Bamba; Fils\"");
    expect(celluleCsv("ligne\nsuivante")).toBe("\"ligne\nsuivante\"");
    expect(celluleCsv(null)).toBe("");
  });

  it("produit un fichier lisible par Excel en français", () => {
    const csv = documentCsv([["Reçu", "Montant"], [12, 50_000]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Reçu;Montant\r\n12;50000\r\n");
  });
});
