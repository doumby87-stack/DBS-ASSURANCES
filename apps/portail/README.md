# Portail des entreprises et des transporteurs (espace entreprise)

**Statut :** tâche 10 terminée — [feuille de route](../../docs/feuille-de-route.md), [ADR 0011](../../docs/architecture/adr/0011-portail-des-entreprises.md).

L'espace des entreprises et des transporteurs assurés par l'agence. Chaque entreprise y retrouve :
- sa flotte et les échéances de ses documents ;
- ses contrats et ce qui reste à payer ;
- ses attestations, à télécharger une à une ou toutes ensemble ;
- l'historique des sinistres de chaque véhicule ;
- les accès de son équipe.

Il ne contient aucune donnée : il affiche ce que l'[API](../api/README.md) et la base lui laissent voir, c'est-à-dire l'entreprise de la personne connectée, et rien d'autre.

Pile : React, TypeScript, Vite, comme le back-office ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)). Dépendances de production : `react`, `react-dom`.

## Lancer en développement

```bash
npm ci                                       # à la racine du dépôt
npm run dev -w @dbs/api                      # API (URL_BACK_OFFICE=…, URL_PORTAIL=http://localhost:5174, RELANCES_SIMULATION=true)
npm run dev -w @dbs/portail                  # portail sur http://localhost:5174
```

Vite transmet les appels `/api/…` à l'API (variable `API_URL` si l'API n'est pas sur le port 3000). En simulation, aucun code ne part sur WhatsApp ; l'accès se crée au back-office, sur la fiche de l'entreprise.

## Écrans

| Écran | Contenu |
| --- | --- |
| Connexion | Numéro WhatsApp, puis code de 6 chiffres reçu sur WhatsApp (10 minutes, 5 essais). Aucun mot de passe. |
| Ma flotte (`/`) | Véhicules assurés, documents à renouveler sous 30 jours, sinistres en cours, reste à payer ; attestations en lot (ZIP) et liste pour Excel ; contrats ; véhicules avec contrat, attestation, échéances (dépassée en rouge, sous 30 jours en orange) et sinistres ; recherche par plaque. |
| Véhicule (`/vehicules/:id`) | Caractéristiques, échéances, périodes de couverture avec leur attestation, historique des sinistres (statut, référence de la compagnie). |
| Accès de l'équipe (`/collaborateurs`) | Personnes qui ont un accès et leur dernière connexion ; le titulaire ajoute ou retire ses collaborateurs. |

## Sécurité

- **Isolement par la base** : chaque requête passe sous le rôle `dbs_portail`, qui ne voit que l'entreprise de la personne connectée. La prime nette, les notes de l'agence et les références bancaires restent invisibles.
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

Il construit l'API et le portail et prépare une base neuve (`tests/e2e/preparer.mjs`) : une entreprise de trois camions, une attestation déposée, un sinistre suivi, deux accès, et une autre entreprise. Il démarre ensuite le tout, puis joue dans Chromium le parcours du titulaire :
1. connexion par code (un mauvais code est refusé) ;
2. tableau de bord et recherche ;
3. attestation, attestations en lot et liste pour Excel ;
4. historique des sinistres d'un véhicule ;
5. ajout et retrait d'un collaborateur ;
6. affichage sur un téléphone de 360 px, puis déconnexion.

L'autre entreprise ne doit jamais apparaître. Toute violation de la politique de sécurité du contenu fait échouer le test. La même vérification tourne dans l'intégration continue (« Portail des entreprises »).
