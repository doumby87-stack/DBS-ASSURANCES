# 0015 — Lecture automatique des documents : un modèle Claude par l'API d'Anthropic, toujours validée par une personne

- Statut : Acceptée (désactivée tant que l'ARTCI n'a pas autorisé le transfert et que le contrat avec Anthropic n'est pas signé)
- Date : 2026-11-06

## Contexte

Le personnel recopie à la main la carte grise d'un véhicule, la pièce d'identité d'un client (identification, [ADR 0013](0013-conformite-et-pilotage.md)) et le constat amiable d'un sinistre. C'est long, et une immatriculation ou un numéro de châssis mal recopié se retrouve sur l'attestation.

La tâche 14 prévoit de lire ces trois documents pour pré-remplir les fiches, **toujours validée par une personne**.

Contraintes :

- les documents sont des photos de qualité variable : cartes grises ivoiriennes, CNI, passeports, constats remplis à la main, parfois froissés ;
- ce sont des données personnelles ; le numéro de la pièce d'identité est chiffré en base ([classification](../../securite/classification-des-donnees.md)) ;
- un document reçu d'un client peut contenir du texte écrit pour tromper l'outil (« ignorez les consignes… ») ;
- l'agence est petite : pas de serveur de calcul, pas d'équipe pour entraîner un modèle.

## Décision

1. **Un lecteur interchangeable.** L'API définit un `LecteurDocuments` avec deux réalisations :
   - `anthropic` : un modèle Claude, par l'API d'Anthropic et son kit officiel (`@anthropic-ai/sdk`) ;
   - `simulation` : des valeurs d'exemple fixes, pour les tests et la démonstration. Elle est refusée en production.

   Sans `LECTURE_PRESTATAIRE`, la lecture n'existe pas : le back-office cache le panneau et tout se saisit à la main, comme avant.
2. **Une réponse structurée, puis nettoyée.** Chaque document a un schéma JSON strict (tous les champs, `null` si illisible, aucun champ en plus), imposé au modèle par une sortie structurée. Les consignes demandent de recopier exactement, de ne rien deviner et de traiter le contenu du document comme une donnée, jamais comme une instruction. L'API vérifie encore chaque valeur (type, longueur, date réelle, cases du constat de 1 à 30) et jette ce qui ne va pas.
3. **Des contrôles indépendants du modèle**, calculés par l'API et montrés à la personne :
   - **zone lisible par machine** (MRZ) des passeports et des cartes d'identité : les chiffres de contrôle de la norme OACI 9303 sont recalculés ; elle confirme ou contredit le numéro, la date de naissance et la date d'expiration lus ;
   - pièce expirée, numéro de châssis (17 caractères, sans I, O ni Q), forme de l'immatriculation, dates dans le futur ;
   - constat : un seul véhicule lu, blessés déclarés (à traiter comme un sinistre corporel).
4. **Rien n'est enregistré par la lecture.** Le back-office pré-remplit le formulaire ; les champs remplis sont surlignés jusqu'à ce que la personne les vérifie avec le document et enregistre elle-même. Pour un constat, un résumé s'ajoute à la note interne du sinistre, enregistrée seulement par « Enregistrer le suivi ». Les valeurs lues ne sont gardées ni par l'API ni dans ses journaux.
5. **Antivirus d'abord.** Une photo envoyée pour la lecture est analysée par ClamAV avant de partir. Une pièce déjà enregistrée (justificatif, photo d'un sinistre, carte grise d'une demande du site) n'est lue que si son analyse l'a déclarée saine ; elle est déchiffrée et son empreinte vérifiée.
6. **Droits.** La carte grise : gérant, chargé de clientèle et commercial. La pièce d'identité et le constat : gérant et chargé de clientèle. Ce sont les rôles qui saisissent ces fiches ([contrôle des accès](../../securite/controle-des-acces.md)).
7. **Traçabilité et coût.** Chaque lecture est consignée au journal de sécurité (`lecture_automatique`) : qui, quand, quel document de quel client, jamais les valeurs. **30 lectures par heure et par personne au plus**, compté sur ce journal, pour borner le coût et une éventuelle extraction en masse.
8. **Appel au modèle.**
   - Le modèle est un réglage obligatoire (`LECTURE_MODELE`), choisi par l'exploitant et noté au registre des traitements.
   - Si le modèle refuse une demande pour raison de sécurité, l'API d'Anthropic la relance d'elle-même sur un modèle de repli (`fallbacks: "default"`, en bêta). Un refus final devient « document non lu ».
   - Deux nouvelles tentatives en cas d'erreur passagère, deux minutes au plus.
   - Une clé refusée se signale comme une erreur de configuration, une panne comme une indisponibilité : la personne saisit à la main.

## Conséquences

- La saisie d'une carte grise ou d'une pièce d'identité se fait en quelques secondes, et la MRZ attrape une partie des erreurs de lecture.
- **Les images partent hors de Côte d'Ivoire**, chez Anthropic. Avant l'activation :
  - autorisation de transfert de l'ARTCI ;
  - contrat de sous-traitance avec Anthropic (conditions commerciales et avenant de protection des données) ;
  - mise à jour du registre des traitements et de l'information des clients ([données personnelles](../../conformite/donnees-personnelles.md)).
- Chaque lecture a un coût, facturé par Anthropic au volume. La limite par heure et le journal permettent de le suivre.
- Le personnel doit garder le réflexe de vérifier : l'outil le rappelle à chaque lecture, et les champs pré-remplis restent surlignés. À inclure dans la formation (tâche 11).
- Une dépendance de production de plus pour l'API (`@anthropic-ai/sdk`), qui en apporte sept petites (dont `@opentelemetry/api`, `json-schema-to-ts`, `standardwebhooks`), toutes verrouillées dans `package-lock.json` et suivies par Dependabot et `npm audit`.

## Options écartées

- **Reconnaissance de caractères installée chez l'agence** (Tesseract ou équivalent) : rien ne sortirait du pays, mais la qualité sur des photos de cartes grises et de constats manuscrits est très inférieure, il faudrait écrire un analyseur par modèle de document, et un serveur de calcul.
- **Enregistrement automatique des valeurs lues** : une erreur de lecture finirait sur une attestation ou dans une fiche d'identification. La tâche exige une validation humaine.
- **Lecture dès la réception** (toutes les cartes grises des demandes du site, toutes les pièces d'un sinistre) : plus de transferts et de coûts pour des documents que personne n'a demandé à lire. La lecture se fait à la demande, document par document.
- **Appel HTTP écrit à la main** plutôt que le kit officiel : à refaire à chaque évolution de l'API, sans les tentatives ni les erreurs typées.
