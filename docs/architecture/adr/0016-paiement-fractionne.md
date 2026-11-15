# 0015 — Paiement de la prime d'une flotte en plusieurs fois

- Statut : Acceptée (conditions à confirmer avec SanlamAllianz)
- Date : 2026-11-14

## Contexte

Certaines entreprises paient la prime de leur flotte en plusieurs fois : par trimestre, par semestre, parfois par mois. Jusqu'ici, l'outil ne le permettait pas :

- **Mise en vigueur** : la base n'acceptait un contrat « en vigueur » qu'une fois la prime entièrement payée.
- **Reste à payer** : le portail des entreprises proposait de payer toute la prime d'un coup.
- **Suivi** : rien ne signalait une échéance non payée.

Contraintes :

- **Code CIMA, art. 13** : la prise d'effet du contrat est subordonnée au paiement de la prime. Les conditions exactes d'un paiement fractionné (contrats concernés, frais de fractionnement, durée des attestations) sont fixées par la compagnie : elles restent à confirmer avec SanlamAllianz.
- **Avenants de flotte** ([ADR 0010](0010-flottes.md)) : une incorporation en cours de contrat crée une prime due aussitôt.
- **Échéance impayée** : en assurance, elle ne suspend pas la garantie d'elle-même ; la suspension suit une mise en demeure. L'outil ne doit pas la décider seul.

## Décision

1. **Un échéancier par contrat flotte**, dans la base (`app.echeances_paiement`) :
   - de 2 à 12 échéances datées ;
   - le total est exactement la prime TTC du contrat, qui comprend d'éventuels frais de fractionnement de la compagnie ;
   - la première échéance tombe au plus tard à la date d'effet, la dernière avant la fin du contrat ;
   - réservé à la branche « flotte » : l'étendre à d'autres branches se fera par une nouvelle migration, après accord de la compagnie.
2. **Défini d'un seul bloc** par `app.definir_echeancier`, qui contrôle tout :
   - **qui** : le chargé de clientèle ou le gérant ; une fois un paiement reçu, seul le gérant renégocie l'échéancier, et peut changer la prime en même temps ;
   - **retour au paiement en une fois** : possible tant que rien n'est encaissé ;
   - **prime** : elle ne se modifie plus seule, sans son échéancier.
3. **Mise en vigueur à la première échéance payée** (art. 13), et retour « en attente de paiement » si ce paiement est contre-passé (chèque impayé). Sans échéancier, rien ne change : toute la prime.
4. **Paiements imputés à la dette la plus ancienne d'abord** (`app.v_dettes_fractionnees`) :
   - **ordre** : les échéances à leur date, les avenants à leur date d'effet ; à date égale, l'échéance d'abord ;
   - **avoirs** : les ristournes et annulations d'avenant s'ajoutent aux paiements reçus ;
   - **effet** : un avenant ajouté après coup ne reprend pas un paiement déjà imputé à une échéance passée ;
   - **vue des avenants** (`app.v_avenants_flotte`) : elle suit la même règle sur ces contrats.
5. **Une échéance non payée à temps est signalée, pas sanctionnée** :
   - **États** : payée, à payer bientôt (15 jours), à venir, en retard.
   - **Back-office** : le tableau de bord liste les échéances en retard ou proches.
   - **Relance du client** : par WhatsApp ou SMS s'il l'a accepté (modèle `dbs_echeance_paiement`), 7 jours avant l'échéance, puis une fois en cas de retard.
   - **Statut** : il ne change pas tout seul ; la suspension, après mise en demeure, reste une décision de l'agence.
6. **Partout le même montant proposé** : ce qui est dû maintenant (échéances passées non payées, avenants en vigueur), sinon la prochaine échéance. Ce montant est proposé à la caisse comme au paiement en ligne du portail ; le client peut payer plus.

## Conséquences

- **Ce que l'agence voit** : ce que chaque entreprise doit vraiment, à quelle date, et qui est en retard.
- **Ce que voit l'entreprise** : son échéancier sur le portail, et l'échéance due qu'elle paie en Mobile Money.
- **Paiement en ligne** : il reste plafonné (`PAIEMENT_MONTANT_MAX`, 2 000 000 F CFA par défaut). Une échéance plus élevée se paie en plusieurs paiements en ligne, ou à l'agence.
- **Lutte contre le blanchiment** : l'alerte « fractionnement » ([ADR 0013](0013-conformite-et-pilotage.md)) vise 3 paiements en espèces ou plus sur un contrat en 30 jours. Des échéances mensuelles réglées en espèces restent en dessous ; des paiements plus rapprochés la déclenchent, ce qui est voulu.
- **Attestations** : la période couverte par les attestations ASACI d'un contrat payé en plusieurs fois (une par échéance ou pour la durée du contrat) dépend de la compagnie. L'outil ne la fixe pas.

## Options écartées

- **Suspension automatique dès le premier jour de retard** : contraire à la procédure de mise en demeure, et dangereux pour un transporteur dont les camions circulent.
- **Avenants payés avant les échéances, quelle que soit leur date** : un avenant ajouté après coup reprenait le paiement d'une échéance passée, qui apparaissait « en retard » alors qu'elle était réglée.
- **Échéancier pour toutes les branches** : il permettrait d'entamer la garantie d'une petite police automobile sans en payer la prime. On s'en tient à ce que l'agence pratique : les flottes.
