# 0012 — Espace client : particuliers, paiement Mobile Money vérifié auprès du prestataire, sinistres déclarés en ligne

- Statut : Acceptée (prestataire de paiement réel à choisir : seule la simulation est en place)
- Date : 2026-11-05

## Contexte

Le portail des entreprises ([ADR 0011](0011-portail-des-entreprises.md)) est en place. Les particuliers demandent la même chose, plus deux services :

- **payer leur prime sans se déplacer**. En Côte d'Ivoire, cela veut dire Mobile Money : Wave, Orange Money, MTN MoMo, Moov Money. La carte bancaire est rare ;
- **déclarer un sinistre tout de suite**, avec les photos et le constat amiable. Le délai est court : 5 jours ouvrés, 2 jours pour un vol.

Contraintes :

- l'agence n'a pas encore de compte marchand. Le prestataire de paiement n'est pas choisi : agrégateur (CinetPay, PayDunya…) ou contrat direct avec chaque opérateur ;
- un résultat de paiement ne doit jamais pouvoir être imité. La page de retour et une notification se forgent facilement ; un contrat mis en vigueur sans paiement réel serait une fraude à l'assurance ;
- aucune donnée de paiement sensible ne doit transiter par l'agence : ni code secret Mobile Money, ni carte ;
- les montants sont des F CFA entiers, sans pièce de moins de 5 F ;
- la caisse de l'agence (clôtures, billetage) ne compte que l'argent qui passe par un caissier ;
- les photos d'un sinistre sont des données personnelles, parfois celles de tiers : plaques, visages.

## Décision

1. **Le portail devient l'« espace client », ouvert aux particuliers.**
   - Pour un particulier, l'espace s'ouvre tout seul à sa première demande de code, si trois conditions sont réunies : le numéro saisi est exactement celui de **sa** fiche, il n'est partagé avec aucun autre client, et le client a au moins un contrat.
   - Un particulier a un seul accès, le sien. Il n'a pas de collaborateurs.
   - Un accès retiré par l'agence ne se rouvre pas tout seul.
   - Une entreprise garde ses accès créés par l'agence : son numéro de standard n'est pas celui d'une personne.
2. **Le paiement passe par un prestataire, derrière une interface.** L'interface (`apps/api/src/integrations/paiement/prestataire.ts`) a trois opérations :
   - `initier` : la page de paiement du prestataire ;
   - `verifier` : le résultat, demandé au prestataire par l'API, authentifiée ;
   - `lireNotification` : la référence portée par une notification, dont la signature a été contrôlée.

   **Le résultat vient toujours de `verifier`.** La page de retour et les notifications ne font que déclencher cette vérification.
3. **La base prépare chaque paiement** (`portail.preparer_paiement`) :
   - le contrat appartient à la personne connectée, il est en attente de paiement ou en vigueur, et il reste quelque chose à payer ;
   - le montant est un multiple de 5, d'au moins 100 F CFA (ou le reste s'il est plus petit), et ne dépasse pas le reste arrondi au multiple de 5 supérieur ;
   - une personne commence 5 paiements par heure au plus ;
   - un contrat n'a qu'un seul paiement en cours. Au bout de 30 minutes, il est remplacé ;
   - l'API applique en plus le plafond `PAIEMENT_MONTANT_MAX`.

   Chaque paiement reçoit une référence unique (`DBS-00000001`) transmise au prestataire.
4. **La base enregistre l'encaissement** (`app.conclure_paiement_en_ligne`). Elle le fait sans utilisateur connecté, une seule fois, et rejouer ne change rien :
   - **accepté pour le montant demandé** : encaissement Mobile Money, avec la référence `prestataire:référence`. Il n'a **pas de caissier** et reste **hors caisse** : aucune clôture ne le compte. Le contrat passe en vigueur une fois soldé, par les règles existantes. Les 4 F CFA au plus de l'arrondi sont tolérés ;
   - **accepté mais impossible à encaisser** (autre montant, prime déjà soldée entre-temps) : le paiement est « à régulariser », avec le motif. L'argent est reçu, il ne se perd pas. Le gérant rembourse le client ou affecte la somme, puis note ce qu'il a fait (`app.regulariser_paiement_en_ligne`) ;
   - **refusé ou abandonné** : rien n'est encaissé.

   Le client peut fermer son navigateur avant la page de retour, et une notification peut se perdre. Aussi, chaque heure, la maintenance demande au prestataire le résultat de chaque paiement en attente depuis plus de 10 minutes : l'argent reçu est encaissé quand même. Un paiement sans réponse depuis plus d'un jour est ensuite abandonné. Un résultat qui arrive plus tard est encore enregistré.
5. **Pour l'instant, le prestataire est simulé** (`PAIEMENT_PRESTATAIRE=simulation`). La simulation est refusée en production. La « page du prestataire » est alors celle du portail, qui propose de payer ou de refuser ; le résultat est ensuite vérifié comme un vrai. Le prestataire réel s'ajoute dans `integrations/paiement/` le jour où le compte marchand est ouvert. Il doit suivre la documentation officielle de ce prestataire, à jour : signature des notifications, appel de vérification, codes de résultat. Elle n'a pas pu être consultée ici, et rien n'a été écrit de mémoire. Le reste du code ne change pas.
6. **Le client déclare son sinistre en ligne** (`portail.declarer_sinistre`).
   - La base vérifie trois choses : le contrat est le sien, le véhicule était couvert ce jour-là, et la date est passée depuis moins d'un an.
   - Le récit doit faire au moins 10 caractères. Une personne fait 10 déclarations par jour au plus.
   - Le récit et le lieu sont visibles par le client ; la note de l'agence reste interne.
7. **Le client joint des photos et des documents** (`app.pieces_sinistres`) dans les 7 jours qui suivent la déclaration, 8 au plus par sinistre.
   - Les fichiers acceptés sont JPEG, PNG ou PDF, de 5 Mo au plus. Le type est reconnu d'après le contenu du fichier.
   - Chaque fichier est analysé par l'antivirus à l'arrivée. Infecté, il est refusé. Si l'antivirus est indisponible, l'envoi est à refaire.
   - Il est chiffré (AES-256-GCM) avec un contexte propre à la pièce. Ensuite, on ne peut plus que l'ajouter : ni modification ni suppression.
   - L'agence le télécharge, et chaque téléchargement est consigné.

## Conséquences

- Le client paie sa prime depuis son téléphone et reçoit son attestation sans se déplacer. Le contrat entre en vigueur dès la confirmation du prestataire, sans saisie à l'agence.
- Côté agence :
  - une page **Sinistres**, où les déclarations à traiter passent en premier ;
  - les **paiements en ligne** dans la caisse, à part des clôtures ;
  - une régularisation, réservée au gérant.
- Avant la mise en service du paiement :
  - choisir le prestataire, ouvrir le compte marchand, ajouter son module en suivant sa documentation officielle, puis le tester dans son environnement de test ;
  - rendre l'adresse des notifications joignable depuis Internet : `https://<portail>/api/paiements/notifications/<prestataire>` ;
  - rapprocher chaque jour le relevé du prestataire avec la liste des paiements en ligne ;
  - compléter la déclaration à l'ARTCI : paiements, photos des sinistres.
- Les photos des sinistres restent dans la base, chiffrées, comme les autres pièces. À 8 × 5 Mo par sinistre au plus, le volume reste modeste. S'il grandit, un stockage d'objets chiffré pourra le remplacer.

## Options écartées

- **Croire la page de retour ou le contenu d'une notification** : l'un et l'autre s'imitent. Seule la vérification auprès du prestataire fait foi.
- **Paiement par carte** : peu utilisé par la clientèle. Il imposerait aussi les exigences PCI DSS, alors que le Mobile Money sur la page du prestataire ne fait rien transiter par l'agence.
- **Un contrat avec chaque opérateur dès le départ** : quatre contrats, quatre intégrations, quatre rapprochements. Un agrégateur d'abord ; un contrat direct plus tard, si les frais le justifient.
- **Encaisser les paiements en ligne dans la caisse d'un caissier** : ce n'est pas de l'argent dans un tiroir. Le billetage et la clôture deviendraient faux.
- **Ouvrir l'espace à tout numéro inconnu** : n'importe qui pourrait tester des numéros. L'ouverture automatique exige le numéro exact de la fiche, un seul client et un contrat ; la réponse reste la même que le numéro ait un accès ou non.
