# ARTCI : déclaration des traitements et transfert à l'étranger

Cadre : [données personnelles](../conformite/donnees-personnelles.md) (loi n° 2013-450). **Aucune donnée réelle de client ne doit entrer dans l'application avant le récépissé** (ou l'autorisation).

## Ce qu'il faut déposer

L'autorité de protection des données, rattachée à l'ARTCI, publie sur son site les **formulaires** et leurs notices : déclaration préalable, demande d'autorisation, demande de transfert de données hors de l'espace CEDEAO. Télécharger la dernière version des formulaires sur son site plutôt qu'une copie ancienne.

1. **Les traitements de l'agence**, un formulaire par traitement ou un dossier qui les regroupe, selon ce que l'ARTCI demande : la liste et le contenu sont ci-dessous.
   - En principe une **déclaration préalable**. Mais la loi soumet certains traitements à **autorisation** préalable, notamment ceux qui portent sur des données sensibles comme les données de santé. Les dossiers de **sinistres corporels** peuvent en contenir. **Poser la question à l'ARTCI** avant le dépôt : déclaration pour tout, ou autorisation pour les sinistres.
2. **Le transfert à l'étranger**, avec la déclaration ou la demande d'autorisation :
   - **WhatsApp** (Meta) : le nom, le numéro, la branche, le n° de police et les dates des relances passent par les serveurs de Meta, hors de l'espace CEDEAO ;
   - **l'hébergeur et le stockage des sauvegardes**, s'ils sont hors de Côte d'Ivoire ([ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md)) ;
   - **l'opérateur SMS** et le **prestataire de paiement**, s'ils traitent les données hors du pays : leur demander où.
3. **Les pièces** : à vérifier sur la notice du formulaire. En général l'identité de l'entreprise (extrait RCCM), le contrat ou l'engagement de chaque sous-traitant (confidentialité, sécurité, localisation), et les textes présentés aux personnes (mentions légales, cases à cocher du site).

**Délais** : selon les textes, l'ARTCI se prononce en un mois, prorogeable d'un mois, et **un silence vaut rejet**. Noter la date de dépôt et relancer avant la fin du délai. **Frais** : fixés par l'ARTCI, à demander au dépôt. *Délais et frais sont à confirmer auprès de l'ARTCI.*

## Responsable du traitement

| Rubrique | À remplir |
| --- | --- |
| Raison sociale | DBS-ASSURANCES, SARL unipersonnelle au capital de 1 000 000 F CFA |
| RCCM, compte contribuable | CI-ABJ-03-2025-B13-11712, 2506904 P |
| Adresse | Abidjan Yopougon Palais, Lot 1695, Îlot 124 — 21 BP M 1335 Abidjan 21 |
| Représentant légal | DOUMBIA Brahima, gérant |
| Personne à contacter pour les données personnelles | `[nom, téléphone, e-mail professionnel]` |
| Activité | Intermédiaire en assurance (agent de SanlamAllianz Côte d'Ivoire), agrément `[n°]` |

## Les traitements

Le contenu de chaque fiche reprend le [registre des traitements](../conformite/donnees-personnelles.md#registre-des-traitements-projet), qui fait foi : finalité, données, destinataires, durée de conservation, hébergement. Rubriques à remplir pour chacun :

| Traitement | Personnes concernées | Base | Transfert hors CEDEAO |
| --- | --- | --- | --- |
| Gestion des clients et des contrats | Clients, conducteurs, bénéficiaires | Contrat ; obligations du Code CIMA | Selon l'hébergeur |
| Encaissements et reversements | Clients, payeurs | Obligations comptables et CIMA | Selon l'hébergeur et le prestataire de paiement |
| Sinistres | Clients, victimes, témoins | Contrat | Selon l'hébergeur (**données de santé possibles**) |
| Lutte contre le blanchiment | Clients, dirigeants, bénéficiaires effectifs | Obligation légale | Selon l'hébergeur |
| Relances et rappels | Clients qui l'ont accepté | Consentement, recueilli par canal avec sa preuve | **Oui : Meta (WhatsApp)** |
| Demandes reçues par le site (devis, rappels d'échéance, appels d'offres, rendez-vous) | Prospects | Consentement (case cochée, texte gardé) | Selon l'hébergeur |
| Espace client | Clients, collaborateurs des entreprises clientes | Contrat | Selon l'hébergeur ; Meta pour les codes de connexion |
| Comptes du personnel et journaux de sécurité | Personnel | Intérêt légitime (sécurité) | Selon l'hébergeur |
| Lecture automatique des documents | Clients | Contrat | **Non : tout reste sur les serveurs de l'agence** |

## Mesures de sécurité (texte à reprendre)

> Les données sont gérées dans une application dédiée, hébergée sur un serveur `[en Côte d'Ivoire / chez … en …]`, dont la base de données n'est joignable depuis aucun réseau extérieur.
>
> **Accès.** Chaque membre du personnel a un compte nominatif. Le mot de passe compte au moins 12 caractères ; un deuxième facteur est obligatoire ; le compte se bloque après 5 erreurs. Les droits sont limités par rôle et appliqués par la base de données elle-même. Un compte est désactivé le jour du départ, et la liste des comptes est revue chaque trimestre.
>
> **Chiffrement.** Toutes les connexions sont chiffrées (HTTPS). Les numéros de pièces d'identité, les justificatifs, les photos et les documents reçus sont chiffrés par l'application. Les sauvegardes sont chiffrées avant de quitter le serveur.
>
> **Traçabilité.** Toute création, modification ou suppression est inscrite dans un journal d'audit inaltérable, vérifié chaque nuit. Les connexions, les exports et les téléchargements de pièces sont inscrits dans un journal de sécurité.
>
> **Disponibilité.** Une sauvegarde est faite chaque nuit, avec une copie chez un second fournisseur, en écriture unique. Une restauration est testée chaque mois.
>
> **Fichiers et personnel.** Les fichiers reçus sont analysés par un antivirus. Le personnel est formé avant l'ouverture de son compte, puis chaque année. L'application a été soumise à un test d'intrusion par un prestataire indépendant.
>
> **Durées et droits.** Les demandes sans suite sont supprimées automatiquement après 12 mois. Les droits d'accès, de rectification et d'opposition s'exercent à l'agence ou par e-mail ; chaque demande est enregistrée et traitée sous un mois.

Ne garder que ce qui est vrai **au moment du dépôt** : retirer par exemple la phrase sur le test d'intrusion s'il n'est pas encore fait, et l'indiquer comme « prévu avant l'ouverture ».

## Après le dépôt

- [ ] Date de dépôt notée ; relance prévue avant la fin du délai
- [ ] Récépissé ou autorisation reçu, rangé avec les documents de conformité ; référence ajoutée aux mentions légales du site
- [ ] Autorisation de transfert reçue pour chaque destinataire hors CEDEAO
- [ ] Le prestataire technique est prévenu : l'enregistrement des demandes du site et l'entrée de données réelles peuvent être activés
