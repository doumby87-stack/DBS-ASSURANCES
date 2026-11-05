# Back-office de l'agence (espace de gestion)

**Statut :** connexion avec deuxième facteur, tableau des échéances, clients, fiche client, personnel (tâche 4) ; caisse, reçus, reversements et commissions (tâche 5) ; relances automatiques et accord des clients (tâche 6) ; demandes du site (tâche 7) ; flottes (tâche 8) ; accès à l'espace client (tâche 10) ; sinistres et paiements en ligne (tâche 9) — [feuille de route](../../docs/feuille-de-route.md).

L'outil de travail quotidien de l'agence. Il ne contient aucune donnée : il affiche ce que l'[API](../api/README.md) lui autorise à voir.

Pile : React, TypeScript, Vite ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)). Dépendances de production : `react`, `react-dom`, `qrcode`. La navigation entre les pages est écrite sans bibliothèque (`src/routeur.tsx`).

## Lancer en développement

```bash
npm ci                                       # à la racine du dépôt
npm run dev -w @dbs/api                      # API sur le port 3000 (URL_BACK_OFFICE=http://localhost:5173)
npm run dev -w @dbs/admin                    # back-office sur http://localhost:5173
```

Vite transmet les appels `/api/…` à l'API (variable `API_URL` si l'API n'est pas sur le port 3000).

## Écrans

| Écran | Contenu | Rôles |
| --- | --- | --- |
| Connexion | Mot de passe, deuxième facteur (QR code à la première connexion), mot de passe personnel obligatoire après un mot de passe provisoire | tous |
| Échéances (`/`) | Contrats expirés non renouvelés, à J-7, J-15, J-30 ; relance WhatsApp avec message déjà rédigé ; renouvellement en un clic ; documents des véhicules (visite technique, vignette, carte de transport) ; alerte des primes à reverser | tous ; renouvellement : gérant, chargé de clientèle ; alerte : gérant, caissier, auditeur |
| Clients (`/clients`) | Recherche par nom ou numéro ; création avec alerte si le numéro existe déjà | tous ; création : gérant, chargé de clientèle, commercial, apporteur |
| Fiche client (`/clients/:id`) | Identité, contrats (reste à payer pour qui voit la caisse), véhicules, devis (statut, motif de refus), accès à l'espace client (entreprise : titulaire et collaborateurs ; particulier : son seul accès, ouvert par lui ou par l'agence ; dernière connexion, retrait), rappels automatiques (accord ou refus par canal, avec sa preuve ; relances récentes), historique des échanges | selon le rôle ; accord du client : gérant, chargé de clientèle, commercial ; accès au portail : gérant, chargé de clientèle |
| Relances (`/relances`) | Canaux actifs, relances planifiées et envoyées (avec le texte lu par le client, remise, lecture, échec et sa raison), relances à faire à la main faute d'accord (message prêt sur WhatsApp), lancement immédiat, annulation avant l'envoi | gérant, chargé de clientèle, commercial, auditeur ; lancement : gérant ; annulation : gérant, chargé de clientèle |
| Demandes du site (`/demandes-site`) | Demandes de devis envoyées par le formulaire du site, dans l'ordre d'arrivée ; détail avec la carte grise à télécharger (après analyse antivirus, dont le résultat est affiché) et les accords cochés par le visiteur ; conversion en client et devis (ou rattachement à la fiche qui a déjà ce numéro), classement sans suite avec un motif | gérant, chargé de clientèle, commercial ; consultation sans carte grise : auditeur |
| Flotte (`/clients/:id/flotte`) | Import de la liste des véhicules (Excel ou CSV) avec aperçu des erreurs ligne par ligne, échéances des documents (échues en rouge, sous 30 jours en orange), export pour la cotation, composition des contrats (véhicule de départ détaché avant le paiement s'il a été rattaché par erreur), avenants d'incorporation et de retrait de plusieurs véhicules à la fois, réintégration, au prorata (calcul affiché avant enregistrement), annulation d'un avenant saisi par erreur ; attestations PDF déposées une à une ou en lot (plaque reconnue dans le nom du fichier), visibles sur le portail ; sinistres de la flotte avec leur historique par véhicule, déclaration et suivi du statut | tous en lecture ; import et export : gérant, chargé de clientèle, commercial ; avenants, attestations et sinistres : gérant, chargé de clientèle |
| Sinistres (`/sinistres`, `/sinistres/:id`) | Sinistres en cours (ou tous), les déclarations à transmettre en premier, celles faites en ligne signalées ; fiche avec le récit et le lieu donnés par le client, le déclarant (appel, WhatsApp), ses photos et documents (téléchargement consigné), suivi avec la compagnie (statut, référence, note interne jamais montrée au client) | gérant, chargé de clientèle, commercial, auditeur ; documents : sans l'auditeur ; suivi : gérant, chargé de clientèle |
| Contrat et paiements (`/contrats/:id`) | Reste à payer, espèces encore possibles, encaissement (le reçu s'ouvre aussitôt), reçus, contre-passation, prime nette | lecture : gérant, caissier, chargé, auditeur ; encaissement : gérant, caissier ; contre-passation : gérant |
| Reçu (`/recus/:id`) | Reçu imprimable avec le montant en lettres ; confirmation au client par WhatsApp | gérant, caissier, chargé, auditeur |
| Caisse (`/caisse`) | Ma caisse depuis la dernière clôture, clôture avec billetage, visa des clôtures, journal des encaissements du jour ; paiements en ligne des clients (hors caisse), ceux « à régulariser » en premier, avec leur régularisation | ma caisse : gérant, caissier ; visa et régularisation : gérant ; paiements en ligne : gérant, caissier, chargé, auditeur |
| Reversements (`/reversements`) | Primes à verser avec le compte à rebours des 30 jours, préparation d'un bordereau, liste des bordereaux | gérant, caissier, auditeur |
| Bordereau (`/reversements/:id`) | Détail imprimable, validation (pas par son auteur), versement, annulation, export pour Excel | validation, versement, export : gérant |
| Commissions (`/commissions`) | Rapprochement mensuel avec le relevé de SanlamAllianz, taux par branche, contrats sans prime nette | gérant, auditeur (lecture) |
| Personnel (`/personnel`) | Comptes, rôles, désactivation, réinitialisation de l'accès ; mot de passe provisoire montré une seule fois | gérant |
| Mon compte (`/mon-compte`) | Changement de mot de passe | tous |

Masquer un bouton n'est qu'un confort : les droits sont appliqués par l'API et par la base ([matrice des accès](../../docs/securite/controle-des-acces.md)).

## Sécurité

- **Politique de sécurité du contenu stricte** : aucun script ni style inline (pas d'attribut `style`), aucune ressource extérieure ; la police est livrée avec l'application. Le QR code du deuxième facteur est dessiné dans le navigateur : le secret n'est envoyé à aucun service.
- **Rien n'est conservé dans le navigateur** : ni `localStorage`, ni `sessionStorage`. La session tient dans un cookie `HttpOnly` que le code ne peut pas lire.
- **Même adresse que l'API** : en production, le back-office est servi sur un sous-domaine dédié (par exemple `gestion.<domaine>`), l'API derrière `/api/`. Ni CORS, ni cookie partagé avec un autre site.
- Liens vers WhatsApp ouverts avec `rel="noopener noreferrer"`. Page marquée `noindex`.

### En-têtes à servir en production

Ce sont ceux de `vite.config.ts` (appliqués par `vite preview` et vérifiés par le test de bout en bout) :

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

## Test de bout en bout

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=… npm run test:e2e -w @dbs/admin
```

Il construit l'API et le back-office, prépare une base de test neuve (`tests/e2e/preparer.mjs`), démarre les deux, puis joue dans Chromium le parcours d'un gérant :

1. première connexion, avec le deuxième facteur et le mot de passe personnel ;
2. création d'un client et d'un contrat, puis note d'un échange ;
3. encaissement au guichet : reçu n° 000001 avec le montant en lettres, contrat mis en vigueur ;
4. relance à faire à la main faute d'accord, accord du client noté sur sa fiche, puis relance automatique (l'API tourne en simulation : rien ne part) ;
5. relance et renouvellement depuis le tableau des échéances ;
6. clôture de caisse avec billetage ;
7. bordereau de reversement, que son auteur ne peut pas valider, et export pour Excel ;
8. flotte d'un transporteur : import, avenants au prorata, attestation, sinistre suivi jusqu'à la page Sinistres, accès à l'espace client ;
9. taux de commission, création d'un compte, puis déconnexion.

Toute violation de la politique de sécurité du contenu fait échouer le test. La même vérification tourne dans l'intégration continue (« Back-office »).

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/securite/` | Connexion, deuxième facteur, changement de mot de passe. |
| `src/pages/` | Un dossier par écran ; `statistiques` viendra avec sa tâche. |
| `src/composants/` | Composants partagés (champ, alerte, badge, section). |
| `src/services/` | Appels à l'API, libellés et formats d'affichage. |
| `tests/e2e/` | Parcours complet dans le navigateur. |
