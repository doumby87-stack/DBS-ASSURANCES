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
| `/rendez-vous/` | Demande de rendez-vous : motif, lieu, jour ouvré et demi-journée ; l'agence confirme l'heure | `src/pages/rendez-vous.astro` |
| `/rappel-echeance/` | Rappel gratuit un mois avant l'échéance de l'assurance actuelle, ou rappel ajouté à son agenda | `src/pages/rappel-echeance.astro` |
| `/appel-offres/` | Assistant « appel d'offres » : marché, assurances exigées, pièces à préparer et date d'envoi du dossier | `src/pages/appel-offres.astro` |
| `/mentions-legales/` | Mentions légales et données personnelles | `src/pages/mentions-legales.astro` |

## Modifier une information

Chaque information n'est écrite qu'**à un seul endroit**, dans `src/donnees/` :

| Pour changer… | Fichier |
| --- | --- |
| Téléphone, WhatsApp, e-mail, adresse, horaires, RCCM, agrément, hébergeur | `src/donnees/agence.ts` |
| Texte des cases d'accord du formulaire | `src/donnees/formulaire.ts` |
| Outils (rappel, appel d'offres, rendez-vous) : assurances proposées, garanties et pièces à préparer, délai du dossier d'appel d'offres, motifs, jours fériés | `src/donnees/outils.ts` |
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

Le premier contrôle lit les pages construites. Le second construit deux versions du site (telle quelle, et reliée à une API fictive) et les ouvre dans un vrai navigateur, sur ordinateur et sur téléphone, avec les en-têtes de sécurité : erreurs, accessibilité (WCAG 2.1 AA), débordement sur petit écran, menu mobile, parcours complet du devis par WhatsApp et par enregistrement (carte grise, refus, coupure de connexion). Au premier lancement : `npx playwright install chromium`.

## À compléter avant la mise en ligne

1. **N° d'agrément ou de carte professionnelle** et **hébergeur** : `src/donnees/agence.ts`, bloc `juridique`. Tant qu'ils sont vides, les mentions légales affichent « À compléter ».
2. **Horaires d'ouverture** : `src/donnees/agence.ts`, champ `horaires`.
3. Vérifier que le **+225 07 49 36 07 02 est bien sur WhatsApp** : les boutons WhatsApp l'utilisent.
4. Faire valider l'usage du **logo SanlamAllianz** par la compagnie, si votre mandat l'exige.

## Activer l'enregistrement des demandes de devis (tâche 7)

Par défaut, le formulaire prépare un message que le visiteur envoie lui-même sur WhatsApp ou par e-mail : rien n'est enregistré. Le formulaire peut aussi **enregistrer la demande** dans l'outil de l'agence, avec la carte grise et l'accord pour les rappels WhatsApp ([ADR 0009](../../docs/architecture/adr/0009-demandes-de-devis-du-site.md)). À faire **seulement après la déclaration à l'ARTCI** :

1. Dans l'API, définir `URL_SITE_VITRINE` avec l'adresse du site (par exemple `https://www.votre-domaine.ci`).
2. Dans Netlify (Site configuration > Environment variables), définir `URL_API` avec l'adresse de l'API (par exemple `https://gestion.votre-domaine.ci/api`), puis relancer la mise en ligne.

La construction ajoute alors l'API aux en-têtes de sécurité (`connect-src`), affiche le champ de la carte grise et la case des rappels, et met à jour les textes du formulaire et des mentions légales. Les outils (rappel d'échéance, appel d'offres, rendez-vous) enregistrent alors eux aussi leurs demandes ([ADR 0014](../../docs/architecture/adr/0014-outils-du-site.md)) : les rappels et appels d'offres arrivent dans « Demandes du site », les rendez-vous dans « Rendez-vous ». Les demandes arrivent dans l'écran « Demandes du site » du back-office. Pour revenir en arrière, il suffit de retirer `URL_API` et de relancer la mise en ligne.

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
