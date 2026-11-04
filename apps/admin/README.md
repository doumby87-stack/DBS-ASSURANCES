# Back-office de l'agence (espace de gestion)

**Statut : premiers écrans en place** (tâche 4 de la [feuille de route](../../docs/feuille-de-route.md)) : connexion avec deuxième facteur, tableau des échéances, clients, fiche client, personnel. La caisse, les reversements, les flottes et les sinistres viendront avec leurs tâches.

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
| Échéances (`/`) | Contrats expirés non renouvelés, à J-7, J-15, J-30 ; relance WhatsApp avec message déjà rédigé ; renouvellement en un clic ; documents des véhicules (visite technique, vignette, carte de transport) | tous ; renouvellement : gérant, chargé de clientèle |
| Clients (`/clients`) | Recherche par nom ou numéro ; création avec alerte si le numéro existe déjà | tous ; création : gérant, chargé de clientèle, commercial, apporteur |
| Fiche client (`/clients/:id`) | Identité, contrats, véhicules, devis (statut, motif de refus), historique des échanges | selon le rôle |
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
3. relance et renouvellement depuis le tableau des échéances ;
4. création d'un compte, puis déconnexion.

Toute violation de la politique de sécurité du contenu fait échouer le test. La même vérification tourne dans l'intégration continue (« Back-office »).

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/securite/` | Connexion, deuxième facteur, changement de mot de passe. |
| `src/pages/` | Un dossier par écran ; `caisse`, `reversements`, `flottes`, `sinistres`, `relances`, `statistiques` viendront avec leurs tâches. |
| `src/composants/` | Composants partagés (champ, alerte, badge, section). |
| `src/services/` | Appels à l'API, libellés et formats d'affichage. |
| `tests/e2e/` | Parcours complet dans le navigateur. |
