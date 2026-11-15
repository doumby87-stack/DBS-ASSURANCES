# Test d'intrusion : cahier des charges

À confier à un **prestataire indépendant**, avant de mettre des données réelles en production, puis chaque année et après tout changement majeur (nouveau portail, nouveau moyen de paiement, changement d'hébergeur). Ce document sert à le consulter et à cadrer sa mission ; il complète les tests automatiques du dépôt, qui ne remplacent pas un regard extérieur.

## Objectif

Trouver, avant un attaquant, ce qui permettrait de :

- lire ou modifier les données d'un client, d'une entreprise ou de l'agence sans en avoir le droit ;
- détourner de l'argent (encaissements, reversements, paiement en ligne) ;
- prendre le contrôle d'un compte du personnel ou de l'espace d'un client ;
- faire exécuter un fichier piégé, ou rendre l'outil indisponible par un défaut de conception (pas par saturation).

## Périmètre

| Cible | Adresse | À tester en priorité |
| --- | --- | --- |
| Back-office | `https://gestion.<domaine>` | Connexion, deuxième facteur, sessions, réinitialisations ; droits de chaque rôle (gérant, chargé de clientèle, caissier, commercial, apporteur, auditeur) ; accès aux fiches d'autres clients ; caisse, reversements, exports |
| Espace client et portail des entreprises | `https://espace.<domaine>` | Code de connexion WhatsApp (devinette, rejeu, limites) ; isolement entre deux entreprises et entre deux particuliers ; attestations ; déclaration de sinistre et pièces jointes |
| API | `https://gestion.<domaine>/api` | Contrôle d'origine, schémas des entrées, routes publiques du site (`/site/…`), notifications de paiement et de WhatsApp (signature, rejeu), limites d'envoi |
| Pièces jointes | Formulaires du site, sinistres, justificatifs, attestations | Type réel contre type annoncé, fichiers piégés (PDF, images, classeurs à macros), tailles, téléchargement (en-têtes, analyse antivirus à nouveau) |
| Site vitrine | `https://www.<domaine>` | Politique de sécurité du contenu, formulaires, absence de script tiers |
| Serveur | Adresse du serveur | Ports ouverts, TLS, en-têtes, versions annoncées, exposition de la base et de l'antivirus |

**Hors périmètre** : l'extranet de SanlamAllianz, les plateformes de Meta, du prestataire de paiement et de l'hébergeur, la saturation (déni de service), l'ingénierie sociale envers le personnel sans accord écrit séparé du gérant.

## Conditions

- **Environnement** : l'installation de production **avant** l'arrivée des données réelles, ou une installation identique de recette, avec des **données fictives uniquement**. Jamais de données réelles de clients entre les mains du prestataire.
- **Boîte grise** : le prestataire reçoit un compte de chaque rôle, deux comptes d'espace client (deux entreprises distinctes), la documentation du dépôt ([modèle de menaces](modele-de-menaces.md), [contrôle des accès](controle-des-acces.md), [exigences de sécurité](exigences-securite.md)) et, s'il le demande, la lecture du code.
- **Méthode** : OWASP Web Security Testing Guide, et contrôle des exigences OWASP ASVS niveau 2.
- **Autorisation écrite** signée par le gérant : périmètre, dates et heures, adresses IP d'origine du prestataire, contacts joignables pendant le test. L'hébergeur est prévenu si ses conditions l'exigent.
- **Arrêt immédiat** et appel du gérant si le prestataire tombe sur une donnée réelle, une faille critique exploitable, ou dégrade le service.
- **Confidentialité** : accord de confidentialité signé ; résultats transmis chiffrés ; aucune donnée gardée par le prestataire après la mission.

## Livrables

1. **Synthèse pour le gérant**, en français et sans jargon : ce qui est grave, ce qui l'est moins, ce qu'il faut faire.
2. **Rapport technique** : chaque vulnérabilité avec sa gravité (CVSS), sa preuve, la façon de la reproduire et la correction proposée.
3. **Contre-test** après corrections, compris dans le prix, avec un rapport mis à jour.

## Choisir le prestataire

- Indépendant de l'équipe qui a construit l'outil et de l'hébergeur.
- Références de tests d'applications web avec authentification forte ; certifications de ses auditeurs (OSCP, OSWE, CREST ou équivalent).
- Assurance responsabilité civile professionnelle couvrant ce type de mission.
- Connaissance de la loi n° 2013-450 sur les données personnelles ; présence en Côte d'Ivoire appréciée.

## Après le test

| Gravité | Délai de correction |
| --- | --- |
| Critique | 48 heures, sinon le service concerné reste fermé |
| Élevée | 15 jours |
| Moyenne | 90 jours |
| Faible | Prochaine version |

Chaque vulnérabilité devient une alerte de sécurité privée du dépôt GitHub, suivie jusqu'au contre-test. Le rapport est conservé avec le registre des tests de restauration, et le [modèle de menaces](modele-de-menaces.md) est mis à jour.

## Ce qui est déjà vérifié automatiquement

À donner au prestataire, pour qu'il passe son temps sur ce que les tests ne voient pas :

- **Droits** : chaque route déclare ses rôles, et la base les vérifie de nouveau, ligne par ligne. Des tests couvrent chaque rôle et l'isolement des entreprises (`database/tests`, `apps/api/tests`).
- **Origine des requêtes** : contrôle d'origine, cookies `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Limites** : tentatives de connexion et de code limitées, envois du site plafonnés.
- **Pièces jointes** : type reconnu d'après le contenu, antivirus à la réception et au téléchargement, classeurs à macros refusés.
- **Journal d'audit** en ajout seul, chaîné, et vérifié chaque jour.
- **Serveur** : en-têtes de sécurité, HTTPS, aucun port ouvert hormis 80 et 443, base sans accès à Internet, API sans privilège et en lecture seule (`infra/tests/production.sh`).
