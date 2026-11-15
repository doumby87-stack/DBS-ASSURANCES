# Mise en service de la production

Procédure pour le prestataire technique, de la commande du serveur au premier gérant connecté. Décision : [ADR 0017](../../docs/architecture/adr/0017-mise-en-production.md). Ne rien commencer avant les démarches de l'agence ([feuille de route](../../docs/feuille-de-route.md), tâche 2) : hébergeur choisi, déclaration à l'ARTCI faite, nom de domaine réservé.

## 1. Ce qu'il faut avoir

| Quoi | Exemple | Qui le fournit |
| --- | --- | --- |
| Serveur Linux | Debian 12 ou Ubuntu 24.04, 2 processeurs, 4 Go de mémoire (ClamAV en prend 1,5), 40 Go de disque chiffré | Hébergeur choisi |
| Base PostgreSQL 16 gérée, avec restauration à la minute près | Offre « base de données gérée » de l'hébergeur | Hébergeur choisi (sinon : base sur le serveur, section 4 B) |
| Deux noms de domaine | `gestion.<domaine>` (back-office), `espace.<domaine>` (espace client) | Agence |
| Stockage hors site en écriture unique | Stockage objet compatible S3 avec verrouillage des objets (30 jours au moins), chez un **second** fournisseur | Agence |
| Adresse qui reçoit les alertes | Adresse e-mail du gérant et du prestataire, ou relais vers WhatsApp | Agence |
| Surveillance extérieure | Service qui vérifie toutes les 5 minutes que `https://gestion.<domaine>/api/sante` répond, et prévient sinon | Hébergeur ou service gratuit |

## 2. Préparer le serveur

1. **Accès** : connexion SSH par clé uniquement, deuxième facteur, mot de passe désactivé ; liste nominative des personnes autorisées.
2. **Pare-feu** : seuls les ports 80 et 443 ouverts à tous ; SSH (22) depuis les adresses du prestataire.
3. **Mises à jour automatiques** de sécurité du système (`unattended-upgrades`).
4. **Docker Engine** et son extension Compose, depuis le dépôt officiel de Docker. Garder la gestion du pare-feu par Docker active (réglage par défaut) : c'est elle qui transmet à Caddy l'adresse réelle des visiteurs.
5. **Noms de domaine** : enregistrements `A` (et `AAAA`) de `gestion.<domaine>` et `espace.<domaine>` vers l'adresse du serveur.
6. **Code** : `git clone` du dépôt dans `/opt/dbs`, sur l'étiquette de la version à installer (`git checkout v…`).

## 3. Clés et secrets

Tout se passe dans `/opt/dbs/infra/production`, jamais dans le dépôt Git ([gestion des secrets](../../docs/securite/gestion-des-secrets.md)).

```bash
cd /opt/dbs/infra/production
cp .env.exemple .env && chmod 600 .env
install -d -m 700 secrets
# Renseigner d'abord DOMAINE_GESTION, DOMAINE_PORTAIL et ADRESSE_ACME dans .env : docker compose en a besoin

# Clé des sauvegardes, avec l'outil age de l'image des sauvegardes : la clé publique va dans .env
# (SAUVEGARDE_CLE_PUBLIQUE), la clé privée reste dans secrets/
docker compose build sauvegarde
docker run --rm --entrypoint age-keygen dbs-sauvegarde > secrets/age-identite.txt
chmod 600 secrets/age-identite.txt
grep -o 'age1[0-9a-z]*' secrets/age-identite.txt                       # → SAUVEGARDE_CLE_PUBLIQUE

# Clé de chiffrement des données de l'API (CLE_CHIFFREMENT_DONNEES)
openssl rand -base64 32
```

- **Clé privée des sauvegardes** : une copie dans le coffre-fort d'équipe, une copie imprimée sous pli scellé, hors de l'agence. Sans elle, aucune sauvegarde ne peut être relue.
- **Clé de chiffrement des données** : même précaution. Sa perte oblige à réinitialiser l'accès de tout le personnel et rend illisibles les pièces jointes.
- **Stockage hors site** : `secrets/rclone.conf` (droits 600) décrit l'accès, avec une clé qui peut **écrire** mais pas effacer, si le fournisseur le permet. Le nom choisi pour cet accès se reporte dans `SAUVEGARDE_DISTANT` (par exemple `hors-site:dbs-sauvegardes`).

```ini
[hors-site]
type = s3
provider = Other
endpoint = https://…
access_key_id = …
secret_access_key = …
```

Remplir ensuite `.env` : domaines, adresse pour Let's Encrypt (`ADRESSE_ACME`), clés, commande d'alerte. Les variables sont décrites dans `.env.exemple` et dans le [README de l'API](../../apps/api/README.md).

## 4. Base de données

### A. Base gérée par l'hébergeur (recommandé)

```bash
# Depuis le serveur, avec le compte administrateur fourni par l'hébergeur : comptes et base
psql "postgres://admin:…@hote:5432/postgres?sslmode=verify-full" -v base=dbs -f /opt/dbs/database/initialisation/01_roles_et_base.sql
psql "postgres://admin:…@hote:5432/postgres?sslmode=verify-full" -c '\password dbs_proprietaire' -c '\password dbs_application'
```

Puis, dans `.env`, les trois adresses `DATABASE_URL` (compte `dbs_application`), `DATABASE_URL_PROPRIETAIRE` (`dbs_proprietaire`) et `DATABASE_URL_SAUVEGARDE` (administrateur), toutes terminées par `?sslmode=verify-full`. Si l'hébergeur signe ses certificats avec sa propre autorité : `compose.base-geree.yml`, qui explique quoi ajouter.

Vérifier chez l'hébergeur que la restauration à la minute près est active, et sur quelle durée.

### B. Base sur le serveur

Remplir `POSTGRES_PASSWORD`, `MDP_PROPRIETAIRE` et `MDP_APPLICATION` (lettres et chiffres : `openssl rand -hex 24`), et laisser vides les trois adresses de la section A. Ajouter `-f compose.yml -f compose.base-locale.yml` à chaque commande `docker compose` ci-dessous. Les comptes et la base sont créés au premier démarrage.

Avec cette option, une sauvegarde toutes les quelques heures (`SAUVEGARDE_HORAIRES=01:30 08:00 12:30 17:30`), et l'accord écrit du gérant sur la perte possible des saisies depuis la dernière ([ADR 0017](../../docs/architecture/adr/0017-mise-en-production.md)).

## 5. Démarrer

```bash
cd /opt/dbs/infra/production
docker compose up -d --build
docker compose ps                      # web, api, antivirus, sauvegarde « running » ; migrations « exited (0) »
docker compose logs migrations api     # « Base à jour. », puis « Server listening »
```

ClamAV télécharge ses signatures au premier démarrage (plusieurs minutes) : d'ici là, les pièces reçues attendent leur analyse.

## 6. Premier gérant

```bash
# Compte du premier gérant, avec le compte propriétaire : base sur le serveur…
docker compose exec base psql -U dbs_proprietaire -d dbs -v email=prenom.nom@<domaine> -v nom='Prénom NOM' \
  -f /depot/database/initialisation/02_premier_gerant.sql
# … ou base gérée
docker run --rm -v /opt/dbs/database:/depot/database:ro postgres:16-alpine psql "postgres://dbs_proprietaire:…@…/dbs?sslmode=verify-full" \
  -v email=prenom.nom@<domaine> -v nom='Prénom NOM' -f /depot/database/initialisation/02_premier_gerant.sql

# Son mot de passe provisoire
docker compose run --rm --no-deps -e DATABASE_URL_PROPRIETAIRE="postgres://dbs_proprietaire:…@…/dbs" \
  api node apps/api/dist/outils/premier-acces.js prenom.nom@<domaine>
```

Le mot de passe provisoire s'affiche une seule fois : le remettre en main propre. À sa première connexion sur `https://gestion.<domaine>`, le gérant configure son deuxième facteur et choisit son mot de passe ; il crée ensuite les comptes du personnel depuis l'application.

## 7. Vérifier avant d'ouvrir

1. `https://gestion.<domaine>/api/sante` répond `{"statut":"ok"}`.
2. [SSL Labs](https://www.ssllabs.com/ssltest/) : note A ; [Mozilla Observatory](https://developer.mozilla.org/fr/observatory) : note A ou mieux.
3. **Sauvegarde et restauration, à la main une première fois** :

   ```bash
   docker compose exec sauvegarde /outils/sauvegardes/sauvegarder.sh
   docker compose exec sauvegarde /outils/sauvegardes/tester-restauration.sh
   docker compose exec sauvegarde cat /sauvegardes/registre-restaurations.log
   ```

   Vérifier aussi que le fichier est arrivé sur le stockage hors site, et qu'il ne peut pas y être effacé.
4. **Alertes** : arrêter l'API (`docker compose stop api`), lancer `docker compose exec sauvegarde /outils/surveillance/controler.sh rapide`, vérifier que l'alerte arrive, puis `docker compose start api`. Vérifier aussi l'alerte de la surveillance extérieure.
5. **Test d'intrusion** par un prestataire indépendant, sur cette installation avant d'y mettre des données réelles ([cahier des charges](../../docs/securite/test-d-intrusion.md)).
6. **Formation** du personnel avant l'ouverture des comptes ([plan de formation](../../docs/securite/formation-du-personnel.md)).

## 8. Ouvrir les autres portes, une à une

| Quand | Quoi |
| --- | --- |
| Déclaration à l'ARTCI faite | `URL_SITE_VITRINE` dans `.env`, puis `URL_API=https://gestion.<domaine>/api` dans Netlify ([site vitrine](../../apps/site-vitrine/LISEZMOI.md)) |
| WhatsApp Business validé par Meta | Variables `WHATSAPP_*`, puis `URL_PORTAIL=https://espace.<domaine>` (codes de connexion de l'espace client) |
| Compte marchand ouvert | Variables du paiement en ligne ([ADR 0012](../../docs/architecture/adr/0012-espace-client-et-paiement-en-ligne.md)) |

Après chaque modification de `.env` : `docker compose up -d`.

## 9. Mettre à jour

1. Sauvegarde juste avant : `docker compose exec sauvegarde /outils/sauvegardes/sauvegarder.sh`.
2. `git fetch --tags && git checkout v…` (lire les notes de la version : nouvelles variables, démarches).
3. `docker compose pull && docker compose up -d --build` : les migrations nouvelles s'appliquent avant le démarrage de l'API.
4. Vérifier `/api/sante` et la connexion.

Une migration ne se défait pas. En cas de problème après une mise à jour, revenir à la version précédente du code **et** restaurer la sauvegarde de l'étape 1 (section 10), après accord du gérant : les saisies faites entre-temps seront à refaire.

## 10. Reprise après incident

Serveur perdu, base corrompue, rançongiciel ([réponse aux incidents](../../docs/securite/reponse-aux-incidents.md)) :

1. Nouveau serveur, préparé comme en sections 2 et 3, avec les copies de `.env`, de la clé privée des sauvegardes et de `rclone.conf` gardées au coffre-fort.
2. Base vide : section 4 (comptes et base seulement).
3. Récupérer la dernière sauvegarde saine depuis le stockage hors site :

   ```bash
   docker compose up -d --no-deps sauvegarde
   docker compose exec sauvegarde sh -c 'for d in quotidiennes empreintes; do rclone copy "$SAUVEGARDE_DISTANT/$d" "/sauvegardes/$d"; done'
   ```

4. Restaurer et vérifier, en remplaçant la base vide :

   ```bash
   docker compose exec sauvegarde /outils/sauvegardes/restaurer.sh /sauvegardes/quotidiennes/dbs-AAAAMMJJTHHMMSSZ.dump.age dbs --conserver --remplacer
   ```

5. `docker compose up -d --build`, vérifications de la section 7, puis saisie des reçus manuels faits pendant la panne ([sauvegardes et reprise](../../docs/securite/sauvegardes-et-reprise.md)).

Base gérée : la restauration à la minute près de l'hébergeur passe en premier ; la sauvegarde chiffrée hors site sert si le compte chez l'hébergeur est perdu ou compromis.

Une fois par an, exercer cette procédure sur un serveur jetable et noter le temps mis : il doit rester sous 4 heures.
