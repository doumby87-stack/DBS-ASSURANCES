# Sauvegardes et reprise d'activité

## Objectifs

| Objectif | Valeur | Signification |
| --- | --- | --- |
| Perte de données maximale (RPO) | 15 minutes | Archivage continu des journaux de transactions de PostgreSQL, en plus de la sauvegarde quotidienne. |
| Remise en service (RTO) | 4 heures en journée ouvrée | Délai pour retrouver le back-office après une panne majeure. |

## Ce qui est sauvegardé

| Quoi | Fréquence | Conservation |
| --- | --- | --- |
| Base de données (complète) | Chaque nuit | 30 jours de sauvegardes quotidiennes, 12 mensuelles |
| Journaux de transactions | En continu | 7 jours (restauration à la minute près) |
| Fichiers déposés (constats, photos, pièces) | Chaque nuit | Comme la base |
| Dernière empreinte du journal d'audit | Chaque jour | 10 ans |
| Configuration de l'infrastructure | Dans le dépôt Git | Historique complet |

## Règle 3-2-1

- **3 copies** : la base en service, une sauvegarde chez l'hébergeur, une chez un second fournisseur.
- **2 supports** différents.
- **1 copie hors site, chiffrée et immuable** (stockage en écriture unique) : ni l'hébergeur principal, ni un attaquant qui aurait pris le contrôle des serveurs ne peut l'effacer.

Les sauvegardes sont chiffrées avant de quitter le serveur. La clé est rangée séparément ([gestion des secrets](gestion-des-secrets.md)). Leur localisation est couverte par la déclaration à l'ARTCI ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).

## Test de restauration, chaque mois

1. Restaurer la dernière sauvegarde sur une base isolée.
2. Lancer `audit.verifier_chaine()` : aucune anomalie, et la chaîne prolonge l'empreinte copiée hors site.
3. Comparer quelques totaux avec la production (nombre de contrats, total encaissé du mois).
4. Noter la date, la durée de restauration et le résultat dans le registre des tests.

Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

## Si le back-office est indisponible

L'agence continue de travailler : reçus manuels pré-numérotés (carnet à souches tenu par le gérant), saisis dans le système dès son retour, avec la date réelle de l'encaissement (acceptée jusqu'à 30 jours en arrière).
