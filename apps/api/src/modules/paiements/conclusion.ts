// Conclusion d'un paiement en ligne : le résultat est toujours demandé au prestataire lui-même (verifier),
// jamais pris dans une notification ou dans la page de retour, que n'importe qui peut imiter. La base enregistre
// ensuite l'encaissement (app.conclure_paiement_en_ligne, database/migrations/0013) ; rejouer ne change rien.

import type { Pool } from "../../base-de-donnees/connexion.js";
import { transactionSysteme } from "../../base-de-donnees/connexion.js";
import type { PrestatairePaiement } from "../../integrations/paiement/prestataire.js";

export type StatutPaiementEnLigne = "initie" | "en_attente" | "accepte" | "refuse" | "abandonne" | "a_regulariser";

/** Statut après vérification, ou null si le prestataire n'a pas encore de résultat (ou ne répond pas). */
export async function verifierEtConclure(
  pool: Pool,
  prestataire: PrestatairePaiement,
  reference: string,
): Promise<StatutPaiementEnLigne | null> {
  const verification = await prestataire.verifier(reference);
  if (!verification || verification.resultat === "en_attente") return null;
  const { rows } = await transactionSysteme(pool, (client) =>
    client.query<{ statut: StatutPaiementEnLigne }>(
      "SELECT app.conclure_paiement_en_ligne($1, $2, $3, $4, $5) AS statut",
      [reference, verification.resultat, verification.montant, verification.moyen, verification.referenceOperateur],
    ),
  );
  return rows[0]?.statut ?? null;
}

/**
 * Évite d'interroger le prestataire à chaque rafraîchissement de la page de retour : une vérification par
 * paiement toutes les 5 secondes au plus.
 */
export function creerLimiteVerifications(intervalleMs = 5000): (paiementId: string) => boolean {
  const dernieres = new Map<string, number>();
  return (paiementId) => {
    const maintenant = Date.now();
    const derniere = dernieres.get(paiementId);
    if (derniere !== undefined && maintenant - derniere < intervalleMs) return false;
    if (dernieres.size > 5000) {
      for (const [id, instant] of dernieres) if (maintenant - instant >= intervalleMs) dernieres.delete(id);
    }
    dernieres.set(paiementId, maintenant);
    return true;
  };
}
