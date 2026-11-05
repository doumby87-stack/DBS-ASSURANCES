# 0005 — Deuxième facteur pour le personnel, code à usage unique pour les clients

- Statut : Acceptée. Personnel : en place depuis la tâche 3 ([API](../../../apps/api/README.md)). Clients : en place dans l'espace client, par un code envoyé sur WhatsApp (tâches 10 et 9, [ADR 0011](0011-portail-des-entreprises.md), [ADR 0012](0012-espace-client-et-paiement-en-ligne.md)).
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

## Mise en œuvre (tâche 3)

- Premier accès : le gérant crée le compte et remet en main propre un mot de passe provisoire ; à la première connexion, la personne configure son deuxième facteur puis choisit son mot de passe. Aucun accès aux données avant.
- Blocage après 5 échecs consécutifs (mot de passe ou code), 15 minutes puis doublé, 24 heures au plus ; le compteur ne revient à zéro qu'après une connexion complète. 20 échecs depuis une même adresse IP en 15 minutes suspendent les tentatives de cette adresse.
- Mots de passe divulgués : vérification par k-anonymat auprès de Have I Been Pwned (seuls 5 caractères de l'empreinte SHA-1 quittent le serveur). Si le service ne répond pas, le changement est accepté et l'incident journalisé.
- La procédure de secours (deuxième facteur perdu) est la réinitialisation de l'accès par un gérant.

## Options écartées

- **Mot de passe seul pour le personnel** : insuffisant face à l'hameçonnage.
- **Connexion par un compte Google ou Facebook pour les clients** : tous n'en ont pas, et cela confie l'accès à un tiers.
