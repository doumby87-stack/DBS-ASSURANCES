// Lecture automatique (tâche 14, ADR 0018) : zone lisible par machine (spécimens de la norme ICAO 9303), catalogue
// des documents (schémas stricts, nettoyage, contrôles), reconnaissance, rapprochement des noms, et appel à l'API
// d'Anthropic (réseau simulé, réponse simple ou en flux).

import { describe, expect, it } from "vitest";
import { controler } from "../../src/integrations/lecture/controles.js";
import {
  CATALOGUE, DOCUMENTS, nettoyer, nettoyerReconnaissance, schemaReconnaissance,
  type ChampsCarteGrise, type ChampsConstat, type ChampsPieceIdentite,
} from "../../src/integrations/lecture/documents.js";
import { creerLecteur } from "../../src/integrations/lecture/lecteur.js";
import { analyserMrz, chiffreControle } from "../../src/integrations/lecture/mrz.js";
import { TYPE_CLASSEUR } from "../../src/modules/demandes-site/piece.js";
import { memeNom, motsDuNom } from "../../src/modules/lecture/rapprochements.js";
import { classeurMinimal } from "../fixtures/zip.js";

const EXEMPLE_LISTE = CATALOGUE.liste_vehicules.exemple;

// Spécimens publiés dans la norme ICAO 9303 (pays fictif « UTO »)
const PASSEPORT = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"];
const CARTE = ["I<UTOD231458907<<<<<<<<<<<<<<<", "7408122F1204159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"];
const AUJOURDHUI = new Date("2026-11-06T12:00:00Z");

describe("zone lisible par machine (ICAO 9303)", () => {
  it("calcule les chiffres de contrôle (poids 7, 3, 1 ; A = 10 ; < = 0)", () => {
    expect(chiffreControle("L898902C3")).toBe(6);
    expect(chiffreControle("740812")).toBe(2);
    expect(chiffreControle("D23145890")).toBe(7);
  });

  it("lit un passeport (TD3) et une carte (TD1), chiffres de contrôle justes", () => {
    expect(analyserMrz(PASSEPORT, AUJOURDHUI)).toEqual({
      format: "TD3", valide: true, erreurs: [], numero: "L898902C3", nationalite: "UTO", dateNaissance: "1974-08-12",
      dateExpiration: "2012-04-15", sexe: "F", nom: "ERIKSSON", prenoms: "ANNA MARIA",
    });
    expect(analyserMrz(CARTE, AUJOURDHUI)).toMatchObject({ format: "TD1", valide: true, numero: "D23145890", dateNaissance: "1974-08-12" });
  });

  it("détecte un seul caractère mal lu, et dit où", () => {
    const numeroFaux = [PASSEPORT[0]!, PASSEPORT[1]!.replace("L898902C3", "L898902G3")];
    expect(analyserMrz(numeroFaux, AUJOURDHUI)).toMatchObject({ valide: false, erreurs: ["numéro du document", "contrôle d'ensemble"] });
    const naissanceFausse = [CARTE[0]!, CARTE[1]!.replace("740812", "740813"), CARTE[2]!];
    expect(analyserMrz(naissanceFausse, AUJOURDHUI)?.erreurs).toEqual(["date de naissance", "contrôle d'ensemble"]);
  });

  it("refuse ce qui ne ressemble à aucun format", () => {
    expect(analyserMrz(["ABC", "DEF"], AUJOURDHUI)).toBeNull();
    expect(analyserMrz([PASSEPORT[0]!], AUJOURDHUI)).toBeNull();
  });
});

describe("nettoyage des valeurs lues", () => {
  it("borne les types, les dates et les longueurs ; normalise immatriculation et châssis", () => {
    const champs = nettoyer("carte_grise", {
      documentReconnu: true, lisibilite: "bonne", immatriculation: " 4521 km 01 ", numeroChassis: "jtd br32e7 20123456",
      puissanceFiscale: 300, placesAssises: "5", datePremiereMiseEnCirculation: "2019-02-30", marque: 42,
    }) as ChampsCarteGrise;
    expect(champs).toMatchObject({
      immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", puissanceFiscale: null, placesAssises: null,
      datePremiereMiseEnCirculation: null, marque: null, proprietaire: null,
    });
  });

  it("garde les cases de circonstances valides, sans doublon, triées", () => {
    const constat = nettoyer("constat_amiable", {
      documentReconnu: true, lisibilite: "partielle", heure: "8h40",
      vehicules: [{ lettre: "A", circonstances: [8, 3, 8, 99, 2.5, "4"] }, { circonstances: [] }],
    }) as ChampsConstat;
    expect(constat.heure).toBeNull();
    expect(constat.vehicules.map((v) => [v.lettre, v.circonstances])).toEqual([["A", [3, 8]], ["B", []]]);
  });

  it("un champ manquant ou d'un autre type ne passe jamais pour une valeur lue", () => {
    expect(nettoyer("piece_identite", { lisibilite: "excellente" })).toMatchObject({
      documentReconnu: false, lisibilite: "mauvaise", numero: null, mrz: null, typePiece: null,
    });
  });
});

describe("contrôles proposés à la personne", () => {
  const piece = (champs: Partial<ChampsPieceIdentite>) => nettoyer("piece_identite", { documentReconnu: true, lisibilite: "bonne", ...champs });

  it("une zone lisible par machine juste confirme le numéro et les dates", () => {
    const champs = piece({ numero: "L898902C3", dateNaissance: "1974-08-12", dateExpiration: "2012-04-15", mrz: PASSEPORT });
    expect(controler("piece_identite", champs, AUJOURDHUI)).toEqual([
      { champ: "dateExpiration", niveau: "attention", message: "Pièce expirée : demandez une pièce en cours de validité." },
      { champ: "numero", niveau: "ok", message: "Numéro et dates confirmés par la zone lisible par machine (chiffres de contrôle justes)." },
    ]);
  });

  it("signale un numéro imprimé qui ne correspond pas à la zone, ou une zone mal lue", () => {
    const ecart = controler("piece_identite", piece({ numero: "L898902C8", mrz: PASSEPORT }), AUJOURDHUI);
    expect(ecart.at(-1)?.message).toContain("ne donne pas la même valeur pour : numéro");
    const malLue = controler("piece_identite", piece({ mrz: [PASSEPORT[0]!, PASSEPORT[1]!.replace("7408122", "7408129")] }), AUJOURDHUI);
    expect(malLue.at(-1)?.message).toContain("mal lue (date de naissance, contrôle d'ensemble)");
  });

  it("carte grise : châssis mal formé ; constat : un seul véhicule, blessés", () => {
    const carte = nettoyer("carte_grise", { documentReconnu: true, lisibilite: "bonne", numeroChassis: "VF1ABC" });
    expect(controler("carte_grise", carte, AUJOURDHUI).map((c) => c.champ)).toEqual(["numeroChassis"]);
    const constat = nettoyer("constat_amiable", { documentReconnu: false, lisibilite: "partielle", blesses: true, vehicules: [{ lettre: "A" }] });
    expect(controler("constat_amiable", constat, AUJOURDHUI).map((c) => c.champ)).toEqual([null, null, null, "blesses"]);
  });
});

describe("catalogue des documents", () => {
  /** Sortie structurée : chaque objet du schéma exige tous ses champs et n'en admet aucun autre */
  function verifierStrict(schema: Record<string, unknown>, chemin: string): void {
    if (schema.type === "object") {
      const proprietes = schema.properties as Record<string, Record<string, unknown>>;
      expect(schema.additionalProperties, chemin).toBe(false);
      expect(schema.required, chemin).toEqual(Object.keys(proprietes));
      for (const [nom, sous] of Object.entries(proprietes)) verifierStrict(sous, `${chemin}.${nom}`);
    }
    if (schema.items) verifierStrict(schema.items as Record<string, unknown>, `${chemin}[]`);
    for (const variante of (schema.anyOf as Record<string, unknown>[] | undefined) ?? []) verifierStrict(variante, chemin);
  }

  it("chaque document a un schéma strict, une demande, des signes de reconnaissance et un exemple qui se nettoie sans perte", () => {
    for (const document of DOCUMENTS) {
      const definition = CATALOGUE[document];
      verifierStrict(definition.schema, document);
      expect(definition.libelle && definition.demande && definition.signes).toBeTruthy();
      const champs = nettoyer(document, structuredClone(definition.exemple));
      // L'exemple de simulation passe le nettoyage tel quel : aucune valeur perdue
      expect(champs, document).toEqual(definition.exemple);
    }
    expect(schemaReconnaissance(["carte_grise"])).toMatchObject({ required: ["document", "confiance", "description"], additionalProperties: false });
    expect(nettoyerReconnaissance({ document: "piece_identite", confiance: "certaine" }, ["carte_grise"])).toEqual({ document: null, confiance: "faible", description: null });
  });

  it("champs incertains : seuls les noms de champs du document sont gardés, chacun devient un point à vérifier", () => {
    const champs = nettoyer("carte_transport", { documentReconnu: true, lisibilite: "bonne", champsIncertains: ["numero", "numero", "inconnu", 3, "documentReconnu"] });
    expect(champs.champsIncertains).toEqual(["numero"]);
    expect(controler("carte_transport", champs, AUJOURDHUI)).toEqual([
      { champ: "numero", niveau: "attention", message: "Lecture douteuse : vérifiez cette valeur sur le document." },
    ]);
  });

  it("nettoie les nouveaux documents : garanties sans doublon, dirigeants nommés, lignes de véhicules identifiables", () => {
    expect(nettoyer("attestation_assurance", { garanties: ["Vol", " Vol ", 4, "Incendie"], primeTtc: 285000.5, dateEcheance: "2026-02-30" }))
      .toMatchObject({ garanties: ["Vol", "Incendie"], primeTtc: null, dateEcheance: null });
    expect(nettoyer("registre_commerce", { numeroRccm: "ci-abj-2019-b-12345", dirigeants: [{ nom: "Bamba Issouf", fonction: "Gérant" }, { fonction: "Associé" }, "x"] }))
      .toMatchObject({ numeroRccm: "CI-ABJ-2019-B-12345", dirigeants: [{ nom: "Bamba Issouf", fonction: "Gérant" }] });
    const liste = nettoyer("liste_vehicules", { vehicules: [{ immatriculation: "1234 ab 01", valeurVenale: 12_000_000 }, { marque: "Isuzu" }, { numeroChassis: "jhd 123" }] });
    expect(liste.vehicules.map((v) => [v.immatriculation, v.numeroChassis])).toEqual([["1234 AB 01", null], [null, "JHD123"]]);
    expect(nettoyer("visite_technique", { resultat: "passable" }).resultat).toBeNull();
  });

  it("contrôles des nouveaux documents : échéance passée, dates inversées, visite refusée, RCCM inhabituel, liste incomplète", () => {
    const attestation = nettoyer("attestation_assurance", { documentReconnu: true, lisibilite: "bonne", dateEffet: "2026-01-01", dateEcheance: "2025-12-31" });
    expect(controler("attestation_assurance", attestation, AUJOURDHUI).map((c) => c.message)).toEqual([
      expect.stringContaining("Attestation échue"), expect.stringContaining("Date d'échéance avant la date d'effet"),
    ]);
    const visite = nettoyer("visite_technique", { documentReconnu: true, lisibilite: "bonne", dateValidite: "2027-01-01", resultat: "contre_visite" });
    expect(controler("visite_technique", visite, AUJOURDHUI)).toEqual([expect.objectContaining({ champ: "resultat", message: expect.stringContaining("Contre-visite") })]);
    const rccm = nettoyer("registre_commerce", { documentReconnu: true, lisibilite: "bonne", numeroRccm: "RC 1234/2019" });
    expect(controler("registre_commerce", rccm, AUJOURDHUI).map((c) => c.champ)).toEqual(["numeroRccm"]);
    expect(controler("registre_commerce", { ...rccm, numeroRccm: "CI-ABJ-03-2019-B12-01234" }, AUJOURDHUI)).toEqual([]);
    const liste = nettoyer("liste_vehicules", {
      documentReconnu: true, lisibilite: "bonne", nombreVehiculesDocument: 5,
      vehicules: [{ immatriculation: "1234 AB 01" }, { immatriculation: "1234-AB-01" }, { numeroChassis: "VF1ABC" }],
    });
    expect(controler("liste_vehicules", liste, AUJOURDHUI).map((c) => c.message)).toEqual([
      "3 véhicule(s) lu(s) sur 5 : complétez la liste, ou envoyez le classeur Excel.",
      "Immatriculation(s) en double : 1234-AB-01.",
      "1 ligne(s) sans immatriculation : complétez-les avant l'import.",
      "1 numéro(s) de châssis à revoir (un VIN compte 17 caractères, sans I, O ni Q).",
    ]);
  });
});

describe("rapprochement des noms", () => {
  it("même personne ou même entreprise, quels que soient l'ordre, les accents, la civilité et la forme juridique", () => {
    expect(memeNom("KONÉ Mariam", "Mariam Kone")).toBe(true);
    expect(memeNom("Koné Mariam", "Mme Mariam KONE épouse Traoré")).toBe(true);
    expect(memeNom("Transports Exemple Lagunaires SARL", "TRANSPORTS EXEMPLE LAGUNAIRES")).toBe(true);
    expect(memeNom("Koné Mariam", "Koné Awa")).toBe(false);
    expect(memeNom("SARL", "SARL")).toBe(false);
    expect(motsDuNom("Ets N'Guessan & Fils")).toEqual(["NGUESSAN", "FILS"]);
  });
});

describe("lecteur Claude (API d'Anthropic, réseau simulé)", () => {
  type Appel = { url: string; entetes: Headers; corps: Record<string, unknown> };
  function reseau(reponse: { statut: number; corps: object }) {
    const appels: Appel[] = [];
    const recuperer = (async (url: string | URL | Request, init?: RequestInit) => {
      appels.push({ url: String(url), entetes: new Headers(init?.headers), corps: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reponse.corps), { status: reponse.statut, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { appels, recuperer };
  }
  const message = (texte: string, stopReason = "end_turn") => ({
    id: "msg_test", type: "message", role: "assistant", model: "modele-de-test", content: [{ type: "text", text: texte }],
    stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 300 },
  });
  const config = { prestataire: "anthropic" as const, cleApi: "cle-de-test", modele: "modele-de-test" };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

  it("envoie le fichier seul, avec le schéma du document et le repli en cas de refus ; nettoie la réponse", async () => {
    const { appels, recuperer } = reseau({ statut: 200, corps: message(JSON.stringify({
      documentReconnu: true, lisibilite: "bonne", remarques: null, immatriculation: "1234 ab 01", numeroChassis: null, marque: "Isuzu",
      modele: null, genre: null, energie: null, puissanceFiscale: 12, placesAssises: 3, datePremiereMiseEnCirculation: null,
      proprietaire: null, usage: null,
    })) });
    const lecteur = creerLecteur(config, { fetch: recuperer, maxRetries: 0 })!;
    const resultat = await lecteur.lire("carte_grise", { contenu: PNG, type: "image/png" });
    expect(resultat).toMatchObject({ ok: true, champs: { immatriculation: "1234 AB 01", marque: "Isuzu", puissanceFiscale: 12 } });

    expect(appels).toHaveLength(1);
    const { url, entetes, corps } = appels[0]!;
    expect(url).toContain("/v1/messages");
    // La clé part dans un en-tête (x-api-key ou authorization, selon la version du SDK), jamais dans le corps
    expect(entetes.get("x-api-key") ?? entetes.get("authorization")).toContain("cle-de-test");
    expect(JSON.stringify(corps)).not.toContain("cle-de-test");
    expect(entetes.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(corps).toMatchObject({
      model: "modele-de-test", fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    const contenu = (corps.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0]!.content;
    expect(contenu[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } });
    expect(contenu).toHaveLength(2);
  });

  it("un PDF part comme document ; refus, réponse coupée, clé refusée et requête refusée deviennent des issues claires", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    const pdfReseau = reseau({ statut: 200, corps: message("{}", "refusal") });
    expect(await creerLecteur(config, { fetch: pdfReseau.recuperer, maxRetries: 0 })!.lire("constat_amiable", { contenu: pdf, type: "application/pdf" }))
      .toMatchObject({ ok: false, raison: "refus" });
    expect((pdfReseau.appels[0]!.corps.messages as { content: { type: string }[] }[])[0]!.content[0]!.type).toBe("document");

    const cas: [number, object, string][] = [
      [200, message("{\"documentReconnu\": tr", "max_tokens"), "illisible"],
      [200, message("pas du JSON"), "illisible"],
      [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "configuration"],
      [400, { type: "error", error: { type: "invalid_request_error", message: "image too large" } }, "illisible"],
      [529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "indisponible"],
    ];
    for (const [statut, corps, raison] of cas) {
      const { recuperer } = reseau({ statut, corps });
      expect(await creerLecteur(config, { fetch: recuperer, maxRetries: 0 })!.lire("piece_identite", { contenu: PNG, type: "image/png" }))
        .toMatchObject({ ok: false, raison });
    }
  });

  it("reconnaissance : demande courte (effort faible), choix limité aux candidats ; « autre » n'est aucun document", async () => {
    const { appels, recuperer } = reseau({ statut: 200, corps: message(JSON.stringify({ document: "autre", confiance: "haute", description: "Facture d'un garage" })) });
    const resultat = await creerLecteur(config, { fetch: recuperer, maxRetries: 0 })!.reconnaitre({ contenu: PNG, type: "image/png" }, ["carte_grise", "visite_technique"]);
    expect(resultat).toEqual({ ok: true, reconnaissance: { document: null, confiance: "haute", description: "Facture d'un garage" } });
    const corps = appels[0]!.corps as { output_config: { effort: string; format: { schema: { properties: { document: { enum: string[] } } } } }; messages: { content: { text?: string }[] }[] };
    expect(corps.output_config.effort).toBe("low");
    expect(corps.output_config.format.schema.properties.document.enum).toEqual(["carte_grise", "visite_technique", "autre"]);
    const demande = corps.messages[0]!.content[1]!.text!;
    expect(demande).toContain("visite_technique :");
    expect(demande).not.toContain("piece_identite");
  });

  it("une liste de véhicules se lit en flux (réponse longue) ; un classeur Excel se lit sans appel au modèle", async () => {
    const json = JSON.stringify({ ...EXEMPLE_LISTE, vehicules: [{ immatriculation: "7310 hj 01" }, { marque: "sans plaque ni châssis" }] });
    const evenements = [
      { type: "message_start", message: { ...message(""), content: [], stop_reason: null } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(0, 40) } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(40) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } },
      { type: "message_stop" },
    ];
    const appels: Record<string, unknown>[] = [];
    const recuperer = (async (_url: string | URL | Request, init?: RequestInit) => {
      appels.push(JSON.parse(String(init?.body)));
      const flux = evenements.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(flux, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const lecteur = creerLecteur(config, { fetch: recuperer, maxRetries: 0 })!;
    const resultat = await lecteur.lire("liste_vehicules", { contenu: PNG, type: "image/png" });
    expect(resultat).toMatchObject({ ok: true, champs: { vehicules: [{ immatriculation: "7310 HJ 01", marque: null }] } });
    expect(appels[0]).toMatchObject({ stream: true, fallbacks: "default", output_config: { effort: "medium" } });
    expect((appels[0]!.max_tokens as number) > 16_000).toBe(true);

    const classeur = classeurMinimal([["Immatriculation", "Puissance fiscale"], ["1234 AB 01", "12"]]);
    const lu = await lecteur.lire("liste_vehicules", { contenu: classeur, type: TYPE_CLASSEUR });
    expect(lu).toMatchObject({ ok: true, classeur: true, champs: { vehicules: [{ immatriculation: "1234 AB 01", puissanceFiscale: 12 }] } });
    expect(await lecteur.lire("carte_grise", { contenu: classeur, type: TYPE_CLASSEUR })).toMatchObject({ ok: false, raison: "illisible" });
    expect(await lecteur.reconnaitre({ contenu: classeur, type: TYPE_CLASSEUR }, ["carte_grise", "liste_vehicules"]))
      .toMatchObject({ ok: true, reconnaissance: { document: "liste_vehicules" } });
    expect(appels).toHaveLength(1);
  });

  it("la simulation rend des valeurs d'exemple, dont une zone lisible par machine juste", async () => {
    const resultat = await creerLecteur({ prestataire: "simulation" })!.lire("piece_identite", { contenu: PNG, type: "image/png" });
    if (!resultat.ok) throw new Error("lecture simulée en échec");
    expect(analyserMrz((resultat.champs as ChampsPieceIdentite).mrz!, AUJOURDHUI)?.valide).toBe(true);
    expect(creerLecteur(null)).toBeNull();
  });
});
