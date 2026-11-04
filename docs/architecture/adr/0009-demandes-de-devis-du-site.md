# 0009 — Demandes de devis du site : enregistrées par l'API, carte grise chiffrée en base

- Statut : Acceptée (mise en service après la déclaration à l'ARTCI)
- Date : 2026-11-04

## Contexte

Jusqu'ici, le formulaire du site préparait un message que le visiteur envoyait lui-même sur WhatsApp. Une demande pouvait donc se perdre dans une conversation, sans numéro, sans suivi, et la carte grise arrivait en photo dans un téléphone. La tâche 7 enregistre chaque demande dans l'outil de l'agence, avec la carte grise, et la fait suivre au back-office jusqu'au devis.

Contraintes :

- Le site est statique, sur un autre nom de domaine que le back-office et l'API ([ADR 0008](0008-site-vitrine-astro.md)) ; sa politique de sécurité du contenu interdit tout échange non déclaré.
- Le visiteur n'a pas de compte : la route qui reçoit les demandes est publique, donc exposée aux robots et aux envois en masse.
- Une carte grise identifie un véhicule et son propriétaire : elle ne doit être lisible que par les conseillers qui traitent la demande.
- La base refuse toute écriture sans utilisateur déclaré ([ADR 0004](0004-securite-dans-la-base.md)).
- Loi n° 2013-450 : enregistrer ces données suppose la déclaration à l'ARTCI et des mentions légales à jour ([données personnelles](../../conformite/donnees-personnelles.md)).

## Décision

1. **Une route publique unique**, `POST /site/demandes-devis`, qui n'existe que si l'adresse du site est configurée (`URL_SITE_VITRINE`). Elle n'accepte que l'origine du site (requête préalable du navigateur comprise) et répond avec les en-têtes CORS pour cette seule origine, sans cookie. Elle ne lit rien : elle enregistre par une seule fonction de la base, `app.enregistrer_demande_site`, qui ne fait que cela.
2. **Limites appliquées par la base**, exactes même sous une rafale (verrou) : 5 demandes par heure depuis une même adresse, 300 par jour en tout. L'adresse IP n'est pas gardée : seule son **empreinte HMAC**, avec une clé dérivée de la clé de l'API. Un **champ piège**, invisible pour les visiteurs, fait accepter en apparence les envois des robots sans rien enregistrer.
3. **Carte grise vérifiée puis chiffrée** : photo JPEG, PNG ou PDF, 5 Mo au plus, type reconnu d'après le contenu du fichier (jamais d'après son nom), seulement pour un véhicule. Chiffrée par l'API (AES-256-GCM, liée à l'identifiant de la pièce) avant d'entrer en base, avec son empreinte SHA-256. Elle est gardée **dans PostgreSQL** tant qu'aucun stockage de fichiers n'est choisi (tâche 11) : quelques demandes par jour, 5 Mo au plus, sauvegardées et protégées comme le reste. Elle n'est pas recopiée dans le journal d'audit ; chaque téléchargement est consigné au journal de sécurité, et le fichier est toujours servi en pièce jointe (`Content-Disposition: attachment`, `nosniff`).
4. **Preuve de l'accord** : le texte exact de chaque case cochée (traitement de la demande, rappels sur WhatsApp) est enregistré avec la demande. À la conversion, l'accord WhatsApp devient un consentement de la fiche client, avec sa preuve (case cochée, numéro et date de la demande), selon les règles de l'[ADR 0007](0007-relances-whatsapp-et-sms.md).
5. **Traitement au back-office** par le gérant, le chargé de clientèle ou le commercial : la demande devient un client (ou rejoint la fiche du client qui a déjà ce numéro) et un devis d'origine « site », ou est classée sans suite avec un motif. Une demande ne se modifie ni ne se supprime, et son traitement est définitif. L'auditeur consulte les demandes, pas les cartes grises.
6. **Activation par le site** : le formulaire n'enregistre que s'il est construit avec l'adresse de l'API (`URL_API`). La construction ajoute alors cette adresse à `connect-src` dans `_headers`, et active le champ de la carte grise, la case des rappels et les textes correspondants (formulaire et mentions légales). Sans elle, le site garde l'envoi par WhatsApp ou e-mail, et affiche « Rien n'est enregistré sur ce site ». WhatsApp et l'e-mail restent proposés dans les deux cas, et servent de repli si l'envoi échoue.

## Conséquences

- Chaque demande a un numéro communiqué au visiteur, une date, un statut et un auteur de traitement : plus aucune demande perdue, et l'agence sait combien de demandes du site deviennent des devis.
- L'API est désormais joignable depuis le site : la route publique est la seule exception au contrôle d'origine du back-office, et ne peut ni lire ni modifier autre chose que les demandes, dans les limites ci-dessus.
- La base grossit avec les cartes grises (quelques Mo par jour au plus) : à surveiller, et à déplacer vers un stockage de fichiers chiffré si le volume augmente (tâche 11). Une analyse antivirus des pièces reste à ajouter avec ce stockage.
- **Avant la mise en ligne** : déclaration à l'ARTCI faite, hébergeur choisi, puis `URL_SITE_VITRINE` dans l'API et `URL_API` dans la construction du site (Netlify).

## Options écartées

- **Netlify Forms ou un service de formulaires** : les demandes et les cartes grises seraient stockées chez un tiers, hors de l'outil de l'agence, avec un transfert de données de plus à déclarer.
- **Envoi de la demande par e-mail depuis le serveur** : rien de suivi, et une carte grise en clair dans des boîtes de réception.
- **Fichier envoyé en `multipart/form-data`** : l'API n'accepte que le JSON (protection contre les requêtes forcées) ; un fichier de 5 Mo en base64 tient dans une requête JSON limitée à cette route.
- **Stockage objet dès maintenant** : un service de plus à choisir, sécuriser et déclarer, pour un volume qui ne le justifie pas encore.
