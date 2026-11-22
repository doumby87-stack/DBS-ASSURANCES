# Gestion des secrets

Un secret est tout ce qui donne un accès : mot de passe, clé d'API, clé de chiffrement, jeton.

## Règles

1. **Jamais dans le dépôt**, ni dans un ticket, un message WhatsApp ou un e-mail. Le fichier `.env.example` liste les noms des variables, sans valeur.
2. **Un secret par environnement** (local, recette, production). Celui de production n'est connu que du gestionnaire de secrets de l'hébergeur et de deux personnes au plus.
3. **Le moins de personnes possible**, nommément désignées.
4. **Renouvellement** : au moins une fois par an, immédiatement au départ d'une personne qui le connaissait, et immédiatement en cas de doute.
5. **Coffre-fort** : les secrets de l'agence (hébergeur, GitHub, compte marchand, WhatsApp Business, nom de domaine) sont rangés dans un gestionnaire de mots de passe d'équipe, avec deuxième facteur.

## Inventaire

| Secret | Où il est utilisé | Où il est rangé |
| --- | --- | --- |
| Mot de passe `dbs_proprietaire` | Migrations | Gestionnaire de secrets de l'hébergeur (production), coffre-fort |
| Mot de passe `dbs_application` | API | Gestionnaire de secrets de l'hébergeur |
| Mot de passe `dbs_sauvegarde` | Sauvegarde de la nuit ; inscription des tests de restauration | `infra/production/.env` sur le serveur (lisible par son propriétaire seulement), coffre-fort |
| Mot de passe du superutilisateur de la base installée sur le serveur (ou du compte d'administration de la base gérée) | Initialisation de la base, reprise après sinistre | `infra/production/.env`, coffre-fort |
| **Clé privée des sauvegardes** (age) | Test de restauration du mois, reprise après sinistre | **Jamais sur le serveur ni dans le coffre-fort en ligne** : deux clés USB (ou un papier au coffre) chez deux personnes. Sa perte rend toutes les sauvegardes illisibles ; on en crée alors une nouvelle et on refait aussitôt une sauvegarde. |
| Clé publique des sauvegardes (`age1…`) | Sauvegarde de la nuit | `infra/production/.env` (elle ne permet que de chiffrer) |
| Accès au stockage hors site (rclone) | Copie hors site | `infra/production/sauvegarde.env`, coffre-fort. Écriture seule, sans droit de suppression ; un accès distinct, en lecture, pour le poste du test mensuel |
| Adresse du battement de cœur de la sauvegarde (`SAUVEGARDE_SIGNAL_URL`) | Surveillance | `infra/production/sauvegarde.env` (qui la connaît pourrait faire croire que tout va bien) |
| Clé de chiffrement (`CLE_CHIFFREMENT_DONNEES` : secrets du deuxième facteur, numéros et justificatifs d'identité, pièces et photos reçues, attestations) | API | Gestionnaire de secrets ; copie de secours scellée, hors ligne. Sa perte oblige à réinitialiser l'accès de tout le personnel et rend illisibles les pièces enregistrées, même restaurées d'une sauvegarde. |
| Clés du prestataire de paiement | API | Gestionnaire de secrets |
| Jeton WhatsApp Business (`WHATSAPP_JETON`), secret de l'application Meta qui signe les notifications (`WHATSAPP_SECRET_APPLICATION`), jeton de vérification des notifications (`WHATSAPP_JETON_VERIFICATION`) | API | Gestionnaire de secrets ; jeton d'un utilisateur système Meta, réservé à l'envoi de messages |
| Accès FNE (DGI) | API | Gestionnaire de secrets |
| Comptes hébergeur, GitHub, domaine | Personnes | Coffre-fort d'équipe, deuxième facteur obligatoire |

## Protections automatiques

- **Intégration continue** : recherche de secrets dans tout l'historique du dépôt à chaque pull request (Gitleaks).
- **Publication du site** : `scripts/verifier-site.mjs` refuse la mise en ligne si un fichier du site contient une clé.
- **GitHub** : activer la détection des secrets et le blocage à l'envoi ([paramètres GitHub](parametres-github.md)).

## Si un secret a fuité

1. **Le révoquer immédiatement** chez le fournisseur et en créer un nouveau. Supprimer le fichier du dépôt ne suffit pas : l'historique le garde.
2. Vérifier dans les journaux s'il a été utilisé.
3. Suivre la [procédure d'incident](reponse-aux-incidents.md).
