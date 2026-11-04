# 0010 — Flottes : import contrôlé, avenants au prorata calculés par la base, rappels groupés par client

- Statut : Acceptée (frais d'avenant et format de cotation à confirmer avec SanlamAllianz)
- Date : 2026-11-04

## Contexte

Les transporteurs et les entreprises assurent 5 à 200 véhicules sur un même contrat. Aujourd'hui, l'agence reçoit leur liste dans un fichier Excel, la recopie à la main, calcule sur un coin de table la prime d'un camion ajouté en cours d'année, et ne voit pas venir les visites techniques, vignettes et cartes de transport de leurs véhicules.

Contraintes :

- Les fichiers arrivent tels que les clients les tiennent : Excel ou CSV, titres de colonnes variables, dates écrites de plusieurs façons, plaques avec ou sans tirets.
- Une erreur de saisie dans une liste de 80 véhicules ne doit ni bloquer sans explication, ni passer en silence.
- La prime d'un véhicule ajouté ou retiré en cours de contrat se calcule au prorata ; ce calcul touche à l'argent et doit être le même partout.
- Code CIMA, art. 13 : la garantie suit le paiement de la prime.
- Les relances de la tâche 6 envoient un message par objet : appliqué aux documents de 40 camions, ce serait 40 messages le même jour.

## Décision

1. **Import en deux temps, tout ou rien.** Le fichier (classeur `.xlsx` ou CSV, 2 Mo et 2 000 lignes au plus) est d'abord contrôlé : colonnes reconnues d'après leur titre (avec ou sans accents), chaque ligne vérifiée (plaque, dates, puissance, valeur), toutes les erreurs rendues ensemble avec leur ligne et leur colonne. L'enregistrement n'a lieu que sur confirmation et sans aucune erreur. Une plaque déjà connue du client est mise à jour (une cellule vide n'efface rien) ; celle d'un autre client est refusée. Les plaques se comparent sans espaces ni tirets.
2. **Lecteur de tableur maison, sans dépendance** (`apps/api/src/commun/tableur.ts`) : un `.xlsx` est une archive ZIP de XML ; on n'en lit que la première feuille et les valeurs (jamais de formule évaluée), avec des limites contre les bombes de décompression. Il est testé sur un vrai classeur produit par LibreOffice.
3. **Avenants calculés par la base**, dans le vocabulaire du métier :
   - un **avenant de mouvement** incorpore ou retire un ou plusieurs véhicules à une même date d'effet, sous un seul numéro (`app.avenants_flotte` et ses lignes `app.avenants_flotte_lignes`). L'application ne fournit que les véhicules, le mouvement, la date d'effet et la prime de chaque véhicule incorporé pour la période ; la base calcule les jours restants et les montants (prime × jours restants ÷ jours de la période, arrondi au franc), positifs à l'incorporation, en ristourne au retrait (prime reprise de l'entrée du véhicule) ;
   - la **réintégration** d'un véhicule sorti du même contrat est une incorporation : une nouvelle période s'ouvre, jamais avant la sortie précédente, et la prime précédente sert si aucune n'est donnée ;
   - un **avenant d'annulation**, avec son motif, défait exactement un avenant saisi par erreur (mêmes véhicules, même date, montant opposé) : les véhicules incorporés n'ont jamais été couverts, les véhicules retirés le restent. Il n'est possible que si rien ne s'est appuyé sur l'avenant : aucun avenant postérieur sur ses véhicules (on annule du plus récent au plus ancien), aucune attestation émise ni aucun sinistre déclaré sur un véhicule incorporé ; sinon, on fait un retrait ;
   - l'aperçu montré à l'écran et l'avenant enregistré sortent de la même fonction de la base (`app.avenant_flotte`, `app.annuler_avenant_flotte`), appelée sans puis avec enregistrement : l'aperçu n'écrit rien et ne consomme aucun numéro ;
   - un avenant ne se modifie ni ne se supprime. Avant le paiement de la prime de départ, on compose le contrat directement (et on détache un véhicule rattaché par erreur) ; une fois en vigueur, tout changement passe par un avenant (contrôle lié à l'identité réelle de l'auteur de l'écriture, que l'application ne peut pas usurper).
4. **Prime due = prime du contrat + avenants.** Le reste à payer, le contrôle des encaissements, la situation de paiement et les reçus en tiennent compte ; une ristourne sur une prime déjà payée apparaît comme un trop-perçu à rembourser. La mise en vigueur reste liée à la seule prime de départ ; les encaissements au-delà règlent les avenants dans l'ordre, ce qu'affiche `app.v_avenants_flotte`.
5. **Rappels des documents groupés par client** : à J-30, à J-7, puis une fois échus (dans les 15 jours), un seul message par client et par étape, qui cite cinq documents puis « et N autres ». Chaque document n'est annoncé qu'une fois par étape (`app.annonces_documents`). Mêmes règles que la tâche 6 : accord du client par canal, sinon le rappel est listé « à faire à la main ».
6. **Export pour la cotation en lot** en CSV lisible par Excel (formules neutralisées), réservé à qui gère les clients et consigné au journal de sécurité.

## Conséquences

- La liste d'un transporteur s'importe en une minute, avec une liste d'erreurs précise à lui renvoyer au besoin.
- Plus aucun calcul de prorata à la main ; le même montant apparaît sur l'écran, en caisse et sur le reçu.
- Un nouveau type de relance (`documents_vehicules`) et un cinquième modèle WhatsApp à faire valider par Meta ([modèles de messages](../../metier/modeles-de-messages.md)).
- **À confirmer avec SanlamAllianz (tâche 2)** : frais d'avenant éventuels, ristourne minimale ou retenue sur un retrait, et format attendu pour la cotation en lot (l'export s'y adaptera).
- Une erreur de saisie se corrige sans trou ni rature : l'avenant fautif et son annulation restent tous deux numérotés et consignés au journal.
- Un véhicule incorporé par avenant figure sur le contrat dès sa date d'effet ; l'écran indique si la prime de l'avenant est réglée. L'attestation (ASACI) ne doit être émise qu'une fois l'avenant réglé.

## Options écartées

- **Bibliothèque de lecture Excel** (SheetJS, ExcelJS) : une dépendance lourde et une surface d'attaque de plus pour lire une seule feuille de valeurs ; la version libre de SheetJS publiée sur npm n'est plus mise à jour.
- **Calcul du prorata dans l'API** : deux endroits où le calculer (l'aperçu et l'enregistrement) pourraient diverger, et la base ne pourrait pas garantir le montant enregistré.
- **Un avenant par véhicule** : 40 numéros pour les 40 camions d'une même livraison, et autant de pièces à transmettre à la compagnie.
- **Supprimer ou corriger un avenant erroné** : la numérotation aurait des trous et la caisse des montants qui changent après coup.
- **Modifier la prime du contrat à chaque avenant** : le contrat en vigueur deviendrait « non payé » et sortirait de vigueur, alors que les véhicules de départ restent couverts.
- **Un message par véhicule** : inacceptable pour un transporteur, et coûteux en messages WhatsApp.
