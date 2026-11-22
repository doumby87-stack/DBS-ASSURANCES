# Dossier des démarches de l'agence (tâche 2)

L'application est prête ([feuille de route](../feuille-de-route.md)). Ce qui manque maintenant pour la mettre en service, **seule l'agence peut le faire** : déclarations, contrats, comptes chez des fournisseurs, réponses de SanlamAllianz. Ce dossier prépare chaque démarche : les courriers sont rédigés, les questions listées, les formulaires pré-remplis. Il reste à les relire, compléter les `[crochets]` et envoyer.

## Dans quel ordre

**Cette semaine** : ce qui prend le plus de temps.

| Démarche | Auprès de | Document prêt | Ce que ça débloque |
| --- | --- | --- | --- |
| Déclaration des traitements, demande de transfert à l'étranger | ARTCI | [ARTCI](artci.md) | Tout le reste : aucune donnée réelle avant le récépissé |
| Vérification de l'entreprise, compte WhatsApp Business | Meta | [WhatsApp](paiement-whatsapp-sms.md#whatsapp-business) | Relances, codes de l'espace client |
| Questions sur l'extranet, les commissions, les flottes, la lutte contre le blanchiment | SanlamAllianz | [Courrier](sanlamallianz-et-asaci.md#courrier-à-sanlamallianz) | Imports, bordereaux, commissions, estimation sur le site |
| Nom de domaine et adresse e-mail professionnelle | Bureau d'enregistrement, fournisseur d'e-mail | [Domaine et e-mail](nom-de-domaine-et-email.md) | Adresses du back-office et de l'espace client, fin de l'adresse Gmail |

**Dans le mois** :

| Démarche | Auprès de | Document prêt | Ce que ça débloque |
| --- | --- | --- | --- |
| Devis d'hébergement (choix final après la réponse de l'ARTCI) | Hébergeurs | [Hébergeur](hebergeur.md) | Mise en production |
| Compte marchand Mobile Money | Agrégateur ou opérateur | [Paiement](paiement-whatsapp-sms.md#compte-marchand-mobile-money) | Paiement en ligne des primes |
| Opérateur SMS | Opérateur agréé | [SMS](paiement-whatsapp-sms.md#opérateur-sms) | Relances par SMS |
| Accès aux attestations digitales | ASACI (ou SanlamAllianz) | [Courrier](sanlamallianz-et-asaci.md#courrier-à-lasaci) | Attestations vérifiées dans l'application |

**Avant l'ouverture** :

| Démarche | Document prêt |
| --- | --- |
| Préparer la reprise des clients, véhicules, contrats et encaissements non reversés | [Reprise des données](reprise-des-donnees.md) |
| Désigner le personnel et son rôle ; compléter les mentions légales ; trancher les questions en attente | [Personnel, mentions légales et décisions](personnel-et-decisions.md) |
| Activer les protections GitHub | [Paramètres GitHub](../securite/parametres-github.md) |
| Tout ce que demande la mise en service (serveur, sauvegardes, surveillance, test d'intrusion, formation) | [Liste de mise en service](../exploitation/mise-en-service.md) |

## Règles pour tous les échanges

- **Aucune donnée de client** dans un e-mail, un message WhatsApp ou une pièce jointe envoyée à un fournisseur : les exemples restent fictifs.
- **Aucun mot de passe ni clé** par e-mail ou WhatsApp : les accès reçus vont dans le gestionnaire de mots de passe de l'agence, et se transmettent au prestataire technique par ce gestionnaire ([gestion des secrets](../securite/gestion-des-secrets.md)).
- **Garder une copie** de chaque envoi et de chaque réponse (accusés de réception, récépissés, contrats) : l'ARTCI, SanlamAllianz ou un contrôleur peuvent les demander.
- Cocher la démarche dans la [feuille de route](../feuille-de-route.md#-tâche-2--décisions-et-démarches-de-lagence) quand elle est faite, et transmettre les réponses au prestataire technique : chaque réponse débloque un réglage ou un petit développement.
