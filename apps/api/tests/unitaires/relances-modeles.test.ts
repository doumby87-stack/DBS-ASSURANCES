// Textes des relances : rédaction de chaque type, et accord exact avec les modèles soumis à Meta.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dansLesHeuresDEnvoi } from "../../src/modules/relances/cycle.js";
import { creerMessagerie } from "../../src/modules/relances/messagerie.js";
import {
  ErreurRedaction, MODELES, PIED_SMS, PIED_WHATSAPP, rediger, texteRelance, TYPES_RELANCE,
} from "../../src/modules/relances/modeles.js";

const client = { nom: "Kouassi Aya", branche: "automobile", numeroPolice: "1234567" };

describe("Rédaction des relances", () => {
  it("échéance : nom, branche et police, date au format du pays", () => {
    const redaction = rediger("echeance_j7", { ...client, dateEcheance: "2026-11-29" });
    expect(redaction.whatsapp).toEqual({
      nom: "dbs_echeance_contrat",
      parametres: ["Kouassi Aya", "automobile (police 1234567)", "29/11/2026"],
    });
    expect(redaction.texte).toBe(
      "Bonjour Kouassi Aya, votre assurance automobile (police 1234567) arrive à échéance le 29/11/2026. "
      + "Pour la renouveler sans interruption de garantie, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.",
    );
    expect(redaction.sms).toBe(`${redaction.texte} ${PIED_SMS}`);
  });

  it("chaque étape d'échéance utilise le même modèle ; le contrat expiré a le sien", () => {
    for (const type of ["echeance_j30", "echeance_j15", "echeance_j7", "echeance_jour"] as const) {
      expect(rediger(type, { ...client, dateEcheance: "2026-12-01" }).whatsapp.nom).toBe("dbs_echeance_contrat");
    }
    const expire = rediger("contrat_expire", { ...client, numeroPolice: null, dateEcheance: "2026-11-01" });
    expect(expire.whatsapp).toEqual({ nom: "dbs_contrat_expire", parametres: ["Kouassi Aya", "automobile", "01/11/2026"] });
    expect(expire.texte).toContain("vous n'êtes plus couvert");
  });

  it("devis sans réponse et avancement d'un sinistre", () => {
    expect(rediger("devis_sans_reponse", { nom: "Transports Yao", branche: "flotte" }).texte)
      .toBe("Bonjour Transports Yao, avez-vous pu étudier notre devis d'assurance flotte ? Nous restons à votre disposition : "
        + "répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.");
    const sinistre = rediger("sinistre_avancement", { ...client, survenuLe: "2026-11-02", statut: "transmis_compagnie" });
    expect(sinistre.whatsapp.parametres).toEqual([
      "Kouassi Aya", "02/11/2026", "automobile (police 1234567)", "votre dossier a été transmis à SanlamAllianz",
    ]);
  });

  it("une branche « autre » se dit « sur mesure »", () => {
    expect(rediger("devis_sans_reponse", { nom: "Yao", branche: "autre" }).whatsapp.parametres[1]).toBe("sur mesure");
  });

  it("refuse de rédiger un message incomplet plutôt que d'envoyer un trou", () => {
    expect(() => rediger("echeance_j30", { ...client })).toThrow(ErreurRedaction);
    expect(() => rediger("echeance_j30", { branche: "automobile", dateEcheance: "2026-11-29" })).toThrow("nom");
    expect(() => rediger("echeance_j30", { ...client, dateEcheance: "29/11/2026" })).toThrow(ErreurRedaction);
    expect(texteRelance("sinistre_avancement", { nom: "Yao" })).toBeNull();
  });

  it("documents des véhicules : un message groupé par client, cinq documents cités au plus", () => {
    const documents = [
      { immatriculation: "9011 DOC 01", document: "visite_technique", echeance: "2026-11-24" },
      { immatriculation: "9011 DOC 01", document: "vignette", echeance: "2026-11-29" },
      { immatriculation: "9012 DOC 01", document: "carte_de_transport", echeance: "2026-11-30" },
      { immatriculation: "9013 DOC 01", document: "vignette", echeance: "2026-12-01" },
      { immatriculation: "9014 DOC 01", document: "vignette", echeance: "2026-12-02" },
      { immatriculation: "9015 DOC 01", document: "vignette", echeance: "2026-12-03" },
    ];
    const groupe = rediger("documents_vehicules", {
      nom: "Transports Yao", etape: "j30", nombre: 7, premiereEcheance: "2026-11-24", documents,
    });
    expect(groupe.whatsapp.nom).toBe("dbs_documents_vehicules");
    expect(groupe.texte).toBe(
      "Bonjour Transports Yao, 7 documents de vos véhicules arrivent à échéance, le premier le 24/11/2026 : "
      + "visite technique 9011 DOC 01 le 24/11, vignette 9011 DOC 01 le 29/11, carte de transport 9012 DOC 01 le 30/11, "
      + "vignette 9013 DOC 01 le 01/12, vignette 9014 DOC 01 le 02/12 et 2 autres. "
      + "Pour rouler en règle, pensez à les renouveler à temps. Pour toute question, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.",
    );
    const seul = rediger("documents_vehicules", {
      nom: "Yao", etape: "j7", nombre: 1, premiereEcheance: "2026-11-24", documents: documents.slice(0, 1),
    });
    expect(seul.whatsapp.parametres.slice(1)).toEqual([
      "un document de vos véhicules arrive à échéance le 24/11/2026", "visite technique 9011 DOC 01 le 24/11",
    ]);
    const echus = rediger("documents_vehicules", { nom: "Yao", etape: "echu", nombre: 2, premiereEcheance: "2026-11-01", documents });
    expect(echus.whatsapp.parametres[1]).toBe("2 documents de vos véhicules ont expiré");
    expect(() => rediger("documents_vehicules", { nom: "Yao", etape: "j30", nombre: 1, documents: [] })).toThrow(ErreurRedaction);
  });

  it("échéance d'une prime payée en plusieurs fois : à J-7, puis en retard", () => {
    const parametres = { nom: "Transports Yao", branche: "flotte", numeroPolice: "FLT-2026-01", montant: 312_500, dateEcheance: "2027-02-01" };
    const bientot = rediger("echeance_paiement", { ...parametres, etape: "j7" });
    expect(bientot.whatsapp.nom).toBe("dbs_echeance_paiement");
    expect(bientot.texte).toBe(
      "Bonjour Transports Yao, l'échéance de 312 500 F CFA de votre assurance flotte (police FLT-2026-01) est à payer au plus tard "
      + "le 01/02/2027. Vous pouvez la régler à l'agence ou par Mobile Money. Pour toute question, répondez à ce message "
      + "ou appelez DBS-ASSURANCES au 07 49 36 07 02.",
    );
    const retard = rediger("echeance_paiement", { ...parametres, etape: "retard" });
    expect(retard.whatsapp.parametres[3]).toBe("n'est pas encore réglée : elle était due le 01/02/2027");
    expect(() => rediger("echeance_paiement", { ...parametres, etape: "j7", montant: 0 })).toThrow(ErreurRedaction);
    expect(() => rediger("echeance_paiement", { ...parametres, etape: "j30" })).toThrow(ErreurRedaction);
  });

  it("chaque type de relance a un modèle", () => {
    for (const type of TYPES_RELANCE) {
      const parametres = {
        ...client, dateEcheance: "2026-11-29", survenuLe: "2026-11-02", statut: "declare",
        etape: type === "echeance_paiement" ? "j7" : "j30", nombre: 1, montant: 312_500,
        premiereEcheance: "2026-11-29", documents: [{ immatriculation: "1234 AB 01", document: "vignette", echeance: "2026-11-29" }],
      };
      expect(Object.keys(MODELES)).toContain(rediger(type, parametres).whatsapp.nom);
    }
  });
});

describe("Modèles soumis à Meta", () => {
  const documentation = readFileSync(new URL("../../../../docs/metier/modeles-de-messages.md", import.meta.url), "utf8");

  it("la documentation reprend chaque modèle mot pour mot, sous son nom", () => {
    for (const [nom, texte] of Object.entries(MODELES)) {
      expect(documentation).toContain(`### \`${nom}\``);
      expect(documentation).toContain(`\`\`\`text\n${texte}\n\`\`\``);
    }
    expect(documentation).toContain(`\`${PIED_WHATSAPP}\``);
    expect(documentation).toContain(`\`${PIED_SMS}\``);
  });

  it("noms acceptés par Meta et variables numérotées dans l'ordre", () => {
    for (const [nom, texte] of Object.entries(MODELES)) {
      expect(nom).toMatch(/^[a-z0-9_]{1,512}$/);
      const variables = [...texte.matchAll(/\{\{(\d+)\}\}/g)].map((v) => Number(v[1]));
      expect(variables).toEqual(variables.map((_v, i) => i + 1));
    }
  });
});

describe("Messagerie et heures d'envoi", () => {
  const base = { actives: true, heuresEnvoi: { debut: 8, fin: 20 } };

  it("sans WhatsApp configuré, aucun canal n'est actif ; en simulation, rien ne part mais tout réussit", async () => {
    expect(creerMessagerie({ ...base, simulation: false, whatsapp: null }).canaux).toEqual([]);
    const simulation = creerMessagerie({ ...base, simulation: true, whatsapp: null });
    expect(simulation.canaux).toEqual(["whatsapp", "sms"]);
    const resultat = await simulation.envoyer({
      type: "echeance_j30", canal: "sms", destinataire: "+2250749360702", parametres: { ...client, dateEcheance: "2026-11-29" },
    });
    expect(resultat.ok && resultat.identifiant.startsWith("simulation-")).toBe(true);
  });

  it("n'envoie qu'aux heures prévues, heure d'Abidjan", () => {
    const heures = { debut: 8, fin: 20 };
    expect(dansLesHeuresDEnvoi(new Date("2026-11-04T07:59:00Z"), heures)).toBe(false);
    expect(dansLesHeuresDEnvoi(new Date("2026-11-04T08:00:00Z"), heures)).toBe(true);
    expect(dansLesHeuresDEnvoi(new Date("2026-11-04T19:59:00Z"), heures)).toBe(true);
    expect(dansLesHeuresDEnvoi(new Date("2026-11-04T20:00:00Z"), heures)).toBe(false);
  });
});
