# Formation du personnel

Le support des séances, à animer par le gérant ou le prestataire technique. **Avant d'ouvrir son compte**, chaque personne suit les quatre modules (environ 1 h 30 en tout) ; puis **chaque année**, et après chaque incident. La lutte contre le blanchiment a son propre support ([LBC/FT](../conformite/lbc-ft.md)).

Chaque séance est inscrite dans le back-office, page **Conformité**, « Formations du personnel » : le thème (Hameçonnage, Mots de passe, Procédure d'incident, Données personnelles), la date et les personnes présentes. Le tableau montre en rouge qui doit la refaire.

## Module 1 — Hameçonnage (30 minutes)

**Le message à retenir** : un escroc ne casse pas l'informatique, il **trompe une personne**. Il se fait passer pour quelqu'un de confiance et crée l'urgence.

Les ruses qu'on voit à Abidjan :

- un e-mail « SanlamAllianz » ou « Microsoft » : *« votre compte va être suspendu, reconnectez-vous ici »* ;
- un message WhatsApp du « gérant » ou du « DG » depuis un nouveau numéro : *« je suis en réunion, fais vite un transfert Orange Money à ce numéro »* ;
- un faux client qui envoie un « constat » ou une « carte grise » en pièce jointe d'un e-mail, en fichier `.zip`, `.exe` ou document Word qui demande d'« activer le contenu » ;
- un appel du « support technique » qui demande le code reçu par SMS ou le code de l'application d'authentification.

Les réflexes :

1. **Le lien du back-office, on ne le suit jamais dans un message** : on le tape soi-même ou on utilise le favori. Le seul vrai est `https://gestion.<domaine de l'agence>`.
2. **Le code du deuxième facteur ne se donne à personne**, ni au gérant, ni au prestataire, ni à « SanlamAllianz ». Personne n'en a besoin.
3. **Une demande d'argent ou de changement de numéro de paiement se vérifie par un autre canal** : on rappelle la personne sur le numéro qu'on connaît déjà.
4. **Les pièces des clients passent par le back-office ou l'espace client**, qui les analysent avec l'antivirus, pas par les e-mails personnels.
5. **Un doute ? On demande avant de cliquer.** Se tromper en demandant ne coûte rien ; se tromper en cliquant peut coûter l'agence.

*Exercice* : montrer trois vrais messages et trois faux (préparés par l'animateur, sans données réelles) ; chacun dit lesquels sont faux et pourquoi.

## Module 2 — Mots de passe et deuxième facteur (20 minutes)

- **Un mot de passe par site**, de 12 caractères au moins. Le plus simple : une phrase (*« Le-maquis-de-Cocody-ferme-à-23h »*). Le back-office refuse les mots de passe trop courts ou déjà publiés dans des fuites.
- **Jamais noté sur un papier collé à l'écran**, jamais envoyé par WhatsApp, jamais prêté. Un compte, une personne : ce que fait un compte est inscrit à son nom dans le journal d'audit.
- **Le deuxième facteur** (application d'authentification sur le téléphone) est obligatoire. Téléphone perdu ou changé : prévenir le gérant **le jour même**, qui réinitialise l'accès.
- **Verrouiller l'écran** dès qu'on quitte son poste (touche Windows + L) ; la session se ferme seule après 15 minutes sans activité.
- **Compte bloqué** après 5 erreurs : ce n'est pas une panne, c'est une protection. Le gérant le voit sur la page Exploitation et vérifie avec la personne.

## Module 3 — Procédure d'incident (20 minutes)

Ce qui est un incident : un clic sur un lien douteux, un mot de passe donné, un téléphone perdu, un ordinateur qui se comporte bizarrement, un client qui signale un faux numéro de paiement « de DBS », une alerte rouge sur la page Exploitation, des données envoyées à la mauvaise personne.

1. **Prévenir le gérant tout de suite**, de vive voix ou par téléphone, même si on a peur d'avoir fait une erreur. Plus c'est tôt, moins c'est grave ; personne n'est sanctionné pour avoir signalé.
2. **Ne rien effacer**, ne pas éteindre l'ordinateur, ne pas « réparer » soi-même.
3. **Noter** ce qui s'est passé, l'heure, ce qu'on a vu.
4. Le gérant suit la [procédure d'incident](reponse-aux-incidents.md), à imprimer et à garder à l'agence avec les numéros à jour.

*Exercice* : « J'ai cliqué sur un lien et saisi mon mot de passe. Que fais-je dans les 5 minutes ? » (réponse : prévenir le gérant, qui désactive le compte ; changer le mot de passe en sa présence ; vérifier le journal ensemble).

## Module 4 — Données personnelles (20 minutes)

- Les données des clients (identité, téléphone, pièce d'identité, véhicules, sinistres, parfois des informations médicales) **appartiennent aux clients**. La loi ivoirienne (n° 2013-450) et l'ARTCI protègent leur usage ([données personnelles](../conformite/donnees-personnelles.md)).
- **Seulement pour le travail** : on ne consulte pas la fiche d'un voisin, d'un parent ou d'une personnalité par curiosité. Chaque consultation sensible et chaque téléchargement sont consignés.
- **Pas de copie hors du back-office** : pas de photo d'écran envoyée sur WhatsApp, pas de liste de clients sur une clé USB ou dans un e-mail personnel. Les exports sont réservés au gérant et consignés.
- **Lecture automatique des documents** : l'outil propose, la personne vérifie. Chaque champ surligné se compare avec le document avant d'enregistrer ; une immatriculation ou un numéro de châssis faux finit sur l'attestation ([ADR 0015](../architecture/adr/0015-lecture-automatique.md)).
- **Un client demande ses données** ou leur correction : on enregistre la demande comme réclamation, le gérant y répond dans les délais.

## Questionnaire (10 minutes)

À faire à la fin de la séance ; 8 bonnes réponses sur 10 au moins, sinon on reprend les points manqués ensemble.

1. Un e-mail « SanlamAllianz » vous demande de vous reconnecter au back-office par un lien. Que faites-vous ?
2. Le « gérant » vous écrit d'un nouveau numéro WhatsApp pour un transfert urgent. Que faites-vous ?
3. Qui peut vous demander votre code de deuxième facteur ?
4. Vous avez perdu votre téléphone. Quand prévenez-vous le gérant ?
5. Un collègue vous demande votre mot de passe parce que le sien est bloqué. Que répondez-vous ?
6. Votre compte est bloqué après plusieurs erreurs. Est-ce une panne ?
7. Vous avez cliqué sur un lien douteux et saisi votre mot de passe. Quelle est la première chose à faire ?
8. Un client envoie sa carte grise sur votre WhatsApp personnel. Que faites-vous ?
9. La lecture automatique a rempli l'immatriculation. Que faites-vous avant d'enregistrer ?
10. Pouvez-vous regarder la fiche d'un client connu par curiosité ?

### Corrigé

1. Je ne clique pas ; j'ouvre le back-office par mon favori ; je montre le message au gérant.
2. Je ne fais rien avant d'avoir rappelé le gérant sur son numéro habituel.
3. Personne.
4. Le jour même.
5. Non : un compte, une personne. Le gérant réinitialise son accès.
6. Non, c'est une protection ; le gérant vérifie avec moi.
7. Prévenir le gérant tout de suite.
8. Je l'enregistre dans le back-office (ou je demande au client de passer par l'espace client), puis je supprime la photo de mon téléphone.
9. Je compare chaque champ surligné avec le document.
10. Non : seulement pour le travail, et la consultation est consignée.
