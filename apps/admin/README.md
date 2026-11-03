# Back-office de l'agence (espace administrateur)

**Statut : à construire** (tâches 4 à 8 de la [feuille de route](../../docs/feuille-de-route.md)).

L'outil de travail quotidien de l'agence : clients, contrats, flottes, caisse, reversements à SanlamAllianz, sinistres et relances. Il ne contient aucune donnée : il affiche ce que l'API lui autorise à voir.

Pile prévue : React, TypeScript, Vite, application installable (PWA) ([ADR 0002](../../docs/architecture/adr/0002-pile-technique.md)).

## Pages

| Dossier | Contenu | Rôles |
| --- | --- | --- |
| `src/pages/tableau-de-bord/` | Échéances à J-30/J-15/J-7, primes à reverser avec leur compte à rebours, devis en attente, sinistres bloqués | tous |
| `src/pages/clients/` | Fiche client unique : contrats, véhicules, paiements, sinistres, échanges | tous sauf caissier en écriture |
| `src/pages/contrats/` | Polices, avenants, attestations, renouvellements | gérant, chargé de clientèle |
| `src/pages/flottes/` | Import Excel, contrôle des doublons, échéances de visite technique, vignette, carte de transport | gérant, chargé de clientèle, commercial |
| `src/pages/caisse/` | Encaissements, reçus, clôture de caisse, plafond espèces | gérant, caissier |
| `src/pages/reversements/` | Bordereaux pour la compagnie, validation par une seconde personne | gérant, caissier |
| `src/pages/sinistres/` | Déclarations, pièces à fournir, délais, suivi compagnie | gérant, chargé de clientèle |
| `src/pages/relances/` | Messages WhatsApp et SMS programmés, modèles | gérant, chargé de clientèle |
| `src/pages/statistiques/` | Renouvellements, devis gagnés, production par branche | gérant, auditeur |
| `src/pages/parametres/` | Utilisateurs et rôles, modèles de documents | gérant |

Les droits réels sont appliqués par l'API et la base ([matrice des accès](../../docs/securite/controle-des-acces.md)). Masquer un bouton à l'écran n'est jamais une protection.

## Sécurité propre au back-office

- Publié sur un **sous-domaine séparé** du site vitrine (par exemple `gestion.<domaine>`), jamais référencé par les moteurs de recherche.
- **Deuxième facteur obligatoire** pour tout le personnel, clé de sécurité (passkey) recommandée pour le gérant et la caisse.
- Déconnexion automatique après 15 minutes d'inactivité et au bout de 8 heures dans tous les cas.
- Politique de sécurité du contenu stricte, comme le site vitrine, sans script ni service tiers.
- Aucune donnée client dans le stockage du navigateur (`localStorage`) : la mémoire hors connexion de l'application installée se limite aux écrans, jamais aux fiches clients.
- Les exports (Excel, PDF) sont journalisés et réservés au gérant.
