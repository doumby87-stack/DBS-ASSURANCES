# Personnel, mentions légales et décisions en attente

## Le personnel et ses comptes

Une personne, un compte, le rôle le plus restreint qui convient ([contrôle des accès](../securite/controle-des-acces.md)). Remplir ce tableau, puis le gérant crée les comptes dans le back-office (page Personnel) **après** la formation de chacun ([formation](../securite/formation-du-personnel.md)).

| Nom et prénoms | E-mail professionnel | Rôle | Téléphone avec application d'authentification | Formation (date) |
| --- | --- | --- | --- | --- |
| | | gérant | ☐ | |
| | | | ☐ | |
| | | | ☐ | |

**Rôles** : `gérant` (tout, y compris la validation des bordereaux et les comptes ; prévoir un second gérant ou un adjoint pour les validations à deux), `chargé de clientèle` (clients, contrats, sinistres), `caissier` (encaissements, sa caisse), `commercial` (prospection, sans la caisse), `apporteur` (ses clients seulement), `auditeur` (expert-comptable, contrôleur : lecture seule).

**Application d'authentification** : une application gratuite de codes à usage unique (par exemple Google Authenticator, Microsoft Authenticator ou Aegis), installée sur le téléphone de chaque personne avant sa première connexion.

## Mentions légales du site

Ce qui manque sur la page « Mentions légales » (le reste y est déjà) :

| Information | À fournir |
| --- | --- |
| N° d'agrément ou de carte professionnelle d'intermédiaire en assurance | `[n°, autorité qui l'a délivré, date]` |
| Hébergeur du site (et de l'application) | `[nom, adresse, téléphone]`, après le choix ([hébergeur](hebergeur.md)) |
| Horaires d'ouverture de l'agence | `[par exemple : lundi au vendredi 8 h – 17 h ; samedi 9 h – 13 h]` |
| Référence du récépissé de l'ARTCI | `[n°, date]`, à sa réception ([ARTCI](artci.md)) |
| Adresse e-mail professionnelle | `[contact@…]`, après la création du domaine ([domaine et e-mail](nom-de-domaine-et-email.md)) |

Les transmettre au prestataire technique, qui les reporte dans `apps/site-vitrine/src/donnees/agence.ts`.

## Décisions en attente

| Question | Qui tranche | Où c'est utilisé | Valeur actuelle |
| --- | --- | --- | --- |
| Délais de réponse aux réclamations | Gérant (avec SanlamAllianz si elle impose les siens) | Registre des réclamations ([ADR 0013](../architecture/adr/0013-conformite-et-pilotage.md)) | Accusé de réception sous 2 jours ouvrés, réponse sous 10 |
| Factures de l'agence soumises à la facture normalisée électronique (FNE) | Comptable ou centre des impôts | Commissions ([FNE](../conformite/facturation-fne.md)) | Commissions facturées à la compagnie : oui, sauf avis contraire |
| Délai conseillé pour préparer un dossier d'appel d'offres | Gérant | Assistant « appel d'offres » du site ([ADR 0014](../architecture/adr/0014-outils-du-site.md)) | 10 jours ouvrés avant la date limite |
| Jours d'ouverture (pour les rendez-vous et les délais en jours ouvrés) | Gérant | Rendez-vous, réclamations | Lundi au vendredi, hors fêtes à date fixe |
| Texte du plafond d'espèces, seuils des alertes de blanchiment, durée de conservation des dossiers d'identification | SanlamAllianz | Caisse, conformité | Dans le [courrier](sanlamallianz-et-asaci.md#courrier-à-sanlamallianz) |
| Protections du dépôt GitHub | Propriétaire du dépôt | Sécurité du code | À activer ([paramètres GitHub](../securite/parametres-github.md)) |
