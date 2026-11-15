# Infrastructure

Où et comment les applications tournent. Décision d'hébergement : [ADR 0006](../docs/architecture/adr/0006-hebergement-et-localisation-des-donnees.md) (en attente de l'avis de l'ARTCI).

| Dossier | Contenu |
| --- | --- |
| `docker/compose.dev.yml` | Base PostgreSQL de développement, accessible uniquement depuis la machine locale. |
| `production/` | La production : images, serveur web Caddy, Docker Compose, variables à remplir et [procédure de mise en service](production/mise-en-service.md) ([ADR 0017](../docs/architecture/adr/0017-mise-en-production.md)). |
| `sauvegardes/` | Sauvegarde chiffrée, copie hors site, test de restauration mensuel ([README](sauvegardes/README.md)). |
| `surveillance/` | Ce qui est surveillé, à quelle fréquence, et qui est alerté ([README](surveillance/README.md)). |
| `tests/` | Essais de la production et des sauvegardes, lancés par l'intégration continue. |

## Trois environnements séparés

| Environnement | Usage | Données |
| --- | --- | --- |
| Local | Développement sur la machine du développeur | Fictives uniquement |
| Recette | Essais avant mise en production, par l'agence | Fictives uniquement |
| Production | Utilisation réelle | Réelles, chiffrées |

Chaque environnement a ses propres comptes, mots de passe et clés. Rien n'est partagé entre eux, et aucune donnée réelle ne descend vers la recette ou le local.

## Exigences pour la production

- Base de données **non exposée sur Internet** : seule l'API, dans le même réseau privé, peut la joindre.
- Chiffrement du disque et des sauvegardes ; connexions à la base en TLS.
- Back-office sur un sous-domaine distinct. Limitation des tentatives par l'API et la base ; pare-feu applicatif (WAF) de l'hébergeur ou de Cloudflare devant le serveur web dès qu'il est disponible (`PROXYS_AMONT`, [ADR 0017](../docs/architecture/adr/0017-mise-en-production.md)).
- Accès d'administration aux serveurs par clé SSH et deuxième facteur, jamais par mot de passe ; liste nominative des personnes autorisées, revue tous les trimestres.
- Mises à jour de sécurité du système appliquées chaque semaine, et sous 48 heures pour une faille critique.
- Secrets fournis par le gestionnaire de secrets de l'hébergeur, jamais par un fichier du dépôt ([gestion des secrets](../docs/securite/gestion-des-secrets.md)).
