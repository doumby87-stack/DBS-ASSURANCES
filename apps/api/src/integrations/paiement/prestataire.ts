// Paiement en ligne (Mobile Money) : ce qu'on attend d'un prestataire (agrégateur de paiement), quel qu'il soit.
//   · initier : la page de paiement du prestataire, pour une référence et un montant ;
//   · verifier : le résultat d'un paiement, demandé au prestataire lui-même (authentifié). C'est la seule source
//     de vérité : une notification reçue ne fait que déclencher cette vérification ;
//   · lireNotification : la référence portée par une notification du prestataire, après contrôle de sa signature
//     (null si la notification n'est pas authentique ou si le prestataire n'en envoie pas).
// Prestataires : « simulation » (développement, tests, refusé en production). Le prestataire réel (agrégateur
// choisi par l'agence, par exemple CinetPay) s'ajoute ici, sans rien changer au reste ([ADR 0012]).

export type ResultatPaiement = "accepte" | "refuse" | "abandonne" | "en_attente";

export interface Verification {
  resultat: ResultatPaiement;
  /** Montant confirmé par le prestataire, en F CFA */
  montant: number | null;
  /** Moyen utilisé : WAVE, ORANGE_MONEY, MTN_MOMO, MOOV_MONEY… */
  moyen: string | null;
  /** N° de la transaction chez l'opérateur */
  referenceOperateur: string | null;
}

export interface DemandePaiement {
  reference: string;
  montant: number;
  description: string;
  telephone: string;
  nomClient: string;
  /** Page du portail où revient le client après le paiement */
  urlRetour: string;
  /** Adresse de l'API qui reçoit les notifications du prestataire */
  urlNotification: string;
}

export interface PrestatairePaiement {
  readonly nom: string;
  initier(demande: DemandePaiement): Promise<{ ok: true; urlPaiement: string } | { ok: false; erreur: string }>;
  verifier(reference: string): Promise<Verification | null>;
  lireNotification(corps: unknown, entetes: Record<string, string | string[] | undefined>): { reference: string } | null;
}

/**
 * Simulation : aucune transaction réelle. La « page de paiement » est celle du portail, qui propose de payer ou
 * de refuser ; le résultat choisi est gardé ici, comme le ferait le prestataire, puis vérifié comme un vrai.
 */
export interface PrestataireSimulation extends PrestatairePaiement {
  simuler(reference: string, accepte: boolean, montant: number, moyen?: string): void;
}

export function creerPrestataireSimulation(): PrestataireSimulation {
  const resultats = new Map<string, Verification>();
  return {
    nom: "simulation",
    async initier(demande) {
      resultats.set(demande.reference, { resultat: "en_attente", montant: null, moyen: null, referenceOperateur: null });
      return { ok: true, urlPaiement: demande.urlRetour };
    },
    async verifier(reference) {
      return resultats.get(reference) ?? null;
    },
    lireNotification() {
      return null;
    },
    simuler(reference, accepte, montant, moyen = "WAVE") {
      resultats.set(reference, accepte
        ? { resultat: "accepte", montant, moyen, referenceOperateur: `SIMULATION-${reference}` }
        : { resultat: "refuse", montant: null, moyen, referenceOperateur: null });
    },
  };
}

export function estSimulation(prestataire: PrestatairePaiement): prestataire is PrestataireSimulation {
  return prestataire.nom === "simulation" && "simuler" in prestataire;
}
