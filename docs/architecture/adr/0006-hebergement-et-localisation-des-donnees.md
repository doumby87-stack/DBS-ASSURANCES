# 0006 — Hébergement et localisation des données

- Statut : **En attente** de la réponse de l'ARTCI (tâche 2)
- Date : 2026-11-03

## Contexte

- La loi n° 2013-450 relative à la protection des données personnelles soumet les traitements à une formalité préalable auprès de l'ARTCI, et le **transfert de données vers un pays tiers à une autorisation préalable** ([données personnelles](../../conformite/donnees-personnelles.md)).
- Un hébergement hors de Côte d'Ivoire (Europe par exemple) offre plus de choix et de services managés, mais implique ce transfert.
- Un hébergement en Côte d'Ivoire évite le transfert, mais l'offre de services managés (base PostgreSQL gérée, sauvegardes hors site, pare-feu applicatif) est à vérifier.
- Certains services utilisés envoient de toute façon des données hors du pays (WhatsApp, prestataire de paiement) : ils figurent dans la déclaration.

## Options

| Option | Pour | Contre |
| --- | --- | --- |
| A. Centre de données en Côte d'Ivoire | Pas de transfert pour les données principales | Services managés et sauvegardes hors site à vérifier ; coût |
| B. Cloud en Europe (OVHcloud, Scaleway…) | Services managés, sauvegardes, pare-feu applicatif ; données soumises au RGPD européen | Autorisation de transfert de l'ARTCI nécessaire |
| C. Mixte : base en Côte d'Ivoire, sauvegardes chiffrées en Europe | Données vivantes sur place, copie hors site | Deux fournisseurs ; autorisation de transfert pour les sauvegardes |

## Exigences, quelle que soit l'option

Base non exposée à Internet, chiffrement au repos et en transit, sauvegardes chiffrées hors site et immuables, restauration testée chaque mois, contrat de sous-traitance précisant la localisation et la confidentialité ([infrastructure](../../../infra/README.md)).

## Décision

À prendre par le gérant après l'échange avec l'ARTCI. Option recommandée par défaut : **C**, si l'offre locale le permet ; sinon **B** avec autorisation de transfert.
