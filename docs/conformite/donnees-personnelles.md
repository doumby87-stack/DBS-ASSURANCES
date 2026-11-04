# Données personnelles (loi n° 2013-450 et ARTCI)

## Le cadre

- La **loi n° 2013-450 du 19 juin 2013** relative à la protection des données à caractère personnel s'applique à tout traitement fait en Côte d'Ivoire.
- L'autorité de protection est l'**ARTCI**. Les traitements sont soumis à une **formalité préalable** auprès d'elle (déclaration, et autorisation pour certains traitements).
- Le **transfert de données vers un pays tiers** est soumis à **autorisation préalable** de l'ARTCI, et interdit vers les pays qui n'assurent pas une protection adéquate.

Sources : [CIO Mag](https://cio-mag.com/?p=38189), [Osiris](https://www.osiris.sn/Cote-d-Ivoire-Que-risquent-les.html). La numérotation des articles varie selon les sources : se référer au texte officiel publié par l'ARTCI.

## Où nous en sommes

Aujourd'hui, le site n'enregistre rien : le formulaire prépare un message que le visiteur envoie lui-même. **Avant que le back-office ou le formulaire enregistre la moindre donnée** (tâches 4 et 7), il faut :

- [ ] faire la formalité auprès de l'ARTCI pour les traitements ci-dessous, et obtenir le récépissé ou l'autorisation ;
- [ ] obtenir l'autorisation de transfert si l'hébergement ou des sauvegardes sont hors de Côte d'Ivoire ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)) ;
- [ ] mettre à jour la section « Données personnelles » des mentions légales et retirer « Rien n'est enregistré sur ce site » ;
- [ ] signer avec chaque sous-traitant un engagement de confidentialité et de sécurité.

## Registre des traitements (projet)

| Traitement | Finalité | Données | Destinataires | Conservation | Hébergement |
| --- | --- | --- | --- | --- | --- |
| Demandes de devis | Répondre et établir un devis | Nom, téléphone, e-mail, commune, besoin, carte grise | Agence, SanlamAllianz | 12 mois sans suite | ADR 0006 |
| Gestion des clients et contrats | Souscription, renouvellement, attestations | Identité, coordonnées, pièce d'identité (chiffrée), véhicules, contrats | Agence, SanlamAllianz, ASACI (attestations) | Contrat + 10 ans | ADR 0006 |
| Encaissements et reversements | Caisse, obligations CIMA | Montants, modes, références de paiement | Agence, SanlamAllianz, prestataire de paiement | 10 ans | ADR 0006 |
| Sinistres | Déclaration et suivi | Circonstances, photos, constats, parfois données médicales | Agence, SanlamAllianz, experts | Clôture + 10 ans | ADR 0006 |
| Relances | Prévenir des échéances | Nom, téléphone, échéance | Agence, Meta (WhatsApp), opérateur SMS | Durée du contrat | Hors de Côte d'Ivoire (Meta) |
| Lutte contre le blanchiment | Obligation légale | Identification, bénéficiaires effectifs, alertes | Agence, correspondant LBC/FT de SanlamAllianz | Fin de relation + 10 ans | ADR 0006 |
| Comptes du personnel | Sécurité des accès | Nom, e-mail, rôle, journaux de connexion | Agence | Départ + 1 an (journal d'audit : 10 ans) | ADR 0006 |

## Droits des personnes

Accès, rectification, opposition et suppression (dans les limites des obligations légales de conservation). Demande par e-mail ou à l'agence ; réponse sous un mois. Le back-office aura un module pour extraire les données d'une personne et tracer chaque demande (tâche 12).

## Sous-traitants prévus

Hébergeur (ADR 0006), Meta (WhatsApp Business), opérateur SMS, prestataire de paiement (CinetPay ou autre), Netlify (site vitrine, sans donnée personnelle tant que le formulaire n'enregistre rien).
