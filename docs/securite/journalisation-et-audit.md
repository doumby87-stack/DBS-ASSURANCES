# Journalisation et audit

Deux journaux distincts, aux usages différents.

## 1. Journal d'audit (dans la base)

**Ce qu'il contient** : chaque création, modification ou suppression de donnée métier (clients, véhicules, contrats, encaissements, reversements, sinistres, utilisateurs), avec l'état avant et après, l'utilisateur, le compte de base et l'heure.

**Pourquoi on peut s'y fier** :

- il est en ajout seul : modification, suppression et vidage refusés, même pour le propriétaire de la base ;
- l'application n'a aucun accès au schéma `audit`, ni en lecture ni en écriture ;
- chaque ligne contient l'empreinte SHA-256 de la précédente : `audit.verifier_chaine()` signale la première ligne modifiée ou supprimée.

**Limite et parade** : un administrateur qui supprimerait les *dernières* lignes ne casse pas la chaîne. C'est pourquoi la dernière empreinte (`derniere_empreinte`, renvoyée par `audit.verifier_chaine()`) est copiée **chaque jour hors de la base** (e-mail au gérant et stockage hors site). Si la chaîne du lendemain ne prolonge pas l'empreinte de la veille, il y a eu suppression.

**Qui le lit** : le rôle `dbs_audit` (gérant via un outil dédié, expert-comptable, contrôleur). Le back-office affichera l'historique d'une fiche au gérant (tâche 4).

**Conservation** : 10 ans au moins, comme les pièces comptables et les dossiers d'identification des clients ([lutte contre le blanchiment](../conformite/lbc-ft.md)).

## 2. Journal technique (de l'API)

**Ce qu'il contient** : démarrages, erreurs, temps de réponse, et les événements de sécurité :

- connexions réussies et échouées, déconnexions, blocages ;
- création, désactivation, changement de rôle d'un compte ;
- activation ou réinitialisation d'un deuxième facteur ;
- exports de données ;
- notifications de paiement rejetées (signature invalide, doublon).

**Ce qu'il ne contient jamais** : mots de passe, codes de connexion, jetons, numéros de pièce d'identité, contenu des messages clients, données médicales.

**Conservation** : 12 mois, puis suppression automatique.

## Contrôles réguliers

| Fréquence | Contrôle | Qui |
| --- | --- | --- |
| Chaque jour (automatique) | `audit.verifier_chaine()` et copie de la dernière empreinte | Script programmé, alerte au gérant |
| Chaque semaine | Échecs de connexion, comptes bloqués, exports | Gérant |
| Chaque trimestre | Revue des comptes et des rôles ([contrôle des accès](controle-des-acces.md)) | Gérant |
