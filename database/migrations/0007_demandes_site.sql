-- =====================================================================
-- 0007 · Demandes de devis reçues par le site
--
-- Pour la tâche 7 :
--   · app.demandes_site : chaque demande envoyée par le formulaire du site, avec le texte exact des
--     cases cochées par le visiteur (la preuve de ce qu'il a accepté). Le site n'a aucun compte : la
--     demande entre par une seule fonction, app.enregistrer_demande_site, qui limite les envois par
--     adresse (seule une empreinte de l'adresse IP est gardée) et par jour ;
--   · app.pieces_demandes_site : la carte grise jointe, chiffrée par l'API (AES-256-GCM) avant
--     d'entrer en base, en ajout seul ;
--   · traitement au back-office : la demande devient un client et un devis (origine « site »), ou est
--     classée sans suite avec un motif. Une demande traitée ne revient pas en arrière.
-- Conception : docs/architecture/adr/0009-demandes-de-devis-du-site.md
-- =====================================================================

-- nouvelle → convertie (client et devis créés) ou sans_suite (motif obligatoire) ; les deux sont définitifs
CREATE TYPE app.statut_demande_site AS ENUM ('nouvelle', 'convertie', 'sans_suite');

-- Limites contre les envois en masse (robots, erreurs de manipulation)
CREATE FUNCTION app.demandes_site_par_heure_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;
CREATE FUNCTION app.demandes_site_par_jour_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 300 $$;
-- Taille maximale d'une pièce jointe, avant chiffrement : 5 Mo
CREATE FUNCTION app.taille_piece_site_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 5 * 1024 * 1024 $$;
GRANT EXECUTE ON FUNCTION app.demandes_site_par_heure_max(), app.demandes_site_par_jour_max(),
  app.taille_piece_site_max() TO dbs_api;

-- ---------------------------------------------------------------------
-- Demandes
-- ---------------------------------------------------------------------
CREATE TABLE app.demandes_site (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numéro communiqué au visiteur, attribué par la base
  numero             bigint NOT NULL,
  branche            app.branche NOT NULL,
  profil             app.type_client NOT NULL,
  nom                text NOT NULL,
  telephone          text NOT NULL,
  email              text,
  commune            text,
  besoin             text,
  -- Texte exact de la case « j'accepte que l'agence utilise ces informations » cochée par le visiteur
  accord_traitement  text NOT NULL,
  -- Texte de la case « rappels sur WhatsApp », si le visiteur l'a cochée (sinon vide)
  accord_whatsapp    text,
  -- Empreinte HMAC de l'adresse IP (calculée par l'API avec une clé secrète) : limite les envois
  -- depuis une même adresse sans garder l'adresse elle-même
  empreinte_ip       bytea NOT NULL,
  recue_le           timestamptz NOT NULL DEFAULT now(),
  statut             app.statut_demande_site NOT NULL DEFAULT 'nouvelle',
  motif              text,
  client_id          uuid REFERENCES app.clients (id),
  devis_id           uuid REFERENCES app.devis (id),
  traitee_le         timestamptz,
  traitee_par        uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT demandes_site_numero_unique UNIQUE (numero),
  CONSTRAINT demandes_site_devis_unique UNIQUE (devis_id),
  CONSTRAINT demandes_site_nom_longueur CHECK (char_length(btrim(nom)) BETWEEN 2 AND 160),
  CONSTRAINT demandes_site_telephone_format CHECK (telephone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT demandes_site_email_format CHECK (email IS NULL OR (email = lower(email) AND char_length(email) <= 254
                                                                  AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')),
  CONSTRAINT demandes_site_commune_longueur CHECK (commune IS NULL OR char_length(commune) <= 80),
  CONSTRAINT demandes_site_besoin_longueur CHECK (besoin IS NULL OR char_length(besoin) <= 1500),
  CONSTRAINT demandes_site_accords_longueur CHECK (char_length(accord_traitement) BETWEEN 10 AND 300
                                                    AND (accord_whatsapp IS NULL OR char_length(accord_whatsapp) BETWEEN 10 AND 300)),
  CONSTRAINT demandes_site_empreinte_ip CHECK (octet_length(empreinte_ip) = 32),
  CONSTRAINT demandes_site_motif CHECK (statut <> 'sans_suite' OR char_length(btrim(coalesce(motif, ''))) >= 3),
  CONSTRAINT demandes_site_motif_longueur CHECK (motif IS NULL OR char_length(motif) <= 300),
  CONSTRAINT demandes_site_conversion CHECK (statut <> 'convertie' OR (client_id IS NOT NULL AND devis_id IS NOT NULL)),
  CONSTRAINT demandes_site_traitement CHECK ((statut = 'nouvelle') = (traitee_le IS NULL AND traitee_par IS NULL))
);
CREATE INDEX demandes_site_a_traiter_idx ON app.demandes_site (recue_le) WHERE statut = 'nouvelle';
CREATE INDEX demandes_site_limite_idx ON app.demandes_site (empreinte_ip, recue_le);
CREATE INDEX demandes_site_telephone_idx ON app.demandes_site (telephone);

-- Traitement d'une demande : une seule fois, par la personne connectée, à l'heure de la base.
-- Le devis lié doit être celui du client lié, et venir du site.
CREATE FUNCTION app.controler_demande_site() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.numero <> OLD.numero OR NEW.branche <> OLD.branche OR NEW.profil <> OLD.profil OR NEW.nom <> OLD.nom
     OR NEW.telephone <> OLD.telephone OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.commune IS DISTINCT FROM OLD.commune OR NEW.besoin IS DISTINCT FROM OLD.besoin
     OR NEW.accord_traitement <> OLD.accord_traitement OR NEW.accord_whatsapp IS DISTINCT FROM OLD.accord_whatsapp
     OR NEW.empreinte_ip <> OLD.empreinte_ip OR NEW.recue_le <> OLD.recue_le THEN
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

CREATE FUNCTION app.interdire_suppression_demande() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Une demande reçue par le site ne se supprime pas : classez-la sans suite'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER a_traitement BEFORE UPDATE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION app.controler_demande_site();
CREATE TRIGGER b_pas_de_suppression BEFORE DELETE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION app.interdire_suppression_demande();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Pièces jointes (carte grise), chiffrées par l'API
-- Pas de copie dans le journal d'audit : il recevrait le fichier entier. La réception est journalisée
-- avec la demande, chaque téléchargement dans le journal de sécurité (securite.evenements).
-- ---------------------------------------------------------------------
CREATE TABLE app.pieces_demandes_site (
  -- Fourni par l'API : il entre dans le contexte du chiffrement (« piece-site:<id> »), ce qui rend
  -- illisible un contenu recopié d'une pièce sur une autre
  id               uuid PRIMARY KEY,
  demande_id       uuid NOT NULL REFERENCES app.demandes_site (id),
  nature           text NOT NULL DEFAULT 'carte_grise',
  -- Type vérifié par l'API d'après le contenu du fichier, pas d'après son nom
  type_contenu     text NOT NULL,
  -- Taille du fichier en clair, en octets
  taille           integer NOT NULL,
  contenu_chiffre  bytea NOT NULL,
  -- SHA-256 du fichier en clair : contrôle d'intégrité après déchiffrement
  empreinte        bytea NOT NULL,
  recue_le         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pieces_demandes_site_une_par_demande UNIQUE (demande_id),
  CONSTRAINT pieces_demandes_site_nature CHECK (nature IN ('carte_grise')),
  CONSTRAINT pieces_demandes_site_type CHECK (type_contenu IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT pieces_demandes_site_taille CHECK (taille BETWEEN 1 AND app.taille_piece_site_max()),
  -- Version, vecteur d'initialisation et étiquette (29 octets) en plus du contenu
  CONSTRAINT pieces_demandes_site_chiffre CHECK (octet_length(contenu_chiffre) = taille + 29),
  CONSTRAINT pieces_demandes_site_empreinte CHECK (octet_length(empreinte) = 32)
);

CREATE FUNCTION app.interdire_modification_piece() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Une pièce jointe reçue par le site ne se modifie pas : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER a_ajout_seul BEFORE UPDATE OR DELETE ON app.pieces_demandes_site
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_piece();

-- ---------------------------------------------------------------------
-- Enregistrement d'une demande, sans utilisateur connecté (route publique de l'API).
-- SECURITY DEFINER : seule porte d'entrée, avec ses propres limites. Les envois sont traités un par un
-- (verrou) pour que les limites soient exactes même sous une rafale de requêtes.
-- ---------------------------------------------------------------------
CREATE FUNCTION app.enregistrer_demande_site(
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
  PERFORM pg_advisory_xact_lock(hashtext('app.demandes_site'));

  IF (SELECT count(*) FROM app.demandes_site d
      WHERE d.empreinte_ip = p_empreinte_ip AND d.recue_le > now() - interval '1 hour') >= app.demandes_site_par_heure_max() THEN
    RAISE EXCEPTION 'Trop de demandes envoyées depuis cette adresse'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demandes_site_limite_adresse';
  END IF;
  IF (SELECT count(*) FROM app.demandes_site d WHERE d.recue_le > now() - interval '24 hours') >= app.demandes_site_par_jour_max() THEN
    RAISE EXCEPTION 'Nombre de demandes du jour atteint'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'demandes_site_limite_jour';
  END IF;

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

GRANT EXECUTE ON FUNCTION app.enregistrer_demande_site(app.branche, app.type_client, text, text, text, text, text,
  text, text, bytea, uuid, text, integer, bytea, bytea) TO dbs_api;

-- ---------------------------------------------------------------------
-- Journal de sécurité : téléchargement d'une pièce jointe
-- ---------------------------------------------------------------------
ALTER TABLE securite.evenements DROP CONSTRAINT evenements_type;
ALTER TABLE securite.evenements ADD CONSTRAINT evenements_type CHECK (type IN (
  'connexion_reussie', 'connexion_echouee', 'mfa_echoue', 'compte_bloque', 'mfa_active',
  'mot_de_passe_modifie', 'acces_reinitialise', 'compte_cree', 'compte_modifie', 'deconnexion',
  'export_donnees', 'piece_telechargee'
));

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.demandes_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pieces_demandes_site ENABLE ROW LEVEL SECURITY;

-- Demandes : traitées par qui crée les clients et les devis ; l'auditeur les consulte.
-- Aucun droit d'insertion : seule app.enregistrer_demande_site en crée.
CREATE POLICY demandes_site_lecture ON app.demandes_site FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));
CREATE POLICY demandes_site_traitement ON app.demandes_site FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));

-- Pièces : document d'identification d'un véhicule et de son propriétaire, réservé à qui traite la demande
CREATE POLICY pieces_demandes_site_lecture ON app.pieces_demandes_site FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));

-- L'empreinte de l'adresse IP ne sert qu'aux limites : l'application ne la lit pas
GRANT SELECT (id, numero, branche, profil, nom, telephone, email, commune, besoin, accord_traitement, accord_whatsapp,
              recue_le, statut, motif, client_id, devis_id, traitee_le, traitee_par) ON app.demandes_site TO dbs_api;
GRANT UPDATE (statut, motif, client_id, devis_id) ON app.demandes_site TO dbs_api;
GRANT SELECT ON app.pieces_demandes_site TO dbs_api;
