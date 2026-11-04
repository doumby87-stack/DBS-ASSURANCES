-- =====================================================================
-- 0008 · Demandes du site : durée de conservation et analyse antivirus des pièces
--
--   · journal d'audit : une table peut demander que certaines colonnes ne soient pas recopiées.
--     Les demandes du site l'utilisent pour leurs données personnelles : sans cela, le journal (gardé
--     des années, en ajout seul) conserverait le nom et le téléphone d'un prospect bien après la purge ;
--   · purge : une demande qui n'est pas devenue un devis est supprimée 12 mois après son classement sans
--     suite (ou après sa réception si personne ne l'a traitée), avec sa carte grise. Seule la fonction
--     app.purger_demandes_site peut supprimer, et uniquement ces demandes-là ;
--   · antivirus : chaque pièce porte le résultat de son analyse (à analyser, saine, infectée). L'API la
--     fait analyser à la réception et à chaque téléchargement ; une pièce infectée perd son contenu.
--     Le résultat ne s'enregistre que par app.enregistrer_analyse_piece.
-- Conception : docs/architecture/adr/0009-demandes-de-devis-du-site.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- Journal d'audit : colonnes à ne pas recopier, passées en arguments du déclencheur.
-- Sans argument (toutes les autres tables), rien ne change.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.journaliser() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_utilisateur uuid := nullif(current_setting('app.utilisateur_id', true), '')::uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_ligne text;
  v_precedente bytea;
  v_horodatage timestamptz;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_avant := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_apres := to_jsonb(NEW); END IF;
  v_ligne := coalesce(v_apres, v_avant) ->> 'id';
  IF TG_NARGS > 0 THEN
    v_avant := v_avant - TG_ARGV;
    v_apres := v_apres - TG_ARGV;
  END IF;

  -- Une écriture à la fois dans le journal, jusqu'à la fin de la transaction : la chaîne reste linéaire
  PERFORM pg_advisory_xact_lock(hashtext('audit.journal'));
  v_horodatage := clock_timestamp();
  SELECT j.empreinte INTO v_precedente FROM audit.journal j ORDER BY j.id DESC LIMIT 1;

  INSERT INTO audit.journal (horodatage, utilisateur_id, role_bd, operation, table_nom, ligne_id,
                             avant, apres, empreinte_precedente, empreinte)
  VALUES (v_horodatage, v_utilisateur, session_user, TG_OP, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_ligne,
          v_avant, v_apres, v_precedente,
          audit.calculer_empreinte(v_precedente, v_horodatage, v_utilisateur, session_user, TG_OP,
                                   TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_ligne, v_avant, v_apres));
  RETURN NULL;
END
$$;

-- Demandes du site : le journal garde qui a fait quoi et quand (réception, traitement, purge),
-- pas qui était le prospect
DROP TRIGGER z_journal ON app.demandes_site;
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('nom', 'telephone', 'email', 'commune', 'besoin', 'empreinte_ip');

-- ---------------------------------------------------------------------
-- Analyse antivirus des pièces
-- ---------------------------------------------------------------------
CREATE TYPE app.analyse_piece AS ENUM ('a_analyser', 'saine', 'infectee');

ALTER TABLE app.pieces_demandes_site
  ADD COLUMN etat_analyse app.analyse_piece NOT NULL DEFAULT 'a_analyser',
  ADD COLUMN analysee_le timestamptz,
  -- Nom de la menace trouvée par l'antivirus
  ADD COLUMN signature_detectee text,
  -- Une pièce infectée ne garde pas son contenu
  ALTER COLUMN contenu_chiffre DROP NOT NULL,
  ADD CONSTRAINT pieces_demandes_site_contenu CHECK ((etat_analyse = 'infectee') = (contenu_chiffre IS NULL)),
  ADD CONSTRAINT pieces_demandes_site_signature CHECK ((etat_analyse = 'infectee') = (signature_detectee IS NOT NULL)
                                                       AND (signature_detectee IS NULL OR char_length(signature_detectee) <= 200)),
  ADD CONSTRAINT pieces_demandes_site_analysee CHECK ((etat_analyse = 'a_analyser') = (analysee_le IS NULL));

-- ---------------------------------------------------------------------
-- Gardiens : une demande ou une pièce ne se supprime que pendant la purge ; une pièce ne se modifie
-- que pour enregistrer son analyse (jamais après une infection, jamais son fichier ni son type).
-- Les deux réglages ci-dessous ne sont posés que par les fonctions plus bas : l'application n'a ni
-- droit de suppression ni droit de modification sur ces tables, quel que soit le réglage.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.interdire_suppression_demande() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_setting('app.purge_demandes_site', true) = 'oui' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Une demande reçue par le site ne se supprime pas : classez-la sans suite'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE FUNCTION app.controler_piece_site() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.purge_demandes_site', true) = 'oui' THEN
      RETURN OLD;
    END IF;
  ELSIF current_setting('app.analyse_piece_site', true) = 'oui'
        AND OLD.etat_analyse <> 'infectee'
        AND NEW.id = OLD.id AND NEW.demande_id = OLD.demande_id AND NEW.nature = OLD.nature
        AND NEW.type_contenu = OLD.type_contenu AND NEW.taille = OLD.taille AND NEW.empreinte = OLD.empreinte
        AND NEW.recue_le = OLD.recue_le
        AND (NEW.contenu_chiffre IS NOT DISTINCT FROM OLD.contenu_chiffre OR NEW.etat_analyse = 'infectee') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Une pièce jointe reçue par le site ne se modifie pas : % interdit', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER a_ajout_seul ON app.pieces_demandes_site;
DROP FUNCTION app.interdire_modification_piece();
CREATE TRIGGER a_ajout_seul BEFORE UPDATE OR DELETE ON app.pieces_demandes_site
  FOR EACH ROW EXECUTE FUNCTION app.controler_piece_site();

-- Verdict de l'antivirus. Infectée : le contenu est effacé, la menace notée ; c'est définitif.
-- Saine : la date de la dernière analyse est mise à jour (nouvelle analyse à chaque téléchargement).
-- Renvoie false si la pièce n'existe pas ou était déjà infectée.
CREATE FUNCTION app.enregistrer_analyse_piece(p_piece uuid, p_saine boolean, p_signature text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  PERFORM set_config('app.analyse_piece_site', 'oui', true);
  IF p_saine THEN
    UPDATE app.pieces_demandes_site SET etat_analyse = 'saine', analysee_le = now()
    WHERE id = p_piece AND etat_analyse <> 'infectee';
  ELSE
    UPDATE app.pieces_demandes_site
    SET etat_analyse = 'infectee', analysee_le = now(), contenu_chiffre = NULL,
        signature_detectee = left(coalesce(nullif(btrim(p_signature), ''), 'Menace sans nom'), 200)
    WHERE id = p_piece AND etat_analyse <> 'infectee';
  END IF;
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  PERFORM set_config('app.analyse_piece_site', '', true);
  RETURN v_nombre = 1;
END
$$;

-- Pièces reçues pendant que l'antivirus était indisponible, à analyser par la maintenance de l'API
-- (qui travaille sans utilisateur connecté). Contenu chiffré : seule l'API peut le lire.
CREATE FUNCTION app.pieces_a_analyser(p_limite integer)
RETURNS TABLE (id uuid, contenu_chiffre bytea, empreinte bytea)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.id, p.contenu_chiffre, p.empreinte FROM app.pieces_demandes_site p
  WHERE p.etat_analyse = 'a_analyser'
  ORDER BY p.recue_le
  LIMIT greatest(least(p_limite, 50), 0)
$$;

-- ---------------------------------------------------------------------
-- Conservation : 12 mois pour une demande qui n'est pas devenue un devis
-- (registre des traitements, docs/conformite/donnees-personnelles.md)
-- ---------------------------------------------------------------------
CREATE FUNCTION app.conservation_demandes_site() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '12 months' $$;

-- Supprime les demandes sans suite depuis plus de 12 mois, et celles jamais traitées reçues il y a plus
-- de 12 mois, avec leur carte grise. Une demande convertie reste : elle fait partie du dossier du client.
-- Renvoie le nombre de demandes supprimées.
CREATE FUNCTION app.purger_demandes_site() RETURNS integer
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
    AND coalesce(d.traitee_le, d.recue_le) < now() - app.conservation_demandes_site();
  DELETE FROM app.demandes_site d
  WHERE d.statut <> 'convertie'
    AND coalesce(d.traitee_le, d.recue_le) < now() - app.conservation_demandes_site();
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  PERFORM set_config('app.purge_demandes_site', '', true);
  RETURN v_nombre;
END
$$;

GRANT EXECUTE ON FUNCTION app.enregistrer_analyse_piece(uuid, boolean, text), app.pieces_a_analyser(integer),
  app.conservation_demandes_site(), app.purger_demandes_site() TO dbs_api;
