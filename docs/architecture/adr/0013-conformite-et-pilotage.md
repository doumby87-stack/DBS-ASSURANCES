# 0013 — Conformité et pilotage : identification des clients, alertes, réclamations, FNE, statistiques

- Statut : Acceptée (seuils des alertes et délais des réclamations à confirmer, voir plus bas)
- Date : 2026-11-06

## Contexte

L'agence opère sous le mandat de SanlamAllianz. Le règlement n° 0031/CIMA/PCMA/PCE/SG/2025 du 10 juillet 2025 sur la lutte contre le blanchiment s'applique donc à elle ([LBC/FT](../../conformite/lbc-ft.md)). Il demande trois choses :

- connaître chaque client ;
- repérer les situations inhabituelles ;
- former le personnel.

Trois autres besoins s'y ajoutent :

- **les réclamations** se traitent aujourd'hui de mémoire : ni registre, ni délais tenus ;
- **la facture normalisée électronique (FNE)** est probablement due pour les commissions facturées à la compagnie ([FNE](../../conformite/facturation-fne.md)) ;
- **le gérant** n'a aucune vue d'ensemble de l'activité.

Contraintes :

- les numéros de pièce d'identité et les dossiers de lutte contre le blanchiment sont des données « très sensibles » ([classification](../../securite/classification-des-donnees.md)) ;
- un soupçon ne doit jamais parvenir au client : l'en avertir est interdit ;
- la procédure de SanlamAllianz pour ses agents (seuils, pièces, circuit de déclaration) n'est pas encore connue ;
- l'intégration directe à la plateforme FNE de la DGI n'est pas documentée publiquement, et le volume de factures de l'agence est faible.

## Décision

1. **Une fiche d'identification par client** (`app.identifications_clients`), tenue par le gérant ou le chargé de clientèle.
   - Le numéro de pièce est **chiffré par l'API** (AES-256-GCM) ; la base n'en garde que les 4 derniers caractères en clair. Il ne s'affiche en entier que sur une action volontaire, et chaque affichage est consigné au journal de sécurité.
   - Pour une entreprise : RCCM, forme juridique, compte contribuable, siège, **dirigeants et bénéficiaires effectifs** (`app.dirigeants_beneficiaires`).
   - Les justificatifs (copie de la pièce, RCCM, statuts) sont analysés par l'antivirus, chiffrés, puis conservés sans modification possible.
   - La personne qui a vu l'original le confirme par une **fonction dédiée** : la base enregistre son nom et la date. Changer la pièce, la date de naissance ou la nationalité annule cette vérification.
   - La **revue périodique** suit le niveau de risque : tous les 3 ans (faible), 2 ans (normal), 1 an (élevé). Une personne politiquement exposée est toujours à risque élevé.
2. **L'état de la fiche est calculé par la base** (`app.etat_identification`) : absente, incomplète (avec ce qui manque), à revoir ou complète. Il est lisible par toute personne qui voit le client, sans aucune donnée d'identité. Le contenu de la fiche reste réservé au gérant, au chargé de clientèle et à l'auditeur.
3. **Aucune souscription pour un client à risque élevé mal identifié.** La base refuse le contrat tant que la fiche n'est pas complète et à jour ; cela vaut aussi quand l'un des dirigeants ou bénéficiaires est politiquement exposé. Pour les autres clients, une fiche incomplète n'empêche rien, mais elle apparaît dans la liste des fiches à compléter. Les clients existants sans fiche peuvent ainsi être repris progressivement.
4. **Des alertes calculées par la base** (`app.v_alertes`), **visibles du seul gérant**. Leurs seuils sont proposés et restent à confirmer avec SanlamAllianz :
   - espèces : 80 % du plafond de 1 000 000 F CFA atteints sur un contrat ;
   - paiement par un tiers, dont le caissier note le nom ;
   - 3 paiements en espèces ou plus en 30 jours sur un même contrat ;
   - résiliation moins de 90 jours après la prise d'effet, alors qu'une prime a été encaissée.

   Le gérant décide une fois par alerte, avec un motif : il la **classe**, ou la **transmet au correspondant LBC/FT** de la compagnie. Sa décision ne peut ensuite ni être modifiée ni être supprimée.
5. **Un registre des formations** (`app.formations_personnel`), à refaire chaque année. Les thèmes sont : blanchiment, hameçonnage, mots de passe, procédure d'incident et données personnelles.
6. **Un registre des réclamations** (`app.reclamations`), alimenté au guichet et par l'espace client.
   - La base attribue le numéro (`REC-2026-0001`) et calcule les échéances en jours ouvrés : accusé de réception sous 2 jours, réponse sous 10. Le calcul saute les week-ends et les fêtes à date fixe.
   - Le traitement passe par une fonction qui date et signe chaque étape : accusé de réception, réponse avec son issue, recours (la compagnie, puis la Direction des Assurances), clôture.
   - Le client suit sa réclamation et la réponse dans son espace.
   - Le registre s'exporte, et chaque export est consigné.
   - Les demandes d'exercice des droits sur les données s'y enregistrent aussi (objet « Données personnelles »). Le gérant exporte alors toutes les données du client, sans contenu chiffré ; chaque export est consigné.
7. **Les factures FNE sont émises sur la plateforme de la DGI**, et le gérant note leur numéro ici (`app.factures_fne`). Il y en a une par mois de commissions, visible dans le rapprochement des commissions. Une facture ne se modifie pas : elle s'annule une seule fois (avoir), avec son motif.
8. **Des statistiques calculées à la demande**, pour le gérant et l'auditeur, sous leurs droits :
   - production et encaissements par mois ;
   - branches, modes de paiement et part payée en ligne ;
   - portefeuille, reste à recouvrer et taux de renouvellement ;
   - sinistres et réclamations (délais) ;
   - demandes du site et production par personne.

   Le graphique est en SVG, sans bibliothèque ni style en ligne.

## Conséquences

- Pour la lutte contre le blanchiment, l'agence peut montrer qui elle a identifié, quand, par qui, avec quelles pièces, et ce qu'elle a fait de chaque alerte.
- Un contrat à risque élevé ne peut plus être souscrit « en attendant les papiers ».
- Les délais des réclamations sont visibles : les retards apparaissent dans le registre, et le taux de réponse dans les délais figure dans les statistiques.
- À confirmer :
  - par SanlamAllianz : les seuils des alertes, les pièces exigées et le circuit de déclaration ;
  - par l'agence : les engagements de délai des réclamations ;
  - par le comptable : l'obligation FNE.

  Chaque changement passera par une nouvelle migration.
- Les fêtes à date variable (Pâques, Ramadan, Tabaski…) ne sont pas décomptées : une échéance de réclamation peut donc être plus courte d'un jour, jamais plus longue.
- Les justificatifs et fiches sont conservés sans suppression automatique. La durée légale (10 ans dans le droit de l'UEMOA, à confirmer) sera appliquée par une purge, quand elle sera confirmée.

## Options écartées

- **Bloquer tout contrat sans fiche complète** : les clients existants n'ont pas de fiche. Tout bloquer arrêterait l'agence le jour de la mise en service. L'approche fondée sur les risques, que demande le règlement, bloque d'abord le risque élevé.
- **Montrer les alertes au chargé de clientèle** : le risque d'avertir le client, même involontairement, est trop grand. Seul le gérant décide.
- **Intégrer l'API FNE dès maintenant** : sa documentation n'est pas publique, l'obligation de l'agence n'est pas confirmée, et le volume est de quelques factures par mois. Saisir le numéro suffit ; l'intégration viendra si le volume le justifie.
- **Une bibliothèque de graphiques** : du code tiers dans le back-office, et souvent des styles en ligne interdits par la politique de sécurité du contenu. Quelques barres SVG suffisent.
