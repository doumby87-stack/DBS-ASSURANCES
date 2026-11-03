## Tâche

Tâche n° … de la feuille de route (`docs/feuille-de-route.md`).

## Ce qui change

-

## Pourquoi

## Sécurité et données

- [ ] Aucun secret ni donnée réelle de client ajouté
- [ ] Touche à l'authentification, aux droits, à l'argent ou aux données personnelles : non / oui, impact décrit ci-dessous
- [ ] Nouvelle table : sécurité ligne par ligne, droits par colonne et journal d'audit en place, tests ajoutés

## Vérifications

- [ ] `node scripts/verifier-site.mjs`
- [ ] `node scripts/verifier-liens-docs.mjs`
- [ ] `./database/tests/executer.sh` (si la base est touchée)
- [ ] Testé dans un navigateur (si une page est touchée)
