# Classification des données

Chaque donnée relève d'un niveau, qui fixe comment la protéger.

| Niveau | Exemples | Règles |
| --- | --- | --- |
| **Public** | Textes du site, adresse de l'agence, FAQ | Aucune restriction. |
| **Interne** | Procédures, modèles de documents, statistiques sans nom | Personnel uniquement. |
| **Confidentiel** | Fiches clients, contrats, véhicules, encaissements, reversements, échanges | Accès selon le rôle ; chiffrement en transit et au repos ; export réservé au gérant et journalisé ; jamais hors de la production. |
| **Très sensible** | Numéros de pièces d'identité, données médicales des sinistres corporels, dossiers de lutte contre le blanchiment | En plus : chiffrement par l'application (champ par champ), accès le plus restreint, jamais dans un e-mail ni un message WhatsApp, jamais affichés en entier à l'écran sans action volontaire. |

## Durées de conservation

À confirmer avec le conseil juridique de l'agence et SanlamAllianz avant la mise en production.

| Données | Durée proposée | Ensuite |
| --- | --- | --- |
| Demande de devis sans suite | 12 mois après le dernier échange | Suppression |
| Prospect sans contrat | 3 ans après le dernier contact | Suppression |
| Client, contrats, encaissements, reversements | Durée du contrat + 10 ans | Anonymisation |
| Dossier de sinistre | Clôture + 10 ans (plus si procédure en cours) | Anonymisation |
| Identification du client (lutte contre le blanchiment) | Fin de la relation + 10 ans | Suppression |
| Journal d'audit | 10 ans | Archivage |
| Journal technique | 12 mois | Suppression |
| Codes de connexion des clients | 5 minutes | Suppression automatique |

« Rien ne s'efface » s'applique au travail quotidien ; l'expiration des durées ci-dessus est le seul cas de suppression ou d'anonymisation, faite par une procédure dédiée, validée par le gérant et tracée.
