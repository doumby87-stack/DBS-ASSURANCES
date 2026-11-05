# Espace client (portail des entreprises et des particuliers)

**Statut :** tâches 10 et 9 terminées — [feuille de route](../../docs/feuille-de-route.md), [ADR 0011](../../docs/architecture/adr/0011-portail-des-entreprises.md), [ADR 0012](../../docs/architecture/adr/0012-espace-client-et-paiement-en-ligne.md).

L'espace des clients de l'agence : entreprises et transporteurs, professionnels, particuliers. Chacun y retrouve :
- ses contrats et ce qui reste à payer, **payable en ligne** par Mobile Money (Wave, Orange Money, MTN MoMo, Moov Money) ;
- ses véhicules et les échéances de leurs documents (la flotte, pour une entreprise) ;
- ses attestations, à télécharger une à une ou toutes ensemble ;
- ses sinistres, qu'il peut **déclarer en ligne** avec photos et constat amiable, et leur suivi ;
- pour une entreprise, les accès de son équipe.

Il ne contient aucune donnée : il affiche ce que l'[API](../api/README.md) et la base lui laissent voir, c'est-à-dire le client de la personne connectée, et rien d'autre.

Pile : React, TypeScript, Vite, comme le back-office ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)). Dépendances de production : `react`, `react-dom`.

## Lancer en développement

```bash
npm ci                                       # à la racine du dépôt
npm run dev -w @dbs/api                      # API (URL_BACK_OFFICE=…, URL_PORTAIL=http://localhost:5174, RELANCES_SIMULATION=true, PAIEMENT_PRESTATAIRE=simulation)
npm run dev -w @dbs/portail                  # portail sur http://localhost:5174
```

Vite transmet les appels `/api/…` à l'API (variable `API_URL` si l'API n'est pas sur le port 3000). En simulation, aucun code ne part sur WhatsApp ; l'accès se crée au back-office, sur la fiche du client. Avec `PAIEMENT_PRESTATAIRE=simulation`, le paiement en ligne s'essaie sans rien débiter : la « page du prestataire » est une page du portail qui propose de payer ou de refuser.

## Écrans

| Écran | Contenu |
| --- | --- |
| Connexion | Numéro WhatsApp, puis code de 6 chiffres reçu sur WhatsApp (10 minutes, 5 essais). Aucun mot de passe. |
| Accueil (`/`) : « Ma flotte » ou « Mes contrats » | Véhicules assurés, documents à renouveler sous 30 jours, sinistres en cours, reste à payer ; encadré « À payer » (paiement en ligne de chaque contrat) ; attestations en lot (ZIP) et, pour une entreprise, liste pour Excel ; contrats ; véhicules avec contrat, attestation, échéances (dépassée en rouge, sous 30 jours en orange) et sinistres ; recherche par plaque. |
| Véhicule (`/vehicules/:id`) | Caractéristiques, échéances, périodes de couverture avec leur attestation, historique des sinistres (statut, référence de la compagnie), déclaration d'un sinistre pour ce véhicule. |
| Payer (`/payer/:contrat`) | Reste à payer, montant (tout ou partie, arrondi au multiple de 5), puis départ vers la page du prestataire. Le code secret Mobile Money ne se saisit jamais ici. |
| Paiement (`/paiements/:id`) et Paiements (`/paiements`) | Retour du prestataire : le résultat s'affiche dès que l'agence l'a vérifié auprès du prestataire (la page se met à jour seule) ; historique des paiements en ligne. |
| Sinistres (`/sinistres`, `/sinistres/declarer`, `/sinistres/:id`) | Liste et suivi (statut, référence de la compagnie) ; déclaration (contrat, véhicule, date, nature, blessés, lieu, récit) avec photos et documents ; ajout de documents dans les 7 jours. |
| Accès de l'équipe (`/collaborateurs`) | Entreprise seulement : personnes qui ont un accès et leur dernière connexion ; le titulaire ajoute ou retire ses collaborateurs. |

## Sécurité

- **Isolement par la base** : chaque requête passe sous le rôle `dbs_portail`, qui ne voit que le client de la personne connectée. La prime nette, les notes de l'agence et les références bancaires restent invisibles.
- **Paiement** : rien de sensible ne transite par le portail ; le résultat d'un paiement n'est jamais pris dans la page de retour, mais demandé au prestataire par l'API.
- **Photos des sinistres** : type reconnu d'après le contenu, antivirus à l'arrivée, chiffrées en base ; elles ne se modifient ni ne se suppriment.
- **Sa propre adresse** (par exemple `espace.<domaine>`), l'API derrière `/api/` : son cookie de session (`__Host-dbs_portail`, `HttpOnly`, `SameSite=Strict`) n'est jamais envoyé au back-office, et les requêtes du portail ne sont acceptées que depuis son origine (`URL_PORTAIL`).
- **Politique de sécurité du contenu stricte**, aucune ressource extérieure, rien de conservé dans le navigateur (ni `localStorage`, ni `sessionStorage`). Page marquée `noindex`.
- Chaque téléchargement d'attestation et chaque export sont consignés au journal du portail, avec le nom de la personne.

### En-têtes à servir en production

Ceux de `vite.config.ts`, appliqués par `vite preview` et vérifiés par le test de bout en bout :

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
```

## Test de bout en bout

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=… npm run test:e2e -w @dbs/portail
```

Il construit l'API et le portail et prépare une base neuve (`tests/e2e/preparer.mjs`) : une entreprise de trois camions, une attestation déposée, un sinistre suivi, deux accès, une autre entreprise, et une particulière dont le contrat attend son paiement. Il démarre ensuite le tout (paiement simulé), puis joue dans Chromium le parcours du titulaire :
1. connexion par code (un mauvais code est refusé) ;
2. tableau de bord et recherche ;
3. attestation, attestations en lot et liste pour Excel ;
4. historique des sinistres d'un véhicule ;
5. ajout et retrait d'un collaborateur ;
6. affichage sur un téléphone de 360 px, puis déconnexion.

Puis celui de la particulière : son espace s'ouvre à sa première demande de code, elle paie sa prime en deux fois (Orange Money, puis Wave) jusqu'à la mise en vigueur du contrat, et déclare un sinistre avec une photo ; enfin l'affichage sur un téléphone de 360 px.

Les données d'un autre client ne doivent jamais apparaître. Toute violation de la politique de sécurité du contenu fait échouer le test. La même vérification tourne dans l'intégration continue (« Portail des entreprises »).
