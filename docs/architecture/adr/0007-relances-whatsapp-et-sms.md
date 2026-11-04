# 0007 — Relances automatiques : WhatsApp (API Cloud de Meta) et SMS, avec consentement

- Statut : Proposée (à valider par l'agence : compte Meta, opérateur SMS)
- Date : 2026-11-04

## Contexte

Le site promet « nous surveillons les échéances à votre place ». Le tableau des échéances (tâche 4) prépare déjà un message WhatsApp, mais quelqu'un doit cliquer pour chaque client. La tâche 6 envoie ces rappels sans intervention : échéance d'un contrat, contrat expiré, devis resté sans réponse, avancement d'un sinistre.

Contraintes :

- En Côte d'Ivoire, WhatsApp est le canal que les clients lisent. Une entreprise ne peut y écrire la première qu'avec un **modèle de message validé par Meta**, et seulement aux personnes qui l'ont accepté.
- La loi n° 2013-450 exige une base légale et la possibilité de s'opposer ; Meta exige un accord explicite et le respect immédiat d'un « STOP ».
- Les messages passent par les serveurs de Meta, hors de Côte d'Ivoire : transfert soumis à autorisation de l'ARTCI ([données personnelles](../../conformite/donnees-personnelles.md)).
- Certains clients n'ont pas WhatsApp : il faut un repli par SMS. L'opérateur n'est pas encore choisi.
- Le planificateur travaille sans personne connectée, alors que la base refuse toute lecture sans utilisateur déclaré ([ADR 0004](0004-securite-dans-la-base.md)).

## Décision

1. **WhatsApp par l'API Cloud de Meta, en direct**, sans intermédiaire : jeton d'un utilisateur système du compte WhatsApp Business de l'agence, quatre modèles de la catégorie « Utilitaire » ([modèles de messages](../../metier/modeles-de-messages.md)). Les notifications de Meta (remise, lecture, réponses) arrivent sur `/webhooks/whatsapp`, signées avec le secret de l'application : la signature est vérifiée sur le corps exact reçu, en temps constant, et remplace le contrôle d'origine du back-office pour cette seule route.
2. **SMS par une interface prête à recevoir l'opérateur** (`apps/api/src/integrations/sms`). Tant qu'il n'est pas choisi (tâche 2), le canal SMS n'est actif qu'en simulation, et un client qui n'accepte que le SMS apparaît dans les relances « à faire à la main ».
3. **Consentement par client et par canal**, en ajout seul, avec la façon dont il a été exprimé (`app.consentements`). Sans accord, aucun envoi automatique : la relance due reste visible, avec son texte prêt, pour que l'agence la fasse elle-même et recueille l'accord. Un « STOP » reçu sur WhatsApp retire l'accord aussitôt, sans intervention ; une relance planifiée entre-temps est abandonnée avant l'envoi.
4. **Planificateur dans l'API**, toutes les 15 minutes (`RELANCES_ACTIVES`), protégé par un verrou de PostgreSQL : un seul cycle à la fois, même avec plusieurs instances. Il n'agit que par cinq fonctions de la base, chacune limitée à une opération (planifier, réserver un lot, enregistrer un envoi, un accusé, une désinscription) ; il ne peut ni lire une fiche client ni créer une relance arbitraire.
5. **Une relance par étape et par objet**, garantie par une clé unique : la planification peut tourner autant de fois qu'on veut sans doublon. Trois essais en cas d'erreur passagère, échec immédiat si l'erreur est définitive (numéro sans WhatsApp, modèle refusé), abandon d'un message qui n'a pas pu partir en 48 heures. Envoi entre 8 h et 20 h, heure d'Abidjan.
6. **Le minimum dans chaque message** : nom, branche, n° de police, dates. Ni montant, ni pièce d'identité, ni détail médical.

## Conséquences

- Les rappels partent seuls, et chacun est traçable : planifié, envoyé, remis, lu, en échec ou annulé, avec la raison. Le personnel peut annuler une relance avant son départ.
- **Avant la mise en service**, l'agence doit faire vérifier son entreprise par Meta, ouvrir le compte WhatsApp Business sur un numéro dédié, faire valider les quatre modèles et obtenir l'autorisation de transfert de l'ARTCI (feuille de route, tâche 2). Le code fonctionne déjà en simulation.
- Chaque message WhatsApp est facturé par Meta (tarif des messages « utilitaires » pour la Côte d'Ivoire) ; un SMS de relance compte pour deux SMS.
- Un modèle refusé ou modifié par Meta impose de changer le texte dans le code et dans la documentation (un test vérifie qu'ils restent identiques).
- Une API compromise pourrait appeler les fonctions du planificateur : lire les relances en attente (nom, numéro, échéance) ou enregistrer de faux retraits de consentement. Elle ne peut rien lire d'autre sans utilisateur déclaré, et chaque écriture reste dans le journal d'audit.

## Options écartées

- **Un intermédiaire WhatsApp** (Twilio, 360dialog, Infobip…) : un abonnement et un sous-traitant de plus qui voit les données. À reconsidérer si la vérification de l'entreprise par Meta bloque.
- **Automatiser WhatsApp Web ou une application non officielle** : interdit par Meta, le numéro de l'agence serait banni.
- **Un utilisateur « robot » dans `app.utilisateurs`** : un nouveau rôle aurait dû être ajouté à chaque règle d'accès de la base, avec un risque d'oubli ; des fonctions limitées sont plus simples à vérifier.
- **Une tâche planifiée du système (cron)** : une brique d'infrastructure de plus à surveiller, pour un besoin que la minuterie de l'API et le verrou de la base couvrent. Possible plus tard sans changer la base.
