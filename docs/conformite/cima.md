# Code CIMA : ce que l'outil applique

Les articles du Code des assurances des États membres de la CIMA qui touchent le travail quotidien de l'agence, et la façon dont le système les prend en compte. Les textes font foi : [Code CIMA en ligne](https://cima-afrique.org/wp-content/code-cima/fr/Article542Delai.html).

| Règle | Source | Dans le système | Statut |
| --- | --- | --- | --- |
| La prise d'effet du contrat est subordonnée au paiement de la prime. | Art. 13 ([règlement](https://cima-afrique.org/wp-content/uploads/2019/07/Reglement-souscription-et-paiement-de-la-prime-art-13.pdf)) | Un contrat ne peut passer « en vigueur » que si le total encaissé couvre la prime. Appliqué par la base. | ✅ |
| Paiement en espèces limité à 1 000 000 F CFA par police. | Repris du site ; **texte exact à confirmer** avec SanlamAllianz | Plafond cumulé par police, contrôlé par la base, y compris en cas d'encaissements simultanés. | ✅ (à confirmer) |
| Les primes encaissées par l'intermédiaire sont reversées à l'assureur, avec un bordereau, dans les **30 jours**. À défaut, intérêts de retard au double du taux d'escompte. | Art. 542 ([texte](https://cima-afrique.org/wp-content/code-cima/fr/Article542Delai.html)) | Compte à rebours par encaissement (`app.v_encaissements_a_reverser`), bordereaux validés à deux. Alerte à J+25 prévue. | ✅ base · 🔜 tâche 5 |
| Compte courant mensuel entre l'intermédiaire et l'assureur. | Art. 559 | Bordereaux mensuels, rapprochement avec les relevés de commissions de la compagnie. | 🔜 tâche 5 |
| Prise en charge du sinistre par l'assureur lorsque l'intermédiaire n'a pas reversé la prime encaissée. | [Circulaire 0002/CIMA/CRCA/PDT/2015](https://cima-afrique.org/wp-content/code-cima/fr/Circulairen0002CIMACRCAPDT2015du.html) | Raison de plus pour reverser à temps : le retard expose l'agence vis-à-vis de la compagnie. | — |
| Le sinistre est déclaré dans le délai fixé par le contrat, qui ne peut être inférieur à 5 jours ouvrés (2 en cas de vol). | Art. 12 | Délai de déclaration calculé pour chaque sinistre (`app.v_sinistres_suivi`) ; rappel des délais au client lors de la déclaration en ligne. | ✅ base · 🔜 tâche 9 |
| Assurance de responsabilité civile obligatoire pour tout véhicule terrestre à moteur, remorques comprises. | Art. 200 | Branche « automobile » / « flotte » ; chaque véhicule rattaché à un contrat et à son attestation ASACI. | ✅ base |
| En cas de dommages corporels, l'assureur présente une offre d'indemnisation dans un délai maximal de 6 mois après l'accident (sous conditions). | Art. 231 | Date limite indicative calculée pour suivre la compagnie au nom du client. | ✅ base |

## Points à faire confirmer par SanlamAllianz

- Texte exact du plafond d'espèces et éventuelles exceptions.
- Paiement fractionné de la prime : est-il autorisé pour certains contrats ? Si oui, la règle « en vigueur après paiement complet » devra être adaptée par une nouvelle migration (échéancier).
- Format des bordereaux de reversement et des relevés de commissions.
- Procédure de la compagnie quand l'agence découvre une erreur sur un encaissement déjà reversé.
