# Processus de l'agence

Les parcours que l'outil doit servir, tels qu'ils sont prévus. Chaque étape indique ce que le système vérifie.

## Du devis à l'attestation

```mermaid
flowchart TD
  A["Demande de devis<br/>site, WhatsApp, téléphone, agence"] --> B["Fiche client<br/>doublon vérifié par le téléphone"]
  B --> C["Cotation SanlamAllianz"]
  C --> D["Devis envoyé<br/>relance automatique si pas de réponse"]
  D -->|accepté| E["Contrat créé<br/>statut : en attente de paiement"]
  D -->|refusé| X["Motif de perte noté"]
  E --> F["Encaissement<br/>reçu numéroté · plafond espèces · référence obligatoire hors espèces"]
  F --> G{"Prime entièrement payée ?"}
  G -->|non| F
  G -->|oui| H["Contrat en vigueur<br/>(Code CIMA, art. 13)"]
  H --> I["Attestation ASACI émise<br/>numéro rattaché au véhicule"]
```

## De l'encaissement au reversement

```mermaid
flowchart TD
  A["Encaissements du mois"] --> B["Bordereau préparé<br/>par la caisse"]
  B --> C["Encaissements rattachés"]
  C --> D["Validation par le gérant<br/>jamais par la personne qui a préparé"]
  D --> E["Versement à SanlamAllianz<br/>référence du virement obligatoire"]
  E --> F["Bordereau figé"]
  A -.->|"compte à rebours<br/>30 jours (art. 542)"| G["Alerte à J+25"]
```

## Renouvellement

```mermaid
flowchart LR
  A["J-30"] --> B["J-15"] --> C["J-7"] --> D["Jour de l'échéance"] --> E["J+1 : « vous n'êtes plus couvert »"]
```

À chaque étape : message WhatsApp (ou SMS), et tâche pour le chargé de clientèle si le client ne répond pas. Pour les flottes, les échéances de visite technique, vignette et carte de transport suivent le même rythme.

## Sinistre

```mermaid
flowchart TD
  A["Déclaration<br/>agence, WhatsApp ou espace client"] --> B["Délai de déclaration vérifié<br/>(art. 12)"]
  B --> C["Pièces à fournir selon la nature<br/>constat, photos, carte grise, plainte en cas de vol"]
  C --> D["Transmis à la compagnie"]
  D --> E["Expertise"]
  E --> F["Offre<br/>corporel : suivi du délai de 6 mois (art. 231)"]
  F --> G["Règlement"]
  G --> H["Clôture et avis du client"]
```

Le client est informé à chaque changement de statut.
