// Questions et documents propres à chaque assurance (devis-par-assurance.ts) : les deux exemplaires, site et API,
// restent identiques ; les réponses sont contrôlées et rendues lisibles pour le back-office et le devis.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRANCHES } from "../../src/commun/schemas.js";
import {
  NATURES_AVEC_CLASSEUR, NATURES_PIECE, PIECES_PAR_BRANCHE, QUESTIONNAIRES,
} from "../../src/modules/demandes-site/devis-par-assurance.js";
import { descriptionDevis } from "../../src/modules/demandes-site/routes.js";
import { detailsLisibles, validerDetails } from "../../src/modules/demandes-site/questionnaires.js";
import { slugNature } from "../../src/modules/demandes-site/pieces-site.js";

describe("vocabulaire commun au site et à l'API", () => {
  it("les deux exemplaires sont identiques, octet pour octet", () => {
    const api = readFileSync(new URL("../../src/modules/demandes-site/devis-par-assurance.ts", import.meta.url), "utf8");
    const site = readFileSync(new URL("../../../site-vitrine/src/donnees/devis-par-assurance.ts", import.meta.url), "utf8");
    expect(site).toBe(api);
  });

  it("chaque assurance de la base a ses questions et ses documents, et seulement elles", () => {
    expect(Object.keys(QUESTIONNAIRES).sort()).toEqual([...BRANCHES].sort());
    expect(Object.keys(PIECES_PAR_BRANCHE).sort()).toEqual([...BRANCHES].sort());
  });

  it("questions bien formées : clés uniques, choix non vides, bornes cohérentes", () => {
    for (const [branche, questions] of Object.entries(QUESTIONNAIRES)) {
      const cles = questions.map((q) => q.cle);
      expect(new Set(cles).size, branche).toBe(cles.length);
      for (const q of questions) {
        if (q.type === "choix" || q.type === "plusieurs") expect(Object.keys(q.options).length, `${branche}.${q.cle}`).toBeGreaterThan(1);
        if (q.type === "nombre") expect(q.min, `${branche}.${q.cle}`).toBeLessThan(q.max);
        if (q.type === "texte") expect(q.max, `${branche}.${q.cle}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("documents : connus, sans doublon ; la flotte propose d'abord la liste des véhicules", () => {
    for (const [branche, natures] of Object.entries(PIECES_PAR_BRANCHE)) {
      expect(natures.every((n) => (NATURES_PIECE as readonly string[]).includes(n)), branche).toBe(true);
      expect(new Set(natures).size, branche).toBe(natures.length);
    }
    expect(PIECES_PAR_BRANCHE.flotte?.[0]).toBe("liste_vehicules");
    expect(NATURES_AVEC_CLASSEUR).toContain("liste_vehicules");
    expect(slugNature("liste_vehicules")).toBe("liste-des-vehicules");
    expect(slugNature("registre_commerce")).toBe("registre-de-commerce");
  });
});

describe("réponses au questionnaire", () => {
  const flotte = { nombreVehicules: 12, typesVehicules: ["tracteurs", "remorques", "tracteurs"] };

  it("garde des réponses propres : textes rognés, réponses vides et doublons retirés", () => {
    expect(validerDetails("flotte", { ...flotte, assureurActuel: "  Autre Assureur  ", usage: "compte_autrui", zones: [] }))
      .toEqual({ nombreVehicules: 12, typesVehicules: ["tracteurs", "remorques"], assureurActuel: "Autre Assureur", usage: "compte_autrui" });
    expect(validerDetails("autre", {})).toEqual({});
  });

  it("refuse une question d'une autre assurance, une réponse mal formée, une question obligatoire oubliée", () => {
    expect(() => validerDetails("habitation", { nombreVehicules: 3 })).toThrow("réponse inattendue");
    expect(() => validerDetails("flotte", { ...flotte, nombreVehicules: 1 })).toThrow("entre 2 et 5000");
    expect(() => validerDetails("flotte", { ...flotte, nombreVehicules: 2.5 })).toThrow("nombre entier");
    expect(() => validerDetails("flotte", { ...flotte, typesVehicules: ["fusees"] })).toThrow("choix invalide");
    expect(() => validerDetails("flotte", { ...flotte, usage: "piraterie" })).toThrow("choix invalide");
    expect(() => validerDetails("flotte", { ...flotte, echeanceActuelle: "2027-02-30" })).toThrow("date invalide");
    expect(() => validerDetails("flotte", { nombreVehicules: 4 })).toThrow("« Types de véhicules » : réponse obligatoire");
    expect(() => validerDetails("flotte", { ...flotte, typesVehicules: [] })).toThrow("réponse obligatoire");
    expect(() => validerDetails("automobile", { marqueModele: "x".repeat(81) })).toThrow("80 caractères au plus");
  });

  it("se lisent dans l'ordre du formulaire, avec leurs libellés et leurs unités", () => {
    const details = validerDetails("automobile", {
      garanties: "tous_risques", puissance: 7, valeur: 4_500_000, marqueModele: "Toyota Corolla", echeanceActuelle: "2027-03-15",
    });
    expect(detailsLisibles("automobile", details)).toEqual([
      { libelle: "Marque et modèle", valeur: "Toyota Corolla" },
      { libelle: "Puissance fiscale", valeur: "7 CV" },
      { libelle: "Valeur actuelle du véhicule", valeur: "4 500 000 F CFA" },
      { libelle: "Garanties souhaitées", valeur: "Tous risques" },
      { libelle: "Échéance du contrat actuel", valeur: "15/03/2027" },
    ]);
    expect(detailsLisibles("flotte", validerDetails("flotte", flotte))).toEqual([
      { libelle: "Nombre de véhicules", valeur: "12" },
      { libelle: "Types de véhicules", valeur: "Tracteurs routiers, Semi-remorques et remorques" },
    ]);
    expect(detailsLisibles("flotte", null)).toEqual([]);
  });

  it("entrent dans la description du devis créé, avant le besoin du visiteur", () => {
    expect(descriptionDevis({
      nature: "devis", branche: "flotte", details: validerDetails("flotte", flotte), besoin: "Renouvellement en mars",
      echeanceActuelle: null, dateLimiteOffre: null, appelOffres: null,
    })).toBe("Nombre de véhicules : 12.\nTypes de véhicules : Tracteurs routiers, Semi-remorques et remorques.\nRenouvellement en mars");
  });
});
