# Audit du site — novembre 2026

Relecture complète du site vitrine (`apps/site-vitrine`), de sa documentation et de ce qu'il promet aux clients.

## Corrigé dans cette tâche

| # | Constat | Risque | Correction |
| --- | --- | --- | --- |
| 1 | Le site était à la racine du dépôt. | Tout ce qu'on ajoute au dépôt (documentation de sécurité, schéma de la base, scripts) aurait été publié en ligne avec lui. | Site déplacé dans `apps/site-vitrine`, seul dossier publié (`netlify.toml`). |
| 2 | Le guide demandait de glisser-déposer un dossier `site-dbs-assurances` qui n'existait pas. | Mise en ligne ratée ou de mauvais fichiers. | Guide corrigé. |
| 3 | Aucun en-tête de sécurité HTTP. | Site affichable dans un cadre piège (clickjacking), injection de script facilitée, connexion non chiffrée possible. | `_headers` : politique de contenu stricte, HTTPS imposé, cadres interdits. Testé dans Chromium. |
| 4 | Polices chargées depuis Google Fonts. | Adresse IP des visiteurs envoyée à un tiers, et impossible d'avoir une politique de contenu stricte. | Police hébergée avec le site ¹. |
| 5 | Pages blanches à l'impression ; contenu invisible si le script ne se charge pas ; bouton WhatsApp qui couvre le formulaire sur mobile ; images lourdes (260 Ko). | Mauvaise expérience, surtout sur les connexions lentes. | Corrigé ¹. Images ramenées à 66 Ko. |
| 6 | Le formulaire acceptait les anciens numéros à 8 chiffres. | Numéros injoignables depuis le passage à 10 chiffres (2021). | 10 chiffres exigés, ou numéro étranger commençant par `+`. |
| 7 | Champs du formulaire sans longueur maximale. | Message trop long pour WhatsApp ou la messagerie, qui échoue sans prévenir. | Longueurs limitées. |
| 8 | Pas de page 404, de `robots.txt` ni de contact de sécurité. | Page d'erreur brute ; personne à prévenir en cas de faille trouvée. | Ajoutés (`404.html`, `robots.txt`, `.well-known/security.txt`). |
| 9 | Rien n'aidait le client à reconnaître une arnaque. | Fausses attestations, faux numéros de paiement au nom de l'agence. | Question ajoutée à la FAQ : vérifier le QR code, payer seulement par les canaux de l'agence, exiger un reçu. |
| 10 | Aucune vérification avant publication. | Un lien cassé ou un script bloqué passe inaperçu. | `scripts/verifier-site.mjs`, lancé par Netlify et par l'intégration continue. |

¹ Corrections préparées lors d'une session précédente sur la branche `claude/magical-cori-wmv30p`, jamais fusionnées, reprises ici.

## À décider par l'agence

Ces points touchent à des engagements ou à des informations que seule l'agence peut valider. Rien n'a été modifié sur le site.

| # | Constat | Proposition |
| --- | --- | --- |
| 11 | **« À compléter » visible en ligne** dans les mentions légales (n° d'agrément, hébergeur). | Bloquant avant la mise en ligne. Compléter (tâche 2). |
| 12 | **Le site promet des services que rien n'outille encore** : « nous surveillons les échéances à votre place », « attestations en lot », « facture détaillée ». Aujourd'hui, tout repose sur la mémoire et Excel. | Une promesse non tenue devient une réclamation. Les tâches 4, 5 et 8 donnent les outils correspondants ; les prioriser. |
| 13 | **« Rien n'est enregistré sur ce site »** : vrai aujourd'hui, faux dès que le formulaire enregistrera les demandes. | Changer ce texte et les mentions légales le jour de la tâche 7, après la déclaration à l'ARTCI. |
| 14 | **« Paiement Mobile Money »** sans dire sur quel compte. | Ouvrir un compte marchand au nom de la société et l'indiquer comme seul canal officiel. Un numéro personnel facilite les usurpations. |
| 15 | **Adresse Gmail** comme adresse officielle. | N'importe qui peut créer une adresse Gmail ressemblante. Une adresse au nom de domaine de l'agence, protégée par SPF, DKIM et DMARC, est vérifiable. |
| 16 | **Réclamations** : ni délai de réponse, ni recours indiqué. | Les grands assureurs publient un parcours en trois niveaux. Proposition : accusé de réception sous 2 jours ouvrés, réponse sous 10 jours ouvrés ; à défaut, SanlamAllianz ; en dernier recours, la Direction des Assurances. À valider avant publication. |
| 17 | **Plafond d'espèces de 1 000 000 F CFA par police** : la source réglementaire précise n'est pas citée. | La base de données applique ce plafond. Faire confirmer le texte par SanlamAllianz. |
| 18 | Adresses de `og:image`, du logo et de l'image dans les données structurées relatives. | À rendre absolues une fois le nom de domaine choisi, pour que l'aperçu des liens partagés fonctionne. |
| 19 | Horaires d'ouverture absents. | À ajouter sur le site et dans la fiche Google Business Profile. |
| 20 | Usage du logo SanlamAllianz. | Faire valider par la compagnie si le mandat l'exige. |

## Points vérifiés sans problème

- Accessibilité : lien d'évitement, libellés des champs, messages d'erreur annoncés, respect de la réduction des animations.
- Liens qui ouvrent un nouvel onglet protégés (`rel="noopener"`).
- Mentions CIMA citées (art. 13 et 200) cohérentes avec le Code.
- Aucun secret ni clé d'API dans les fichiers du site.
