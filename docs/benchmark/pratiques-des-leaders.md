# Comment font les plus grands, et ce que nous en reprenons

Étude réalisée en novembre 2026 sur les assureurs, courtiers et éditeurs de logiciels qui font référence, en Côte d'Ivoire et ailleurs. Pour chaque pratique : ce qu'ils font, ce que nous adoptons, et où c'est mis en place.

## 1. Le parcours client entièrement en ligne

**Ce qu'ils font.** Depuis février 2025, le courtier numérique Baloon vend l'assurance auto dans l'application Max It d'Orange : devis immédiat, choix de la formule, paiement Orange Money et attestation reçue sur le téléphone, sans passer en agence. NSIA Côte d'Ivoire a lancé la déclaration de sinistre automobile en ligne en 2025. En Europe, Allianz et Generali proposent depuis longtemps la déclaration et le suivi des sinistres dans l'espace client.

**Ce que nous reprenons.** Un espace client où l'on paie, renouvelle, télécharge ses attestations et déclare un sinistre depuis son téléphone (tâche 9), **avec en plus** ce que les plateformes n'ont pas : un conseiller qui connaît le dossier, et un portail dédié aux flottes (tâche 10).

## 2. Un logiciel de gestion d'agence au centre

**Ce qu'ils font.** Les agences et courtiers les mieux organisés travaillent dans un seul système : Applied Epic aux États-Unis, CourtiGo, Custy ou Assurevo en France. On y retrouve partout la fiche client unique, le portefeuille de contrats, la relance des échéances, le rapprochement des commissions avec les relevés des compagnies, la gestion électronique des documents et la connexion aux extranets des assureurs. Applied lit désormais automatiquement les relevés des compagnies, qu'ils arrivent en PDF, en tableur ou en CSV.

**Ce que nous reprenons.** Le back-office (tâches 4, 5, 8) avec la même colonne vertébrale : fiche client unique, échéancier, rapprochement des commissions, import des états de SanlamAllianz. Les logiciels français ne connaissent ni le Code CIMA, ni le Mobile Money, ni l'attestation ASACI : nous construisons sur mesure.

## 3. L'argent des assurés tenu à part

**Ce qu'ils font.** Les agences américaines gèrent les primes encaissées dans une comptabilité fiduciaire distincte (*trust accounting*), séparée de l'argent de l'agence. Dans la zone CIMA, le Code impose de reverser les primes à l'assureur, avec un bordereau, **dans les 30 jours** (art. 542), sous peine d'intérêts de retard, et prévoit un compte courant mensuel entre l'intermédiaire et l'assureur (art. 559).

**Ce que nous reprenons.** Caisse inaltérable (un reçu par paiement, jamais modifié), compte à rebours des 30 jours pour chaque prime encaissée, bordereaux générés par le système (tâche 5). Recommandation à l'agence : un compte bancaire et un compte Mobile Money dédiés aux primes.

## 4. Le principe des quatre yeux

**Ce qu'ils font.** Dans les banques et les compagnies d'assurance, aucune opération financière sensible n'est faite par une seule personne : l'un prépare, un autre valide (*maker-checker*).

**Ce que nous reprenons.** Déjà en place dans la base de données : un bordereau de reversement préparé par une personne doit être validé par une autre, et seul le gérant peut annuler un encaissement. Testé.

## 5. La sécurité en profondeur

**Ce qu'ils font.** Les acteurs sérieux ne comptent jamais sur une seule barrière :

- un standard de vérification reconnu, l'OWASP ASVS, dont le niveau 2 vise la plupart des applications qui traitent des données personnelles ;
- un deuxième facteur obligatoire pour le personnel ;
- un contrôle d'accès répété au niveau de la base de données, ligne par ligne. Les recommandations de Supabase vont dans ce sens : chaque table protégée, fonctions privilégiées isolées, deuxième facteur vérifié jusque dans la base ;
- un journal d'audit que personne, pas même un administrateur, ne peut modifier en silence ;
- un contact public pour signaler les failles (`security.txt`) et une recherche automatique de secrets dans le code.

**Ce que nous reprenons.** Tout cela, dès le socle : contrôle d'accès dans la base, journal chaîné par empreintes, recherche de secrets en intégration continue, `security.txt`, exigences inspirées de l'ASVS niveau 2 ([exigences de sécurité](../securite/exigences-securite.md)).

## 6. La lutte contre la fraude

**Ce qu'ils font.** Les assureurs ivoiriens, réunis dans l'ASACI, ont rendu l'attestation automobile numérique en janvier 2023 : chaque attestation porte un QR code vérifiable, ce qui réduit les fausses attestations et repère les véhicules non assurés.

**Ce que nous reprenons.** Le site apprend désormais au client à vérifier son attestation et à ne payer que par les canaux officiels (FAQ). Le back-office conservera le numéro d'attestation de chaque véhicule, rattaché à son contrat.

## 7. Le paiement mobile, sans risque

**Ce qu'ils font.** Les sites marchands ivoiriens passent par un agrégateur, comme CinetPay, qui couvre Wave, Orange Money, MTN MoMo et Moov Money en une seule intégration. Les plateformes de paiement sérieuses confirment chaque paiement par une notification signée, et refusent d'enregistrer deux fois la même transaction.

**Ce que nous reprenons.** Paiement sur la page du prestataire, confirmation par notification signée et vérifiée (tâche 9). Le refus du double enregistrement est déjà garanti par la base : une même référence de transaction ne peut être enregistrée qu'une fois.

## 8. Des relances qui ne coûtent presque rien

**Ce qu'ils font.** Les entreprises envoient leurs rappels par l'API officielle de WhatsApp, avec des modèles validés par Meta. En Côte d'Ivoire, un message utilitaire (rappel d'échéance, confirmation) coûte environ 0,004 dollar.

**Ce que nous reprenons.** Relances automatiques à J-30, J-15, J-7 et le jour de l'échéance, avec repli par SMS (tâche 6).

## 9. La conformité intégrée à l'outil

**Ce qu'ils font.** Les compagnies intègrent les obligations dans leurs outils au lieu de les gérer à part : identification des clients (lutte contre le blanchiment, règlement CIMA du 10 juillet 2025), déclaration des traitements de données personnelles, factures électroniques normalisées (FNE, obligatoires depuis 2025).

**Ce que nous reprenons.** Fiche d'identification client, registre des réclamations et factures FNE (tâche 12). Voir le dossier [conformité](../conformite/).

## Sources

- Baloon et Orange Max It : [Capmad](https://www.capmad.com/article/orange-integre-lassurance-automobile-baloon-dans-sa-super-app-max-it-en-cote-divoire), [Osiris](https://osiris.sn/orange-money-cote-d-ivoire-et-baloon-simplifient-l-acces-a-l-assurance.html)
- NSIA, sinistres auto en ligne : [Atlas Magazine](https://atlas-mag.net/fr/articles/nsia-assurances-cote-divoire-declaration-en-ligne-des-sinistres-automobile), [AIP](https://www.aip.ci/246066/cote-divoire-aip-une-compagnie-dassurance-lance-un-service-digitalise-pour-faciliter-la-declaration-de-sinistres-automobiles/)
- Allianz, sinistres : [allianz.fr](https://www.allianz.fr/sinistres/)
- Logiciels de gestion de cabinet : [Legalnest](https://www.legalnest.fr/courtier-assurance/logiciels), [La Fabrique du Net](https://www.lafabriquedunet.fr/logiciels/productivite/crm/crm-assurance)
- Applied Epic et Applied Recon : [brochure Applied Recon](https://www1.appliedsystems.com/siteassets/all-documents/resources/brochures-data-sheets/applied-recon-product-brochure_en-us.pdf), [Capterra](https://capterra.com/p/70671/Applied-Epic/)
- Code CIMA, reversement des primes : [art. 542](https://cima-afrique.org/wp-content/code-cima/fr/Article542Delai.html), [circulaire 0002/2015](https://cima-afrique.org/wp-content/code-cima/fr/Circulairen0002CIMACRCAPDT2015du.html)
- OWASP ASVS : [présentation](https://quality.arc42.org/standards/owasp-asvs)
- Supabase, sécurité ligne par ligne et deuxième facteur : [blog Supabase](https://supabase.com/blog/mfa-auth-via-rls.md), [MakerKit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- ASACI, attestation digitale : [Atlas Magazine](https://atlas-mag.net/fr/articles/digitalisation-de-lattestation-dassurance-automobile-en-cote-divoire), [FANAF](https://fanaf.org/wp-content/uploads/2024/11/ASACI_COMMUNICATION-SUR-LA-DIGITALISATION.pdf)
- CinetPay : [Kolonell](https://kolonell.com/fr/blog/cinetpay-agregateur-cote-ivoire-integration-2026)
- Tarifs WhatsApp : [Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- Lutte contre le blanchiment, CIMA 2025 : [Droit Médias Finance](https://droitmediasfinance.com/index.php/actualites/droit-des-assurances/1054-cima-les-procedures-relatives-a-la-lutte-contre-le-blanchiment-des-capitaux-precisees-par-un-reglement-du-10-juillet-2025)
- FNE : [Sage](https://www.sage.com/fr-ma/blog/la-fne-en-cote-divoire-guide-complet-sage-cote-divoire/)
