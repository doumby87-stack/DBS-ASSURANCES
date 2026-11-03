# Contribuer

## Organisation

1. Une **tâche** de la [feuille de route](docs/feuille-de-route.md) = une **branche** créée depuis `main` = une **pull request**.
2. Pas d'envoi direct sur `main` : tout passe par une pull request relue, avec les vérifications au vert.
3. Petites pull requests, faciles à relire. Une pull request qui fait deux choses sans rapport se découpe.

## Messages de commit

En français, au présent, sous la forme `type(portée): description` :

- `feat(base): ajouter les commissions`
- `fix(site): corriger le lien WhatsApp du pied de page`
- `docs(securite): préciser la rotation des clés`

Types : `feat` (fonctionnalité), `fix` (correction), `docs`, `refactor`, `test`, `chore` (outillage). Le corps du message explique **pourquoi**.

## Avant d'ouvrir une pull request

```bash
npm run verifier                 # site, documentation, types et tests unitaires de l'API
./database/tests/executer.sh     # si la base est touchée
npm run test -w @dbs/api         # si l'API est touchée (PostgreSQL de test requis)
```

Puis remplir le modèle de pull request, en particulier la partie sécurité.

## Règles non négociables

- **Aucun secret** dans le dépôt (mots de passe, clés d'API, jetons), même temporairement : l'historique Git les garde. Voir [gestion des secrets](docs/securite/gestion-des-secrets.md).
- **Aucune donnée réelle de client**, même pour un test. Données fictives uniquement.
- **Aucune migration modifiée** une fois fusionnée : on en écrit une nouvelle.
- **Aucun test désactivé** pour faire passer une pull request.
- **Aucune ressource tierce** (police, script, image hébergés ailleurs) dans les pages : tout est livré avec l'application.
- Toute modification qui touche à l'authentification, aux droits, à l'argent ou aux données personnelles est relue par une deuxième personne et décrit son impact dans la pull request.

## Décisions d'architecture

Une décision qui change la structure du projet (nouvelle brique, nouveau service extérieur, changement de pile) s'écrit d'abord dans une [ADR](docs/architecture/adr/README.md).
