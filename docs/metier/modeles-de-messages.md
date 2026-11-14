# Modèles de messages des relances

Sur WhatsApp, une entreprise ne peut écrire la première à un client qu'avec un **modèle validé par Meta**. Voici les six modèles à soumettre, mot pour mot : l'API les envoie sous ces noms, avec ces textes. Un test (`apps/api/tests/unitaires/relances-modeles.test.ts`) vérifie que ce document et le code restent identiques.

## Soumettre les modèles (tâche de l'agence)

Dans le **Gestionnaire WhatsApp** de Meta (business.facebook.com › WhatsApp › Modèles de messages), pour chaque modèle ci-dessous :

1. **Créer un modèle**, catégorie **Utilitaire** (message lié à un contrat ou une demande du client, pas de la publicité).
2. **Nom** : exactement celui indiqué (minuscules, `_`).
3. **Langue** : **Français** (code `fr`).
4. **Corps** : le texte indiqué, avec les variables `{{1}}`, `{{2}}`… telles quelles. Meta demande un exemple pour chaque variable : utiliser ceux du tableau.
5. **Pied de page** : `Répondez STOP pour ne plus recevoir ces messages.`
6. Pas d'en-tête, pas de bouton.

La validation prend de quelques minutes à 24 heures. Un modèle refusé ou modifié par Meta doit être corrigé **ici et dans le code** (`apps/api/src/modules/relances/modeles.ts`), dans une pull request, puis soumis à nouveau.

## Les modèles

### `dbs_echeance_contrat`

Envoyé à J-30, J-15, J-7 et le jour de l'échéance d'un contrat en vigueur pas encore renouvelé.

```text
Bonjour {{1}}, votre assurance {{2}} arrive à échéance le {{3}}. Pour la renouveler sans interruption de garantie, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Kouassi Aya |
| `{{2}}` | Branche, et n° de police s'il est connu | automobile (police 1234567) |
| `{{3}}` | Date d'échéance | 29/11/2026 |

### `dbs_contrat_expire`

Envoyé une fois, dans les 7 jours qui suivent l'échéance d'un contrat qui n'a pas été renouvelé.

```text
Bonjour {{1}}, votre assurance {{2}} a expiré le {{3}} : vous n'êtes plus couvert. Pour la renouveler, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Kouassi Aya |
| `{{2}}` | Branche, et n° de police s'il est connu | automobile (police 1234567) |
| `{{3}}` | Date d'échéance | 29/11/2026 |

### `dbs_devis_sans_reponse`

Envoyé une fois, 3 jours après qu'un devis est passé à « Envoyé au client » sans nouvelle depuis (jamais au-delà d'un mois).

```text
Bonjour {{1}}, avez-vous pu étudier notre devis d'assurance {{2}} ? Nous restons à votre disposition : répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Transports Yao |
| `{{2}}` | Branche | flotte |

### `dbs_sinistre_avancement`

Envoyé à la déclaration d'un sinistre, puis à chaque changement de statut (une fois par statut, dans la semaine).

```text
Bonjour {{1}}, votre sinistre du {{2}} (assurance {{3}}) : {{4}}. Pour toute question, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Kouassi Aya |
| `{{2}}` | Date du sinistre | 02/11/2026 |
| `{{3}}` | Branche, et n° de police s'il est connu | automobile (police 1234567) |
| `{{4}}` | Étape du dossier | l'expertise est en cours |

Étapes possibles : « votre déclaration est bien enregistrée », « votre dossier a été transmis à SanlamAllianz », « l'expertise est en cours », « la compagnie a fait une offre d'indemnisation, contactez-nous pour en parler », « votre dossier est réglé », « la compagnie a refusé la prise en charge, contactez-nous pour en connaître les raisons », « votre dossier est classé sans suite ».

### `dbs_documents_vehicules`

Rappel des documents des véhicules d'un client (visite technique, vignette, carte de transport) : à J-30, à J-7, puis une fois échus (dans les 15 jours). **Un seul message par client et par étape**, qui liste ses véhicules : un transporteur ne reçoit pas un message par camion. Chaque document n'est annoncé qu'une fois par étape.

```text
Bonjour {{1}}, {{2}} : {{3}}. Pour rouler en règle, pensez à les renouveler à temps. Pour toute question, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Transports Yao |
| `{{2}}` | Nombre de documents et échéance | 3 documents de vos véhicules arrivent à échéance, le premier le 24/11/2026 |
| `{{3}}` | Les documents (cinq au plus, puis « et N autres ») | visite technique 9011 AB 01 le 24/11, vignette 9011 AB 01 le 29/11 et 1 autre |

### `dbs_echeance_paiement`

Échéance d'une prime payée en plusieurs fois (contrats flotte, [ADR 0015](../architecture/adr/0015-paiement-fractionne.md)) : 7 jours avant la date, puis une fois si l'échéance n'est pas réglée (dans les 15 jours qui suivent). Chaque étape d'une échéance n'est envoyée qu'une fois.

```text
Bonjour {{1}}, l'échéance de {{2}} de votre assurance {{3}} {{4}}. Vous pouvez la régler à l'agence ou par Mobile Money. Pour toute question, répondez à ce message ou appelez DBS-ASSURANCES au 07 49 36 07 02.
```

| Variable | Contenu | Exemple pour Meta |
| --- | --- | --- |
| `{{1}}` | Nom du client | Transports Yao |
| `{{2}}` | Montant restant de l'échéance | 312 500 F CFA |
| `{{3}}` | Branche, et n° de police s'il est connu | flotte (police FLT-2026-01) |
| `{{4}}` | Étape | est à payer au plus tard le 01/02/2027 |

Étapes possibles : « est à payer au plus tard le … », « n'est pas encore réglée : elle était due le … ».

### `dbs_code_connexion`

Code de connexion au [portail des entreprises](../architecture/adr/0011-portail-des-entreprises.md). Ce modèle est d'une autre catégorie : **Authentification**, et non Utilitaire. Pour ces modèles, Meta impose son propre texte ; l'agence ne choisit que les réglages ci-dessous. Le message part dès la demande, à toute heure, sans accord préalable : c'est la personne elle-même qui le demande.

À la création du modèle dans le Gestionnaire WhatsApp :

| Réglage | Valeur |
| --- | --- |
| Catégorie | Authentification |
| Nom | `dbs_code_connexion` |
| Langue | Français |
| Envoi du code | Copier le code (bouton « Copier le code ») |
| Avertissement de sécurité | Oui (« ne communiquez ce code à personne ») |
| Délai d'expiration | 10 minutes |

L'API remplit le code (6 chiffres) dans le texte et dans le bouton. Le code n'est jamais enregistré : la base n'en garde qu'une empreinte.

## Par SMS

Le même texte, rempli, suivi de : `Ne plus recevoir ces SMS : 07 49 36 07 02.` Un SMS de relance fait environ 220 caractères, soit deux SMS facturés. Le canal SMS ne sera actif qu'une fois l'opérateur choisi ([ADR 0007](../architecture/adr/0007-relances-whatsapp-et-sms.md)).

## Règles qui s'appliquent à tous les messages

- **Jamais sans accord** : le client a accepté le canal, et l'agence a noté comment (fiche client, « Consentements »).
- **« STOP »** (ou « Arrêt », « Ne plus recevoir »…) en réponse sur WhatsApp retire l'accord aussitôt, sans intervention.
- **Jamais la nuit** : envoi entre 8 h et 20 h, heure d'Abidjan.
- **Une seule fois par étape** : aucun client ne reçoit deux fois la même relance.
- **Le minimum** : nom, branche, n° de police, dates. Jamais de montant, de pièce d'identité ni de détail médical.
