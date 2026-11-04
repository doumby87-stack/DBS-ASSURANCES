-- =====================================================================
-- 0010 · Flottes (tâche 8)
--
--   · composition d'un contrat flotte : les véhicules de départ se rattachent (ou se détachent) tant que le
--     contrat attend son paiement ; ensuite, toute incorporation ou tout retrait passe par un avenant ;
--   · app.avenants_flotte : avenant de mouvement (incorporation ou retrait d'un ou plusieurs véhicules à une
--     même date, réintégration comprise), avec la prime calculée par la base au prorata des jours restants
--     (positive à l'incorporation, ristourne au retrait), ou avenant d'annulation qui défait exactement un
--     avenant saisi par erreur. Ajout seul : un avenant ne se modifie ni ne se supprime ;
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

-- Un véhicule sorti d'un contrat peut y revenir (réintégration) : il y a alors une ligne par période.
-- Une seule période ouverte à la fois ; les avenants veillent à ce que les périodes ne se chevauchent pas.
ALTER TABLE app.contrats_vehicules DROP CONSTRAINT contrats_vehicules_unique;
CREATE UNIQUE INDEX contrats_vehicules_en_cours_unique ON app.contrats_vehicules (contrat_id, vehicule_id)
  WHERE retire_le IS NULL;
CREATE INDEX contrats_vehicules_contrat_idx ON app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le);
CREATE INDEX contrats_vehicules_vehicule_idx ON app.contrats_vehicules (vehicule_id);

-- Directement (sans avenant), on ne rattache ou ne détache un véhicule que tant que le contrat attend son
-- paiement, et pour toute la période : sinon il serait couvert sans prime, ou retiré sans ristourne.
-- Seules les écritures des fonctions d'avenant passent outre : elles s'exécutent sous l'identité du
-- propriétaire de la table, que l'application ne peut pas prendre (pas de SECURITY DEFINER ici, exprès).
CREATE FUNCTION app.controler_contrat_vehicule() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_ligne app.contrats_vehicules;
  v_contrat app.contrats;
  v_par_avenant boolean := current_user = (SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                                           WHERE c.oid = TG_RELID);
BEGIN
  IF TG_OP = 'DELETE' THEN v_ligne := OLD; ELSE v_ligne := NEW; END IF;
  SELECT * INTO v_contrat FROM app.contrats WHERE id = v_ligne.contrat_id;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (SELECT 1 FROM app.vehicules v
                                       WHERE v.id = v_ligne.vehicule_id AND v.client_id = v_contrat.client_id) THEN
    RAISE EXCEPTION 'Ce véhicule n''appartient pas au client du contrat.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_par_avenant THEN
    RETURN v_ligne;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_contrat.statut <> 'en_attente_paiement' THEN
      RAISE EXCEPTION 'Contrat déjà en vigueur : incorporez le véhicule par un avenant, au prorata.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.ajoute_le <> v_contrat.date_effet OR NEW.retire_le IS NOT NULL
       OR NEW.incorpore_par IS NOT NULL OR NEW.retire_par IS NOT NULL THEN
      RAISE EXCEPTION 'Un véhicule de départ est couvert du % au % : ajoutez-le à la date d''effet du contrat.',
        to_char(v_contrat.date_effet, 'DD/MM/YYYY'), to_char(v_contrat.date_echeance, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.retire_le IS DISTINCT FROM OLD.retire_le OR NEW.ajoute_le <> OLD.ajoute_le
       OR NEW.prime_vehicule IS DISTINCT FROM OLD.prime_vehicule OR NEW.contrat_id <> OLD.contrat_id
       OR NEW.vehicule_id <> OLD.vehicule_id OR NEW.incorpore_par IS DISTINCT FROM OLD.incorpore_par
       OR NEW.retire_par IS DISTINCT FROM OLD.retire_par THEN
      RAISE EXCEPTION 'Le retrait d''un véhicule se fait par un avenant, au prorata.' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- Erreur de composition corrigée avant le paiement : le véhicule n'a jamais été couvert
    IF v_contrat.statut <> 'en_attente_paiement' THEN
      RAISE EXCEPTION 'Contrat déjà en vigueur : retirez le véhicule par un avenant, au prorata.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.numero_attestation IS NOT NULL THEN
      RAISE EXCEPTION 'Attestation % déjà émise pour ce véhicule : faites-la d''abord annuler.', OLD.numero_attestation
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN v_ligne;
END
$$;

-- Le personnel ne modifie plus la date de retrait lui-même : avenant obligatoire
REVOKE UPDATE (retire_le) ON app.contrats_vehicules FROM dbs_api;

-- ---------------------------------------------------------------------
-- Avenants : incorporation et retrait de véhicules en cours de contrat, au prorata, et annulation
-- ---------------------------------------------------------------------
-- Un avenant de mouvement incorpore ou retire un ou plusieurs véhicules à une même date ; un avenant
-- d'annulation défait exactement un avenant de mouvement saisi par erreur. Ni l'un ni l'autre ne se
-- modifie ni ne se supprime : la correction est elle-même un avenant, numéroté et tracé.
CREATE TYPE app.nature_avenant AS ENUM ('mouvement', 'annulation');
CREATE TYPE app.mouvement_flotte AS ENUM ('incorporation', 'retrait');

CREATE TABLE app.avenants_flotte (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numéro continu, attribué par la base
  numero             bigint NOT NULL,
  contrat_id         uuid NOT NULL REFERENCES app.contrats (id),
  nature             app.nature_avenant NOT NULL,
  date_effet         date NOT NULL,
  -- Total des lignes, calculé par la base : positif, prime à encaisser ; négatif, ristourne
  montant            bigint NOT NULL,
  -- Avenant défait par cet avenant d'annulation
  annule_avenant_id  uuid REFERENCES app.avenants_flotte (id),
  motif              text,
  cree_le            timestamptz NOT NULL,
  cree_par           uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT avenants_flotte_numero_unique UNIQUE (numero),
  CONSTRAINT avenants_flotte_annulation_unique UNIQUE (annule_avenant_id),
  CONSTRAINT avenants_flotte_annulation CHECK ((nature = 'annulation') = (annule_avenant_id IS NOT NULL)),
  CONSTRAINT avenants_flotte_motif CHECK (motif IS NULL OR char_length(motif) <= 500),
  CONSTRAINT avenants_flotte_motif_annulation CHECK (nature <> 'annulation' OR char_length(btrim(motif)) >= 5)
);
CREATE INDEX avenants_flotte_contrat_idx ON app.avenants_flotte (contrat_id, numero);

CREATE TABLE app.avenants_flotte_lignes (
  avenant_id      uuid NOT NULL REFERENCES app.avenants_flotte (id),
  vehicule_id     uuid NOT NULL REFERENCES app.vehicules (id),
  -- Mouvement effectué, ou défait pour un avenant d'annulation
  mouvement       app.mouvement_flotte NOT NULL,
  -- Prime TTC du véhicule pour toute la période du contrat (cotation de la compagnie)
  prime_vehicule  bigint NOT NULL,
  -- Calculés par la base, jamais fournis par l'application
  jours_restants  integer NOT NULL,
  jours_periode   integer NOT NULL,
  montant         bigint NOT NULL,
  PRIMARY KEY (avenant_id, vehicule_id),
  CONSTRAINT avenants_flotte_lignes_prime CHECK (prime_vehicule > 0),
  CONSTRAINT avenants_flotte_lignes_jours CHECK (jours_periode > 0 AND jours_restants BETWEEN 1 AND jours_periode)
);
CREATE INDEX avenants_flotte_lignes_vehicule_idx ON app.avenants_flotte_lignes (vehicule_id);

-- Lien entre chaque période d'un véhicule sur un contrat et les avenants qui l'ont ouverte ou fermée
ALTER TABLE app.contrats_vehicules
  ADD COLUMN incorpore_par uuid REFERENCES app.avenants_flotte (id),
  ADD COLUMN retire_par uuid REFERENCES app.avenants_flotte (id);

CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE OR DELETE ON app.contrats_vehicules
  FOR EACH ROW EXECUTE FUNCTION app.controler_contrat_vehicule();

-- Prorata temporis : prime × jours restants ÷ jours de la période, arrondi au franc
CREATE FUNCTION app.prorata(p_prime bigint, p_jours_restants integer, p_jours_periode integer) RETURNS bigint
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT round(p_prime::numeric * p_jours_restants / p_jours_periode)::bigint $$;
GRANT EXECUTE ON FUNCTION app.prorata(bigint, integer, integer) TO dbs_api;

-- Avenant de mouvement. p_lignes : [{"vehiculeId", "mouvement": "incorporation" | "retrait", "primeVehicule"}].
-- Avec p_enregistrer à faux, contrôle et calcule sans rien écrire : l'aperçu montré à l'écran et l'avenant
-- enregistré sortent du même calcul. Rend l'avenant (id et numéro s'il est enregistré) et ses lignes.
CREATE FUNCTION app.avenant_flotte(p_contrat uuid, p_date_effet date, p_lignes jsonb, p_motif text,
                                   p_enregistrer boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_contrat app.contrats;
  v_entree jsonb;
  v_vehicule app.vehicules;
  v_en_cours app.contrats_vehicules;
  v_fin_precedente date;
  v_prime_precedente bigint;
  v_mouvement app.mouvement_flotte;
  v_prime bigint;
  v_montant bigint;
  v_jours_periode integer;
  v_jours_restants integer;
  v_lignes jsonb := '[]';
  v_total bigint := 0;
  v_id uuid;
  v_numero bigint;
BEGIN
  IF NOT securite.a_le_role('gerant', 'charge_clientele') THEN
    RAISE EXCEPTION 'Seuls le gérant et les chargés de clientèle établissent un avenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Un avenant à la fois par contrat
  SELECT * INTO v_contrat FROM app.contrats WHERE id = p_contrat FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrat introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_contrat.statut <> 'en_vigueur' THEN
    RAISE EXCEPTION 'Un avenant ne se fait que sur un contrat en vigueur ; avant le paiement, modifiez la composition et la prime du contrat.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_date_effet IS NULL OR p_date_effet <= v_contrat.date_effet OR p_date_effet >= v_contrat.date_echeance THEN
    RAISE EXCEPTION 'Date d''effet de l''avenant hors du contrat : entre le % et le % (exclus).',
      to_char(v_contrat.date_effet, 'DD/MM/YYYY'), to_char(v_contrat.date_echeance, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_lignes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Un avenant porte sur 1 à 200 véhicules.' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_lignes) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Un avenant porte sur 1 à 200 véhicules.' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(DISTINCT e ->> 'vehiculeId') FROM jsonb_array_elements(p_lignes) e) <> jsonb_array_length(p_lignes) THEN
    RAISE EXCEPTION 'Un même véhicule figure deux fois dans l''avenant.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_motif IS NOT NULL AND char_length(p_motif) > 500 THEN
    RAISE EXCEPTION 'Observation trop longue (500 caractères au plus).' USING ERRCODE = 'check_violation';
  END IF;

  v_jours_periode := v_contrat.date_echeance - v_contrat.date_effet;
  v_jours_restants := v_contrat.date_echeance - p_date_effet;

  FOR v_entree IN SELECT e FROM jsonb_array_elements(p_lignes) e LOOP
    SELECT * INTO v_vehicule FROM app.vehicules
    WHERE id = (v_entree ->> 'vehiculeId')::uuid AND client_id = v_contrat.client_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ce véhicule n''appartient pas au client du contrat.' USING ERRCODE = 'check_violation';
    END IF;
    v_mouvement := (v_entree ->> 'mouvement')::app.mouvement_flotte;
    v_prime := (v_entree ->> 'primeVehicule')::bigint;
    SELECT * INTO v_en_cours FROM app.contrats_vehicules
    WHERE contrat_id = p_contrat AND vehicule_id = v_vehicule.id AND retire_le IS NULL;

    IF v_mouvement = 'incorporation' THEN
      IF FOUND THEN
        RAISE EXCEPTION '% figure déjà sur ce contrat.', v_vehicule.immatriculation USING ERRCODE = 'check_violation';
      END IF;
      -- Réintégration : pas avant la sortie précédente ; la prime précédente sert si aucune n'est donnée
      SELECT cv.retire_le, cv.prime_vehicule INTO v_fin_precedente, v_prime_precedente
      FROM app.contrats_vehicules cv
      WHERE cv.contrat_id = p_contrat AND cv.vehicule_id = v_vehicule.id
      ORDER BY cv.retire_le DESC LIMIT 1;
      IF v_fin_precedente IS NOT NULL AND p_date_effet < v_fin_precedente THEN
        RAISE EXCEPTION '% est sorti du contrat le % : il ne peut y revenir qu''à partir de cette date.',
          v_vehicule.immatriculation, to_char(v_fin_precedente, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
      END IF;
      v_prime := coalesce(v_prime, v_prime_precedente);
    ELSE
      IF NOT FOUND THEN
        RAISE EXCEPTION '% n''est pas couvert par ce contrat.', v_vehicule.immatriculation USING ERRCODE = 'check_violation';
      END IF;
      IF p_date_effet <= v_en_cours.ajoute_le THEN
        RAISE EXCEPTION 'Le retrait de % doit suivre son entrée dans le contrat (le %).',
          v_vehicule.immatriculation, to_char(v_en_cours.ajoute_le, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
      END IF;
      -- Prime connue depuis l'entrée du véhicule, sinon celle indiquée avec le retrait
      v_prime := coalesce(v_en_cours.prime_vehicule, v_prime);
    END IF;
    IF v_prime IS NULL OR v_prime <= 0 THEN
      RAISE EXCEPTION 'Indiquez la prime de % pour la période du contrat.', v_vehicule.immatriculation
        USING ERRCODE = 'check_violation';
    END IF;

    v_montant := app.prorata(v_prime, v_jours_restants, v_jours_periode)
                 * CASE WHEN v_mouvement = 'incorporation' THEN 1 ELSE -1 END;
    v_total := v_total + v_montant;
    v_lignes := v_lignes || jsonb_build_object('vehiculeId', v_vehicule.id, 'immatriculation', v_vehicule.immatriculation,
                                               'mouvement', v_mouvement, 'primeVehicule', v_prime, 'montant', v_montant);
  END LOOP;

  IF p_enregistrer THEN
    v_numero := app.numero_suivant('avenants');
    INSERT INTO app.avenants_flotte (numero, contrat_id, nature, date_effet, montant, motif)
    VALUES (v_numero, p_contrat, 'mouvement', p_date_effet, v_total, nullif(btrim(p_motif), ''))
    RETURNING id INTO v_id;
    INSERT INTO app.avenants_flotte_lignes (avenant_id, vehicule_id, mouvement, prime_vehicule, jours_restants, jours_periode, montant)
    SELECT v_id, l."vehiculeId", l.mouvement, l."primeVehicule", v_jours_restants, v_jours_periode, l.montant
    FROM jsonb_to_recordset(v_lignes) AS l("vehiculeId" uuid, mouvement app.mouvement_flotte, "primeVehicule" bigint, montant bigint);

    -- Effets : composition du contrat et prime due
    UPDATE app.contrats_vehicules cv SET retire_le = p_date_effet, retire_par = v_id, prime_vehicule = l.prime_vehicule
    FROM app.avenants_flotte_lignes l
    WHERE l.avenant_id = v_id AND l.mouvement = 'retrait'
      AND cv.contrat_id = p_contrat AND cv.vehicule_id = l.vehicule_id AND cv.retire_le IS NULL;
    INSERT INTO app.contrats_vehicules (contrat_id, vehicule_id, ajoute_le, prime_vehicule, incorpore_par)
    SELECT p_contrat, l.vehicule_id, p_date_effet, l.prime_vehicule, v_id
    FROM app.avenants_flotte_lignes l WHERE l.avenant_id = v_id AND l.mouvement = 'incorporation';
    UPDATE app.contrats SET primes_avenants = primes_avenants + v_total WHERE id = p_contrat;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'nature', 'mouvement', 'dateEffet', p_date_effet,
                            'joursPeriode', v_jours_periode, 'joursRestants', v_jours_restants,
                            'montant', v_total, 'lignes', v_lignes);
END
$$;
REVOKE ALL ON FUNCTION app.avenant_flotte(uuid, date, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.avenant_flotte(uuid, date, jsonb, text, boolean) TO dbs_api;

-- Avenant d'annulation : défait exactement un avenant de mouvement saisi par erreur (mêmes véhicules, même
-- date d'effet, montant opposé), si rien ne s'est appuyé dessus depuis : aucun avenant postérieur sur ses
-- véhicules, aucune attestation émise ni aucun sinistre déclaré sur un véhicule qu'il a incorporé.
CREATE FUNCTION app.annuler_avenant_flotte(p_avenant uuid, p_motif text, p_enregistrer boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_avenant app.avenants_flotte;
  v_contrat app.contrats;
  v_numero_posterieur bigint;
  v_bloquant text;
  v_lignes jsonb;
  v_id uuid;
  v_numero bigint;
BEGIN
  IF NOT securite.a_le_role('gerant', 'charge_clientele') THEN
    RAISE EXCEPTION 'Seuls le gérant et les chargés de clientèle établissent un avenant.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_avenant FROM app.avenants_flotte WHERE id = p_avenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avenant introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_contrat FROM app.contrats WHERE id = v_avenant.contrat_id FOR UPDATE;
  IF v_avenant.nature = 'annulation' THEN
    RAISE EXCEPTION 'Un avenant d''annulation ne s''annule pas : établissez un nouvel avenant de mouvement.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.numero INTO v_numero_posterieur FROM app.avenants_flotte a WHERE a.annule_avenant_id = p_avenant;
  IF FOUND THEN
    RAISE EXCEPTION 'L''avenant n° % est déjà annulé (avenant n° %).', v_avenant.numero, v_numero_posterieur
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_contrat.statut <> 'en_vigueur' THEN
    RAISE EXCEPTION 'Le contrat n''est plus en vigueur : son avenant ne peut plus être annulé.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_motif IS NULL OR char_length(btrim(p_motif)) < 5 OR char_length(p_motif) > 500 THEN
    RAISE EXCEPTION 'Indiquez le motif de l''annulation (5 à 500 caractères).' USING ERRCODE = 'check_violation';
  END IF;

  -- Les avenants s'annulent du plus récent au plus ancien, véhicule par véhicule
  SELECT max(a.numero) INTO v_numero_posterieur
  FROM app.avenants_flotte a
  JOIN app.avenants_flotte_lignes l ON l.avenant_id = a.id
  WHERE a.contrat_id = v_avenant.contrat_id AND a.numero > v_avenant.numero AND a.nature = 'mouvement'
    AND NOT EXISTS (SELECT 1 FROM app.avenants_flotte x WHERE x.annule_avenant_id = a.id)
    AND l.vehicule_id IN (SELECT o.vehicule_id FROM app.avenants_flotte_lignes o WHERE o.avenant_id = p_avenant);
  IF v_numero_posterieur IS NOT NULL THEN
    RAISE EXCEPTION 'L''avenant n° % porte depuis sur les mêmes véhicules : annulez-le d''abord.', v_numero_posterieur
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(v.immatriculation || CASE WHEN cv.numero_attestation IS NOT NULL
                                              THEN ' (attestation ' || cv.numero_attestation || ' émise)'
                                              ELSE ' (sinistre déclaré)' END, ', ' ORDER BY v.immatriculation)
  INTO v_bloquant
  FROM app.contrats_vehicules cv
  JOIN app.vehicules v ON v.id = cv.vehicule_id
  WHERE cv.incorpore_par = p_avenant
    AND (cv.numero_attestation IS NOT NULL
         OR EXISTS (SELECT 1 FROM app.sinistres s WHERE s.contrat_id = cv.contrat_id AND s.vehicule_id = cv.vehicule_id
                      AND s.survenu_le >= cv.ajoute_le));
  IF v_bloquant IS NOT NULL THEN
    RAISE EXCEPTION 'Annulation impossible, le véhicule a déjà servi : %. Faites plutôt un avenant de retrait.', v_bloquant
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('vehiculeId', l.vehicule_id, 'immatriculation', v.immatriculation,
                                      'mouvement', l.mouvement, 'primeVehicule', l.prime_vehicule, 'montant', -l.montant)
                   ORDER BY v.immatriculation)
  INTO v_lignes
  FROM app.avenants_flotte_lignes l JOIN app.vehicules v ON v.id = l.vehicule_id
  WHERE l.avenant_id = p_avenant;

  IF p_enregistrer THEN
    v_numero := app.numero_suivant('avenants');
    INSERT INTO app.avenants_flotte (numero, contrat_id, nature, date_effet, montant, annule_avenant_id, motif)
    VALUES (v_numero, v_avenant.contrat_id, 'annulation', v_avenant.date_effet, -v_avenant.montant, p_avenant, btrim(p_motif))
    RETURNING id INTO v_id;
    INSERT INTO app.avenants_flotte_lignes (avenant_id, vehicule_id, mouvement, prime_vehicule, jours_restants, jours_periode, montant)
    SELECT v_id, l.vehicule_id, l.mouvement, l.prime_vehicule, l.jours_restants, l.jours_periode, -l.montant
    FROM app.avenants_flotte_lignes l WHERE l.avenant_id = p_avenant;

    -- Effets défaits : les véhicules incorporés n'ont jamais été couverts, les véhicules retirés le restent
    DELETE FROM app.contrats_vehicules WHERE incorpore_par = p_avenant;
    UPDATE app.contrats_vehicules SET retire_le = NULL, retire_par = NULL WHERE retire_par = p_avenant;
    UPDATE app.contrats SET primes_avenants = primes_avenants - v_avenant.montant WHERE id = v_avenant.contrat_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'nature', 'annulation', 'dateEffet', v_avenant.date_effet,
                            'annuleNumero', v_avenant.numero, 'montant', -v_avenant.montant, 'lignes', v_lignes);
END
$$;
REVOKE ALL ON FUNCTION app.annuler_avenant_flotte(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.annuler_avenant_flotte(uuid, text, boolean) TO dbs_api;

CREATE FUNCTION app.interdire_modification_avenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Un avenant ne se modifie pas : % interdit. Faites un avenant d''annulation.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_avenant();
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.avenants_flotte_lignes
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_avenant();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.avenants_flotte
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.avenants_flotte_lignes
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Avenants avec leur règlement : les encaissements au-delà de la prime de départ règlent les avenants dans
-- l'ordre (ristournes et annulations comprises). Un véhicule incorporé n'est couvert qu'une fois sa prime
-- d'avenant réglée.
CREATE VIEW app.v_avenants_flotte WITH (security_invoker = true) AS
SELECT a.id, a.numero, a.contrat_id, a.nature, a.date_effet, a.montant, a.motif, a.cree_le, a.cree_par,
       a.annule_avenant_id, o.numero AS annule_numero, x.id AS annule_par_id, x.numero AS annule_par_numero,
       CASE WHEN a.nature = 'mouvement' AND a.montant > 0 AND x.id IS NULL THEN
         k.prime_ttc + sum(a.montant) OVER (PARTITION BY a.contrat_id ORDER BY a.numero) <= s.total_encaisse
       END AS regle
FROM app.avenants_flotte a
JOIN app.contrats k ON k.id = a.contrat_id
JOIN app.v_soldes_contrats s ON s.contrat_id = a.contrat_id
LEFT JOIN app.avenants_flotte o ON o.id = a.annule_avenant_id
LEFT JOIN app.avenants_flotte x ON x.annule_avenant_id = a.id;

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
ALTER TABLE app.avenants_flotte_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.annonces_documents ENABLE ROW LEVEL SECURITY;

-- Avenants : vus de qui voit le contrat ; établis seulement par app.avenant_flotte et
-- app.annuler_avenant_flotte (gérant et chargés de clientèle), jamais écrits directement
CREATE POLICY avenants_flotte_lecture ON app.avenants_flotte FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
CREATE POLICY avenants_flotte_lignes_lecture ON app.avenants_flotte_lignes FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.avenants_flotte a WHERE a.id = avenant_id));

-- Composition de départ : un véhicule rattaché par erreur se détache tant que le contrat n'est pas payé
CREATE POLICY contrats_vehicules_suppression ON app.contrats_vehicules FOR DELETE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT DELETE ON app.contrats_vehicules TO dbs_api;

-- Annonces : lues avec les relances ; écrites seulement par le planificateur
CREATE POLICY annonces_documents_lecture ON app.annonces_documents FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));

GRANT SELECT ON app.avenants_flotte, app.avenants_flotte_lignes, app.annonces_documents, app.v_avenants_flotte TO dbs_api;
