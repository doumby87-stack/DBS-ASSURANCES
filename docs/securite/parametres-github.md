# Paramètres GitHub à activer

À faire une fois par le propriétaire du dépôt (tâche 2). Ces réglages ne peuvent pas être appliqués par un fichier du dépôt.

## Compte

- [ ] **Deuxième facteur** activé sur le compte GitHub de chaque contributeur (Settings → Password and authentication). Clé de sécurité ou application d'authentification, pas de SMS.

## Dépôt (Settings)

- [ ] **Visibilité privée** si le dépôt contient un jour des informations internes (procédures, contacts).
- [ ] **Branches → règle sur `main`** :
  - pull request obligatoire avant fusion, avec au moins une relecture ;
  - vérifications obligatoires : « Site vitrine », « Base de données », « Recherche de secrets », « Liens de la documentation » ;
  - branche à jour avant fusion ;
  - pas d'envoi forcé (`force push`), pas de suppression ;
  - règles appliquées aussi aux administrateurs.
- [ ] **Code security** :
  - Dependabot alerts et security updates : activés ;
  - Secret scanning et **push protection** : activés (bloque l'envoi d'un commit qui contient une clé reconnue) ;
  - Private vulnerability reporting : activé (les signalements de failles arrivent en privé, voir `SECURITY.md`).
- [ ] **Actions → General** : autoriser uniquement les actions de GitHub et des créateurs vérifiés ; droits par défaut du jeton en **lecture seule**.

## Netlify (ou autre hébergeur du site)

- [ ] Déploiement depuis le dépôt GitHub, branche `main` uniquement.
- [ ] Deuxième facteur sur le compte de l'hébergeur.
- [ ] Aperçus de pull requests protégés par mot de passe s'ils contiennent un jour autre chose que le site public.
