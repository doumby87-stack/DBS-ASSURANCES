// Gestion des comptes du personnel par le gérant.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initialiserPremierAcces, preparerAccesProvisoire } from "../../src/modules/utilisateurs/acces.js";
import { adresseUnique, connecter, creerCompte, demarrer, envoyer, type Compte, type Contexte } from "./outils.js";

let ctx: Contexte;
let gerant: Compte;
let cookieGerant: string;

beforeAll(async () => {
  ctx = await demarrer();
  gerant = await creerCompte(ctx, "gerant");
  cookieGerant = await connecter(ctx, gerant);
});
afterAll(async () => {
  await ctx.fermer();
});

async function creerParLeGerant(role: string, email = adresseUnique(role)) {
  return envoyer(ctx, { url: "/utilisateurs", cookie: cookieGerant, corps: { email, nom: `Nouveau ${role}`, role } });
}

describe("Création d'un compte", () => {
  it("le gérant crée un compte et reçoit un mot de passe provisoire, à usage de première connexion", async () => {
    const email = adresseUnique("caissier");
    const reponse = await creerParLeGerant("caissier", email.toUpperCase());
    expect(reponse.statusCode).toBe(201);
    const { utilisateur, motDePasseProvisoire } = reponse.json();
    expect(utilisateur).toMatchObject({ email, role: "caissier", actif: true });
    expect(motDePasseProvisoire).toMatch(/^[\w]{5}-[\w]{5}-[\w]{5}-[\w]{5}$/);

    const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email, motDePasse: motDePasseProvisoire } });
    expect(connexion.json()).toEqual({ etape: "configuration_mfa" });

    const { rows } = await ctx.base.query(
      "SELECT auteur_id FROM securite.evenements WHERE utilisateur_id = $1 AND type = 'compte_cree'", [utilisateur.id],
    );
    expect(rows[0].auteur_id).toBe(gerant.id);
  });

  it("refuse une adresse déjà utilisée, un rôle inconnu, un champ en trop", async () => {
    const email = adresseUnique("doublon");
    expect((await creerParLeGerant("commercial", email)).statusCode).toBe(201);
    const doublon = await creerParLeGerant("commercial", email);
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json().code).toBe("conflit");
    expect((await creerParLeGerant("super_admin")).statusCode).toBe(400);
    const enTrop = await envoyer(ctx, {
      url: "/utilisateurs", cookie: cookieGerant, corps: { email: adresseUnique("x"), nom: "Nom", role: "caissier", actif: false },
    });
    expect(enTrop.statusCode).toBe(400);
  });

  it("un autre rôle ne peut ni créer, ni modifier, ni réinitialiser un compte", async () => {
    const caissier = await creerCompte(ctx, "caissier");
    const cookie = await connecter(ctx, caissier);
    const creation = await envoyer(ctx, { url: "/utilisateurs", cookie, corps: { email: adresseUnique("pirate"), nom: "Pirate", role: "gerant" } });
    expect(creation.statusCode).toBe(403);
    expect(creation.json().code).toBe("acces_refuse");
    expect((await envoyer(ctx, { methode: "PATCH", url: `/utilisateurs/${caissier.id}`, cookie, corps: { role: "gerant" } })).statusCode).toBe(403);
    expect((await envoyer(ctx, { methode: "POST", url: `/utilisateurs/${gerant.id}/reinitialiser-acces`, cookie })).statusCode).toBe(403);
    // Mais il peut consulter la liste du personnel
    const liste = await envoyer(ctx, { url: "/utilisateurs", cookie });
    expect(liste.statusCode).toBe(200);
    expect(liste.json().utilisateurs.some((u: { id: string }) => u.id === gerant.id)).toBe(true);
  });
});

describe("Modification d'un compte", () => {
  it("la désactivation ferme immédiatement les sessions et empêche la connexion", async () => {
    const caissier = await creerCompte(ctx, "caissier");
    const cookie = await connecter(ctx, caissier);
    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(200);

    const desactivation = await envoyer(ctx, {
      methode: "PATCH", url: `/utilisateurs/${caissier.id}`, cookie: cookieGerant, corps: { actif: false },
    });
    expect(desactivation.statusCode).toBe(200);
    expect(desactivation.json().utilisateur.actif).toBe(false);
    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(401);
    const connexion = await envoyer(ctx, { url: "/auth/connexion", corps: { email: caissier.email, motDePasse: caissier.motDePasse } });
    expect(connexion.statusCode).toBe(401);
  });

  it("un changement de rôle ferme les sessions ouvertes (les droits sont relus à la reconnexion)", async () => {
    const commercial = await creerCompte(ctx, "commercial");
    const cookie = await connecter(ctx, commercial);
    await envoyer(ctx, { methode: "PATCH", url: `/utilisateurs/${commercial.id}`, cookie: cookieGerant, corps: { role: "charge_clientele" } });
    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(401);
    const session = await envoyer(ctx, { url: "/auth/session", cookie: await connecter(ctx, commercial) });
    expect(session.json().utilisateur.role).toBe("charge_clientele");
  });

  it("le gérant ne peut ni se désactiver, ni se retirer son rôle, ni réinitialiser son propre accès", async () => {
    for (const corps of [{ actif: false }, { role: "caissier" }]) {
      const reponse = await envoyer(ctx, { methode: "PATCH", url: `/utilisateurs/${gerant.id}`, cookie: cookieGerant, corps });
      expect(reponse.statusCode).toBe(422);
      expect(reponse.json().code).toBe("action_sur_soi_interdite");
    }
    const reinitialisation = await envoyer(ctx, { methode: "POST", url: `/utilisateurs/${gerant.id}/reinitialiser-acces`, cookie: cookieGerant });
    expect(reinitialisation.statusCode).toBe(422);
  });

  it("refuse un identifiant mal formé ou inconnu sans rien révéler", async () => {
    const malForme = await envoyer(ctx, { methode: "PATCH", url: "/utilisateurs/1%20OR%201=1", cookie: cookieGerant, corps: { nom: "X Y" } });
    expect(malForme.statusCode).toBe(400);
    const inconnu = await envoyer(ctx, {
      methode: "PATCH", url: "/utilisateurs/00000000-0000-4000-8000-000000000000", cookie: cookieGerant, corps: { nom: "X Y" },
    });
    expect(inconnu.statusCode).toBe(404);
  });
});

describe("Réinitialisation de l'accès (téléphone perdu, mot de passe oublié)", () => {
  it("donne un nouveau mot de passe provisoire, retire le deuxième facteur et ferme les sessions", async () => {
    const caissier = await creerCompte(ctx, "caissier");
    const cookie = await connecter(ctx, caissier);
    const reponse = await envoyer(ctx, { methode: "POST", url: `/utilisateurs/${caissier.id}/reinitialiser-acces`, cookie: cookieGerant });
    expect(reponse.statusCode).toBe(200);
    const { motDePasseProvisoire } = reponse.json();

    expect((await envoyer(ctx, { url: "/auth/session", cookie })).statusCode).toBe(401);
    const ancien = await envoyer(ctx, { url: "/auth/connexion", corps: { email: caissier.email, motDePasse: caissier.motDePasse } });
    expect(ancien.statusCode).toBe(401);
    const nouveau = await envoyer(ctx, { url: "/auth/connexion", corps: { email: caissier.email, motDePasse: motDePasseProvisoire } });
    expect(nouveau.json()).toEqual({ etape: "configuration_mfa" });
  });
});

describe("Installation du premier accès", () => {
  it("ne sert qu'une fois par compte, et jamais pour un compte désactivé", async () => {
    const client = await ctx.base.connect();
    try {
      const email = adresseUnique("installation");
      await client.query("INSERT INTO app.utilisateurs (email, nom, role, actif) VALUES ($1, 'Inactif', 'gerant', false)", [email]);
      expect(await initialiserPremierAcces(client, email, await preparerAccesProvisoire())).toBeNull();
      expect(await initialiserPremierAcces(client, gerant.email, await preparerAccesProvisoire())).toBeNull();
    } finally {
      client.release();
    }
  });
});
