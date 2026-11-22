# Mise en production, pas à pas

Pour le prestataire technique, en présence du gérant aux étapes marquées 👤. Décision et raisons : [ADR 0016](../../docs/architecture/adr/0016-mise-en-production.md). Liste à cocher pour le jour J : [mise en service](../../docs/exploitation/mise-en-service.md).

Ce qui tourne sur le serveur (`compose.yml`) :

| Service | Rôle | Joignable depuis Internet |
| --- | --- | --- |
| `web` (Caddy) | HTTPS, en-têtes de sécurité, back-office et espace client, transmet `/api` à l'API | oui, ports 80 et 443 seulement |
| `api` | L'API (Node.js), sous un compte sans droits | non |
| `clamav` | Antivirus des pièces reçues | non |
| `base` (profil `base-locale`) | PostgreSQL 16, si l'hébergeur ne fournit pas de base gérée | non, et sans accès à Internet |
| `sauvegarde` | Sauvegarde chiffrée chaque nuit, copie hors site | non |
| `initialisation`, `migrations` (profil `outils`) | Lancés à la main : préparer la base, la mettre à jour | non |

Toute la pile est essayée à chaque modification par l'intégration continue (`essai.sh`, plus bas).

## 0. Avant de commencer 👤

- **Hébergeur choisi** après la réponse de l'ARTCI sur la localisation des données ([ADR 0006](../../docs/architecture/adr/0006-hebergement-et-localisation-des-donnees.md)), avec un contrat de sous-traitance (localisation, confidentialité, chiffrement du disque).
- **Deux adresses** sur le nom de domaine de l'agence : par exemple `gestion.dbs-assurances.ci` (back-office) et `client.dbs-assurances.ci` (espace client).
- **Un stockage hors site** chez un second fournisseur, compatible S3, avec verrouillage des objets (étape 4).
- Le gérant a un **gestionnaire de mots de passe** d'équipe et **deux clés USB** (ou une clé USB et une feuille dans un coffre) pour la clé des sauvegardes.

## 1. Le serveur

- **Taille** : 2 processeurs, **8 Go de mémoire** (l'antivirus en prend 1,5 à 3 Go, la lecture automatique jusqu'à 1 Go), 80 Go de disque SSD **chiffré**. 4 Go est un strict minimum sans la lecture automatique.
- **Système** : Ubuntu Server 24.04 LTS (ou Debian 12), mises à jour de sécurité automatiques :
  ```sh
  sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
  ```
- **Accès** : connexion SSH par clé seulement, jamais par mot de passe ni en `root` (`PasswordAuthentication no`, `PermitRootLogin no` dans `/etc/ssh/sshd_config`). Une clé par personne, liste revue chaque trimestre ([contrôle des accès](../../docs/securite/controle-des-acces.md)).
- **Pare-feu** : seuls 22 (SSH, si possible limité aux adresses du prestataire), 80 et 443 sont ouverts.
  ```sh
  sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
  ```
- **Docker** : Docker Engine et son extension Compose, depuis le dépôt officiel de Docker ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)).

## 2. Les adresses

Chez le gestionnaire du nom de domaine, faire pointer les deux adresses vers l'adresse IP du serveur (enregistrements `A`, et `AAAA` s'il a une adresse IPv6). Attendre qu'elles répondent (`ping gestion.dbs-assurances.ci`) avant le premier démarrage : Caddy en a besoin pour obtenir les certificats HTTPS.

## 3. Le code

```sh
sudo mkdir -p /opt/dbs && sudo chown "$USER" /opt/dbs
git clone <adresse du dépôt> /opt/dbs
cd /opt/dbs && git checkout <version>   # une version publiée, jamais une branche en cours
```

Le dépôt est privé : le serveur le lit avec une **clé de déploiement en lecture seule**, propre à ce serveur (GitHub, paramètres du dépôt, « Deploy keys »), jamais avec le compte d'une personne.

Toutes les commandes suivantes se lancent depuis `/opt/dbs`. Pour les raccourcir :

```sh
alias dbs='docker compose -f /opt/dbs/infra/production/compose.yml'
```

## 4. La clé et le stockage des sauvegardes 👤

**La clé**, sur le poste du gérant ou du prestataire, **jamais sur le serveur** :

```sh
age-keygen -o dbs-sauvegardes.cle
```

La commande affiche la **clé publique** (`age1…`) : elle va dans les réglages du serveur (étape 5). Le fichier `dbs-sauvegardes.cle` contient la **clé privée** : la copier sur deux clés USB rangées chez deux personnes différentes (ou l'imprimer et la mettre au coffre), puis l'effacer du poste. **Sans elle, aucune sauvegarde ne peut être relue** ; avec elle seule, rien n'est accessible sans le fichier de sauvegarde ([gestion des secrets](../../docs/securite/gestion-des-secrets.md)).

**Le stockage hors site** (OVHcloud, Scaleway, Backblaze… : choisir selon la réponse de l'ARTCI) :

1. Créer un seau (« bucket ») avec le **verrouillage des objets** activé (« object lock », mode conformité), conservation 30 jours.
2. Créer une clé d'accès limitée à ce seau, **qui peut écrire mais pas supprimer**.
3. Reporter ces accès dans `sauvegarde.env` (étape 5).

## 5. Les réglages

Trois fichiers, **jamais dans le dépôt** (`.gitignore` les refuse), lisibles par leur propriétaire seulement :

```sh
cd /opt/dbs/infra/production
cp serveur.env.exemple .env
cp api.env.exemple api.env
cp sauvegarde.env.exemple sauvegarde.env
chmod 600 .env api.env sauvegarde.env
```

Chaque fichier explique ses lignes. À retenir :

- **mots de passe de la base** : `openssl rand -hex 32`, un par compte (propriétaire, application, sauvegarde, et superutilisateur de la base locale) ;
- `DATABASE_URL` dans `api.env` reprend le mot de passe du compte **`dbs_application`** : `postgresql://dbs_application:<mot de passe>@base:5432/dbs` ;
- `CLE_CHIFFREMENT_DONNEES` : `openssl rand -base64 32`. **Copie scellée hors ligne** : la perdre oblige à réinitialiser l'accès de tout le personnel et rend illisibles les pièces enregistrées ;
- `URL_BACK_OFFICE=https://gestion.…` ; `URL_PORTAIL` reste vide tant que l'espace client n'est pas ouvert (il demande WhatsApp) ;
- `LECTURE_PRESTATAIRE=local` pour la lecture automatique, rien à installer de plus ([ADR 0015](../../docs/architecture/adr/0015-lecture-automatique.md)) ;
- tous les mots de passe et clés vont **aussi** dans le gestionnaire de mots de passe de l'agence.

## 6. La base

```sh
dbs --profile base-locale up -d --wait base            # base locale (omettre avec une base gérée)
dbs --profile outils run --rm initialisation           # rôles, base, mots de passe des trois comptes
dbs --profile outils run --rm migrations               # tables, fonctions, droits
```

Les deux outils peuvent être relancés sans risque : ils ne font que ce qui manque.

## 7. Démarrer

```sh
dbs --profile base-locale up -d --build --wait
dbs ps                                                 # tous « healthy » ou « running »
```

La première fois, l'antivirus télécharge ses signatures (quelques minutes) : en attendant, les pièces reçues restent « à analyser ». Ouvrir `https://gestion.…` : la page de connexion s'affiche, avec un cadenas.

## 8. Le premier gérant 👤

```sh
dbs --profile outils run --rm --entrypoint psql migrations -v email=prenom.nom@dbs-assurances.ci \
  -v nom='Prénom NOM' -f /database/initialisation/02_premier_gerant.sql
set -a && . /opt/dbs/infra/production/.env && set +a
dbs run --rm --no-deps \
  -e DATABASE_URL_PROPRIETAIRE="postgresql://dbs_proprietaire:${PROPRIETAIRE_MOT_DE_PASSE_BASE}@${PGHOST:-base}:${PGPORT:-5432}/${PGDATABASE:-dbs}" \
  api node apps/api/dist/outils/premier-acces.js prenom.nom@dbs-assurances.ci
exit   # fermer la session : les mots de passe ne restent pas dans le terminal
```

Le mot de passe provisoire s'affiche **une seule fois** : le remettre au gérant en main propre. À la première connexion, il configure son deuxième facteur et choisit son mot de passe. Ensuite, tous les comptes se créent depuis le back-office (page Personnel), après la formation ([formation du personnel](../../docs/securite/formation-du-personnel.md)).

## 9. Vérifier les sauvegardes, tout de suite

```sh
dbs exec sauvegarde sauvegarder.sh
```

La sauvegarde apparaît dans le back-office, page **Exploitation** : réussie, copiée hors site, journal d'audit intact. Faire aussitôt le premier **test de restauration** ([sauvegardes](../sauvegardes/README.md#test-de-restauration-chaque-mois)) : la page Exploitation l'attend.

Ensuite, la sauvegarde tourne seule chaque nuit (`SAUVEGARDE_HEURE`, 02:00 par défaut, heure d'Abidjan).

## 10. La surveillance

Brancher les deux signaux externes décrits dans [surveillance](../surveillance/README.md) : la disponibilité de `https://gestion.…/api/sante`, et le battement de cœur de la sauvegarde (`SAUVEGARDE_SIGNAL_URL`). Ils préviennent le gérant par e-mail ou SMS quand le serveur ne peut plus le faire lui-même.

## Au quotidien

| Quoi | Commande |
| --- | --- |
| État des services | `dbs ps` ; et la page Exploitation du back-office |
| Journaux de l'API (sans donnée personnelle) | `dbs logs --since 1h api` |
| Redémarrer un service | `dbs restart api` |
| Sauvegarde immédiate (avant une intervention) | `dbs exec sauvegarde sauvegarder.sh` |

**Mettre à jour** (chaque semaine pour les correctifs de sécurité des images, et à chaque nouvelle version) :

```sh
cd /opt/dbs && dbs exec sauvegarde sauvegarder.sh       # 1. une sauvegarde juste avant
git fetch --tags && git checkout <nouvelle version>    # 2. le code
dbs --profile outils run --rm migrations               # 3. la base (les migrations ne font qu'ajouter)
dbs --profile base-locale build --pull                 # 4. images reconstruites sur les dernières images de base
dbs --profile base-locale pull --ignore-buildable      #    antivirus et base : derniers correctifs
dbs --profile base-locale up -d --wait                 # 5. redémarrage des services qui ont changé
```

En cas de problème après une mise à jour, revenir à la version précédente (`git checkout <version précédente>`, puis les étapes 4 et 5) : les migrations ne font qu'ajouter, l'ancienne version fonctionne avec la base mise à jour, sauf mention contraire dans les notes de version.

**Renouveler un mot de passe de la base** : le changer dans `.env` (et dans `DATABASE_URL` d'`api.env` pour `dbs_application`), relancer `dbs --profile outils run --rm initialisation`, puis `dbs --profile base-locale up -d --force-recreate api sauvegarde`.

## Avec une base gérée par l'hébergeur

- Omettre `--profile base-locale` dans toutes les commandes ; renseigner `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER_ADMIN` et `POSTGRES_PASSWORD` (compte d'administration fourni) dans `.env`, et `?sslmode=verify-full` à la fin de `DATABASE_URL`.
- Activer chez l'hébergeur la **restauration à un instant donné** : la perte de données maximale passe de 24 heures à quelques minutes ([sauvegardes et reprise](../../docs/securite/sauvegardes-et-reprise.md)).
- Certaines bases gérées refusent l'attribut `BYPASSRLS` au compte de sauvegarde : l'initialisation échoue alors à la création de `dbs_sauvegarde`. Voir les solutions dans l'[ADR 0016](../../docs/architecture/adr/0016-mise-en-production.md#conséquences).

## Essai sur un poste

```sh
./infra/production/essai.sh
```

Construit les images, prépare une base neuve avec les outils ci-dessus, démarre tout avec des certificats internes et des réglages tirés au hasard, puis vérifie : HTTPS et en-têtes de sécurité, API derrière `/api`, aucun port ouvert pour la base et l'API, base sans accès à Internet, premier gérant, sauvegarde chiffrée, test de restauration. Tout est effacé à la fin. Demande Docker et `age`.
