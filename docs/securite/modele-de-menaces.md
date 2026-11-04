# Modèle de menaces

Ce qui peut mal tourner, et ce qui l'empêche. À relire à chaque nouvelle fonctionnalité qui touche aux données ou à l'argent.

## Ce que nous protégeons

| Bien | Pourquoi c'est sensible |
| --- | --- |
| Données des clients | Identité, téléphone, pièces d'identité, véhicules, adresses. |
| Caisse et reversements | Argent des assurés, dû à SanlamAllianz sous 30 jours. |
| Dossiers de sinistres | Parfois des informations médicales (sinistres corporels). |
| Comptes du personnel | Ouvrent l'accès à tout le reste. |
| Réputation de l'agence | Une usurpation (faux numéro de paiement, fausse attestation) touche directement les clients. |

## Menaces et parades

Statut : ✅ en place · 🔜 prévu (n° de tâche de la [feuille de route](../feuille-de-route.md))

| Menace | Exemple | Parades | Statut |
| --- | --- | --- | --- |
| **Vol de mot de passe du personnel** | Faux e-mail « SanlamAllianz » qui demande de se reconnecter | Deuxième facteur obligatoire, codes à usage unique, blocage après 5 échecs, mots de passe divulgués refusés ✅ ; passkeys pour la caisse, alerte de connexion depuis un nouvel appareil, formation 🔜 | ✅ 3 · 🔜 11 |
| **Usurpation de l'agence auprès des clients** | Un escroc envoie un faux numéro Mobile Money « de DBS » | FAQ anti-arnaque, compte marchand unique, adresse e-mail au nom de domaine avec DMARC, attestations vérifiables par QR code | ✅ FAQ · 🔜 2 |
| **Détournement en caisse** | Encaissement en espèces non saisi, ou saisi puis supprimé | Reçus numérotés sans trou par la base, encaissements inaltérables, annulation réservée au gérant, clôture de caisse quotidienne avec billetage, écart expliqué et visa d'un autre gérant, période clôturée fermée aux encaissements antidatés | ✅ |
| **Contournement du plafond d'espèces** | Une prime de 1,5 M F CFA réglée en deux fois en espèces | Plafond cumulé par police, vérifié par la base même en cas d'encaissements simultanés | ✅ |
| **Reversement oublié ou détourné** | Primes conservées au-delà de 30 jours | Compte à rebours par encaissement, alerte à J+25, bordereau validé par une autre personne que celle qui l'a préparé, puis figé une fois versé | ✅ |
| **Employé qui dépasse ses droits** | Un commercial consulte la caisse, un apporteur les clients des autres | Sécurité ligne par ligne selon le rôle, testée | ✅ |
| **Départ d'un employé** | Ancien employé qui garde un accès | Désactivation par le gérant, effet immédiat même sur une session ouverte | ✅ |
| **Effacement des traces** | Un administrateur modifie le journal pour couvrir une fraude | Journal en ajout seul, chaîné par empreintes, dernière empreinte copiée chaque jour hors de la base | ✅ base · 🔜 11 |
| **Fuite de la base de données** | Copie de la base volée chez l'hébergeur | Base non exposée à Internet, disque et sauvegardes chiffrés, pièces d'identité chiffrées par l'application | 🔜 3, 11 |
| **Injection SQL** | Saisie piégée dans un champ du formulaire | Requêtes paramétrées uniquement, comptes de base sans droit de suppression | ✅ |
| **Script injecté dans une page (XSS)** | Nom de client contenant du code | Politique de sécurité du contenu stricte, échappement systématique à l'affichage | ✅ site · 🔜 4 |
| **Requête forcée depuis un autre site (CSRF)** | Lien piégé qui valide un bordereau | Cookies `SameSite=Strict` et `__Host-`, contrôle de l'origine, JSON uniquement | ✅ |
| **Faux avis de paiement** | Notification « paiement reçu » fabriquée | Signature vérifiée, confirmation auprès du prestataire, référence enregistrée une seule fois | ✅ base · 🔜 9 |
| **Fichier piégé** | Pièce jointe malveillante déposée comme « constat » | Types et tailles contrôlés, analyse antivirus, stockage hors du serveur web, téléchargement sous un nom neutre | 🔜 7 |
| **Rançongiciel ou panne** | Serveur chiffré par un attaquant | Sauvegardes hors site immuables, restauration testée chaque mois | 🔜 11 |
| **Secret publié par erreur** | Clé de paiement poussée dans le dépôt | Recherche de secrets en intégration continue et à la publication du site, protection GitHub contre l'envoi de secrets | ✅ |
| **Dépendance compromise** | Bibliothèque piégée | Dépendances limitées et verrouillées, Dependabot, revue des mises à jour | ✅ Actions · 🔜 3 |
| **Blocage volontaire d'un compte** | Quelqu'un se trompe exprès de mot de passe pour bloquer le gérant | Blocage limité dans le temps, déblocage par un autre gérant (réinitialisation), pare-feu applicatif | ✅ · 🔜 11 |
| **Perte du téléphone WhatsApp de l'agence** | Conversations clients accessibles | API WhatsApp Business multi-utilisateurs au lieu d'un seul téléphone, verrouillage de l'appareil | 🔜 6 |
| **Site vitrine défiguré** | Page modifiée chez l'hébergeur | Déploiement uniquement depuis GitHub, accès hébergeur avec deuxième facteur, site sans donnée | ✅ · 🔜 2 |

## Hors de portée

- Un superutilisateur de la base peut tout faire ; il est **détecté** (journal chaîné, empreinte copiée hors de la base) mais pas empêché. D'où une liste très courte de personnes autorisées.
- La sécurité des systèmes de SanlamAllianz, de l'ASACI, de Meta et des opérateurs Mobile Money.
