# 0014 — Outils du site : rappel d'échéance gratuit, assistant « appel d'offres », prise de rendez-vous

- Statut : Acceptée (estimation indicative en attente de SanlamAllianz ; délai du dossier d'appel d'offres à confirmer)
- Date : 2026-11-06

## Contexte

Le site présente l'agence et reçoit des demandes de devis ([ADR 0009](0009-demandes-de-devis-du-site.md)). Mais un visiteur déjà assuré ailleurs n'a aucune raison de demander un devis aujourd'hui, et une entreprise qui répond à un appel d'offres ne sait souvent pas quelles assurances le cahier des charges exige, ni dans quels délais. Les visiteurs qui préfèrent parler à quelqu'un doivent appeler pendant les heures d'ouverture.

La tâche 13 prévoit quatre outils :

- un rappel d'échéance gratuit ;
- une estimation indicative du prix ;
- un assistant « appel d'offres » ;
- la prise de rendez-vous.

Contraintes :

- le site est statique, et l'enregistrement par l'API n'est actif qu'une fois la déclaration à l'ARTCI faite (`URL_API`) ;
- les données de prospects ne se gardent pas plus que nécessaire ([données personnelles](../../conformite/donnees-personnelles.md)) ;
- l'agence n'a ni tarif public ni accord de SanlamAllianz pour afficher un prix ;
- l'agence est petite : un agenda en ligne avec réservation de créneaux à la minute demanderait un calendrier tenu à jour par chacun.

## Décision

1. **Les trois premiers outils réutilisent les demandes du site.** Une demande a désormais une **nature** : devis, rappel d'échéance ou appel d'offres. Elle garde ses protections :
   - une seule porte d'entrée par nature, dans la base ;
   - la même limite pour toutes les demandes publiques : 5 par heure et par adresse, 300 par jour en tout ;
   - champ piège pour les robots, empreinte de l'adresse IP ;
   - le même traitement : devis créé ou classement sans suite.

   Sans `URL_API`, chaque outil prépare un message WhatsApp ou e-mail, comme le formulaire de devis.
2. **Rappel d'échéance.** Le visiteur donne l'assurance et la date d'échéance de son contrat actuel, chez n'importe quel assureur, dans les 13 mois. La base calcule le jour où la demande devient « à traiter » : un mois avant l'échéance. D'ici là, elle attend dans l'onglet « Rappels à venir ». La case d'accord dit exactement ce que l'agence en fera : garder ces informations jusqu'à l'échéance pour rappeler. Le visiteur peut aussi ajouter le rappel à son propre agenda (fichier `.ics` créé dans son navigateur, rien n'est envoyé).
3. **Assistant « appel d'offres »**, pour les professionnels et les entreprises seulement.
   - L'entreprise décrit le marché : type, maître d'ouvrage, objet, montant, durée, lieu, date limite de dépôt. Elle coche ensuite les assurances exigées.
   - L'assistant affiche aussitôt les pièces à préparer, et la date à laquelle envoyer le dossier : 10 jours ouvrés avant la date limite, un délai à confirmer.
   - La demande garde la date limite et le marché ; le devis créé à la conversion les reprend dans sa description.
   - Les appels d'offres passent en tête de la liste à traiter, date limite la plus proche d'abord.
4. **Prise de rendez-vous : une demande, puis une confirmation par l'agence**, pas une réservation en libre-service.
   - Le visiteur choisit le motif, le lieu, un jour et une demi-journée. Le lieu est l'agence, le téléphone ou ses locaux ; la visite dans ses locaux est réservée aux professionnels. Le jour est un jour ouvré, de demain à 60 jours.
   - L'agence fixe l'heure, la durée et la personne. La base refuse :
     - deux rendez-vous qui se chevauchent pour une même personne ;
     - un horaire hors de 7 h – 20 h.
   - Un lien prépare ensuite le message de confirmation WhatsApp.
   - L'agence note si le rendez-vous a eu lieu, ou l'annule avec un motif.
   - Le personnel fixe aussi des rendez-vous pris au téléphone ou au guichet, depuis l'agenda ou la fiche d'un client.

   Tout passe par des fonctions de la base, qui datent et signent chaque étape. L'agenda est tenu par le gérant, le chargé de clientèle et le commercial, et consulté par l'auditeur.
5. **Conservation.** Comme les demandes de devis : 12 mois.
   - Un rappel jamais traité est supprimé 12 mois après l'échéance donnée, pas après sa réception.
   - Un rendez-vous qui n'est rattaché à aucun client est supprimé 12 mois après sa clôture.
   - Le journal d'audit ne recopie ni les coordonnées, ni le message, ni la description du marché.
6. **L'estimation indicative n'est pas construite.** Afficher un prix, même « à partir de », engage l'agence et la compagnie. Il faut d'abord la grille et l'accord écrit de SanlamAllianz : prime minimale, critères, mentions obligatoires.

## Conséquences

- Le site a désormais des raisons de laisser ses coordonnées à qui n'a pas besoin d'un devis aujourd'hui. Le rappel arrive au bon moment, sans relance manuelle à programmer.
- Les entreprises savent quoi préparer et pour quand. L'agence voit les appels d'offres par urgence.
- Les rendez-vous ne sont jamais « réservés » sans que l'agence le sache. Le visiteur attend un appel de confirmation, ce que le formulaire lui dit.
- Les limites étant communes, un robot ne peut pas contourner celle des devis en passant par un autre outil.
- À faire :
  - par l'agence : confirmer le délai de 10 jours ouvrés pour un dossier d'appel d'offres (`DELAI_DOSSIER_APPEL_OFFRES`) et les jours d'ouverture ;
  - par SanlamAllianz : la grille et l'accord pour l'estimation indicative.

## Options écartées

- **Réservation de créneaux en libre-service** : il faudrait publier les disponibilités de chacun, donc une route publique de lecture et un agenda tenu à la minute. Pour une petite agence, la confirmation par téléphone est plus sûre et plus simple.
- **Rappel envoyé automatiquement sur WhatsApp au prospect** : un message à un prospect est un modèle « marketing » à faire approuver par Meta. Il faut aussi un accord explicite que le visiteur n'a pas encore donné. Un conseiller qui rappelle avec un devis convertit mieux.
- **Tables séparées pour les rappels et les appels d'offres** : ce seraient trois écrans, trois purges et trois jeux de limites pour un même traitement (devis ou sans suite).
- **Une estimation calculée à partir de tarifs trouvés en ligne** : sans grille validée, le prix affiché serait faux ou trompeur.
