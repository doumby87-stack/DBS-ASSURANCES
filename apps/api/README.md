# API — la seule porte d'accès aux données

**Statut : à construire** (tâche 3 de la [feuille de route](../../docs/feuille-de-route.md)). Les dossiers sont en place, le code viendra tâche par tâche.

L'API reçoit toutes les demandes du back-office et de l'espace client, vérifie qui les fait, puis interroge la base. Aucun navigateur ne parle directement à la base de données ([ADR 0003](../../docs/architecture/adr/0003-api-seule-porte-d-acces.md)).

Pile prévue : Node.js 22 LTS, TypeScript, Fastify, PostgreSQL ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)).

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/config/` | Lecture **et validation** des variables d'environnement au démarrage : l'API refuse de démarrer si un secret manque. |
| `src/securite/` | Connexion (mot de passe + deuxième facteur), sessions, limitation des tentatives, protection CSRF, en-têtes HTTP. |
| `src/base-de-donnees/` | Connexions à PostgreSQL et fonction unique d'ouverture de transaction qui déclare l'utilisateur (`app.utilisateur_id`). |
| `src/modules/` | Un dossier par domaine métier : routes, validation des entrées, requêtes. |
| `src/integrations/` | Services extérieurs : paiement Mobile Money, WhatsApp, SMS, factures FNE, stockage des fichiers. |
| `src/commun/` | Erreurs, validation partagée, journal technique (sans données personnelles). |
| `tests/unitaires/` | Règles isolées. |
| `tests/integration/` | Routes testées contre une vraie base PostgreSQL de test. |
| `tests/securite/` | Accès refusés, injection, dépassement de droits, rejeu de webhooks. |

## Modules métier

| Module | Contenu |
| --- | --- |
| `utilisateurs` | Comptes du personnel, rôles, activation et désactivation. |
| `clients` | Fiches clients et prospects, détection des doublons, pièces d'identité (chiffrées). |
| `vehicules` | Véhicules, import des listes de flotte (Excel), échéances administratives. |
| `contrats` | Polices, avenants, échéances, attestations. |
| `devis` | Demandes venues du site, cotations, relances, motifs de perte. |
| `encaissements` | Caisse, reçus, paiements Mobile Money confirmés par webhook. |
| `reversements` | Bordereaux pour SanlamAllianz, validation à deux personnes. |
| `sinistres` | Déclarations, pièces, suivi avec la compagnie. |
| `documents` | Dépôt et lecture des fichiers (contrôle du type, taille, analyse antivirus). |
| `relances` | Messages automatiques : échéances, devis, sinistres. |
| `conformite` | Identification des clients (lutte contre le blanchiment), registre des réclamations, demandes d'accès aux données. |
| `statistiques` | Tableaux de bord du gérant. |

## Règles de sécurité à respecter dans ce dossier

Détail et justification : [`docs/securite/exigences-securite.md`](../../docs/securite/exigences-securite.md).

1. Chaque route déclare le ou les rôles autorisés. Par défaut, une route est refusée.
2. Toute entrée est validée par un schéma (types, longueurs, formats) avant d'être utilisée.
3. Requêtes SQL **toujours paramétrées**. Jamais de concaténation de texte venant d'un utilisateur.
4. Une requête = une transaction qui commence par déclarer l'utilisateur. Aucune requête métier hors de cette fonction.
5. Sessions dans des cookies `HttpOnly`, `Secure`, `SameSite=Strict`, durée limitée, renouvelées à la connexion.
6. Les webhooks (paiement, WhatsApp) sont acceptés seulement si leur signature est valide, et une seule fois (idempotence).
7. Les journaux techniques ne contiennent ni mot de passe, ni jeton, ni numéro de pièce d'identité, ni contenu de message client.
8. Les messages d'erreur renvoyés au navigateur ne révèlent rien de l'intérieur (pas de trace, pas de requête SQL).
