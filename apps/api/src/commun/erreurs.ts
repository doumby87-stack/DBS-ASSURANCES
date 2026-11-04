// Erreurs renvoyées au navigateur : un code stable et un message en français.
// Rien de l'intérieur ne sort (pas de trace, pas de requête SQL, pas de nom de table) ;
// les détails techniques vont dans le journal du serveur.

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ErreurApi";
  }
}

export const erreurs = {
  nonAuthentifie: () => new ErreurApi(401, "non_authentifie", "Connectez-vous pour continuer."),
  identifiantsInvalides: () =>
    new ErreurApi(
      401,
      "identifiants_invalides",
      "E-mail ou mot de passe incorrect, ou compte temporairement bloqué. Réessayez dans quelques minutes.",
    ),
  codeInvalide: () => new ErreurApi(401, "code_invalide", "Code incorrect ou déjà utilisé."),
  tropDeTentatives: () =>
    new ErreurApi(429, "trop_de_tentatives", "Trop de tentatives depuis cette adresse. Réessayez dans 15 minutes."),
  accesRefuse: () => new ErreurApi(403, "acces_refuse", "Vous n'avez pas les droits pour cette action."),
  motDePasseAChanger: () =>
    new ErreurApi(403, "mot_de_passe_a_changer", "Choisissez votre mot de passe personnel avant de continuer."),
  origineRefusee: () => new ErreurApi(403, "origine_refusee", "Origine de la requête refusée."),
  introuvable: () => new ErreurApi(404, "introuvable", "Élément introuvable."),
};

interface ErreurPostgres {
  code: string;
  severity?: string;
  constraint?: string;
  message: string;
}

function estErreurPostgres(erreur: unknown): erreur is ErreurPostgres {
  if (typeof erreur !== "object" || erreur === null) return false;
  const { code, severity } = erreur as { code?: unknown; severity?: unknown };
  return typeof severity === "string" && typeof code === "string" && code.length === 5;
}

function reponse(statut: number, code: string, message: string, champs?: string[]) {
  return { statut, corps: champs ? { code, message, champs } : { code, message } };
}

/** Contrôles de la base dont le refus mérite un message précis (rédigé ici, jamais repris de la base). */
const CONTRAINTES: Record<string, { statut: number; code: string; message: string }> = {
  encaissements_reference_unique: {
    statut: 409, code: "reference_deja_utilisee",
    message: "Cette référence a déjà été enregistrée : même transaction Mobile Money, même chèque ou même virement.",
  },
  encaissements_annulation_unique: { statut: 409, code: "deja_contre_passe", message: "Cet encaissement a déjà été contre-passé." },
  encaissements_reference: {
    statut: 422, code: "reference_obligatoire",
    message: "Indiquez la référence du paiement (n° de transaction, de chèque ou de virement).",
  },
  reversements_quatre_yeux: {
    statut: 403, code: "quatre_yeux",
    message: "Principe des quatre yeux : une autre personne que celle qui a préparé le bordereau doit le valider.",
  },
  reversements_versement_apres_validation: {
    statut: 422, code: "bordereau_non_valide", message: "Faites valider le bordereau avant d'enregistrer le versement.",
  },
  clotures_quatre_yeux: {
    statut: 403, code: "quatre_yeux", message: "Principe des quatre yeux : un autre gérant doit viser votre clôture de caisse.",
  },
  clotures_ecart_justifie: {
    statut: 422, code: "ecart_a_justifier", message: "Les espèces comptées ne correspondent pas : expliquez l'écart en quelques mots.",
  },
  contrats_prime_nette: {
    statut: 422, code: "prime_nette_invalide", message: "La prime nette doit être positive et ne pas dépasser la prime TTC.",
  },
  taux_commission_unique: { statut: 409, code: "conflit", message: "Un taux existe déjà pour cette branche à cette date." },
};

/** Traduit une erreur en réponse sûre pour le navigateur. */
export function traduireErreur(erreur: unknown) {
  if (erreur instanceof ErreurApi) return reponse(erreur.statut, erreur.code, erreur.message);

  const fastify = erreur as Partial<FastifyError>;
  if (fastify.validation) {
    const champs = fastify.validation.map((v) => {
      const manquant = (v.params as { missingProperty?: string } | undefined)?.missingProperty;
      return (v.instancePath || "").replace(/^\//, "").replace(/\//g, ".") || manquant || "corps";
    });
    return reponse(400, "requete_invalide", "Certaines informations sont manquantes ou invalides.", [...new Set(champs)]);
  }
  if (fastify.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return reponse(415, "type_de_contenu_refuse", "Envoyez les données au format JSON.");
  }
  if (fastify.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return reponse(413, "requete_trop_volumineuse", "Requête trop volumineuse.");
  }

  if (estErreurPostgres(erreur)) {
    const connue = erreur.constraint ? CONTRAINTES[erreur.constraint] : undefined;
    if (connue) return reponse(connue.statut, connue.code, connue.message);
    switch (erreur.code) {
      case "28000": // utilisateur non déclaré, inconnu ou désactivé
        return reponse(401, "non_authentifie", "Connectez-vous pour continuer.");
      case "42501": // droits ligne par ligne ou par colonne
        return reponse(403, "acces_refuse", "Vous n'avez pas les droits pour cette action.");
      case "23505":
        return reponse(409, "conflit", "Cette information existe déjà.");
      case "23514":
        // Sans nom de contrainte : règle métier levée par la base avec un message rédigé pour l'utilisateur
        // (plafond des espèces, contrat non payé…). Avec : contrôle de format interne, message générique.
        return erreur.constraint
          ? reponse(422, "donnees_refusees", "Données refusées par une règle de contrôle.")
          : reponse(422, "regle_metier", erreur.message);
      case "23502":
      case "23503":
      case "22P02":
        return reponse(422, "donnees_refusees", "Données refusées par une règle de contrôle.");
    }
  }

  const statut = typeof fastify.statusCode === "number" ? fastify.statusCode : 500;
  if (statut >= 400 && statut < 500) return reponse(statut, "requete_invalide", "Requête invalide.");
  return reponse(500, "erreur_interne", "Une erreur est survenue. Réessayez plus tard.");
}

export function gestionnaireErreurs(erreur: unknown, requete: FastifyRequest, reponseHttp: FastifyReply) {
  const { statut, corps } = traduireErreur(erreur);
  if (statut >= 500) requete.log.error({ err: erreur }, "erreur interne");
  else if (!(erreur instanceof ErreurApi)) requete.log.info({ code: corps.code, statut }, "requête refusée");
  return reponseHttp.status(statut).send(corps);
}
