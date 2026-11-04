-- =====================================================================
-- 0010 · Flottes (tâche 8)
--
--   · composition d'un contrat flotte : les véhicules de départ se rattachent tant que le contrat attend
--     son paiement ; ensuite, tout ajout ou retrait passe par un avenant ;
--   · app.avenants_flotte : ajout ou retrait d'un véhicule en cours de contrat, avec la prime calculée par
--     la base au prorata des jours restants (positive à l'ajout, ristourne négative au retrait). Ajout seul ;
--   · prime due = prime du contrat + avenants : le reste à payer, le contrôle des encaissements et le solde
--     en tiennent compte ; la mise en vigueur reste liée à la prime de départ (Code CIMA, art. 13) ;
--   · relances des documents des véhicules (visite technique, vignette, carte de transport) : un seul
--     message par client et par étape (J-30, J-7, échu), qui liste ses véhicules, pour qu'un transporteur
--     ne reçoive pas un message par camion. Chaque document n'est annoncé qu'une fois par étape.
-- Conception : docs/architecture/adr/0010-flottes.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- Prime due : prime du contrat + total des avenants (tenu par la base)
-- ---------------------------------------------------------------------
ALTER TABLE app.contrats ADD COLUMN primes_avenants bigint NOT NULL DEFAULT 0;

CREATE FUNCTION app.prime_due(p_contrat uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT k.prime_ttc + k.primes_avenants FROM app.contrats k WHERE k.id = p_contrat $$;
GRANT EXECUTE ON FUNCTION app.prime_due(uuid) TO dbs_api;

-- Encaissement : jamais plus que la prime due (avenants compris)
CREATE OR REPLACE FUNCTION app.controler_caisse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_prime bigint;
  v_total bigint;
  v_caissier uuid;
  v_cloture timestamptz;
BEGIN
  -- Caisse concernée : celle de la personne qui encaisse, ou, pour une contre-passation,
  -- celle de la personne qui avait encaissé (app.v_mouvements_caisse)
  IF NEW.annule_encaissement_id IS NOT NULL THEN
    SELECT o.encaisse_par INTO v_caissier FROM app.encaissements o WHERE o.id = NEW.annule_encaissement_id;
  END IF;
  v_caissier := coalesce(v_caissier, NEW.encaisse_par);

  -- Toujours dans le même ordre (contrat, puis caisse) pour qu'aucune attente ne se croise
  SELECT k.prime_ttc + k.primes_avenants INTO v_prime FROM app.contrats k WHERE k.id = NEW.contrat_id FOR UPDATE;
  PERFORM app.verrouiller_caisse(v_caissier);

  SELECT max(c.fin) INTO v_cloture FROM app.clotures_caisse c WHERE c.caissier_id = v_caissier;
  IF v_cloture IS NOT NULL AND NEW.encaisse_le <= v_cloture THEN
    RAISE EXCEPTION 'Caisse clôturée le % : un encaissement ne peut pas être daté d''avant. Réessayez.',
      to_char(v_cloture AT TIME ZONE 'Africa/Abidjan', 'DD/MM/YYYY à HH24:MI') USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.montant > 0 THEN
    v_total := app.total_encaisse(NEW.contrat_id);
    IF v_total + NEW.montant > v_prime THEN
      RAISE EXCEPTION 'Montant supérieur au reste à payer : % F CFA restent à régler sur ce contrat',
        greatest(v_prime - v_total, 0) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Solde : la colonne prime_due s'ajoute en fin de vue ; le reste à payer inclut les avenants
-- (négatif après une ristourne sur une prime déjà payée : somme à rembourser au client)
CREATE OR REPLACE VIEW app.v_soldes_contrats WITH (security_invoker = true) AS
SELECT c.id AS contrat_id, c.client_id, c.numero_police, c.branche, c.statut, c.prime_ttc,
       coalesce(sum(e.montant), 0)::bigint AS total_encaisse,
       (c.prime_ttc + c.primes_avenants - coalesce(sum(e.montant), 0))::bigint AS reste_a_payer,
       c.primes_avenants,
       (c.prime_ttc + c.primes_avenants)::bigint AS prime_due
FROM app.contrats c
LEFT JOIN app.encaissements e ON e.contrat_id = c.id
GROUP BY c.id;

-- ---------------------------------------------------------------------
-- Composition d'un contrat : véhicules de départ, puis avenants seulement
-- ---------------------------------------------------------------------
ALTER TABLE app.contrats_vehicules
  -- Prime TTC du véhicule pour toute la période du contrat : base du prorata d'un retrait
  ADD COLUMN prime_vehicule bigint,
  ADD CONSTRAINT contrats_vehicules_prime CHECK (prime_vehicule IS NULL OR prime_vehicule > 0);

-- Directement (sans avenant), on ne rattache un véhicule qu'à un contrat qui attend son paiement, et pour
-- toute la période : sinon il serait couvert sans prime. Un retrait ne se fait que par avenant.
-- Seules les écritures des fonctions d'avenant passent outre : elles s'exécutent sous l'identité du
-- propriétaire de la table, que l'application ne peut pas prendre (pas de SECURITY DEFINER ici, exprès).
CREATE FUNCTION app.controler_contrat_vehicule() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_contrat app.contrats;
  v_par_avenant boolean := current_user = (SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                                           WHERE c.oid = TG_RELID);
BEGIN
  SELECT * INTO v_contrat FROM app.contrats WHERE id = NEW.contrat_id;
  IF NOT EXISTS (SELECT 1 FROM app.vehicules v WHERE v.id = NEW.vehicule_id AND v.client_id = v_contrat.client_id) THEN
    RAISE EXCEPTION 'Ce véhicule n''appartient pas au client du contrat.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NOT v_par_avenant THEN
    IF v_contrat.statut <> 'en_attente_paiement' THEN
      RAISE EXCEPTION 'Contrat déjà en vigueur : ajoutez le véhicule par un avenant, au prorata.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.ajoute_le <> v_contrat.date_effet OR NEW.retire_le IS NOT NULL THEN
      RAISE EXCEPTION 'Un véhicule de départ est couvert du % au % : ajoutez-le à la date d''effet du contrat.',
        to_char(v_contrat.date_effet, 'DD/MM/YYYY'), to_char(v_contrat.date_echeance, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT v_par_avenant
     AND (NEW.retire_le IS DISTINCT FROM OLD.retire_le OR NEW.ajoute_le <> OLD.ajoute_le
          OR NEW.prime_vehicule IS DISTINCT FROM OLD.prime_vehicule OR NEW.contrat_id <> OLD.contrat_id
          OR NEW.vehicule_id <> OLD.vehicule_id) THEN
    RAISE EXCEPTION 'Le retrait d''un véhicule se fait par un avenant, au prorata.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.contrats_vehicules
  FOR EACH ROW EXECUTE FUNCTION app.controler_contrat_vehicule();

-- Le personnel ne modifie plus la date de retrait lui-même : avenant obligatoire
REVOKE UPDATE (retire_le) ON app.contrats_vehicules FROM dbs_api;

-- ---------------------------------------------------------------------
-- Avenants : ajout ou retrait d'un véhicule en cours de contrat, au prorata
-- ---------------------------------------------------------------------
CREATE TYPE app.nature_avenant AS ENUM ('ajout', 'retrait');

CREATE TABLE app.avenants_flotte (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numéro continu, attribué par la base
  numero           bigint NOT NULL,
  contrat_id       uuid NOT NULL REFERENCES app.contrats (id),
  vehicule_id      uuid NOT NULL REFERENCES app.vehicules (id),
  nature           app.nature_avenant NOT NULL,
  date_effet       date NOT NULL,
  -- Prime TTC du véhicule pour toute la période du contrat (cotation de la compagnie)
  prime_vehicule   bigint NOT NULL,
  -- Calculés par la base, jamais fournis par l'application
  jours_restants   integer NOT NULL,
  jours_periode    integer NOT NULL,
  -- Positif : prime à encaisser ; négatif : ristourne
  montant          bigint NOT NULL,
  cree_le          timestamptz NOT NULL,
  cree_par         uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT avenants_flotte_numero_unique UNIQUE (numero),
  CONSTRAINT avenants_flotte_prime CHECK (prime_vehicule > 0),
  CONSTRAINT avenants_flotte_jours CHECK (jours_periode > 0 AND jours_restants BETWEEN 1 AND jours_periode),
  CONSTRAINT avenants_flotte_sens CHECK ((nature = 'ajout') = (montant >= 0))
);
CREATE INDEX avenants_flotte_contrat_idx ON app.avenants_flotte (contrat_id, numero);

-- Prorata temporis : prime × jours restants ÷ jours de la période, arrondi au franc
CREATE FUNCTION app.prorata(p_prime bigint, p_jours_restants integer, p_jours_periode integer) RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT round(p_prime::numeric * p_jours_restants / p_jours_periode)::bigint $$;
GRANT EXECUTE ON FUNCTION app.prorata(bigint, integer, integer) TO dbs_api;

CREATE FUNCTION app.calculer_avenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_contrat app.contrats;
  v_ligne app.contrats_vehicules;
BEGIN
  -- Un avenant à la fois par contrat
  SELECT * INTO v_contrat FROM app.contrats WHERE id = NEW.contrat_id FOR UPDATE;
  IF v_contrat.statut <> 'en_vigueur' THEN
    RAISE EXCEPTION 'Un avenant ne se fait que sur un contrat en vigueur ; avant le paiement, modifiez la composition et la prime du contrat.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.date_effet <= v_contrat.date_effet OR NEW.date_effet >= v_contrat.date_echeance THEN
    RAISE EXCEPTION 'Date d''effet de l''avenant hors du contrat : entre le % et le % (exclus).',
      to_char(v_contrat.date_effet, 'DD/MM/YYYY'), to_char(v_contrat.date_echeance, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.vehicules v WHERE v.id = NEW.vehicule_id AND v.client_id = v_contrat.client_id) THEN
    RAISE EXCEPTION 'Ce véhicule n''appartient pas au client du contrat.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_ligne FROM app.contrats_vehicules WHERE contrat_id = NEW.contrat_id AND vehicule_id = NEW.vehicule_id;
  IF NEW.nature = 'ajout' AND FOUND THEN
    RAISE EXCEPTION 'Ce véhicule figure déjà sur ce contrat.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.nature = 'retrait' THEN
    IF NOT FOUND OR v_ligne.retire_le IS NOT NULL THEN
      RAISE EXCEPTION 'Ce véhicule n''est pas couvert par ce contrat.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.date_effet <= v_ligne.ajoute_le THEN
      RAISE EXCEPTION 'Le retrait doit suivre l''ajout du véhicule (le %).', to_char(v_ligne.ajoute_le, 'DD/MM/YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
    -- Prime connue depuis le rattachement, sinon celle indiquée avec le retrait
    NEW.prime_vehicule := coalesce(v_ligne.prime_vehicule, NEW.prime_vehicule);
  END IF;
  IF NEW.prime_vehicule IS NULL THEN
    RAISE EXCEPTION 'Indiquez la prime du véhicule pour la période du contrat.' USING ERRCODE = 'check_violation';
  END IF;

  NEW.jours_periode := v_contrat.date_echeance - v_contrat.date_effet;
  NEW.jours_restants := v_contrat.date_echeance - NEW.date_effet;
  NEW.montant := app.prorata(NEW.prime_vehicule, NEW.jours_restants, NEW.jours_periode)
                 * CASE WHEN NEW.nature = 'ajout' THEN 1 ELSE -1 END;
  NEW.numero := app.numero_suivant('avenants');
  RETURN NEW;
END
$$;

-- Effets de l'avenant : composition du contrat et prime due
CREATE FUNCTION app.appliquer_avenant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.nature = 'ajout' THEN
    INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule)
    VALUES (NEW.contrat_id, NEW.vehicule_id, NEW.date_effet, NEW.prime_vehicule);
  ELSE
    UPDATE app.contrats_vehicules SET retire_le = NEW.date_effet, prime_vehicule = NEW.prime_vehicule
    WHERE contrat_id = NEW.contrat_id AND vehicule_id = NEW.vehicule_id;
  END IF;
  UPDATE app.contrats SET primes_avenants = primes_avenants + NEW.montant WHERE id = NEW.contrat_id;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.interdire_modification_avenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Un avenant ne se modifie pas : % interdit. Faites un nouvel avenant.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_calcul BEFORE INSERT ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION app.calculer_avenant();
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_avenant();
CREATE TRIGGER d_effets AFTER INSERT ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION app.appliquer_avenant();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Avenants avec leur règlement : les encaissements au-delà de la prime de départ règlent les avenants dans
-- l'ordre (ristournes comprises). Un véhicule ajouté n'est couvert qu'une fois sa prime d'avenant réglée.
CREATE VIEW app.v_avenants_flotte WITH (security_invoker = true) AS
SELECT a.id, a.numero, a.contrat_id, a.vehicule_id, v.immatriculation, a.nature, a.date_effet, a.prime_vehicule,
       a.jours_restants, a.jours_periode, a.montant, a.cree_le, a.cree_par,
       CASE WHEN a.nature = 'ajout' THEN
         k.prime_ttc + sum(a.montant) OVER (PARTITION BY a.contrat_id ORDER BY a.numero) <= s.total_encaisse
       END AS regle
FROM app.avenants_flotte a
JOIN app.contrats k ON k.id = a.contrat_id
JOIN app.vehicules v ON v.id = a.vehicule_id
JOIN app.v_soldes_contrats s ON s.contrat_id = a.contrat_id;

-- ---------------------------------------------------------------------
-- Relances des documents des véhicules, groupées par client
-- ---------------------------------------------------------------------
-- Ce qui a déjà été annoncé : un document (à une échéance donnée) n'est annoncé qu'une fois par étape
CREATE TABLE app.annonces_documents (
  vehicule_id  uuid NOT NULL REFERENCES app.vehicules (id),
  document     text NOT NULL,
  echeance     date NOT NULL,
  etape        text NOT NULL,
  relance_id   uuid NOT NULL REFERENCES app.relances (id),
  PRIMARY KEY (vehicule_id, document, echeance, etape),
  CONSTRAINT annonces_documents_document CHECK (document IN ('visite_technique', 'vignette', 'carte_de_transport')),
  CONSTRAINT annonces_documents_etape CHECK (etape IN ('j30', 'j7', 'echu'))
);

-- La relance d'un client sur ses documents ne porte sur aucun contrat, devis ni sinistre
ALTER TABLE app.relances DROP CONSTRAINT relances_objet;
ALTER TABLE app.relances ADD CONSTRAINT relances_objet CHECK (CASE type
  WHEN 'devis_sans_reponse' THEN devis_id IS NOT NULL AND contrat_id IS NULL AND sinistre_id IS NULL
  WHEN 'sinistre_avancement' THEN sinistre_id IS NOT NULL AND contrat_id IS NOT NULL AND devis_id IS NULL
  WHEN 'documents_vehicules' THEN contrat_id IS NULL AND devis_id IS NULL AND sinistre_id IS NULL
  ELSE contrat_id IS NOT NULL AND devis_id IS NULL AND sinistre_id IS NULL
END);

-- Mêmes colonnes qu'avant (0006) ; une branche de plus : les documents à annoncer, groupés par client et
-- par étape. La clé porte la date du jour : un document qui entre dans une étape demain fera l'objet d'un
-- nouveau message, sans répéter ceux déjà annoncés.
CREATE OR REPLACE VIEW app.v_relances_dues WITH (security_invoker = true) AS
WITH candidats AS (
  -- Contrats en vigueur, pas encore renouvelés : une étape à J-30, J-15, J-7, le jour de l'échéance,
  -- puis « vous n'êtes plus couvert » dans les 7 jours qui suivent
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
  WHERE e.statut = 'en_vigueur' AND e.j BETWEEN -7 AND 30
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
              WHERE e.echeance IS NOT NULL AND e.j BETWEEN -15 AND 30) d
        WHERE NOT EXISTS (SELECT 1 FROM app.annonces_documents a
                          WHERE a.vehicule_id = d.vehicule_id AND a.document = d.document
                            AND a.echeance = d.echeance AND a.etape = d.etape)
        GROUP BY d.client_id, d.etape) g
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

-- Planification (0006) : en plus, chaque document annoncé dans un message groupé est noté, pour ne plus
-- l'annoncer à la même étape
CREATE OR REPLACE FUNCTION app.planifier_relances(p_canaux app.canal_relance[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  WITH nouvelles AS (
    INSERT INTO app.relances (cle, type, client_id, contrat_id, devis_id, sinistre_id, canal, destinataire, parametres)
    SELECT d.cle, d.type, d.client_id, d.contrat_id, d.devis_id, d.sinistre_id, x.canal, d.telephone, d.parametres
    FROM app.v_relances_dues d
    CROSS JOIN LATERAL (SELECT CASE
        WHEN 'whatsapp' = ANY (p_canaux) AND app.consentement_actuel(d.client_id, 'whatsapp') THEN 'whatsapp'::app.canal_relance
        WHEN 'sms' = ANY (p_canaux) AND app.consentement_actuel(d.client_id, 'sms') THEN 'sms'::app.canal_relance
      END AS canal) x
    WHERE x.canal IS NOT NULL
    ON CONFLICT (cle) DO NOTHING
    RETURNING id, type, parametres
  ), annonces AS (
    INSERT INTO app.annonces_documents (vehicule_id, document, echeance, etape, relance_id)
    SELECT (doc ->> 'vehiculeId')::uuid, doc ->> 'document', (doc ->> 'echeance')::date, n.parametres ->> 'etape', n.id
    FROM nouvelles n
    CROSS JOIN LATERAL jsonb_array_elements(n.parametres -> 'documents') AS doc
    WHERE n.type = 'documents_vehicules'
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_nombre FROM nouvelles;
  RETURN v_nombre;
END
$$;

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.avenants_flotte ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.annonces_documents ENABLE ROW LEVEL SECURITY;

-- Avenants : vus de qui voit le contrat, faits par qui gère les contrats
CREATE POLICY avenants_flotte_lecture ON app.avenants_flotte FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
CREATE POLICY avenants_flotte_creation ON app.avenants_flotte FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));

-- Annonces : lues avec les relances ; écrites seulement par le planificateur
CREATE POLICY annonces_documents_lecture ON app.annonces_documents FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));

GRANT SELECT ON app.avenants_flotte, app.annonces_documents, app.v_avenants_flotte TO dbs_api;
GRANT INSERT (contrat_id, vehicule_id, nature, date_effet, prime_vehicule) ON app.avenants_flotte TO dbs_api;
