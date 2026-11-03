# Réponse aux incidents

Que faire quand quelque chose de grave arrive. À imprimer et à garder à l'agence.

## Contacts

| Rôle | Nom | Téléphone |
| --- | --- | --- |
| Responsable de l'incident | Gérant de DBS-ASSURANCES | à compléter |
| Prestataire technique | à désigner | à compléter |
| SanlamAllianz Côte d'Ivoire (mandant) | à compléter | à compléter |
| Hébergeur (support) | à compléter | à compléter |

## Les six étapes

1. **Détecter et noter** : qui a vu quoi, quand. Ne rien effacer.
2. **Contenir** : couper l'accès en cause (désactiver le compte, révoquer la clé, mettre le service hors ligne si nécessaire).
3. **Évaluer** : quelles données, quels clients, quel argent sont touchés ? Le journal d'audit et `audit.verifier_chaine()` aident à le savoir.
4. **Prévenir** : SanlamAllianz si des contrats ou des primes sont touchés ; les clients concernés si leurs données ou leur argent sont en jeu ; vérifier les obligations de notification auprès de l'ARTCI (loi n° 2013-450) ; la police en cas d'escroquerie.
5. **Corriger et restaurer** : corriger la cause, restaurer depuis une sauvegarde vérifiée si besoin, renouveler tous les secrets exposés.
6. **Tirer les leçons** : sous 15 jours, une page écrite : ce qui s'est passé, pourquoi, ce qui change. Mettre à jour le [modèle de menaces](modele-de-menaces.md).

## Situations types

### Un compte du personnel est peut-être compromis

Désactiver le compte (effet immédiat) → vérifier dans le journal d'audit ce qu'il a fait depuis la dernière connexion légitime → réinitialiser mot de passe et deuxième facteur en présence de la personne → réactiver.

### Un client signale un faux numéro de paiement « de DBS »

Noter le numéro et les messages reçus → prévenir les clients par les canaux officiels (statut WhatsApp, site, message) → signaler le numéro à l'opérateur Mobile Money et à la plateforme de lutte contre la cybercriminalité → plainte si des clients ont payé.

### Un secret a fuité (clé, mot de passe)

Voir [gestion des secrets](gestion-des-secrets.md#si-un-secret-a-fuité) : révoquer d'abord, chercher ensuite.

### `audit.verifier_chaine()` signale une anomalie

Ne rien corriger en base. Faire une copie de la base en l'état → comparer avec la dernière sauvegarde et la dernière empreinte copiée hors site → identifier les lignes touchées et le compte qui avait les droits → traiter comme une fraude possible.

### Le site vitrine est défiguré

Republier la dernière version depuis GitHub → changer les accès de l'hébergeur → vérifier qu'aucun formulaire n'a été modifié pour détourner des données.

### Rançongiciel, panne ou perte de la base

Isoler les machines touchées → ne pas payer → restaurer depuis la sauvegarde hors site ([sauvegardes et reprise](sauvegardes-et-reprise.md)) → vérifier la chaîne d'audit après restauration.
