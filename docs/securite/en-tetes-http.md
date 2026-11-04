# En-têtes de sécurité HTTP

Le site vitrine les reçoit de son hébergeur grâce au fichier [`apps/site-vitrine/public/_headers`](../../apps/site-vitrine/public/_headers), copié tel quel dans le site construit et lu par Netlify et Cloudflare Pages. Le back-office et l'espace client recevront les mêmes, au moins aussi stricts.

| En-tête | Valeur | Effet |
| --- | --- | --- |
| `Content-Security-Policy` | voir ci-dessous | Le navigateur n'exécute et ne charge que ce qui vient du site. Un script injecté est bloqué. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Le navigateur n'utilise plus que HTTPS pendant un an. |
| `X-Content-Type-Options` | `nosniff` | Un fichier n'est jamais interprété autrement que son type déclaré. |
| `X-Frame-Options` | `DENY` | Le site ne peut pas être affiché dans un cadre piégé (clickjacking). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Les sites extérieurs ne voient pas l'adresse exacte de la page d'origine. |
| `Permissions-Policy` | caméra, micro, position… désactivés | Aucune fonction sensible du téléphone n'est utilisable par le site. |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Isole la page, tout en laissant le formulaire ouvrir WhatsApp dans un nouvel onglet. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Les fichiers du site ne peuvent pas être embarqués par d'autres sites. |

## Politique de sécurité du contenu (CSP)

```
default-src 'none';                       rien n'est autorisé par défaut
script-src 'self';                        uniquement les fichiers de script du site, aucun script inline
style-src 'self';                         feuilles de style du site, pas d'attribut style="…"
img-src 'self' data:;                     images du site et petits dessins intégrés à la feuille de style
font-src 'self';                          police Archivo hébergée avec le site
form-action 'self';                       un formulaire ne peut être envoyé qu'au site lui-même
frame-ancestors 'none';                   aucun site ne peut nous afficher dans un cadre
base-uri 'none';
upgrade-insecure-requests
```

### Aucun script ni style inline

Depuis la refonte ([ADR 0008](../architecture/adr/0008-site-vitrine-astro.md)), Astro écrit chaque script et chaque feuille de style dans un fichier séparé (`dist/ressources/`) : la politique n'a besoin d'aucune empreinte ni d'exception. Les seuls blocs `<script>` restant dans les pages sont des données structurées (`application/ld+json`), que le navigateur n'exécute pas.

Un attribut `style="…"`, un `onclick="…"`, une balise `<style>` ou un fichier chargé depuis un autre site seraient bloqués en ligne. Après toute modification :

```bash
npm run build -w @dbs/site-vitrine && node scripts/verifier-site.mjs
npm run test:navigateur -w @dbs/site-vitrine
```

Le premier contrôle lit les pages construites ; le second les ouvre dans Chromium avec ces en-têtes (`tests/serveur.mjs`) et échoue à la moindre violation. Netlify et l'intégration continue refusent la publication tant que ce n'est pas corrigé.

### Hébergeur sans fichier `_headers`

Sur un hébergeur classique (Apache), demander l'équivalent dans la configuration du serveur ou dans un fichier `.htaccess`, avec exactement les mêmes valeurs.

## Vérifier en ligne

Après chaque mise en ligne : [Mozilla Observatory](https://developer.mozilla.org/fr/observatory) doit donner la note A ou mieux.

## Après le choix du domaine

Une fois le site stable en HTTPS depuis quelques semaines, ajouter `; preload` à `Strict-Transport-Security` et inscrire le domaine sur [hstspreload.org](https://hstspreload.org).
