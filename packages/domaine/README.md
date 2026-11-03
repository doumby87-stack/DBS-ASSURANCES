# Règles métier partagées

**Statut : à construire** avec l'API (tâche 3).

Fonctions sans dépendance, utilisées à la fois par l'API, le back-office et l'espace client, pour que la même règle donne le même résultat partout :

- formats : téléphone ivoirien (10 chiffres, `+225`), immatriculation, montants en francs CFA (entiers) ;
- délais : reversement des primes (30 jours), échéances et relances, délai de déclaration de sinistre ;
- calculs : prorata d'une prime en cours d'année (ajout ou retrait d'un véhicule de flotte), plafond des espèces.

Les règles les plus sensibles (plafond des espèces, mise en vigueur, reversements) sont **aussi** appliquées par la base de données : ce paquet sert à prévenir l'utilisateur avant l'envoi, la base garantit le résultat.

Chaque fonction a ses tests dans `tests/`.
