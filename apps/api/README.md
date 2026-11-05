# API — la seule porte d'accès aux données

**Statut :** connexion du personnel avec deuxième facteur, sessions, comptes (tâche 3) ; clients, contrats, véhicules, devis, échanges et échéances (tâche 4) ; caisse, reçus, clôtures, reversements et commissions (tâche 5) ; relances automatiques par WhatsApp et SMS, consentements des clients (tâche 6) — [feuille de route](../../docs/feuille-de-route.md).

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
| `ANTIVIRUS_ADRESSE` | en production, si `URL_SITE_VITRINE` ou `URL_PORTAIL` est défini | Démon ClamAV (`hôte:port`, port 3310 par défaut) qui analyse les cartes grises et les attestations. Sans lui, les pièces reçues restent « à analyser » et ne peuvent pas être téléchargées. |
| `URL_SITE_VITRINE` | non | Adresse du site vitrine : ouvre la route publique des demandes de devis à ce seul site ([ADR 0009](../../docs/architecture/adr/0009-demandes-de-devis-du-site.md)). Sans elle, la route n'existe pas. HTTPS en production. **À renseigner après la déclaration à l'ARTCI.** |
| `URL_PORTAIL` | non | Adresse de l'espace client (portail) : ouvre ses routes (`/portail/…`), qui n'acceptent que cette origine ([ADR 0011](../../docs/architecture/adr/0011-portail-des-entreprises.md)). Sans elle, les routes du portail n'existent pas. HTTPS en production, avec l'accès à WhatsApp (codes de connexion) et l'antivirus (attestations, pièces des sinistres). |
| `PAIEMENT_PRESTATAIRE` | non | Prestataire du paiement en ligne des primes ([ADR 0012](../../docs/architecture/adr/0012-espace-client-et-paiement-en-ligne.md)). Seule valeur pour l'instant : `simulation` (rien n'est débité ; **refusé en production**). Sans elle, le paiement en ligne n'est pas proposé : le client paie à l'agence. |
| `PAIEMENT_MONTANT_MAX` | non | Montant maximal d'un paiement en ligne, en F CFA : `2000000` par défaut (de 100 à 10 000 000). |
| `HOST`, `PORT` | non | `127.0.0.1` et `3000` par défaut. |
| `PROXYS_DE_CONFIANCE` | non | Nombre de proxys devant l'API (répartiteur, pare-feu applicatif), pour retrouver l'adresse IP réelle. `0` par défaut. |
| `VERIFIER_MOTS_DE_PASSE_DIVULGUES` | non | `true` par défaut : refuse les mots de passe présents dans des fuites connues. |
| `NIVEAU_JOURNAL` | non | `info` par défaut. |
| `RELANCES_ACTIVES` | non | `true` : le planificateur des relances tourne toutes les 15 minutes. `false` par défaut. |
| `RELANCES_HEURES_ENVOI` | non | Heures d'envoi, heure d'Abidjan : `8-20` par défaut (début inclus, fin exclue). |
| `RELANCES_SIMULATION` | non | `true` : relances enregistrées mais rien ne part (développement, tests). **Refusé en production.** |
| `WHATSAPP_JETON`, `WHATSAPP_IDENTIFIANT_NUMERO`, `WHATSAPP_SECRET_APPLICATION`, `WHATSAPP_JETON_VERIFICATION` | les quatre, ou aucune | Accès à l'API Cloud de Meta : jeton d'un utilisateur système, identifiant du numéro chez Meta, secret de l'application (signature des notifications), jeton choisi pour activer les notifications. Sans elles, aucun canal n'est actif : les relances dues sont listées « à faire à la main ». |
| `WHATSAPP_VERSION_API` | non | Version de l'API Graph, `v23.0` par défaut. |

L'API refuse de démarrer si une variable obligatoire manque, sans jamais afficher de valeur.

**Déploiement :** le back-office et l'API sont servis sous le **même nom de domaine** (par exemple `gestion.<domaine>`, l'API derrière `/api/` grâce au proxy, qui retire ce préfixe). Le cookie de session (`__Host-`, `SameSite=Strict`) et l'absence de CORS reposent sur ce choix. Seule exception : la route des demandes de devis répond au site vitrine (`URL_SITE_VITRINE`) avec les en-têtes CORS de cette seule origine, sans cookie.

## Relances automatiques

Le planificateur (`RELANCES_ACTIVES=true`) tourne toutes les 15 minutes : il planifie les relances dues aux clients qui ont accepté un canal disponible, puis, entre 8 h et 20 h, les envoie par lots ([ADR 0007](../../docs/architecture/adr/0007-relances-whatsapp-et-sms.md)).

| Relance | Quand |
| --- | --- |
| Échéance d'un contrat | À J-30, J-15, J-7 et le jour même, contrat en vigueur pas encore renouvelé |
| Contrat expiré | Une fois, dans les 7 jours qui suivent l'échéance |
| Devis sans réponse | Une fois, 3 jours après son passage à « envoyé au client » |
| Avancement d'un sinistre | À la déclaration, puis à chaque changement de statut |

Une relance par étape et par objet ; trois essais en cas d'erreur passagère ; abandon d'une relance qui n'a pas pu partir en 48 heures, ou dont le client a retiré son accord entre-temps. Textes : [modèles de messages](../../docs/metier/modeles-de-messages.md).

**Brancher WhatsApp** (une fois les démarches de la tâche 2 faites) :

1. Dans Meta for Developers, une application de type « Entreprise » reliée au compte WhatsApp Business de l'agence ; un **utilisateur système** avec un jeton permanent limité à `whatsapp_business_messaging` → `WHATSAPP_JETON`.
2. L'identifiant du numéro de l'agence (« Phone number ID ») → `WHATSAPP_IDENTIFIANT_NUMERO` ; le secret de l'application → `WHATSAPP_SECRET_APPLICATION` ; un jeton de vérification tiré au hasard (`openssl rand -hex 24`) → `WHATSAPP_JETON_VERIFICATION`.
3. Adresse des notifications : `https://gestion.<domaine>/api/webhooks/whatsapp`, avec ce jeton de vérification, abonnée au champ `messages`.
4. Les quatre modèles validés par Meta, sous leurs noms exacts.

En développement : `RELANCES_SIMULATION=true` enregistre les relances sans rien envoyer.

## Demandes de devis du site

Le formulaire du site envoie la demande à `POST /site/demandes-devis` (JSON, carte grise en base64), si le site est construit avec l'adresse de l'API (`URL_API`) et l'API configurée avec celle du site (`URL_SITE_VITRINE`). Contrôles : origine du site, champ piège pour les robots, 5 demandes par heure et par adresse et 300 par jour (appliqués par la base, l'adresse IP n'étant gardée que sous forme d'empreinte), carte grise JPEG, PNG ou PDF de 5 Mo au plus reconnue d'après son contenu, puis chiffrée. La demande reçoit un numéro, communiqué au visiteur ; elle se traite au back-office, écran « Demandes du site » ([ADR 0009](../../docs/architecture/adr/0009-demandes-de-devis-du-site.md)).

**Antivirus.** La carte grise est analysée par ClamAV à la réception (infectée : refusée) et à chaque téléchargement (jamais remise sans analyse réussie ; une menace découverte plus tard efface son contenu). Installer le démon à côté de l'API, joignable seulement par elle, par exemple avec l'image officielle `clamav/clamav` (port 3310, signatures mises à jour par `freshclam`), puis `ANTIVIRUS_ADRESSE=clamav:3310`. Pour les tests : `tests/antivirus/demarrer-clamd.sh` démarre un vrai ClamAV avec la seule signature de test EICAR, et `ANTIVIRUS_ADRESSE_TEST=127.0.0.1:3310 npm run test -w @dbs/api` l'utilise.

**Maintenance** (toutes les heures, toujours active) : expiration des contrats échus, résultat des paiements en ligne en attente depuis plus de 10 minutes demandé au prestataire (puis abandon de ceux restés sans réponse plus d'un jour), suppression des demandes sans suite depuis 12 mois (ou jamais traitées, reçues il y a plus de 12 mois) avec leur carte grise, et analyse des pièces reçues pendant une panne de l'antivirus.

## Espace client (portail)

Avec `URL_PORTAIL`, l'API ouvre les routes de l'espace client ([`apps/portail`](../portail/README.md), [ADR 0011](../../docs/architecture/adr/0011-portail-des-entreprises.md), [ADR 0012](../../docs/architecture/adr/0012-espace-client-et-paiement-en-ligne.md)), acceptées depuis cette seule origine. Leur session est séparée de celle du personnel : cookie `__Host-dbs_portail` et table `portail.sessions`, 30 minutes d'inactivité, 12 heures au plus. Chaque lecture passe par `transactionPortail`, sous le rôle de base `dbs_portail`, qui ne voit que le client de la personne connectée (son entreprise, ou elle-même pour un particulier).

| Route | Rôle |
| --- | --- |
| `POST /portail/connexion/code` | Code de 6 chiffres envoyé sur WhatsApp (modèle `dbs_code_connexion`). Même réponse, et même délai, que le numéro ait un accès ou non ; demandes limitées par numéro et par adresse. |
| `POST /portail/connexion`, `POST /portail/deconnexion`, `GET /portail/session` | Connexion par le code (5 essais), fin de session, personne connectée et type de client. Un particulier dont le numéro est celui de sa fiche, avec un contrat, a son accès créé à sa première demande de code. |
| `GET /portail/flotte` | Accueil : véhicules (contrat en cours, attestation, échéances, sinistres), contrats, reste à payer et paiement en cours, chiffres clés, paiement en ligne proposé ou non. |
| `GET /portail/vehicules/:id` | Périodes de couverture et historique des sinistres du véhicule. |
| `GET /portail/attestations/:id`, `GET /portail/attestations.zip`, `GET /portail/flotte.csv` | Une attestation, toutes les attestations en cours (ZIP), la liste pour Excel ; consignés dans `portail.evenements`. |
| `GET`, `POST /portail/gestionnaires`, `DELETE /portail/gestionnaires/:id` | Accès de l'équipe ; ajout et retrait réservés au titulaire d'une entreprise (vérifié par la base). |
| `POST /portail/paiements` | Avec `PAIEMENT_PRESTATAIRE` : prépare le paiement d'une prime (contrat, montant multiple de 5, limites vérifiées par la base), le transmet au prestataire et renvoie l'adresse de sa page de paiement. |
| `GET /portail/paiements`, `GET /portail/paiements/:id` | Paiements en ligne du client ; le détail demande le résultat au prestataire tant qu'il est en attente (une fois toutes les 5 secondes au plus) et le fait enregistrer par la base. |
| `POST /portail/paiements/:id/simulation` | Prestataire simulé seulement : paie ou refuse le paiement, comme le ferait le client chez le prestataire. |
| `GET`, `POST /portail/sinistres`, `GET /portail/sinistres/:id` | Sinistres du client, déclaration en ligne (contrat, véhicule couvert ce jour-là, date, nature, lieu, récit), détail avec la liste des documents. |
| `POST /portail/sinistres/:id/pieces` | Photo ou document (JPEG, PNG, PDF, 5 Mo au plus, type reconnu d'après le contenu), analysé par l'antivirus, chiffré ; 8 par sinistre, dans les 7 jours. |

**Paiement en ligne.** Le résultat d'un paiement est toujours demandé au prestataire (`verifier`) : la page de retour et les notifications ne font que déclencher cette vérification. La base enregistre ensuite l'encaissement (`app.conclure_paiement_en_ligne`) : mode Mobile Money, sans caissier, hors caisse, une seule fois. `POST /paiements/notifications/:prestataire` reçoit les notifications du prestataire ; sa signature est contrôlée par le module du prestataire (le prestataire simulé n'en accepte aucune). Le prestataire réel s'ajoute dans `src/integrations/paiement/` en suivant sa documentation officielle.

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
| `GET /clients/:id/flotte` | connecté | Véhicules et échéances, contrats avec leur composition et leurs avenants (réglés ou non). |
| `POST /clients/:id/vehicules/import` | gérant, chargé, commercial | Liste de véhicules (classeur `.xlsx` ou CSV en base64, 2 Mo) : aperçu ligne par ligne avec toutes les erreurs, puis, avec `confirmer`, enregistrement tout ou rien. Plaque déjà connue du client : mise à jour sans effacer ; d'un autre client : refusée. |
| `GET /flottes/modele-import.csv` | connecté | Modèle à remplir. |
| `GET /clients/:id/flotte/export.csv` | gérant, chargé, commercial | Véhicules du client pour la cotation en lot ; consigné au journal de sécurité. |
| `POST /contrats/:id/vehicules`, `DELETE /contrats/:id/vehicules/:vehiculeId` | gérant, chargé | Véhicule de départ d'un contrat qui attend son paiement (couvert pour toute la période) ; détaché s'il a été rattaché par erreur, tant que le contrat n'est pas payé. |
| `POST /contrats/:id/avenants` | gérant, chargé | Avenant de mouvement sur un contrat en vigueur : incorporation (réintégration comprise) ou retrait d'un ou plusieurs véhicules à une même date, prime calculée par la base au prorata des jours restants. Sans `confirmer` : aperçu du calcul, rien n'est écrit ; avec : avenant enregistré. |
| `POST /contrats/:id/avenants/:avenantId/annulation` | gérant, chargé | Avenant d'annulation (motif obligatoire) : défait exactement un avenant saisi par erreur, si aucun avenant postérieur, aucune attestation ni aucun sinistre ne s'est appuyé dessus. Même aperçu, puis `confirmer`. |
| `POST /contrats/:id/sinistres`, `PATCH /sinistres/:id` | gérant, chargé | Déclaration d'un sinistre (véhicule couvert ce jour-là, vérifié par la base) et suivi de son statut et de la référence de la compagnie. |
| `GET /sinistres?tous=oui`, `GET /sinistres/:id` | gérant, chargé, commercial, auditeur | Sinistres en cours (ou tous), les déclarations à transmettre en premier ; fiche avec le récit du client, le déclarant et ses documents. |
| `GET /sinistres/:id/pieces/:pieceId` | gérant, chargé, commercial | Photo ou document joint par le client, déchiffré ; téléchargement consigné. |
| `GET /paiements-en-ligne?statut=` | gérant, caissier, chargé, auditeur | Paiements en ligne des clients, ceux « à régulariser » en premier, avec le motif. |
| `POST /paiements-en-ligne/:id/regularisation` | gérant | Paiement reçu mais non encaissé : ce que l'agence a fait (remboursement, affectation). |
| `GET`, `POST /clients/:id/acces-portail`, `PATCH /acces-portail/:id` | lecture : gérant, chargé, commercial, auditeur ; le reste : gérant, chargé | Accès d'un client à l'espace client : titulaire et collaborateurs pour une entreprise, un seul accès pour un particulier ; retrait et rétablissement. |
| `POST /contrats/:id/vehicules/:vehiculeId/attestation`, `GET /attestations/:id` | dépôt : gérant, chargé ; lecture : gérant, chargé, commercial | Attestation PDF d'un véhicule couvert (contrat payé) : contenu vérifié, antivirus, chiffrement ; téléchargement consigné. |
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
| `POST /clients/:id/consentements` | gérant, chargé, commercial | Accord ou refus du client pour les relances par WhatsApp ou SMS, avec la façon dont il l'a exprimé (preuve obligatoire). Le dernier choix et les relances récentes figurent sur la fiche (`GET /clients/:id`). |
| `GET /relances?statut=` | gérant, chargé, commercial, auditeur | Canaux actifs, résumé sur 30 jours, relances avec le texte envoyé, relances dues à faire à la main faute d'accord du client. |
| `POST /relances/cycle` | gérant | Lance un cycle sans attendre les 15 minutes : planification, puis envoi aux heures prévues. |
| `POST /relances/:id/annulation` | gérant, chargé | Annule une relance pas encore envoyée. |
| `POST /site/demandes-devis` | public, **origine du site exigée** | Demande de devis du formulaire du site, avec la carte grise éventuelle ; renvoie son numéro. N'existe que si `URL_SITE_VITRINE` est défini. |
| `GET /demandes-site?statut=` | gérant, chargé, commercial, auditeur | Demandes reçues par le site (à traiter par défaut, converties ou sans suite) et nombre de demandes à traiter. |
| `GET /demandes-site/:id` | gérant, chargé, commercial, auditeur | Détail, carte grise jointe (type et taille ; invisible pour l'auditeur), clients qui ont déjà ce numéro. |
| `GET /demandes-site/:id/piece` | gérant, chargé, commercial | Carte grise déchiffrée et analysée de nouveau par l'antivirus, en pièce jointe ; chaque téléchargement est consigné au journal de sécurité. 409 `piece_infectee` si une menace est trouvée, 503 `analyse_en_attente` si elle n'a encore jamais pu être analysée. |
| `POST /demandes-site/:id/conversion` | gérant, chargé, commercial | Client (nouveau, ou existant avec `clientId`) et devis d'origine « site » ; accord WhatsApp noté sur la fiche si le visiteur l'a donné. Même numéro qu'un client existant : 409 `doublon_possible`, sauf `confirmerNouveauClient`. |
| `POST /demandes-site/:id/sans-suite` | gérant, chargé, commercial | Classe la demande, motif obligatoire. |
| `GET /webhooks/whatsapp` | public (jeton de vérification) | Activation des notifications par Meta. |
| `POST /webhooks/whatsapp` | public, **signature de Meta exigée** | Accusés de remise et de lecture, « STOP » des clients. |

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
| Notifications de WhatsApp : signature HMAC-SHA256 de Meta vérifiée sur le corps exact reçu, en temps constant, avant toute lecture ; seule route sans contrôle d'origine | `src/integrations/whatsapp/` |
| Relances : jamais sans l'accord du client, revérifié avant chaque envoi ; planificateur sans utilisateur connecté, limité à cinq fonctions de la base ; verrou de la base contre deux cycles simultanés ; ni nom, ni numéro, ni contenu de message dans les journaux | `src/modules/relances/` |

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
| `tests/unitaires/` | Vecteurs officiels de la RFC 6238, chiffrement, politique des mots de passe, vérification des fuites, configuration, traduction des erreurs, montant en lettres, CSV ; WhatsApp (appel de l'API, erreurs, signature, notifications, « STOP »), textes des relances identiques aux modèles soumis à Meta. |
| `tests/securite/` | Parcours de connexion, rejeu d'un code, blocages, CSRF, cookies, expiration, secrets jamais en clair. |
| `tests/integration/` | Gestion des comptes par le gérant et limites de chaque rôle ; clients et contrats ; caisse, clôtures, reversements et commissions ; relances (consentements, planification et envoi, notifications signées, « STOP », annulation, heures d'envoi, verrou). |

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/config/` | Lecture et validation des variables d'environnement. |
| `src/securite/` | Connexion, deuxième facteur, sessions, limitation des tentatives, protections HTTP. |
| `src/base-de-donnees/` | Connexions à PostgreSQL et transactions qui déclarent l'utilisateur. |
| `src/modules/` | Un dossier par domaine métier : `utilisateurs`, `clients`, `contrats` (et échéances), `vehicules`, `devis`, `encaissements` (et caisse), `reversements`, `commissions`, `relances` (planificateur, textes, consentements), `demandes-site`, `flottes` (import, export, avenants) en place ; les autres viendront avec leurs tâches. |
| `src/integrations/` | Services extérieurs : WhatsApp (API Cloud de Meta) en place ; SMS : interface prête, opérateur à choisir ; paiement, FNE, fichiers : à venir. |
| `src/commun/` | Erreurs, formats, montant en lettres, CSV, identité de l'agence imprimée sur les reçus. |
| `src/outils/` | Outils d'installation (`premier-acces`). |

## Règles pour la suite

1. Chaque route déclare ses gardes (`gardes.sessionComplete()`, `gardes.roles(...)`). Sans garde, elle est publique : à justifier dans la pull request.
2. Toute entrée est validée par un schéma, champs inattendus refusés.
3. Requêtes SQL **toujours paramétrées**, toujours dans `transactionUtilisateur`, sauf pendant la connexion.
4. Les échecs de sécurité sont enregistrés avant de répondre (transaction validée, puis erreur).
5. Aucune donnée personnelle, aucun mot de passe ni jeton dans les journaux.
6. Les messages d'erreur ne révèlent rien de l'intérieur.
