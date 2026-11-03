# Surveillance

À mettre en place avant l'ouverture du back-office (tâche 11 de la [feuille de route](../../docs/feuille-de-route.md)).

| Signal | Seuil d'alerte | Qui est prévenu |
| --- | --- | --- |
| Site ou API indisponible | 2 minutes | Gérant, prestataire technique |
| Échecs de connexion répétés sur un compte | 5 en 15 minutes | Gérant |
| Connexion d'un compte du personnel depuis un nouvel appareil | chaque fois | La personne concernée |
| Export de données clients | chaque fois | Gérant |
| Vérification quotidienne de `audit.verifier_chaine()` | toute anomalie | Gérant, prestataire technique |
| Sauvegarde quotidienne absente ou en échec | 1 jour | Prestataire technique |
| Primes encaissées non reversées à J+25 | chaque matin | Gérant, caisse |
| Certificat HTTPS ou nom de domaine expirant | 30 jours avant | Gérant |

Les journaux techniques sont conservés 12 mois, sans donnée personnelle ([journalisation et audit](../../docs/securite/journalisation-et-audit.md)).
