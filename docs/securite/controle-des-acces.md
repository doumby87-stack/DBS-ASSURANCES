# Contrôle des accès

## Principes

1. **Moindre privilège** : chacun a exactement ce dont son travail a besoin.
2. **Refus par défaut** : ce qui n'est pas explicitement autorisé est interdit.
3. **Quatre yeux** sur l'argent : celui qui prépare un reversement ne le valide pas ; seul le gérant annule un encaissement.
4. **Rien ne s'efface** : aucun rôle n'a le droit de supprimer une donnée métier.
5. **Appliqué deux fois** : par l'API, puis par la base de données. Masquer un bouton à l'écran n'est jamais une protection.

## Rôles

| Rôle | Pour qui |
| --- | --- |
| `gerant` | Gérant et, si besoin, son adjoint |
| `charge_clientele` | Personnel qui gère contrats et sinistres |
| `caissier` | Personne qui encaisse |
| `commercial` | Prospection, sans accès à la caisse |
| `apporteur` | Apporteur d'affaires extérieur |
| `auditeur` | Expert-comptable, contrôleur de la compagnie, en lecture seule |

## Matrice (appliquée par la base, testée dans `database/tests`)

L = lire · C = créer · M = modifier · — = aucun accès

| Données | Gérant | Chargé de clientèle | Caissier | Commercial | Apporteur | Auditeur |
| --- | --- | --- | --- | --- | --- | --- |
| Utilisateurs | L C M | L | L | L | L | L |
| Clients | L C M | L C M | L | L C M | ses clients : L C | L |
| Véhicules | L C M | L C M | L | L C M | ses clients : L | L |
| Contrats | L C M | L C M | L | L | ses clients : L | L |
| Encaissements | L C, annulation | L | L C | — | — | L |
| Reversements | L C, validation, versement | — | L C (préparation) | — | — | L |
| Sinistres | L C M | L C M | — | L | — | L |
| Journal d'audit | via le rôle `dbs_audit` | — | — | — | — | via le rôle `dbs_audit` |

Personne, pas même le gérant, ne modifie un encaissement, ne valide son propre bordereau ou ne supprime une ligne.

## Vie des comptes

- **Arrivée** : le gérant crée le compte avec le rôle le plus restreint qui convient. Deuxième facteur activé avant tout accès aux données.
- **Changement de poste** : le rôle est changé le jour même.
- **Départ** : compte désactivé **le jour du départ**, avant la remise des clés. L'effet est immédiat, même sur une session ouverte.
- **Revue trimestrielle** : le gérant relit la liste des comptes actifs et leurs rôles ; la revue est datée et signée.
- **Comptes partagés interdits** : une personne, un compte. Sinon le journal d'audit ne sert à rien.

## Accès techniques

| Accès | Qui | Comment |
| --- | --- | --- |
| Compte propriétaire de la base | Prestataire technique désigné | Migrations uniquement, par l'intégration continue ou en présence du gérant |
| Serveurs et hébergeur | Prestataire technique, gérant | Deuxième facteur, clé SSH personnelle, liste revue chaque trimestre |
| Dépôt GitHub | Contributeurs nommés | Deuxième facteur obligatoire, pas d'envoi direct sur `main` ([paramètres GitHub](parametres-github.md)) |
| Hébergement du site vitrine | Gérant, prestataire | Deuxième facteur, déploiement depuis GitHub uniquement |
