# Démonstration locale

Tout le projet sur un ordinateur, avec des données inventées. Le guide pour le lancer, sans connaissance technique, est [DEMARRER.md](../DEMARRER.md).

## Comment c'est construit

| Fichier | Rôle |
| --- | --- |
| `compose.yml` | Trois services Docker : `base` (PostgreSQL 16), `preparation` (rôles, base et migrations, dans l'image PostgreSQL) et `demo` (tout le reste). Tous les ports ne sont ouverts que sur `127.0.0.1`. |
| `preparer-base.sh` | Prépare la base avec les scripts de production (`database/initialisation`, `database/migrer.sh`). Garde la base d'une fois sur l'autre. La remet à neuf si une migration déjà appliquée a changé : c'est le cas d'une version de travail. |
| `Dockerfile` | Image `demo` : dépendances (`npm ci`), puis construction de l'API, de la gestion, de l'espace client et du site. Le site est construit avec `URL_API=http://localhost:3000`, pour que ses formulaires enregistrent les demandes. |
| `lanceur.mjs` | Remplit la base de données fictives la première fois, puis démarre les services (voir ci-dessous). |
| `accueil.html`, `accueil.js`, `accueil.css` | Page d'accueil : liens, comptes, codes. Elle suit une politique de sécurité du contenu stricte : aucun script ni style en ligne. |
| `demarrer`, `arreter`, `reinitialiser` (`.bat` pour Windows, `.command` pour macOS et Linux) | Les commandes Docker en un double-clic : `up -d --build --wait` ; `down` ; `down -v` puis démarrage. Si le démarrage échoue, `demarrer` écrit `journal-demarrage.log` (versions de Docker, construction rejouée, état et messages des conteneurs), à envoyer à qui développe le projet. Les `.bat` sont en ASCII, sans `chcp` : selon sa version, l'invite de commandes de Windows lit mal les accents. |

Le lanceur démarre :

- l'**API**, dans son propre processus ;
- la **gestion** et l'**espace client**, servis par `vite preview` avec les en-têtes de production ;
- le **site**, servi avec son fichier `_headers` ;
- la **page d'accueil**, sur le port 8080.

## Ce qui est adapté à un ordinateur

- **Cookies de session :** en `http://localhost`, l'API les pose sans préfixe `__Host-` ni attribut `Secure`, car Safari refuse ces cookies hors HTTPS, même sur localhost. Le choix dépend de l'adresse configurée (`URL_BACK_OFFICE`, `URL_PORTAIL`) : en HTTPS, imposé en production, rien ne change.
- **Une seule adresse :** l'API n'accepte les connexions que depuis `http://localhost:…`. Avec `ADRESSE_PUBLIQUE`, que pose le lanceur, la gestion, l'espace client et le site renvoient `http://127.0.0.1:…` vers cette adresse.
- **Comptes bloqués :** comme en production, 5 erreurs de mot de passe ou de code bloquent un compte. Chaque démarrage et le bouton « Débloquer les comptes » de la page d'accueil (`POST /debloquer`, accepté seulement depuis la page d'accueil) les débloquent. Le journal de sécurité n'est jamais effacé.
- **Code du personnel :** chaque code ne sert qu'une fois. Si celui du moment vient de servir, la page d'accueil affiche le suivant, que l'API accepte déjà.

## Ce qui est simulé

- **Codes de l'espace client :** l'API reçoit un envoi de codes de démonstration (`envoiCodes`), qui les garde en mémoire pour la page d'accueil au lieu de les envoyer sur WhatsApp.
- **Deuxième facteur du personnel :** chaque compte a un secret fixe, tiré de son e-mail. La page d'accueil calcule le code du moment.
- **Paiement en ligne :** prestataire `simulation`.
- **Relances :** `RELANCES_SIMULATION`.
- **Antivirus :** démon de démonstration (`apps/api/tests/antivirus/clamd-factice.mjs`). Il ne refuse que le fichier de test EICAR.

La **lecture automatique des documents** est la vraie, le lecteur `local` : la reconnaissance de caractères tourne dans l'API, sur l'ordinateur. La page d'accueil propose des documents fictifs à lire (`apps/api/tests/donnees/lecture`) : le recto et le verso d'une carte grise, ceux d'une carte d'identité, et un passeport.

Les clés, les mots de passe et ces simulations sont **publics** : ils ne servent qu'ici. Le lanceur refuse de tourner avec `NODE_ENV=production`, et l'API refuse ces simulations en production.

## Sans Docker (Linux ou macOS, développeurs)

Il faut :

- `psql` et `bash` ;
- un serveur PostgreSQL de test, avec un compte superutilisateur.

```bash
npm ci
npm run build -w @dbs/api && npm run build -w @dbs/admin && npm run build -w @dbs/portail
URL_API=http://localhost:3000 npm run build -w @dbs/site-vitrine
PGHOST=localhost PGUSER=postgres PGPASSWORD=… node demo/lanceur.mjs        # --reinitialiser pour repartir de zéro
```

La base créée s'appelle `dbs_demo`. Ne pointez jamais ces variables vers un serveur qui contient de vraies données.
