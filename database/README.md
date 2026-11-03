# Base de données

PostgreSQL 16 (ou plus récent). C'est ici que vivent les données des clients, des contrats et de la caisse, et c'est ici que sont appliquées les règles qui ne doivent jamais être contournées, même par une erreur de l'application.

## Contenu

| Dossier ou fichier | Rôle |
| --- | --- |
| `initialisation/01_roles_et_base.sql` | Crée les comptes de la base et la base elle-même. Une seule fois, par l'administrateur du serveur. |
| `initialisation/02_premier_gerant.sql` | Crée le premier gérant, après les migrations. |
| `migrations/` | Évolutions du schéma, numérotées (`0001_…`, `0002_…`). Une migration appliquée ne se modifie plus : on en écrit une nouvelle. |
| `migrer.sh` | Applique les migrations manquantes, dans l'ordre, et refuse une migration modifiée après coup. |
| `tests/` | Tests de sécurité et des règles métier, lancés par `tests/executer.sh` et par l'intégration continue. |
| `donnees-de-test/` | Jeux de données **fictifs** pour le développement. Jamais de vraies données clients. |

## Ce que la base garantit

Ces garanties sont vérifiées par `tests/01_securite_et_regles.sql` et `tests/02_authentification.sql` (90 contrôles) :

- **Fermeture par défaut.** Sans utilisateur authentifié dans la transaction, aucune donnée métier n'est lisible ni modifiable.
- **Cloisonnement par rôle**, ligne par ligne : l'apporteur ne voit que ses clients, le commercial ne voit pas la caisse, l'auditeur ne modifie rien. Matrice complète : [`docs/securite/controle-des-acces.md`](../docs/securite/controle-des-acces.md).
- **Un utilisateur désactivé perd l'accès immédiatement**, même si sa session est encore ouverte.
- **Auteur imposé** : chaque création porte l'identité de l'utilisateur authentifié. L'application ne peut pas écrire au nom de quelqu'un d'autre.
- **Caisse inaltérable** : un encaissement n'est jamais modifié ni supprimé. Une erreur se corrige par une contre-passation, réservée au gérant, exacte et unique.
- **Plafond de 1 000 000 F CFA d'espèces par police**, vérifié même si deux caisses encaissent en même temps.
- **Références obligatoires** pour le Mobile Money, les chèques et les virements, et pas de double enregistrement d'une même transaction.
- **Code CIMA, art. 13** : un contrat ne passe « en vigueur » qu'une fois la prime entièrement payée.
- **Reversements à la compagnie** : un bordereau préparé par une personne est validé par une autre (principe des quatre yeux), puis figé une fois versé. Le délai de 30 jours (art. 542) est suivi dans `app.v_encaissements_a_reverser`.
- **Identifiants jamais en clair** : mots de passe hachés (Argon2id, contrôlé par la base), secrets du deuxième facteur chiffrés, jetons de session réduits à leur empreinte. Une fois un utilisateur déclaré, seul un gérant touche aux identifiants d'un autre. Journal de sécurité en ajout seul.
- **Journal d'audit** en ajout seul : chaque écriture est consignée avec son auteur. Chaque ligne contient l'empreinte de la précédente, si bien qu'une falsification, même par un administrateur, est détectée par `audit.verifier_chaine()`.

## Comptes de la base

| Compte | Peut se connecter | Usage |
| --- | --- | --- |
| `dbs_proprietaire` | oui | Migrations uniquement. Jamais utilisé par l'application. |
| `dbs_application` | oui | Compte de l'API. Hérite de `dbs_api`, rien de plus. |
| `dbs_api` | non | Droits de l'application : lecture et écriture filtrées ligne par ligne, aucun droit de suppression. |
| `dbs_audit` | non | Lecture et vérification du journal d'audit, sans accès aux données métier. |

Les mots de passe ne sont jamais écrits dans le dépôt : voir [`docs/securite/gestion-des-secrets.md`](../docs/securite/gestion-des-secrets.md).

## Installer une base

```bash
# 1. Comptes et base (administrateur du serveur, une seule fois)
psql -U postgres -d postgres -v base=dbs -f database/initialisation/01_roles_et_base.sql
# puis définir les mots de passe : \password dbs_proprietaire et \password dbs_application

# 2. Schéma (compte propriétaire)
PGUSER=dbs_proprietaire PGDATABASE=dbs ./database/migrer.sh

# 3. Premier gérant, puis son mot de passe provisoire (apps/api/README.md)
psql -U dbs_proprietaire -d dbs -v email=prenom.nom@exemple.ci -v nom='Prénom NOM' \
     -f database/initialisation/02_premier_gerant.sql
DATABASE_URL_PROPRIETAIRE=… npm run premier-acces -w @dbs/api -- prenom.nom@exemple.ci
```

## Comment l'API s'en sert

L'API se connecte avec `dbs_application`. Pour chaque requête d'un utilisateur authentifié (mot de passe et deuxième facteur), elle ouvre une transaction et déclare qui agit :

```sql
BEGIN;
SELECT set_config('app.utilisateur_id', '<identifiant de l''utilisateur>', true);
-- … requêtes de la page …
COMMIT;
```

Le `true` limite la valeur à la transaction : une connexion réutilisée ne garde jamais l'identité du client précédent. Les transactions restent au niveau d'isolation par défaut (`READ COMMITTED`), dont dépend le chaînage du journal d'audit.

## Lancer les tests

Sur un serveur PostgreSQL **de test** (la base `dbs_tests` est supprimée puis recréée) :

```bash
PGHOST=localhost PGUSER=postgres PGPASSWORD=… ./database/tests/executer.sh
```

## Écrire une migration

1. Créez `migrations/000N_description_courte.sql` (minuscules, chiffres et `_`).
2. Pour chaque nouvelle table : clé primaire `uuid`, activation de la sécurité ligne par ligne (`ENABLE ROW LEVEL SECURITY`), politiques pour chaque rôle concerné, droits par colonne, déclencheurs `a_auteur` et `z_journal`.
3. Ajoutez les tests correspondants dans `tests/`.
4. Ne modifiez jamais une migration déjà fusionnée dans `main`.

Choix de conception : [`docs/architecture/adr/0004-securite-dans-la-base.md`](../docs/architecture/adr/0004-securite-dans-la-base.md).
