// Journal technique de l'API (docs/securite/journalisation-et-audit.md) : ni cookie, ni mot de passe, ni paramètres
// d'adresse (une recherche peut contenir le nom ou le téléphone d'un client).

import { afterAll, beforeAll, expect, it } from "vitest";
import { connecter, creerCompte, demarrer, envoyer, type Contexte } from "./outils.js";

let ctx: Contexte;
const lignes: string[] = [];

beforeAll(async () => {
  ctx = await demarrer({ journal: { write: (ligne) => void lignes.push(ligne) } });
});

afterAll(async () => {
  await ctx?.fermer();
});

it("le journal garde la requête, sans ses paramètres, sans cookie ni mot de passe", async () => {
  const compte = await creerCompte(ctx, "gerant");
  const cookie = await connecter(ctx, compte);
  const reponse = await envoyer(ctx, { url: "/clients?recherche=Kouame%20Yao%2007%2049", cookie });
  expect(reponse.statusCode).toBe(200);

  const journal = lignes.join("");
  expect(journal).toContain('"url":"/clients"');
  expect(journal).not.toContain("Kouame");
  expect(journal).not.toContain("recherche=");
  expect(journal).not.toContain(cookie.split("=")[1]!.slice(0, 16));
  expect(journal).not.toContain(compte.motDePasse);
});
