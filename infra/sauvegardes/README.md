# Sauvegardes et restauration

Politique complète : [`docs/securite/sauvegardes-et-reprise.md`](../../docs/securite/sauvegardes-et-reprise.md).

En résumé (règle 3-2-1) :

- **3 copies** des données : la base de production, une sauvegarde chez l'hébergeur, une sauvegarde chez un second fournisseur.
- **2 supports** différents.
- **1 copie hors site**, chiffrée, que l'hébergeur principal ne peut ni modifier ni effacer (stockage en écriture unique).

Chaque mois, une sauvegarde est restaurée sur une base de test et vérifiée (`audit.verifier_chaine()` compris). Une sauvegarde jamais restaurée n'est pas une sauvegarde.

Les scripts de sauvegarde seront ajoutés ici avec la mise en production (tâche 11 de la [feuille de route](../../docs/feuille-de-route.md)).
