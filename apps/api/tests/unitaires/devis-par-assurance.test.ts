// Questions et documents propres à chaque assurance (devis-par-assurance.ts) : les deux exemplaires, site et API,
// restent identiques ; les réponses sont contrôlées et rendues lisibles pour le back-office et le devis.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRANCHES } from "../../src/commun/schemas.js";
import {
  LIBELLES_NATURE, NATURES_AVEC_CLASSEUR, NATURES_PIECE, PIECES_MAX, PIECES_PAR_BRANCHE, QUESTIONNAIRES, type Question,
} from "../../src/modules/demandes-site/devis-par-assurance.js";
import { descriptionDevis } from "../../src/modules/demandes-site/routes.js";
import { detailsLisibles, schemaDetails, validerDetails } from "../../src/modules/demandes-site/questionnaires.js";
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

  it("conditions : sur une question précédente à choix, avec des valeurs prévues", () => {
    for (const [branche, questions] of Object.entries(QUESTIONNAIRES)) {
      questions.forEach((q, rang) => {
        if (!q.si) return;
        const { cle, valeurs } = q.si;
        const declencheur = questions.slice(0, rang).find((p) => p.cle === cle);
        expect(declencheur?.type, `${branche}.${q.cle}`).toMatch(/^(choix|plusieurs)$/);
        if (declencheur?.type === "choix" || declencheur?.type === "plusieurs") {
          for (const v of valeurs) expect(Object.keys(declencheur.options), `${branche}.${q.cle}`).toContain(v);
        }
        expect(q.obligatoire, `${branche}.${q.cle}`).toBeFalsy();
      });
    }
  });

  it("toutes les réponses remplies au maximum tiennent dans les limites de l'API et de la base", () => {
    const auMaximum = (q: Question) => {
      switch (q.type) {
        case "texte": return "x".repeat(q.max);
        case "nombre": return q.max;
        case "date": return "2026-12-31";
        case "choix": return Object.keys(q.options)[0]!;
        case "plusieurs": return Object.keys(q.options);
      }
    };
    for (const [branche, questions] of Object.entries(QUESTIONNAIRES)) {
      expect(questions.length, branche).toBeLessThanOrEqual(schemaDetails.maxProperties);
      const reponses = Object.fromEntries(questions.map((q) => [q.cle, auMaximum(q)]));
      expect(Buffer.byteLength(JSON.stringify(reponses)), branche).toBeLessThanOrEqual(4000);
      for (const q of questions) {
        if (q.type === "plusieurs") expect(Object.keys(q.options).length, `${branche}.${q.cle}`).toBeLessThanOrEqual(20);
        if (q.type === "choix" || q.type === "plusieurs") {
          for (const v of Object.keys(q.options)) expect(v.length, `${branche}.${q.cle}.${v}`).toBeLessThanOrEqual(40);
        }
      }
    }
  });

  it("d'après les questionnaires des compagnies : produit recherché, assureur actuel, questions qui fixent le prix", () => {
    const cles = (branche: string) => QUESTIONNAIRES[branche]!.map((q) => q.cle);
    for (const branche of ["chantier_construction", "industrie_bris_de_machines"]) expect(cles(branche)[0], branche).toBe("produits");
    for (const branche of [
      "multirisque_professionnelle", "incendie_risques_divers", "responsabilite_civile", "transport_marchandises",
      "chantier_construction", "industrie_bris_de_machines", "agricole",
    ]) expect(cles(branche), branche).toContain("assureurActuel");
    expect(cles("multirisque_professionnelle")).toEqual(expect.arrayContaining(["loyerMensuel", "chiffreAffaires", "employes", "garantiesOptionnelles"]));
    expect(cles("chantier_construction")).toEqual(expect.arrayContaining(["typeOuvrage", "dateDebut", "bureauControle"]));
    expect(cles("industrie_bris_de_machines")).toEqual(expect.arrayContaining(["statutLocaux", "chiffreAffaires", "employes", "entretienMachines"]));
    expect(cles("responsabilite_civile")).toEqual(expect.arrayContaining(["typesProfessionnelle", "zone"]));
    expect(cles("agricole")).toEqual(expect.arrayContaining(["risques", "sommeAssuree", "anneePlantation", "irrigation"]));
    expect(cles("evenementiel")).toEqual(expect.arrayContaining(["jours", "securite", "dejaAssure"]));
    expect(cles("incendie_risques_divers")).toContain("violencePolitique");
  });

  it("documents : connus, sans doublon, pas plus que de pièces permises ; la flotte propose d'abord la liste des véhicules", () => {
    for (const nature of NATURES_PIECE) expect(LIBELLES_NATURE[nature], nature).toBeTruthy();
    for (const natures of Object.values(PIECES_PAR_BRANCHE)) expect(natures.length).toBeLessThanOrEqual(PIECES_MAX);
    expect(PIECES_PAR_BRANCHE.chantier_construction).toEqual(expect.arrayContaining(["rapport_sol_controle", "planning_plans", "questionnaire_compagnie"]));
    expect(PIECES_PAR_BRANCHE.agricole?.[0]).toBe("plan_plantation");
    expect(slugNature("questionnaire_compagnie")).toBe("questionnaire-de-la-compagnie-rempli");
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

  it("ne garde une réponse soumise à condition que si la question est posée", () => {
    // Le loyer d'un locataire est gardé ; la valeur du bâtiment, qui n'est demandée qu'au propriétaire, ne l'est pas
    expect(validerDetails("multirisque_professionnelle", {
      activite: "Pharmacie", statutLocaux: "locataire", loyerMensuel: 350_000, valeurBatiment: 80_000_000,
    })).toEqual({ activite: "Pharmacie", statutLocaux: "locataire", loyerMensuel: 350_000 });
    // Sans statut, ni l'un ni l'autre
    expect(validerDetails("multirisque_professionnelle", { activite: "Pharmacie", loyerMensuel: 350_000 }))
      .toEqual({ activite: "Pharmacie" });
    // Une responsabilité civile familiale ne garde ni chiffre d'affaires ni zone d'activité
    expect(validerDetails("responsabilite_civile", { type: "familiale", chiffreAffaires: 10_000_000, zone: "monde" }))
      .toEqual({ type: "familiale" });
    expect(validerDetails("responsabilite_civile", { type: "professionnelle", typesProfessionnelle: ["apres_livraison"], zone: "cedeao" }))
      .toEqual({ type: "professionnelle", typesProfessionnelle: ["apres_livraison"], zone: "cedeao" });
    // Chantier : les questions sur l'entreprise ne viennent qu'avec une responsabilité civile
    const chantier = { natureTravaux: "Immeuble R+4", chiffreAffaires: 900_000_000, partSousTraitee: 30 };
    expect(validerDetails("chantier_construction", { ...chantier, produits: ["trc_batiment"] }))
      .toEqual({ natureTravaux: "Immeuble R+4", produits: ["trc_batiment"] });
    expect(validerDetails("chantier_construction", { ...chantier, produits: ["trc_batiment", "rc_travaux"] }))
      .toEqual({ ...chantier, produits: ["trc_batiment", "rc_travaux"] });
    // Une réponse mal formée reste refusée, même à une question qui n'est pas posée
    expect(() => validerDetails("multirisque_professionnelle", { activite: "Pharmacie", loyerMensuel: -1 })).toThrow("nombre entier");
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
    expect(detailsLisibles("chantier_construction", validerDetails("chantier_construction", {
      natureTravaux: "Pont sur la Comoé", produits: ["trc_routes", "conseil"], partSousTraitee: 40,
    }))).toEqual([
      { libelle: "Assurance recherchée", valeur: "Tous risques chantier : routes et ouvrages d'art, Je ne sais pas, conseillez-moi" },
      { libelle: "Nature des travaux", valeur: "Pont sur la Comoé" },
    ]);
  });

  it("entrent dans la description du devis créé, avant le besoin du visiteur", () => {
    expect(descriptionDevis({
      nature: "devis", branche: "flotte", details: validerDetails("flotte", flotte), besoin: "Renouvellement en mars",
      echeanceActuelle: null, dateLimiteOffre: null, appelOffres: null,
    })).toBe("Nombre de véhicules : 12.\nTypes de véhicules : Tracteurs routiers, Semi-remorques et remorques.\nRenouvellement en mars");
  });
});
