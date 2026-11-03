# Modèle de données

Schéma défini dans [`database/migrations`](../../database/migrations). Montants en francs CFA, entiers.

```mermaid
erDiagram
  UTILISATEURS ||--o{ CLIENTS : "apporte"
  CLIENTS ||--o{ VEHICULES : "possède"
  CLIENTS ||--o{ CONTRATS : "souscrit"
  CONTRATS ||--o{ CONTRATS_VEHICULES : "couvre"
  VEHICULES ||--o{ CONTRATS_VEHICULES : "est couvert par"
  CONTRATS ||--o{ ENCAISSEMENTS : "est payé par"
  ENCAISSEMENTS |o--o| ENCAISSEMENTS : "contre-passe"
  REVERSEMENTS ||--o{ ENCAISSEMENTS : "regroupe"
  CONTRATS ||--o{ SINISTRES : "donne lieu à"
  VEHICULES |o--o{ SINISTRES : "concerné par"

  UTILISATEURS {
    uuid id
    text email
    role_utilisateur role
    boolean actif
  }
  CLIENTS {
    uuid id
    type_client type
    text nom
    text telephone "E.164"
    bytea piece_identite_chiffree
    uuid apporteur_id
  }
  VEHICULES {
    uuid id
    text immatriculation "unique"
    date echeance_visite_technique
    date echeance_vignette
    date echeance_carte_transport
  }
  CONTRATS {
    uuid id
    text numero_police "SanlamAllianz"
    branche branche
    date date_effet
    date date_echeance
    bigint prime_ttc
    statut_contrat statut
  }
  CONTRATS_VEHICULES {
    uuid id
    text numero_attestation "ASACI"
    date ajoute_le
    date retire_le
  }
  ENCAISSEMENTS {
    uuid id
    bigint numero_recu "continu"
    bigint montant "négatif = contre-passation"
    mode_paiement mode
    text reference_externe
    timestamptz encaisse_le
  }
  REVERSEMENTS {
    uuid id
    text numero_bordereau
    uuid prepare_par
    uuid valide_par "différent de prepare_par"
    date verse_le
  }
  SINISTRES {
    uuid id
    date survenu_le
    date declare_le
    nature_sinistre nature
    statut_sinistre statut
  }
```

## Vues de pilotage

| Vue | Usage |
| --- | --- |
| `app.v_soldes_contrats` | Prime, total encaissé et reste à payer par contrat. |
| `app.v_encaissements_a_reverser` | Primes pas encore versées à la compagnie, date limite et jours restants (30 jours). |
| `app.v_echeances_contrats` | Contrats en vigueur qui arrivent à échéance dans les 60 jours. |
| `app.v_echeances_vehicules` | Visite technique, vignette, carte de transport à renouveler dans les 60 jours. |
| `app.v_sinistres_suivi` | Délai de déclaration et, pour un sinistre corporel, date limite indicative de l'offre. |

Toutes les vues appliquent les droits de la personne qui les consulte (`security_invoker`).

## À venir

Devis et demandes du site (tâche 7), documents (tâche 7), relances et consentements (tâche 6), commissions (tâche 5), identification des clients et réclamations (tâche 12), comptes des clients de l'espace en ligne (tâche 9).
