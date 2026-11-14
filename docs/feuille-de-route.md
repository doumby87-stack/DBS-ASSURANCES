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

À lancer **dès maintenant**, en parallèle du code : certaines démarches prennent des semaines. C'est la liste unique de ce que l'agence doit faire elle-même ; les tâches suivantes y renvoient.

- [ ] Déclarer le traitement des données clients à l'**ARTCI** et demander, si l'hébergement est hors de Côte d'Ivoire, l'autorisation de transfert ([données personnelles](conformite/donnees-personnelles.md)).
- [ ] Choisir l'**hébergeur** de l'application ([ADR 0006](architecture/adr/0006-hebergement-et-localisation-des-donnees.md)).
- [ ] Choisir et réserver le **nom de domaine**, puis créer une adresse e-mail professionnelle (fin de l'adresse Gmail) avec protection contre l'usurpation (SPF, DKIM, DMARC).
- [ ] Demander à **SanlamAllianz** : ce que fournit son extranet, le format de ses états de production et de commissions, sa procédure de lutte contre le blanchiment pour les agents, et son accord sur l'usage du logo ; pour la caisse, le format des bordereaux et les taux de commission par branche ; pour le paiement des flottes en plusieurs fois (déjà possible dans l'outil), les contrats concernés, les frais de fractionnement, la période des attestations et la procédure en cas d'échéance impayée ([ADR 0015](architecture/adr/0015-paiement-fractionne.md)) ; pour les flottes, les frais d'avenant éventuels, la ristourne minimale ou la retenue sur un retrait, et le format attendu pour la cotation en lot.
- [ ] Demander à l'**ASACI** (ou à SanlamAllianz) l'accès à la plateforme des attestations digitales : émission et vérification par l'agence, et s'il existe un moyen de l'interroger depuis l'application (tâche 10).
- [ ] Confirmer la **source réglementaire du plafond d'espèces** de 1 000 000 F CFA par police, appliqué par la base.
- [ ] Ouvrir un **compte marchand** de paiement Mobile Money (agrégateur comme CinetPay ou PayDunya, ou contrat direct avec un opérateur) au nom de la société, plutôt que d'utiliser un numéro personnel, et transmettre sa documentation d'intégration (vérification d'un paiement, signature des notifications) pour brancher le paiement en ligne (tâche 9).
- [ ] Faire vérifier l'entreprise et le compte **WhatsApp Business** de l'agence par Meta (sur un numéro dédié), puis soumettre les **six modèles de messages** (cinq relances et le code de connexion au portail) ([modèles](metier/modeles-de-messages.md)), et recueillir l'accord des clients existants (WhatsApp, SMS) au guichet ou par téléphone.
- [ ] Choisir l'**opérateur SMS** des relances (agréé, nom d'expéditeur « DBS-ASSUR », accusés de réception, réponses « STOP ») ([ADR 0007](architecture/adr/0007-relances-whatsapp-et-sms.md)).
- [ ] Compléter les **mentions légales** : n° d'agrément ou de carte professionnelle, hébergeur, horaires.
- [ ] Valider les engagements proposés pour les **réclamations** (délais de réponse).
- [ ] Demander au comptable quelles factures de l'agence relèvent de la **FNE** ([facturation](conformite/facturation-fne.md)).
- [ ] Activer les **protections GitHub** ([paramètres GitHub](securite/parametres-github.md)).
- [ ] Préparer la **reprise des données** : liste des clients, contrats en cours (n° de police, dates, primes, véhicules) et encaissements non encore reversés, sous forme d'export de l'extranet ou de classeur Excel ; un outil d'import contrôlé, sur le modèle de celui des flottes, sera fait à partir d'un fichier réel.
- [ ] Désigner le **personnel** qui aura un compte et son rôle (gérant, chargé de clientèle, caissier, commercial, apporteur, auditeur) ; chacun installe une application d'authentification (deuxième facteur) sur son téléphone.
- [ ] Une fois l'hébergeur choisi : installer le démon **ClamAV** à côté de l'API, renseigner les variables (`URL_SITE_VITRINE`, `ANTIVIRUS_ADRESSE`, clés WhatsApp et SMS) dans l'API et `URL_API` dans Netlify, puis **tester une restauration** de sauvegarde ([sauvegardes](securite/sauvegardes-et-reprise.md)).

## ✅ Tâche 3 — API : socle sécurisé

Connexion du personnel (mot de passe + deuxième facteur), sessions, rôles, transaction qui déclare l'utilisateur à la base, journal de sécurité, limitation des tentatives, tests de sécurité automatiques. Aucun écran métier encore ([API](../apps/api/README.md)).

## ✅ Tâche 4 — Back-office : clients, contrats, échéancier

Fiche client unique (contrats, véhicules, devis, échanges), contrats et renouvellements, tableau des échéances à J-30/J-15/J-7 avec relance WhatsApp, gestion du personnel ([back-office](../apps/admin/README.md)). **C'est la tâche qui tient la promesse du site** : « nous surveillons les échéances à votre place ».

*Reporté :* l'import des états de production de SanlamAllianz attend leur format (tâche 2).

## ✅ Tâche 5 — Caisse et reversements

Encaissements avec reçus numérotés sans trou et montant en lettres, mise en vigueur automatique du contrat une fois la prime payée, contre-passation par le gérant, clôture de caisse avec billetage et visa, plafond des espèces, bordereaux de reversement validés à deux et exportables, compte à rebours des 30 jours avec alerte à J+25, rapprochement mensuel des commissions ([back-office](../apps/admin/README.md)).

*À confirmer avec SanlamAllianz (tâche 2) :* format des bordereaux et des relevés de commissions (l'export CSV s'y adaptera), taux de commission par branche. Le paiement fractionné est venu ensuite, avec la tâche 10.

## ✅ Tâche 6 — Relances automatiques

Messages WhatsApp (modèles validés par Meta, [textes](metier/modeles-de-messages.md)) et SMS : échéance à J-30, J-15, J-7 et le jour même, contrat expiré, devis resté sans réponse, avancement d'un sinistre. Une seule relance par étape, entre 8 h et 20 h, trois essais, suivi de la remise et de la lecture. Accord du client par canal, noté avec sa preuve sur la fiche ; « STOP » sur WhatsApp respecté aussitôt ; sans accord, la relance est listée avec son message prêt, à faire à la main. Écran « Relances » du back-office ([ADR 0007](architecture/adr/0007-relances-whatsapp-et-sms.md), [API](../apps/api/README.md#relances-automatiques)).

*Avant la mise en service (tâche 2) :* vérification de l'entreprise par Meta, compte WhatsApp Business sur un numéro dédié, validation des quatre modèles, autorisation de transfert de l'ARTCI ; accord des clients existants à recueillir. *Opérateur SMS à choisir* : d'ici là, le canal SMS ne fonctionne qu'en simulation.

## ✅ Tâche 7 — Demandes de devis enregistrées

Le formulaire du site enregistre la demande, avec la carte grise (photo ou PDF, vérifiée puis chiffrée) et l'accord éventuel pour les rappels WhatsApp ; le visiteur reçoit un numéro de demande, WhatsApp et l'e-mail restent proposés. Écran « Demandes du site » au back-office : carte grise à télécharger (consigné), conversion en client et devis d'origine « site » (ou rattachement à la fiche qui a déjà ce numéro), classement sans suite avec un motif. Envois limités par adresse et par jour, champ piège pour les robots. Carte grise analysée par l'antivirus ClamAV à la réception et à chaque téléchargement ; demandes sans suite supprimées automatiquement après 12 mois, sans trace de leurs données personnelles dans le journal d'audit ([ADR 0009](architecture/adr/0009-demandes-de-devis-du-site.md)).

*Avant la mise en service (🧑‍💼) :* déclaration à l'ARTCI faite, hébergeur choisi, démon ClamAV installé à côté de l'API, puis `URL_SITE_VITRINE` et `ANTIVIRUS_ADRESSE` dans l'API et `URL_API` dans Netlify ; les textes du formulaire et des mentions légales basculent alors d'eux-mêmes.

## ✅ Tâche 8 — Flottes

Écran « Flotte » de chaque client : import de la liste des véhicules (classeur Excel ou CSV) contrôlée ligne par ligne, avec toutes les erreurs affichées avant tout enregistrement ; échéances de visite technique, vignette et carte de transport, rappelées sur WhatsApp à J-30, J-7 et à l'échéance en un seul message par client et par étape (règles de la tâche 6) ; composition des contrats flotte et avenants d'incorporation ou de retrait (plusieurs véhicules par avenant, réintégration, annulation d'un avenant saisi par erreur) au prorata, calculés par la base et suivis en caisse ; export pour la cotation en lot ([ADR 0010](architecture/adr/0010-flottes.md)).

Revue d'ensemble après la tâche 8 : un contrat échu passe de lui-même à « expiré » ; le renouvellement reprend les véhicules encore couverts ; plus aucun rappel de documents pour un véhicule vendu ou un client parti.

*À confirmer avec SanlamAllianz (tâche 2) :* frais d'avenant, ristourne minimale sur un retrait, format attendu pour la cotation en lot. *À faire valider par Meta :* le modèle `dbs_documents_vehicules` ([modèles de messages](metier/modeles-de-messages.md)).

## ✅ Tâche 9 — Espace client et paiement Mobile Money

Le portail devient l'**espace client**, pour les entreprises comme pour les particuliers ([ADR 0012](architecture/adr/0012-espace-client-et-paiement-en-ligne.md)) :

- **particuliers** : leur espace s'ouvre à leur première demande de code, avec le numéro de leur fiche, dès qu'ils ont un contrat ; contrats, attestations, sinistres ;
- **paiement de la prime en ligne** (Wave, Orange Money, MTN MoMo, Moov Money) sur la page du prestataire : le résultat est toujours vérifié auprès du prestataire, puis l'encaissement est enregistré par la base, sans caissier, et le contrat entre en vigueur une fois soldé ; un paiement reçu mais impossible à encaisser est « à régulariser » par le gérant ;
- **déclaration des sinistres en ligne**, avec photos et constat amiable (analysés par l'antivirus, chiffrés) ; au back-office, une page **Sinistres** où les déclarations à traiter passent en premier ;
- connexion par code, sessions et isolement par la base repris du portail des entreprises (tâche 10).

*Avant la mise en service du paiement (tâche 2) :*
- choisir le **prestataire** et ouvrir le compte marchand, puis ajouter son module dans `apps/api/src/integrations/paiement/` d'après sa documentation officielle (pour l'instant, seul le prestataire simulé existe : `PAIEMENT_PRESTATAIRE=simulation`, refusé en production) ;
- rendre joignable depuis Internet l'adresse des notifications (`https://<espace client>/api/paiements/notifications/<prestataire>`) ;
- lire les notifications dans le format du prestataire : beaucoup les envoient en formulaire (`application/x-www-form-urlencoded`), que l'API refuse aujourd'hui (JSON seulement). Le lecteur de ce format sera limité à cette seule route, qui vérifie la signature ;
- rapprocher chaque jour le relevé du prestataire avec les paiements en ligne (Caisse) ;
- compléter la déclaration à l'ARTCI (paiements, photos des sinistres).

## ✅ Tâche 10 — Portail des entreprises et transporteurs

Nouvelle application `apps/portail`, sur sa propre adresse, pour les entreprises et les transporteurs ([ADR 0011](architecture/adr/0011-portail-des-entreprises.md)) :

- **connexion** par le numéro WhatsApp et un code à usage unique, sans mot de passe ;
- **plusieurs accès par entreprise** : le titulaire, créé par l'agence, ajoute ou retire ses collaborateurs ;
- **tableau de bord de la flotte** : véhicules assurés, documents à renouveler, sinistres en cours, reste à payer, contrats ;
- **attestations** déposées par l'agence (en lot, analysées, chiffrées), téléchargées une à une ou toutes ensemble ;
- **historique des sinistres par véhicule**, avec leur déclaration et leur suivi au back-office ;
- **isolement des entreprises par la base** (rôle `dbs_portail`) : une entreprise ne voit jamais les données d'une autre ;
- **paiement de la flotte en plusieurs fois** ([ADR 0015](architecture/adr/0015-paiement-fractionne.md)) :
  - **à l'agence** : l'échéancier est défini au back-office, de 2 à 12 échéances ;
  - **mise en vigueur** : le contrat entre en vigueur à la première échéance payée ;
  - **sur le portail** : l'entreprise voit son échéancier et paie en ligne l'échéance due ;
  - **retards** : les échéances en retard sont signalées à l'agence, et le client est relancé (J-7, puis une fois en retard).

*Avant la mise en service (tâche 2) :*
- faire valider par Meta le modèle d'authentification `dbs_code_connexion` ;
- relancer `database/initialisation/01_roles_et_base.sql` sur la base installée (nouveau rôle) ;
- servir le portail sur sa propre adresse, avec l'API derrière `/api`, et la renseigner dans `URL_PORTAIL`.

## ⏳ Tâche 11 — Mise en production

Hébergement, sauvegardes testées, surveillance, test d'intrusion par un prestataire indépendant, formation du personnel (hameçonnage, mots de passe, procédure d'incident).

## ✅ Tâche 12 — Conformité et pilotage

([ADR 0013](architecture/adr/0013-conformite-et-pilotage.md))

- **identification des clients** (lutte contre le blanchiment) : fiche avec la pièce d'identité au numéro chiffré, justificatifs, dirigeants et bénéficiaires effectifs, original vu par l'agence, revue selon le risque ; aucun contrat pour un client à risque élevé mal identifié ([LBC/FT](conformite/lbc-ft.md)) ;
- **alertes** (espèces proches du plafond, paiement par un tiers, fractionnement, résiliation rapide) et décision du gérant, seul à les voir ;
- **registre des formations** du personnel ;
- **registre des réclamations** : au guichet et dans l'espace client, délais en jours ouvrés, traitement étape par étape, export ; demandes d'accès aux données tracées, export des données d'un client ;
- **factures FNE** des commissions notées dans le back-office ([FNE](conformite/facturation-fne.md)) ;
- **statistiques du gérant** : production, encaissements, portefeuille, renouvellements, sinistres, réclamations.

*À faire par l'agence (tâche 2) :* obtenir la procédure LBC/FT de SanlamAllianz (seuils, pièces, circuit de déclaration) et confirmer la durée de conservation ; valider les délais des réclamations ; faire confirmer par le comptable l'obligation FNE ; enregistrer les formations du personnel ; compléter progressivement la fiche des clients existants (page Conformité).

## ✅ Tâche 13 — Outils d'attraction sur le site

([ADR 0014](architecture/adr/0014-outils-du-site.md))

- **rappel d'échéance gratuit** : le visiteur donne l'échéance de son contrat actuel, chez n'importe quel assureur ; la demande arrive à l'agence un mois avant. Il peut aussi ajouter le rappel à son agenda ;
- **assistant « appel d'offres »** : le marché et les assurances exigées ; l'assistant dit quoi préparer et pour quand, et l'agence voit les appels d'offres par date limite ;
- **prise de rendez-vous** : un jour ouvré et une demi-journée demandés sur le site ; agenda au back-office (confirmation de l'heure, chevauchements refusés, message WhatsApp de confirmation, venu ou non), rendez-vous fixés au guichet ou depuis la fiche d'un client ;
- sans l'API, chaque outil prépare un message WhatsApp ou e-mail ; avec elle, mêmes protections et même purge à 12 mois que les demandes de devis.

*Reste à faire :* l'**estimation indicative**, dès que SanlamAllianz aura fourni sa grille et son accord écrit pour afficher un prix. *À faire par l'agence :* confirmer le délai de 10 jours ouvrés conseillé pour un dossier d'appel d'offres et les jours d'ouverture.

## ⏳ Tâche 14 — Assistance par lecture automatique

Lecture de la carte grise, de la pièce d'identité et du constat amiable pour pré-remplir les fiches, toujours validée par une personne.
