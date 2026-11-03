# 0001 — Un dépôt unique, seul le site vitrine est publié

- Statut : Acceptée
- Date : 2026-11-03

## Contexte

Le dépôt ne contenait que le site vitrine, posé à la racine. Le projet s'étend à une API, un back-office, un espace client et une base de données, qui partagent des règles métier (formats, délais CIMA) et une charte graphique. Le site étant publié tel quel, tout fichier ajouté à la racine aurait été mis en ligne.

## Décision

- Un seul dépôt, organisé en `apps/` (applications), `packages/` (code partagé), `database/`, `infra/`, `docs/`.
- Le site vitrine vit dans `apps/site-vitrine`, et c'est le **seul** dossier publié sur l'hébergement statique (`netlify.toml`).
- Une modification qui touche plusieurs briques (par exemple une règle métier et l'écran qui l'utilise) passe dans une seule pull request.

## Conséquences

- La documentation de sécurité, le schéma de la base et les scripts ne peuvent plus être publiés par accident.
- Les règles métier sont écrites une fois et testées une fois.
- La mise en ligne par glisser-déposer doit viser `apps/site-vitrine`, et non tout le dépôt (rappelé dans le LISEZMOI du site).

## Options écartées

- **Un dépôt par application** : règles dupliquées, modifications coordonnées difficiles pour une petite équipe.
- **Laisser le site à la racine** : risque de publication involontaire, inacceptable pour la documentation de sécurité.
