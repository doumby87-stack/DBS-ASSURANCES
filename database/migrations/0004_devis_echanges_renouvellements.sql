-- =====================================================================
-- 0004 · Devis, historique des échanges, renouvellement des contrats
--
-- Pour la fiche client et le tableau des échéances du back-office (tâche 4) :
--   · app.devis : demandes et cotations, jusqu'à l'acceptation ou au refus (motif obligatoire) ;
--   · app.echanges : appels, messages, visites et notes, en ajout seul ;
--   · app.contrats.renouvelle_id : le contrat qui en renouvelle un autre. Un contrat renouvelé
--     sort du tableau des échéances.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Renouvellement des contrats
-- ---------------------------------------------------------------------
ALTER TABLE app.contrats ADD COLUMN renouvelle_id uuid REFERENCES app.contrats (id);
ALTER TABLE app.contrats ADD CONSTRAINT contrats_renouvellement_unique UNIQUE (renouvelle_id);
ALTER TABLE app.contrats ADD CONSTRAINT contrats_renouvellement_pas_soi CHECK (renouvelle_id IS NULL OR renouvelle_id <> id);

-- Un renouvellement concerne le même client, et commence au plus tôt quand l'ancien contrat a commencé
CREATE FUNCTION app.controler_renouvellement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ancien app.contrats;
BEGIN
  IF NEW.renouvelle_id IS NOT NULL THEN
    SELECT * INTO v_ancien FROM app.contrats WHERE id = NEW.renouvelle_id;
    IF NOT FOUND OR v_ancien.client_id <> NEW.client_id OR NEW.date_effet < v_ancien.date_effet THEN
      RAISE EXCEPTION 'Renouvellement invalide : il doit concerner le même client et commencer après le contrat renouvelé'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER b_renouvellement BEFORE INSERT ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION app.controler_renouvellement();

-- Le tableau des échéances ne montre plus un contrat déjà renouvelé (mêmes colonnes qu'avant)
CREATE OR REPLACE VIEW app.v_echeances_contrats WITH (security_invoker = true) AS
SELECT c.id AS contrat_id, c.client_id, c.numero_police, c.branche, c.date_echeance,
       c.date_echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours_restants
FROM app.contrats c
WHERE c.statut = 'en_vigueur'
  AND c.date_echeance <= (now() AT TIME ZONE 'Africa/Abidjan')::date + 60
  AND NOT EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = c.id);

-- ---------------------------------------------------------------------
-- Devis
-- ---------------------------------------------------------------------
CREATE TYPE app.statut_devis AS ENUM ('nouveau', 'en_cotation', 'envoye', 'accepte', 'refuse', 'sans_suite');
CREATE TYPE app.origine_devis AS ENUM ('agence', 'telephone', 'whatsapp', 'email', 'site', 'apporteur');

CREATE TABLE app.devis (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES app.clients (id),
  branche         app.branche NOT NULL,
  origine         app.origine_devis NOT NULL DEFAULT 'agence',
  description     text,
  prime_proposee  bigint,
  statut          app.statut_devis NOT NULL DEFAULT 'nouveau',
  motif_refus     text,
  -- Contrat signé à partir de ce devis
  contrat_id      uuid REFERENCES app.contrats (id),
  cree_le         timestamptz NOT NULL,
  cree_par        uuid NOT NULL REFERENCES app.utilisateurs (id),
  modifie_le      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devis_description_longueur CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT devis_prime_positive CHECK (prime_proposee IS NULL OR prime_proposee > 0),
  -- Savoir pourquoi un devis est perdu, c'est savoir quoi améliorer
  CONSTRAINT devis_motif_refus CHECK (statut <> 'refuse' OR char_length(btrim(coalesce(motif_refus, ''))) >= 3),
  CONSTRAINT devis_motif_longueur CHECK (motif_refus IS NULL OR char_length(motif_refus) <= 500)
);
CREATE INDEX devis_client_idx ON app.devis (client_id);
CREATE INDEX devis_en_cours_idx ON app.devis (statut, modifie_le) WHERE statut IN ('nouveau', 'en_cotation', 'envoye');

CREATE FUNCTION app.horodater_modification() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.devis
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_modification BEFORE UPDATE ON app.devis
  FOR EACH ROW EXECUTE FUNCTION app.horodater_modification();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.devis
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Historique des échanges avec le client (en ajout seul : une erreur se corrige par une nouvelle note)
-- ---------------------------------------------------------------------
CREATE TYPE app.canal_echange AS ENUM ('appel', 'whatsapp', 'email', 'sms', 'visite', 'note');

CREATE TABLE app.echanges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES app.clients (id),
  canal       app.canal_echange NOT NULL,
  resume      text NOT NULL,
  survenu_le  timestamptz NOT NULL DEFAULT now(),
  cree_le     timestamptz NOT NULL,
  cree_par    uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT echanges_resume_longueur CHECK (char_length(btrim(resume)) BETWEEN 2 AND 2000)
);
CREATE INDEX echanges_client_idx ON app.echanges (client_id, survenu_le DESC);

CREATE FUNCTION app.controler_echange() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.survenu_le > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Date d''échange dans le futur' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.echanges
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_controle BEFORE INSERT ON app.echanges
  FOR EACH ROW EXECUTE FUNCTION app.controler_echange();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.echanges
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.devis ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.echanges ENABLE ROW LEVEL SECURITY;

-- Devis : l'affaire des commerciaux et des chargés de clientèle ; l'apporteur suit les devis de ses clients
CREATE POLICY devis_lecture ON app.devis FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur'))
         OR ((SELECT securite.a_le_role('apporteur')) AND securite.client_visible(client_id)));
CREATE POLICY devis_creation ON app.devis FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial'))
              OR ((SELECT securite.a_le_role('apporteur')) AND securite.client_visible(client_id)));
CREATE POLICY devis_modification ON app.devis FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));

-- Échanges : toute personne qui voit le client peut noter un échange
CREATE POLICY echanges_lecture ON app.echanges FOR SELECT TO dbs_api
  USING (securite.client_visible(client_id));
CREATE POLICY echanges_creation ON app.echanges FOR INSERT TO dbs_api
  WITH CHECK (securite.client_visible(client_id) AND (SELECT securite.a_le_role(
    'gerant', 'charge_clientele', 'caissier', 'commercial', 'apporteur')));

GRANT SELECT, INSERT ON app.devis, app.echanges TO dbs_api;
GRANT UPDATE (branche, description, prime_proposee, statut, motif_refus, contrat_id) ON app.devis TO dbs_api;
