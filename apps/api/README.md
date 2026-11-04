# API — la seule porte d'accès aux données

**Statut :** connexion du personnel avec deuxième facteur, sessions, comptes (tâche 3) ; clients, contrats, véhicules, devis, échanges et échéances (tâche 4) ; caisse, reçus, clôtures, reversements et commissions (tâche 5). Les relances automatiques viennent à la tâche 6 ([feuille de route](../../docs/feuille-de-route.md)).

L'API reçoit toutes les demandes du back-office et de l'espace client, vérifie qui les fait, puis interroge la base. Aucun navigateur ne parle directement à la base de données ([ADR 0003](../../docs/architecture/adr/0003-api-seule-porte-d-acces.md)).

Pile : Node.js 22, TypeScript, Fastify, PostgreSQL ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)). Dépendances de production limitées à quatre : `fastify`, `@fastify/cookie`, `pg`, `@node-rs/argon2`.

## Lancer

```bash
npm ci                                   # à la racine du dépôt
cp .env.example .env                     # puis remplir (voir ci-dessous)
npm run dev -w @dbs/api                  # rechargement automatique
```

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | oui | Connexion avec le compte `dbs_application` (jamais `dbs_proprietaire`). En production : `sslmode=verify-full`. |
| `CLE_CHIFFREMENT_DONNEES` | oui | 32 octets en base64 (`openssl rand -base64 32`). Chiffre les secrets du deuxième facteur. **La perdre oblige à réinitialiser l'accès de tout le personnel.** |
| `URL_BACK_OFFICE` | oui | Adresse du back-office ; seule origine autorisée à modifier des données. HTTPS en production. |
| `HOST`, `PORT` | non | `127.0.0.1` et `3000` par défaut. |
| `PROXYS_DE_CONFIANCE` | non | Nombre de proxys devant l'API (répartiteur, pare-feu applicatif), pour retrouver l'adresse IP réelle. `0` par défaut. |
| `VERIFIER_MOTS_DE_PASSE_DIVULGUES` | non | `true` par défaut : refuse les mots de passe présents dans des fuites connues. |
| `NIVEAU_JOURNAL` | non | `info` par défaut. |

L'API refuse de démarrer si une variable obligatoire manque, sans jamais afficher de valeur.

**Déploiement :** le back-office et l'API sont servis sous le **même nom de domaine** (par exemple `gestion.<domaine>`, l'API derrière `/api/` grâce au proxy, qui retire ce préfixe). Le cookie de session (`__Host-`, `SameSite=Strict`) et l'absence de CORS reposent sur ce choix.

## Installer le premier gérant

```bash
# 1. Compte créé dans la base (database/initialisation/02_premier_gerant.sql), puis :
npm run build -w @dbs/api
DATABASE_URL_PROPRIETAIRE=postgres://dbs_proprietaire@…/dbs npm run premier-acces -w @dbs/api -- prenom.nom@exemple.ci
```

Le mot de passe provisoire s'affiche une seule fois. Ensuite, tous les comptes sont créés depuis l'application par un gérant.

## Routes

| Route | Accès | Rôle |
| --- | --- | --- |
| `GET /sante` | public | Disponibilité de l'API et de la base. |
| `POST /auth/connexion` | public | E-mail et mot de passe → session partielle (5 minutes). Réponse `etape` : `mfa` ou `configuration_mfa`. |
| `POST /auth/mfa/configuration` | session partielle | Première connexion : secret du deuxième facteur et adresse `otpauth://` à afficher en QR code. |
| `POST /auth/mfa/activation` | session partielle | Premier code → connexion complète. |
| `POST /auth/mfa` | session partielle | Code à 6 chiffres → connexion complète. |
| `GET /auth/session` | connecté | Utilisateur courant, rôle, mot de passe provisoire ou non. |
| `POST /auth/mot-de-passe` | connecté | Changement de mot de passe (obligatoire s'il est provisoire). |
| `POST /auth/deconnexion` | — | Ferme la session. |
| `GET /utilisateurs` | connecté | Liste du personnel. |
| `POST /utilisateurs` | gérant | Crée un compte ; renvoie une fois son mot de passe provisoire. |
| `PATCH /utilisateurs/:id` | gérant | Nom, rôle, activation. Une désactivation ou un changement de rôle ferme les sessions du compte. |
| `POST /utilisateurs/:id/reinitialiser-acces` | gérant | Mot de passe oublié, téléphone perdu : nouveau mot de passe provisoire, deuxième facteur à reconfigurer. |
| `GET /clients?recherche=` | connecté | Clients visibles (l'apporteur ne voit que les siens), recherche par nom ou numéro. |
| `POST /clients` | gérant, chargé, commercial, apporteur | Téléphone normalisé (+225…) ; si le numéro existe déjà : 409 `doublon_possible`, sauf `confirmerDoublon`. |
| `GET /clients/:id` | connecté | Fiche : client, contrats (avec le reste à payer pour qui voit la caisse), véhicules, devis, échanges. |
| `PATCH /clients/:id` | gérant, chargé, commercial | Coordonnées. |
| `POST /clients/:id/echanges` | tous sauf auditeur | Appel, message, visite ou note (ajout seul). |
| `POST /clients/:id/vehicules` | gérant, chargé, commercial | Véhicule et échéances administratives ; immatriculation normalisée et unique. |
| `POST /clients/:id/devis`, `PATCH /devis/:id` | création : gérant, chargé, commercial, apporteur ; suivi : sans l'apporteur | Devis ; un refus exige son motif. |
| `POST /contrats`, `PATCH /contrats/:id` | gérant, chargé | Contrats et prime nette ; « en vigueur » refusé tant que la prime n'est pas payée (Code CIMA, art. 13). |
| `POST /contrats/:id/renouveler` | gérant, chargé | Nouveau contrat à partir de l'échéance, même durée et même prime par défaut. |
| `GET /echeances` | connecté | Contrats à renouveler (expirés, J-7, J-15, J-30, J-60) et documents de véhicules. |
| `GET /contrats/:id/paiements` | gérant, caissier, chargé, auditeur | Reste à payer, espèces encore possibles (plafond), reçus du contrat. |
| `POST /encaissements` | gérant, caissier | Encaissement ; jamais plus que le reste à payer, plafond des espèces, référence obligatoire hors espèces. Le contrat entre en vigueur au paiement du solde. |
| `POST /encaissements/:id/contre-passation` | gérant | Annule exactement un encaissement, motif obligatoire, une seule fois. |
| `GET /encaissements/:id/recu` | gérant, caissier, chargé, auditeur | Reçu : montant en lettres, reste à payer après ce paiement, identité de l'agence. |
| `GET /encaissements?du=&au=` | gérant, caissier, chargé, auditeur | Journal des encaissements (aujourd'hui par défaut), totaux par mode. |
| `GET /caisse` | gérant, caissier | Ma caisse depuis ma dernière clôture. |
| `POST /caisse/clotures`, `GET /caisse/clotures` | clôture : gérant, caissier ; liste : avec l'auditeur | Clôture avec billetage ; espèces attendues calculées par la base, écart à expliquer. |
| `POST /caisse/clotures/:id/visa` | gérant | Visa d'une clôture, jamais la sienne. |
| `GET /reversements/a-reverser` | gérant, caissier, auditeur | Primes pas encore versées, date limite (30 jours), alerte à J+25. |
| `POST /reversements`, `GET /reversements`, `GET /reversements/:id` | préparation : gérant, caissier ; lecture : avec l'auditeur | Bordereau de tous les encaissements hors bordereau jusqu'à une date. |
| `POST /reversements/:id/validation` | gérant | Jamais par la personne qui a préparé (quatre yeux). |
| `POST /reversements/:id/versement` | gérant | Date et référence du virement ; le bordereau est ensuite figé. |
| `POST /reversements/:id/annulation` | gérant, caissier qui l'a préparé | Avant validation ; les encaissements redeviennent à reverser. |
| `GET /reversements/:id/export.csv` | gérant | Export pour Excel, protégé contre l'injection de formules ; consigné au journal de sécurité. |
| `GET /commissions` | gérant, auditeur | Taux par branche, rapprochement mensuel, contrats payés sans prime nette. |
| `POST /commissions/taux`, `POST /commissions/releves` | gérant | Taux applicable à partir d'une date ; relevé de la compagnie pour un mois (créé ou corrigé). |

## Sécurité en place

| Mesure | Où |
| --- | --- |
| Mots de passe hachés avec Argon2id (paramètres OWASP), recalculés si les paramètres changent | `src/securite/mots-de-passe.ts` |
| Mots de passe d'au moins 12 caractères, sans l'adresse e-mail, absents des fuites connues (k-anonymat : le mot de passe ne quitte jamais le serveur) | `src/securite/mots-de-passe.ts` |
| Deuxième facteur TOTP obligatoire, codes à usage unique (anti-rejeu), secret chiffré en AES-256-GCM lié à l'utilisateur | `src/securite/totp.ts`, `chiffrement.ts` |
| Sessions côté serveur ; seule l'empreinte du jeton est en base ; cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict` ; nouveau jeton à chaque changement de niveau ou de mot de passe | `src/securite/sessions.ts` |
| Expiration : 15 minutes d'inactivité, 8 heures au maximum ; compte désactivé = accès coupé immédiatement | base, `securite.lire_session` |
| Blocage après 5 échecs (15 min, puis doublé, 24 h au plus) et fermeture des sessions ; 20 échecs par adresse IP en 15 min suspendent les tentatives | `src/securite/limitation.ts` |
| Même réponse et même durée pour un compte inconnu, désactivé, bloqué ou un mauvais mot de passe | `src/securite/routes-authentification.ts` |
| Protection CSRF : toute modification doit venir de l'origine du back-office, en JSON uniquement | `src/securite/protection.ts` |
| Champs inattendus refusés ; erreurs sans détail interne ; en-têtes de sécurité sur toutes les réponses | `src/application.ts`, `src/commun/erreurs.ts` |
| Chaque requête métier déclare l'utilisateur à la base, qui applique ses propres droits | `src/base-de-donnees/connexion.ts` |
| Journal de sécurité en ajout seul : connexions, échecs, blocages, créations et modifications de comptes, exports de données | `securite.evenements` |
| Exports CSV : réservés au gérant, cellules qui commencent par `=`, `+`, `-`, `@` neutralisées (pas de formule exécutée par Excel) | `src/commun/csv.ts` |

**Risques connus :**

- Quelqu'un qui connaît l'adresse e-mail d'un membre du personnel peut bloquer son compte en se trompant volontairement de mot de passe. Un autre gérant le débloque en réinitialisant son accès. Le pare-feu applicatif prévu en production (tâche 11) limitera aussi ces tentatives.
- Le personnel qui travaille derrière la même connexion Internet (la box de l'agence) partage le compteur par adresse IP : 20 échecs en 15 minutes, toutes personnes confondues, suspendent les connexions depuis l'agence pendant 15 minutes.

## Tests

```bash
npm run test:unitaires -w @dbs/api       # sans base de données
# Tests de sécurité contre un PostgreSQL DE TEST (la base dbs_api_tests est recréée) :
PGHOST=localhost PGUSER=postgres PGPASSWORD=… npm run test -w @dbs/api
npm run verifier-types -w @dbs/api
```

| Dossier | Contenu |
| --- | --- |
| `tests/unitaires/` | Vecteurs officiels de la RFC 6238, chiffrement, politique des mots de passe, vérification des fuites, configuration, traduction des erreurs, montant en lettres, CSV. |
| `tests/securite/` | Parcours de connexion, rejeu d'un code, blocages, CSRF, cookies, expiration, secrets jamais en clair. |
| `tests/integration/` | Gestion des comptes par le gérant et limites de chaque rôle ; clients et contrats ; caisse, clôtures, reversements et commissions. |

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/config/` | Lecture et validation des variables d'environnement. |
| `src/securite/` | Connexion, deuxième facteur, sessions, limitation des tentatives, protections HTTP. |
| `src/base-de-donnees/` | Connexions à PostgreSQL et transactions qui déclarent l'utilisateur. |
| `src/modules/` | Un dossier par domaine métier : `utilisateurs`, `clients`, `contrats` (et échéances), `vehicules`, `devis`, `encaissements` (et caisse), `reversements`, `commissions` en place ; les autres viendront avec leurs tâches. |
| `src/integrations/` | Services extérieurs (paiement, WhatsApp, SMS, FNE, fichiers) : à venir. |
| `src/commun/` | Erreurs, formats, montant en lettres, CSV, identité de l'agence imprimée sur les reçus. |
| `src/outils/` | Outils d'installation (`premier-acces`). |

## Règles pour la suite

1. Chaque route déclare ses gardes (`gardes.sessionComplete()`, `gardes.roles(...)`). Sans garde, elle est publique : à justifier dans la pull request.
2. Toute entrée est validée par un schéma, champs inattendus refusés.
3. Requêtes SQL **toujours paramétrées**, toujours dans `transactionUtilisateur`, sauf pendant la connexion.
4. Les échecs de sécurité sont enregistrés avant de répondre (transaction validée, puis erreur).
5. Aucune donnée personnelle, aucun mot de passe ni jeton dans les journaux.
6. Les messages d'erreur ne révèlent rien de l'intérieur.
