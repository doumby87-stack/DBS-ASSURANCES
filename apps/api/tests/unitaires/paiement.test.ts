import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chargerConfiguration, ErreurConfiguration } from "../../src/config/configuration.js";
import { creerPrestataireSimulation, estSimulation } from "../../src/integrations/paiement/prestataire.js";
import { creerLimiteVerifications } from "../../src/modules/paiements/conclusion.js";
import {
  chiffrerPieceSinistre, dechiffrerPieceSinistre, nomAffiche, nomDeTelechargement,
} from "../../src/modules/sinistres/pieces.js";

const valide = {
  DATABASE_URL: "postgres://dbs_application:secret-tres-confidentiel@db:5432/dbs",
  CLE_CHIFFREMENT_DONNEES: randomBytes(32).toString("base64"),
  URL_BACK_OFFICE: "https://gestion.exemple.ci",
};

function problemes(env: Record<string, string>): string {
  try {
    chargerConfiguration(env);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurConfiguration);
    return (erreur as Error).message;
  }
  return "";
}

describe("Configuration du paiement en ligne", () => {
  it("absente par défaut : le paiement en ligne n'est pas proposé", () => {
    expect(chargerConfiguration(valide).paiement).toBeNull();
  });

  it("simulation hors production, avec un plafond par paiement", () => {
    expect(chargerConfiguration({ ...valide, PAIEMENT_PRESTATAIRE: "simulation" }).paiement)
      .toEqual({ prestataire: "simulation", montantMax: 2_000_000 });
    expect(chargerConfiguration({ ...valide, PAIEMENT_PRESTATAIRE: "simulation", PAIEMENT_MONTANT_MAX: "500000" }).paiement?.montantMax)
      .toBe(500_000);
    expect(problemes({ ...valide, PAIEMENT_PRESTATAIRE: "simulation", PAIEMENT_MONTANT_MAX: "50" })).toContain("PAIEMENT_MONTANT_MAX");
  });

  it("refuse un prestataire inconnu, et la simulation en production", () => {
    expect(problemes({ ...valide, PAIEMENT_PRESTATAIRE: "cinetpay" })).toContain("seul « simulation » est disponible");
    expect(problemes({ ...valide, NODE_ENV: "production", PAIEMENT_PRESTATAIRE: "simulation" }))
      .toContain("PAIEMENT_PRESTATAIRE=simulation est interdit en production");
  });
});

describe("Prestataire simulé", () => {
  const demande = {
    reference: "DBS-00000001", montant: 5000, description: "Prime", telephone: "+2250700000000", nomClient: "Test",
    urlRetour: "https://espace.exemple.ci/paiements/1", urlNotification: "https://espace.exemple.ci/api/paiements/notifications/simulation",
  };

  it("renvoie vers la page de retour, puis donne le résultat choisi", async () => {
    const prestataire = creerPrestataireSimulation();
    expect(estSimulation(prestataire)).toBe(true);
    expect(await prestataire.verifier(demande.reference)).toBeNull();
    expect(await prestataire.initier(demande)).toEqual({ ok: true, urlPaiement: demande.urlRetour });
    expect((await prestataire.verifier(demande.reference))?.resultat).toBe("en_attente");
    prestataire.simuler(demande.reference, true, 5000, "MTN_MOMO");
    expect(await prestataire.verifier(demande.reference)).toEqual({
      resultat: "accepte", montant: 5000, moyen: "MTN_MOMO", referenceOperateur: "SIMULATION-DBS-00000001",
    });
    prestataire.simuler(demande.reference, false, 5000);
    expect((await prestataire.verifier(demande.reference))?.resultat).toBe("refuse");
  });

  it("n'accepte aucune notification : rien n'est cru sans vérification", () => {
    expect(creerPrestataireSimulation().lireNotification({ reference: "DBS-00000001", statut: "accepte" }, {})).toBeNull();
  });
});

describe("Limite des vérifications auprès du prestataire", () => {
  it("une vérification par paiement par intervalle", () => {
    const peutVerifier = creerLimiteVerifications(60_000);
    expect(peutVerifier("a")).toBe(true);
    expect(peutVerifier("a")).toBe(false);
    expect(peutVerifier("b")).toBe(true);
    expect(creerLimiteVerifications(0)("a")).toBe(true);
  });
});

describe("Pièces des sinistres", () => {
  it("noms sans chemin ni caractère de contrôle ; nom de téléchargement sûr, extension du type réel", () => {
    expect(nomAffiche("C:\\Users\\Awa\\constat amiable.pdf")).toBe("constat amiable.pdf");
    expect(nomAffiche("../../etc/passwd")).toBe("passwd");
    expect(nomAffiche("photo\u0000\n.png")).toBe("photo.png");
    expect(nomAffiche("   ")).toBe("document");
    expect(nomDeTelechargement("Choc arrière.jpeg", "image/jpeg")).toBe("Choc-arriere.jpg");
    expect(nomDeTelechargement('a"b.pdf', "application/pdf")).toBe("a-b.pdf");
  });

  it("chiffrement lié à la pièce : recopiée sur une autre, elle ne se déchiffre plus", () => {
    const cle = randomBytes(32);
    const contenu = Buffer.from("%PDF-1.4 constat");
    const { contenuChiffre, empreinte } = chiffrerPieceSinistre(cle, "piece-1", contenu);
    expect(dechiffrerPieceSinistre(cle, "piece-1", contenuChiffre, empreinte).equals(contenu)).toBe(true);
    expect(() => dechiffrerPieceSinistre(cle, "piece-2", contenuChiffre, empreinte)).toThrow();
  });
});
