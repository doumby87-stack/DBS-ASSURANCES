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
  CONTRATS |o--o| CONTRATS : "renouvelle"
  CLIENTS ||--o{ DEVIS : "demande"
  DEVIS |o--o| CONTRATS : "aboutit à"
  CLIENTS ||--o{ ECHANGES : "historique"
  UTILISATEURS ||--o{ CLOTURES_CAISSE : "clôture sa caisse"
  TAUX_COMMISSION }o--|| CONTRATS : "par branche"
  VEHICULES |o--o{ SINISTRES : "concerné par"
  CLIENTS ||--o{ CONSENTEMENTS : "accepte ou refuse"
  CLIENTS ||--o{ RELANCES : "reçoit"
  CONTRATS |o--o{ RELANCES : "échéance"
  DEVIS |o--o{ RELANCES : "sans réponse"
  SINISTRES |o--o{ RELANCES : "avancement"

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
    bigint prime_nette "base des commissions"
    statut_contrat statut "en vigueur dès la prime payée"
  }
  CONTRATS_VEHICULES {
    uuid id
    text numero_attestation "ASACI"
    date ajoute_le
    date retire_le
  }
  ENCAISSEMENTS {
    uuid id
    bigint numero_recu "sans trou, attribué par la base"
    bigint montant "négatif = contre-passation"
    mode_paiement mode
    text reference_externe
    timestamptz encaisse_le
  }
  REVERSEMENTS {
    uuid id
    text numero_bordereau "BR-année-numéro, par la base"
    uuid prepare_par
    uuid valide_par "différent de prepare_par"
    date verse_le
    timestamptz annule_le "avant validation seulement"
  }
  CLOTURES_CAISSE {
    uuid id
    bigint numero "sans trou"
    uuid caissier_id
    bigint especes_attendues "calculées par la base"
    bigint especes_comptees
    jsonb billetage
    bigint ecart "justifié s'il n'est pas nul"
    uuid visee_par "différent de caissier_id"
  }
  TAUX_COMMISSION {
    branche branche
    numeric taux "en %"
    date applicable_du
  }
  RELEVES_COMMISSIONS {
    date mois "un par mois"
    bigint montant_declare
    text reference
  }
  SINISTRES {
    uuid id
    date survenu_le
    date declare_le
    nature_sinistre nature
    statut_sinistre statut
  }
  DEVIS {
    uuid id
    branche branche
    origine_devis origine
    bigint prime_proposee
    statut_devis statut
    text motif_refus "obligatoire si refusé"
  }
  ECHANGES {
    uuid id
    canal_echange canal
    text resume
    timestamptz survenu_le
  }
  CONSENTEMENTS {
    uuid id
    canal_relance canal "whatsapp, sms"
    boolean accorde
    source_consentement source "agence ou réponse STOP"
    text preuve "comment le client l'a exprimé"
    timestamptz enregistre_le
  }
  RELANCES {
    uuid id
    text cle "unique : une relance par étape et par objet"
    type_relance type
    canal_relance canal
    text destinataire "E.164"
    statut_relance statut "à envoyer, envoyée, remise, lue, échec, annulée"
    text identifiant_fournisseur "WhatsApp ou opérateur SMS"
    smallint tentatives
  }
```

## Vues de pilotage

| Vue | Usage |
| --- | --- |
| `app.v_soldes_contrats` | Prime, total encaissé et reste à payer par contrat. |
| `app.v_encaissements_a_reverser` | Primes pas encore versées à la compagnie, date limite et jours restants (30 jours). |
| `app.v_mouvements_caisse` | Encaissements rattachés à la caisse concernée (une contre-passation compte dans la caisse de la personne qui avait encaissé). |
| `app.v_commissions_mensuelles` | Par mois : primes encaissées, commission attendue, relevé de la compagnie, écart. |
| `app.v_echeances_contrats` | Contrats en vigueur, pas encore renouvelés, qui arrivent à échéance dans les 60 jours (ou déjà échus). |
| `app.v_echeances_vehicules` | Visite technique, vignette, carte de transport à renouveler dans les 60 jours. |
| `app.v_sinistres_suivi` | Délai de déclaration et, pour un sinistre corporel, date limite indicative de l'offre. |
| `app.v_consentements` | Dernier choix de chaque client pour chaque canal de relance. |
| `app.v_relances_dues` | Relances dues aujourd'hui (échéance à J-30, J-15, J-7 et le jour même, contrat expiré depuis moins de 7 jours, devis sans réponse depuis 3 jours, avancement d'un sinistre) qui ne sont pas encore planifiées. |

Toutes les vues appliquent les droits de la personne qui les consulte (`security_invoker`).

## À venir

Demandes venues du site (tâche 7), documents (tâche 7), identification des clients et réclamations (tâche 12), comptes des clients de l'espace en ligne (tâche 9).

Les relances ne sont créées que par le planificateur de l'API, au moyen des fonctions `app.planifier_relances`, `app.prendre_relances_a_envoyer`, `app.enregistrer_envoi`, `app.enregistrer_statut_fournisseur` et `app.enregistrer_desinscription` ([ADR 0007](adr/0007-relances-whatsapp-et-sms.md)).

Les numéros de reçus, de bordereaux et de clôtures viennent de `app.compteurs`, table inaccessible à l'application : seul un déclencheur de la base attribue un numéro, dans la transaction de l'opération. Un paiement refusé ou annulé ne laisse donc aucun trou.
