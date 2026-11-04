# Site web DBS-ASSURANCES

Site vitrine de DBS-ASSURANCES, Agent Général SanlamAllianz Côte d'Ivoire (code agence 2623), Yopougon, Abidjan.

Les pages sont écrites avec [Astro](https://astro.build) puis **construites** en simples fichiers HTML (dossier `dist/`). Aucun serveur ni base de données n'est nécessaire en ligne. Seul `dist/` est publié : le reste du dépôt (documentation, base de données, API) ne doit jamais être mis sur l'hébergeur. Les raisons de ce choix : [ADR 0008](../../docs/architecture/adr/0008-site-vitrine-astro.md).

## Les pages

| Adresse | Pour qui | Fichier |
| --- | --- | --- |
| `/` | Tout le monde : à qui s'adresse l'agence, comment ça se passe, urgence sinistre | `src/pages/index.astro` |
| `/particuliers/` | Auto, moto, habitation, responsabilité civile, individuelle accident | `src/pages/particuliers.astro` |
| `/professionnels/` | Commerces, PME, chantiers, industrie, agricole, événementiel | `src/pages/professionnels.astro` |
| `/flottes/` | Transporteurs et entreprises avec plusieurs véhicules | `src/pages/flottes.astro` |
| `/sinistre/` | Les bons réflexes et les documents après un accident, un vol, un incendie | `src/pages/sinistre.astro` |
| `/agence/` | Rôle d'Agent Général, identité, coordonnées, « vérifier que c'est bien nous », réclamations | `src/pages/agence.astro` |
| `/questions-frequentes/` | Questions fréquentes | `src/pages/questions-frequentes.astro` |
| `/devis/` | Formulaire de devis en trois étapes | `src/pages/devis.astro` |
| `/mentions-legales/` | Mentions légales et données personnelles | `src/pages/mentions-legales.astro` |

## Modifier une information

Chaque information n'est écrite qu'**à un seul endroit**, dans `src/donnees/` :

| Pour changer… | Fichier |
| --- | --- |
| Téléphone, WhatsApp, e-mail, adresse, horaires, RCCM, agrément, hébergeur | `src/donnees/agence.ts` |
| Une assurance : description, garanties, ce qu'il faut préciser, pièces à fournir | `src/donnees/offres.ts` |
| Une question fréquente | `src/donnees/faq.ts` |
| Le menu | `src/donnees/navigation.ts` |
| Couleurs, espacements, polices | `src/styles/global.css` (variables en haut du fichier) |

Exemple : pour changer de numéro, modifiez `telephone` et `whatsapp` dans `src/donnees/agence.ts` ; tous les boutons, liens et textes du site suivent.

Ne mettez ni attribut `style="…"`, ni `onclick="…"`, ni image ou police chargée depuis un autre site : les en-têtes de sécurité (`public/_headers`) les bloqueraient en ligne. Les scripts vont dans `src/scripts/`.

## Voir le site sur son ordinateur

Il faut [Node.js](https://nodejs.org) 22 ou plus récent. Depuis la racine du dépôt :

```bash
npm ci                                  # une fois
npm run dev -w @dbs/site-vitrine        # aperçu qui se met à jour à chaque modification : http://localhost:4321
```

## Vérifier avant de publier

```bash
npm run build -w @dbs/site-vitrine && node scripts/verifier-site.mjs   # liens, images, sécurité, secrets
npm run test:navigateur -w @dbs/site-vitrine                           # chaque page dans Chromium
```

Le premier contrôle lit les pages construites. Le second les ouvre dans un vrai navigateur, sur ordinateur et sur téléphone, avec les en-têtes de sécurité : erreurs, accessibilité (WCAG 2.1 AA), débordement sur petit écran, menu mobile et parcours complet du devis. Au premier lancement : `npx playwright install chromium`.

## À compléter avant la mise en ligne

1. **N° d'agrément ou de carte professionnelle** et **hébergeur** : `src/donnees/agence.ts`, bloc `juridique`. Tant qu'ils sont vides, les mentions légales affichent « À compléter ».
2. **Horaires d'ouverture** : `src/donnees/agence.ts`, champ `horaires`.
3. Vérifier que le **+225 07 49 36 07 02 est bien sur WhatsApp** : les boutons WhatsApp l'utilisent.
4. Faire valider l'usage du **logo SanlamAllianz** par la compagnie, si votre mandat l'exige.

## Mettre le site en ligne

- **Netlify relié à GitHub (recommandé)** : connectez le dépôt dans Netlify. Le fichier `netlify.toml`, à la racine du dépôt, construit le site, le vérifie et ne publie que `apps/site-vitrine/dist`. Netlify fournit l'adresse du site : adresse canonique, aperçus de liens WhatsApp et Facebook, `sitemap.xml` et `robots.txt` s'en servent automatiquement.
- **Autre hébergeur** : construisez le site avec `URL_SITE=https://www.votre-domaine.ci npm run build -w @dbs/site-vitrine`, puis envoyez le **contenu de `dist/`**. Sans fichier `_headers` lu par l'hébergeur, demandez-lui d'appliquer les mêmes en-têtes (voir `docs/securite/en-tetes-http.md`).
- **Nom de domaine** : par exemple en .ci (auprès d'un registraire agréé) ou en .com.

Après la mise en ligne, créez une fiche **Google Business Profile** « DBS-ASSURANCES » à Yopougon, avec le lien du site : c'est ce qui vous rend visible dans Google Maps.

## Contenu du dossier

| Dossier | Rôle |
| --- | --- |
| `src/pages/` | Une page par fichier ; l'adresse suit le nom du fichier |
| `src/composants/` | En-tête, pied de page, blocs réutilisés (offre, questions, appel final) |
| `src/donnees/` | Coordonnées, offres, questions, menu, icônes |
| `src/scripts/` | Menu mobile et formulaire de devis |
| `src/styles/global.css` | Toute la mise en forme (bleu `#203888` et or `#F8C020`, tirés du logo) |
| `public/` | Fichiers copiés tels quels : images, police Archivo (licence OFL), `_headers`, `.well-known/security.txt` (à renouveler avant novembre 2027) |
| `tests/` | Tests dans le navigateur et petit serveur qui reproduit l'hébergeur |
