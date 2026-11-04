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
- Refonte du site vitrine en neuf pages par public, construites par Astro, testées dans le navigateur (accessibilité WCAG 2.1 AA, sécurité) ([audit UX](audit/2026-11-audit-ux-site.md), [ADR 0008](architecture/adr/0008-site-vitrine-astro.md)).

## 🧑‍💼 Tâche 2 — Décisions et démarches de l'agence

À lancer **dès maintenant**, en parallèle du code : certaines démarches prennent des semaines.

- [ ] Déclarer le traitement des données clients à l'**ARTCI** et demander, si l'hébergement est hors de Côte d'Ivoire, l'autorisation de transfert ([données personnelles](conformite/donnees-personnelles.md)).
- [ ] Choisir l'**hébergeur** de l'application ([ADR 0006](architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).
- [ ] Choisir et réserver le **nom de domaine**, puis créer une adresse e-mail professionnelle (fin de l'adresse Gmail) avec protection contre l'usurpation (SPF, DKIM, DMARC).
- [ ] Demander à **SanlamAllianz** : ce que fournit son extranet, le format de ses états de production et de commissions, sa procédure de lutte contre le blanchiment pour les agents, et son accord sur l'usage du logo.
- [ ] Confirmer la **source réglementaire du plafond d'espèces** de 1 000 000 F CFA par police, appliqué par la base.
- [ ] Ouvrir un **compte marchand** de paiement Mobile Money (par exemple CinetPay) au nom de la société, plutôt que d'utiliser un numéro personnel.
- [ ] Faire vérifier l'entreprise et le compte **WhatsApp Business** de l'agence par Meta (sur un numéro dédié), puis soumettre les **quatre modèles de messages** des relances ([modèles](metier/modeles-de-messages.md)).
- [ ] Choisir l'**opérateur SMS** des relances (agréé, nom d'expéditeur « DBS-ASSUR », accusés de réception, réponses « STOP ») ([ADR 0007](architecture/adr/0007-relances-whatsapp-et-sms.md)).
- [ ] Compléter les **mentions légales** : n° d'agrément ou de carte professionnelle, hébergeur, horaires.
- [ ] Valider les engagements proposés pour les **réclamations** (délais de réponse).
- [ ] Demander au comptable quelles factures de l'agence relèvent de la **FNE** ([facturation](conformite/facturation-fne.md)).
- [ ] Activer les **protections GitHub** ([paramètres GitHub](securite/parametres-github.md)).

## ✅ Tâche 3 — API : socle sécurisé

Connexion du personnel (mot de passe + deuxième facteur), sessions, rôles, transaction qui déclare l'utilisateur à la base, journal de sécurité, limitation des tentatives, tests de sécurité automatiques. Aucun écran métier encore ([API](../apps/api/README.md)).

## ✅ Tâche 4 — Back-office : clients, contrats, échéancier

Fiche client unique (contrats, véhicules, devis, échanges), contrats et renouvellements, tableau des échéances à J-30/J-15/J-7 avec relance WhatsApp, gestion du personnel ([back-office](../apps/admin/README.md)). **C'est la tâche qui tient la promesse du site** : « nous surveillons les échéances à votre place ».

*Reporté :* l'import des états de production de SanlamAllianz attend leur format (tâche 2).

## ✅ Tâche 5 — Caisse et reversements

Encaissements avec reçus numérotés sans trou et montant en lettres, mise en vigueur automatique du contrat une fois la prime payée, contre-passation par le gérant, clôture de caisse avec billetage et visa, plafond des espèces, bordereaux de reversement validés à deux et exportables, compte à rebours des 30 jours avec alerte à J+25, rapprochement mensuel des commissions ([back-office](../apps/admin/README.md)).

*À confirmer avec SanlamAllianz (tâche 2) :* format des bordereaux et des relevés de commissions (l'export CSV s'y adaptera), taux de commission par branche, paiement fractionné de la prime.

## ✅ Tâche 6 — Relances automatiques

Messages WhatsApp (modèles validés par Meta, [textes](metier/modeles-de-messages.md)) et SMS : échéance à J-30, J-15, J-7 et le jour même, contrat expiré, devis resté sans réponse, avancement d'un sinistre. Une seule relance par étape, entre 8 h et 20 h, trois essais, suivi de la remise et de la lecture. Accord du client par canal, noté avec sa preuve sur la fiche ; « STOP » sur WhatsApp respecté aussitôt ; sans accord, la relance est listée avec son message prêt, à faire à la main. Écran « Relances » du back-office ([ADR 0007](architecture/adr/0007-relances-whatsapp-et-sms.md), [API](../apps/api/README.md#relances-automatiques)).

*Avant la mise en service (tâche 2) :* vérification de l'entreprise par Meta, compte WhatsApp Business sur un numéro dédié, validation des quatre modèles, autorisation de transfert de l'ARTCI ; accord des clients existants à recueillir. *Opérateur SMS à choisir* : d'ici là, le canal SMS ne fonctionne qu'en simulation.

## ✅ Tâche 7 — Demandes de devis enregistrées

Le formulaire du site enregistre la demande, avec la carte grise (photo ou PDF, vérifiée puis chiffrée) et l'accord éventuel pour les rappels WhatsApp ; le visiteur reçoit un numéro de demande, WhatsApp et l'e-mail restent proposés. Écran « Demandes du site » au back-office : carte grise à télécharger (consigné), conversion en client et devis d'origine « site » (ou rattachement à la fiche qui a déjà ce numéro), classement sans suite avec un motif. Envois limités par adresse et par jour, champ piège pour les robots. Carte grise analysée par l'antivirus ClamAV à la réception et à chaque téléchargement ; demandes sans suite supprimées automatiquement après 12 mois, sans trace de leurs données personnelles dans le journal d'audit ([ADR 0009](architecture/adr/0009-demandes-de-devis-du-site.md)).

*Avant la mise en service (🧑‍💼) :* déclaration à l'ARTCI faite, hébergeur choisi, démon ClamAV installé à côté de l'API, puis `URL_SITE_VITRINE` et `ANTIVIRUS_ADRESSE` dans l'API et `URL_API` dans Netlify ; les textes du formulaire et des mentions légales basculent alors d'eux-mêmes.

## ✅ Tâche 8 — Flottes

Écran « Flotte » de chaque client : import de la liste des véhicules (classeur Excel ou CSV) contrôlée ligne par ligne, avec toutes les erreurs affichées avant tout enregistrement ; échéances de visite technique, vignette et carte de transport, rappelées sur WhatsApp à J-30, J-7 et à l'échéance en un seul message par client et par étape (règles de la tâche 6) ; composition des contrats flotte et avenants d'incorporation ou de retrait (plusieurs véhicules par avenant, réintégration, annulation d'un avenant saisi par erreur) au prorata, calculés par la base et suivis en caisse ; export pour la cotation en lot ([ADR 0010](architecture/adr/0010-flottes.md)).

*À confirmer avec SanlamAllianz (tâche 2) :* frais d'avenant, ristourne minimale sur un retrait, format attendu pour la cotation en lot. *À faire valider par Meta :* le modèle `dbs_documents_vehicules` ([modèles de messages](metier/modeles-de-messages.md)).

## 🔜 Tâche 9 — Espace client et paiement Mobile Money

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
