# Sauvegardes et restauration

Politique : [`docs/securite/sauvegardes-et-reprise.md`](../../docs/securite/sauvegardes-et-reprise.md). Décision : [ADR 0017](../../docs/architecture/adr/0017-mise-en-production.md). Ces scripts tournent dans le conteneur `sauvegarde` de la production (`infra/production/compose.yml`), image construite par le `Dockerfile` de ce dossier.

| Script | Rôle | Quand |
| --- | --- | --- |
| `sauvegarder.sh` | Vérifie le journal d'audit et note sa dernière empreinte, exporte la base (`pg_dump`), la chiffre avec `age`, garde 30 quotidiennes et 12 mensuelles, copie le tout hors site (`rclone copy`). | Chaque nuit à 1 h 30, ou aux heures de `SAUVEGARDE_HORAIRES` |
| `tester-restauration.sh` | Restaure la dernière sauvegarde dans une base d'essai, la vérifie, la supprime ; alerte en cas d'échec. | Le 1er de chaque mois, 3 h |
| `restaurer.sh` | Restauration vérifiée d'un fichier donné : empreinte, déchiffrement, réglages de la base, journal d'audit, totaux, registre. N'écrase jamais une base existante sans `--remplacer`. | Test mensuel, reprise après incident |
| `planifier.sh` | Lance les tâches ci-dessus et la surveillance aux bonnes heures (heure d'Abidjan). | En continu |

## Ce que contient le volume `sauvegardes`

| Chemin | Contenu |
| --- | --- |
| `quotidiennes/dbs-AAAAMMJJTHHMMSSZ.dump.age` et `.sha256` | Sauvegardes chiffrées et leur empreinte, 30 jours |
| `mensuelles/` | La première sauvegarde de chaque mois, 12 mois |
| `empreintes/journal-audit.log` | À chaque sauvegarde : date, lignes du journal d'audit, première anomalie, dernière empreinte. Jamais supprimé, copié hors site. |
| `registre-restaurations.log` | Registre des tests de restauration : date, fichier, base, résultat, durée, totaux |
| `derniere.json` | État de la dernière sauvegarde, lu par la surveillance |

## Chiffrement

Chaque sauvegarde est chiffrée avec [age](https://age-encryption.org) pour la clé publique de l'agence (`SAUVEGARDE_CLE_PUBLIQUE`). Le serveur n'a besoin que de cette clé publique pour sauvegarder ; la clé privée (`secrets/age-identite.txt`) sert aux tests de restauration. Ses copies de secours sont au coffre-fort d'équipe et sous pli scellé, hors de l'agence ([gestion des secrets](../../docs/securite/gestion-des-secrets.md)).

## Hors site et immuable

`rclone copy` dépose les fichiers chez un second fournisseur, sans jamais rien effacer là-bas. Le stockage doit être en **écriture unique** (verrouillage des objets, 30 jours au moins) : même un attaquant maître du serveur ne peut pas effacer les copies déjà déposées.

## Tester

```bash
# Contre une base de test remplie par database/tests/executer.sh (serveur DE TEST uniquement)
PGHOST=… PGPORT=… PGUSER=postgres PGPASSWORD=… infra/tests/sauvegarde-restauration.sh
```

L'intégration continue le lance dans l'image de ce dossier, et démarre toute la pile de production (`infra/tests/production.sh`). Les vérifications portent sur :

- **le fichier** : chiffré, illisible sans la bonne clé ;
- **la restauration** : complète, avec propriétaires, sécurité ligne par ligne, droits de connexion et heure d'Abidjan ;
- **les refus** : fichier altéré, journal d'audit tronqué, base existante.

## Sur le serveur

```bash
cd /opt/dbs/infra/production
docker compose exec sauvegarde /outils/sauvegardes/sauvegarder.sh          # sauvegarde immédiate
docker compose exec sauvegarde /outils/sauvegardes/tester-restauration.sh  # test immédiat
docker compose exec sauvegarde cat /sauvegardes/registre-restaurations.log
docker compose logs sauvegarde                                             # journal des tâches planifiées
```
