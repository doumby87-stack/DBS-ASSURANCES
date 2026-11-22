# Journalisation et audit

Deux journaux distincts, aux usages différents.

## 1. Journal d'audit (dans la base)

**Ce qu'il contient** : chaque création, modification ou suppression de donnée métier (clients, véhicules, contrats, encaissements, reversements, clôtures de caisse, taux et relevés de commissions, sinistres, utilisateurs), avec l'état avant et après, l'utilisateur, le compte de base et l'heure.

**Pourquoi on peut s'y fier** :

- il est en ajout seul : modification, suppression et vidage refusés, même pour le propriétaire de la base ;
- l'application n'a aucun accès au schéma `audit`, ni en lecture ni en écriture ;
- chaque ligne contient l'empreinte SHA-256 de la précédente : `audit.verifier_chaine()` signale la première ligne modifiée ou supprimée.

**Limite et parade** : un administrateur qui supprimerait les *dernières* lignes ne casse pas la chaîne. C'est pourquoi, à chaque sauvegarde de la nuit, la base vérifie que la dernière empreinte vue la nuit précédente s'y trouve toujours (sinon, alerte grave sur la page Exploitation), et la nouvelle dernière empreinte est copiée **hors de la base**, dans un fichier à part envoyé avec la sauvegarde sur le stockage hors site en écriture unique. Un superutilisateur qui effacerait aussi le compte rendu des sauvegardes ne pourrait pas effacer ces fichiers : le test de restauration du mois vérifie que l'empreinte notée s'y trouve ([sauvegardes](../../infra/sauvegardes/README.md)).

**Qui le lit** : le rôle `dbs_audit` (gérant via un outil dédié, expert-comptable, contrôleur). Le back-office affichera l'historique d'une fiche au gérant (tâche 4).

**Conservation** : 10 ans au moins, comme les pièces comptables et les dossiers d'identification des clients ([lutte contre le blanchiment](../conformite/lbc-ft.md)).

**Données personnelles des prospects** : une table peut demander que certaines colonnes ne soient pas recopiées dans le journal. Les demandes reçues par le site l'utilisent (nom, téléphone, e-mail, commune, besoin, empreinte de l'adresse IP) : elles sont supprimées 12 mois après leur classement sans suite, et le journal, conservé bien plus longtemps, ne doit pas les garder à leur place. Il garde qui a reçu, traité ou purgé quelle demande, et quand ([ADR 0009](../architecture/adr/0009-demandes-de-devis-du-site.md)).

Les événements de sécurité sont aussi enregistrés dans la base, dans `securite.evenements`, en ajout seul : connexions et échecs, blocages, comptes, deuxième facteur, exports de données, téléchargements des cartes grises jointes aux demandes du site, lectures automatiques de documents (qui, quel document de quel client ; jamais les valeurs lues).

## 2. Journal technique (de l'API)

**Ce qu'il contient** : démarrages, erreurs, temps de réponse, et les événements de sécurité :

- connexions réussies et échouées, déconnexions, blocages ;
- création, désactivation, changement de rôle d'un compte ;
- activation ou réinitialisation d'un deuxième facteur ;
- exports de données (bordereaux exportés pour Excel : qui, quand, lequel, depuis quelle adresse) ;
- notifications de paiement rejetées (signature invalide, doublon) ;
- lectures automatiques de documents : document, issue (lu, refusé, illisible, indisponible) et durée, sans les valeurs lues.

**Ce qu'il ne contient jamais** : mots de passe, codes de connexion, jetons, cookies, numéros de pièce d'identité, contenu des messages clients, données médicales, paramètres des adresses (une recherche peut contenir un nom ou un téléphone : l'API, comme le serveur web, n'en garde que le chemin).

**Conservation** : 12 mois, puis suppression automatique.

## Contrôles réguliers

| Fréquence | Contrôle | Qui |
| --- | --- | --- |
| Chaque nuit (automatique) | `audit.verifier_chaine()` à chaque sauvegarde, présence de la dernière empreinte de la veille, copie de la nouvelle hors site avec la sauvegarde | Service de sauvegarde ; alerte grave sur la page Exploitation, et plus de battement de cœur envoyé à la surveillance ([surveillance](../../infra/surveillance/README.md)) |
| Chaque semaine | Échecs de connexion, comptes bloqués, exports | Gérant |
| Chaque trimestre | Revue des comptes et des rôles ([contrôle des accès](controle-des-acces.md)) | Gérant |
