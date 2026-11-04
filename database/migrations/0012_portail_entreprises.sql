-- =====================================================================
-- 0012 · Portail des entreprises et des transporteurs (tâche 10)
--
--   · plusieurs gestionnaires par entreprise (app.gestionnaires_portail) : créés par l'agence, ou par le
--     titulaire de l'entreprise pour ses collaborateurs ; connexion par un code à usage unique envoyé sur
--     WhatsApp ou par SMS (aucun mot de passe à retenir) ;
--   · codes, sessions et journal du portail dans le schéma « portail », accessibles seulement par des
--     fonctions : le code n'est jamais stocké, seulement son empreinte (HMAC calculé par l'API) ;
--   · rôle dbs_portail : pendant une requête du portail, l'application prend ce rôle ; la base ne lui montre
--     que les données de l'entreprise de la personne connectée, colonne par colonne. Une erreur dans l'API ne
--     peut pas montrer la flotte d'une autre entreprise ;
--   · attestations d'assurance (PDF de l'ASACI) déposées par l'agence, chiffrées, analysées par l'antivirus,
--     téléchargeables une à une ou en lot depuis le portail.
-- Conception : docs/architecture/adr/0011-portail-des-entreprises.md
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dbs_portail') THEN
    RAISE EXCEPTION 'Rôle dbs_portail absent : relancez database/initialisation/01_roles_et_base.sql avec un superutilisateur, puis cette migration.';
  END IF;
END
$$;

CREATE SCHEMA portail;
REVOKE ALL ON SCHEMA portail FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Gestionnaires d'une entreprise
-- ---------------------------------------------------------------------
CREATE TYPE app.role_gestionnaire AS ENUM ('titulaire', 'gestionnaire');

CREATE TABLE app.gestionnaires_portail (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES app.clients (id),
  nom                    text NOT NULL,
  -- Numéro E.164 qui reçoit le code de connexion
  telephone              text NOT NULL,
  -- Titulaire : représentant de l'entreprise, il peut ajouter ou retirer ses collaborateurs
  role                   app.role_gestionnaire NOT NULL DEFAULT 'gestionnaire',
  actif                  boolean NOT NULL DEFAULT true,
  cree_le                timestamptz NOT NULL DEFAULT now(),
  -- Créé par l'agence, ou par le titulaire de l'entreprise depuis le portail
  cree_par               uuid REFERENCES app.utilisateurs (id),
  cree_par_gestionnaire  uuid REFERENCES app.gestionnaires_portail (id),
  desactive_le           timestamptz,
  derniere_connexion_le  timestamptz,
  CONSTRAINT gestionnaires_portail_nom CHECK (char_length(btrim(nom)) BETWEEN 2 AND 120),
  CONSTRAINT gestionnaires_portail_telephone CHECK (telephone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT gestionnaires_portail_auteur CHECK ((cree_par IS NULL) <> (cree_par_gestionnaire IS NULL)),
  CONSTRAINT gestionnaires_portail_desactivation CHECK (actif = (desactive_le IS NULL))
);
-- Un numéro ouvre un seul accès à la fois : la connexion par téléphone doit être sans ambiguïté
CREATE UNIQUE INDEX gestionnaires_portail_telephone_unique ON app.gestionnaires_portail (telephone) WHERE actif;
CREATE INDEX gestionnaires_portail_client_idx ON app.gestionnaires_portail (client_id);

-- Le portail est réservé aux entreprises et aux professionnels ; la désactivation est datée par la base
CREATE FUNCTION app.controler_gestionnaire() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.client_id <> OLD.client_id THEN
    IF NOT EXISTS (SELECT 1 FROM app.clients c WHERE c.id = NEW.client_id AND c.type IN ('entreprise', 'professionnel')) THEN
      RAISE EXCEPTION 'Le portail est réservé aux entreprises et aux professionnels.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.client_id <> OLD.client_id OR NEW.telephone <> OLD.telephone
                           OR NEW.cree_le <> OLD.cree_le OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
                           OR NEW.cree_par_gestionnaire IS DISTINCT FROM OLD.cree_par_gestionnaire) THEN
    RAISE EXCEPTION 'Un accès au portail ne change ni d''entreprise ni de numéro : désactivez-le et créez-en un autre.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.actif THEN
    NEW.desactive_le := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.actif THEN
    NEW.desactive_le := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.gestionnaires_portail
  FOR EACH ROW WHEN (NEW.cree_par_gestionnaire IS NULL)
  EXECUTE FUNCTION securite.renseigner_auteur('cree_par');
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.gestionnaires_portail
  FOR EACH ROW EXECUTE FUNCTION app.controler_gestionnaire();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.gestionnaires_portail
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Codes de connexion, sessions et journal du portail
-- ---------------------------------------------------------------------
CREATE TABLE portail.codes_connexion (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gestionnaire_id  uuid NOT NULL REFERENCES app.gestionnaires_portail (id),
  -- HMAC du code, calculé par l'API avec une clé que la base ne connaît pas
  empreinte        bytea NOT NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  expire_le        timestamptz NOT NULL,
  tentatives       integer NOT NULL DEFAULT 0,
  utilise_le       timestamptz,
  annule_le        timestamptz,
  adresse_ip       inet
);
CREATE INDEX codes_connexion_gestionnaire_idx ON portail.codes_connexion (gestionnaire_id, cree_le DESC);

CREATE TABLE portail.sessions (
  empreinte             bytea PRIMARY KEY,
  gestionnaire_id       uuid NOT NULL REFERENCES app.gestionnaires_portail (id),
  cree_le               timestamptz NOT NULL DEFAULT now(),
  expire_le             timestamptz NOT NULL,
  derniere_activite_le  timestamptz NOT NULL DEFAULT now(),
  adresse_ip            inet,
  agent_utilisateur     text
);
CREATE INDEX sessions_portail_gestionnaire_idx ON portail.sessions (gestionnaire_id);

CREATE TABLE portail.evenements (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  horodatage       timestamptz NOT NULL DEFAULT now(),
  type             text NOT NULL,
  gestionnaire_id  uuid REFERENCES app.gestionnaires_portail (id),
  -- Numéro saisi lors d'une demande de code, même s'il ne correspond à aucun accès
  telephone        text,
  adresse_ip       inet,
  objet            text,
  CONSTRAINT evenements_portail_type CHECK (type IN (
    'code_envoye', 'code_refuse', 'code_echoue', 'connexion_reussie', 'deconnexion',
    'attestation_telechargee', 'attestations_telechargees', 'export_flotte', 'gestionnaire_ajoute', 'gestionnaire_desactive'
  )),
  CONSTRAINT evenements_portail_telephone CHECK (telephone IS NULL OR char_length(telephone) <= 20),
  CONSTRAINT evenements_portail_objet CHECK (objet IS NULL OR char_length(objet) <= 300)
);
CREATE INDEX evenements_portail_telephone_idx ON portail.evenements (telephone, horodatage);
CREATE INDEX evenements_portail_ip_idx ON portail.evenements (adresse_ip, horodatage);
CREATE INDEX evenements_portail_gestionnaire_idx ON portail.evenements (gestionnaire_id, horodatage);

-- Un accès désactivé perd aussitôt ses sessions et ses codes en cours
CREATE FUNCTION portail.couper_acces() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.actif AND NOT NEW.actif THEN
    DELETE FROM portail.sessions WHERE gestionnaire_id = NEW.id;
    UPDATE portail.codes_connexion SET annule_le = now()
    WHERE gestionnaire_id = NEW.id AND utilise_le IS NULL AND annule_le IS NULL;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER c_couper_acces AFTER UPDATE OF actif ON app.gestionnaires_portail
  FOR EACH ROW EXECUTE FUNCTION portail.couper_acces();

-- Demande de code. L'API tire le code au hasard et n'en transmet que l'empreinte. Statuts :
--   · « envoyer » : code enregistré, à envoyer au numéro rendu ;
--   · « inconnu » : aucun accès actif pour ce numéro (l'API répond exactement comme pour « envoyer ») ;
--   · « trop_de_demandes » : trois demandes en 15 minutes pour ce numéro, ou dix en une heure depuis cette
--     adresse, qu'il soit connu ou non (on ne peut pas en déduire qu'un numéro a un accès).
CREATE FUNCTION portail.preparer_code(p_telephone text, p_empreinte bytea, p_ip inet, p_duree interval)
RETURNS TABLE (statut text, gestionnaire_id uuid, nom text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gestionnaire app.gestionnaires_portail;
BEGIN
  IF (SELECT count(*) FROM portail.evenements e WHERE e.telephone = p_telephone
        AND e.type IN ('code_envoye', 'code_refuse') AND e.horodatage > now() - interval '15 minutes') >= 3
     OR (SELECT count(*) FROM portail.evenements e WHERE e.adresse_ip = p_ip
        AND e.type IN ('code_envoye', 'code_refuse') AND e.horodatage > now() - interval '1 hour') >= 10 THEN
    RETURN QUERY SELECT 'trop_de_demandes'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT g.* INTO v_gestionnaire FROM app.gestionnaires_portail g WHERE g.telephone = p_telephone AND g.actif;
  IF NOT FOUND THEN
    INSERT INTO portail.evenements (type, telephone, adresse_ip) VALUES ('code_refuse', p_telephone, p_ip);
    RETURN QUERY SELECT 'inconnu'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Un seul code valable à la fois : le nouveau remplace les précédents
  UPDATE portail.codes_connexion c SET annule_le = now()
  WHERE c.gestionnaire_id = v_gestionnaire.id AND c.utilise_le IS NULL AND c.annule_le IS NULL;
  INSERT INTO portail.codes_connexion (gestionnaire_id, empreinte, expire_le, adresse_ip)
  VALUES (v_gestionnaire.id, p_empreinte, now() + p_duree, p_ip);
  INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip)
  VALUES ('code_envoye', v_gestionnaire.id, p_telephone, p_ip);
  RETURN QUERY SELECT 'envoyer'::text, v_gestionnaire.id, v_gestionnaire.nom;
END
$$;

-- Vérification d'un code : cinq essais au plus par code, vingt échecs en 15 minutes suspendent l'adresse.
-- Statuts : « valide » (avec l'accès), « invalide », « trop_de_tentatives ».
CREATE FUNCTION portail.verifier_code(p_telephone text, p_empreinte bytea, p_ip inet)
RETURNS TABLE (statut text, gestionnaire_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gestionnaire app.gestionnaires_portail;
  v_code portail.codes_connexion;
BEGIN
  IF (SELECT count(*) FROM portail.evenements e WHERE e.adresse_ip = p_ip AND e.type = 'code_echoue'
        AND e.horodatage > now() - interval '15 minutes') >= 20 THEN
    RETURN QUERY SELECT 'trop_de_tentatives'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT g.* INTO v_gestionnaire FROM app.gestionnaires_portail g WHERE g.telephone = p_telephone AND g.actif;
  IF FOUND THEN
    SELECT c.* INTO v_code FROM portail.codes_connexion c
    WHERE c.gestionnaire_id = v_gestionnaire.id AND c.utilise_le IS NULL AND c.annule_le IS NULL AND c.expire_le > now()
    ORDER BY c.cree_le DESC LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_code.id IS NOT NULL AND v_code.empreinte = p_empreinte THEN
    UPDATE portail.codes_connexion SET utilise_le = now() WHERE id = v_code.id;
    UPDATE app.gestionnaires_portail SET derniere_connexion_le = now() WHERE id = v_gestionnaire.id;
    INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip)
    VALUES ('connexion_reussie', v_gestionnaire.id, p_telephone, p_ip);
    RETURN QUERY SELECT 'valide'::text, v_gestionnaire.id;
    RETURN;
  END IF;

  IF v_code.id IS NOT NULL THEN
    UPDATE portail.codes_connexion
    SET tentatives = tentatives + 1, annule_le = CASE WHEN tentatives + 1 >= 5 THEN now() END
    WHERE id = v_code.id;
  END IF;
  INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip)
  VALUES ('code_echoue', v_gestionnaire.id, p_telephone, p_ip);
  RETURN QUERY SELECT 'invalide'::text, NULL::uuid;
END
$$;

CREATE FUNCTION portail.ouvrir_session(p_gestionnaire uuid, p_empreinte bytea, p_duree interval, p_ip inet, p_agent text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_expire timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.gestionnaires_portail g WHERE g.id = p_gestionnaire AND g.actif) THEN
    RAISE EXCEPTION 'Accès au portail désactivé.' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  INSERT INTO portail.sessions (empreinte, gestionnaire_id, expire_le, adresse_ip, agent_utilisateur)
  VALUES (p_empreinte, p_gestionnaire, now() + p_duree, p_ip, left(p_agent, 300))
  RETURNING expire_le INTO v_expire;
  RETURN v_expire;
END
$$;

-- Session valable : ni expirée, ni inactive au-delà du délai, accès toujours actif. Prolonge l'activité.
CREATE FUNCTION portail.lire_session(p_empreinte bytea, p_inactivite interval)
RETURNS TABLE (gestionnaire_id uuid, client_id uuid, nom text, telephone text, role app.role_gestionnaire,
               entreprise text, expire_le timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE portail.sessions s SET derniere_activite_le = now()
  FROM app.gestionnaires_portail g JOIN app.clients c ON c.id = g.client_id
  WHERE s.empreinte = p_empreinte AND g.id = s.gestionnaire_id AND g.actif
    AND s.expire_le > now() AND s.derniere_activite_le > now() - p_inactivite
  RETURNING g.id, g.client_id, g.nom, g.telephone, g.role, c.nom, s.expire_le;
END
$$;

CREATE FUNCTION portail.fermer_session(p_empreinte bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gestionnaire uuid;
BEGIN
  DELETE FROM portail.sessions WHERE empreinte = p_empreinte RETURNING gestionnaire_id INTO v_gestionnaire;
  IF v_gestionnaire IS NOT NULL THEN
    INSERT INTO portail.evenements (type, gestionnaire_id) VALUES ('deconnexion', v_gestionnaire);
  END IF;
END
$$;

-- Ménage de la maintenance horaire : codes de plus d'un jour, sessions expirées
CREATE FUNCTION portail.purger() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_codes integer;
  v_sessions integer;
BEGIN
  DELETE FROM portail.codes_connexion WHERE cree_le < now() - interval '1 day';
  GET DIAGNOSTICS v_codes = ROW_COUNT;
  DELETE FROM portail.sessions WHERE expire_le < now();
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  RETURN v_codes + v_sessions;
END
$$;

REVOKE ALL ON FUNCTION portail.preparer_code(text, bytea, inet, interval), portail.verifier_code(text, bytea, inet),
  portail.ouvrir_session(uuid, bytea, interval, inet, text), portail.lire_session(bytea, interval),
  portail.fermer_session(bytea), portail.purger() FROM PUBLIC;
GRANT USAGE ON SCHEMA portail TO dbs_api, dbs_portail;
GRANT EXECUTE ON FUNCTION portail.preparer_code(text, bytea, inet, interval), portail.verifier_code(text, bytea, inet),
  portail.ouvrir_session(uuid, bytea, interval, inet, text), portail.lire_session(bytea, interval),
  portail.fermer_session(bytea), portail.purger() TO dbs_api;

-- ---------------------------------------------------------------------
-- Pendant une requête du portail : la personne connectée et son entreprise
-- ---------------------------------------------------------------------
-- L'API pose app.gestionnaire_id (comme app.utilisateur_id pour le personnel) après avoir vérifié la session
CREATE FUNCTION portail.gestionnaire_courant() RETURNS app.gestionnaires_portail
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_id text := current_setting('app.gestionnaire_id', true);
  v_gestionnaire app.gestionnaires_portail;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'Aucune personne connectée au portail dans cette transaction' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  SELECT g.* INTO v_gestionnaire FROM app.gestionnaires_portail g WHERE g.id = v_id::uuid AND g.actif;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accès au portail inconnu ou désactivé' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN v_gestionnaire;
END
$$;

CREATE FUNCTION portail.client_courant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT (portail.gestionnaire_courant()).client_id $$;

-- Journal des actions faites depuis le portail (téléchargements, exports, gestion des accès)
CREATE FUNCTION portail.consigner(p_type text, p_objet text, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_type NOT IN ('attestation_telechargee', 'attestations_telechargees', 'export_flotte') THEN
    RAISE EXCEPTION 'Événement non consignable depuis le portail : %', p_type USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO portail.evenements (type, gestionnaire_id, adresse_ip, objet)
  VALUES (p_type, (portail.gestionnaire_courant()).id, p_ip, left(p_objet, 300));
END
$$;

-- Le titulaire ajoute ou retire les accès de ses collaborateurs (jamais d'un autre titulaire, ni le sien)
CREATE FUNCTION portail.ajouter_gestionnaire(p_nom text, p_telephone text, p_ip inet) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
  v_id uuid;
BEGIN
  IF v_moi.role <> 'titulaire' THEN
    RAISE EXCEPTION 'Seul le titulaire de l''accès de l''entreprise ajoute des collaborateurs.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM app.gestionnaires_portail g WHERE g.client_id = v_moi.client_id AND g.actif) >= 20 THEN
    RAISE EXCEPTION 'Vingt accès actifs au plus par entreprise : retirez d''abord un accès inutilisé.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO app.gestionnaires_portail (client_id, nom, telephone, role, cree_par_gestionnaire)
  VALUES (v_moi.client_id, btrim(p_nom), p_telephone, 'gestionnaire', v_moi.id)
  RETURNING id INTO v_id;
  INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip, objet)
  VALUES ('gestionnaire_ajoute', v_moi.id, p_telephone, p_ip, left(btrim(p_nom), 300));
  RETURN v_id;
END
$$;

CREATE FUNCTION portail.desactiver_gestionnaire(p_id uuid, p_ip inet) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
  v_cible app.gestionnaires_portail;
BEGIN
  IF v_moi.role <> 'titulaire' THEN
    RAISE EXCEPTION 'Seul le titulaire de l''accès de l''entreprise retire des accès.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT g.* INTO v_cible FROM app.gestionnaires_portail g WHERE g.id = p_id AND g.client_id = v_moi.client_id AND g.actif;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accès introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cible.role = 'titulaire' THEN
    RAISE EXCEPTION 'L''accès d''un titulaire se retire en le demandant à l''agence.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.gestionnaires_portail SET actif = false WHERE id = p_id;
  INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip, objet)
  VALUES ('gestionnaire_desactive', v_moi.id, v_cible.telephone, p_ip, left(v_cible.nom, 300));
END
$$;

REVOKE ALL ON FUNCTION portail.gestionnaire_courant(), portail.client_courant(), portail.consigner(text, text, inet),
  portail.ajouter_gestionnaire(text, text, inet), portail.desactiver_gestionnaire(uuid, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portail.gestionnaire_courant(), portail.client_courant(), portail.consigner(text, text, inet),
  portail.ajouter_gestionnaire(text, text, inet), portail.desactiver_gestionnaire(uuid, inet) TO dbs_portail;

-- ---------------------------------------------------------------------
-- Attestations d'assurance (PDF), une par période d'un véhicule sur un contrat
-- ---------------------------------------------------------------------
CREATE TABLE app.attestations_vehicules (
  contrat_vehicule_id  uuid PRIMARY KEY REFERENCES app.contrats_vehicules (id),
  -- AES-256-GCM, clé de l'API, contexte « attestation:<contrat_vehicule_id> »
  contenu_chiffre      bytea NOT NULL,
  -- SHA-256 du PDF en clair : contrôle à chaque lecture
  empreinte            bytea NOT NULL,
  taille               integer NOT NULL,
  -- Analysé par l'antivirus au dépôt ; un fichier infecté n'est jamais enregistré
  etat_analyse         app.analyse_piece NOT NULL,
  depose_le            timestamptz NOT NULL,
  depose_par           uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT attestations_vehicules_taille CHECK (taille BETWEEN 1 AND 2097152),
  CONSTRAINT attestations_vehicules_etat CHECK (etat_analyse <> 'infectee')
);

-- Une attestation porte le numéro de la période du véhicule : on ne dépose le PDF qu'une fois ce numéro connu
CREATE FUNCTION app.controler_attestation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.contrats_vehicules cv
                 WHERE cv.id = NEW.contrat_vehicule_id AND cv.numero_attestation IS NOT NULL) THEN
    RAISE EXCEPTION 'Indiquez d''abord le numéro de l''attestation.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT OR UPDATE ON app.attestations_vehicules
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('depose_par', 'depose_le');
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.attestations_vehicules
  FOR EACH ROW EXECUTE FUNCTION app.controler_attestation();
-- Le journal ne garde pas le contenu chiffré, seulement son empreinte
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.attestations_vehicules
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('contenu_chiffre');

-- ---------------------------------------------------------------------
-- Droits du personnel (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.gestionnaires_portail ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attestations_vehicules ENABLE ROW LEVEL SECURITY;

CREATE POLICY gestionnaires_portail_lecture ON app.gestionnaires_portail FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));
CREATE POLICY gestionnaires_portail_creation ON app.gestionnaires_portail FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY gestionnaires_portail_modification ON app.gestionnaires_portail FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT SELECT ON app.gestionnaires_portail TO dbs_api;
GRANT INSERT (id, client_id, nom, telephone, role) ON app.gestionnaires_portail TO dbs_api;
GRANT UPDATE (nom, role, actif) ON app.gestionnaires_portail TO dbs_api;

CREATE POLICY attestations_vehicules_lecture ON app.attestations_vehicules FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.contrats_vehicules cv WHERE cv.id = contrat_vehicule_id));
CREATE POLICY attestations_vehicules_depot ON app.attestations_vehicules FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY attestations_vehicules_remplacement ON app.attestations_vehicules FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT SELECT ON app.attestations_vehicules TO dbs_api;
GRANT INSERT (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse),
      UPDATE (contenu_chiffre, empreinte, taille, etat_analyse) ON app.attestations_vehicules TO dbs_api;

-- Journal des connexions au portail : consultable par le gérant et l'auditeur
ALTER TABLE portail.evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY evenements_portail_lecture ON portail.evenements FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur')));
GRANT SELECT ON portail.evenements TO dbs_api;

-- ---------------------------------------------------------------------
-- Droits du portail : l'entreprise de la personne connectée, et rien d'autre
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO dbs_portail;

CREATE POLICY clients_portail ON app.clients FOR SELECT TO dbs_portail
  USING (id = (SELECT portail.client_courant()));
GRANT SELECT (id, type, nom) ON app.clients TO dbs_portail;

CREATE POLICY vehicules_portail ON app.vehicules FOR SELECT TO dbs_portail
  USING (client_id = (SELECT portail.client_courant()));
GRANT SELECT (id, client_id, immatriculation, numero_chassis, marque, modele, genre, usage, puissance_fiscale,
              valeur_venale, echeance_visite_technique, echeance_vignette, echeance_carte_transport) ON app.vehicules TO dbs_portail;

-- Contrats : ni la prime nette (base des commissions de l'agence) ni les auteurs
CREATE POLICY contrats_portail ON app.contrats FOR SELECT TO dbs_portail
  USING (client_id = (SELECT portail.client_courant()));
GRANT SELECT (id, client_id, numero_police, branche, statut, date_effet, date_echeance, prime_ttc, primes_avenants,
              renouvelle_id) ON app.contrats TO dbs_portail;

CREATE POLICY contrats_vehicules_portail ON app.contrats_vehicules FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
GRANT SELECT (id, contrat_id, vehicule_id, numero_attestation, ajoute_le, retire_le, prime_vehicule)
  ON app.contrats_vehicules TO dbs_portail;

-- Sinistres : sans la description, rédigée par l'agence pour son suivi
CREATE POLICY sinistres_portail ON app.sinistres FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
GRANT SELECT (id, contrat_id, vehicule_id, survenu_le, declare_le, nature, dommages_corporels, statut, reference_compagnie)
  ON app.sinistres TO dbs_portail;

-- Paiements : de quoi calculer le reste à payer, sans les auteurs ni les références bancaires
CREATE POLICY encaissements_portail ON app.encaissements FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
GRANT SELECT (id, numero_recu, contrat_id, montant, mode, encaisse_le) ON app.encaissements TO dbs_portail;
GRANT SELECT ON app.v_soldes_contrats TO dbs_portail;

CREATE POLICY attestations_vehicules_portail ON app.attestations_vehicules FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats_vehicules cv WHERE cv.id = contrat_vehicule_id));
GRANT SELECT (contrat_vehicule_id, contenu_chiffre, empreinte, taille, etat_analyse) ON app.attestations_vehicules TO dbs_portail;

-- Collaborateurs de l'entreprise
CREATE POLICY gestionnaires_portail_portail ON app.gestionnaires_portail FOR SELECT TO dbs_portail
  USING (client_id = (SELECT portail.client_courant()));
GRANT SELECT (id, client_id, nom, telephone, role, actif, cree_le, derniere_connexion_le) ON app.gestionnaires_portail TO dbs_portail;
