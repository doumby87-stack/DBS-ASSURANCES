# Décisions d'architecture (ADR)

Chaque décision importante est écrite ici, avec son contexte et ses conséquences, pour qu'on sache plus tard **pourquoi** le projet est fait ainsi. Une décision ne se modifie pas : si elle change, on écrit une nouvelle ADR qui la remplace.

| N° | Décision | Statut |
| --- | --- | --- |
| [0001](0001-depot-unique.md) | Un dépôt unique, seul le site vitrine est publié | Acceptée |
| [0002](0002-pile-technique.md) | TypeScript de bout en bout, PostgreSQL | Acceptée |
| [0003](0003-api-seule-porte-d-acces.md) | L'API est la seule porte d'accès aux données | Acceptée |
| [0004](0004-securite-dans-la-base.md) | Les règles critiques et les droits sont aussi appliqués par la base | Acceptée |
| [0005](0005-authentification.md) | Deuxième facteur pour le personnel, code à usage unique pour les clients | Acceptée (personnel en place) |
| [0006](0006-hebergement-et-localisation-des-donnees.md) | Hébergement et localisation des données | En attente (ARTCI) |
| [0007](0007-relances-whatsapp-et-sms.md) | Relances automatiques : WhatsApp (API Cloud de Meta) et SMS, avec consentement | Proposée |
| [0008](0008-site-vitrine-astro.md) | Site vitrine en plusieurs pages, construit par Astro, sans aucun script tiers | Acceptée |
| [0009](0009-demandes-de-devis-du-site.md) | Demandes de devis du site enregistrées par l'API, carte grise chiffrée en base | Acceptée (mise en service après l'ARTCI) |
| [0010](0010-flottes.md) | Flottes : import contrôlé, avenants au prorata calculés par la base, rappels groupés par client | Acceptée |

## Modèle

```markdown
# NNNN — Titre

- Statut : Proposée | Acceptée | Remplacée par NNNN
- Date : AAAA-MM-JJ

## Contexte
Le problème, les contraintes.

## Décision
Ce qui est décidé.

## Conséquences
Ce que ça implique, en bien et en moins bien.

## Options écartées
Et pourquoi.
```
