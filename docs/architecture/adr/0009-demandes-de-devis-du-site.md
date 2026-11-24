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
4. **Antivirus ClamAV** (démon `clamd`, joint par l'API en TCP, `ANTIVIRUS_ADRESSE`, obligatoire en production dès que le site envoie des demandes). La carte grise est analysée à la réception : infectée, elle est refusée et rien n'est enregistré ; si l'antivirus ne répond pas, la demande est reçue et la pièce attend son analyse (reprise toutes les heures). Elle est analysée **de nouveau à chaque téléchargement**, avec les signatures du jour : elle ne sort jamais sans une analyse réussie, et une menace découverte plus tard efface son contenu. Le fichier est envoyé à `clamd` en flux, sans jamais être écrit sur disque.
5. **Conservation limitée** : une demande qui n'est pas devenue un devis est supprimée, avec sa carte grise, 12 mois après son classement sans suite (ou sa réception si personne ne l'a traitée), par la maintenance horaire de l'API et une fonction de la base réservée à cela. Pour que cette purge ait un sens, le journal d'audit ne recopie pas les données personnelles des demandes (nom, téléphone, e-mail, commune, besoin, empreinte de l'adresse) : il garde qui a reçu, traité ou purgé quelle demande, et quand.
6. **Preuve de l'accord** : le texte exact de chaque case cochée (traitement de la demande, rappels sur WhatsApp) est enregistré avec la demande. À la conversion, l'accord WhatsApp devient un consentement de la fiche client, avec sa preuve (case cochée, numéro et date de la demande), selon les règles de l'[ADR 0007](0007-relances-whatsapp-et-sms.md).
7. **Traitement au back-office** par le gérant, le chargé de clientèle ou le commercial : la demande devient un client (ou rejoint la fiche du client qui a déjà ce numéro) et un devis d'origine « site », ou est classée sans suite avec un motif. Une demande ne se modifie ni ne se supprime, et son traitement est définitif. L'auditeur consulte les demandes, pas les cartes grises.
8. **Activation par le site** : le formulaire n'enregistre que s'il est construit avec l'adresse de l'API (`URL_API`). La construction ajoute alors cette adresse à `connect-src` dans `_headers`, et active le champ de la carte grise, la case des rappels et les textes correspondants (formulaire et mentions légales). Sans elle, le site garde l'envoi par WhatsApp ou e-mail, et affiche « Rien n'est enregistré sur ce site ». WhatsApp et l'e-mail restent proposés dans les deux cas, et servent de repli si l'envoi échoue.

## Conséquences

- Chaque demande a un numéro communiqué au visiteur, une date, un statut et un auteur de traitement : plus aucune demande perdue, et l'agence sait combien de demandes du site deviennent des devis.
- L'API est désormais joignable depuis le site : la route publique est la seule exception au contrôle d'origine du back-office, et ne peut ni lire ni modifier autre chose que les demandes, dans les limites ci-dessus.
- La base grossit avec les cartes grises (quelques Mo par jour au plus, purgées à 12 mois pour les demandes sans suite) : à surveiller, et à déplacer vers un stockage de fichiers chiffré si le volume augmente (tâche 11).
- Un service de plus à exploiter : le démon ClamAV, dont les signatures se mettent à jour plusieurs fois par jour (`freshclam`). S'il tombe, les demandes continuent d'arriver mais les nouvelles cartes grises restent fermées jusqu'à son retour.
- **Avant la mise en ligne** : déclaration à l'ARTCI faite, hébergeur choisi, démon ClamAV installé à côté de l'API (`ANTIVIRUS_ADRESSE`), puis `URL_SITE_VITRINE` dans l'API et `URL_API` dans la construction du site (Netlify).

## Complément (novembre 2026) : un devis adapté à chaque assurance

Le formulaire posait les mêmes questions à tous et ne prenait qu'une carte grise. Pour une flotte, l'agence rappelait presque toujours le visiteur pour savoir combien de véhicules, lesquels, où ils roulent, et pour recevoir la liste du parc.

1. **Des questions propres à chaque assurance** : pour une flotte, le nombre et les types de véhicules (obligatoires), l'usage, les zones de circulation, les garanties, les chauffeurs, l'assureur et l'échéance actuels ; pour une automobile, la marque, la puissance, l'usage, la valeur ; pour une habitation, le statut et le logement ; etc. Elles sont écrites une seule fois, dans un fichier de données recopié tel quel sur le site et dans l'API (`devis-par-assurance.ts`), et un test vérifie que les deux exemplaires restent identiques. L'API ne garde que les réponses prévues pour l'assurance choisie, de la bonne forme (`questionnaires.ts`), dans `app.demandes_site.details` (JSON, 4 000 octets au plus, devis seulement). Comme les coordonnées, elles ne vont pas au journal d'audit et ne se modifient pas. Le back-office les montre avec leurs libellés, et le devis créé les reprend dans sa description.
2. **Les documents utiles à cette assurance** : pour une flotte, la liste des véhicules (photo, PDF ou classeur Excel), les cartes grises, l'attestation actuelle, le registre de commerce, la carte de transport ; pour un chantier, le devis des travaux et le cahier des charges ; etc. Jusqu'à **6 documents par demande, 5 Mo chacun, 20 Mo en tout**, dans l'ordre d'envoi (`rang`). Un classeur Excel n'est accepté que pour une liste (véhicules, matériel, personnes), seulement s'il se lit comme un vrai `.xlsx`, sans macro, de 2 Mo au plus. Chaque document suit les règles de la carte grise (points 3 et 4) : type reconnu d'après le contenu, antivirus à la réception et à chaque téléchargement, chiffrement lié à son identifiant, téléchargement un par un et consigné, purge avec la demande.
3. **La base garantit le vocabulaire et les limites** (natures, types, nombre, poids total) ; l'API choisit les documents permis pour chaque assurance. L'ancienne signature de `app.enregistrer_demande_site` (une carte grise) passe par la nouvelle, et l'ancien champ `piece` du formulaire reste accepté.
4. **Sans enregistrement par le site** (`URL_API` absente), les questions restent posées et entrent dans le message WhatsApp ou l'e-mail, qui indique les documents que le visiteur peut envoyer ensuite.

## Complément (novembre 2026) : d'après les questionnaires des compagnies

La comparaison des questionnaires de souscription des compagnies avec le formulaire (`docs/audit/2026-11-questionnaires-des-compagnies.md`) a montré que l'agence ne savait pas toujours quel questionnaire envoyer, ni de quoi dépend le prix. Le formulaire ne recopie pas ces questionnaires : il pose seulement les questions qui servent à les choisir et à donner un ordre de prix.

1. **Le produit recherché** pour les assurances qui en regroupent plusieurs : chantier (tous risques chantier bâtiment ou routes, montage-essais, décennale, responsabilité civile de l'entreprise de travaux ou du bureau d'études) et industrie (multirisque PME/PMI, immeuble, bris de machines, responsabilité civile industrielle, globale de banque), avec « Je ne sais pas, conseillez-moi ».
2. **L'assureur actuel et l'échéance** pour toutes les assurances professionnelles, comme pour l'automobile et la flotte.
3. **Les questions qui fixent le prix** : loyer ou valeur du bâtiment, chiffre d'affaires, effectif et garanties à ajouter (multirisque professionnelle) ; type d'ouvrage, date d'ouverture, étages, bureau de contrôle (chantier) ; type de responsabilité civile professionnelle et zone d'activité ; risques à couvrir, somme à assurer, âge de la plantation, irrigation (agricole) ; durée, mesures de sécurité, assurance précédente (événementiel) ; émeutes, terrorisme et violence politique (incendie et risques divers).
4. **Des questions posées selon une réponse précédente** (`si` dans `devis-par-assurance.ts`) : le loyer pour un locataire, la valeur du bâtiment pour un propriétaire, les questions sur l'entreprise pour une responsabilité civile. Le site ne les montre qu'à ce moment-là ; l'API retire la réponse à une question qui n'est pas posée, et ne l'exige pas même si elle est obligatoire.
5. **Quatre documents de plus** (migration 0019) : le questionnaire de la compagnie déjà rempli, le rapport de sol ou du bureau de contrôle, le planning et les plans du chantier, la carte ou le plan de la plantation.

Restent dans le questionnaire que l'agence envoie ensuite : déclarations et signatures, tableaux de sinistres, détail des mesures de sécurité, globale de banque.

## Options écartées

- **Netlify Forms ou un service de formulaires** : les demandes et les cartes grises seraient stockées chez un tiers, hors de l'outil de l'agence, avec un transfert de données de plus à déclarer.
- **Envoi de la demande par e-mail depuis le serveur** : rien de suivi, et une carte grise en clair dans des boîtes de réception.
- **Fichier envoyé en `multipart/form-data`** : l'API n'accepte que le JSON (protection contre les requêtes forcées) ; un fichier de 5 Mo en base64 tient dans une requête JSON limitée à cette route.
- **Stockage objet dès maintenant** : un service de plus à choisir, sécuriser et déclarer, pour un volume qui ne le justifie pas encore.
