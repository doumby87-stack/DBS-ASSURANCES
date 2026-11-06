# Données personnelles (loi n° 2013-450 et ARTCI)

## Le cadre

- La **loi n° 2013-450 du 19 juin 2013** relative à la protection des données à caractère personnel s'applique à tout traitement fait en Côte d'Ivoire.
- L'autorité de protection est l'**ARTCI**. Les traitements sont soumis à une **formalité préalable** auprès d'elle (déclaration, et autorisation pour certains traitements).
- Le **transfert de données vers un pays tiers** est soumis à **autorisation préalable** de l'ARTCI, et interdit vers les pays qui n'assurent pas une protection adéquate.

Sources : [CIO Mag](https://cio-mag.com/?p=38189), [Osiris](https://www.osiris.sn/Cote-d-Ivoire-Que-risquent-les.html). La numérotation des articles varie selon les sources : se référer au texte officiel publié par l'ARTCI.

## Où nous en sommes

Le site publié n'enregistre rien : le formulaire prépare un message que le visiteur envoie lui-même. L'enregistrement des demandes (tâche 7) est prêt mais **ne s'active que si le site est construit avec l'adresse de l'API** ([ADR 0009](../architecture/adr/0009-demandes-de-devis-du-site.md)) ; les textes du formulaire et des mentions légales changent alors d'eux-mêmes. **Avant de l'activer, et avant que le back-office enregistre la moindre donnée réelle**, il faut :

- [ ] faire la formalité auprès de l'ARTCI pour les traitements ci-dessous, et obtenir le récépissé ou l'autorisation ;
- [ ] obtenir l'autorisation de transfert si l'hébergement ou des sauvegardes sont hors de Côte d'Ivoire ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)), et avant d'activer la lecture automatique des documents chez Anthropic ([ADR 0015](../architecture/adr/0015-lecture-automatique.md)) ;
- [x] préparer la section « Données personnelles » des mentions légales et les textes du formulaire pour l'enregistrement des demandes (affichés automatiquement à l'activation) ;
- [ ] signer avec chaque sous-traitant un engagement de confidentialité et de sécurité.

## Registre des traitements (projet)

| Traitement | Finalité | Données | Destinataires | Conservation | Hébergement |
| --- | --- | --- | --- | --- | --- |
| Demandes de devis du site | Répondre et établir un devis | Nom, téléphone, e-mail, commune, besoin, carte grise (chiffrée), texte des cases cochées, empreinte de l'adresse IP (limite des envois) | Agence, SanlamAllianz | Sans suite ou jamais traitée : supprimée avec sa carte grise 12 mois après (purge automatique) ; convertie : comme le dossier client | ADR 0006 |
| Rappels d'échéance demandés sur le site | Rappeler avant l'échéance avec un devis | Nom, téléphone, e-mail, assurance, date d'échéance, texte des cases cochées, empreinte de l'adresse IP | Agence | Jamais traité : supprimé 12 mois après l'échéance ; sans suite : 12 mois après ; converti : comme le dossier client | ADR 0014 |
| Appels d'offres reçus par le site | Conseiller l'entreprise et établir la proposition | Raison sociale, téléphone, e-mail, description du marché, garanties exigées, date limite | Agence, SanlamAllianz | Comme les demandes de devis | ADR 0014 |
| Rendez-vous | Recevoir ou appeler la personne | Nom, téléphone, e-mail, motif, message, jour et heure, personne de l'agence | Agence | Prospect : supprimé 12 mois après la clôture ; client : comme son dossier | ADR 0014 |
| Gestion des clients et contrats | Souscription, renouvellement, attestations | Identité, coordonnées, pièce d'identité (chiffrée), véhicules, contrats | Agence, SanlamAllianz, ASACI (attestations) | Contrat + 10 ans | ADR 0006 |
| Encaissements et reversements | Caisse, obligations CIMA | Montants, modes, références de paiement | Agence, SanlamAllianz, prestataire de paiement | 10 ans | ADR 0006 |
| Sinistres | Déclaration et suivi | Circonstances, photos, constats, parfois données médicales | Agence, SanlamAllianz, experts | Clôture + 10 ans | ADR 0006 |
| Relances | Prévenir des échéances, des devis restés sans réponse et de l'avancement des sinistres | Nom, téléphone, branche, n° de police, dates ; accord ou refus du client et sa preuve | Agence, Meta (WhatsApp), opérateur SMS | Durée du contrat ; preuve du consentement : tant que la relation dure, puis 5 ans | Hors de Côte d'Ivoire (Meta) |
| Lutte contre le blanchiment | Obligation légale | Identification, bénéficiaires effectifs, alertes | Agence, correspondant LBC/FT de SanlamAllianz | Fin de relation + 10 ans | ADR 0006 |
| Lecture automatique des documents (si activée) | Pré-remplir les fiches, vérifiées par une personne | Image de la carte grise, de la pièce d'identité ou du constat, le temps de la lecture ; journal : qui, quand, quel document | Agence, Anthropic (sous-traitant) | Images et valeurs lues : rien n'est gardé par l'agence en dehors des fiches enregistrées ; chez Anthropic : selon le contrat ; journal : comme le journal de sécurité | Hors de Côte d'Ivoire (Anthropic) |
| Comptes du personnel | Sécurité des accès | Nom, e-mail, rôle, journaux de connexion | Agence | Départ + 1 an (journal d'audit : 10 ans) | ADR 0006 |

## Relances et consentement

Aucune relance automatique sans l'**accord du client pour le canal** (WhatsApp ou SMS), noté sur sa fiche avec la façon dont il l'a exprimé (accord oral au guichet, formulaire signé…). Un « STOP » envoyé sur WhatsApp retire l'accord aussitôt, sans intervention de l'agence ; un client peut aussi le retirer en appelant l'agence. Ces choix sont gardés en ajout seul : ils servent de preuve. Les messages ne contiennent que le minimum (nom, branche, n° de police, dates), jamais de montant, de pièce d'identité ni de détail médical ([modèles de messages](../metier/modeles-de-messages.md), [ADR 0007](../architecture/adr/0007-relances-whatsapp-et-sms.md)).

## Demandes reçues par le site

Le visiteur coche une case pour accepter que l'agence utilise ses informations ; le texte exact de cette case est enregistré avec la demande, comme preuve. Une seconde case, facultative, recueille son accord pour les rappels sur WhatsApp : il devient un consentement de sa fiche quand la demande est convertie, avec la case, le numéro et la date de la demande comme preuve. La carte grise est chiffrée dès sa réception ; seuls le gérant, les chargés de clientèle et les commerciaux peuvent la télécharger, et chaque téléchargement est consigné. L'adresse IP n'est pas conservée, seulement une empreinte qui sert à limiter les envois. La carte grise est analysée par un antivirus installé chez l'agence (ClamAV), sans quitter ses serveurs.

Une demande qui n'est pas devenue un devis est **supprimée automatiquement 12 mois** après son classement sans suite, ou après sa réception si personne ne l'a traitée, avec sa carte grise. Pour un rappel d'échéance jamais traité, le délai court à partir de l'échéance donnée par le visiteur ; la case qu'il coche dit qu'il accepte que l'agence garde ses informations jusque-là. Un rendez-vous qui n'est rattaché à aucun client est supprimé 12 mois après sa clôture (tâche 13). Le journal d'audit ne recopie pas les données personnelles des demandes : après la purge, il ne reste que la trace de qui a reçu, traité et supprimé quelle demande, et quand.

## Lecture automatique des documents

Désactivée tant que l'autorisation de transfert n'est pas obtenue ([ADR 0015](../architecture/adr/0015-lecture-automatique.md)). Une fois activée, une personne de l'agence choisit de faire lire un document précis ; l'image part chez Anthropic, après une analyse antivirus, et seules les valeurs lues reviennent, pour pré-remplir un formulaire que la personne vérifie et enregistre elle-même. Ni l'image ni les valeurs ne sont gardées en dehors de ce qui est enregistré dans la fiche ; le journal de sécurité note qui a fait lire quel document, sans les valeurs. Avant l'activation : contrat de sous-traitance avec Anthropic (conditions commerciales et avenant de protection des données, durée de conservation des requêtes chez lui), mention dans l'information remise aux clients.

## Droits des personnes

Accès, rectification, opposition et suppression (dans les limites des obligations légales de conservation). Demande par e-mail ou à l'agence ; réponse sous un mois. Chaque demande s'enregistre dans le registre des réclamations, objet « Données personnelles » (délais suivis, réponse tracée) ; pour une demande d'accès, le gérant exporte depuis la fiche du client toutes les données que l'agence tient sur lui, en un fichier, sans aucun contenu chiffré, et l'export est consigné (tâche 12).

## Sous-traitants prévus

Hébergeur (ADR 0006), Meta (WhatsApp Business), opérateur SMS, prestataire de paiement (CinetPay ou autre), Anthropic (lecture automatique des documents, si activée), Netlify (site vitrine, sans donnée personnelle tant que le formulaire n'enregistre rien).
