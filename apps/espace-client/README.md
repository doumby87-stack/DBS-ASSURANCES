# Espace client

**Statut : à construire** (tâches 9 et 10 de la [feuille de route](../../docs/feuille-de-route.md)).

L'espace en ligne des assurés : voir ses contrats, télécharger ses attestations et reçus, payer ou renouveler en Mobile Money, déclarer un sinistre et suivre son dossier. Les entreprises et transporteurs y gèrent leur flotte.

Pile prévue : React, TypeScript, Vite, application installable sur téléphone (PWA), pensée d'abord pour le mobile et les connexions lentes.

## Pages

| Dossier | Contenu |
| --- | --- |
| `src/pages/connexion/` | Connexion par code à usage unique reçu sur WhatsApp ou par SMS : pas de mot de passe à retenir. |
| `src/pages/contrats/` | Contrats, garanties, échéances. |
| `src/pages/attestations/` | Attestations et reçus à télécharger, rappel de la vérification par QR code. |
| `src/pages/paiement/` | Paiement ou renouvellement par Wave, Orange Money, MTN MoMo ou Moov Money. |
| `src/pages/sinistres/` | Déclaration guidée avec photos, liste des pièces à fournir, suivi. |
| `src/pages/flotte/` | Pour les entreprises : véhicules, échéances d'assurance et administratives, ajout ou retrait d'un véhicule, plusieurs gestionnaires. |

## Sécurité propre à l'espace client

- Code de connexion à 6 chiffres, valable 5 minutes, 5 essais au plus, puis blocage temporaire.
- Un client ne voit que ses propres dossiers ; un gestionnaire de flotte, ceux de son entreprise.
- Aucun paiement par carte saisi sur nos pages : le paiement se fait sur la page du prestataire, et seule sa confirmation signée fait foi.
- Les photos déposées sont contrôlées (type, taille) et débarrassées de leurs métadonnées (position GPS) avant stockage, sauf quand la position du sinistre est demandée et acceptée.
