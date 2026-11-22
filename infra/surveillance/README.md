# Surveillance

Trois niveaux, sans outil payant ([ADR 0016](../../docs/architecture/adr/0016-mise-en-production.md)) :

1. **Le serveur se répare seul** quand il le peut : chaque service redémarre après une panne, l'API et la base ont un contrôle de santé, Caddy renouvelle seul les certificats HTTPS.
2. **La page Exploitation du back-office** (gérant et auditeur) : état des services, sauvegardes, tests de restauration, événements de sécurité de la semaine, et des alertes en clair. Le gérant la regarde **chaque matin**.
3. **Deux signaux externes**, qui préviennent le gérant par e-mail ou SMS quand le serveur ne peut plus le faire lui-même (offre gratuite d'un service de surveillance, par exemple UptimeRobot, Better Stack ou Healthchecks.io) :
   - **disponibilité** : une requête vers `https://gestion.…/api/sante` toutes les 5 minutes ; alerte après deux échecs de suite ;
   - **battement de cœur de la sauvegarde** : le service donne une adresse, à mettre dans `SAUVEGARDE_SIGNAL_URL` (`infra/production/sauvegarde.env`). La sauvegarde l'appelle chaque nuit quand tout va bien ; sans appel pendant 26 heures, alerte.

## Ce qui est surveillé, et comment

| Signal | Seuil d'alerte | Où on le voit | Qui est prévenu |
| --- | --- | --- | --- |
| Site ou API indisponible | 2 échecs de suite (10 minutes) | Service de disponibilité | Gérant, prestataire technique (e-mail, SMS) |
| Sauvegarde absente, en échec ou pas copiée hors site | 26 heures sans sauvegarde complète | Page Exploitation ; battement de cœur | Gérant, prestataire technique |
| Anomalie du journal d'audit (ligne modifiée, ou dernières lignes supprimées) | Toute anomalie, vérifiée chaque nuit | Page Exploitation (alerte grave) ; plus de battement de cœur | Gérant, prestataire technique |
| Test de restauration en retard ou en échec | 35 jours | Page Exploitation | Gérant |
| Antivirus arrêté | Dès qu'il ne répond pas | Page Exploitation (une vraie analyse à chaque affichage) | Gérant |
| Échecs de connexion répétés sur un compte | 5 de suite : compte bloqué 15 minutes | Page Exploitation (blocages de la semaine, détaillés) | Gérant |
| Rafale de connexions refusées | 20 en 24 heures | Page Exploitation | Gérant |
| Comptes créés ou modifiés, accès réinitialisés, exports de données | Chaque fois | Page Exploitation (détail de la semaine) | Gérant |
| Primes encaissées non reversées | 30 jours (rappel à J+25) | Page Reversements | Gérant, caisse |
| Certificat HTTPS | Renouvelé seul 30 jours avant l'échéance | Service de disponibilité (une adresse en erreur HTTPS échoue) | Prestataire technique |
| Nom de domaine | Renouvellement automatique chez le gestionnaire du domaine, rappel au calendrier 30 jours avant | — | Gérant |

**Pas encore surveillé** : la connexion d'un compte du personnel depuis un nouvel appareil (prévue, non réalisée) ; l'espace disque du serveur, à regarder lors de la mise à jour hebdomadaire (`df -h`), ou à confier au service de surveillance de l'hébergeur s'il en propose un.

Les journaux techniques (Docker, 200 Mo par service au plus) ne contiennent aucune donnée personnelle : pas de corps de requête, pas de paramètres d'adresse ([journalisation et audit](../../docs/securite/journalisation-et-audit.md)).
