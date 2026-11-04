// Résultat d'un envoi de message, commun à WhatsApp et au SMS.
//   · ok : le fournisseur a accepté le message et donné son identifiant (pour suivre la remise) ;
//   · sinon : l'erreur, sans donnée personnelle, et si elle est définitive (inutile de réessayer :
//     numéro sans WhatsApp, modèle refusé…) ou passagère (réseau, service indisponible, limite de débit).

export type ResultatEnvoi =
  | { ok: true; identifiant: string }
  | { ok: false; erreur: string; definitif: boolean };
