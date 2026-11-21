# 0015 — Lecture automatique des documents : gratuite, sur les serveurs de l'agence, toujours validée par une personne

- Statut : Acceptée
- Date : 2026-11-21

## Contexte

Le personnel recopie à la main la carte grise d'un véhicule, la pièce d'identité d'un client (identification, [ADR 0013](0013-conformite-et-pilotage.md)) et le constat amiable d'un sinistre. C'est long, et une immatriculation ou un numéro de châssis mal recopié se retrouve sur l'attestation.

La tâche 14 prévoit de lire ces trois documents pour pré-remplir les fiches, **toujours validée par une personne**.

Contraintes :

- **pas d'abonnement ni de paiement à l'usage** : l'agence veut un outil gratuit ;
- les documents sont des photos de qualité variable : cartes grises, CNI, passeports, constats remplis à la main ;
- ce sont des données personnelles ; le numéro de la pièce d'identité est chiffré en base ([classification](../../securite/classification-des-donnees.md)). Les envoyer à un service étranger demanderait l'autorisation de l'ARTCI et un contrat de sous-traitance ;
- un document reçu d'un client peut être piégé (fichier malveillant, texte écrit pour tromper l'outil) ;
- l'agence est petite : pas de carte graphique, pas d'équipe pour entraîner un modèle.

Une première version passait par un modèle payant, à l'étranger. Elle a été abandonnée pour la solution ci-dessous.

## Décision

1. **Un lecteur interchangeable, deux réalisations gratuites, aucune donnée chez un tiers :**
   - **`local`**, recommandé : reconnaissance de caractères par **Tesseract**, logiciel libre (licence Apache 2.0). Il est compilé en WebAssembly (`tesseract.js`) et tourne dans l'API, avec le modèle français livré par npm. Aucun appel réseau, aucun fichier écrit, rien à installer de plus. Une photo se lit en une à quelques secondes.
   - **`ollama`**, facultatif : un **modèle de vision ouvert**, à licence libre, installé avec Ollama (logiciel libre) sur une machine de l'agence. Plus « intelligent » : il lit aussi l'écriture à la main, donc le constat. Il demande une machine puissante (16 Go de mémoire au moins ; une carte graphique rend la lecture bien plus rapide). Sa réponse est imposée par le schéma JSON du document (sortie structurée).

   Sans `LECTURE_PRESTATAIRE`, la lecture n'existe pas : le back-office cache le panneau et tout se saisit à la main.
2. **L'intelligence du lecteur local est dans l'analyse du texte reconnu**, pas dans un service payant :
   - les libellés sont retrouvés malgré les accents et une faute de reconnaissance par mot ;
   - une valeur peut être sur la même ligne que son libellé ou sur la suivante ;
   - les valeurs qui ont une forme connue sont cherchées d'après cette forme et corrigées des confusions habituelles (O et 0, I et 1…) : immatriculation ivoirienne, numéro de châssis (17 caractères, sans I, O ni Q), dates ;
   - les codes sont traduits : genre (VP → voiture particulière), énergie, nationalité (CIV → ivoirienne) ;
   - la **zone lisible par machine** (MRZ) des passeports et des cartes d'identité est retrouvée en bas du document. Chaque caractère est remis dans la catégorie attendue à sa position (un O dans une date devient 0). Le numéro est corrigé si un seul échange de caractères qui se ressemblent rend son chiffre de contrôle juste (norme OACI 9303). Une zone juste fait foi pour le numéro et les dates.

   Un PDF n'est lu que s'il contient la photo du document (JPEG, cas des scanners et des téléphones). Le constat manuscrit n'est lu qu'en partie par le lecteur local (date, heure, lieu, immatriculations), et c'est dit à la personne.
3. **Des contrôles indépendants du lecteur**, calculés par l'API et montrés à la personne :
   - pièce expirée ;
   - zone lisible par machine qui confirme ou contredit le numéro et les dates ;
   - numéro de châssis, forme de l'immatriculation, dates dans le futur ;
   - document non reconnu, lecture partielle ;
   - constat : un seul véhicule lu, blessés déclarés.
4. **Rien n'est enregistré par la lecture.** Le back-office pré-remplit le formulaire. Les champs remplis restent surlignés jusqu'à ce que la personne les vérifie avec le document et enregistre elle-même. Pour un constat, un résumé s'ajoute à la note interne du sinistre ; il n'est enregistré que par « Enregistrer le suivi ». Les valeurs lues ne sont gardées ni par l'API ni dans ses journaux.
5. **Antivirus d'abord.**
   - Une photo envoyée pour la lecture est analysée par ClamAV avant d'être lue.
   - Une pièce déjà enregistrée (justificatif, photo d'un sinistre, carte grise d'une demande du site) n'est lue que si son analyse l'a déclarée saine ; elle est déchiffrée et son empreinte vérifiée.
   - Une image démesurée une fois décodée (plus de 60 millions de pixels) est refusée d'après son en-tête, avant d'être décodée.
   - L'image est ensuite décodée dans le bac à sable WebAssembly de Tesseract. Une image que le moteur ne sait pas décoder est refusée sans arrêter l'API.
6. **Droits.** La carte grise : gérant, chargé de clientèle et commercial. La pièce d'identité et le constat : gérant et chargé de clientèle. Ce sont les rôles qui saisissent ces fiches ([contrôle des accès](../../securite/controle-des-acces.md)).
7. **Traçabilité et charge.** Chaque lecture est consignée au journal de sécurité (`lecture_automatique`) : qui, quand, quel document de quel client, jamais les valeurs. **30 lectures par heure et par personne au plus**, compté sur ce journal, pour ménager le serveur et empêcher une lecture en masse.
8. **Ollama, s'il est choisi :**
   - le modèle est un réglage obligatoire (`LECTURE_MODELE`), choisi par l'exploitant et noté au registre des traitements ;
   - Ollama n'ayant pas d'authentification, l'API refuse en production une adresse en HTTP hors de la machine même ou du réseau privé de l'agence ;
   - la machine d'Ollama ne doit pas être joignable depuis Internet ;
   - une machine éteinte ou un modèle absent se signale clairement, et la personne saisit à la main.

## Conséquences

- La saisie d'une carte grise ou d'une pièce d'identité se fait en quelques secondes, sans coût par lecture. La zone lisible par machine attrape et corrige une partie des erreurs de lecture.
- **Aucun transfert hors de Côte d'Ivoire ni nouveau sous-traitant** : les images restent sur les serveurs de l'agence. Le traitement reste celui de la gestion des clients, déjà déclaré.
- Le lecteur local lit bien les documents imprimés nets. Il lit moins bien une photo floue, penchée ou avec un reflet, et presque pas l'écriture à la main. La personne le voit : lecture « partielle » ou « difficile », champs vides. Le lecteur Ollama comble cet écart, si l'agence a la machine pour cela.
- Les règles d'analyse ont été écrites sans vraie carte grise ivoirienne sous les yeux. Il faudra les ajuster avec quelques documents réels de l'agence (tâche 11), sans les publier.
- Le personnel doit garder le réflexe de vérifier : l'outil le rappelle à chaque lecture, et les champs pré-remplis restent surlignés. À inclure dans la formation (tâche 11).
- Deux dépendances de production de plus pour l'API (`tesseract.js` et le modèle français `@tesseract.js-data/fra`). Elles apportent une douzaine de petits paquets, verrouillés dans `package-lock.json` et suivis par Dependabot et `npm audit`.

## Options écartées

- **Modèle payant chez un fournisseur étranger** : le plus précis, y compris sur l'écriture à la main, mais payé à chaque lecture. Il demandait aussi l'autorisation de transfert de l'ARTCI et un contrat de sous-traitance. Écarté à la demande de l'agence.
- **Offres « gratuites » des grands services d'intelligence artificielle** : quotas variables, et les documents envoyés peuvent servir à améliorer leurs modèles. Inacceptable pour des pièces d'identité.
- **Lecture dans le navigateur** (Tesseract dans la page) : il aurait fallu assouplir la politique de sécurité du contenu (WebAssembly, fils d'exécution) et télécharger plusieurs mégaoctets à chaque poste. Écarté.
- **Enregistrement automatique des valeurs lues** : une erreur de lecture finirait sur une attestation ou dans une fiche d'identification. La tâche exige une validation humaine.
- **Lecture dès la réception** (toutes les cartes grises des demandes du site, toutes les pièces d'un sinistre) : du calcul pour des documents que personne n'a demandé à lire. La lecture se fait à la demande, document par document.
