# 0011 — Portail des entreprises : connexion par code WhatsApp, isolement des entreprises par la base

- Statut : Acceptée (modèle WhatsApp `dbs_code_connexion` à faire valider par Meta)
- Date : 2026-11-04

## Contexte

Les transporteurs et les entreprises veulent voir leur flotte sans appeler l'agence : quels véhicules sont assurés, quel document arrive à échéance, où en est un sinistre, combien reste à payer. Surtout, ils veulent leurs **attestations** pour les placer dans chaque camion : 40 camions, 40 PDF à récupérer un par un, c'est aujourd'hui une demi-journée de WhatsApp entre l'agence et le client.

Contraintes :

- Plusieurs personnes suivent une même flotte (gérant, chef de parc, comptable), et elles changent.
- Ce sont des utilisateurs occasionnels, souvent sur téléphone : un mot de passe de plus serait oublié, réutilisé ou noté.
- Les données d'une entreprise (flotte, primes, sinistres) ne doivent jamais apparaître chez une autre, même en cas d'erreur dans le code.
- Le back-office ne doit pas être exposé aux clients, ni leurs sessions mélangées.
- Les attestations sont des documents officiels : elles ne doivent être ni falsifiables ni porteuses de virus.

## Décision

1. **Une application à part** (`apps/portail`), sur sa propre adresse (par exemple `espace.<domaine>`), avec l'API derrière `/api/` comme pour le back-office. Ses requêtes qui modifient des données ne sont acceptées que depuis son origine (`URL_PORTAIL`), et celles du back-office que depuis la sienne. Le cookie de session est différent (`__Host-dbs_portail`), et la session est conservée dans une autre table.
2. **Connexion par un code à usage unique envoyé sur WhatsApp**, au numéro de l'accès, avec le modèle d'authentification de Meta (`dbs_code_connexion`, bouton « Copier le code »). Le code a 6 chiffres et vaut 10 minutes. Un seul code est valable à la fois et il accepte 5 essais. Les demandes sont limitées : 3 par numéro en 15 minutes, 10 par adresse IP en une heure, et 20 échecs en 15 minutes suspendent une adresse. La base ne garde qu'un HMAC du code, lié au numéro et calculé avec une clé que la base ne connaît pas. La réponse est la même, avec le même délai, que le numéro ait un accès ou non : on ne peut pas savoir qui est client de l'agence. La session expire après 30 minutes d'inactivité et 12 heures au maximum.
3. **Plusieurs accès par entreprise** (`app.gestionnaires_portail`) :
   - l'agence crée l'accès du **titulaire**, le représentant de l'entreprise ;
   - le titulaire ajoute ou retire ses collaborateurs, mais jamais un autre titulaire ni lui-même ;
   - un numéro ne correspond qu'à un seul accès actif ;
   - un accès retiré perd aussitôt ses sessions et ses codes.
4. **Isolement par la base, pas seulement par l'API** :
   - pendant une requête du portail, l'API prend le rôle `dbs_portail`. Elle en a le droit, mais n'en hérite pas les droits : une requête du personnel ne voit jamais les règles du portail, et inversement ;
   - la sécurité ligne par ligne de ce rôle ne montre que l'entreprise de la personne connectée ;
   - les droits par colonne écartent ce qui est interne à l'agence : prime nette (base des commissions), notes des sinistres, références bancaires, auteurs des écritures ;
   - toute autre table, comme le personnel, les relances, la caisse ou les demandes du site, est refusée au rôle.
5. **Attestations déposées par l'agence** (`app.attestations_vehicules`) : le PDF de l'ASACI est déposé avec son numéro, une fois la prime du contrat payée (Code CIMA, art. 13). Il est reconnu d'après son contenu et analysé par l'antivirus au dépôt (infecté : refusé). Il est ensuite chiffré (AES-256-GCM) avec un contexte propre à la période du véhicule. Le dépôt peut se faire en lot : plusieurs PDF choisis d'un coup sont rapprochés du véhicule dont la plaque figure dans leur nom. L'entreprise télécharge chaque attestation, ou toutes ses attestations en cours dans une **archive ZIP** produite sans dépendance. Chaque téléchargement est consigné dans `portail.evenements`.
6. **Sinistres par véhicule** : l'agence déclare un sinistre sur un contrat et, pour une flotte, sur le véhicule concerné. La base vérifie qu'il était couvert ce jour-là. Le portail montre l'historique de chaque véhicule (statut, référence de la compagnie), sans les notes internes.

## Conséquences

- Un transporteur récupère ses attestations en un clic, et suit ses échéances et ses sinistres sans appeler l'agence.
- Aucun mot de passe client à gérer, à réinitialiser ou à se faire voler. La connexion dépend de WhatsApp : en production, le portail exige l'accès à WhatsApp (variables `WHATSAPP_*`) et un antivirus (`ANTIVIRUS_ADRESSE`).
- Un nouveau rôle de base, `dbs_portail`, créé par `database/initialisation/01_roles_et_base.sql`. Sur une base déjà installée, il faut relancer ce script avec un superutilisateur avant la migration 0012, qui refuse de s'appliquer sans lui.
- Un sixième modèle WhatsApp à faire valider par Meta, de la catégorie « Authentification » ([modèles de messages](../../metier/modeles-de-messages.md)).
- La tâche 9 (espace client des particuliers, paiement Mobile Money) réutilisera ce socle : la connexion par code, les sessions et le rôle restreint.

## Options écartées

- **Le portail dans le back-office** : une seule origine pour le personnel et les clients. Une faille côté client aurait atteint les sessions du personnel.
- **Mot de passe client** : oubli, réutilisation, réinitialisation à gérer, et pas de deuxième facteur réaliste pour des utilisateurs occasionnels. Le code WhatsApp prouve la possession du téléphone à chaque connexion.
- **Code par SMS seulement** : plus cher et sans bouton « Copier le code ». Le SMS restera un canal de repli quand l'opérateur sera choisi ([ADR 0007](0007-relances-whatsapp-et-sms.md)).
- **Filtrer par entreprise dans l'API seulement** : une requête qui oublie son filtre montrerait la flotte d'un autre client. Avec le rôle `dbs_portail`, la base refuse.
- **Lien vers la plateforme de l'ASACI** au lieu du PDF : le client devrait s'y retrouver lui-même, véhicule par véhicule, et l'agence ne saurait pas ce qui a été remis.
