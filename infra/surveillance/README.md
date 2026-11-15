# Surveillance

`controler.sh` tourne dans le conteneur `sauvegarde` de la production (`infra/production/compose.yml`), lancé par `infra/sauvegardes/planifier.sh`. Décision : [ADR 0017](../../docs/architecture/adr/0017-mise-en-production.md).

| Signal | Seuil d'alerte | Contrôle | Qui est prévenu |
| --- | --- | --- | --- |
| API injoignable, en interne ou par son adresse publique | 1 contrôle en échec | Tous les quarts d'heure | Gérant, prestataire technique |
| Serveur entier arrêté | 5 minutes | Surveillance extérieure (hébergeur ou service en ligne) | Gérant, prestataire technique |
| Échecs de connexion répétés sur un compte | 5 en 15 minutes | Tous les quarts d'heure | Gérant |
| Certificat HTTPS expirant | 30 jours avant | Chaque matin | Gérant, prestataire technique |
| Sauvegarde de la nuit absente ou en échec | Plus de 26 heures, ou échec | Chaque matin | Prestataire technique |
| Test de restauration en échec | Chaque fois | Le 1er du mois | Gérant, prestataire technique |
| Journal d'audit : anomalie, ou empreinte de la dernière sauvegarde disparue | Toute anomalie | Chaque matin, et à chaque sauvegarde | Gérant, prestataire technique |
| Exports de données clients de la veille | Chaque fois | Chaque matin | Gérant |
| Primes encaissées non reversées à la date limite | Chaque matin | Chaque matin | Gérant, caisse |
| Connexion d'un compte du personnel depuis un nouvel appareil | Chaque fois | À faire (notification par l'API) | La personne concernée |
| Nom de domaine expirant | 30 jours avant | Registraire (renouvellement automatique) | Gérant |

## Où vont les alertes

Chaque alerte est passée, en texte, à la commande `ALERTE_COMMANDE` de `.env`. Une alerte identique à la précédente n'est pas renvoyée ; elle repart dès qu'elle change, et s'efface quand tout est rentré dans l'ordre. Exemples :

```bash
# Service de notifications (application sur le téléphone du gérant et du prestataire)
ALERTE_COMMANDE=curl -fsS -H "Title: DBS-ASSURANCES" --data-binary @- https://ntfy.sh/<sujet-secret>
# Relais e-mail ou WhatsApp de l'agence, s'il expose une adresse qui reçoit un texte
ALERTE_COMMANDE=curl -fsS -X POST -H "Content-Type: text/plain" --data-binary @- https://<relais>/alertes
```

Le texte d'une alerte ne contient aucune donnée de client : des nombres et des noms de contrôle. Seule exception, l'alerte des échecs de connexion nomme le compte du personnel visé. Préférer donc un canal que l'agence maîtrise (relais à elle, messagerie professionnelle). Avec un service public de notifications, prendre un sujet secret et long, rangé avec les autres secrets.

## Lancer à la main

```bash
docker compose exec sauvegarde /outils/surveillance/controler.sh rapide
docker compose exec sauvegarde /outils/surveillance/controler.sh quotidien
```

Code de sortie 0 : rien à signaler ; 1 : au moins une alerte (affichée).

Les journaux techniques sont gardés par Docker par rotation (50 Mo × 20 fichiers par service), sans mot de passe ni cookie ([journalisation et audit](../../docs/securite/journalisation-et-audit.md)).
