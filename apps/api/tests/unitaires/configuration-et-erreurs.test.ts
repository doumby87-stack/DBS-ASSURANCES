import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { traduireErreur, ErreurApi } from "../../src/commun/erreurs.js";
import { chargerConfiguration, ErreurConfiguration } from "../../src/config/configuration.js";
import { empreinteJeton, genererJeton } from "../../src/securite/jetons.js";

const valide = {
  DATABASE_URL: "postgres://dbs_application:secret-tres-confidentiel@db:5432/dbs",
  CLE_CHIFFREMENT_DONNEES: randomBytes(32).toString("base64"),
  URL_BACK_OFFICE: "https://gestion.exemple.ci/connexion",
};

describe("Configuration", () => {
  it("accepte une configuration complète et garde l'origine seule", () => {
    const config = chargerConfiguration(valide);
    expect(config.origineBackOffice).toBe("https://gestion.exemple.ci");
    expect(config.cleChiffrement.length).toBe(32);
    expect(config.hote).toBe("127.0.0.1");
    expect(config.verifierMotsDePasseDivulgues).toBe(true);
  });

  it("liste tout ce qui manque, sans jamais afficher de valeur", () => {
    try {
      chargerConfiguration({ DATABASE_URL: valide.DATABASE_URL, CLE_CHIFFREMENT_DONNEES: "trop-court" });
      expect.unreachable();
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfiguration);
      const message = (erreur as Error).message;
      expect(message).toContain("CLE_CHIFFREMENT_DONNEES doit contenir 32 octets");
      expect(message).toContain("URL_BACK_OFFICE est obligatoire");
      expect(message).not.toContain("secret-tres-confidentiel");
      expect(message).not.toContain("trop-court");
    }
  });

  it("exige HTTPS pour le back-office en production", () => {
    expect(() => chargerConfiguration({ ...valide, NODE_ENV: "production", URL_BACK_OFFICE: "http://gestion.exemple.ci" }))
      .toThrow("https");
  });
});

describe("Erreurs renvoyées au navigateur", () => {
  it("transmet le message d'une règle métier de la base, pas celui d'une contrainte technique", () => {
    const regle = traduireErreur({ code: "23514", severity: "ERROR", message: "Plafond des espèces dépassé : …" });
    expect(regle).toEqual({ statut: 422, corps: { code: "regle_metier", message: "Plafond des espèces dépassé : …" } });
    const contrainte = traduireErreur({
      code: "23514", severity: "ERROR", constraint: "clients_telephone_format",
      message: 'new row for relation "clients" violates check constraint "clients_telephone_format"',
    });
    expect(JSON.stringify(contrainte)).not.toContain("clients");
  });

  it("donne un message précis pour les contrôles de caisse connus, sans reprendre le texte de la base", () => {
    const doublon = traduireErreur({
      code: "23505", severity: "ERROR", constraint: "encaissements_reference_unique",
      message: 'duplicate key value violates unique constraint "encaissements_reference_unique"',
    });
    expect(doublon).toMatchObject({ statut: 409, corps: { code: "reference_deja_utilisee" } });
    expect(JSON.stringify(doublon)).not.toContain("encaissements");
    const quatreYeux = traduireErreur({
      code: "23514", severity: "ERROR", constraint: "reversements_quatre_yeux", message: "violates check constraint",
    });
    expect(quatreYeux).toMatchObject({ statut: 403, corps: { code: "quatre_yeux" } });
  });

  it("traduit les refus de droits et les sessions invalides", () => {
    expect(traduireErreur({ code: "42501", severity: "ERROR", message: "new row violates row-level security policy" }).statut).toBe(403);
    expect(traduireErreur({ code: "28000", severity: "ERROR", message: "Utilisateur inconnu ou désactivé" }).statut).toBe(401);
  });

  it("ne révèle rien d'une erreur inattendue", () => {
    const { statut, corps } = traduireErreur(new Error("relation \"securite.identifiants\" does not exist at 10.0.0.5"));
    expect(statut).toBe(500);
    expect(JSON.stringify(corps)).not.toMatch(/securite|10\.0\.0\.5/);
  });

  it("garde les erreurs prévues telles quelles", () => {
    expect(traduireErreur(new ErreurApi(409, "conflit", "Déjà là")).corps).toEqual({ code: "conflit", message: "Déjà là" });
  });
});

describe("Jetons de session", () => {
  it("sont longs, aléatoires, et seule leur empreinte est calculée", () => {
    const a = genererJeton();
    const b = genererJeton();
    expect(a.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.jeton).not.toBe(b.jeton);
    expect(a.empreinte.length).toBe(32);
    expect(empreinteJeton(a.jeton)!.equals(a.empreinte)).toBe(true);
  });

  it("une forme invalide ne donne aucune empreinte (rien n'est demandé à la base)", () => {
    for (const jeton of [undefined, "", "court", "' OR 1=1 --".padEnd(43, "x"), "a".repeat(44)]) {
      expect(empreinteJeton(jeton)).toBeNull();
    }
  });
});
