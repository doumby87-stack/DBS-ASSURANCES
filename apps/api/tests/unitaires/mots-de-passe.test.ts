import { describe, expect, it } from "vitest";
import {
  controlerPolitique, creerVerificateurFuite, doitEtreRehache, genererMotDePasseProvisoire, hacherMotDePasse,
  verifierLeurre, verifierMotDePasse,
} from "../../src/securite/mots-de-passe.js";

describe("Mots de passe", () => {
  it("hache avec Argon2id et vérifie", async () => {
    const empreinte = await hacherMotDePasse("Un mot de passe solide 2026");
    expect(empreinte.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(empreinte).not.toContain("solide");
    expect(await verifierMotDePasse(empreinte, "Un mot de passe solide 2026")).toBe(true);
    expect(await verifierMotDePasse(empreinte, "un mot de passe solide 2026")).toBe(false);
  });

  it("répond non (sans planter) pour une empreinte invalide, et pour le leurre", async () => {
    expect(await verifierMotDePasse("pas-une-empreinte", "x")).toBe(false);
    expect(await verifierLeurre("nimporte quoi")).toBe(false);
  });

  it("repère les empreintes calculées avec d'anciens paramètres", () => {
    expect(doitEtreRehache("$argon2id$v=19$m=19456,t=2,p=1$abc$def")).toBe(false);
    expect(doitEtreRehache("$argon2id$v=19$m=4096,t=3,p=1$abc$def")).toBe(true);
    expect(doitEtreRehache("$2b$10$ancien-bcrypt")).toBe(true);
  });

  it("applique la politique", () => {
    expect(controlerPolitique("court", "a@b.ci")).toMatch(/au moins 12/);
    expect(controlerPolitique("a".repeat(129), "a@b.ci")).toMatch(/au plus 128/);
    expect(controlerPolitique("aaaaaaaaaaaabbb", "a@b.ci")).toMatch(/répétitif/);
    expect(controlerPolitique("Caisse-Yopougon-2026", "caisse@dbs.ci")).toMatch(/adresse e-mail/);
    expect(controlerPolitique("mangue verte au marché 7", "caisse@dbs.ci")).toBeNull();
  });

  it("génère des mots de passe provisoires lisibles, différents et conformes", () => {
    const vus = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const mdp = genererMotDePasseProvisoire();
      expect(mdp).toMatch(/^([A-HJ-NP-Za-hj-np-z2-9]{5}-){3}[A-HJ-NP-Za-hj-np-z2-9]{5}$/);
      expect(controlerPolitique(mdp, "x@y.ci")).toBeNull();
      vus.add(mdp);
    }
    expect(vus.size).toBe(50);
  });

  describe("vérification des fuites (k-anonymat)", () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const reponseService = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000A:0\r\n";

    it("n'envoie que les 5 premiers caractères de l'empreinte", async () => {
      const appels: string[] = [];
      const verifier = creerVerificateurFuite((async (url: string) => {
        appels.push(url);
        return new Response(reponseService);
      }) as typeof fetch);
      expect(await verifier("password")).toBe(true);
      expect(appels).toEqual(["https://api.pwnedpasswords.com/range/5BAA6"]);
    });

    it("répond non pour un mot de passe absent, ou présent avec un compteur nul (remplissage)", async () => {
      const verifier = creerVerificateurFuite((async () => new Response(reponseService)) as unknown as typeof fetch);
      expect(await verifier("mangue verte au marché 7")).toBe(false);
    });

    it("répond « inconnu » si le service ne répond pas", async () => {
      const panne = creerVerificateurFuite((async () => {
        throw new Error("réseau");
      }) as unknown as typeof fetch);
      expect(await panne("password")).toBeNull();
      const erreur = creerVerificateurFuite((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
      expect(await erreur("password")).toBeNull();
    });
  });
});
