# 0018 — Lecture intelligente des documents dans tout l'outil : catalogue, reconnaissance, rapprochement avec les fiches

- Statut : Acceptée (même condition que l'[ADR 0015](0015-lecture-automatique.md) : désactivée tant que l'ARTCI n'a pas autorisé le transfert)
- Date : 2026-11-15
- Étend : [ADR 0015](0015-lecture-automatique.md), dont toutes les garanties restent (antivirus, schéma strict, rien d'enregistré sans la personne, journal, 30 lectures par heure)

## Contexte

L'ADR 0015 lit trois documents à trois endroits : la carte grise sur la fiche client, la pièce d'identité sur l'identification, le constat sur un sinistre. Or l'agence reçoit bien d'autres documents qu'elle recopie à la main :

- l'**attestation d'assurance** actuelle d'un prospect (compagnie, échéance, garanties, prime), jointe aux demandes du site ;
- le **registre de commerce** (RCCM) d'une entreprise, pour la connaissance du client et ses dirigeants ;
- la **carte de transport** et la **visite technique** d'un camion, dont les échéances sont suivies pour les transporteurs ;
- la **liste des véhicules** d'une flotte, souvent en photo ou en PDF plutôt qu'en Excel.

Et la lecture seule ne suffit pas : une carte grise recopiée sans erreur peut concerner un véhicule déjà enregistré chez un autre client, ou déjà assuré par l'agence ; une visite technique lue doit finir dans l'échéance du véhicule. La demande : un système **utilisable dans tout le logiciel**, qui **extrait les informations utiles pour qu'elles puissent être traitées**.

## Décision

1. **Un catalogue de documents**, un fichier par document (`apps/api/src/integrations/lecture/catalogue/`) : libellé, signes pour le reconnaître, demande faite au lecteur, schéma JSON strict, nettoyage des valeurs, contrôles et exemple pour la simulation. Ajouter un document, c'est un fichier et une ligne dans `documents.ts` ; le schéma reste vérifié par les tests (chaque objet exige tous ses champs, n'en admet aucun autre). Huit documents :

   | Document | Ce qui en est tiré | Contrôles propres |
   |---|---|---|
   | Carte grise | Immatriculation, châssis, marque, modèle, genre, énergie, CV, places, 1re mise en circulation, titulaire, usage | Châssis (VIN), immatriculation, date à venir |
   | Pièce d'identité | Type, numéro, nom, prénoms, naissance, sexe, nationalité, délivrance, expiration, zone lisible par machine | Expiration, chiffres de contrôle de la zone lisible par machine |
   | Constat amiable | Date, heure, lieu, blessés, témoins, véhicules A/B/C (assureur, police, immatriculation, cases cochées, choc), croquis | Date à venir, un seul véhicule, blessés |
   | Attestation d'assurance | Assureur, intermédiaire, police, attestation, assuré, risque, effet, échéance, véhicule, garanties, prime TTC | Échue, dates inversées, châssis, immatriculation |
   | Registre de commerce | Raison sociale, sigle, forme juridique, n° RCCM, immatriculation, siège, activité, capital, n° contribuable, dirigeants | Forme du n° RCCM (CI-ABJ-…), date à venir |
   | Carte de transport | Numéro, titulaire, immatriculation, catégorie, délivrance, fin de validité | Expirée, dates inversées |
   | Visite technique | Immatriculation, châssis, centre, date de visite, fin de validité, résultat | Périmée, défavorable ou contre-visite, dates inversées |
   | Liste de véhicules | Propriétaire, nombre de véhicules du document, une ligne par véhicule (mêmes colonnes que l'import des flottes) | Liste incomplète, doublons, lignes sans immatriculation, châssis à revoir |

2. **Champs douteux.** Le lecteur recopie une valeur lisible mais incertaine et la signale (`champsIncertains`) au lieu de la taire : elle est surlignée et devient un point à vérifier. Seuls les noms de champs du document sont gardés.
3. **Reconnaissance automatique** (`document: "auto"`, avec au besoin `parmi`) : quand la personne ne dit pas ce qu'elle dépose, une première demande courte (effort faible, schéma limité aux documents permis à son rôle, plus « autre ») dit de quel document il s'agit, puis il est lu. Un document qui n'est aucun de ceux du catalogue est refusé avec sa description (« il semble s'agir de : facture d'un garage »). Une reconnaissance hésitante est signalée. Le tout compte pour une seule lecture.
4. **Rapprochement avec les fiches** (`apps/api/src/modules/lecture/rapprochements.ts`), sous l'identité de la personne (sécurité au niveau des lignes : elle ne découvre aucune fiche qu'elle ne pourrait déjà ouvrir) :
   - véhicule déjà enregistré (même plaque, quelle que soit l'écriture, ou même châssis), chez ce client ou chez un autre, assuré ou non par l'agence ; même châssis sous une autre plaque ;
   - titulaire, assuré, entreprise ou personne lus comparés au client du dossier (mots du nom, sans accents, civilités ni forme juridique), ou retrouvés parmi les clients ;
   - attestation : contrat de l'agence (échéance comparée) ou contrat d'une autre compagnie, avec le nombre de jours avant son échéance et la prime à battre ;
   - registre de commerce : même RCCM qu'un client, RCCM absent de la fiche ou différent ;
   - pièce d'identité : numéro ou date de naissance différents de la fiche d'identification ;
   - constat : véhicules et polices assurés par l'agence ;
   - liste : véhicules inconnus, déjà sur la fiche, chez un autre client, déjà assurés.

   Chaque constat peut porter un lien vers la fiche ou le contrat, et une **mise à jour proposée** : l'échéance de visite technique ou de carte de transport lue, plus récente que celle du véhicule. La personne l'applique d'un clic (`PATCH /vehicules/:id`, journal d'audit de la base) ; rien n'est appliqué sans elle.
5. **Une liste en classeur Excel se lit sans modèle**, cellule par cellule, avec les règles de l'import des flottes : plus sûr, plus rapide, gratuit. Une liste lue sur une photo ou un PDF passe, en CSV, par l'aperçu contrôlé de l'import, qui vérifie chaque ligne avant tout enregistrement.
6. **Réponses longues en flux** : la liste des véhicules est lue en flux, avec plus de place pour la réponse, pour ne pas buter sur le délai d'une requête simple.
7. **Partout dans le back-office**, un seul composant (`LectureAutomatique`) : fiche client (carte grise), identification (pièce d'identité ; RCCM pour une entreprise, dirigeants proposés à l'ajout), sinistre (constat), demande du site (chaque pièce jointe selon sa nature : carte grise, attestation, liste, carte de transport, RCCM ; « autre » est reconnue), flotte (liste en photo vers l'import ; visite technique ou carte de transport vers l'échéance), et une page « Lire un document » pour ce qui arrive sans fiche de départ.
8. **Droits** : pièce d'identité et constat restent au gérant et au chargé de clientèle ; les six autres documents s'ouvrent aussi au commercial, qui saisit véhicules, flottes et prospects. La reconnaissance ne propose que les documents permis au rôle.

## Conséquences

- La même lecture sert partout ; un nouveau document se décrit en un fichier, sans toucher aux écrans.
- La lecture apprend à la personne ce que l'agence sait déjà (doublon de véhicule, client existant, contrat d'une autre compagnie à reprendre) au lieu de seulement recopier.
- La reconnaissance automatique coûte une petite demande de plus au modèle ; elle n'est faite que si la personne ne dit pas ce qu'elle dépose.
- Plus de documents partent chez Anthropic (attestations, RCCM, cartes de transport, visites, listes) : le registre des traitements et la demande d'autorisation à l'ARTCI doivent les citer ([données personnelles](../../conformite/donnees-personnelles.md)). Une liste en Excel, elle, ne quitte pas le serveur.
- Les exemples de la simulation ont des dates fixes : avec le temps, ils déclenchent les contrôles d'échéance. C'est voulu (démonstration des contrôles), et les tests n'en dépendent pas.

## Options écartées

- **Un schéma unique pour tous les documents**, reconnaissance et lecture en une seule demande : un schéma très large, plus fragile, et moins précis par document.
- **Appliquer seul les mises à jour évidentes** (échéance plus récente) : une erreur de lecture finirait dans le suivi des échéances et les rappels WhatsApp. La personne valide chaque mise à jour.
- **Rapprocher sans les droits de la personne** (requêtes privilégiées) : la lecture révélerait des fiches qu'elle ne voit pas, par exemple à un apporteur.
- **Lire les classeurs Excel avec le modèle** : plus lent, payant et moins sûr que l'import existant, déjà contrôlé ligne par ligne.
