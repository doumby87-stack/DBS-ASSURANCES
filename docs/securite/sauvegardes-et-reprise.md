# Sauvegardes et reprise d'activité

## Objectifs

| Objectif | Valeur | Signification |
| --- | --- | --- |
| Perte de données maximale (RPO) | 15 minutes | Restauration à la minute près de la base gérée par l'hébergeur, en plus des sauvegardes chiffrées. Avec la base sur le serveur, la perte maximale est l'intervalle entre deux sauvegardes : plusieurs par jour, accepté par écrit par le gérant ([ADR 0017](../architecture/adr/0017-mise-en-production.md)). |
| Remise en service (RTO) | 4 heures en journée ouvrée | Délai pour retrouver le back-office après une panne majeure. |

## Ce qui est sauvegardé

| Quoi | Fréquence | Conservation |
| --- | --- | --- |
| Base de données (complète), chiffrée | Chaque nuit, ou plusieurs fois par jour | 30 jours de sauvegardes quotidiennes, 12 mensuelles |
| Journaux de transactions | En continu, par l'hébergeur (base gérée) | 7 jours au moins (restauration à la minute près) |
| Fichiers déposés (constats, photos, pièces) | Dans la base, chiffrés : sauvegardés avec elle | Comme la base |
| Dernière empreinte du journal d'audit | À chaque sauvegarde, hors de la base | Jamais supprimée (10 ans au moins) |
| Configuration de l'infrastructure | Dans le dépôt Git | Historique complet |

## Règle 3-2-1

- **3 copies** : la base en service, une sauvegarde chez l'hébergeur, une chez un second fournisseur.
- **2 supports** différents.
- **1 copie hors site, chiffrée et immuable** (stockage en écriture unique) : ni l'hébergeur principal, ni un attaquant qui aurait pris le contrôle des serveurs ne peut l'effacer.

Les sauvegardes sont chiffrées avant de quitter le serveur. La clé est rangée séparément ([gestion des secrets](gestion-des-secrets.md)). Leur localisation est couverte par la déclaration à l'ARTCI ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).

## Test de restauration, chaque mois

Automatique, le 1er de chaque mois (`infra/sauvegardes/tester-restauration.sh`) :

1. Restaurer la dernière sauvegarde sur une base isolée, après contrôle de son empreinte.
2. Lancer `audit.verifier_chaine()` : aucune anomalie, et l'empreinte notée hors de la base au moment de la sauvegarde se retrouve dans le journal restauré.
3. Relever quelques totaux (clients, contrats, total encaissé du mois), à comparer avec la production.
4. Noter la date, la durée et le résultat dans le registre des tests (`registre-restaurations.log`) ; alerte en cas d'échec.

Le gérant relit le registre chaque mois. Une fois par an, le prestataire exerce la reprise complète sur un serveur neuf ([mise en service](../../infra/production/mise-en-service.md), « Reprise après incident »). Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

Outils et fonctionnement : [infra/sauvegardes](../../infra/sauvegardes/README.md).

## Si le back-office est indisponible

L'agence continue de travailler : reçus manuels pré-numérotés (carnet à souches tenu par le gérant), saisis dans le système dès son retour, avec la date réelle de l'encaissement (acceptée jusqu'à 30 jours en arrière).
