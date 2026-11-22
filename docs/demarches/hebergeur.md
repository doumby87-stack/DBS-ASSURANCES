# Choisir l'hébergeur

Décision : [ADR 0006](../architecture/adr/0006-hebergement-et-localisation-des-donnees.md) (localisation, selon la réponse de l'ARTCI) et [ADR 0016](../architecture/adr/0016-mise-en-production.md) (ce qui tourne sur le serveur). Demander des devis dès maintenant, sur ce document, à deux ou trois hébergeurs : en Côte d'Ivoire et, si l'ARTCI autorise le transfert, en Europe. Il en faut **deux** : l'hébergeur principal, et un second fournisseur pour la copie hors site des sauvegardes.

## Ce qu'il nous faut

**Hébergeur principal**

| Besoin | Minimum | Pourquoi |
| --- | --- | --- |
| Serveur virtuel (VPS) ou dédié | 2 processeurs, **8 Go de mémoire**, 80 Go SSD | Application, antivirus (1,5 à 3 Go), lecture automatique |
| Disque | **Chiffré** | Exigence de l'ADR 0006 |
| Système | Ubuntu Server 24.04 LTS ou Debian 12, accès administrateur par clé SSH | Installation ([pas à pas](../../infra/production/README.md)) |
| Réseau | Une adresse IPv4 publique fixe ; ports 80 et 443 ouverts ; protection contre les attaques par saturation | HTTPS automatique |
| Instantanés du disque | Souhaités | Retour arrière rapide après une mise à jour |
| Base PostgreSQL 16 gérée | **Facultatif**, apprécié | Restauration à un instant donné : perte de données de quelques minutes au lieu d'une journée |
| Support | En français, par téléphone ou ticket, délai de réponse écrit | Panne |

**Second fournisseur (copie hors site des sauvegardes)**

| Besoin | Minimum |
| --- | --- |
| Stockage objet compatible S3 | Quelques dizaines de Go |
| **Verrouillage des objets** (« object lock », mode conformité) | Obligatoire : une sauvegarde ne doit pouvoir être ni effacée ni remplacée pendant 30 jours |
| Clés d'accès limitées | Une clé qui écrit sans pouvoir supprimer (serveur), une clé en lecture (test de restauration) |

## Questions à poser

1. Dans quel pays et quelle ville sont les serveurs et les copies de sauvegarde de l'hébergeur ? Peut-on choisir ?
2. Le disque est-il chiffré ? Qui, chez vous, peut accéder aux données, et dans quels cas ?
3. Proposez-vous un **contrat de sous-traitance** des données personnelles (confidentialité, sécurité, localisation, notification d'incident, restitution et effacement à la fin du contrat) ?
4. Base PostgreSQL gérée : version 16 ? Restauration à un instant donné, sur combien de jours ? Peut-on donner à un compte le droit de tout lire pour les sauvegardes (attribut `BYPASSRLS`) ?
5. Stockage objet : le verrouillage des objets est-il disponible ? Les clés d'accès peuvent-elles interdire la suppression ?
6. Disponibilité garantie, délais d'intervention, astreinte ; comment vous joindre en cas de panne ?
7. Protection contre les attaques par saturation ; pare-feu applicatif proposé ?
8. Prix mensuel tout compris (serveur, disque, instantanés, trafic, base gérée, stockage), durée d'engagement, préavis.
9. Fin de contrat : comment récupérer nos données, et dans quel délai sont-elles effacées chez vous ?

## Comparer les réponses

| | Hébergeur A | Hébergeur B | Hébergeur C |
| --- | --- | --- | --- |
| Pays des données | | | |
| Disque chiffré | | | |
| Contrat de sous-traitance | | | |
| Base gérée avec restauration à un instant donné | | | |
| Verrouillage des objets (stockage) | | | |
| Support (langue, délai) | | | |
| Prix mensuel | | | |
| Engagement | | | |

Le choix final attend la réponse de l'ARTCI ([ARTCI](artci.md)) : un hébergement hors de Côte d'Ivoire demande son autorisation de transfert.
