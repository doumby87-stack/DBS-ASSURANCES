# Reprise des données existantes

Pour que le back-office serve dès le premier jour, il faut y faire entrer les clients, les véhicules, les contrats en cours et les primes encaissées pas encore reversées. Cette page dit **quoi préparer, dans quel format**. Un outil d'import contrôlé sera construit sur le premier fichier réel, comme celui des flottes : aperçu, erreurs ligne par ligne, rien d'enregistré sans validation.

## La source

Par ordre de préférence :

1. **l'export de l'extranet de SanlamAllianz** pour les contrats en cours de l'agence (demandé dans le [courrier](sanlamallianz-et-asaci.md#courrier-à-sanlamallianz)) : c'est la source la plus fiable ;
2. les **classeurs Excel** de l'agence ;
3. les **dossiers papier**, à saisir dans les modèles ci-dessous.

## Les quatre fichiers

Modèles à télécharger : quatre fichiers CSV qui s'ouvrent dans Excel (séparateur `;`). La première ligne donne les colonnes, la deuxième est un **exemple fictif à effacer**.

| Fichier | Une ligne par | Modèle |
| --- | --- | --- |
| Clients | client (particulier, professionnel ou entreprise) | [clients.csv](modeles/clients.csv) |
| Véhicules | véhicule | [vehicules.csv](modeles/vehicules.csv) |
| Contrats en cours | contrat (police) | [contrats.csv](modeles/contrats.csv) |
| Encaissements non reversés | paiement reçu et pas encore versé à SanlamAllianz | [encaissements-a-reverser.csv](modeles/encaissements-a-reverser.csv) |

Le **code client** relie les fichiers : un code inventé par l'agence (`C0001`, `C0002`…), le même pour un client dans tous les fichiers. Le **n° de police** relie véhicules, contrats et encaissements.

## Les règles

| Colonne | Format | Exemple |
| --- | --- | --- |
| Type | `particulier`, `professionnel` ou `entreprise` | `entreprise` |
| Téléphone | 10 chiffres ivoiriens, ou numéro international avec `+` | `07 00 00 00 01` |
| Dates | jour/mois/année | `31/12/2027` |
| Montants | en F CFA, chiffres seulement, sans espace ni « F » | `1250000` |
| Branche | une des valeurs ci-dessous | `automobile` |
| Mode | `especes`, `cheque`, `mobile_money` ou `virement` ; référence obligatoire sauf en espèces | `mobile_money` |
| Immatriculation | telle qu'elle est écrite sur la carte grise | `AA-000-AA` |
| Visite technique, vignette, carte de transport | date de fin de validité, si connue | `30/06/2027` |
| Apporteur | nom de l'apporteur d'affaires, s'il y en a un (il aura un compte) | |

**Branches** : `automobile`, `deux_roues`, `flotte`, `habitation`, `multirisque_professionnelle`, `incendie_risques_divers`, `responsabilite_civile`, `individuelle_accident`, `transport_marchandises`, `chantier_construction`, `industrie_bris_de_machines`, `agricole`, `evenementiel`, `autre`.

Ce qui **ne va pas** dans ces fichiers : les numéros de pièces d'identité, les justificatifs, les photos, les dossiers de sinistres. Ils se saisissent dans le back-office, fiche par fiche (identification, sinistres), où ils sont chiffrés et tracés.

## Protéger ces fichiers

Ils contiennent les données de tous les clients :

- les préparer sur un ordinateur de l'agence protégé par un mot de passe, **jamais** sur un ordinateur public ;
- **jamais** par e-mail, WhatsApp ou service de partage en ligne : remise en main propre au prestataire technique, sur une clé USB chiffrée, ou dépôt direct par l'outil d'import ;
- **jamais dans le dépôt GitHub** (le dossier `reprise/` à la racine est refusé par `.gitignore`, pour préparer les fichiers à part sans risque) ;
- effacer les copies une fois l'import vérifié.

## Vérifier après l'import

- [ ] Totaux comparés avec la source : nombre de clients, de contrats en cours, de véhicules ; somme des primes encaissées non reversées
- [ ] Une dizaine de fiches tirées au hasard comparées avec les dossiers papier
- [ ] Le tableau des échéances montre les bons contrats aux bonnes dates
- [ ] Les primes non reversées apparaissent avec leur compte à rebours de 30 jours (page Reversements)
