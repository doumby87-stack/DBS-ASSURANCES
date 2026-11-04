// SMS : l'opérateur n'est pas encore choisi (feuille de route, tâche 2 ; ADR 0007).
// Son adaptateur implémentera cette interface ; d'ici là, le canal SMS n'est actif qu'en simulation,
// et un client qui n'accepte que le SMS apparaît dans les relances « à faire à la main ».

import type { ResultatEnvoi } from "../envoi.js";

export interface FournisseurSms {
  /** Envoie un texte au numéro E.164 (+225…). */
  envoyer(destinataire: string, texte: string): Promise<ResultatEnvoi>;
}
