-- =====================================================================
-- 0005 · Caisse, reçus, clôtures, bordereaux de reversement, commissions
--
-- Pour la tâche 5 :
--   · reçus et bordereaux numérotés sans trou : le numéro est attribué dans la transaction,
--     un paiement refusé ne consomme pas de numéro ;
--   · un encaissement ne dépasse jamais le reste à payer ; le contrat entre en vigueur dès que la prime
--     est entièrement payée, et en sort si une contre-passation la rend incomplète (Code CIMA, art. 13) ;
--   · clôture de caisse : espèces comptées (billetage) contre espèces attendues, calculées par la base ;
--     un écart se justifie, un gérant vise ; une période clôturée ne reçoit plus d'encaissement ;
--   · un bordereau pas encore validé peut être annulé : ses encaissements redeviennent à reverser ;
--   · commissions : prime nette des contrats, taux par branche datés, relevés de la compagnie
--     et rapprochement mensuel.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Compteurs sans trou (reçus, bordereaux, clôtures)
-- Inaccessibles à l'application : seuls les déclencheurs de la base attribuent les numéros.
-- La ligne du compteur reste verrouillée jusqu'à la fin de la transaction : une annulation
-- rend le numéro, et deux caisses ne reçoivent jamais le même.
-- ---------------------------------------------------------------------
CREATE TABLE app.compteurs (
  nom     text PRIMARY KEY,
  valeur  bigint NOT NULL,
  CONSTRAINT compteurs_valeur CHECK (valeur >= 0)
);
ALTER TABLE app.compteurs ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.numero_suivant(p_nom text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v bigint;
BEGIN
  INSERT INTO app.compteurs AS c (nom, valeur) VALUES (p_nom, 1)
  ON CONFLICT (nom) DO UPDATE SET valeur = c.valeur + 1
  RETURNING c.valeur INTO v;
  RETURN v;
END
$$;

-- ---------------------------------------------------------------------
-- Reçus : numéro continu attribué par la base (une séquence laisserait des trous à chaque refus)
-- ---------------------------------------------------------------------
ALTER TABLE app.encaissements ALTER COLUMN numero_recu DROP IDENTITY;
INSERT INTO app.compteurs (nom, valeur)
SELECT 'recus', coalesce(max(numero_recu), 0) FROM app.encaissements;

CREATE FUNCTION app.numeroter_recu() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.numero_recu := app.numero_suivant('recus');  -- toute valeur fournie par l'application est ignorée
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- Clôtures de caisse
-- Chaque personne qui encaisse clôture sa propre caisse : la base calcule ce qui aurait dû être
-- encaissé depuis la clôture précédente, la personne déclare les espèces qu'elle a comptées.
-- ---------------------------------------------------------------------
CREATE TABLE app.clotures_caisse (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                bigint NOT NULL,
  caissier_id           uuid NOT NULL REFERENCES app.utilisateurs (id),
  -- Période couverte : après la clôture précédente (NULL pour la première), jusqu'à « fin » incluse
  debut                 timestamptz,
  fin                   timestamptz NOT NULL,
  -- Calculés par la base, jamais fournis par l'application
  nombre_encaissements  integer NOT NULL,
  especes_attendues     bigint NOT NULL,
  total_cheques         bigint NOT NULL,
  total_mobile_money    bigint NOT NULL,
  total_virements       bigint NOT NULL,
  -- Déclarés par la personne qui clôture
  especes_comptees      bigint NOT NULL,
  billetage             jsonb,
  ecart                 bigint GENERATED ALWAYS AS (especes_comptees - especes_attendues) STORED,
  commentaire           text,
  -- Visa d'un gérant, jamais celui de la personne qui clôture
  visee_le              timestamptz,
  visee_par             uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT clotures_numero_unique UNIQUE (numero),
  CONSTRAINT clotures_especes_comptees CHECK (especes_comptees >= 0),
  CONSTRAINT clotures_ecart_justifie CHECK (
    especes_comptees = especes_attendues OR char_length(btrim(coalesce(commentaire, ''))) >= 5),
  CONSTRAINT clotures_commentaire_longueur CHECK (commentaire IS NULL OR char_length(commentaire) <= 1000),
  CONSTRAINT clotures_visa_complet CHECK ((visee_le IS NULL) = (visee_par IS NULL)),
  CONSTRAINT clotures_quatre_yeux CHECK (visee_par IS NULL OR visee_par <> caissier_id)
);
CREATE INDEX clotures_caissier_idx ON app.clotures_caisse (caissier_id, fin DESC);

-- Coupures en circulation (BCEAO) : billets de 10 000 à 500, pièces de 500 à 1. Billets et pièces
-- de 500 F se comptent ensemble.
CREATE FUNCTION app.total_billetage(p_billetage jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  r record;
  v_total bigint := 0;
BEGIN
  IF jsonb_typeof(p_billetage) <> 'object' THEN
    RAISE EXCEPTION 'Billetage invalide' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT key, value FROM jsonb_each(p_billetage) LOOP
    IF r.key NOT IN ('10000', '5000', '2000', '1000', '500', '250', '200', '100', '50', '25', '10', '5', '1')
       OR jsonb_typeof(r.value) <> 'number'
       OR (r.value)::numeric <> trunc((r.value)::numeric)
       OR (r.value)::numeric NOT BETWEEN 0 AND 1000000 THEN
      RAISE EXCEPTION 'Billetage invalide : coupure « % » ou quantité incorrecte', r.key USING ERRCODE = 'check_violation';
    END IF;
    v_total := v_total + r.key::bigint * (r.value)::numeric::bigint;
  END LOOP;
  RETURN v_total;
END
$$;

-- Verrou de la caisse d'une personne : une clôture et un encaissement de la même caisse
-- ne se croisent jamais (l'encaissement attend la fin de la clôture, puis voit sa date de fin).
CREATE FUNCTION app.verrouiller_caisse(p_utilisateur uuid) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$ SELECT pg_advisory_xact_lock(hashtextextended('caisse:' || p_utilisateur::text, 0)) $$;

-- Mouvements de chaque caisse. Une contre-passation compte dans la caisse de la personne qui avait
-- encaissé : le gérant qui annule une erreur du caissier ne crée d'écart ni dans sa caisse ni dans l'autre.
CREATE VIEW app.v_mouvements_caisse WITH (security_invoker = true) AS
SELECT e.id AS encaissement_id, e.numero_recu, e.contrat_id, e.montant, e.mode, e.reference_externe,
       e.encaisse_le, e.encaisse_par, e.annule_encaissement_id,
       coalesce(o.encaisse_par, e.encaisse_par) AS caissier_id
FROM app.encaissements e
LEFT JOIN app.encaissements o ON o.id = e.annule_encaissement_id;
GRANT SELECT ON app.v_mouvements_caisse TO dbs_api;

CREATE FUNCTION app.controler_cloture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_billetage bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Seul le visa s'ajoute, une seule fois, attribué à l'utilisateur authentifié à l'heure du serveur.
    -- (L'écart, colonne calculée, n'est pas encore recalculé à ce stade : il est exclu de la comparaison.)
    IF (to_jsonb(NEW) - 'visee_le' - 'visee_par' - 'ecart') IS DISTINCT FROM (to_jsonb(OLD) - 'visee_le' - 'visee_par' - 'ecart') THEN
      RAISE EXCEPTION 'Une clôture de caisse ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.visee_le IS NOT NULL THEN
      RAISE EXCEPTION 'Clôture déjà visée : le visa ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.visee_le IS NOT NULL THEN
      NEW.visee_par := securite.utilisateur_courant();
      NEW.visee_le := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.billetage IS NOT NULL THEN
    v_billetage := app.total_billetage(NEW.billetage);
    IF v_billetage <> NEW.especes_comptees THEN
      RAISE EXCEPTION 'Le billetage (% F CFA) ne correspond pas aux espèces comptées (% F CFA)',
        v_billetage, NEW.especes_comptees USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM app.verrouiller_caisse(NEW.caissier_id);
  SELECT max(c.fin) INTO NEW.debut FROM app.clotures_caisse c WHERE c.caissier_id = NEW.caissier_id;
  NEW.fin := now();
  NEW.numero := app.numero_suivant('clotures');
  NEW.visee_le := NULL;
  NEW.visee_par := NULL;

  SELECT count(*)::integer,
         coalesce(sum(e.montant) FILTER (WHERE e.mode = 'especes'), 0)::bigint,
         coalesce(sum(e.montant) FILTER (WHERE e.mode = 'cheque'), 0)::bigint,
         coalesce(sum(e.montant) FILTER (WHERE e.mode = 'mobile_money'), 0)::bigint,
         coalesce(sum(e.montant) FILTER (WHERE e.mode = 'virement'), 0)::bigint
    INTO NEW.nombre_encaissements, NEW.especes_attendues, NEW.total_cheques, NEW.total_mobile_money, NEW.total_virements
  FROM app.v_mouvements_caisse e
  WHERE e.caissier_id = NEW.caissier_id
    AND (NEW.debut IS NULL OR e.encaisse_le > NEW.debut)
    AND e.encaisse_le <= NEW.fin;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- Contrôles supplémentaires de chaque encaissement
-- ---------------------------------------------------------------------
CREATE FUNCTION app.controler_caisse() RETURNS trigger
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
  SELECT k.prime_ttc INTO v_prime FROM app.contrats k WHERE k.id = NEW.contrat_id FOR UPDATE;
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

-- Code CIMA, art. 13 : la garantie suit le paiement. Prime entièrement payée : le contrat entre en vigueur.
-- Contre-passation qui rend la prime incomplète : il revient « en attente de paiement ».
CREATE FUNCTION app.suivre_paiement_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_statut app.statut_contrat;
  v_prime bigint;
  v_total bigint;
BEGIN
  SELECT k.statut, k.prime_ttc INTO v_statut, v_prime FROM app.contrats k WHERE k.id = NEW.contrat_id;
  v_total := app.total_encaisse(NEW.contrat_id);
  IF v_statut = 'en_attente_paiement' AND v_total >= v_prime THEN
    UPDATE app.contrats SET statut = 'en_vigueur' WHERE id = NEW.contrat_id;
  ELSIF v_statut = 'en_vigueur' AND v_total < v_prime THEN
    UPDATE app.contrats SET statut = 'en_attente_paiement' WHERE id = NEW.contrat_id;
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------
-- Bordereaux : numéro attribué par la base, annulation avant validation
-- ---------------------------------------------------------------------
ALTER TABLE app.reversements
  ADD COLUMN annule_le timestamptz,
  ADD COLUMN annule_par uuid REFERENCES app.utilisateurs (id),
  ADD COLUMN motif_annulation text,
  ADD CONSTRAINT reversements_annulation_complete CHECK (
    (annule_le IS NULL) = (annule_par IS NULL)
    AND (annule_le IS NULL OR char_length(btrim(coalesce(motif_annulation, ''))) >= 5)),
  ADD CONSTRAINT reversements_annulation_motif_longueur CHECK (motif_annulation IS NULL OR char_length(motif_annulation) <= 500),
  ADD CONSTRAINT reversements_annulation_avant_validation CHECK (annule_le IS NULL OR valide_le IS NULL);

CREATE FUNCTION app.numeroter_bordereau() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_annee text := to_char(now() AT TIME ZONE 'Africa/Abidjan', 'YYYY');
BEGIN
  -- BR-2026-0001, BR-2026-0002… ; la numérotation repart chaque année
  NEW.numero_bordereau := 'BR-' || v_annee || '-' || lpad(app.numero_suivant('bordereaux-' || v_annee)::text, 4, '0');
  RETURN NEW;
END
$$;

-- Remplace la version de 0002 : ajoute l'annulation (réservée à app.annuler_bordereau)
CREATE OR REPLACE FUNCTION app.controler_reversement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.valide_le := NULL;
    NEW.valide_par := NULL;
    NEW.verse_le := NULL;
    NEW.annule_le := NULL;
    NEW.annule_par := NULL;
    NEW.motif_annulation := NULL;
    RETURN NEW;
  END IF;

  IF OLD.verse_le IS NOT NULL THEN
    RAISE EXCEPTION 'Bordereau déjà versé à la compagnie : il ne se modifie plus'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.annule_le IS NOT NULL THEN
    RAISE EXCEPTION 'Bordereau annulé : il ne se modifie plus' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.numero_bordereau, NEW.periode_debut, NEW.periode_fin, NEW.prepare_le, NEW.prepare_par)
     IS DISTINCT FROM (OLD.numero_bordereau, OLD.periode_debut, OLD.periode_fin, OLD.prepare_le, OLD.prepare_par) THEN
    RAISE EXCEPTION 'Le numéro, la période et l''auteur d''un bordereau ne se modifient pas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.annule_le IS NOT NULL THEN
    -- L'annulation est attribuée à l'utilisateur authentifié, à l'heure du serveur
    NEW.annule_par := securite.utilisateur_courant();
    NEW.annule_le := now();
  END IF;

  IF OLD.valide_le IS NULL AND NEW.valide_le IS NOT NULL THEN
    NEW.valide_par := securite.utilisateur_courant();
    NEW.valide_le := now();
    IF NOT EXISTS (SELECT 1 FROM app.encaissements e WHERE e.reversement_id = NEW.id) THEN
      RAISE EXCEPTION 'Bordereau vide : rattachez-y des encaissements avant de le valider'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.valide_le, NEW.valide_par) IS DISTINCT FROM (OLD.valide_le, OLD.valide_par) THEN
    RAISE EXCEPTION 'Une validation ne se modifie pas et ne s''annule pas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- Remplace la version de 0002 : un encaissement quitte un bordereau seulement si celui-ci est annulé
CREATE OR REPLACE FUNCTION app.proteger_encaissement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_bordereau app.reversements;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un encaissement ne se supprime pas : enregistrez une contre-passation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'reversement_id') IS DISTINCT FROM (to_jsonb(OLD) - 'reversement_id') THEN
    RAISE EXCEPTION 'Un encaissement ne se modifie pas : enregistrez une contre-passation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.reversement_id IS NOT NULL THEN
    SELECT * INTO v_bordereau FROM app.reversements r WHERE r.id = OLD.reversement_id;
    IF NEW.reversement_id IS NULL AND v_bordereau.annule_le IS NOT NULL THEN
      RETURN NEW;  -- bordereau annulé : l'encaissement redevient à reverser
    END IF;
    RAISE EXCEPTION 'Un encaissement ne se modifie pas : enregistrez une contre-passation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.reversement_id IS NOT NULL THEN
    SELECT * INTO v_bordereau FROM app.reversements r WHERE r.id = NEW.reversement_id FOR SHARE;
    IF v_bordereau.valide_le IS NOT NULL THEN
      RAISE EXCEPTION 'Bordereau déjà validé : il ne peut plus recevoir d''encaissement'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_bordereau.annule_le IS NOT NULL THEN
      RAISE EXCEPTION 'Bordereau annulé : il ne peut plus recevoir d''encaissement'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Annule un bordereau pas encore validé ; ses encaissements redeviennent à reverser.
-- Réservé à un gérant ou à la personne qui l'a préparé.
CREATE FUNCTION app.annuler_bordereau(p_reversement uuid, p_motif text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v app.reversements;
BEGIN
  SELECT * INTO v FROM app.reversements r WHERE r.id = p_reversement FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bordereau introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (securite.a_le_role('gerant')
          OR (securite.a_le_role('caissier') AND v.prepare_par = securite.utilisateur_courant())) THEN
    RAISE EXCEPTION 'Seul un gérant, ou la personne qui l''a préparé, annule un bordereau'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v.valide_le IS NOT NULL THEN
    RAISE EXCEPTION 'Bordereau déjà validé : il ne s''annule plus' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.reversements SET annule_le = now(), motif_annulation = btrim(p_motif) WHERE id = p_reversement;
  UPDATE app.encaissements SET reversement_id = NULL WHERE reversement_id = p_reversement;
END
$$;
GRANT EXECUTE ON FUNCTION app.annuler_bordereau(uuid, text) TO dbs_api;

-- ---------------------------------------------------------------------
-- Commissions
-- ---------------------------------------------------------------------
-- Prime nette (hors taxes et accessoires) : base de calcul de la commission
ALTER TABLE app.contrats ADD COLUMN prime_nette bigint;
ALTER TABLE app.contrats ADD CONSTRAINT contrats_prime_nette CHECK (prime_nette IS NULL OR (prime_nette > 0 AND prime_nette <= prime_ttc));
GRANT UPDATE (prime_nette) ON app.contrats TO dbs_api;

-- Taux de commission par branche, applicables à partir d'une date : un nouveau taux s'ajoute,
-- l'ancien reste pour le calcul des mois passés
CREATE TABLE app.taux_commission (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branche        app.branche NOT NULL,
  taux           numeric(5, 2) NOT NULL,
  applicable_du  date NOT NULL,
  cree_le        timestamptz NOT NULL,
  cree_par       uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT taux_commission_unique UNIQUE (branche, applicable_du),
  CONSTRAINT taux_commission_bornes CHECK (taux >= 0 AND taux <= 50)
);

-- Relevés de commissions envoyés par la compagnie, un par mois
CREATE TABLE app.releves_commissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mois             date NOT NULL,
  montant_declare  bigint NOT NULL,
  reference        text,
  commentaire      text,
  cree_le          timestamptz NOT NULL,
  cree_par         uuid NOT NULL REFERENCES app.utilisateurs (id),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releves_mois_unique UNIQUE (mois),
  CONSTRAINT releves_mois_premier_jour CHECK (mois = date_trunc('month', mois)::date),
  CONSTRAINT releves_montant CHECK (montant_declare >= 0),
  CONSTRAINT releves_reference_longueur CHECK (reference IS NULL OR char_length(reference) <= 80),
  CONSTRAINT releves_commentaire_longueur CHECK (commentaire IS NULL OR char_length(commentaire) <= 1000)
);

-- ---------------------------------------------------------------------
-- Déclencheurs (ordre alphabétique : a_ auteur, b_ contrôles, c_/d_ caisse et numéro, z_ journal)
-- ---------------------------------------------------------------------
CREATE TRIGGER c_caisse BEFORE INSERT ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION app.controler_caisse();
CREATE TRIGGER d_numero BEFORE INSERT ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION app.numeroter_recu();
CREATE TRIGGER e_statut_contrat AFTER INSERT ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION app.suivre_paiement_contrat();

CREATE TRIGGER c_numero BEFORE INSERT ON app.reversements
  FOR EACH ROW EXECUTE FUNCTION app.numeroter_bordereau();

CREATE TRIGGER a_auteur BEFORE INSERT ON app.clotures_caisse
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('caissier_id');
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.clotures_caisse
  FOR EACH ROW EXECUTE FUNCTION app.controler_cloture();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.clotures_caisse
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

CREATE TRIGGER a_auteur BEFORE INSERT ON app.taux_commission
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.taux_commission
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

CREATE TRIGGER a_auteur BEFORE INSERT ON app.releves_commissions
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_modification BEFORE UPDATE ON app.releves_commissions
  FOR EACH ROW EXECUTE FUNCTION app.horodater_modification();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.releves_commissions
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.clotures_caisse ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.taux_commission ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.releves_commissions ENABLE ROW LEVEL SECURITY;

-- Clôtures : chacun clôture et voit sa caisse ; le gérant et l'auditeur voient toutes les caisses
CREATE POLICY clotures_lecture ON app.clotures_caisse FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur'))
         OR ((SELECT securite.a_le_role('caissier')) AND caissier_id = (SELECT securite.utilisateur_courant())));
CREATE POLICY clotures_creation ON app.clotures_caisse FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'caissier')));
CREATE POLICY clotures_visa ON app.clotures_caisse FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));

-- Commissions : l'affaire du gérant ; l'auditeur lit
CREATE POLICY taux_commission_lecture ON app.taux_commission FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur')));
CREATE POLICY taux_commission_creation ON app.taux_commission FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
CREATE POLICY taux_commission_modification ON app.taux_commission FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));

CREATE POLICY releves_lecture ON app.releves_commissions FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur')));
CREATE POLICY releves_creation ON app.releves_commissions FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
CREATE POLICY releves_modification ON app.releves_commissions FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));

GRANT SELECT, INSERT ON app.clotures_caisse, app.taux_commission, app.releves_commissions TO dbs_api;
GRANT UPDATE (visee_le) ON app.clotures_caisse TO dbs_api;
GRANT UPDATE (taux) ON app.taux_commission TO dbs_api;
GRANT UPDATE (montant_declare, reference, commentaire) ON app.releves_commissions TO dbs_api;

-- ---------------------------------------------------------------------
-- Rapprochement mensuel des commissions
-- Commission attendue de chaque encaissement : montant × (prime nette ÷ prime TTC) × taux de la branche
-- à la date de l'encaissement, arrondie vers zéro (une contre-passation annule exactement son encaissement).
-- Un encaissement sans prime nette ou sans taux est compté à part : le rapprochement est alors incomplet.
-- ---------------------------------------------------------------------
CREATE VIEW app.v_commissions_mensuelles WITH (security_invoker = true) AS
WITH lignes AS (
  SELECT date_trunc('month', e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date AS mois,
         e.montant, k.prime_ttc, k.prime_nette, t.taux
  FROM app.encaissements e
  JOIN app.contrats k ON k.id = e.contrat_id
  LEFT JOIN LATERAL (
    SELECT tc.taux FROM app.taux_commission tc
    WHERE tc.branche = k.branche AND tc.applicable_du <= (e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date
    ORDER BY tc.applicable_du DESC LIMIT 1
  ) t ON true
), par_mois AS (
  SELECT mois,
         sum(montant)::bigint AS primes_encaissees,
         coalesce(sum(trunc(montant::numeric * prime_nette / prime_ttc * taux / 100))
                    FILTER (WHERE prime_nette IS NOT NULL AND taux IS NOT NULL), 0)::bigint AS commission_attendue,
         count(*) FILTER (WHERE prime_nette IS NULL OR taux IS NULL)::integer AS encaissements_incomplets
  FROM lignes
  GROUP BY mois
)
SELECT coalesce(p.mois, r.mois) AS mois,
       coalesce(p.primes_encaissees, 0)::bigint AS primes_encaissees,
       coalesce(p.commission_attendue, 0)::bigint AS commission_attendue,
       coalesce(p.encaissements_incomplets, 0) AS encaissements_incomplets,
       r.id AS releve_id, r.montant_declare, r.reference,
       (r.montant_declare - coalesce(p.commission_attendue, 0))::bigint AS ecart
FROM par_mois p
FULL JOIN app.releves_commissions r ON r.mois = p.mois;

GRANT SELECT ON app.v_commissions_mensuelles TO dbs_api;
