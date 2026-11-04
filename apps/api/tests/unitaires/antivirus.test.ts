// Client ClamAV : protocole INSTREAM contre un démon factice (toujours), puis contre le vrai ClamAV quand il est
// disponible (ANTIVIRUS_ADRESSE_TEST, démarré par tests/antivirus/demarrer-clamd.sh : c'est le cas en CI).

import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerAntivirus, lireAdresseAntivirus, lireReponse } from "../../src/integrations/antivirus/clamav.js";
// @ts-expect-error module de test en JavaScript, sans déclaration de types
import { creerClamdFactice } from "../antivirus/clamd-factice.mjs";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF_PIEGE = Buffer.from(`%PDF-1.4\n${EICAR}\n%%EOF\n`, "latin1");

function ecouter(serveur: Server): Promise<number> {
  return new Promise((resoudre) => serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as AddressInfo).port)));
}

describe("Adresse et réponses de ClamAV", () => {
  it("lit l'adresse du démon, port 3310 par défaut", () => {
    expect(lireAdresseAntivirus("clamav")).toEqual({ hote: "clamav", port: 3310 });
    expect(lireAdresseAntivirus("10.0.0.5:3311")).toEqual({ hote: "10.0.0.5", port: 3311 });
    expect(lireAdresseAntivirus("[::1]:3310")).toEqual({ hote: "::1", port: 3310 });
    expect(lireAdresseAntivirus("tcp://clamav:3310")).toBeNull();
    expect(lireAdresseAntivirus("clamav:99999")).toBeNull();
  });

  it("traduit les réponses du démon ; tout ce qui n'est ni OK ni FOUND n'est pas « sain »", () => {
    expect(lireReponse("stream: OK\0")).toEqual({ etat: "saine" });
    expect(lireReponse("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ etat: "infectee", signature: "Win.Test.EICAR_HDB-1" });
    expect(lireReponse("INSTREAM size limit exceeded. ERROR\0")).toMatchObject({ etat: "indisponible" });
    expect(lireReponse("")).toMatchObject({ etat: "indisponible" });
  });
});

describe("Analyse par un démon factice", () => {
  let serveur: Server;
  let port: number;
  const recus: Buffer[] = [];

  beforeAll(async () => {
    serveur = creerClamdFactice((fichier: Buffer) => recus.push(fichier));
    port = await ecouter(serveur);
  });
  afterAll(() => new Promise<void>((resoudre) => serveur.close(() => resoudre())));

  it("envoie le fichier entier par morceaux et lit le verdict", async () => {
    const antivirus = creerAntivirus({ hote: "127.0.0.1", port });
    expect(antivirus.configure).toBe(true);
    expect(await antivirus.analyser(PNG)).toEqual({ etat: "saine" });
    expect(await antivirus.analyser(PDF_PIEGE)).toEqual({ etat: "infectee", signature: "Eicar-Test-Signature" });

    const gros = Buffer.alloc(5 * 1024 * 1024 + 123, 7);
    expect(await antivirus.analyser(gros)).toEqual({ etat: "saine" });
    expect(recus.at(-1)?.equals(gros)).toBe(true);
  });

  it("antivirus injoignable, muet ou non configuré : jamais « sain »", async () => {
    const ferme = createServer();
    const portFerme = await ecouter(ferme);
    await new Promise<void>((resoudre) => ferme.close(() => resoudre()));
    expect(await creerAntivirus({ hote: "127.0.0.1", port: portFerme }).analyser(PNG)).toMatchObject({ etat: "indisponible" });

    const muet = createServer((socket) => socket.on("error", () => {}));
    const portMuet = await ecouter(muet);
    expect(await creerAntivirus({ hote: "127.0.0.1", port: portMuet }, 200).analyser(PNG))
      .toEqual({ etat: "indisponible", raison: "Antivirus trop lent à répondre" });
    muet.close();

    const absent = creerAntivirus(null);
    expect(absent.configure).toBe(false);
    expect(await absent.analyser(PNG)).toMatchObject({ etat: "indisponible" });
  });
});

const adresseReelle = process.env.ANTIVIRUS_ADRESSE_TEST ? lireAdresseAntivirus(process.env.ANTIVIRUS_ADRESSE_TEST) : null;

describe.skipIf(!adresseReelle)("Analyse par le vrai ClamAV", () => {
  it("reconnaît le fichier de test EICAR caché dans un PDF, laisse passer une image saine et un fichier de 5 Mo", async () => {
    const antivirus = creerAntivirus(adresseReelle);
    const piege = await antivirus.analyser(PDF_PIEGE);
    expect(piege.etat).toBe("infectee");
    expect(piege.etat === "infectee" && piege.signature).toMatch(/eicar/i);
    expect(await antivirus.analyser(PNG)).toEqual({ etat: "saine" });
    expect(await antivirus.analyser(Buffer.alloc(5 * 1024 * 1024, 0x41))).toEqual({ etat: "saine" });
  });
});
