# Questionnaires des compagnies et formulaire de devis — novembre 2026

Comparaison des questionnaires de souscription que l'agence utilise (16 questionnaires, Sanlam Allianz pour la plupart) avec les questions que pose le formulaire de devis du site, assurance par assurance ([`devis-par-assurance.ts`](../../apps/site-vitrine/src/donnees/devis-par-assurance.ts), [ADR 0009](../architecture/adr/0009-demandes-de-devis-du-site.md)).

## En bref

- **Les deux ne font pas le même travail.** Le questionnaire de la compagnie sert à souscrire : de 10 à plus de 100 questions, une déclaration signée, des sanctions en cas de fausse déclaration (articles 18 et 19 du Code CIMA). Le formulaire du site sert à être recontacté : 3 à 9 questions. Il ne s'agit donc pas de recopier les questionnaires sur le site, mais de faire en sorte que la première demande permette à l'agence de **savoir quel questionnaire envoyer**, de **donner un ordre de prix** et de **ne pas redemander ce que le client a déjà dit**.
- **Deux assurances du site regroupent chacune cinq ou six produits** aux questionnaires différents (« Chantier et construction », « Industrie, PME/PMI et bris de machines »), mais ne posent qu'une seule série de questions. Rien n'indique au conseiller quel produit le client cherche.
- **Un questionnaire n'a aucune place sur le site** : violence politique et terrorisme.
- **L'assureur actuel n'est demandé que pour l'automobile et la flotte**, alors que tous les questionnaires demandent les antécédents et l'assurance en cours. Ailleurs, seule la pièce facultative « Attestation ou contrat d'assurance actuel » le fait connaître, et elle n'est pas proposée pour le chantier, l'industrie, l'agricole ni l'événementiel.
- **Le site pose peu de questions en trop.** Les seules sont des questions de chantier pour les assurances d'entreprise (responsabilités civiles des entreprises de travaux et des bureaux d'études) et des valeurs de bâtiments ou de stock pour les produits qui ne les assurent pas (bris de machines, responsabilité civile industrielle, globale de banque). Elles viennent toutes de ce qu'une même série de questions sert à plusieurs produits.
- **Sept assurances du site n'ont pas de questionnaire** dans le dossier : automobile, deux-roues, flotte, habitation, individuelle accident, incendie et risques divers, transport de marchandises (ainsi que la responsabilité civile familiale).

## Quel questionnaire pour quelle assurance du site

| Questionnaire de la compagnie | Produit | Assurance du site |
| --- | --- | --- |
| TRC | Tous risques chantier (bâtiment) | Chantier et construction |
| TRC Routes | Tous risques chantier (routes et ouvrages d'art) | Chantier et construction |
| TRM OPEX | Tous risques montage-essais | Chantier et construction |
| Décennale | Garantie décennale des vices de construction | Chantier et construction |
| RC Entreprise de travaux | Responsabilité civile des entreprises du bâtiment et des travaux publics | Chantier et construction |
| RC BET | Responsabilité civile des bureaux d'études et de l'ingénierie | Chantier et construction |
| Bris de machines | Bris de machines | Industrie, PME/PMI et bris de machines |
| PME PMI | Multirisque professionnelle des PME et PMI | Industrie (et Multirisque professionnelle) |
| MP, MPI (identiques) | Multirisque protection immobilière (immeubles) | Industrie |
| RC entreprises industrielles et commerciales | Responsabilité civile d'exploitation, après travaux, après livraison | Industrie (et Responsabilité civile) |
| GB | Globale de banque (vol et fraude) | Industrie |
| MRP | Multirisque professionnelle | Multirisque professionnelle |
| Agricole | Assurance des plantations | Agricole |
| RC Événement 2024 | Responsabilité civile de l'organisateur | Événementiel |
| PVT | Violence politique et terrorisme | **Aucune** |

## Bilan par questionnaire

Une ligne par questionnaire de la compagnie. « Repris » : ce que le site demande déjà et que la compagnie demande aussi. « Manque » : ce que la compagnie demande pour donner un prix et que le site ne demande pas. « En trop » : ce que le site demande et que ce questionnaire n'utilise pas. Le détail suit, assurance par assurance.

| Questionnaire | Assurance du site | Repris | Manque | En trop |
| --- | --- | --- | --- | --- |
| TRC | Chantier et construction | Nature, montant, durée, maître d'ouvrage, lieu | Type d'ouvrage, construction ou réhabilitation, date de début, bureau de contrôle, milieu urbain, assureur actuel | Rien |
| TRC Routes | Chantier et construction | Nature, montant, durée, maître d'ouvrage, lieu | Les mêmes que le TRC, avec le type d'ouvrage (route, ouvrage d'art) | Rien |
| TRM OPEX | Chantier et construction | Nature, montant, durée, maître d'ouvrage, lieu | Type d'ouvrage (montage industriel), date de début, bureau de contrôle, assureur actuel | Rien |
| Décennale | Chantier et construction | Nature, montant | Destination de l'ouvrage, étages et sous-sols, dates d'ouverture et de fin, contrôleur technique | Durée en mois (la compagnie veut des dates), maître d'ouvrage et lieu ne servent qu'à identifier le chantier |
| RC Entreprise de travaux | Chantier et construction | Rien | Chiffre d'affaires sur trois ans, effectif, corps d'état, part sous-traitée, travaux à risque, assureur actuel | Montant, durée, maître d'ouvrage et lieu d'un chantier |
| RC BET | Chantier et construction | Rien | Chiffre d'affaires sur trois ans, effectif, part sous-traitée, assureur actuel | Montant, durée, maître d'ouvrage et lieu d'un chantier |
| Bris de machines | Industrie | Activité, valeur des machines | Propriétaire ou locataire, entretien, assureur actuel, sinistres sur cinq ans, garanties, détail des machines | Valeur des bâtiments, valeur du stock |
| PME PMI | Industrie | Activité, valeurs des bâtiments, du matériel, du stock | Chiffre d'affaires, propriétaire ou locataire, garanties parmi quatorze, sécurité incendie et vol, antécédents | Rien |
| MP, MPI | Industrie | Valeur des bâtiments | Nombre de niveaux, surface bâtie, année de construction, nombre de locaux par usage, garanties | Valeur des machines, valeur du stock |
| RC entreprises industrielles et commerciales | Industrie, Responsabilité civile | Activité ; dans « Responsabilité civile » : effectif et chiffre d'affaires | Chiffre d'affaires sur trois ans par zone, salaires, travaux chez les clients, produits importés, après travaux ou après livraison | Dans « Industrie » : les trois valeurs (bâtiments, machines, stock) |
| GB | Industrie | Activité | Tout le questionnaire (une centaine de questions), à laisser à la compagnie | Valeur des machines, valeur du stock |
| MRP | Multirisque professionnelle | Activité, propriétaire ou locataire, valeur du matériel, valeur du stock | Loyer mensuel ou valeur du bâtiment, chiffre d'affaires, effectif, mobilier et informatique, garanties optionnelles, espèces, assureur actuel | Surface (non demandée par la compagnie, utile pour estimer) |
| Agricole | Agricole | Culture, superficie, localisation | Risques à couvrir, somme assurée ou production, superficie cultivée, âge des plants, irrigation, sinistres | Rien |
| RC Événement 2024 | Événementiel | Type d'événement, lieu, participants | Nombre de jours, mesures de sécurité, déjà assuré | Rien (la date n'est pas demandée telle quelle, mais sert à la période de garantie) |
| PVT | Aucune | Rien | Tout : à ajouter comme option de « Incendie et risques divers » | Sans objet |

## Comparaison par assurance du site

### Chantier et construction

**Le site demande** : nature des travaux (obligatoire), montant, durée en mois, maître d'ouvrage, lieu. Pièces proposées : devis, marché ou permis ; cahier des charges ; RCCM.

| | TRC, TRC Routes, montage-essais | Décennale | RC entreprise de travaux, RC bureau d'études |
| --- | --- | --- | --- |
| **Déjà demandé par le site** | Nature, montant, durée, maître d'ouvrage, lieu | Nature, montant | Rien de précis : ces deux assurances portent sur l'entreprise, pas sur un chantier |
| **Manque, et compte pour le prix** | Type d'ouvrage (bâtiment, route, montage industriel), construction ou réhabilitation, date de début, bureau de contrôle désigné, milieu urbain | Destination de l'ouvrage (logements collectifs, maisons, bureaux et commerces, hôpital, bâtiment industriel ou agricole), étages et sous-sols, dates d'ouverture et de fin du chantier, contrôleur technique | Chiffre d'affaires des trois dernières années, effectif, corps d'état exercés, part sous-traitée, travaux à risque (démolition, explosifs, soudure, souterrains, travaux maritimes) |
| **Pièces demandées par la compagnie** | Cahier des clauses techniques, rapport géotechnique, rapport initial du contrôleur technique, planning, plan d'ensemble, liste des engins | Plans et coupes, rapport de sol, rapport du bureau de contrôle, descriptif des travaux par lot | Papier à en-tête, certificats de qualification, cahiers des charges qui aggravent la responsabilité |

Le formulaire convient bien au tous risques chantier et au montage-essais, en partie à la décennale, et pas du tout aux deux responsabilités civiles.

### Industrie, PME/PMI et bris de machines

**Le site demande** : activité (obligatoire), valeur des bâtiments, valeur des machines, valeur du stock. Pièces proposées : liste du matériel, photos, RCCM.

| Produit | Ce que la compagnie demande en plus du site |
| --- | --- |
| Bris de machines | Propriétaire ou locataire, entretien périodique (et par quelle société), assureur actuel et raison du changement, sinistres des cinq dernières années, liste des machines (nom, marque, caractéristiques, année d'acquisition, valeur d'achat, valeur vénale), garanties (dommages directs, incendie d'origine externe, vol). La valeur des bâtiments et du stock ne sert pas pour ce produit. |
| Multirisque PME/PMI | Chiffre d'affaires, propriétaire ou locataire, garanties souhaitées parmi quatorze (pertes d'exploitation, chambre froide, coulage, grèves et émeutes…), capitaux (bâtiment ou loyer, mobilier, informatique, matériel, marchandises), sécurité incendie et vol, antécédents sur trois ans. |
| Multirisque immeuble | Pour les propriétaires, copropriétés et syndics : nombre de niveaux, surface bâtie, année de construction, nombre de magasins, logements et bureaux, prévention, garanties (dont la responsabilité civile du propriétaire d'immeuble), capitaux. |
| RC industrielle et commerciale | Chiffre d'affaires sur trois ans, réparti entre la Côte d'Ivoire, l'UEMOA et la CEMAC, et le reste du monde ; effectif et salaires ; travaux chez les clients ; soudure ; produits importés ; garantie après travaux ou après livraison ; zone couverte. |
| Globale de banque | Réservée aux banques et établissements financiers : une centaine de questions (procédures internes, informatique, salles fortes, automates, transports de fonds). |

**Manque au site** : le produit recherché, propriétaire ou locataire, chiffre d'affaires, effectif, contrat d'entretien des machines, assureur actuel. L'aide de la pièce « Liste du matériel » demande l'année et la valeur de chaque machine ; la compagnie veut aussi la marque, les caractéristiques, la valeur d'achat et la valeur vénale.

### Multirisque professionnelle

**Le site demande** : activité (obligatoire), propriétaire ou locataire, surface, valeur du matériel, valeur du stock.

**La compagnie demande en plus** : chiffre d'affaires, date de création, **loyer mensuel si locataire** ou valeur du bâtiment si propriétaire, mobilier dont matériel informatique, nature des marchandises, dommages électriques, garanties optionnelles (bris de glaces ; vol des marchandises, des espèces en caisse, en coffre-fort, pendant le transport vers la banque ; tous risques informatique ; bris de machines ; responsabilité civile d'exploitation avec effectif, masse salariale et chiffre d'affaires), extincteurs et contrôle de l'installation électrique.

**Manque au site** : loyer mensuel (le capital assuré d'un locataire en dépend), chiffre d'affaires, effectif, garanties optionnelles souhaitées, présence d'espèces en caisse ou en coffre, assureur actuel et échéance. La surface n'est pas demandée par la compagnie, mais peut rester pour estimer.

### Responsabilité civile

**Le site demande** : familiale ou professionnelle (obligatoire), activité, nombre d'employés, chiffre d'affaires. C'est l'essentiel de ce que demandent les compagnies.

**Manque au site** : le type de responsabilité civile professionnelle, car les compagnies en ont un questionnaire par type (exploitation, après travaux ou après livraison, entreprise de travaux, bureau d'études, organisateur d'événement ; le questionnaire MRP précise « exiger le questionnaire spécifique »), la zone d'activité (Côte d'Ivoire, CEDEAO, monde hors États-Unis et Canada) et l'assureur actuel.

### Agricole

**Le site demande** : culture (obligatoire), superficie, localisation.

**La compagnie demande** une soixantaine de réponses : coordonnées GPS et carte, superficie totale et cultivée, année d'entrée en production et âge des plants, ancienneté de l'exploitant, irrigation et drainage, inondations des dix dernières années, présence sur la plantation jour et nuit, production annuelle, somme assurée par culture, sinistres sur dix ans, assurances passées, risques à couvrir (grêle, incendie et foudre, inondation, gel, tempête).

**Manque au site** : risques à couvrir, somme à assurer ou production annuelle, superficie cultivée, âge de la plantation, irrigation. Pièce à proposer : carte ou plan de la plantation (aujourd'hui « photos » et « autre »).

### Événementiel

**Le site demande** : type d'événement (obligatoire), date, lieu, nombre de participants.

**La compagnie demande** : type d'activités, nombre de participants, lieux, **nombre de jours**, **mesures de sécurité**, **déjà assuré pour ce type d'événement**, autres précisions.

Le questionnaire est court et le site en couvre déjà l'essentiel. Avec les trois questions manquantes, l'agence peut transmettre la demande à la compagnie sans rappeler le client.

### Violence politique et terrorisme — absent du site

Le questionnaire demande : société, adresse et coordonnées GPS, activité, période de garantie, pertes et menaces des cinq dernières années, valeurs assurées (bâtiment, matériel, stocks, pertes d'exploitation), gardiennage (armé ou non, privé ou public), vidéosurveillance, clôture, stationnement dans les locaux, voisinage (ambassades, administrations), limite et franchise souhaitées, et les événements couverts (terrorisme, sabotage, malveillance, grèves et émeutes, insurrection, coup d'État, guerre).

Les valeurs demandées sont celles de l'assurance « Incendie et risques divers » du site (biens à assurer, activité, valeurs). La garantie peut y être ajoutée, dans l'offre et par une question « Couvrir aussi les émeutes, le terrorisme et la violence politique ».

## Remarques sur les questionnaires eux-mêmes

À signaler à l'agence, indépendamment du site :

- **TRC** : le fichier Word est déjà rempli en partie avec le dossier d'un client (projet, maître d'ouvrage, entreprise). À vider avant de l'envoyer à un autre client.
- **RC BET** : c'est le formulaire d'Allianz France (référence DEE383, montants en euros, ORIAS, SIRET, code NAF, qualification OPQIBI, Union européenne, loi Informatique et Libertés). Demander à la compagnie la version ivoirienne.
- **Décennale** : version d'octobre 2010, qui cite des bureaux de contrôle français. À faire confirmer par la compagnie.
- **Globale de banque** : l'en-tête porte encore un ancien nom de compagnie. À faire confirmer.
- **MP et MPI** : le même questionnaire, en double.
- **PVT** : la case « Privé » est déjà cochée.

## Recommandations pour le site

Par ordre d'intérêt :

1. **Demander le produit recherché** dans « Chantier et construction » (tous risques chantier bâtiment ou routes, montage-essais, décennale, RC entreprise de travaux, RC bureau d'études) et dans « Industrie » (multirisque PME/PMI, multirisque immeuble, bris de machines, RC industrielle et commerciale, globale de banque). Une seule question à choix multiples : le conseiller sait tout de suite quel questionnaire envoyer.
2. **Assureur actuel et échéance** dans toutes les assurances professionnelles, comme pour l'automobile et la flotte.
3. **Les questions qui fixent le prix** :
   - Multirisque professionnelle : loyer mensuel si locataire, chiffre d'affaires, effectif, garanties optionnelles (vol, bris de glaces, dégâts des eaux, dommages électriques, informatique, pertes d'exploitation).
   - Chantier : type d'ouvrage, date de début, bureau de contrôle désigné ; chiffre d'affaires et effectif pour les deux responsabilités civiles.
   - Industrie : propriétaire ou locataire, chiffre d'affaires, effectif, contrat d'entretien des machines.
   - Responsabilité civile : type de responsabilité civile professionnelle, zone d'activité.
   - Agricole : risques à couvrir, somme à assurer, âge de la plantation, irrigation.
   - Événementiel : nombre de jours, mesures de sécurité, déjà assuré.
4. **Pièces** : proposer « Questionnaire de la compagnie, rempli », « Rapport de sol ou du bureau de contrôle », « Planning et plans du chantier », « Carte ou plan de la plantation » ; compléter l'aide de « Liste du matériel » (marque, valeur d'achat).
5. **Violence politique et terrorisme** dans l'offre « Incendie et risques divers ».

À laisser au questionnaire que l'agence envoie ensuite : déclarations et signatures, tableaux de sinistres, détail des mesures de sécurité, questionnaire de la globale de banque.

**Contraintes techniques** : 20 questions au plus par assurance (`schemaDetails`) et 4 000 octets de réponses (`demandes_site_details_forme`) ; les deux exemplaires de `devis-par-assurance.ts` doivent rester identiques (un test le vérifie) ; une nouvelle nature de pièce demande une migration, car la base limite la liste (`0018_devis_selon_assurance.sql`).
