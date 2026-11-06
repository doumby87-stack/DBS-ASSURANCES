# Facture normalisée électronique (FNE)

## Le cadre

La Direction générale des impôts a rendu la **facture normalisée électronique** obligatoire en 2025, par étapes selon le régime fiscal : 1er juin 2025 pour le régime réel normal, 1er juillet pour les microentreprises, 1er août pour le régime simplifié, 1er septembre pour le régime de l'entreprenant. Les factures peuvent être émises depuis la plateforme FNE, depuis son application officielle, ou depuis un logiciel relié par API.

Sources : [Sage](https://www.sage.com/fr-ma/blog/la-fne-en-cote-divoire-guide-complet-sage-cote-divoire/), [Edicom](https://edicomgroup.com/fr/blog/obligation-facturation-electronique-cote-d-ivoire).

## Les assurances sont-elles concernées ? (recherche du 3 novembre 2026)

Les textes officiels de la DGI n'ont pas pu être consultés directement ; les sources secondaires se contredisent :

- **Exception probable pour les compagnies** : une procédure de la DGI antérieure à 2025 range « les banques ; les compagnies d'assurances » parmi les exceptions à la facture normalisée ([PDF DGI](https://www.dgi.gouv.ci/assets/documents/PROCEDURE_D_EDITION_DE_LA_FACTURE_NORMALISEE_ACTUALISE.pdf)). Une autre source rattache cette exception à l'article 145 du Livre de procédures fiscales ([Financesao](https://financesao.com/cote-divoire-amendes-en-cas-de-non-respect-de-la-facture-normalisee-electronique/)).
- **Avis contraire** : d'autres sources placent banques et assurances parmi les entreprises concernées ([Finself](https://finself.ci/facture-electronique-en-cote-divoire/), [Digital Mag](https://digitalmag.ci/cote-divoire-tout-savoir-sur-la-facture-normalisee-electronique-fne/)).
- **Rien sur les intermédiaires** : aucune source ne mentionne d'exception pour les agents généraux ou les courtiers.
- Une source indique que seules les FNE permettent de justifier une charge ou de déduire la TVA : les factures des fournisseurs de l'agence doivent donc être des FNE.

## Ce qui concerne DBS-ASSURANCES

L'exception, si elle existe, vise les **compagnies** (SanlamAllianz pour ses quittances de prime). DBS-ASSURANCES est un **intermédiaire** (SARL). Par prudence, on considère donc que :

- les **quittances de prime** restent émises au nom de SanlamAllianz : ce ne sont pas des factures de l'agence ;
- les **factures de l'agence** (commissions facturées à la compagnie, frais de dossier ou honoraires éventuels) relèvent de la FNE, sauf avis contraire du comptable.

Questions à poser au comptable ou au centre des impôts (tâche 2) :

1. DBS-ASSURANCES doit-elle émettre une FNE pour ses commissions facturées à SanlamAllianz ?
2. Les quittances de prime relèvent-elles uniquement de SanlamAllianz ?
3. Quel est le régime fiscal de DBS-ASSURANCES, et donc sa date d'obligation ?

## Dans l'outil (tâche 12, [ADR 0013](../architecture/adr/0013-conformite-et-pilotage.md))

- **En place** (faible volume) : la facture est émise sur la plateforme FNE ; le gérant note son numéro, sa date et son montant dans le back-office (page Commissions). Une facture par mois de commissions ; le rapprochement mensuel signale « À émettre » quand le relevé de la compagnie est saisi sans facture. Une facture erronée s'annule (avoir FNE) avec son motif, puis la bonne se saisit.
- **Plus tard**, si le volume le justifie : liaison par API, factures générées depuis les relevés de commissions ; accès FNE rangés comme tous les secrets ([gestion des secrets](../securite/gestion-des-secrets.md)).
