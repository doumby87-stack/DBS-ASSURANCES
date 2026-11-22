-- =====================================================================
-- 0018 · Demande de devis du site adaptée à chaque assurance : réponses au questionnaire et pièces jointes
--
-- Jusqu'ici une demande de devis portait un texte libre et, pour un véhicule, une carte grise. Le formulaire
-- pose désormais les questions propres à l'assurance choisie (pour une flotte : nombre et types de véhicules,
-- usage, zones de circulation, assureur actuel…) et propose les documents utiles (pour une flotte : la liste des
-- véhicules en Excel, les cartes grises, l'attestation actuelle, le registre de commerce, la carte de transport).
-- Ce qui change :
--   · app.demandes_site.details : les réponses, en JSON, validées par l'API (questionnaires.ts), seulement pour
--     un devis ; hors du journal d'audit comme les coordonnées du visiteur, et jamais modifiées ensuite ;
--   · app.pieces_demandes_site : plusieurs pièces par demande, dans l'ordre d'envoi (rang), onze natures, et le
--     classeur Excel (.xlsx) accepté pour les listes (véhicules, matériel, personnes) ; 6 pièces et 20 Mo au plus ;
--   · app.enregistrer_demande_site : reçoit les réponses et les pièces (tableaux, une entrée par pièce). L'ancienne
--     signature (une carte grise) reste, et passe par la nouvelle.
-- L'API choisit les natures permises pour chaque assurance (pieces-site.ts) ; la base garantit le vocabulaire,
-- les types, les tailles et les limites. Antivirus, chiffrement, purge et droits de lecture (0007, 0008, 0015)
-- s'appliquent pièce par pièce, sans changement. Conception : docs/architecture/adr/0009-demandes-de-devis-du-site.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Réponses au questionnaire de l'assurance choisie
-- ---------------------------------------------------------------------
ALTER TABLE app.demandes_site
  ADD COLUMN details jsonb,
  ADD CONSTRAINT demandes_site_details_forme CHECK (
    details IS NULL OR (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4000)),
  ADD CONSTRAINT demandes_site_details_devis CHECK (details IS NULL OR nature = 'devis');

COMMENT ON COLUMN app.demandes_site.details IS
  'Réponses du visiteur aux questions de l''assurance choisie (clé de la question → réponse), validées par l''API.';

-- Texte libre du visiteur : hors du journal d'audit, comme ses coordonnées et l'appel d'offres
DROP TRIGGER z_journal ON app.demandes_site;
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.demandes_site
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('nom', 'telephone', 'email', 'commune', 'besoin', 'empreinte_ip',
                                                  'appel_offres', 'details');

-- Ce que le visiteur a envoyé ne se modifie pas, réponses comprises
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
     OR NEW.details IS DISTINCT FROM OLD.details
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

GRANT SELECT (details) ON app.demandes_site TO dbs_api;

-- ---------------------------------------------------------------------
-- Pièces : plusieurs par demande (6 au plus, 20 Mo en tout ; chacune 5 Mo au plus, comme en 0007)
-- ---------------------------------------------------------------------
CREATE FUNCTION app.pieces_site_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 6 $$;

CREATE FUNCTION app.taille_pieces_site_total_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 20 * 1024 * 1024 $$;

GRANT EXECUTE ON FUNCTION app.pieces_site_max(), app.taille_pieces_site_total_max() TO dbs_api;

ALTER TABLE app.pieces_demandes_site
  DROP CONSTRAINT pieces_demandes_site_une_par_demande,
  DROP CONSTRAINT pieces_demandes_site_nature,
  DROP CONSTRAINT pieces_demandes_site_type,
  -- Ordre dans lequel le visiteur a joint ses pièces (une pièce déjà reçue était seule : rang 1)
  ADD COLUMN rang smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT pieces_demandes_site_rang CHECK (rang BETWEEN 1 AND app.pieces_site_max()),
  ADD CONSTRAINT pieces_demandes_site_rang_unique UNIQUE (demande_id, rang),
  ADD CONSTRAINT pieces_demandes_site_nature CHECK (nature IN (
    'carte_grise', 'attestation_precedente', 'liste_vehicules', 'carte_transport', 'registre_commerce',
    'photos_bien', 'devis_travaux', 'liste_materiel', 'liste_personnes', 'cahier_des_charges', 'autre')),
  ADD CONSTRAINT pieces_demandes_site_type CHECK (type_contenu IN (
    'image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  -- Un classeur ne se joint que comme liste ; une carte grise ou une attestation reste une photo ou un PDF
  ADD CONSTRAINT pieces_demandes_site_classeur CHECK (
    type_contenu <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    OR nature IN ('liste_vehicules', 'liste_materiel', 'liste_personnes'));

ALTER TABLE app.pieces_demandes_site ALTER COLUMN nature DROP DEFAULT;

COMMENT ON COLUMN app.pieces_demandes_site.nature IS
  'Ce que le visiteur a joint (carte_grise, liste_vehicules, attestation_precedente…). Les natures proposées dépendent de l''assurance (API).';

-- ---------------------------------------------------------------------
-- Demande de devis : réponses et pièces (une entrée par pièce dans chaque tableau)
-- ---------------------------------------------------------------------
CREATE FUNCTION app.enregistrer_demande_site(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_details jsonb, p_pieces_ids uuid[], p_pieces_natures text[], p_pieces_types text[], p_pieces_tailles integer[],
  p_pieces_contenus bytea[], p_pieces_empreintes bytea[])
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_numero bigint;
  v_nombre integer := coalesce(cardinality(p_pieces_ids), 0);
BEGIN
  IF v_nombre > 0 AND (cardinality(p_pieces_natures) IS DISTINCT FROM v_nombre
     OR cardinality(p_pieces_types) IS DISTINCT FROM v_nombre OR cardinality(p_pieces_tailles) IS DISTINCT FROM v_nombre
     OR cardinality(p_pieces_contenus) IS DISTINCT FROM v_nombre OR cardinality(p_pieces_empreintes) IS DISTINCT FROM v_nombre) THEN
    RAISE EXCEPTION 'Pièces jointes incomplètes : chaque pièce a sa nature, son type, sa taille, son contenu et son empreinte'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_tableaux';
  END IF;
  IF v_nombre > app.pieces_site_max() THEN
    RAISE EXCEPTION '% pièces jointes au plus par demande', app.pieces_site_max()
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_nombre';
  END IF;
  IF v_nombre > 0 AND (SELECT sum(t) FROM unnest(p_pieces_tailles) AS t) > app.taille_pieces_site_total_max() THEN
    RAISE EXCEPTION 'Les pièces jointes dépassent ensemble % octets', app.taille_pieces_site_total_max()
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_taille_totale';
  END IF;

  PERFORM app.controler_limites_site(p_empreinte_ip);

  INSERT INTO app.demandes_site AS d (numero, branche, profil, nom, telephone, email, commune, besoin,
                                      accord_traitement, accord_whatsapp, empreinte_ip, details)
  VALUES (app.numero_suivant('demandes_site'), p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_commune), ''), nullif(btrim(p_besoin), ''),
          p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip,
          CASE WHEN p_details = '{}'::jsonb THEN NULL ELSE p_details END)
  RETURNING d.id, d.numero INTO v_id, v_numero;

  IF v_nombre > 0 THEN
    INSERT INTO app.pieces_demandes_site (id, demande_id, rang, nature, type_contenu, taille, contenu_chiffre, empreinte)
    SELECT p.id, v_id, p.rang, p.nature, p.type_contenu, p.taille, p.contenu, p.empreinte
    FROM unnest(p_pieces_ids, p_pieces_natures, p_pieces_types, p_pieces_tailles, p_pieces_contenus, p_pieces_empreintes)
           WITH ORDINALITY AS p (id, nature, type_contenu, taille, contenu, empreinte, rang);
  END IF;

  RETURN QUERY SELECT v_id, v_numero;
END
$$;

GRANT EXECUTE ON FUNCTION app.enregistrer_demande_site(app.branche, app.type_client, text, text, text, text, text,
  text, text, bytea, jsonb, uuid[], text[], text[], integer[], bytea[], bytea[]) TO dbs_api;

-- Ancienne signature (une carte grise au plus) : passe par la nouvelle, pour les versions de l'API et les
-- scripts qui l'appellent encore
CREATE OR REPLACE FUNCTION app.enregistrer_demande_site(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_piece_id uuid, p_piece_type text, p_piece_taille integer, p_piece_contenu bytea, p_piece_empreinte bytea)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT * FROM app.enregistrer_demande_site(
    p_branche, p_profil, p_nom, p_telephone, p_email, p_commune, p_besoin, p_accord_traitement, p_accord_whatsapp,
    p_empreinte_ip, NULL::jsonb,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY[p_piece_id] END,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY['carte_grise'] END,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY[p_piece_type] END,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY[p_piece_taille] END,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY[p_piece_contenu] END,
    CASE WHEN p_piece_contenu IS NULL THEN NULL ELSE ARRAY[p_piece_empreinte] END)
$$;
