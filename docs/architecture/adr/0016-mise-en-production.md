# 0016 — Mise en production : un serveur, des conteneurs durcis, des sauvegardes chiffrées vérifiées

- Statut : Acceptée (hébergeur à choisir après l'avis de l'ARTCI, [ADR 0006](0006-hebergement-et-localisation-des-donnees.md))
- Date : 2026-11-22

## Contexte

La tâche 11 met en service ce qui a été construit : back-office, API, espace client, base. Elle demande un hébergement, des sauvegardes testées, une surveillance, un test d'intrusion par un prestataire indépendant et la formation du personnel.

Contraintes :

- **petite agence** : pas d'équipe d'exploitation, un prestataire technique à temps partiel, un budget modeste ;
- **hébergeur pas encore choisi** : il dépend de la réponse de l'ARTCI sur la localisation des données (ADR 0006). La solution doit tourner chez un hébergeur ivoirien comme chez un hébergeur européen, avec ou sans base PostgreSQL gérée ;
- **données sensibles** (pièces d'identité, encaissements, sinistres) : la base ne doit jamais être joignable depuis Internet, et une sauvegarde volée ne doit rien révéler ;
- **le journal d'audit** prouve qui a fait quoi : il faut détecter chaque jour qu'on y a touché, y compris la suppression de ses dernières lignes, que la chaîne d'empreintes seule ne montre pas ;
- **une sauvegarde jamais restaurée n'est pas une sauvegarde** : le test doit être simple au point d'être fait chaque mois.

## Décision

1. **Un serveur avec Docker Compose** ([`infra/production`](../../../infra/production)), plutôt qu'une plateforme propriétaire : la même pile se déploie chez n'importe quel hébergeur, et se teste à l'identique sur un poste (`essai.sh`, lancé par l'intégration continue à chaque modification).
   - **Caddy** sert le back-office et l'espace client sur deux adresses, obtient et renouvelle seul les certificats HTTPS, envoie les en-têtes de sécurité (politique de contenu stricte, HSTS…) et transmet `/api` à l'API. Le journal d'accès ne garde pas les paramètres des adresses (une recherche peut contenir un nom).
   - **Conteneurs durcis** : système de fichiers en lecture seule, aucun privilège du noyau sauf ceux strictement nécessaires, pas d'élévation de privilège, API sous un compte non administrateur.
   - **Réseaux séparés** : la base et l'antivirus n'ont aucun port ouvert ; la base n'a pas accès à Internet ; seul le serveur web écoute sur les ports 80 et 443.
   - **Base locale ou gérée** : un profil `base-locale` lance PostgreSQL 16 dans un conteneur ; avec une base gérée par l'hébergeur, on l'omet et on donne son adresse.
2. **Un compte de base dédié aux sauvegardes**, `dbs_sauvegarde` : il lit toute la base (il passe outre la sécurité ligne par ligne, sans être superutilisateur), en lecture seule par défaut, et n'écrit que le compte rendu de son travail, par deux fonctions du schéma `exploitation`, en ajout seul.
3. **Sauvegarde chaque nuit, chiffrée avant d'être écrite** ([`infra/sauvegardes`](../../../infra/sauvegardes)) : `pg_dump` est chiffré au fil de l'eau avec la **clé publique** [age](https://age-encryption.org) (outil libre). La clé privée n'est jamais sur le serveur : un attaquant qui prend le serveur ne peut pas relire les sauvegardes. Le fichier part ensuite **hors site**, par rclone, sur un stockage **en écriture unique** (verrouillage des objets) qu'un attaquant ne peut ni effacer ni remplacer.
4. **Vérification du journal d'audit à chaque sauvegarde** : toute la chaîne d'empreintes est recalculée, et la dernière empreinte vue la nuit précédente doit toujours s'y trouver (sinon ses dernières lignes ont été supprimées). La dernière empreinte part hors site avec la sauvegarde, dans un fichier à part.
5. **Test de restauration mensuel en une commande** (`restaurer-et-verifier.sh`), sur un serveur de test : contrôle de l'empreinte du fichier, déchiffrement, restauration, vérification de la chaîne d'audit et de la présence de l'empreinte notée au moment de la sauvegarde, totaux à comparer avec la production, compte rendu inscrit dans la production.
6. **Une page « Exploitation » dans le back-office**, pour le gérant et l'auditeur : état des services (l'antivirus est réellement interrogé), sauvegardes, tests de restauration, événements de sécurité de la semaine, et des **alertes en clair** classées par gravité : sauvegarde absente depuis plus de 26 heures ou en échec, copie hors site manquante, anomalie du journal d'audit, test de restauration de plus de 35 jours, comptes bloqués, rafale de connexions refusées. Une **surveillance externe** de `/api/sante` (service gratuit) complète la page : elle prévient quand tout est arrêté, ce que la page ne peut pas faire.
7. **Test d'intrusion par un prestataire indépendant** avant l'ouverture au public, sur un périmètre écrit ([test d'intrusion](../../securite/test-d-intrusion.md)), puis chaque année et après chaque changement majeur.
8. **Formation du personnel** avant d'ouvrir les comptes, puis chaque année, avec un support prêt à l'emploi et un questionnaire ([formation](../../securite/formation-du-personnel.md)) ; chaque séance est notée dans le registre des formations du back-office.

## Conséquences

- **Perte de données maximale : 24 heures** avec la seule sauvegarde de la nuit. L'objectif de 15 minutes ([sauvegardes et reprise](../../securite/sauvegardes-et-reprise.md)) demande en plus l'archivage continu des journaux de transactions : fourni par une base gérée (restauration à un instant donné), ou à ajouter avec pgBackRest sur une base locale. En attendant, les reçus manuels pré-numérotés couvrent la journée perdue.
- Les **pièces et photos** (cartes grises, justificatifs d'identité, photos de sinistres, attestations) sont dans la base, chiffrées : elles sont dans la même sauvegarde, sans stockage de fichiers à part.
- Une **base gérée peut refuser** l'attribut `BYPASSRLS` au compte de sauvegarde. Il faut alors soit utiliser le compte d'administration fourni par l'hébergeur pour `pg_dump` (en gardant `dbs_sauvegarde` pour le compte rendu), soit s'en remettre aux sauvegardes de l'hébergeur, en gardant le test de restauration mensuel et une copie chiffrée hors site.
- La perte de la **clé privée age** rend toutes les sauvegardes illisibles : elle est rangée hors ligne, en deux exemplaires, chez deux personnes ([gestion des secrets](../../securite/gestion-des-secrets.md)).
- Un **superutilisateur** de la base pourrait aussi effacer le compte rendu des sauvegardes : la référence qui fait foi reste le fichier d'empreinte copié hors site, en écriture unique.
- Les mises à jour de sécurité du serveur et des images restent à faire chaque semaine par le prestataire : reconstruire et relancer (`docker compose … up -d --build`) suffit.

## Options écartées

- **Plateforme d'hébergement d'applications propriétaire** : plus simple au début, mais liée à un fournisseur et à des pays précis, ce qui ferme des portes avant la réponse de l'ARTCI.
- **Kubernetes** : sans commune mesure avec la taille de l'agence ; plus de pièces à tenir à jour, donc plus de risques.
- **Sauvegardes chiffrées avec une clé symétrique sur le serveur** : un attaquant qui prend le serveur prendrait aussi la clé. Le chiffrement à clé publique évite ce piège.
- **Outil de surveillance complet (Prometheus, Grafana)** : trop lourd pour l'agence ; la page Exploitation et une surveillance externe gratuite couvrent les signaux utiles. À revoir si l'activité grandit.
