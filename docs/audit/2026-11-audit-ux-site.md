# Audit UX du site vitrine — novembre 2026

Revue de l'expérience des visiteurs du site, après l'[audit technique](2026-11-audit-du-site.md). Méthode : parcours des quatre visiteurs types sur ordinateur (1 440 px) et sur téléphone (390 px), avec relevé des écrans, des clics et des points de friction.

Les quatre visiteurs types :

| Visiteur | Ce qu'il vient faire | Ce qui compte pour lui |
| --- | --- | --- |
| **Particulier** | Assurer sa voiture, sa moto ou son logement | Le prix, les pièces à fournir, être rappelé vite |
| **Commerçant, PME** | Assurer ses locaux, répondre à un appel d'offres | Être conseillé, un interlocuteur qui connaît son activité |
| **Transporteur** | Assurer une flotte de 5 à 200 véhicules | Les attestations en lot, ne jamais rouler sans assurance |
| **Assuré qui vient d'avoir un sinistre** | Savoir quoi faire, tout de suite | Un numéro, les bons réflexes, les papiers à préparer |

## Constats sur l'ancien site

| # | Constat | Effet sur le visiteur |
| --- | --- | --- |
| 1 | **Une seule page** de 19 écrans sur téléphone (15 750 px), 8 760 px sur ordinateur. | Le particulier traverse les flottes et l'industrie avant de trouver le devis ; le transporteur, l'inverse. |
| 2 | **Aucune page par public.** | Impossible de partager « la page flottes » sur WhatsApp, ou d'être trouvé sur Google pour « assurance flotte Abidjan » ou « déclarer un sinistre ». |
| 3 | **Treize assurances présentées à égalité**, en cartes identiques. | Rien ne guide : l'automobile, obligatoire et la plus demandée, a le même poids que l'assurance événementielle. |
| 4 | **Le sinistre est enfoui** au 14ᵉ écran sur téléphone. | La personne la plus pressée est celle qui cherche le plus longtemps. |
| 5 | **Formulaire de devis en un seul bloc** de neuf champs, avec une liste déroulante de 13 assurances. | Long sur téléphone ; la liste déroulante masque les choix. |
| 6 | **Coordonnées recopiées 23 fois** dans le HTML et le script. | Un changement de numéro oublié à un endroit envoie des clients vers un mauvais numéro. |
| 7 | **Pas de preuve d'identité** de l'agence en dehors des mentions légales. | Dans un marché où circulent de faux agents et de fausses attestations, le visiteur ne peut pas vérifier qu'il est au bon endroit. |
| 8 | **Bouton WhatsApp flottant** comme seul raccourci sur téléphone. | Pas d'accès direct à l'appel ni au devis depuis le bas de l'écran. |
| 9 | **Aspect « modèle de site »** : sections de même structure, peu de hiérarchie, aucune mise en scène du service (rappels, attestations). | Le site ne montre pas ce qui distingue l'agence : le suivi. |
| 10 | **Pas de fil d'Ariane, pas de page « l'agence »**, réclamations seulement dans les mentions légales. | Le visiteur ne sait pas à qui il a affaire ni comment se plaindre. |

## Ce que fait le nouveau site

| # | Correction |
| --- | --- |
| 1, 2 | **Neuf pages** : accueil, particuliers, professionnels, flottes et transport, sinistre, l'agence, questions fréquentes, devis, mentions légales. Accueil ramené à 11 écrans sur téléphone (10 940 px) et 6 590 px sur ordinateur, et chaque visiteur va directement à sa page. |
| 3 | **Chaque public voit d'abord ses assurances**, avec les garanties, ce qu'il faut préciser pour le devis et les pièces à fournir. Les risques d'entreprise (chantier, industrie, agricole, événementiel) sont présentés comme ils sont réellement traités : sur questionnaire. |
| 4 | **Sinistre accessible partout** : bandeau du haut sur toutes les pages, bloc d'urgence sur l'accueil, barre d'actions sur téléphone. La page sinistre commence par « Appeler » et « Déclarer sur WhatsApp », puis les bons réflexes et les documents selon la situation. |
| 5 | **Devis en trois étapes** (le besoin, les détails, les coordonnées) avec des choix en cartes, une aide qui dépend de l'assurance choisie, un récapitulatif avant l'envoi et des messages d'erreur précis. Depuis une page d'offre, l'assurance est déjà sélectionnée. |
| 6 | **Une seule source** pour chaque information (`src/donnees/`) : coordonnées, offres, questions. |
| 7 | **« Vérifier que c'est bien nous »** sur la page de l'agence : seuls numéros officiels, paiement uniquement par les canaux de l'agence, reçu numéroté, QR code de l'attestation. Identité juridique complète (RCCM, compte contribuable, code agence). |
| 8 | **Barre d'actions fixe sur téléphone** : appeler, WhatsApp, devis (ou sinistre sur la page devis). |
| 9 | **Nouvelle identité visuelle** tirée du logo (bleu marine, or), typographie Archivo resserrée, mise en scène d'un rappel WhatsApp et d'une attestation, cartes de suivi de flotte, sections alternées. |
| 10 | **Fil d'Ariane** sur chaque page, **page « l'agence »** (rôle d'Agent Général, identité, coordonnées, réclamations). |

## Accessibilité et performance

- **WCAG 2.1 AA** vérifiée automatiquement sur chaque page, sur ordinateur et téléphone (axe-core, aucune violation) : contrastes, noms accessibles, structure des titres, formulaires.
- Navigation complète au clavier : lien d'évitement, menu mobile qui garde le focus et se ferme avec Échap, étapes du devis annoncées et focalisées.
- Mouvements réduits respectés (`prefers-reduced-motion`), impression lisible.
- Aucune page ne déborde à 360 px de large.
- Deux petits scripts seulement (menu, devis), aucune ressource tierce, police hébergée avec le site.

## Reste à faire par l'agence

| Point | Où |
| --- | --- |
| Horaires d'ouverture | `src/donnees/agence.ts`, champ `horaires` |
| N° d'agrément et hébergeur | `src/donnees/agence.ts`, champ `juridique` (repères « À compléter » des mentions légales) |
| Photos réelles de l'agence et de l'équipe | Une photo de l'accueil ou de l'équipe renforce la confiance mieux que toute illustration |
| Avis clients | Fiche Google Business Profile, puis lien depuis le site |
