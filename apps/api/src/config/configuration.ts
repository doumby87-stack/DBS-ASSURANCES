// Lecture et validation des variables d'environnement au démarrage.
// L'API refuse de démarrer si une variable obligatoire manque ou est invalide.
// Les valeurs ne sont jamais affichées dans les messages d'erreur : elles peuvent être des secrets.

export type Environnement = "developpement" | "test" | "production";

/** Accès à l'API WhatsApp Cloud de Meta (docs/architecture/adr/0007-relances-whatsapp-et-sms.md). */
export interface ConfigurationWhatsApp {
  /** Jeton d'accès permanent d'un utilisateur système du compte WhatsApp Business. */
  jeton: string;
  /** Identifiant du numéro de téléphone de l'agence chez Meta (pas le numéro lui-même). */
  identifiantNumero: string;
  /** Secret de l'application Meta : vérifie la signature des notifications reçues. */
  secretApplication: string;
  /** Jeton choisi par l'agence, demandé par Meta pour activer les notifications. */
  jetonVerification: string;
  /** Version de l'API Graph, par exemple v23.0. */
  versionApi: string;
}

export interface ConfigurationRelances {
  /** Planificateur lancé avec l'API, toutes les 15 minutes. */
  actives: boolean;
  /** Messages simulés (rien ne part) : développement et tests uniquement, refusé en production. */
  simulation: boolean;
  /** Heures d'envoi, heure d'Abidjan : début inclus, fin exclue. Personne n'est relancé la nuit. */
  heuresEnvoi: { debut: number; fin: number };
  whatsapp: ConfigurationWhatsApp | null;
}

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
  relances: ConfigurationRelances;
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

  function booleen(nom: string, defaut: boolean): boolean {
    const brut = env[nom]?.trim().toLowerCase();
    if (!brut) return defaut;
    if (brut !== "true" && brut !== "false") problemes.push(`${nom} doit valoir true ou false`);
    return brut === "true";
  }

  // WhatsApp : tout ou rien, pour ne jamais démarrer à moitié configuré
  const variablesWhatsApp = {
    jeton: "WHATSAPP_JETON",
    identifiantNumero: "WHATSAPP_IDENTIFIANT_NUMERO",
    secretApplication: "WHATSAPP_SECRET_APPLICATION",
    jetonVerification: "WHATSAPP_JETON_VERIFICATION",
  } as const;
  const valeursWhatsApp = Object.fromEntries(
    Object.entries(variablesWhatsApp).map(([cle, nom]) => [cle, env[nom]?.trim() ?? ""]),
  ) as Record<keyof typeof variablesWhatsApp, string>;
  const renseignees = Object.values(valeursWhatsApp).filter(Boolean).length;
  let whatsapp: ConfigurationWhatsApp | null = null;
  if (renseignees > 0 && renseignees < 4) {
    problemes.push(`WhatsApp : renseignez ensemble ${Object.values(variablesWhatsApp).join(", ")}, ou aucune`);
  } else if (renseignees === 4) {
    const versionApi = env.WHATSAPP_VERSION_API?.trim() || "v23.0";
    if (!/^\d{9,20}$/.test(valeursWhatsApp.identifiantNumero)) {
      problemes.push("WHATSAPP_IDENTIFIANT_NUMERO doit être l'identifiant numérique donné par Meta");
    }
    if (!/^v\d{1,3}\.\d$/.test(versionApi)) problemes.push("WHATSAPP_VERSION_API doit ressembler à v23.0");
    whatsapp = { ...valeursWhatsApp, versionApi };
  }

  const simulation = booleen("RELANCES_SIMULATION", false);
  if (simulation && environnement === "production") {
    problemes.push("RELANCES_SIMULATION est interdit en production : aucun client ne serait relancé");
  }
  let heuresEnvoi = { debut: 8, fin: 20 };
  const heures = env.RELANCES_HEURES_ENVOI?.trim();
  if (heures) {
    const correspondance = /^(\d{1,2})-(\d{1,2})$/.exec(heures);
    const debut = Number(correspondance?.[1]);
    const fin = Number(correspondance?.[2]);
    if (!correspondance || debut >= fin || fin > 24) {
      problemes.push("RELANCES_HEURES_ENVOI doit ressembler à 8-20 (heure de début, heure de fin, de 0 à 24)");
    } else {
      heuresEnvoi = { debut, fin };
    }
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
    relances: { actives: booleen("RELANCES_ACTIVES", false), simulation, heuresEnvoi, whatsapp },
  };

  if (problemes.length > 0) throw new ErreurConfiguration(problemes);
  return configuration;
}
