# 0004 — Les règles critiques et les droits sont aussi appliqués par la base

- Statut : Acceptée
- Date : 2026-11-03

## Contexte

Une erreur dans l'API (route oubliée, contrôle de droit manquant, bogue) ne doit pas suffire à exposer des données, à fausser la caisse ou à effacer une trace. Les grands acteurs financiers empilent les barrières et ne confient jamais une opération sensible à une seule personne.

## Décision

1. **Comptes séparés** : propriétaire (migrations seulement), applicatif (sans droit de suppression), audit (journal seulement).
2. **Sécurité ligne par ligne** (`ROW LEVEL SECURITY`) sur chaque table, selon le rôle de l'utilisateur déclaré par l'API (`app.utilisateur_id`). Sans utilisateur, refus. Rôle relu à chaque requête : un compte désactivé perd l'accès aussitôt.
3. **Règles financières dans la base** : plafond des espèces, mise en vigueur après paiement complet, encaissements inaltérables, quatre yeux sur les reversements.
4. **Auteur imposé** par déclencheur : impossible d'écrire au nom d'un autre.
5. **Journal d'audit en ajout seul**, chaque ligne contenant l'empreinte SHA-256 de la précédente ; vérification par `audit.verifier_chaine()` ; dernière empreinte copiée chaque jour hors de la base.
6. **Fonctions privilégiées** (`SECURITY DEFINER`) réservées aux calculs qui doivent voir toutes les lignes (plafond, totaux), avec `search_path` figé, et sans droit d'exécution accordé par défaut.
7. Les tables ne sont pas en `FORCE ROW LEVEL SECURITY` : le propriétaire doit voir toutes les lignes pour les contrôles ci-dessus. En contrepartie, **le compte propriétaire n'est jamais utilisé par l'application**.

## Conséquences

- 64 contrôles automatiques (`database/tests`) garantissent ces propriétés à chaque modification.
- Les écritures dans le journal sont sérialisées (une transaction à la fois) : sans effet sensible au volume d'une agence, à surveiller si le volume devenait très important.
- Les transactions doivent rester au niveau d'isolation `READ COMMITTED`, dont dépend le chaînage du journal.
- Une erreur de saisie se corrige par une nouvelle écriture (contre-passation), jamais en effaçant : c'est voulu.

## Options écartées

- **Tout contrôler dans l'API** : une seule barrière.
- **Journal d'audit dans l'API** : contournable par toute écriture directe en base.
