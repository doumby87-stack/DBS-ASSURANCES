# Formation du personnel à la sécurité

Les attaques visent d'abord les personnes : un faux message « de SanlamAllianz », un client pressé qui demande un changement de numéro, un code de connexion demandé au téléphone. Chaque membre du personnel suit ces modules **avant l'ouverture de son compte**, puis **chaque année**. Le gérant enregistre chaque session au back-office (Conformité, Formations) : l'écran signale qui n'est plus à jour ([ADR 0013](../architecture/adr/0013-conformite-et-pilotage.md)).

| Module | Thème au registre | Durée | Animé par |
| --- | --- | --- | --- |
| 1. Reconnaître une arnaque | `hameconnage` | 45 min | Gérant ou prestataire technique |
| 2. Mots de passe et deuxième facteur | `mots_de_passe` | 30 min | Prestataire technique |
| 3. Que faire en cas d'incident | `procedure_incident` | 30 min | Gérant |
| 4. Données personnelles des clients | `donnees_personnelles` | 30 min | Gérant |
| 5. Lutte contre le blanchiment | `lbc_ft` | 1 h | Gérant ([LBC/FT](../conformite/lbc-ft.md)) |

Les modules 1 à 4 tiennent en une demi-journée à l'agence, avec les exemples ci-dessous adaptés aux messages réellement reçus. Chaque module se termine par ses questions : la personne y répond seule, puis on corrige ensemble.

## 1. Reconnaître une arnaque (hameçonnage)

**Ce qu'il faut retenir**

- Un message qui **presse** (« avant midi », « sinon le contrat est annulé ») ou qui **sort de l'habitude** (nouveau numéro de paiement, nouvelle adresse de la compagnie) se vérifie **par un autre canal** : rappeler le numéro connu, jamais celui du message.
- **Aucun** service sérieux ne demande un mot de passe ou un code à 6 chiffres. Le code du deuxième facteur ne se donne à personne, ni au gérant, ni au prestataire, ni à « SanlamAllianz ».
- Un lien se lit avant de cliquer : l'adresse réelle s'affiche en appuyant longuement (téléphone) ou en survolant (ordinateur). Seule compte la fin du nom, juste avant le premier « / » : `sanlam-allianz-ci.com-verif.net` appartient à `com-verif.net`, pas à la compagnie.
- Une pièce jointe inattendue (facture, « bordereau », classeur Excel « à activer ») ne s'ouvre pas : on la transmet au gérant.
- **Le numéro de paiement** de l'agence ne change jamais par un simple message. Un client qui en reçoit un nouveau « de DBS » est prévenu tout de suite ([réponse aux incidents](reponse-aux-incidents.md)).

**Exemples à commenter** : un e-mail « SanlamAllianz : mise à jour de vos accès extranet » ; un WhatsApp d'un « client » qui envoie un reçu de transfert et demande de rembourser un trop-perçu sur un autre numéro ; un SMS « votre compte gestion sera bloqué, cliquez ici » ; un appel du « prestataire informatique » qui demande le code reçu sur le téléphone.

**Questions**

1. Un message de « SanlamAllianz » demande de confirmer vos accès par un lien avant ce soir. Que faites-vous ? *(On ne clique pas ; on appelle l'interlocuteur habituel de la compagnie au numéro connu, et on prévient le gérant.)*
2. Le « prestataire » vous appelle et demande le code à 6 chiffres affiché sur votre téléphone. *(On refuse, on raccroche, on prévient le gérant : personne n'en a besoin.)*
3. Un client envoie la photo d'un transfert de 450 000 F CFA et demande qu'on lui rende 150 000 F CFA « en trop » sur un autre numéro. *(On vérifie l'encaissement réel dans l'outil avant tout, et on alerte le gérant : schéma classique d'escroquerie.)*

## 2. Mots de passe et deuxième facteur

**Ce qu'il faut retenir**

- Une **phrase de passe** d'au moins 12 caractères, facile à retenir et propre à l'outil de l'agence : jamais la même que pour la messagerie ou Facebook. L'outil refuse les mots de passe déjà divulgués sur Internet.
- Un **gestionnaire de mots de passe** est le bon endroit pour les retenir ; un carnet sous le clavier, non.
- Le **deuxième facteur** vit dans l'application d'authentification du téléphone personnel. Téléphone perdu ou changé : prévenir le gérant le jour même, il réinitialise l'accès.
- **Poste verrouillé** dès qu'on s'en éloigne (Windows + L). Pas de connexion depuis un ordinateur partagé ou un cybercafé.
- Un compte, une personne : on ne prête pas son accès, même pour dépanner un collègue.

**Questions**

1. Pourquoi ne pas utiliser le même mot de passe que pour sa messagerie ? *(Si un site se fait voler ses mots de passe, l'attaquant les essaie partout.)*
2. Vous changez de téléphone ce week-end. Que faites-vous ? *(Prévenir le gérant avant, pour réinstaller le deuxième facteur sur le nouveau.)*
3. Un collègue absent vous demande de valider une opération avec son compte. *(Non : chaque action est signée au journal d'audit par la personne connectée.)*

## 3. Que faire en cas d'incident

**Ce qu'il faut retenir**

- **Prévenir le gérant tout de suite**, même en cas de doute : un clic sur un lien suspect, un message étrange, un client qui signale un faux numéro, une opération qu'on n'a pas faite.
- **Ne rien effacer** : messages, captures d'écran, heure. Ils servent à comprendre et, parfois, à porter plainte.
- Outil indisponible : l'agence continue avec le **carnet de reçus à souches** tenu par le gérant ; chaque reçu est saisi au retour de l'outil, à sa date réelle ([sauvegardes et reprise](sauvegardes-et-reprise.md)).
- Le gérant suit la [procédure d'incident](reponse-aux-incidents.md) : contenir, évaluer, prévenir (compagnie, clients, ARTCI si besoin), corriger, tirer les leçons.

**Questions**

1. Vous avez cliqué sur un lien et saisi votre mot de passe sur une page qui ressemblait à l'outil. *(Prévenir le gérant immédiatement : il bloque le compte et réinitialise l'accès. Ne pas attendre de « voir ».)*
2. L'outil ne répond plus et un client veut payer en espèces. *(Reçu manuel du carnet à souches, saisi plus tard à sa date réelle.)*

## 4. Données personnelles des clients

**Ce qu'il faut retenir**

- On ne recueille que ce qui sert au contrat ([classification des données](classification-des-donnees.md)). Les pièces d'identité, cartes grises et constats vont dans l'outil, où ils sont chiffrés : **pas** dans le WhatsApp personnel, ni sur une clé USB.
- Un **export** (liste de clients, bordereau) est tracé ; il ne part que vers son destinataire prévu (compagnie, comptable) et ne traîne pas dans « Téléchargements ».
- Un client peut demander l'accès à ses données, leur correction ou leur suppression : on transmet sa demande au gérant ([données personnelles](../conformite/donnees-personnelles.md)).
- On ne donne aucune information sur un contrat par téléphone sans être sûr de parler au client (numéro enregistré, questions de vérification).

**Questions**

1. Un client envoie sa pièce d'identité sur votre WhatsApp personnel. *(On l'enregistre dans l'outil, puis on la supprime du téléphone et de la conversation.)*
2. Quelqu'un appelle « de la part de son frère » pour connaître la date d'échéance de son contrat. *(On ne la donne pas : on rappelle le client au numéro enregistré.)*

## Enregistrer la formation

À la fin de chaque session, le gérant ouvre Conformité, Formations, et enregistre pour chaque participant le thème et la date. Une formation de plus d'un an apparaît « à refaire ». Les supports (ce document, les exemples commentés) et les réponses aux questions sont gardés avec le registre.

Une fois par an, le gérant peut faire envoyer un **faux message d'hameçonnage** d'exercice, annoncé à l'avance comme principe mais pas comme date, pour vérifier les réflexes. Il n'est jamais utilisé pour sanctionner.
