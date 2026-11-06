# Lutte contre le blanchiment et le financement du terrorisme (LBC/FT)

## Le texte

Le **règlement n° 0031/CIMA/PCMA/PCE/SG/2025 du 10 juillet 2025** fixe les procédures que doivent appliquer les organismes d'assurance de la zone CIMA. Il s'applique aux compagnies et aux courtiers, **ainsi qu'aux opérations réalisées sous leur responsabilité, y compris par les agents généraux**. DBS-ASSURANCES est donc concernée à travers son mandat SanlamAllianz.

Points clés :

- **Connaître son client** à l'entrée en relation, puis tout au long de la relation.
- Identifier le **bénéficiaire effectif** : la personne physique qui, en dernier ressort, possède ou contrôle le client (pour une entreprise).
- Une approche **fondée sur les risques** : identifier, évaluer, gérer et contrôler les risques de blanchiment.

Sources : [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-des-assurances/1054-cima-les-procedures-relatives-a-la-lutte-contre-le-blanchiment-des-capitaux-precisees-par-un-reglement-du-10-juillet-2025), [Kalieu Elongo](https://kalieu-elongo.com/revision-du-dispositif-de-lutte-contre-le-blanchiment-des-capitaux-applicable-aux-entreprises-dassurance-de-la-cima/).

## Ce que fait l'outil (tâche 12, [ADR 0013](../architecture/adr/0013-conformite-et-pilotage.md))

| Besoin | Dans le système | Statut |
| --- | --- | --- |
| Identifier le client | Fiche d'identification sur la fiche client : pièce d'identité (numéro chiffré par l'application, affiché en entier seulement sur demande, consignée), date de naissance, nationalité, activité, adresse ; pour une entreprise, RCCM, forme juridique, compte contribuable, dirigeants et bénéficiaires effectifs. Justificatifs analysés par l'antivirus et chiffrés. Original vu par l'agence, au nom de la personne et daté. Revue tous les 3, 2 ou 1 an selon le risque (faible, normal, élevé). | ✅ |
| Approche fondée sur les risques | Niveau de risque motivé ; personne politiquement exposée (client, dirigeant ou bénéficiaire) : risque élevé d'office, origine des fonds exigée. **Aucun contrat** pour un client à risque élevé dont la fiche n'est pas complète et à jour ; pour les autres, liste des fiches à compléter (page Conformité). | ✅ (niveaux à confirmer) |
| Repérer les situations inhabituelles | Alertes : espèces à 80 % du plafond sur un contrat, paiement par un tiers (noté par le caissier), 3 paiements en espèces ou plus en 30 jours, résiliation moins de 90 jours après la prise d'effet avec prime encaissée. | ✅ (seuils à confirmer) |
| Transmettre un soupçon | Décision du gérant sur chaque alerte : classée, ou transmise au correspondant LBC/FT de la compagnie, avec son motif, sans retour possible. Alertes et décisions visibles du **seul gérant**, jamais du client. | ✅ (circuit de transmission à confirmer) |
| Garder les preuves | Fiches, justificatifs et décisions conservés sans suppression ni modification, au niveau « très sensible » ([classification](../securite/classification-des-donnees.md)) ; purge à la fin de la durée légale (10 ans dans le droit de l'UEMOA, à confirmer). | ✅ (purge à venir) |
| Former | Registre des formations du personnel (blanchiment, hameçonnage, mots de passe, procédure d'incident, données personnelles), à refaire chaque année. | ✅ |

## Déjà en place

- Plafond des espèces par police, appliqué par la base.
- Références obligatoires pour tous les paiements autres qu'en espèces.
- Journal d'audit infalsifiable de chaque encaissement.

## À demander à SanlamAllianz

- Sa procédure LBC/FT pour les agents généraux : seuils, pièces exigées, formulaires, circuit de déclaration de soupçon.
- Le nom de son correspondant LBC/FT.
