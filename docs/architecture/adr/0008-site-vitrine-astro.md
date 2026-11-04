# 0008 — Site vitrine en plusieurs pages, construit par Astro, sans aucun script tiers

- Statut : Acceptée
- Date : 2026-11-04

## Contexte

Le site vitrine tenait en une seule page HTML écrite à la main (19 écrans sur téléphone), avec ses coordonnées recopiées 23 fois et un script qui gérait à la fois le menu, les animations et le formulaire. L'audit UX ([audit de novembre 2026](../../audit/2026-11-audit-ux-site.md)) a montré qu'un particulier, un transporteur et une personne qui vient d'avoir un accident devaient tous parcourir la même page, et qu'aucune page ne pouvait être référencée pour « assurance flotte Abidjan » ou « déclarer un sinistre ».

Contraintes :

- Le site doit rester **statique** : aucun serveur à maintenir, publication gratuite sur Netlify ou Cloudflare Pages.
- La politique de sécurité du contenu doit rester **stricte** : aucun script ni style inline, aucune ressource tierce ([en-têtes HTTP](../../securite/en-tetes-http.md)).
- Les visiteurs sont surtout sur téléphone, souvent en 3G : le moins de JavaScript possible.
- La tâche 7 fera envoyer le formulaire à l'API : il faut un outil de construction qui sache injecter une adresse d'API au moment de la publication.
- Une personne de l'agence doit pouvoir changer un numéro de téléphone sans connaître le code.

## Décision

1. **Astro 7**, en génération statique (`output: "static"`), dans l'espace de travail npm `@dbs/site-vitrine`. Seul `apps/site-vitrine/dist` est publié ; `netlify.toml` construit puis vérifie le site avant chaque mise en ligne.
2. **Neuf pages** organisées par public et par urgence : accueil, particuliers, professionnels, flottes et transport, sinistre, l'agence, questions fréquentes, devis, mentions légales (et la page 404).
3. **Une source unique pour chaque information** : `src/donnees/agence.ts` (coordonnées, identité juridique), `offres.ts` (assurances, garanties, pièces à fournir, dont les identifiants sont ceux de la base), `faq.ts`, `navigation.ts`. Changer le téléphone se fait à un seul endroit.
4. **Zéro JavaScript par défaut** : seuls le menu mobile et le formulaire de devis ont un script, chacun dans son fichier (`src/scripts/`). Astro est configuré pour écrire tous les scripts et styles dans des fichiers séparés (`build.inlineStylesheets: "never"`, `assetsInlineLimit: 0`) : la CSP n'a besoin d'aucune empreinte.
5. **Adresses absolues seulement si l'adresse du site est connue** (`URL_SITE`, ou `URL` fournie par Netlify) : adresse canonique, aperçus de liens, `sitemap.xml`. Une adresse inventée serait pire qu'aucune.
6. **Vérifié à chaque modification** : `scripts/verifier-site.mjs` lit les pages construites (liens, images, CSP, référencement, secrets) ; des tests Playwright ouvrent chaque page avec les vrais en-têtes de sécurité, sur ordinateur et téléphone, avec une analyse d'accessibilité WCAG 2.1 AA (axe-core) et le parcours complet du devis.

## Conséquences

- Il faut Node.js pour construire le site ; la mise en ligne par glisser-déposer vise désormais `apps/site-vitrine/dist` après `npm run build -w @dbs/site-vitrine`, et non plus le dossier source (précision apportée à l'[ADR 0001](0001-depot-unique.md)).
- Le poids des pages baisse (une page ne charge que ce qui la concerne) et chaque public a son adresse, partageable sur WhatsApp et référençable.
- Astro est une dépendance de développement seulement : rien de lui n'est exécuté chez le visiteur, hormis nos deux petits scripts.

## Options écartées

- **Garder le HTML écrit à la main** en le découpant en pages : en-tête, pied de page et coordonnées recopiés dans chaque fichier, exactement le défaut relevé par l'audit.
- **Next.js, Nuxt ou une application React** : un framework d'interface chargé chez chaque visiteur pour des pages qui n'en ont pas besoin, et des scripts inline difficiles à éviter.
- **Un CMS (WordPress)** : un serveur et une base à maintenir et à sécuriser, pour un site qui change rarement.
- **Eleventy** : adapté aussi, mais sans composants typés ni gestion intégrée des scripts ; Astro vérifie les propriétés des composants et regroupe les scripts sans configuration.
