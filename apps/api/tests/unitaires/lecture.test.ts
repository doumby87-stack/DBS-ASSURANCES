// Lecture automatique (tâche 14) : zone lisible par machine (spécimens de la norme ICAO 9303) et sa correction,
// analyse du texte reconnu, nettoyage des valeurs, contrôles proposés à la personne, lecteur local sur de vraies
// images (documents fictifs de tests/donnees/lecture) et lecteur Ollama (réseau simulé).

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { analyserTexte, fusionner } from "../../src/integrations/lecture/analyse-locale.js";
import { controler } from "../../src/integrations/lecture/controles.js";
import { nettoyer, type ChampsCarteGrise, type ChampsConstat, type ChampsPieceIdentite } from "../../src/integrations/lecture/documents.js";
import { creerLecteur } from "../../src/integrations/lecture/lecteur.js";
import { analyserMrz, chiffreControle, extraireMrz } from "../../src/integrations/lecture/mrz.js";
import { creerOcr, dimensions, imageDuPdf, type LigneLue } from "../../src/integrations/lecture/ocr.js";

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

describe("zone lisible par machine retrouvée dans un texte reconnu", () => {
  const SPECIMEN = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F3404159ZE184226B<<<<<16"];

  it("retire les espaces, remet lettres et chiffres à leur place (UT0 → UTO, O dans une date → 0)", () => {
    const lu = ["Date d'expiration 15/04/2034", "P<UTOERI KSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UT074O8122F3404159ZE 184226B<<<<<16"];
    expect(extraireMrz(lu)).toEqual(SPECIMEN);
  });

  it("corrige le numéro quand un seul échange de sosies (0/O, 1/I, 8/B…) rend ses chiffres de contrôle justes", () => {
    const lu = [SPECIMEN[0]!, SPECIMEN[1]!.replace("L898902C3", "L8989O2C3")];
    expect(extraireMrz(lu)).toEqual(SPECIMEN);
    expect(analyserMrz(extraireMrz(lu)!, AUJOURDHUI)?.valide).toBe(true);
  });

  it("ignore les traits parasites autour de la zone ; un L lu 1, que le chiffre de contrôle ne voit pas, est tranché par le numéro imprimé", () => {
    const lu = [SPECIMEN[0]!, `| ${SPECIMEN[1]!.replace("L898902C3", "1898902C3")} |`];
    // L et 1 donnent le même chiffre de contrôle à cette position : sans autre indice, on ne devine pas
    expect(extraireMrz(lu)?.[1]).toContain("1898902C3");
    expect(extraireMrz(lu, ["L898902C3"])).toEqual(SPECIMEN);
  });

  it("carte au format TD1 ; « « » lu à la place de « < » ; rien quand il n'y a pas de zone", () => {
    expect(extraireMrz(["I<UTOD231458907«<<<<<<<<<<<<<<", "74O8122F12O4159UTO<<<<<<<<<<<6", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"])).toEqual(CARTE);
    expect(extraireMrz(["Nom ERIKSSON", "Prénoms ANNA MARIA"])).toBeNull();
  });
});

describe("analyse du texte reconnu", () => {
  /** Ligne reconnue ; « | » sépare des colonnes, qui commencent tous les 400 pixels comme sur une carte */
  const ligne = (contenu: string, confiance: number): LigneLue => {
    const mots = contenu.split("|").flatMap((colonne, c) => {
      let x = c * 400;
      return colonne.trim().split(/\s+/).filter(Boolean).map((mot) => {
        const position = { texte: mot, x0: x, x1: x + mot.length * 10 };
        x = position.x1 + 10;
        return position;
      });
    });
    return { texte: mots.map((m) => m.texte).join(" "), confiance, mots, hauteur: 20 };
  };
  const texte = (lignes: string[], confiance = 90, claires: string[][] = []) => ({
    lignes: lignes.map((l) => ligne(l, confiance)), lignesClaires: claires.map((passe) => passe.map((l) => ligne(l, confiance))), confiance,
  });

  it("carte grise : libellés retrouvés malgré les accents et une faute, valeurs sur la ligne suivante, formes corrigées", () => {
    const champs = nettoyer("carte_grise", analyserTexte("carte_grise", texte([
      "CERTIFICAT D'IMMATRICULATION", "N° d'immatriculation 4521 KM 01", "Date de 1re mise en circulation", "14/O3/2019",
      "Nom ou raison sociale KONE MARIAM", "Marque : TOYOTA", "Type COROLLA", "Genre vP", "Energle ESS", "Puissance fiscale", "8cv",
      "Places assises 5", "N° de série (châssis) JTDBR32E72OI23456", "Usage PROMENADE ET AFFAIRES",
    ]), AUJOURDHUI));
    expect(champs).toEqual({
      documentReconnu: true, lisibilite: "bonne", remarques: null,
      immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", marque: "TOYOTA", modele: "COROLLA", genre: "Voiture particulière",
      energie: "Essence", puissanceFiscale: 8, placesAssises: 5, datePremiereMiseEnCirculation: "2019-03-14", proprietaire: "KONE MARIAM",
      usage: "PROMENADE ET AFFAIRES",
    });
  });

  it("carte grise : sans libellés, l'immatriculation et le châssis se retrouvent à leur forme ; autre document : non reconnu", () => {
    const champs = nettoyer("carte_grise", analyserTexte("carte_grise", texte(["photo floue", "7712 GH 01", "VF1 RFB00 567 123456"], 40), AUJOURDHUI));
    expect(champs).toMatchObject({ documentReconnu: false, lisibilite: "mauvaise", immatriculation: "7712 GH 01", numeroChassis: "VF1RFB00567123456" });
  });

  it("carte grise récente : libellés au-dessus des valeurs, en colonnes ; texte blanc de la colonne grise lu à part, au vote", () => {
    const recto = analyserTexte("carte_grise", texte([
      "CARTE GRISE", "Identité du propriétaire", "TRANSPORTS KOUASSI", "Marque | Genre", "MERCEDES | Tracteur Routier", "Type commercæl", "ACTROS 1845",
      "Energie | sage du véhicule | Nombre d'essieux", "Gas-Oil | Privé | 2", "Places assses | Puissance fiscale (CV) | Cylindrée (CC)", "2 | 26 | 12809",
    ], 70, [
      ["CD-123-EF-01", "CG12345678", "14-03-2019", "Date d'édition", "02-09-2025"],
      ["CD-123-EF-O1", "CG12345678", "Date d'édibon", "02-09-2025"],
    ]), AUJOURDHUI);
    expect(nettoyer("carte_grise", recto)).toMatchObject({
      immatriculation: "CD-123-EF-01", proprietaire: "TRANSPORTS KOUASSI", marque: "MERCEDES", genre: "Tracteur Routier", modele: "ACTROS 1845",
      energie: "Gasoil", usage: "Privé", placesAssises: 2, puissanceFiscale: 26,
      // Libellés de la colonne grise mal lus : la plus ancienne des dates, qui précède toujours la date d'édition
      datePremiereMiseEnCirculation: "2019-03-14",
    });
    // Une seule date, celle d'édition reconnue comme telle : on ne devine pas la première mise en circulation
    const editionSeule = analyserTexte("carte_grise", texte(["CARTE GRISE"], 70, [["Date d'édition", "02-09-2025"]]), AUJOURDHUI);
    expect(editionSeule.datePremiereMiseEnCirculation).toBeNull();
  });

  it("verso : châssis sous son libellé, immatriculation précédente écartée ; recto et verso fusionnés", () => {
    const verso = analyserTexte("carte_grise", texte([
      "Numéro du VIN/Chassis | Numéro de moteur", "/", "WDB96340 31L123456 | 47192873125", "Société de crédit | Type technique", "| MP4",
      "| Numéro d'immatriculation précédent", "| 7712 GH 01",
    ], 70), AUJOURDHUI);
    expect(verso).toMatchObject({ numeroChassis: "WDB9634031L123456", immatriculation: null, modele: null });
    const recto = analyserTexte("carte_grise", texte(["CARTE GRISE", "Marque", "MERCEDES"], 70, [["CD-123-EF-01"]]), AUJOURDHUI);
    expect(nettoyer("carte_grise", fusionner([verso, recto]))).toMatchObject({
      documentReconnu: true, immatriculation: "CD-123-EF-01", numeroChassis: "WDB9634031L123456", marque: "MERCEDES",
    });
  });

  it("des mots ordinaires mis bout à bout ne font pas un numéro de châssis ; une valeur en minuscules est du bruit", () => {
    expect(analyserTexte("carte_grise", texte(["Energie | Usage du véhicule Nombre d'essieux", "Gas-Oil | Prive"]), AUJOURDHUI).numeroChassis).toBeNull();
    expect(analyserTexte("carte_grise", texte(["Identité du propriétaire ee", "pe"]), AUJOURDHUI).proprietaire).toBeNull();
  });

  it("tableau (valeur à droite du libellé) : un libellé mal lu juste dessous n'est pas pris pour la valeur", () => {
    const champs = analyserTexte("carte_grise", texte([
      "N° d'immatriculation | 4521 KM 01", "Marque | TOYOTA", "Type | COROLLA", "Gers | VP", "Énergie | ESSENCE", "Puissance fiscale | 8 CV",
    ]), AUJOURDHUI);
    expect(champs).toMatchObject({ modele: "COROLLA", marque: "TOYOTA", energie: "Essence", puissanceFiscale: 8 });
  });

  it("carte d'identité : ligne de libellés dont un voisin est mal lu ; « carte NATIONALE » n'est pas la nationalité", () => {
    const champs = analyserTexte("piece_identite", texte([
      "CARTE NATIONALE D'IDENTITÉ", "SPÉCIMEN FICTIF", "Nom | N° de la carte", "KOUASSI | CI4567890", "Prénoms", "AWA", "Date de naissance | Sexe",
      "03/02/1990 | F", "Lieu de naissance | Tarète", "BOUAKE | 1,68 m",
    ]), AUJOURDHUI);
    expect(champs).toMatchObject({
      typePiece: "cni", numero: "CI4567890", nom: "KOUASSI", prenoms: "AWA", dateNaissance: "1990-02-03", sexe: "F", lieuNaissance: "BOUAKE", nationalite: null,
    });
  });

  it("pièce d'identité : la zone lisible par machine, juste, fait foi ; le reste vient des libellés", () => {
    const champs = nettoyer("piece_identite", analyserTexte("piece_identite", texte([
      "PASSEPORT — UTOPIA", "N° du passeport L898902C8", "Nom ERIKSSON", "Prénoms ANNA MARIA", "Date de naissance 12/08/1974", "sexe F",
      "Lieu de naissance ZENITH", "Date de délivrance 16/04/2024", "Date d'expiration 15/04/2034",
      "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UT07408122F3404159ZE184226B<<<<<16",
    ]), AUJOURDHUI)) as ChampsPieceIdentite;
    expect(champs).toMatchObject({
      documentReconnu: true, typePiece: "passeport", numero: "L898902C3", nom: "ERIKSSON", prenoms: "ANNA MARIA", dateNaissance: "1974-08-12",
      lieuNaissance: "ZENITH", sexe: "F", dateDelivrance: "2024-04-16", dateExpiration: "2034-04-15",
    });
    expect(controler("piece_identite", champs, AUJOURDHUI)).toContainEqual(expect.objectContaining({ champ: "numero", niveau: "ok" }));
  });

  it("carte d'identité ivoirienne sans zone lue : libellés seulement ; nationalité déduite du code du pays", () => {
    const sansZone = nettoyer("piece_identite", analyserTexte("piece_identite", texte([
      "RÉPUBLIQUE DE CÔTE D'IVOIRE", "CARTE NATIONALE D'IDENTITÉ", "N° C 0012345678", "Nom KOUASSI", "Prénoms AWA", "Né(e) le 03/02/1990",
      "Sexe F", "Date d'expiration 02/02/2030",
    ]), AUJOURDHUI));
    expect(sansZone).toMatchObject({ typePiece: "cni", numero: "0012345678", nom: "KOUASSI", prenoms: "AWA", dateNaissance: "1990-02-03", dateExpiration: "2030-02-02", mrz: null });
    const avecZone = nettoyer("piece_identite", analyserTexte("piece_identite", texte(["IDCIVC0012345<6<<<<<<<<<<<<<<<", "9002034F3002028CIV<<<<<<<<<<<4", "KOUASSI<<AWA<<<<<<<<<<<<<<<<<<"]), AUJOURDHUI));
    expect(avecZone).toMatchObject({ typePiece: "cni", nationalite: "Ivoirienne", nom: "KOUASSI", prenoms: "AWA" });
  });

  it("constat : date, heure, lieu et immatriculations seulement, lecture toujours signalée partielle", () => {
    const champs = nettoyer("constat_amiable", analyserTexte("constat_amiable", texte([
      "CONSTAT AMIABLE D'ACCIDENT AUTOMOBILE", "1. Date de l'accident 28/10/2026 Heure 8h40", "2. Lieu Carrefour Siporex, Yopougon",
      "Véhicule A 2024 KM 01", "Véhicule B 7712 GH 01",
    ], 60), AUJOURDHUI)) as ChampsConstat;
    expect(champs).toMatchObject({ documentReconnu: true, lisibilite: "partielle", date: "2026-10-28", heure: "08:40", lieu: "Carrefour Siporex, Yopougon" });
    expect(champs.vehicules.map((v) => [v.lettre, v.immatriculation])).toEqual([["A", "2024 KM 01"], ["B", "7712 GH 01"]]);
  });
});

describe("photo extraite d'un PDF", () => {
  it("reprend la plus grande image JPEG ; rien dans un PDF sans photo", () => {
    const petite = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 0xff, 0xd9]);
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 7), Buffer.from([0xff, 0xd9])]);
    const objet = (n: number, image: Buffer) => Buffer.concat([
      Buffer.from(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`, "latin1"),
      image, Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), objet(1, petite), objet(2, grande), Buffer.from("%%EOF\n", "latin1")]);
    expect(imageDuPdf(pdf)?.equals(grande)).toBe(true);
    expect(imageDuPdf(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 5 >>\nstream\nBT ET\nendstream\nendobj\n%%EOF\n"))).toBeNull();
  });
});

describe("lecteur local (Tesseract) sur de vraies images", () => {
  const ocr = creerOcr();
  afterAll(() => ocr.fermer());
  const lecteur = creerLecteur({ prestataire: "local" }, { ocr, aujourdhui: () => AUJOURDHUI })!;
  const exemple = (nom: string) => readFileSync(new URL(`../donnees/lecture/${nom}`, import.meta.url));

  const jpeg = (...noms: string[]) => noms.map((nom) => ({ contenu: exemple(nom), type: "image/jpeg" as const }));

  it("lit le recto et le verso d'une carte grise récente, photographiés et compressés comme sur WhatsApp", async () => {
    const resultat = await lecteur.lire("carte_grise", jpeg("carte-grise-2023-recto.jpg", "carte-grise-2023-verso.jpg"));
    expect(resultat).toMatchObject({
      ok: true,
      champs: {
        documentReconnu: true, immatriculation: "CD-123-EF-01", numeroChassis: "WDB9634031L123456", marque: "MERCEDES", genre: "Tracteur Routier",
        puissanceFiscale: 26, placesAssises: 2, datePremiereMiseEnCirculation: "2019-03-14", usage: "Privé",
      },
    });
  }, 60_000);

  it("lit le recto et le verso d'une carte d'identité : zone lisible par machine juste, nationalité déduite", async () => {
    const resultat = await lecteur.lire("piece_identite", jpeg("cni-recto.jpg", "cni-verso.jpg"));
    if (!resultat.ok) throw new Error(resultat.message);
    expect(resultat.champs).toMatchObject({
      typePiece: "cni", numero: "CI4567890", nom: "KOUASSI", prenoms: "AWA", dateNaissance: "1990-02-03", sexe: "F", nationalite: "Ivoirienne",
      dateExpiration: "2030-02-02",
    });
    expect(controler("piece_identite", resultat.champs, AUJOURDHUI)).toContainEqual(expect.objectContaining({ champ: "numero", niveau: "ok" }));
  }, 60_000);

  it("lit la photo d'une carte grise (penchée, un peu floue)", async () => {
    const resultat = await lecteur.lire("carte_grise", jpeg("carte-grise-photo.jpg"));
    expect(resultat).toMatchObject({
      ok: true,
      champs: {
        documentReconnu: true, immatriculation: "4521 KM 01", numeroChassis: "JTDBR32E720123456", marque: "TOYOTA", modele: "COROLLA",
        energie: "Essence", puissanceFiscale: 8, placesAssises: 5, datePremiereMiseEnCirculation: "2019-03-14", proprietaire: "KONE MARIAM",
      },
    });
  }, 60_000);

  it("lit la photo d'un passeport : zone lisible par machine corrigée et confirmée", async () => {
    const resultat = await lecteur.lire("piece_identite", jpeg("passeport-photo.jpg"));
    if (!resultat.ok) throw new Error(resultat.message);
    expect(resultat.champs).toMatchObject({ typePiece: "passeport", numero: "L898902C3", nom: "ERIKSSON", prenoms: "ANNA MARIA", dateExpiration: "2034-04-15" });
    expect(controler("piece_identite", resultat.champs, AUJOURDHUI)).toContainEqual(
      { champ: "numero", niveau: "ok", message: "Numéro et dates confirmés par la zone lisible par machine (chiffres de contrôle justes)." },
    );
  }, 60_000);

  it("lit la taille des images sans les décoder, et refuse celles qui seraient démesurées une fois décodées", async () => {
    expect(dimensions(exemple("carte-grise.png"))).toMatchObject({ largeur: expect.any(Number), hauteur: expect.any(Number) });
    const { largeur, hauteur } = dimensions(exemple("carte-grise-photo.jpg"))!;
    expect(largeur).toBeGreaterThan(800);
    expect(hauteur).toBeGreaterThan(400);
    // En-tête d'un PNG de 20 000 × 20 000 pixels (400 millions) : refusé avant toute lecture
    const geant = Buffer.from(exemple("carte-grise.png"));
    geant.writeUInt32BE(20_000, 16);
    geant.writeUInt32BE(20_000, 20);
    expect(await lecteur.lire("carte_grise", [{ contenu: geant, type: "image/png" }]))
      .toMatchObject({ ok: false, raison: "illisible", message: expect.stringContaining("trop grande") });
  });

  it("un fichier qui n'est pas une image, ou un PDF sans photo, n'est pas lu", async () => {
    expect(await lecteur.lire("carte_grise", [{ contenu: Buffer.from("pas une image"), type: "image/png" }])).toMatchObject({ ok: false, raison: "illisible" });
    expect(await lecteur.lire("carte_grise", [{ contenu: Buffer.from("%PDF-1.4\n%%EOF\n"), type: "application/pdf" }]))
      .toMatchObject({ ok: false, raison: "illisible", message: expect.stringContaining("photo") });
  }, 30_000);
});

describe("lecteur Ollama (modèle ouvert sur une machine de l'agence, réseau simulé)", () => {
  type Appel = { url: string; corps: Record<string, unknown> };
  const config = { prestataire: "ollama" as const, adresse: "http://127.0.0.1:11434", modele: "modele-de-test" };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  function reseau(statut: number, corps: unknown) {
    const appels: Appel[] = [];
    const recuperer = (async (url: string | URL | Request, init?: RequestInit) => {
      appels.push({ url: String(url), corps: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { appels, recuperer };
  }
  const reponse = (contenu: string, fin = "stop") => ({ model: "modele-de-test", message: { role: "assistant", content: contenu }, done: true, done_reason: fin });

  it("envoie l'image et le schéma du document à Ollama ; nettoie la réponse et corrige la zone lisible par machine", async () => {
    const { appels, recuperer } = reseau(200, reponse(JSON.stringify({
      documentReconnu: true, lisibilite: "bonne", remarques: null, typePiece: "passeport", numero: "L898902C3", nom: "ERIKSSON", prenoms: "ANNA MARIA",
      dateNaissance: "1974-08-12", lieuNaissance: null, sexe: "F", nationalite: "Utopienne", dateDelivrance: null, dateExpiration: "2034-04-15",
      mrz: ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UT07408122F3404159ZE184226B<<<<<16"],
    })));
    const resultat = await creerLecteur(config, { fetch: recuperer, aujourdhui: () => AUJOURDHUI })!
      .lire("piece_identite", [{ contenu: PNG, type: "image/png" }, { contenu: PNG, type: "image/png" }]);
    if (!resultat.ok) throw new Error(resultat.message);
    expect((resultat.champs as ChampsPieceIdentite).mrz?.[1]).toContain("UTO7408122");
    expect(controler("piece_identite", resultat.champs, AUJOURDHUI).at(-1)).toMatchObject({ niveau: "ok" });

    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(appels[0]!.corps).toMatchObject({ model: "modele-de-test", stream: false, options: { temperature: 0 }, format: { type: "object" } });
    const messages = appels[0]!.corps.messages as { role: string; images?: string[] }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    // Recto et verso partent ensemble
    expect(messages[1]!.images).toEqual([PNG.toString("base64"), PNG.toString("base64")]);
  });

  it("modèle absent, machine éteinte, réponse coupée ou pas du JSON : des issues claires", async () => {
    const cas: [ReturnType<typeof reseau>["recuperer"], string][] = [
      [reseau(404, { error: "model 'modele-de-test' not found" }).recuperer, "configuration"],
      [reseau(500, { error: "out of memory" }).recuperer, "indisponible"],
      [reseau(200, reponse("{\"documentReconnu\": tr", "length")).recuperer, "illisible"],
      [reseau(200, reponse("pas du JSON")).recuperer, "illisible"],
      [(async () => { throw new TypeError("fetch failed"); }) as typeof fetch, "indisponible"],
    ];
    for (const [recuperer, raison] of cas) {
      expect(await creerLecteur(config, { fetch: recuperer })!.lire("constat_amiable", [{ contenu: PNG, type: "image/png" }])).toMatchObject({ ok: false, raison });
    }
    expect(creerLecteur(null)).toBeNull();
  });
});
