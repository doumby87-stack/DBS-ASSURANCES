-- =====================================================================
-- 0015 · Outils du site : rappel d'échéance gratuit, assistant « appel d'offres », prise de rendez-vous
--
-- Pour la tâche 13 :
--   · les demandes du site ont désormais une nature : devis (tâche 7), rappel d'échéance ou appel d'offres.
--     Elles gardent la même porte d'entrée publique (une fonction par nature), les mêmes limites par
--     adresse et par jour, la même purge à 12 mois et le même traitement (devis ou sans suite) ;
--   · un rappel d'échéance attend son heure : il n'est « à traiter » qu'un mois avant l'échéance donnée
--     par le visiteur (app.demandes_site.a_traiter_le), et sa purge part de cette échéance ;
--   · un appel d'offres garde la date limite de dépôt et ce que le marché demande (app.demandes_site.appel_offres) ;
--   · app.rendez_vous : l'agenda de l'agence. Le site demande un jour et une demi-journée ; l'agence
--     confirme l'heure, avec qui et comment, puis note si le rendez-vous a eu lieu. Le personnel fixe aussi
--     des rendez-vous lui-même. Tout passe par des fonctions de la base, qui datent et signent chaque étape.
-- Conception : docs/architecture/adr/0014-outils-du-site.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- Demandes du site : nature, échéance d'un rappel, appel d'offres
-- ---------------------------------------------------------------------
CREATE TYPE app.nature_demande_site AS ENUM ('devis', 'rappel_echeance', 'appel_offres');

-- Un rappel d'échéance devient « à traiter » ce nombre de jours avant l'échéance
CREATE FUNCTION app.rappel_echeance_avance() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;

ALTER TABLE app.demandes_site
  ADD COLUMN nature app.nature_demande_site NOT NULL DEFAULT 'devis',
  -- Rappel : date d'échéance du contrat actuel du visiteur (chez n'importe quel assureur)
  ADD COLUMN echeance_actuelle date,
  -- Appel d'offres : date limite de dépôt des offres et description du marché (validée par l'API)
  ADD COLUMN date_limite_offre date,
  ADD COLUMN appel_offres jsonb,
  -- Jour à partir duquel l'agence traite la demande : le jour de réception, sauf pour un rappel
  ADD COLUMN a_traiter_le date;

-- Demandes déjà reçues : à traiter depuis leur réception. Le contrôle du traitement est suspendu le
-- temps de ce calcul, qui ne touche rien d'autre.
ALTER TABLE app.demandes_site DISABLE TRIGGER a_traitement;
UPDATE app.demandes_site SET a_traiter_le = (recue_le AT TIME ZONE 'Africa/Abidjan')::date;
ALTER TABLE app.demandes_site ENABLE TRIGGER a_traitement;
ALTER TABLE app.demandes_site
  ALTER COLUMN a_traiter_le SET DEFAULT app.aujourdhui(),
  ALTER COLUMN a_traiter_le SET NOT NULL,
  ADD CONSTRAINT demandes_site_rappel CHECK ((nature = 'rappel_echeance') = (echeance_actuelle IS NOT NULL)),
  ADD CONSTRAINT demandes_site_appel_offres CHECK (
    (nature = 'appel_offres') = (date_limite_offre IS NOT NULL AND appel_offres IS NOT NULL)),
  ADD CONSTRAINT demandes_site_appel_offres_forme CHECK (
    appel_offres IS NULL OR (jsonb_typeof(appel_offres) = 'object' AND octet_length(appel_offres::text) <= 4000)),
  ADD CONSTRAINT demandes_site_a_traiter CHECK (a_traiter_le >= (recue_le AT TIME ZONE 'Africa/Abidjan')::date);

DROP INDEX app.demandes_site_a_traiter_idx;
CREATE INDEX demandes_site_a_traiter_idx ON app.demandes_site (a_traiter_le, recue_le) WHERE statut = 'nouvelle';

-- Le texte libre de l'appel d'offres ne va pas au journal d'audit, comme les coordonnées du visiteur
DROP TRIGGER z_journal ON app.demandes_site;
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('nom', 'telephone', 'email', 'commune', 'besoin', 'empreinte_ip', 'appel_offres');

-- Ce que le visiteur a envoyé ne se modifie pas, nouvelles colonnes comprises
CREATE OR REPLACE FUNCTION app.controler_demande_site() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.numero <> OLD.numero OR NEW.branche <> OLD.branche OR NEW.profil <> OLD.profil OR NEW.nom <> OLD.nom
     OR NEW.telephone <> OLD.telephone OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.commune IS DISTINCT FROM OLD.commune OR NEW.besoin IS DISTINCT FROM OLD.besoin
     OR NEW.accord_traitement <> OLD.accord_traitement OR NEW.accord_whatsapp IS DISTINCT FROM OLD.accord_whatsapp
     OR NEW.empreinte_ip <> OLD.empreinte_ip OR NEW.recue_le <> OLD.recue_le
     OR NEW.nature <> OLD.nature OR NEW.echeance_actuelle IS DISTINCT FROM OLD.echeance_actuelle
     OR NEW.date_limite_offre IS DISTINCT FROM OLD.date_limite_offre OR NEW.appel_offres IS DISTINCT FROM OLD.appel_offres
     OR NEW.a_traiter_le <> OLD.a_traiter_le THEN
    RAISE EXCEPTION 'Une demande reçue par le site ne se modifie pas : seul son traitement s''enregistre'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.statut <> 'nouvelle' THEN
    RAISE EXCEPTION 'Cette demande a déjà été traitée.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut = 'nouvelle' THEN
    RAISE EXCEPTION 'Indiquez si la demande est convertie en devis ou classée sans suite.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut = 'convertie' AND NOT EXISTS (
       SELECT 1 FROM app.devis d WHERE d.id = NEW.devis_id AND d.client_id = NEW.client_id AND d.origine = 'site') THEN
    RAISE EXCEPTION 'Le devis doit concerner le client de la demande et venir du site.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.statut = 'sans_suite' THEN
    NEW.client_id := NULL;
    NEW.devis_id := NULL;
  END IF;
  NEW.traitee_le := now();
  NEW.traitee_par := securite.utilisateur_courant();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------
-- Rendez-vous
-- ---------------------------------------------------------------------
CREATE TYPE app.motif_rendez_vous AS ENUM ('devis', 'renouvellement', 'sinistre', 'appel_offres', 'flotte', 'autre');
-- À l'agence, au téléphone, ou chez le client (visite des locaux ou du chantier d'un professionnel)
CREATE TYPE app.mode_rendez_vous AS ENUM ('agence', 'telephone', 'chez_le_client');
CREATE TYPE app.creneau AS ENUM ('matin', 'apres_midi');
-- demande (site) → confirme → honore ou manque ; annule à tout moment avant
CREATE TYPE app.statut_rendez_vous AS ENUM ('demande', 'confirme', 'honore', 'manque', 'annule');

-- Un jour où l'agence reçoit : du lundi au vendredi, hors fêtes à date fixe (comme les délais des réclamations)
CREATE FUNCTION app.est_jour_ouvre(p_jour date) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT app.ajouter_jours_ouvres(p_jour - 1, 1) = p_jour $$;

-- Délai pour demander un rendez-vous depuis le site : à partir de demain, 60 jours au plus
CREATE FUNCTION app.rendez_vous_horizon_jours() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 60 $$;

CREATE TABLE app.rendez_vous (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numéro communiqué au visiteur, attribué par la base
  numero             bigint NOT NULL,
  origine            text NOT NULL,
  motif              app.motif_rendez_vous NOT NULL,
  mode               app.mode_rendez_vous NOT NULL,
  profil             app.type_client,
  nom                text NOT NULL,
  telephone          text NOT NULL,
  email              text,
  message            text,
  client_id          uuid REFERENCES app.clients (id),
  -- Demande du site : le jour et la demi-journée souhaités
  souhaite_le        date,
  creneau_souhaite   app.creneau,
  -- Rendez-vous fixé : l'heure, la durée et la personne de l'agence
  debut              timestamptz,
  duree_minutes      integer,
  avec               uuid REFERENCES app.utilisateurs (id),
  statut             app.statut_rendez_vous NOT NULL,
  motif_annulation   text,
  -- Demande du site : texte des cases cochées et empreinte de l'adresse IP, comme pour les demandes de devis
  accord_traitement  text,
  accord_whatsapp    text,
  empreinte_ip       bytea,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  cree_par           uuid REFERENCES app.utilisateurs (id),
  confirme_le        timestamptz,
  confirme_par       uuid REFERENCES app.utilisateurs (id),
  clos_le            timestamptz,
  clos_par           uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT rendez_vous_numero_unique UNIQUE (numero),
  CONSTRAINT rendez_vous_origine CHECK (origine IN ('site', 'agence')),
  CONSTRAINT rendez_vous_nom_longueur CHECK (char_length(btrim(nom)) BETWEEN 2 AND 160),
  CONSTRAINT rendez_vous_telephone_format CHECK (telephone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT rendez_vous_email_format CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254
                                                              AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')),
  CONSTRAINT rendez_vous_message_longueur CHECK (message IS NULL OR char_length(message) <= 1000),
  CONSTRAINT rendez_vous_site CHECK (origine <> 'site' OR (
    cree_par IS NULL AND souhaite_le IS NOT NULL AND creneau_souhaite IS NOT NULL AND profil IS NOT NULL
    AND char_length(accord_traitement) BETWEEN 10 AND 300
    AND (accord_whatsapp IS NULL OR char_length(accord_whatsapp) BETWEEN 10 AND 300)
    AND octet_length(empreinte_ip) = 32)),
  CONSTRAINT rendez_vous_agence CHECK (origine <> 'agence' OR (
    cree_par IS NOT NULL AND accord_traitement IS NULL AND accord_whatsapp IS NULL AND empreinte_ip IS NULL)),
  CONSTRAINT rendez_vous_demande CHECK (statut <> 'demande' OR (origine = 'site' AND debut IS NULL)),
  CONSTRAINT rendez_vous_fixe CHECK (statut NOT IN ('confirme', 'honore', 'manque') OR (
    debut IS NOT NULL AND duree_minutes IS NOT NULL AND avec IS NOT NULL AND confirme_le IS NOT NULL AND confirme_par IS NOT NULL)),
  CONSTRAINT rendez_vous_duree CHECK (duree_minutes IS NULL OR duree_minutes BETWEEN 10 AND 480),
  CONSTRAINT rendez_vous_annulation CHECK ((statut = 'annule') = (motif_annulation IS NOT NULL)),
  CONSTRAINT rendez_vous_annulation_longueur CHECK (motif_annulation IS NULL OR char_length(btrim(motif_annulation)) BETWEEN 3 AND 300),
  CONSTRAINT rendez_vous_cloture CHECK ((statut IN ('honore', 'manque', 'annule')) = (clos_le IS NOT NULL AND clos_par IS NOT NULL))
);
CREATE INDEX rendez_vous_agenda_idx ON app.rendez_vous (debut) WHERE statut = 'confirme';
CREATE INDEX rendez_vous_demandes_idx ON app.rendez_vous (souhaite_le) WHERE statut = 'demande';
CREATE INDEX rendez_vous_limite_idx ON app.rendez_vous (empreinte_ip, cree_le) WHERE empreinte_ip IS NOT NULL;
CREATE INDEX rendez_vous_client_idx ON app.rendez_vous (client_id) WHERE client_id IS NOT NULL;

-- Ce que la personne a demandé ne se modifie pas ; seules les fonctions ci-dessous font avancer le
-- rendez-vous, et rien ne se supprime hors de la purge.
CREATE FUNCTION app.controler_rendez_vous() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.purge_demandes_site', true) = 'oui' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Un rendez-vous ne se supprime pas : annulez-le' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF current_setting('app.traitement_rendez_vous', true) IS DISTINCT FROM 'oui' THEN
    RAISE EXCEPTION 'Un rendez-vous ne se modifie que par app.traiter_rendez_vous' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.numero <> OLD.numero OR NEW.origine <> OLD.origine OR NEW.motif <> OLD.motif
     OR NEW.profil IS DISTINCT FROM OLD.profil OR NEW.nom <> OLD.nom OR NEW.telephone <> OLD.telephone
     OR NEW.email IS DISTINCT FROM OLD.email OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.souhaite_le IS DISTINCT FROM OLD.souhaite_le OR NEW.creneau_souhaite IS DISTINCT FROM OLD.creneau_souhaite
     OR NEW.accord_traitement IS DISTINCT FROM OLD.accord_traitement OR NEW.accord_whatsapp IS DISTINCT FROM OLD.accord_whatsapp
     OR NEW.empreinte_ip IS DISTINCT FROM OLD.empreinte_ip OR NEW.cree_le <> OLD.cree_le OR NEW.cree_par IS DISTINCT FROM OLD.cree_par THEN
    RAISE EXCEPTION 'La demande de rendez-vous ne se modifie pas : seul son traitement s''enregistre' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_controle BEFORE UPDATE OR DELETE ON app.rendez_vous
  FOR EACH ROW EXECUTE FUNCTION app.controler_rendez_vous();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.rendez_vous
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('nom', 'telephone', 'email', 'message', 'empreinte_ip');

-- ---------------------------------------------------------------------
-- Limites communes aux demandes publiques : 5 par heure et par adresse, 300 par jour en tout, demandes
-- du site et rendez-vous confondus. Les envois sont traités un par un (verrou) pour des limites exactes.
-- ---------------------------------------------------------------------
CREATE FUNCTION app.controler_limites_site(p_empreinte_ip bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app.demandes_site'));
  IF (SELECT count(*) FROM app.demandes_site d WHERE d.empreinte_ip = p_empreinte_ip AND d.recue_le > now() - interval '1 hour')
     + (SELECT count(*) FROM app.rendez_vous r WHERE r.empreinte_ip = p_empreinte_ip AND r.cree_le > now() - interval '1 hour')
     >= app.demandes_site_par_heure_max() THEN
    RAISE EXCEPTION 'Trop de demandes envoyées depuis cette adresse'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demandes_site_limite_adresse';
  END IF;
  IF (SELECT count(*) FROM app.demandes_site d WHERE d.recue_le > now() - interval '24 hours')
     + (SELECT count(*) FROM app.rendez_vous r WHERE r.origine = 'site' AND r.cree_le > now() - interval '24 hours')
     >= app.demandes_site_par_jour_max() THEN
    RAISE EXCEPTION 'Nombre de demandes du jour atteint'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demandes_site_limite_jour';
  END IF;
END
$$;

-- Demande de devis (tâche 7) : même signature, limites désormais communes
CREATE OR REPLACE FUNCTION app.enregistrer_demande_site(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_piece_id uuid, p_piece_type text, p_piece_taille integer, p_piece_contenu bytea, p_piece_empreinte bytea)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_numero bigint;
BEGIN
  PERFORM app.controler_limites_site(p_empreinte_ip);

  INSERT INTO app.demandes_site AS d (numero, branche, profil, nom, telephone, email, commune, besoin,
                                      accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('demandes_site'), p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_commune), ''), nullif(btrim(p_besoin), ''),
          p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING d.id, d.numero INTO v_id, v_numero;

  IF p_piece_contenu IS NOT NULL THEN
    INSERT INTO app.pieces_demandes_site (id, demande_id, type_contenu, taille, contenu_chiffre, empreinte)
    VALUES (p_piece_id, v_id, p_piece_type, p_piece_taille, p_piece_contenu, p_piece_empreinte);
  END IF;

  RETURN QUERY SELECT v_id, v_numero;
END
$$;

-- Rappel d'échéance : l'échéance doit tomber dans les 13 mois ; la demande est à traiter un mois avant
CREATE FUNCTION app.enregistrer_rappel_echeance(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_echeance date, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea)
RETURNS TABLE (id uuid, numero bigint, a_traiter_le date)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF p_echeance IS NULL OR p_echeance < app.aujourdhui() OR p_echeance > (app.aujourdhui() + interval '13 months')::date THEN
    RAISE EXCEPTION 'La date d''échéance doit être comprise entre aujourd''hui et les 13 prochains mois.'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app.controler_limites_site(p_empreinte_ip);

  RETURN QUERY
  INSERT INTO app.demandes_site AS d (numero, nature, branche, profil, nom, telephone, email, echeance_actuelle,
                                      a_traiter_le, accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('demandes_site'), 'rappel_echeance', p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), p_echeance,
          greatest(app.aujourdhui(), p_echeance - app.rappel_echeance_avance()),
          p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING d.id, d.numero, d.a_traiter_le;
END
$$;

-- Appel d'offres : pour un professionnel ou une entreprise, avant la date limite de dépôt (un an au plus)
CREATE FUNCTION app.enregistrer_appel_offres(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_date_limite date, p_appel_offres jsonb,
  p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF p_profil = 'particulier' THEN
    RAISE EXCEPTION 'L''assistant « appel d''offres » s''adresse aux professionnels et aux entreprises.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_date_limite IS NULL OR p_date_limite < app.aujourdhui() OR p_date_limite > (app.aujourdhui() + interval '1 year')::date THEN
    RAISE EXCEPTION 'La date limite de dépôt doit être comprise entre aujourd''hui et l''an prochain.'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app.controler_limites_site(p_empreinte_ip);

  RETURN QUERY
  INSERT INTO app.demandes_site AS d (numero, nature, branche, profil, nom, telephone, email, commune, besoin,
                                      date_limite_offre, appel_offres, accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('demandes_site'), 'appel_offres', p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_commune), ''), nullif(btrim(p_besoin), ''),
          p_date_limite, p_appel_offres, p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING d.id, d.numero;
END
$$;

-- Demande de rendez-vous depuis le site : un jour ouvré, de demain à 60 jours ; la visite chez le client
-- est réservée aux professionnels et aux entreprises
CREATE FUNCTION app.demander_rendez_vous(
  p_motif app.motif_rendez_vous, p_mode app.mode_rendez_vous, p_profil app.type_client, p_nom text,
  p_telephone text, p_email text, p_message text, p_souhaite_le date, p_creneau app.creneau,
  p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF p_souhaite_le IS NULL OR p_souhaite_le <= app.aujourdhui()
     OR p_souhaite_le > app.aujourdhui() + app.rendez_vous_horizon_jours() THEN
    RAISE EXCEPTION 'Choisissez un jour entre demain et les deux prochains mois.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT app.est_jour_ouvre(p_souhaite_le) THEN
    RAISE EXCEPTION 'L''agence reçoit du lundi au vendredi, hors jours fériés : choisissez un autre jour.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_mode = 'chez_le_client' AND p_profil = 'particulier' THEN
    RAISE EXCEPTION 'La visite sur place est réservée aux professionnels et aux entreprises.'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app.controler_limites_site(p_empreinte_ip);

  RETURN QUERY
  INSERT INTO app.rendez_vous AS r (numero, origine, motif, mode, profil, nom, telephone, email, message,
                                    souhaite_le, creneau_souhaite, statut, accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('rendez_vous'), 'site', p_motif, p_mode, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_message), ''), p_souhaite_le, p_creneau, 'demande',
          p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING r.id, r.numero;
END
$$;

-- Personnes qui gèrent l'agenda ; l'auditeur le consulte
CREATE FUNCTION app.peut_gerer_rendez_vous() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial') $$;

-- Contrôle d'un horaire : à venir (une heure de tolérance), dans les six mois, entre 7 h et 20 h à Abidjan,
-- avec une personne active de l'agence qui n'a pas déjà un rendez-vous à cette heure-là
CREATE FUNCTION app.controler_horaire_rendez_vous(p_id uuid, p_debut timestamptz, p_duree integer, p_avec uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_local timestamp := p_debut AT TIME ZONE 'Africa/Abidjan';
  v_autre text;
BEGIN
  IF p_debut IS NULL OR p_duree IS NULL OR p_avec IS NULL THEN
    RAISE EXCEPTION 'Indiquez le jour, l''heure, la durée et la personne de l''agence.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_debut < now() - interval '1 hour' OR p_debut > now() + interval '6 months' THEN
    RAISE EXCEPTION 'Le rendez-vous doit être à venir, dans les six prochains mois.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_local::time < time '07:00' OR (v_local + make_interval(mins => p_duree))::time > time '20:00'
     OR (v_local + make_interval(mins => p_duree))::date <> v_local::date THEN
    RAISE EXCEPTION 'Un rendez-vous se tient entre 7 h et 20 h.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.utilisateurs u WHERE u.id = p_avec AND u.actif AND u.role NOT IN ('apporteur', 'auditeur')) THEN
    RAISE EXCEPTION 'La personne choisie ne peut pas recevoir de rendez-vous.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT u.nom INTO v_autre
  FROM app.rendez_vous r JOIN app.utilisateurs u ON u.id = r.avec
  WHERE r.avec = p_avec AND r.statut = 'confirme' AND r.id IS DISTINCT FROM p_id
    AND tstzrange(r.debut, r.debut + make_interval(mins => r.duree_minutes)) && tstzrange(p_debut, p_debut + make_interval(mins => p_duree))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% a déjà un rendez-vous à cette heure-là.', v_autre
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

-- Rendez-vous fixé par l'agence (appel, passage au guichet), pour un client ou un prospect
CREATE FUNCTION app.fixer_rendez_vous(
  p_motif app.motif_rendez_vous, p_mode app.mode_rendez_vous, p_nom text, p_telephone text, p_email text,
  p_message text, p_client uuid, p_debut timestamptz, p_duree integer, p_avec uuid)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_moi uuid := securite.utilisateur_courant();
BEGIN
  IF NOT app.peut_gerer_rendez_vous() THEN
    RAISE EXCEPTION 'Seuls le gérant, le chargé de clientèle et le commercial gèrent l''agenda.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.clients c WHERE c.id = p_client) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM app.controler_horaire_rendez_vous(NULL, p_debut, p_duree, p_avec);

  RETURN QUERY
  INSERT INTO app.rendez_vous AS r (numero, origine, motif, mode, nom, telephone, email, message, client_id,
                                    debut, duree_minutes, avec, statut, cree_par, confirme_le, confirme_par)
  VALUES (app.numero_suivant('rendez_vous'), 'agence', p_motif, p_mode, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_message), ''), p_client,
          p_debut, p_duree, p_avec, 'confirme', v_moi, now(), v_moi)
  RETURNING r.id, r.numero;
END
$$;

-- Traitement : confirmer (ou déplacer), noter s'il a eu lieu, annuler, rattacher à un client.
-- Chaque étape est datée et signée par la personne connectée.
CREATE FUNCTION app.traiter_rendez_vous(
  p_id uuid, p_action text, p_debut timestamptz, p_duree integer, p_avec uuid, p_mode app.mode_rendez_vous,
  p_motif_annulation text, p_client uuid)
RETURNS app.statut_rendez_vous
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_r app.rendez_vous;
  v_moi uuid := securite.utilisateur_courant();
BEGIN
  IF NOT app.peut_gerer_rendez_vous() THEN
    RAISE EXCEPTION 'Seuls le gérant, le chargé de clientèle et le commercial gèrent l''agenda.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.* INTO v_r FROM app.rendez_vous r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendez-vous introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('app.traitement_rendez_vous', 'oui', true);

  IF p_action = 'rattacher' THEN
    IF p_client IS NULL OR NOT EXISTS (SELECT 1 FROM app.clients c WHERE c.id = p_client) THEN
      RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE app.rendez_vous SET client_id = p_client WHERE id = p_id;
  ELSIF v_r.statut IN ('honore', 'manque', 'annule') THEN
    RAISE EXCEPTION 'Ce rendez-vous est clos : fixez-en un nouveau.' USING ERRCODE = 'check_violation';
  ELSIF p_action = 'confirmer' THEN
    PERFORM app.controler_horaire_rendez_vous(p_id, p_debut, p_duree, p_avec);
    UPDATE app.rendez_vous
    SET debut = p_debut, duree_minutes = p_duree, avec = p_avec, mode = coalesce(p_mode, mode), statut = 'confirme',
        confirme_le = now(), confirme_par = v_moi
    WHERE id = p_id;
  ELSIF p_action IN ('honore', 'manque') THEN
    IF v_r.statut <> 'confirme' OR v_r.debut > now() THEN
      RAISE EXCEPTION 'Notez si le rendez-vous a eu lieu une fois son heure passée.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.rendez_vous SET statut = p_action::app.statut_rendez_vous, clos_le = now(), clos_par = v_moi WHERE id = p_id;
  ELSIF p_action = 'annuler' THEN
    IF p_motif_annulation IS NULL OR char_length(btrim(p_motif_annulation)) < 3 THEN
      RAISE EXCEPTION 'Indiquez le motif de l''annulation.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.rendez_vous SET statut = 'annule', motif_annulation = btrim(p_motif_annulation), clos_le = now(), clos_par = v_moi
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Action inconnue.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.traitement_rendez_vous', '', true);
  RETURN (SELECT r.statut FROM app.rendez_vous r WHERE r.id = p_id);
END
$$;

-- ---------------------------------------------------------------------
-- Purge (12 mois, comme les demandes du site)
--   · un rappel d'échéance jamais traité compte à partir de son échéance, pas de sa réception ;
--   · un rendez-vous qui n'est rattaché à aucun client est supprimé 12 mois après sa clôture
--     (ou après son heure, ou sa demande, s'il n'a pas été clos).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.purger_demandes_site() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  PERFORM set_config('app.purge_demandes_site', 'oui', true);
  DELETE FROM app.pieces_demandes_site p
  USING app.demandes_site d
  WHERE p.demande_id = d.id AND d.statut <> 'convertie'
    AND coalesce(d.traitee_le, CASE WHEN d.nature = 'rappel_echeance' THEN greatest(d.recue_le, d.echeance_actuelle::timestamptz)
                                ELSE d.recue_le END) < now() - app.conservation_demandes_site();
  DELETE FROM app.demandes_site d
  WHERE d.statut <> 'convertie'
    AND coalesce(d.traitee_le, CASE WHEN d.nature = 'rappel_echeance' THEN greatest(d.recue_le, d.echeance_actuelle::timestamptz)
                                ELSE d.recue_le END) < now() - app.conservation_demandes_site();
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  PERFORM set_config('app.purge_demandes_site', '', true);
  RETURN v_nombre;
END
$$;

CREATE FUNCTION app.purger_rendez_vous() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  PERFORM set_config('app.purge_demandes_site', 'oui', true);
  DELETE FROM app.rendez_vous r
  WHERE r.client_id IS NULL
    AND coalesce(r.clos_le, r.debut, r.souhaite_le::timestamptz, r.cree_le) < now() - app.conservation_demandes_site();
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  PERFORM set_config('app.purge_demandes_site', '', true);
  RETURN v_nombre;
END
$$;

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.rendez_vous ENABLE ROW LEVEL SECURITY;

-- L'agenda : le gérant, le chargé de clientèle et le commercial ; l'auditeur le consulte.
-- Aucun droit d'écriture direct : seules les fonctions ci-dessus écrivent.
CREATE POLICY rendez_vous_lecture ON app.rendez_vous FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));

-- L'empreinte de l'adresse IP ne sert qu'aux limites : l'application ne la lit pas
GRANT SELECT (id, numero, origine, motif, mode, profil, nom, telephone, email, message, client_id, souhaite_le,
              creneau_souhaite, debut, duree_minutes, avec, statut, motif_annulation, accord_traitement, accord_whatsapp,
              cree_le, cree_par, confirme_le, confirme_par, clos_le, clos_par) ON app.rendez_vous TO dbs_api;
GRANT SELECT (nature, echeance_actuelle, date_limite_offre, appel_offres, a_traiter_le) ON app.demandes_site TO dbs_api;

REVOKE ALL ON FUNCTION app.controler_limites_site(bytea), app.controler_horaire_rendez_vous(uuid, timestamptz, integer, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.rappel_echeance_avance(), app.rendez_vous_horizon_jours(), app.peut_gerer_rendez_vous(),
  app.ajouter_jours_ouvres(date, integer), app.est_jour_ouvre(date),
  app.enregistrer_rappel_echeance(app.branche, app.type_client, text, text, text, date, text, text, bytea),
  app.enregistrer_appel_offres(app.branche, app.type_client, text, text, text, text, text, date, jsonb, text, text, bytea),
  app.demander_rendez_vous(app.motif_rendez_vous, app.mode_rendez_vous, app.type_client, text, text, text, text, date,
                           app.creneau, text, text, bytea),
  app.fixer_rendez_vous(app.motif_rendez_vous, app.mode_rendez_vous, text, text, text, text, uuid, timestamptz, integer, uuid),
  app.traiter_rendez_vous(uuid, text, timestamptz, integer, uuid, app.mode_rendez_vous, text, uuid),
  app.purger_rendez_vous()
TO dbs_api;
