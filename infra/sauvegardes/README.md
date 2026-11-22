# Sauvegardes et restauration

Politique (objectifs, règle 3-2-1, conservation) : [`docs/securite/sauvegardes-et-reprise.md`](../../docs/securite/sauvegardes-et-reprise.md). Décision : [ADR 0016](../../docs/architecture/adr/0016-mise-en-production.md).

| Fichier | Rôle |
| --- | --- |
| `sauvegarder.sh` | La sauvegarde : `pg_dump` chiffré au fil de l'eau par la clé publique age, copie hors site, compte rendu dans la base avec la vérification du journal d'audit. |
| `planifier.sh` | La lance chaque nuit (`SAUVEGARDE_HEURE`, 02:00 heure d'Abidjan par défaut). |
| `restaurer-et-verifier.sh` | Le test de restauration du mois, sur un poste de test. |
| `inscrire-test-restauration.sh` | Inscrit le résultat de ce test dans la production, depuis le serveur. |
| `Dockerfile` | L'image du service `sauvegarde` de [`infra/production/compose.yml`](../production/compose.yml). |

## Chaque nuit, sans rien faire

1. La dernière empreinte du journal d'audit est notée.
2. Toute la base est sauvegardée, pièces et photos comprises (elles sont dans la base, chiffrées), et chiffrée **avant** d'être écrite sur le disque, avec la **clé publique** : le serveur ne peut pas relire ses propres sauvegardes.
3. Le fichier et son empreinte (`.empreinte`) partent sur le stockage hors site, en écriture unique.
4. La chaîne du journal d'audit est entièrement vérifiée, et la dernière empreinte de la nuit précédente doit toujours s'y trouver.
5. Le compte rendu s'inscrit dans la base : le gérant le voit dans le back-office, page **Exploitation**, avec une alerte si quelque chose ne va pas.
6. Si tout va bien, un signal part vers le service de surveillance (`SAUVEGARDE_SIGNAL_URL`) ; son absence prévient le gérant ([surveillance](../surveillance/README.md)).

Le serveur garde 7 jours de copies locales (`SAUVEGARDE_CONSERVATION_JOURS`) ; le stockage hors site garde 30 jours de sauvegardes quotidiennes, réglé chez le fournisseur.

Code de sortie de `sauvegarder.sh` : 0 tout va bien, 1 échec, **2 anomalie du journal d'audit** (procédure d'incident, [réponse aux incidents](../../docs/securite/reponse-aux-incidents.md), sans rien corriger).

## Test de restauration, chaque mois

Une sauvegarde jamais restaurée n'est pas une sauvegarde. Compter 15 minutes. Sur **un poste de test** (celui du prestataire), jamais sur le serveur de production, car il faut la clé privée.

**Ce qu'il faut sur le poste** : Docker, `age` et les outils de PostgreSQL 16 (`sudo apt install age postgresql-client-16`), une copie du dépôt, la clé USB de la clé privée, et l'outil `rclone` configuré en lecture sur le stockage hors site (ou le fichier récupéré autrement).

```sh
# 1. La dernière sauvegarde et son empreinte, depuis le stockage hors site
mkdir -p ~/restauration && cd ~/restauration
rclone lsf horssite:dbs-sauvegardes | tail -2
rclone copy horssite:dbs-sauvegardes/dbs-20261201T020000Z.dump.age .
rclone copy horssite:dbs-sauvegardes/dbs-20261201T020000Z.dump.age.empreinte .

# 2. Un serveur PostgreSQL jetable, seulement sur ce poste
docker run -d --rm --name dbs-restauration -e POSTGRES_PASSWORD=jetable -p 127.0.0.1:55432:5432 postgres:16-alpine

# 3. Le test
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=jetable \
SAUVEGARDE_CLE_PRIVEE_FICHIER=/media/cle-usb/dbs-sauvegardes.cle EFFECTUE_PAR="Prénom NOM" \
  ~/dbs/infra/sauvegardes/restaurer-et-verifier.sh dbs-20261201T020000Z.dump.age

# 4. Ranger
docker stop dbs-restauration
```

Le script vérifie l'empreinte du fichier, restaure dans une base isolée, vérifie toute la chaîne du journal d'audit et la présence de l'empreinte notée au moment de la sauvegarde, puis affiche des **totaux à comparer avec la production** (clients, contrats, encaissements, montant encaissé, dernier encaissement) : les comparer avec le back-office. Il écrit son résultat dans `dbs-….dump.age.resultat`.

```sh
# 5. Inscrire le résultat dans la production : la page Exploitation le montre, et l'alerte du mois s'éteint
ssh serveur 'docker compose -f /opt/dbs/infra/production/compose.yml exec -T sauvegarde inscrire-test-restauration.sh' \
  < dbs-20261201T020000Z.dump.age.resultat
```

Puis effacer les fichiers du poste (`rm -r ~/restauration`) et ranger la clé USB.

**Un échec** (empreinte fausse, déchiffrement impossible, chaîne d'audit rompue, totaux qui ne correspondent pas) s'inscrit aussi : c'est un incident, à traiter le jour même ([réponse aux incidents](../../docs/securite/reponse-aux-incidents.md)).

## Reprise après un sinistre : restaurer la production pour de vrai

Serveur détruit, piraté ou base inutilisable. Objectif : back-office de retour en 4 heures ouvrées ; pendant ce temps, reçus manuels pré-numérotés ([sauvegardes et reprise](../../docs/securite/sauvegardes-et-reprise.md)).

Il faut : la clé privée des sauvegardes, **et** `CLE_CHIFFREMENT_DONNEES` (copie scellée) : sans elle, la base revient mais les pièces, les numéros de pièces d'identité et les deuxièmes facteurs restent illisibles.

1. **Un serveur neuf** (s'il a été piraté, ne jamais réutiliser l'ancien) : étapes 1 à 5 de la [mise en production](../production/README.md), avec **de nouveaux mots de passe** et la même `CLE_CHIFFREMENT_DONNEES`.
2. **La base vide** : `dbs --profile base-locale up -d --wait base` puis `dbs --profile outils run --rm initialisation` (pas les migrations : la sauvegarde contient déjà tout).
3. **La dernière bonne sauvegarde**, déchiffrée sur le poste qui a la clé privée et envoyée au serveur par SSH, sans jamais y poser la clé :
   ```sh
   age --decrypt --identity /media/cle-usb/dbs-sauvegardes.cle dbs-20261201T020000Z.dump.age \
     | ssh serveur 'docker compose -f /opt/dbs/infra/production/compose.yml exec -T base pg_restore -U postgres --exit-on-error -d dbs'
   ```
   (Avec une base gérée : sa propre fonction de restauration, ou `pg_restore` avec le compte d'administration.)
4. **Vérifier** : `dbs exec base psql -U postgres -d dbs -c 'SELECT * FROM audit.verifier_chaine()'` (aucune anomalie), puis les totaux comme pour le test mensuel.
5. **Mettre à niveau et démarrer** : `dbs --profile outils run --rm migrations` (si la sauvegarde est plus ancienne que le code), puis `dbs --profile base-locale up -d --build --wait`.
6. **Ressaisir** les encaissements faits sur les reçus manuels depuis la sauvegarde, avec leur date réelle.
7. **Renouveler tous les secrets** si le serveur a été piraté ([gestion des secrets](../../docs/securite/gestion-des-secrets.md)), et suivre la procédure d'incident jusqu'au bout.
