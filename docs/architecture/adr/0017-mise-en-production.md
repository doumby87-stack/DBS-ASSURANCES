# 0017 — Mise en production : un serveur, Docker Compose, sauvegardes chiffrées hors site

- Statut : Acceptée (hébergeur à choisir, [ADR 0006](0006-hebergement-et-localisation-des-donnees.md))
- Date : 2026-11-15

## Contexte

Le back-office, l'espace client et l'API doivent passer en production (tâche 11). L'agence compte quelques personnes et quelques centaines de clients : l'outil doit être simple à exploiter par un prestataire technique, sans équipe dédiée.

Contraintes :

- **Hébergeur pas encore choisi** : en Côte d'Ivoire, en Europe, ou mixte ([ADR 0006](0006-hebergement-et-localisation-des-donnees.md)). Le déploiement doit fonctionner chez chacun.
- **Exigences déjà écrites** ([infrastructure](../../../infra/README.md)) :
  - base non exposée sur Internet, chiffrement en transit et au repos ;
  - sauvegardes chiffrées, hors site et immuables ;
  - restauration testée chaque mois ;
  - surveillance avec alertes, secrets hors du dépôt.
- **Objectifs de reprise** ([sauvegardes et reprise](../../securite/sauvegardes-et-reprise.md)) : 15 minutes de données perdues au plus, 4 heures pour revenir en service.

## Décision

1. **Un serveur Linux, Docker Compose** (`infra/production/compose.yml`). Les images sont construites depuis le dépôt (`infra/production/Dockerfile`) :
   - **API** : Node.js, dépendances de production seules, utilisateur sans droit, système de fichiers en lecture seule ;
   - **serveur web** : Caddy, qui sert le back-office et l'espace client.
2. **Caddy en façade** (`infra/production/Caddyfile`), seul conteneur à publier des ports (80 et 443) :
   - certificats Let's Encrypt automatiques et HSTS ;
   - en-têtes de sécurité des [en-têtes HTTP](../../securite/en-tetes-http.md), sans nom de logiciel annoncé ;
   - API derrière `/api` sur chacun des deux domaines : même origine, ni CORS ni cookie partagé ;
   - corps de requête limité à 32 Mo (demandes du site avec leurs pièces jointes).
3. **Base PostgreSQL 16 gérée par l'hébergeur, de préférence** : TLS vérifié, restauration à la minute près (seule façon de tenir les 15 minutes), correctifs appliqués par l'hébergeur.
   - **À défaut**, un conteneur sur le même serveur (`compose.base-locale.yml`), sur un réseau interne sans accès à Internet, initialisé par les scripts du dépôt.
   - La perte de données maximale est alors l'intervalle entre deux sauvegardes : plusieurs sauvegardes par jour (`SAUVEGARDE_HORAIRES`), accepté par écrit par le gérant.
4. **Migrations au démarrage**, par le compte propriétaire (`database/migrer.sh`) : l'API ne démarre qu'une fois le schéma à jour, et une migration modifiée après coup arrête tout.
5. **Antivirus ClamAV** dans son propre conteneur, signatures mises à jour par `freshclam`.
6. **Sauvegardes** (`infra/sauvegardes`), dans un conteneur dédié :
   - export `pg_dump` chaque nuit (ou plus souvent), chiffré avec `age` pour la clé publique de l'agence, avec son empreinte SHA-256 ;
   - 30 jours de sauvegardes quotidiennes, 12 mensuelles ;
   - copie hors site par `rclone` chez un **second fournisseur**, sur un stockage en écriture unique : le serveur ne peut ni modifier ni effacer ce qu'il y a déposé ;
   - la dernière empreinte du journal d'audit est notée hors de la base à chaque sauvegarde.
7. **Test de restauration automatique chaque mois** : la dernière sauvegarde est restaurée dans une base isolée, puis vérifiée.
   - **Contrôles** : empreinte du fichier, `audit.verifier_chaine()`, empreinte notée retrouvée, totaux.
   - **Trace** : le résultat est noté au registre des restaurations.
   - **Garde-fou** : une base existante n'est jamais écrasée sans `--remplacer`.
8. **Surveillance** (`infra/surveillance/controler.sh`), tous les quarts d'heure et chaque matin :
   - API joignable, échecs de connexion répétés ;
   - certificats, sauvegarde de la nuit, intégrité du journal d'audit, exports de la veille, primes non reversées.
   - **Alertes** : envoyées par une commande au choix de l'agence (`ALERTE_COMMANDE`), une seule fois tant qu'elles ne changent pas.
   - **Panne du serveur** : un service extérieur vérifie aussi que le site répond, car un serveur arrêté ne peut pas prévenir lui-même.
9. **Secrets** dans `.env` et `secrets/` sur le serveur seulement (droits 600, ignorés par Git), venant du gestionnaire de secrets de l'hébergeur s'il en a un.
   - **Clé privée des sauvegardes** : une copie dans le coffre-fort d'équipe et une copie scellée hors ligne. Sans elle, aucune sauvegarde ne se relit.
10. **Fichiers déposés dans la base** (pièces jointes, justificatifs, constats, attestations) : chiffrés par l'API, ils restent dans PostgreSQL, comme prévu par l'[ADR 0009](0009-demandes-de-devis-du-site.md). Ils sont sauvegardés, restaurés et protégés avec elle ; un stockage de fichiers séparé ne se justifiera qu'au-delà de quelques gigaoctets.
11. **Essais automatiques** : l'intégration continue construit les images et démarre toute la pile sur des domaines `.localhost` (`infra/tests/production.sh`).
    - **Pile** : HTTPS, en-têtes, API, premier gérant, isolement du réseau, droits des conteneurs, sauvegarde et restauration.
    - **Sauvegardes** : elles sont aussi testées contre la base de test remplie (`infra/tests/sauvegarde-restauration.sh`), y compris un fichier altéré et un journal d'audit tronqué.

## Conséquences

- **Reproductible** : ce qui tourne en production est construit et testé à chaque modification, avec les mêmes fichiers.
- **Changer d'hébergeur** revient à recopier `.env`, `secrets/` et une sauvegarde sur un autre serveur ([mise en service](../../../infra/production/mise-en-service.md), « Reprise après incident »).
- **Un seul serveur, un seul point de panne** : la reprise passe par la restauration sur un serveur neuf, à exercer une fois par an pour tenir les 4 heures. Un second serveur en attente n'est pas justifié à cette taille.
- **Pas de pare-feu applicatif dans Caddy** :
  - **Ce qui protège déjà** : l'API limite les tentatives de connexion et les envois du site, et la base les limites par adresse.
  - **Ajout possible** : le pare-feu de l'hébergeur ou de Cloudflare devant Caddy. Il faut alors `PROXYS_DE_CONFIANCE=2` et les adresses de ce service dans `trusted_proxies` de Caddy, pour garder l'adresse réelle des visiteurs.
- **Journaux techniques** : gardés par Docker par rotation (1 Go par service au plus), soit plusieurs mois à ce volume. Ils ne contiennent ni mot de passe ni cookie (masqués par Caddy).
- **Mises à jour** : le prestataire applique chaque semaine les correctifs du système et des images (`docker compose pull` et `up -d --build`), et sous 48 heures pour une faille critique.

## Options écartées

- **Kubernetes ou plusieurs serveurs** : bien plus de pièces à sécuriser et à surveiller, pour un trafic qui tient sur un petit serveur.
- **Hébergement « plateforme » sans serveur** (fonctions, bases propriétaires) : localisation des données difficile à garantir pour l'ARTCI, et dépendance forte à un fournisseur.
- **Sauvegardes de l'hébergeur seules** : une seule copie, chez le même fournisseur, effaçable par qui contrôle le compte. Elles restent un complément utile.
- **`crond` dans le conteneur des sauvegardes** : ses tâches ne voient pas les variables du conteneur ; une boucle simple (`planifier.sh`) fait le même travail sans cet écueil.
