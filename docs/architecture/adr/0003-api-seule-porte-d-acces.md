# 0003 — L'API est la seule porte d'accès aux données

- Statut : Acceptée
- Date : 2026-11-03

## Contexte

Certaines plateformes (Supabase, Firebase) laissent le navigateur interroger directement la base, la sécurité reposant entièrement sur des règles d'accès. Une seule règle oubliée suffit alors à exposer toutes les données, et ces oublis ont causé de nombreuses fuites. Nos données sont sensibles : identité des clients, paiements, sinistres corporels.

## Décision

- Le back-office et l'espace client parlent **uniquement** à l'API.
- La base de données n'est **pas joignable depuis Internet** ; seule l'API, dans le même réseau privé, s'y connecte, avec le compte `dbs_application`.
- L'API authentifie, vérifie le rôle, valide chaque entrée, puis déclare l'utilisateur à la base pour la durée de la transaction.
- Les services extérieurs (paiement, WhatsApp) ne joignent que des routes de l'API dédiées, qui vérifient leur signature.

## Conséquences

- Deux barrières indépendantes : l'API, puis la base ([ADR 0004](0004-securite-dans-la-base.md)).
- Toute nouvelle fonctionnalité passe par une route de l'API, à écrire et à tester.

## Options écartées

- **Accès direct du navigateur à la base** (Supabase, Firebase) : surface d'attaque trop large pour des données d'assurance.
