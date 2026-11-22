# Infrastructure

Où et comment les applications tournent. Décision d'hébergement : [ADR 0006](../docs/architecture/adr/0006-hebergement-et-localisation-des-donnees.md) (en attente de l'avis de l'ARTCI).

| Dossier | Contenu |
| --- | --- |
| `docker/compose.dev.yml` | Base PostgreSQL de développement, accessible uniquement depuis la machine locale. |
| `production/` | La pile de production (Caddy, API, antivirus, base, sauvegarde) et la [mise en production pas à pas](production/README.md) ([ADR 0016](../docs/architecture/adr/0016-mise-en-production.md)). |
| `sauvegardes/` | Sauvegarde chiffrée de la nuit, test de restauration du mois, reprise après sinistre. |
| `surveillance/` | Ce qui est surveillé, où on le voit et qui est alerté. |

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
- Back-office et espace client sur des sous-domaines distincts ; tentatives de connexion limitées par l'API (par compte et par adresse) et formulaires du site limités par la base. Un pare-feu applicatif (WAF) de l'hébergeur, s'il en propose un dans le pays retenu, s'ajoute devant.
- Accès d'administration aux serveurs par clé SSH et deuxième facteur, jamais par mot de passe ; liste nominative des personnes autorisées, revue tous les trimestres.
- Mises à jour de sécurité du système appliquées chaque semaine, et sous 48 heures pour une faille critique.
- Secrets dans des fichiers du serveur lisibles par leur seul propriétaire (ou le gestionnaire de secrets de l'hébergeur), jamais dans le dépôt ([gestion des secrets](../docs/securite/gestion-des-secrets.md)).
