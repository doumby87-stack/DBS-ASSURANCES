-- =====================================================================
-- 0018 · Paiement de la prime en plusieurs fois (contrats flotte)
--
-- Certaines entreprises paient la prime de leur flotte en plusieurs fois. Ce qui change :
--   · app.echeances_paiement : l'échéancier d'un contrat flotte, de 2 à 12 échéances datées, dont le total
--     est exactement la prime TTC du contrat ; défini (ou redéfini) d'un seul bloc par app.definir_echeancier ;
--   · mise en vigueur (Code CIMA, art. 13) : avec un échéancier, le contrat entre en vigueur une fois la
--     première échéance payée ; sans échéancier, rien ne change (prime entière) ;
--   · suivi : chaque échéance est payée, à payer bientôt, à venir ou en retard (app.v_echeances_paiement) ;
--     les paiements reçus soldent d'abord les avenants (dus aussitôt), puis les échéances dans l'ordre ;
--   · une échéance en retard ne suspend pas le contrat d'elle-même : la suspension suit une mise en demeure,
--     décidée par l'agence. La base signale le retard, le client est relancé (J-7, puis une fois en retard).
-- Conception : docs/architecture/adr/0015-paiement-fractionne.md
-- =====================================================================

CREATE TABLE app.echeances_paiement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrat_id   uuid NOT NULL REFERENCES app.contrats (id),
  rang         smallint NOT NULL,
  exigible_le  date NOT NULL,
  montant      bigint NOT NULL,
  cree_le      timestamptz NOT NULL,
  cree_par     uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT echeances_paiement_rang CHECK (rang BETWEEN 1 AND 12),
  CONSTRAINT echeances_paiement_montant CHECK (montant > 0),
  CONSTRAINT echeances_paiement_rang_unique UNIQUE (contrat_id, rang),
  CONSTRAINT echeances_paiement_date_unique UNIQUE (contrat_id, exigible_le)
);

CREATE TRIGGER a_auteur BEFORE INSERT ON app.echeances_paiement
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.echeances_paiement
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Ce qui doit être payé avant la prise d'effet : la première échéance, ou toute la prime sans échéancier
CREATE FUNCTION app.montant_requis_vigueur(p_contrat uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce((SELECT e.montant FROM app.echeances_paiement e WHERE e.contrat_id = k.id AND e.rang = 1), k.prime_ttc)
  FROM app.contrats k WHERE k.id = p_contrat
$$;
GRANT EXECUTE ON FUNCTION app.montant_requis_vigueur(uuid) TO dbs_api;

-- Remplace la version de 0002 : « en vigueur » exige la première échéance (ou la prime entière) ;
-- la prime d'un contrat payé en plusieurs fois ne change qu'avec son échéancier (app.definir_echeancier)
CREATE OR REPLACE FUNCTION app.controler_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_encaisse bigint;
  v_requis bigint;
  v_echeancier bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.prime_ttc IS DISTINCT FROM OLD.prime_ttc THEN
    SELECT sum(e.montant) INTO v_echeancier FROM app.echeances_paiement e WHERE e.contrat_id = NEW.id;
    IF v_echeancier IS NOT NULL AND v_echeancier <> NEW.prime_ttc THEN
      RAISE EXCEPTION 'Ce contrat se paie en plusieurs fois : changez sa prime en redéfinissant son échéancier'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.statut = 'en_vigueur' THEN
    v_encaisse := app.total_encaisse(NEW.id);
    v_requis := coalesce((SELECT e.montant FROM app.echeances_paiement e WHERE e.contrat_id = NEW.id AND e.rang = 1),
                         NEW.prime_ttc);
    IF v_encaisse < v_requis THEN
      RAISE EXCEPTION 'Contrat non mis en vigueur : % F CFA à payer avant la prise d''effet, % F CFA encaissés (Code CIMA, art. 13)',
        v_requis, v_encaisse
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Remplace la version de 0005 : même règle, avec le montant requis ci-dessus
CREATE OR REPLACE FUNCTION app.suivre_paiement_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_statut app.statut_contrat;
  v_requis bigint;
  v_total bigint;
BEGIN
  SELECT k.statut INTO v_statut FROM app.contrats k WHERE k.id = NEW.contrat_id;
  v_requis := app.montant_requis_vigueur(NEW.contrat_id);
  v_total := app.total_encaisse(NEW.contrat_id);
  IF v_statut = 'en_attente_paiement' AND v_total >= v_requis THEN
    UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = NEW.contrat_id;
  ELSIF v_statut = 'en_vigueur' AND v_total < v_requis THEN
    UPDATE app.contrats SET statut = 'en_attente_paiement' WHERE id = NEW.contrat_id;
  END IF;
  RETURN NULL;
END
$$;

-- Définit (ou redéfinit) l'échéancier d'un contrat flotte, d'un seul bloc :
--   · p_echeances : [{"exigible_le": "2026-12-01", "montant": 312500}, …], dans l'ordre des dates ;
--     un tableau vide revient au paiement en une fois, tant que rien n'a été encaissé ;
--   · p_prime_ttc : nouvelle prime du contrat, si elle change en même temps (facultatif) ;
--   · chargé de clientèle ou gérant ; une fois un paiement reçu, seul le gérant renégocie l'échéancier.
CREATE FUNCTION app.definir_echeancier(p_contrat uuid, p_echeances jsonb, p_prime_ttc bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_contrat app.contrats;
  v_encaisse bigint;
  v_nombre integer;
  v_total bigint := 0;
  v_precedente date;
  v_premiere bigint;
  r record;
BEGIN
  IF NOT securite.a_le_role('gerant', 'charge_clientele') THEN
    RAISE EXCEPTION 'Seuls le gérant et le chargé de clientèle définissent un échéancier' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT k.* INTO v_contrat FROM app.contrats k WHERE k.id = p_contrat FOR UPDATE;
  IF NOT FOUND OR NOT securite.client_visible(v_contrat.client_id) THEN
    RAISE EXCEPTION 'Contrat introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_contrat.branche <> 'flotte' THEN
    RAISE EXCEPTION 'Le paiement en plusieurs fois est réservé aux contrats flotte' USING ERRCODE = 'check_violation';
  END IF;
  IF v_contrat.statut NOT IN ('en_attente_paiement', 'en_vigueur', 'suspendu') THEN
    RAISE EXCEPTION 'Ce contrat est terminé : son échéancier ne change plus' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_echeances) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Échéancier invalide' USING ERRCODE = 'check_violation';
  END IF;

  v_encaisse := app.total_encaisse(p_contrat);
  IF v_encaisse > 0 AND NOT securite.a_le_role('gerant') THEN
    RAISE EXCEPTION 'Des paiements sont déjà reçus sur ce contrat : seul le gérant renégocie son échéancier'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_nombre := jsonb_array_length(p_echeances);
  IF v_nombre = 0 THEN
    IF v_encaisse > 0 THEN
      RAISE EXCEPTION 'Des paiements sont déjà reçus : le contrat garde un échéancier (redéfinissez-le plutôt)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_nombre NOT BETWEEN 2 AND 12 THEN
    RAISE EXCEPTION 'Un échéancier compte de 2 à 12 échéances' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM app.echeances_paiement e WHERE e.contrat_id = p_contrat;
  IF v_nombre = 0 THEN
    IF p_prime_ttc IS NOT NULL AND p_prime_ttc <> v_contrat.prime_ttc THEN
      UPDATE app.contrats SET prime_ttc = p_prime_ttc WHERE id = p_contrat;
    END IF;
    RETURN;
  END IF;
  -- Nouvelle prime : enregistrée après les échéances, pour que la base la contrôle avec elles
  v_contrat.prime_ttc := coalesce(p_prime_ttc, v_contrat.prime_ttc);

  FOR r IN SELECT (x.e ->> 'exigible_le')::date AS exigible_le, (x.e ->> 'montant')::bigint AS montant, x.rang
           FROM jsonb_array_elements(p_echeances) WITH ORDINALITY AS x(e, rang)
           ORDER BY x.rang LOOP
    IF r.exigible_le IS NULL OR r.montant IS NULL OR r.montant <= 0 THEN
      RAISE EXCEPTION 'Échéance % : date et montant positif obligatoires', r.rang USING ERRCODE = 'check_violation';
    END IF;
    IF v_precedente IS NOT NULL AND r.exigible_le <= v_precedente THEN
      RAISE EXCEPTION 'Les échéances se suivent dans le temps (échéance % le %)', r.rang, to_char(r.exigible_le, 'DD/MM/YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    IF r.rang = 1 AND r.exigible_le > v_contrat.date_effet THEN
      RAISE EXCEPTION 'La première échéance se paie au plus tard à la date d''effet (%) : la garantie ne court qu''après paiement',
        to_char(v_contrat.date_effet, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
    END IF;
    IF r.exigible_le >= v_contrat.date_echeance THEN
      RAISE EXCEPTION 'L''échéance % tombe après la fin du contrat (%)', r.rang, to_char(v_contrat.date_echeance, 'DD/MM/YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    IF r.rang = 1 THEN v_premiere := r.montant; END IF;
    INSERT INTO app.echeances_paiement (contrat_id, rang, exigible_le, montant)
    VALUES (p_contrat, r.rang, r.exigible_le, r.montant);
    v_total := v_total + r.montant;
    v_precedente := r.exigible_le;
  END LOOP;

  IF v_total <> v_contrat.prime_ttc THEN
    RAISE EXCEPTION 'Le total des échéances (% F CFA) doit être égal à la prime TTC du contrat (% F CFA)', v_total, v_contrat.prime_ttc
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.contrats SET prime_ttc = v_contrat.prime_ttc WHERE id = p_contrat AND prime_ttc <> v_contrat.prime_ttc;

  -- Statut : le contrat entre en vigueur si la première échéance est déjà payée ; un contrat en vigueur
  -- ne peut pas se voir demander, après coup, plus que ce qui a été payé avant sa prise d'effet
  IF v_contrat.statut = 'en_attente_paiement' AND v_encaisse >= v_premiere THEN
    UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = p_contrat;
  ELSIF v_contrat.statut = 'en_vigueur' AND v_encaisse < v_premiere THEN
    RAISE EXCEPTION 'Le contrat est déjà en vigueur : la première échéance ne peut pas dépasser ce qui est payé (% F CFA)', v_encaisse
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION app.definir_echeancier(uuid, jsonb, bigint) TO dbs_api;

-- ---------------------------------------------------------------------
-- Suivi des échéances. Les paiements reçus soldent d'abord les avenants (dus aussitôt), puis les échéances
-- dans l'ordre. État : payée, en retard (date dépassée), bientôt (dans les 15 jours), à venir.
-- avenants_impayes : part des avenants pas encore payée, due tout de suite (la même sur chaque ligne).
-- ---------------------------------------------------------------------
CREATE VIEW app.v_echeances_paiement WITH (security_invoker = true) AS
WITH soldes AS (
  SELECT k.id AS contrat_id, k.primes_avenants,
         coalesce((SELECT sum(x.montant) FROM app.encaissements x WHERE x.contrat_id = k.id), 0)::bigint AS encaisse
  FROM app.contrats k
), lignes AS (
  SELECT e.id, e.contrat_id, e.rang, e.exigible_le, e.montant,
         sum(e.montant) OVER (PARTITION BY e.contrat_id ORDER BY e.rang) AS cumul,
         s.encaisse - s.primes_avenants AS disponible,
         greatest(s.primes_avenants - s.encaisse, 0) AS avenants_impayes
  FROM app.echeances_paiement e
  JOIN soldes s ON s.contrat_id = e.contrat_id
), payees AS (
  SELECT l.*, least(greatest(l.disponible - (l.cumul - l.montant), 0), l.montant)::bigint AS paye
  FROM lignes l
)
SELECT p.id, p.contrat_id, p.rang, p.exigible_le, p.montant, p.paye, (p.montant - p.paye)::bigint AS reste,
       CASE WHEN p.paye = p.montant THEN 'payee'
            WHEN p.exigible_le < (now() AT TIME ZONE 'Africa/Abidjan')::date THEN 'en_retard'
            WHEN p.exigible_le <= (now() AT TIME ZONE 'Africa/Abidjan')::date + 15 THEN 'bientot'
            ELSE 'a_venir' END AS etat,
       p.exigible_le - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours,
       p.avenants_impayes::bigint AS avenants_impayes
FROM payees p;

-- ---------------------------------------------------------------------
-- Droits : l'échéancier se lit avec le contrat (mêmes droits) ; il ne s'écrit que par app.definir_echeancier
-- ---------------------------------------------------------------------
ALTER TABLE app.echeances_paiement ENABLE ROW LEVEL SECURITY;
CREATE POLICY echeances_paiement_lecture ON app.echeances_paiement FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.contrats k WHERE k.id = contrat_id));
CREATE POLICY echeances_paiement_portail ON app.echeances_paiement FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats k WHERE k.id = contrat_id));
GRANT SELECT ON app.echeances_paiement TO dbs_api;
GRANT SELECT (id, contrat_id, rang, exigible_le, montant) ON app.echeances_paiement TO dbs_portail;
GRANT SELECT ON app.v_echeances_paiement TO dbs_api, dbs_portail;

-- ---------------------------------------------------------------------
-- Relances : une branche de plus (paiement en plusieurs fois), mêmes colonnes qu'avant (0010)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_relances_dues WITH (security_invoker = true) AS
WITH candidats AS (
  -- Contrats en vigueur (ou expirés, 0011), pas encore renouvelés : une étape à J-30, J-15, J-7, le jour de
  -- l'échéance, puis « vous n'êtes plus couvert » dans les 7 jours qui suivent
  SELECT (CASE WHEN e.j BETWEEN 16 AND 30 THEN 'echeance_j30'
               WHEN e.j BETWEEN 8 AND 15 THEN 'echeance_j15'
               WHEN e.j BETWEEN 1 AND 7 THEN 'echeance_j7'
               WHEN e.j = 0 THEN 'echeance_jour'
               ELSE 'contrat_expire' END)::app.type_relance AS type,
         e.client_id, e.id AS contrat_id, NULL::uuid AS devis_id, NULL::uuid AS sinistre_id, NULL::text AS etape,
         jsonb_build_object('branche', e.branche, 'numeroPolice', e.numero_police, 'dateEcheance', e.date_echeance) AS parametres
  FROM (SELECT k.id, k.client_id, k.branche, k.numero_police, k.date_echeance, k.statut,
               k.date_echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS j
        FROM app.contrats k) e
  WHERE e.statut IN ('en_vigueur', 'expire') AND e.j BETWEEN -7 AND 30
    AND NOT EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = e.id)
  UNION ALL
  -- Devis envoyé resté sans réponse (au-delà d'un mois, il n'est plus relancé)
  SELECT 'devis_sans_reponse'::app.type_relance, d.client_id, NULL, d.id, NULL, NULL,
         jsonb_build_object('branche', d.branche)
  FROM app.devis d
  WHERE d.statut = 'envoye'
    AND d.modifie_le <= now() - make_interval(days => app.delai_relance_devis_jours())
    AND d.modifie_le > now() - interval '30 days'
  UNION ALL
  -- Sinistre : chaque statut (déclaration comprise) est annoncé une fois, dans la semaine
  SELECT 'sinistre_avancement'::app.type_relance, k.client_id, k.id, NULL, s.id, s.statut::text,
         jsonb_build_object('statut', s.statut, 'survenuLe', s.survenu_le, 'branche', k.branche,
                            'numeroPolice', k.numero_police)
  FROM app.sinistres s
  JOIN app.contrats k ON k.id = s.contrat_id
  WHERE s.statut_modifie_le > now() - interval '7 days'
  UNION ALL
  -- Documents des véhicules : à J-30, à J-7, puis échus depuis moins de 15 jours ; un message par client
  -- et par étape, qui liste les documents (20 au plus, le nombre total est donné)
  SELECT 'documents_vehicules'::app.type_relance, g.client_id, NULL, NULL, NULL,
         g.etape || ':' || to_char((now() AT TIME ZONE 'Africa/Abidjan')::date, 'YYYY-MM-DD'),
         jsonb_build_object('etape', g.etape, 'nombre', g.nombre, 'premiereEcheance', g.premiere_echeance,
                            'documents', g.documents)
  FROM (SELECT d.client_id, d.etape, count(*) AS nombre, min(d.echeance) AS premiere_echeance,
               jsonb_path_query_array(
                 jsonb_agg(jsonb_build_object('vehiculeId', d.vehicule_id, 'immatriculation', d.immatriculation,
                                              'document', d.document, 'echeance', d.echeance)
                           ORDER BY d.echeance, d.immatriculation),
                 '$[0 to 19]') AS documents
        FROM (SELECT v.client_id, v.id AS vehicule_id, v.immatriculation, e.document, e.echeance,
                     CASE WHEN e.j BETWEEN 8 AND 30 THEN 'j30' WHEN e.j BETWEEN 1 AND 7 THEN 'j7' ELSE 'echu' END AS etape
              FROM app.vehicules v
              CROSS JOIN LATERAL (VALUES
                ('visite_technique', v.echeance_visite_technique),
                ('vignette', v.echeance_vignette),
                ('carte_de_transport', v.echeance_carte_transport)) AS doc(document, echeance)
              CROSS JOIN LATERAL (SELECT doc.document, doc.echeance,
                                         doc.echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS j) e
              WHERE e.echeance IS NOT NULL AND e.j BETWEEN -15 AND 30 AND app.vehicule_suivi(v.id)) d
        WHERE NOT EXISTS (SELECT 1 FROM app.annonces_documents a
                          WHERE a.vehicule_id = d.vehicule_id AND a.document = d.document
                            AND a.echeance = d.echeance AND a.etape = d.etape)
        GROUP BY d.client_id, d.etape) g
  UNION ALL
  -- Paiement en plusieurs fois (0018) : une échéance à payer dans les 7 jours, puis, si elle n'est pas
  -- réglée, un rappel une fois en retard (dans les 15 jours). Chaque étape d'une échéance n'est envoyée qu'une fois.
  SELECT 'echeance_paiement'::app.type_relance, k.client_id, k.id, NULL, NULL,
         e.id::text || ':' || (CASE WHEN e.exigible_le >= (now() AT TIME ZONE 'Africa/Abidjan')::date THEN 'j7' ELSE 'retard' END),
         jsonb_build_object('etape', CASE WHEN e.exigible_le >= (now() AT TIME ZONE 'Africa/Abidjan')::date THEN 'j7' ELSE 'retard' END,
                            'branche', k.branche, 'numeroPolice', k.numero_police,
                            'montant', e.reste, 'dateEcheance', e.exigible_le)
  FROM app.v_echeances_paiement e
  JOIN app.contrats k ON k.id = e.contrat_id
  WHERE e.reste > 0 AND k.statut IN ('en_attente_paiement', 'en_vigueur', 'suspendu')
    AND (e.exigible_le - (now() AT TIME ZONE 'Africa/Abidjan')::date BETWEEN 0 AND 7
         OR (now() AT TIME ZONE 'Africa/Abidjan')::date - e.exigible_le BETWEEN 1 AND 15)
), avec_cle AS (
  SELECT c.type::text || ':' || coalesce(c.devis_id, c.sinistre_id, c.contrat_id, c.client_id)::text
           || coalesce(':' || c.etape, '') AS cle,
         c.*
  FROM candidats c
)
SELECT a.cle, a.type, a.client_id, a.contrat_id, a.devis_id, a.sinistre_id,
       a.parametres || jsonb_build_object('nom', cl.nom) AS parametres, cl.telephone
FROM avec_cle a
JOIN app.clients cl ON cl.id = a.client_id
WHERE NOT EXISTS (SELECT 1 FROM app.relances r WHERE r.cle = a.cle);
