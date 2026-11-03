# Facture normalisée électronique (FNE)

## Le cadre

La Direction générale des impôts a rendu la **facture normalisée électronique** obligatoire en 2025, par étapes selon le régime fiscal : 1er juin 2025 pour le régime réel normal, 1er juillet pour les microentreprises, 1er août pour le régime simplifié, 1er septembre pour le régime de l'entreprenant. Les factures peuvent être émises depuis la plateforme FNE, depuis son application officielle, ou depuis un logiciel relié par API.

Sources : [Sage](https://www.sage.com/fr-ma/blog/la-fne-en-cote-divoire-guide-complet-sage-cote-divoire/), [Edicom](https://edicomgroup.com/fr/blog/obligation-facturation-electronique-cote-d-ivoire).

## Ce qui concerne DBS-ASSURANCES

À confirmer avec l'expert-comptable (tâche 2) :

- Les **quittances de prime** sont émises au nom de SanlamAllianz : ce ne sont pas des factures de l'agence.
- Les **factures de l'agence** (commissions facturées à la compagnie, honoraires de conseil éventuels) relèvent de la FNE selon le régime fiscal de DBS-ASSURANCES (SARL).

## Dans l'outil (tâche 12)

- Si le volume est faible : factures émises sur la plateforme FNE, numéro FNE saisi dans le back-office.
- Si le volume le justifie : liaison par API, factures générées depuis les relevés de commissions.
- Accès FNE rangés comme tous les secrets ([gestion des secrets](../securite/gestion-des-secrets.md)).
