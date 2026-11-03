# 0002 — TypeScript de bout en bout, PostgreSQL

- Statut : Proposée (à confirmer au démarrage de la tâche 3)
- Date : 2026-11-03

## Contexte

L'équipe est réduite et l'application doit durer. Il faut une pile répandue (facile de trouver un développeur à Abidjan), bien outillée en sécurité, et qui fonctionne sur des connexions mobiles lentes.

## Décision

- **Base de données : PostgreSQL 16+.** Sécurité ligne par ligne, contraintes, déclencheurs et vues capables de porter les règles critiques ([ADR 0004](0004-securite-dans-la-base.md)). Disponible chez tous les hébergeurs.
- **API : Node.js 22 LTS, TypeScript, Fastify.** Validation des entrées par schéma intégrée, bonnes performances, écosystème large.
- **Back-office et espace client : React, TypeScript, Vite,** en applications installables (PWA), légères et utilisables sur téléphone.
- **Règles partagées** dans `packages/domaine`, utilisées par l'API et par les deux interfaces.
- Dépendances limitées au nécessaire, versions verrouillées (fichier de verrouillage), mises à jour surveillées par Dependabot.

## Conséquences

- Un seul langage à maîtriser du navigateur au serveur.
- Les règles les plus sensibles restent dans la base, indépendantes du langage de l'API.

## Options écartées

- **Django ou Laravel** : excellents, avec un back-office prêt à l'emploi, mais deux langages à maintenir (serveur et interface).
- **Supabase ou Firebase** (base exposée directement au navigateur) : voir [ADR 0003](0003-api-seule-porte-d-acces.md).
- **Logiciel de gestion de cabinet du marché** : aucun ne gère le Code CIMA, le Mobile Money et l'attestation ASACI ([benchmark](../../benchmark/pratiques-des-leaders.md)).
