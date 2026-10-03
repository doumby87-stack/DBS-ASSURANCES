# Site web DBS-ASSURANCES

Site vitrine de DBS-ASSURANCES, Agent Général SanlamAllianz Côte d'Ivoire (code agence 2623), Yopougon, Abidjan.
Le site fonctionne sans base de données ni logiciel à installer : ce sont de simples fichiers.

## Voir le site

Double-cliquez sur `index.html` : il s'ouvre dans votre navigateur.

Dans cet aperçu local, Chrome et Edge bloquent la police Archivo et affichent une police de remplacement. Elle s'affiche normalement une fois le site en ligne.

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page d'accueil : assurances, flottes, risques d'entreprise, étapes, sinistre, questions, devis |
| `mentions-legales.html` | Mentions légales, réclamations et données personnelles |
| `assets/css/style.css` | Couleurs et mise en page (bleu `#203888`, or `#F8C020`, tirés du logo) |
| `assets/js/main.js` | Menu mobile, bouton WhatsApp flottant et formulaire de devis (envoi par WhatsApp ou e-mail) |
| `assets/img/` | Logo DBS (version normale et version blanche), logo SanlamAllianz Agent Général, icônes, image d'aperçu |
| `assets/fonts/` | Police Archivo, hébergée avec le site (licence libre OFL, voir `OFL.txt`) |

Si vous remplacez une image, gardez un fichier léger : les logos sont enregistrés au double de leur taille d'affichage (480 pixels de large), ce qui suffit pour les écrans haute définition.

## Modifier une information

Ouvrez le fichier avec le Bloc-notes (clic droit > Ouvrir avec) ou un éditeur comme VS Code, puis utilisez Ctrl+F.

- **Téléphone** : cherchez `07 49 36 07 02` et `2250749360702` dans `index.html`, `mentions-legales.html` et `assets/js/main.js`.
- **E-mail** : cherchez `dbs.conseils1@gmail.com` dans les mêmes fichiers.
- **Textes** : modifiez directement les phrases dans `index.html`.

## À compléter avant la mise en ligne

1. **N° d'agrément ou de carte professionnelle** dans `mentions-legales.html` (repère « À compléter »).
2. **Hébergeur** (nom, adresse, téléphone) dans `mentions-legales.html`.
3. Vérifier que le **+225 07 49 36 07 02 est bien sur WhatsApp** : les boutons WhatsApp l'utilisent.
4. Ajouter vos **horaires d'ouverture** si vous souhaitez les afficher.
5. Faire valider l'usage du **logo SanlamAllianz** par la compagnie, si votre mandat l'exige.

## Mettre le site en ligne

- **Netlify (gratuit)** : créez un compte sur netlify.com, puis glissez-déposez le dossier `site-dbs-assurances` sur app.netlify.com/drop.
- **Hébergeur classique** : envoyez le contenu du dossier par FTP dans le répertoire public (souvent `www` ou `public_html`).
- **Nom de domaine** : par exemple en .ci (auprès d'un registraire agréé) ou en .com.

Après la mise en ligne :

- Dans `index.html`, remplacez `assets/img/og-image.png` (balise `og:image`) par l'adresse complète, par exemple `https://www.votre-domaine.ci/assets/img/og-image.png`. L'aperçu du lien s'affichera alors correctement quand vous le partagerez sur WhatsApp ou Facebook.
- Créez une fiche **Google Business Profile** « DBS-ASSURANCES » à Yopougon, avec le lien du site : c'est ce qui vous rend visible dans Google Maps.
