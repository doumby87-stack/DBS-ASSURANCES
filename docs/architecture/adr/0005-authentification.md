# 0005 — Deuxième facteur pour le personnel, code à usage unique pour les clients

- Statut : Proposée (mise en œuvre à la tâche 3 pour le personnel, à la tâche 9 pour les clients)
- Date : 2026-11-03

## Contexte

Le vol de mot de passe par hameçonnage est la première cause de compromission des petites structures. Le personnel accède à la caisse et aux données de tous les clients. Les clients, eux, se connectent rarement et depuis un téléphone : un mot de passe de plus serait oublié ou réutilisé.

## Décision

**Personnel (back-office)**

- Mot de passe d'au moins 12 caractères, vérifié contre les listes de mots de passe divulgués, stocké haché avec Argon2id.
- **Deuxième facteur obligatoire** : application d'authentification (TOTP) ou clé de sécurité / passkey (WebAuthn), cette dernière recommandée pour le gérant et la caisse.
- Session côté serveur, identifiant dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict` ; expiration après 15 minutes d'inactivité et 8 heures au maximum ; renouvellement de l'identifiant à la connexion.
- Blocage progressif après des échecs répétés ; alerte au gérant ; message d'erreur identique que le compte existe ou non.
- Création et désactivation des comptes par le gérant uniquement, tracées au journal d'audit.

**Clients (espace client)**

- Connexion par code à 6 chiffres envoyé sur WhatsApp ou par SMS au numéro du contrat, valable 5 minutes, 5 essais au plus.
- Gestionnaires de flotte : même principe, avec un deuxième facteur proposé.

## Conséquences

- Coût d'envoi des codes (quelques francs par connexion).
- Procédure de secours à écrire pour un membre du personnel qui perd son deuxième facteur (réinitialisation par le gérant, en personne).

## Options écartées

- **Mot de passe seul pour le personnel** : insuffisant face à l'hameçonnage.
- **Connexion par un compte Google ou Facebook pour les clients** : tous n'en ont pas, et cela confie l'accès à un tiers.
