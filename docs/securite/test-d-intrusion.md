# Test d'intrusion

Avant l'ouverture au public, un prestataire **indépendant** (qui n'a pas écrit le code et ne l'héberge pas) essaie d'entrer comme le ferait un attaquant. Ce document est le cahier des charges à lui remettre ; il se complète avec lui avant de signer.

## Quand

| Moment | Périmètre |
| --- | --- |
| Avant l'ouverture du back-office et de l'espace client à des données réelles | Complet (ci-dessous) |
| Chaque année | Complet |
| Après un changement majeur (paiement en ligne réel, nouvel hébergeur, nouvel accès pour les clients) | Ce qui a changé, et ce qui en dépend |

## Cadre

- **Autorisation écrite et signée** par le gérant avant toute action : périmètre, dates, adresses IP du prestataire, contacts, conditions d'arrêt. Sans elle, le test est une attaque au sens de la loi ivoirienne sur la cybercriminalité (loi n° 2013-451).
- **Accord de l'hébergeur** si son contrat l'exige (certains demandent d'être prévenus).
- **Environnement de recette** identique à la production (`infra/production`, mêmes images, mêmes réglages), avec **des données fictives uniquement** ([infrastructure](../../infra/README.md)). Le serveur de production n'est testé que pour sa configuration extérieure (HTTPS, en-têtes, ports ouverts), sans essai d'écriture.
- **Comptes de test** fournis au prestataire : un par rôle (gérant, chargé de clientèle, caissier, commercial, apporteur, auditeur), deux entreprises clientes avec leur titulaire et un collaborateur, un particulier. Les comptes sont désactivés à la fin.
- **Confidentialité** : accord de confidentialité ; le rapport n'est remis qu'au gérant et au prestataire technique ; le prestataire efface ses copies après la contre-visite.
- **Arrêt immédiat** et appel du gérant si le prestataire trouve une faille critique, ou des données qui semblent réelles.

## Périmètre

**Dans le périmètre** :

| Cible | Ce qui est attendu en particulier |
| --- | --- |
| Back-office (`gestion.…`) et son API (`/api`) | Contournement des droits entre rôles (un commercial qui voit la caisse, un apporteur les clients des autres, un auditeur qui écrit), accès direct à une fiche par son identifiant, contournement du deuxième facteur, sessions (fixation, expiration, déconnexion), requêtes forcées depuis un autre site, injection (SQL, script), énumération des comptes, limitation des tentatives |
| Espace client (`client.…`) et son API | **Isolement entre clients** : une entreprise ne doit jamais voir les véhicules, attestations, paiements ou sinistres d'une autre ; codes de connexion (devinette, réutilisation) ; dépôt de photos de sinistre |
| Dépôt de fichiers (cartes grises, justificatifs, photos, attestations) et lecture automatique | Fichiers piégés (faux types, fichiers polyglottes, archives, images démesurées), saturation du serveur, contournement de l'antivirus |
| Notifications reçues (WhatsApp, paiement) | Notifications fabriquées ou rejouées |
| Formulaires publics du site vitrine (demande de devis, rappel d'échéance, appel d'offres, rendez-vous) | Envoi massif, contournement des limites, injection |
| Serveur | Ports ouverts, configuration HTTPS, en-têtes, accès SSH (sans attaque par force brute prolongée), isolement des conteneurs (la base ne doit être joignable que par l'API) |
| Stockage hors site des sauvegardes | La clé d'accès du serveur ne doit pas pouvoir **supprimer** ni **remplacer** une sauvegarde |

**Hors du périmètre** : déni de service (saturation volontaire), hameçonnage du personnel (sauf exercice convenu à part avec le gérant), systèmes de SanlamAllianz, de Meta (WhatsApp), des opérateurs Mobile Money et de l'hébergeur lui-même.

## Méthode attendue

Référentiel OWASP : **ASVS niveau 2** et le Top 10 des applications web ; tests manuels en plus des outils automatiques. Le prestataire reçoit la documentation (ce dossier `docs/`), et l'accès en lecture au code s'il le demande (test en « boîte grise », plus efficace pour un budget donné).

## Ce qui est remis

1. **Un rapport** : résumé pour le gérant (une page, sans jargon), puis chaque faille avec sa gravité (CVSS), la façon de la reproduire, son impact concret pour l'agence et la correction conseillée.
2. **Une contre-visite** après correction, comprise dans le prix, avec une attestation de fin de test.

## Après le test

- Failles **critiques et élevées** : corrigées avant l'ouverture, vérifiées à la contre-visite.
- Failles **moyennes** : corrigées sous 30 jours ; **faibles** : planifiées.
- Chaque faille corrigée reçoit un test automatique qui l'empêche de revenir, et le [modèle de menaces](modele-de-menaces.md) est mis à jour.
- Le rapport et l'attestation sont gardés avec les documents de conformité (ils peuvent être demandés par SanlamAllianz ou l'ARTCI).

## Choisir le prestataire

- Indépendant de l'hébergeur et du prestataire technique.
- Références sur des applications web traitant des données personnelles ou financières ; testeurs nommés, avec une certification reconnue en test d'intrusion.
- Accepte ce cadre par écrit (autorisation, confidentialité, effacement des copies, contre-visite).
- Demander deux ou trois devis sur ce document.
