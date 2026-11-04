// Tests de sécurité de la connexion du personnel, contre une vraie base PostgreSQL.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeTotp, decoderBase32, pasDeTemps } from "../../src/securite/totp.js";
import {
  adresseUnique, codeCourant, connecter, cookieDe, creerCompte, demarrer, envoyer, type Contexte,
} from "../integration/outils.js";

let ctx: Contexte;
beforeAll(async () => {
  ctx = await demarrer();
});
afterAll(async () => {
  await ctx.fermer();
});

describe("Accès sans connexion", () => {
  it("toute route protégée est refusée", async () => {
    for (const url of ["/auth/session", "/utilisateurs"]) {
      const reponse = await envoyer(ctx, { url });
      expect(reponse.statusCode).toBe(401);
      expect(reponse.json().code).toBe("non_authentifie");
    }
  });

  it("un cookie inventé est refusé", async () => {
    const reponse = await envoyer(ctx, { url: "/auth/session", cookie: `__Host-dbs_session=${"A".repeat(43)}` });
    expect(reponse.statusCode).toBe(401);
  });
});

describe("Connexion", () => {
  it("même réponse pour un compte inconnu et un mauvais mot de passe", async () => {
    const compte = await creerCompte(ctx, "caissier");
    const inconnu = await envoyer(ctx, { url: "/auth/connexion", corps: { email: adresseUnique("inconnu"), motDePasse: "x" } });
    const mauvais = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: "mauvais" } });
    expect(inconnu.statusCode).toBe(401);
    expect(mauvais.statusCode).toBe(401);
    expect(inconnu.json()).toEqual(mauvais.json());
    expect(cookieDe(inconnu)).toBeUndefined();
  });

  it("parcours complet : deuxième facteur à configurer, puis mot de passe provisoire à changer", async () => {
    const compte = await creerCompte(ctx, "charge_clientele");
    const connexion = await envoyer(ctx, {
      url: "/auth/connexion", corps: { email: compte.email.toUpperCase(), motDePasse: compte.motDePasse },
    });
    expect(connexion.json()).toEqual({ etape: "configuration_mfa" });
    const partielle = cookieDe(connexion)!;

    // Mot de passe seul : aucun accès aux données
    expect((await envoyer(ctx, { url: "/utilisateurs", cookie: partielle })).statusCode).toBe(401);
    expect((await envoyer(ctx, { url: "/auth/session", cookie: partielle })).statusCode).toBe(401);

    const configuration = await envoyer(ctx, { methode: "POST", url: "/auth/mfa/configuration", cookie: partielle });
    expect(configuration.statusCode).toBe(200);
    expect(configuration.json().uri).toMatch(/^otpauth:\/\/totp\/DBS-ASSURANCES/);

    const mauvais = await envoyer(ctx, { url: "/auth/mfa/activation", cookie: partielle, corps: { code: "000000" } });
    expect(mauvais.statusCode).toBe(401);
    expect(mauvais.json().code).toBe("code_invalide");

    compte.secret = decoderBase32(configuration.json().secret);
    const activation = await envoyer(ctx, {
      url: "/auth/mfa/activation", cookie: partielle, corps: { code: codeCourant(ctx, compte) },
    });
    expect(activation.statusCode).toBe(200);
    expect(activation.json()).toEqual({ etape: "terminee", motDePasseProvisoire: true });
    const complete = cookieDe(activation)!;
    expect(complete).not.toBe(partielle); // nouveau jeton à chaque changement de niveau

    // L'ancien jeton ne sert plus
    expect((await envoyer(ctx, { url: "/auth/mfa", cookie: partielle, corps: { code: "123456" } })).statusCode).toBe(401);

    // Mot de passe provisoire : seuls la session et le changement de mot de passe sont permis
    const bloque = await envoyer(ctx, { url: "/utilisateurs", cookie: complete });
    expect(bloque.statusCode).toBe(403);
    expect(bloque.json().code).toBe("mot_de_passe_a_changer");
    const session = await envoyer(ctx, { url: "/auth/session", cookie: complete });
    expect(session.json().utilisateur).toEqual({ id: compte.id, email: compte.email, nom: "Test charge_clientele", role: "charge_clientele" });

    const faible = await envoyer(ctx, { url: "/auth/mot-de-passe", cookie: complete, corps: { actuel: compte.motDePasse, nouveau: "court" } });
    expect(faible.statusCode).toBe(422);
    expect(faible.json().code).toBe("mot_de_passe_trop_faible");

    const changement = await envoyer(ctx, {
      url: "/auth/mot-de-passe", cookie: complete, corps: { actuel: compte.motDePasse, nouveau: "Le fleuve Comoé en saison sèche" },
    });
    expect(changement.statusCode).toBe(200);
    const apresChangement = cookieDe(changement)!;
    expect(apresChangement).not.toBe(complete);
    expect((await envoyer(ctx, { url: "/utilisateurs", cookie: complete })).statusCode).toBe(401);
    expect((await envoyer(ctx, { url: "/utilisateurs", cookie: apresChangement })).statusCode).toBe(200);
  });

  it("le cookie de session est HttpOnly, Secure, SameSite=Strict et préfixé __Host-", async () => {
    const compte = await creerCompte(ctx, "commercial");
    const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: compte.motDePasse } });
    const cookie = connexion.cookies.find((c) => c.name === "__Host-dbs_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect(cookie.domain).toBeUndefined();
    const expire = new Date(cookie.expires!).getTime();
    expect(expire - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000 + 5_000); // session partielle : 5 minutes
  });

  it("un code du deuxième facteur ne sert qu'une seule fois", async () => {
    const compte = await creerCompte(ctx, "caissier");
    await connecter(ctx, compte);
    const code = codeTotp(compte.secret!, pasDeTemps(ctx.horloge.ms)); // dernier code utilisé
    const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: compte.motDePasse } });
    expect(connexion.json().etape).toBe("mfa");
    const rejeu = await envoyer(ctx, { url: "/auth/mfa", cookie: cookieDe(connexion), corps: { code } });
    expect(rejeu.statusCode).toBe(401);
    expect(rejeu.json().code).toBe("code_invalide");
  });

  it("les secrets ne sont jamais stockés en clair", async () => {
    const compte = await creerCompte(ctx, "auditeur");
    await connecter(ctx, compte);
    const { rows } = await ctx.base.query(
      "SELECT hash_mot_de_passe, totp_secret_chiffre FROM securite.identifiants WHERE utilisateur_id = $1", [compte.id],
    );
    expect(rows[0].hash_mot_de_passe).toMatch(/^\$argon2id\$/);
    expect(rows[0].hash_mot_de_passe).not.toContain(compte.motDePasse);
    expect((rows[0].totp_secret_chiffre as Buffer).includes(compte.secret!)).toBe(false);
    const sessions = await ctx.base.query("SELECT empreinte FROM securite.sessions WHERE utilisateur_id = $1", [compte.id]);
    for (const { empreinte } of sessions.rows) expect((empreinte as Buffer).length).toBe(32);
  });
});

describe("Limitation des tentatives", () => {
  it("cinq échecs bloquent le compte, même avec le bon mot de passe ensuite, et ferment ses sessions", async () => {
    const compte = await creerCompte(ctx, "caissier");
    const session = await connecter(ctx, compte);
    expect((await envoyer(ctx, { url: "/auth/session", cookie: session })).statusCode).toBe(200);

    for (let i = 0; i < 5; i += 1) {
      const echec = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: `faux-${i}` } });
      expect(echec.statusCode).toBe(401);
    }
    const bonMotDePasse = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: compte.motDePasse } });
    expect(bonMotDePasse.statusCode).toBe(401);
    expect((await envoyer(ctx, { url: "/auth/session", cookie: session })).statusCode).toBe(401);

    const { rows } = await ctx.base.query(
      "SELECT type FROM securite.evenements WHERE utilisateur_id = $1 AND type = 'compte_bloque'", [compte.id],
    );
    expect(rows.length).toBe(1);
  });

  it("les échecs du deuxième facteur comptent aussi", async () => {
    const compte = await creerCompte(ctx, "commercial");
    await connecter(ctx, compte);
    const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email: compte.email, motDePasse: compte.motDePasse } });
    const partielle = cookieDe(connexion);
    for (let i = 0; i < 5; i += 1) {
      await envoyer(ctx, { url: "/auth/mfa", cookie: partielle, corps: { code: "000000" } });
    }
    // Le bon code ne suffit plus : le compte est bloqué
    const correct = await envoyer(ctx, { url: "/auth/mfa", cookie: partielle, corps: { code: codeCourant(ctx, compte) } });
    expect(correct.statusCode).toBe(401);
  });

  it("vingt échecs depuis une même adresse suspendent les tentatives depuis cette adresse", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 20; i += 1) {
      await envoyer(ctx, { url: "/auth/connexion", corps: { email: adresseUnique("robot"), motDePasse: "x" }, ip });
    }
    const suspendu = await envoyer(ctx, { url: "/auth/connexion", corps: { email: adresseUnique("robot"), motDePasse: "x" }, ip });
    expect(suspendu.statusCode).toBe(429);
    expect(suspendu.json().code).toBe("trop_de_tentatives");
    const autreAdresse = await envoyer(ctx, { url: "/auth/connexion", corps: { email: adresseUnique("robot"), motDePasse: "x" }, ip: "203.0.113.51" });
    expect(autreAdresse.statusCode).toBe(401);
  });
});

describe("Sessions", () => {
  it("expirent après 15 minutes d'inactivité", async () => {
    const compte = await creerCompte(ctx, "caissier");
    const cookie = await connecter(ctx, compte);
    await ctx.base.query(
      "UPDATE securite.sessions SET derniere_activite = now() - interval '16 minutes' WHERE utilisateur_id = $1 AND fermee_le IS NULL",
      [compte.id],
    );
    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(401);
  });

  it("la déconnexion rend la session inutilisable et efface le cookie", async () => {
    const compte = await creerCompte(ctx, "caissier");
    const cookie = await connecter(ctx, compte);
    const deconnexion = await envoyer(ctx, { methode: "POST", url: "/auth/deconnexion", cookie });
    expect(deconnexion.statusCode).toBe(204);
    expect(deconnexion.cookies.find((c) => c.name === "__Host-dbs_session")?.value).toBe("");
    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(401);
  });
});

describe("Requêtes venues d'un autre site (CSRF) et format", () => {
  it("refuse une requête sans origine ou d'une autre origine", async () => {
    const corps = { email: "a@test.ci", motDePasse: "x" };
    for (const origine of [null, "https://site-pirate.example"]) {
      const reponse = await envoyer(ctx, { url: "/auth/connexion", corps, origine });
      expect(reponse.statusCode).toBe(403);
      expect(reponse.json().code).toBe("origine_refusee");
    }
  });

  it("n'accepte que du JSON", async () => {
    const reponse = await ctx.app.inject({
      method: "POST", url: "/auth/connexion",
      headers: { origin: "https://gestion.test.ci", "content-type": "text/plain" },
      payload: "email=a@test.ci&motDePasse=x",
    });
    expect(reponse.statusCode).toBe(415);
  });

  it("refuse les champs inattendus", async () => {
    const reponse = await envoyer(ctx, { url: "/auth/connexion", corps: { email: "a@test.ci", motDePasse: "x", role: "gerant" } });
    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().code).toBe("requete_invalide");
  });
});

describe("Réponses", () => {
  it("portent les en-têtes de sécurité", async () => {
    const reponse = await envoyer(ctx, { url: "/sante" });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.headers).toMatchObject({
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
  });

  it("ne révèlent rien de l'intérieur en cas d'erreur", async () => {
    const introuvable = await envoyer(ctx, { url: "/admin/../../etc/passwd" });
    expect(introuvable.statusCode).toBe(404);
    expect(introuvable.json()).toEqual({ code: "introuvable", message: "Élément introuvable." });
  });
});

describe("Mots de passe divulgués", () => {
  it("un mot de passe présent dans une fuite connue est refusé", async () => {
    const strict = await demarrer({ verifierFuite: async () => true });
    try {
      const compte = await creerCompte(strict, "caissier");
      const cookie = await connecter(strict, compte, { changerMotDePasse: false });
      const reponse = await envoyer(strict, {
        url: "/auth/mot-de-passe", cookie, corps: { actuel: compte.motDePasse, nouveau: "Le fleuve Comoé en saison sèche" },
      });
      expect(reponse.statusCode).toBe(422);
      expect(reponse.json().code).toBe("mot_de_passe_divulgue");
    } finally {
      await strict.fermer();
    }
  });
});
