# Feuille de route

Le projet est découpé en tâches courtes, chacune livrée par une pull request relue et testée. L'ordre suit un principe : **d'abord le socle de sécurité, ensuite ce qui fait gagner du temps chaque jour à l'agence, enfin ce qui attire de nouveaux clients.**

Légende : ✅ terminé · 🔜 prochaine · ⏳ plus tard · 🧑‍💼 tâche de l'agence (sans code)

## ✅ Tâche 1 — Audit, socle et architecture

- Audit du site et corrections ([audit](audit/2026-11-audit-du-site.md)).
- Étude des pratiques des leaders ([benchmark](benchmark/pratiques-des-leaders.md)).
- Arborescence du projet, documentation d'architecture, de sécurité et de conformité.
- Site vitrine isolé et protégé par des en-têtes de sécurité, vérifié avant chaque mise en ligne.
- Base de données sécurisée avec les règles CIMA et le journal d'audit, testée (`database/`).
- Intégration continue : vérification du site, tests de la base, recherche de secrets.

## 🧑‍💼 Tâche 2 — Décisions et démarches de l'agence

À lancer **dès maintenant**, en parallèle du code : certaines démarches prennent des semaines.

- [ ] Déclarer le traitement des données clients à l'**ARTCI** et demander, si l'hébergement est hors de Côte d'Ivoire, l'autorisation de transfert ([données personnelles](conformite/donnees-personnelles.md)).
- [ ] Choisir l'**hébergeur** de l'application ([ADR 0006](architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).
- [ ] Choisir et réserver le **nom de domaine**, puis créer une adresse e-mail professionnelle (fin de l'adresse Gmail) avec protection contre l'usurpation (SPF, DKIM, DMARC).
- [ ] Demander à **SanlamAllianz** : ce que fournit son extranet, le format de ses états de production et de commissions, sa procédure de lutte contre le blanchiment pour les agents, et son accord sur l'usage du logo.
- [ ] Confirmer la **source réglementaire du plafond d'espèces** de 1 000 000 F CFA par police, appliqué par la base.
- [ ] Ouvrir un **compte marchand** de paiement Mobile Money (par exemple CinetPay) au nom de la société, plutôt que d'utiliser un numéro personnel.
- [ ] Faire vérifier le compte **WhatsApp Business** de l'agence par Meta, pour les relances automatiques.
- [ ] Compléter les **mentions légales** : n° d'agrément ou de carte professionnelle, hébergeur, horaires.
- [ ] Valider les engagements proposés pour les **réclamations** (délais de réponse).
- [ ] Demander au comptable quelles factures de l'agence relèvent de la **FNE** ([facturation](conformite/facturation-fne.md)).
- [ ] Activer les **protections GitHub** ([paramètres GitHub](securite/parametres-github.md)).

## 🔜 Tâche 3 — API : socle sécurisé

Connexion du personnel (mot de passe + deuxième facteur), sessions, rôles, transaction qui déclare l'utilisateur à la base, journal technique, limitation des tentatives, tests de sécurité automatiques. Aucun écran métier encore.

*Terminé quand :* un gérant se connecte avec son deuxième facteur, crée un compte, et les tests de sécurité de l'API passent en intégration continue.

## ⏳ Tâche 4 — Back-office : clients, contrats, échéancier

Fiche client unique, contrats, import des états de SanlamAllianz, tableau des échéances à J-30/J-15/J-7. **C'est la tâche qui tient la promesse du site** : « nous surveillons les échéances à votre place ».

## ⏳ Tâche 5 — Caisse et reversements

Encaissements avec reçus numérotés, clôture de caisse, plafond des espèces, bordereaux de reversement validés à deux, compte à rebours des 30 jours, rapprochement des commissions.

## ⏳ Tâche 6 — Relances automatiques

Messages WhatsApp (modèles validés par Meta) et SMS : échéances, contrat expiré, devis sans réponse, avancement d'un sinistre. Consentement et désinscription respectés.

## ⏳ Tâche 7 — Demandes de devis enregistrées

Le formulaire du site enregistre la demande (en plus de WhatsApp), avec dépôt de la carte grise. Suivi des devis dans le back-office. **Avant la mise en ligne :** textes du site et mentions légales mis à jour, déclaration ARTCI faite.

## ⏳ Tâche 8 — Flottes

Import Excel avec contrôle des erreurs, échéances de visite technique, vignette et carte de transport, ajout ou retrait d'un véhicule avec prorata, export pour la cotation en lot.

## ⏳ Tâche 9 — Espace client et paiement Mobile Money

Connexion par code WhatsApp ou SMS, contrats et attestations, paiement par Wave, Orange Money, MTN MoMo ou Moov Money avec confirmation signée, déclaration et suivi des sinistres.

## ⏳ Tâche 10 — Portail des entreprises et transporteurs

Tableau de bord de flotte, plusieurs gestionnaires par entreprise, attestations en lot, historique des sinistres par véhicule.

## ⏳ Tâche 11 — Mise en production

Hébergement, sauvegardes testées, surveillance, test d'intrusion par un prestataire indépendant, formation du personnel (hameçonnage, mots de passe, procédure d'incident).

## ⏳ Tâche 12 — Conformité et pilotage

Fiche d'identification des clients (lutte contre le blanchiment), registre des réclamations, factures FNE, statistiques du gérant.

## ⏳ Tâche 13 — Outils d'attraction sur le site

Rappel d'échéance gratuit, estimation indicative (après validation de SanlamAllianz), assistant « appel d'offres », prise de rendez-vous.

## ⏳ Tâche 14 — Assistance par lecture automatique

Lecture de la carte grise, de la pièce d'identité et du constat amiable pour pré-remplir les fiches, toujours validée par une personne.
