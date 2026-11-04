# Contrôle des accès

## Principes

1. **Moindre privilège** : chacun a exactement ce dont son travail a besoin.
2. **Refus par défaut** : ce qui n'est pas explicitement autorisé est interdit.
3. **Quatre yeux** sur l'argent : celui qui prépare un reversement ne le valide pas ; celui qui clôture sa caisse ne vise pas sa clôture ; seul le gérant annule un encaissement.
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
| Reversements | L C, validation, versement, annulation, export | — | L C (préparation), annulation des siens avant validation | — | — | L |
| Clôtures de caisse | L C, visa (des autres) | — | sa caisse : L C | — | — | L |
| Commissions (taux, relevés) | L C M | — | — | — | — | L |
| Sinistres | L C M | L C M | — | L | — | L |
| Devis | L C M | L C M | — | L C M | ses clients : L C | L |
| Échanges (ajout seul) | L C | L C | L C | L C | ses clients : L C | L |
| Consentements aux relances (ajout seul) | L C | L C | L | L C | ses clients : L | L |
| Relances | L, annulation avant l'envoi | L, annulation avant l'envoi | — | L | — | L |
| Demandes reçues par le site | L, traitement | L, traitement | — | L, traitement | — | L |
| Cartes grises jointes aux demandes | L (téléchargement consigné) | L (téléchargement consigné) | — | L (téléchargement consigné) | — | — |
| Journal d'audit | via le rôle `dbs_audit` | — | — | — | — | via le rôle `dbs_audit` |

Personne, pas même le gérant, ne modifie un encaissement, ne valide son propre bordereau, ne vise sa propre clôture de caisse ou ne supprime une ligne. Les exports de données (bordereaux) sont réservés au gérant et consignés au journal de sécurité.

Personne ne crée une relance à la main ni ne réécrit un consentement : les relances sont créées par le planificateur de l'API, qui travaille sans utilisateur connecté au moyen de cinq fonctions de la base limitées à cet usage ([ADR 0007](../architecture/adr/0007-relances-whatsapp-et-sms.md)). Un « STOP » reçu sur WhatsApp est enregistré par la base sans auteur, comme réponse du client.

Personne ne crée ni ne modifie une demande reçue par le site : elle entre par une seule fonction de la base, appelée par la route publique du formulaire, qui limite les envois par adresse et par jour ([ADR 0009](../architecture/adr/0009-demandes-de-devis-du-site.md)). Son traitement (conversion en client et devis, ou classement sans suite avec un motif) porte le nom de la personne qui l'a fait et ne revient pas en arrière. L'empreinte de l'adresse IP du visiteur ne sert qu'aux limites : l'application ne peut pas la lire.

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
