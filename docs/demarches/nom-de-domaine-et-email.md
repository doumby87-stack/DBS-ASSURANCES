# Nom de domaine et adresse e-mail professionnelle

Aujourd'hui l'agence écrit depuis une adresse Gmail : n'importe qui peut créer une adresse qui lui ressemble et se faire passer pour elle. Un nom de domaine à l'agence (par exemple `dbs-assurances.ci`) donne des adresses e-mail que l'on peut protéger, et les adresses de l'application : `gestion.` pour le back-office, `client.` pour l'espace client.

## 1. Réserver le nom

- Choisir le nom (court, sans ambiguïté) et l'extension : `.ci` (registre ivoirien, géré par l'ARTCI, réservé par un bureau d'enregistrement agréé) et, si possible, la même chose en `.com` pour éviter qu'un escroc la prenne.
- Le réserver **au nom de la société**, avec une adresse e-mail de l'agence comme contact (pas celle d'un prestataire).
- Sur le compte du bureau d'enregistrement : **deuxième facteur**, **renouvellement automatique**, **verrou contre le transfert**. Noter la date d'expiration dans le calendrier, 30 jours avant.

## 2. L'adresse e-mail professionnelle

Choisir un fournisseur d'e-mail (celui du bureau d'enregistrement, de l'hébergeur, ou un service connu). S'il garde les e-mails hors de Côte d'Ivoire, l'ajouter à la demande de transfert de l'ARTCI ([ARTCI](artci.md)).

Adresses conseillées : une par personne (`prenom.nom@…`), plus `contact@…` (site, clients) et `securite@…` (alertes de surveillance, rapports DMARC, certificats). Deuxième facteur obligatoire sur chaque boîte.

## 3. Les enregistrements DNS

À saisir chez le bureau d'enregistrement (ou à faire saisir par le prestataire technique). `IP_DU_SERVEUR` est donnée par l'hébergeur ; les valeurs du fournisseur d'e-mail sont dans son guide de configuration.

| Nom | Type | Valeur | Rôle |
| --- | --- | --- | --- |
| `gestion` | A | `IP_DU_SERVEUR` | Back-office ([mise en production](../../infra/production/README.md)) |
| `client` | A | `IP_DU_SERVEUR` | Espace client |
| (racine) et `www` | selon Netlify | valeurs données par Netlify | Site vitrine |
| (racine) | MX | valeurs du fournisseur d'e-mail | Réception des e-mails |
| (racine) | TXT | `v=spf1 include:[fournisseur] ~all` | **SPF** : quels serveurs peuvent envoyer au nom de l'agence |
| `[sélecteur]._domainkey` | TXT ou CNAME | clé donnée par le fournisseur | **DKIM** : signature des e-mails envoyés |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:securite@[domaine]` | **DMARC** : que faire d'un e-mail qui prétend venir de l'agence sans l'être |

**DMARC, en trois temps** :

1. `p=none` pendant 2 à 4 semaines : rien n'est bloqué, les rapports reçus sur `securite@` montrent qui envoie au nom de l'agence (logiciel de facturation, site, etc.) ;
2. quand tous les envois légitimes passent SPF et DKIM : `p=quarantine` (les faux vont dans les indésirables) ;
3. puis `p=reject` : les faux e-mails « de DBS » sont refusés. Remplacer alors `~all` par `-all` dans le SPF.

## 4. Ensuite

- [ ] Remplacer l'adresse Gmail sur le site (`apps/site-vitrine/src/donnees/agence.ts`), les cartes de visite, les courriers ; garder la boîte Gmail quelques mois avec une réponse automatique qui donne la nouvelle adresse.
- [ ] Donner les deux adresses (`gestion.`, `client.`) au prestataire technique pour la mise en production.
- [ ] Ajouter la nouvelle adresse et le domaine à la question sur les arnaques des « Questions fréquentes » du site (`apps/site-vitrine/src/donnees/faq.ts`) : les clients sauront que seuls les messages venant de ce domaine viennent de l'agence.
