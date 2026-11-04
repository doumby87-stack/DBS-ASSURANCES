// Lecture et validation des variables d'environnement au démarrage.
// L'API refuse de démarrer si une variable obligatoire manque ou est invalide.
// Les valeurs ne sont jamais affichées dans les messages d'erreur : elles peuvent être des secrets.

export type Environnement = "developpement" | "test" | "production";

export interface Configuration {
  environnement: Environnement;
  hote: string;
  port: number;
  /** Connexion avec le compte dbs_application (jamais dbs_proprietaire). */
  urlBaseDeDonnees: string;
  /** Clé AES-256 (32 octets) qui chiffre les secrets du deuxième facteur et les données très sensibles. */
  cleChiffrement: Buffer;
  /** Seule origine autorisée à envoyer des requêtes qui modifient des données (protection CSRF). */
  origineBackOffice: string;
  /** Nombre de proxys (répartiteur, pare-feu applicatif) devant l'API, pour retrouver l'adresse IP réelle. */
  proxysDeConfiance: number;
  /** Refuser les mots de passe présents dans des fuites connues (service Have I Been Pwned). */
  verifierMotsDePasseDivulgues: boolean;
  niveauJournal: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

export class ErreurConfiguration extends Error {
  constructor(readonly problemes: string[]) {
    super("Configuration invalide :\n- " + problemes.join("\n- "));
    this.name = "ErreurConfiguration";
  }
}

const NIVEAUX_JOURNAL = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export function chargerConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const problemes: string[] = [];

  function obligatoire(nom: string): string {
    const valeur = env[nom]?.trim();
    if (!valeur) problemes.push(`${nom} est obligatoire`);
    return valeur ?? "";
  }

  function entier(nom: string, defaut: number, min: number, max: number): number {
    const brut = env[nom]?.trim();
    if (!brut) return defaut;
    const valeur = Number(brut);
    if (!Number.isInteger(valeur) || valeur < min || valeur > max) {
      problemes.push(`${nom} doit être un entier entre ${min} et ${max}`);
      return defaut;
    }
    return valeur;
  }

  const environnement: Environnement =
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "developpement";

  const urlBaseDeDonnees = obligatoire("DATABASE_URL");
  if (urlBaseDeDonnees && !/^postgres(ql)?:\/\//.test(urlBaseDeDonnees)) {
    problemes.push("DATABASE_URL doit commencer par postgres:// ou postgresql://");
  }

  const cleBrute = obligatoire("CLE_CHIFFREMENT_DONNEES");
  const cleChiffrement = Buffer.from(cleBrute, "base64");
  if (cleBrute && cleChiffrement.length !== 32) {
    problemes.push("CLE_CHIFFREMENT_DONNEES doit contenir 32 octets encodés en base64 (openssl rand -base64 32)");
  }

  let origineBackOffice = "";
  const urlBackOffice = obligatoire("URL_BACK_OFFICE");
  if (urlBackOffice) {
    try {
      const url = new URL(urlBackOffice);
      origineBackOffice = url.origin;
      if (environnement === "production" && url.protocol !== "https:") {
        problemes.push("URL_BACK_OFFICE doit être en https en production");
      }
    } catch {
      problemes.push("URL_BACK_OFFICE doit être une adresse complète, par exemple https://gestion.exemple.ci");
    }
  }

  const niveau = (env.NIVEAU_JOURNAL?.trim() || "info") as Configuration["niveauJournal"];
  if (!NIVEAUX_JOURNAL.includes(niveau)) {
    problemes.push(`NIVEAU_JOURNAL doit valoir : ${NIVEAUX_JOURNAL.join(", ")}`);
  }

  const verification = env.VERIFIER_MOTS_DE_PASSE_DIVULGUES?.trim().toLowerCase();
  if (verification && !["true", "false"].includes(verification)) {
    problemes.push("VERIFIER_MOTS_DE_PASSE_DIVULGUES doit valoir true ou false");
  }

  const configuration: Configuration = {
    environnement,
    hote: env.HOST?.trim() || "127.0.0.1",
    port: entier("PORT", 3000, 1, 65535),
    urlBaseDeDonnees,
    cleChiffrement,
    origineBackOffice,
    proxysDeConfiance: entier("PROXYS_DE_CONFIANCE", 0, 0, 5),
    verifierMotsDePasseDivulgues: verification !== "false",
    niveauJournal: niveau,
  };

  if (problemes.length > 0) throw new ErreurConfiguration(problemes);
  return configuration;
}
