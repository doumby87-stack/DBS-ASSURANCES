# Exigences de sécurité

Règles que tout code du projet doit respecter. Elles reprennent les thèmes du standard OWASP ASVS (niveau 2, visé pour les applications qui traitent des données personnelles), adaptés à notre contexte. Une pull request qui touche un de ces thèmes indique, dans sa description, comment l'exigence est respectée.

## Authentification

- Personnel : mot de passe d'au moins 12 caractères, vérifié contre les listes de mots de passe divulgués, haché avec Argon2id ; deuxième facteur obligatoire ([ADR 0005](../architecture/adr/0005-authentification.md)).
- Clients : code à usage unique de 6 chiffres, 5 minutes, 5 essais.
- Même message d'erreur que le compte existe ou non ; blocage progressif après des échecs répétés.
- Toute réinitialisation (mot de passe, deuxième facteur) est notifiée à la personne et tracée.

## Sessions

- Identifiant de session aléatoire, stocké côté serveur, transmis dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- Nouvel identifiant à chaque connexion ; session détruite à la déconnexion.
- Expiration : 15 minutes d'inactivité et 8 heures au maximum pour le personnel.

## Contrôle d'accès

- Chaque route de l'API déclare ses rôles ; refus par défaut.
- Les droits sont vérifiés à nouveau par la base ([contrôle des accès](controle-des-acces.md)).
- Un identifiant reçu du navigateur (client, contrat) n'est jamais une preuve de droit : la base filtre.

## Entrées et sorties

- Toute entrée est validée par un schéma : type, longueur maximale, format (téléphone E.164, immatriculation, montants entiers).
- Requêtes SQL paramétrées uniquement.
- Affichage toujours échappé ; jamais d'insertion de HTML venant d'un utilisateur.
- Politique de sécurité du contenu stricte sur toutes les applications, sans script inline non autorisé ni ressource tierce ([en-têtes HTTP](en-tetes-http.md)).

## Cryptographie

- HTTPS partout (TLS 1.2 minimum), HSTS.
- Numéros de pièces d'identité chiffrés par l'application (AES-256-GCM) avant d'entrer en base ; clé hors de la base.
- Aucun algorithme « maison ». Bibliothèques standard et maintenues.

## Fichiers déposés

- Types autorisés (PDF, JPEG, PNG), taille maximale, contenu vérifié (pas seulement l'extension), analyse antivirus.
- Stockés hors du serveur web, sous un nom aléatoire ; servis uniquement après contrôle des droits.
- Métadonnées de localisation retirées des photos, sauf accord explicite pour un sinistre.

## Services extérieurs et webhooks

- Signature de chaque notification vérifiée ; notification rejouée refusée (référence enregistrée une seule fois).
- Montant et statut d'un paiement confirmés auprès du prestataire avant de mettre un contrat en vigueur.
- Délais d'attente et nombre de tentatives limités pour chaque appel sortant.

## Journalisation

- Journal d'audit des données métier dans la base ([journalisation et audit](journalisation-et-audit.md)).
- Journal technique sans mot de passe, jeton, pièce d'identité ni contenu de message.
- Événements de sécurité journalisés : connexions, échecs, changements de droits, exports, réinitialisations.

## Données personnelles

- Collecter le minimum ; durées de conservation respectées ([classification des données](classification-des-donnees.md)).
- Pas de donnée personnelle dans les adresses (URL), les noms de fichiers ou les journaux techniques.
- Aucune donnée réelle hors de la production.

## Configuration et dépendances

- Secrets dans le gestionnaire de secrets, jamais dans le dépôt ([gestion des secrets](gestion-des-secrets.md)).
- L'application refuse de démarrer si une variable obligatoire manque.
- Dépendances verrouillées, mises à jour surveillées, revue avant fusion.
- Messages d'erreur génériques côté navigateur ; détails dans le journal technique seulement.
