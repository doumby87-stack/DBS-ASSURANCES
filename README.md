# DBS-ASSURANCES

Site et outils de gestion de **DBS-ASSURANCES**, Agent Général SanlamAllianz Côte d'Ivoire (code agence 2623), Yopougon, Abidjan.

L'objectif dépasse la vitrine : donner à l'agence un outil qui tient ses promesses aux clients (échéances surveillées, attestations en lot, sinistres suivis) et qui sécurise la caisse et les reversements à la compagnie.

## Où en est le projet

| Brique | Dossier | Statut |
| --- | --- | --- |
| Site vitrine | [`apps/site-vitrine`](apps/site-vitrine) | ✅ En place : neuf pages construites par Astro, testées dans le navigateur (accessibilité, sécurité) |
| Base de données | [`database`](database) | ✅ Schéma sécurisé et testé (règles CIMA, contrôle d'accès, journal d'audit) |
| API | [`apps/api`](apps/api) | 🟡 Connexion du personnel, comptes, clients, contrats, véhicules, devis, échanges, échéances, caisse, reversements, commissions, relances automatiques (WhatsApp, SMS) |
| Back-office de l'agence | [`apps/admin`](apps/admin) | 🟡 Connexion, échéances, clients, fiche client, caisse et reçus, reversements, commissions, relances et consentements, personnel |
| Espace client | [`apps/espace-client`](apps/espace-client) | ⏳ |

Le détail, tâche par tâche : [feuille de route](docs/feuille-de-route.md).

## Pour commencer

- **Modifier le site vitrine** (téléphone, textes) : [LISEZMOI du site](apps/site-vitrine/LISEZMOI.md).
- **Comprendre l'architecture** : [vue d'ensemble](docs/architecture/vue-d-ensemble.md).
- **Toute la documentation** : [docs/](docs/README.md).

## Vérifier avant de proposer une modification

```bash
npm ci                                # dépendances (une fois)
npm run verifier                      # site, documentation, types et tests unitaires de l'API
./database/tests/executer.sh          # base de données (PostgreSQL de test requis)
npm run test -w @dbs/api              # tests de sécurité de l'API (PostgreSQL de test requis)
npm run test:e2e -w @dbs/admin        # parcours complet dans le navigateur (PostgreSQL de test requis)
npm run test:navigateur -w @dbs/site-vitrine   # pages du site, accessibilité et formulaire de devis
```

Les mêmes vérifications tournent automatiquement sur chaque pull request.

## Contribuer

Lire [CONTRIBUTING.md](CONTRIBUTING.md). En résumé : une branche par tâche, une pull request relue, aucune donnée réelle de client et aucun secret dans le dépôt.

## Sécurité

Pour signaler une faille : [SECURITY.md](SECURITY.md). Ne pas ouvrir de ticket public.
