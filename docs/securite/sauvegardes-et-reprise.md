# Sauvegardes et reprise d'activité

Mise en œuvre : [`infra/sauvegardes`](../../infra/sauvegardes/README.md) (scripts, test mensuel, reprise après sinistre) et [ADR 0016](../architecture/adr/0016-mise-en-production.md).

## Objectifs

| Objectif | Valeur | Signification |
| --- | --- | --- |
| Perte de données maximale (RPO) | 15 minutes visées ; **24 heures** avec la seule sauvegarde de la nuit | Les 15 minutes demandent l'archivage continu des journaux de transactions : restauration à un instant donné d'une base gérée par l'hébergeur, ou pgBackRest sur une base installée sur le serveur. À mettre en place avec le choix de l'hébergeur. En attendant, les reçus manuels couvrent la journée perdue. |
| Remise en service (RTO) | 4 heures en journée ouvrée | Délai pour retrouver le back-office après une panne majeure ([reprise après un sinistre](../../infra/sauvegardes/README.md#reprise-après-un-sinistre--restaurer-la-production-pour-de-vrai)). |

## Ce qui est sauvegardé

| Quoi | Fréquence | Conservation |
| --- | --- | --- |
| Base de données (complète) | Chaque nuit, chiffrée par clé publique | 7 jours sur le serveur ; 30 jours de sauvegardes quotidiennes hors site, puis 12 mensuelles |
| Journaux de transactions | En continu, avec une base gérée ou pgBackRest (voir ci-dessus) | 7 jours (restauration à la minute près) |
| Fichiers déposés (cartes grises, justificatifs, photos de sinistres, attestations) | Dans la base, chiffrés : dans la même sauvegarde | Comme la base |
| Dernière empreinte du journal d'audit | Chaque nuit, dans un fichier à part copié hors site avec la sauvegarde | 10 ans |
| Compte rendu de chaque sauvegarde et de chaque test de restauration | Dans la base (`exploitation`), en ajout seul | Comme la base |
| Configuration de l'infrastructure | Dans le dépôt Git (les secrets, dans le coffre-fort) | Historique complet |

## Règle 3-2-1

- **3 copies** : la base en service, une sauvegarde chez l'hébergeur, une chez un second fournisseur.
- **2 supports** différents.
- **1 copie hors site, chiffrée et immuable** (stockage en écriture unique) : ni l'hébergeur principal, ni un attaquant qui aurait pris le contrôle des serveurs ne peut l'effacer.

Les sauvegardes sont chiffrées avant de quitter le serveur. La clé est rangée séparément ([gestion des secrets](gestion-des-secrets.md)). Leur localisation est couverte par la déclaration à l'ARTCI ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).

Restaurer demande **deux clés**, rangées hors ligne : la clé privée des sauvegardes, et la clé de chiffrement des données de l'API (`CLE_CHIFFREMENT_DONNEES`), sans laquelle les pièces, les numéros de pièces d'identité et les deuxièmes facteurs restent illisibles.

Une base gérée par l'hébergeur peut refuser au compte de sauvegarde le droit de lire toutes les lignes (`BYPASSRLS`) : la sauvegarde se fait alors avec le compte d'administration fourni, ou par l'hébergeur lui-même, en gardant le test mensuel et une copie chiffrée hors site ([ADR 0016](../architecture/adr/0016-mise-en-production.md)).

## Test de restauration, chaque mois

Une commande, sur un poste de test ([mode d'emploi](../../infra/sauvegardes/README.md#test-de-restauration-chaque-mois)) :

1. Restaurer la dernière sauvegarde sur une base isolée, après avoir vérifié son empreinte.
2. Lancer `audit.verifier_chaine()` : aucune anomalie, et la chaîne contient l'empreinte notée au moment de la sauvegarde.
3. Comparer quelques totaux avec la production (clients, contrats, nombre et montant des encaissements, dernier encaissement).
4. Inscrire le résultat dans la production : la date, la durée, le résultat et la personne apparaissent dans le back-office (page Exploitation), qui alerte après 35 jours sans test.

Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

## Si le back-office est indisponible

L'agence continue de travailler : reçus manuels pré-numérotés (carnet à souches tenu par le gérant), saisis dans le système dès son retour, avec la date réelle de l'encaissement (acceptée jusqu'à 30 jours en arrière).
