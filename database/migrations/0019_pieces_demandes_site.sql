-- =====================================================================
-- 0019 · Pièces jointes aux demandes du site : plusieurs documents, selon l'assurance
--
-- Jusqu'ici une demande de devis pouvait porter une seule pièce, la carte grise (auto, moto, flotte). Pour que
-- l'agence puisse coter sans rappeler le visiteur, une demande (devis, rappel d'échéance, appel d'offres) reçoit
-- désormais jusqu'à quatre documents, choisis selon l'assurance : carte grise, attestation ou contrat actuel,
-- liste des véhicules, carte de transport, registre de commerce, photos du bien, devis de travaux, liste du
-- matériel, cahier des charges, ou tout autre document utile. Ce qui change :
--   · app.pieces_demandes_site : plusieurs pièces par demande, dans l'ordre où le visiteur les a jointes (rang),
--     dix natures, et le classeur Excel (.xlsx) accepté pour les listes (véhicules, matériel) ; 4 pièces et 12 Mo
--     au plus par demande ;
--   · app.joindre_pieces_demande_site : rattache les pièces d'un seul bloc, en contrôlant nombre et poids total ;
--   · app.enregistrer_demande_site, app.enregistrer_rappel_echeance, app.enregistrer_appel_offres : reçoivent
--     les pièces sous forme de tableaux (une entrée par pièce), facultatifs.
-- Le choix des natures permises pour chaque assurance est fait par l'API (pieces-site.ts), seule à appeler ces
-- fonctions ; la base garantit le vocabulaire, les types, les tailles et les limites. L'analyse antivirus,
-- le chiffrement, la purge et les droits de lecture (0007, 0008, 0015) s'appliquent pièce par pièce, sans
-- changement. Conception : docs/architecture/adr/0009-demandes-de-devis-du-site.md (complément).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Limites : nombre de pièces et poids total par demande (chaque pièce reste limitée à 5 Mo, 0007)
-- ---------------------------------------------------------------------
CREATE FUNCTION app.pieces_site_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 4 $$;

CREATE FUNCTION app.taille_pieces_site_total_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 12 * 1024 * 1024 $$;

GRANT EXECUTE ON FUNCTION app.pieces_site_max(), app.taille_pieces_site_total_max() TO dbs_api;

-- ---------------------------------------------------------------------
-- La table : plusieurs pièces par demande, dix natures, classeur Excel pour les listes seulement
-- ---------------------------------------------------------------------
ALTER TABLE app.pieces_demandes_site
  DROP CONSTRAINT pieces_demandes_site_une_par_demande,
  DROP CONSTRAINT pieces_demandes_site_nature,
  DROP CONSTRAINT pieces_demandes_site_type,
  -- Ordre dans lequel le visiteur a joint ses pièces (les pièces déjà reçues étaient seules : rang 1)
  ADD COLUMN rang smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT pieces_demandes_site_rang CHECK (rang BETWEEN 1 AND app.pieces_site_max()),
  ADD CONSTRAINT pieces_demandes_site_rang_unique UNIQUE (demande_id, rang),
  ADD CONSTRAINT pieces_demandes_site_nature CHECK (nature IN (
    'carte_grise', 'attestation_precedente', 'liste_vehicules', 'carte_transport', 'registre_commerce',
    'photos_bien', 'devis_travaux', 'liste_materiel', 'cahier_des_charges', 'autre')),
  ADD CONSTRAINT pieces_demandes_site_type CHECK (type_contenu IN (
    'image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  -- Un classeur ne se joint que comme liste (de véhicules, de matériel) ; une carte grise reste une photo ou un PDF
  ADD CONSTRAINT pieces_demandes_site_classeur CHECK (
    type_contenu <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    OR nature IN ('liste_vehicules', 'liste_materiel'));


COMMENT ON COLUMN app.pieces_demandes_site.nature IS
  'Ce que le visiteur a joint : carte_grise, attestation_precedente, liste_vehicules, carte_transport, registre_commerce, '
  'photos_bien, devis_travaux, liste_materiel, cahier_des_charges ou autre. Les natures proposées dépendent de l''assurance (API).';

-- ---------------------------------------------------------------------
-- Rattachement des pièces d'une demande, d'un seul bloc : une entrée par pièce dans chaque tableau.
-- Réservée aux fonctions d'enregistrement ci-dessous (pas de droit d'exécution).
-- ---------------------------------------------------------------------
CREATE FUNCTION app.joindre_pieces_demande_site(
  p_demande uuid, p_ids uuid[], p_natures text[], p_types text[], p_tailles integer[],
  p_contenus bytea[], p_empreintes bytea[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer := coalesce(cardinality(p_ids), 0);
BEGIN
  IF v_nombre = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_natures) IS DISTINCT FROM v_nombre OR cardinality(p_types) IS DISTINCT FROM v_nombre
     OR cardinality(p_tailles) IS DISTINCT FROM v_nombre OR cardinality(p_contenus) IS DISTINCT FROM v_nombre
     OR cardinality(p_empreintes) IS DISTINCT FROM v_nombre THEN
    RAISE EXCEPTION 'Pièces jointes incomplètes : chaque pièce doit avoir sa nature, son type, sa taille, son contenu et son empreinte'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_tableaux';
  END IF;
  IF v_nombre > app.pieces_site_max() THEN
    RAISE EXCEPTION '% pièces jointes au plus par demande', app.pieces_site_max()
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_nombre';
  END IF;
  IF (SELECT sum(t) FROM unnest(p_tailles) AS t) > app.taille_pieces_site_total_max() THEN
    RAISE EXCEPTION 'Les pièces jointes dépassent ensemble % octets', app.taille_pieces_site_total_max()
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pieces_demandes_site_taille_totale';
  END IF;

  INSERT INTO app.pieces_demandes_site (id, demande_id, rang, nature, type_contenu, taille, contenu_chiffre, empreinte)
  SELECT p.id, p_demande, p.rang, p.nature, p.type_contenu, p.taille, p.contenu, p.empreinte
  FROM unnest(p_ids, p_natures, p_types, p_tailles, p_contenus, p_empreintes) WITH ORDINALITY
         AS p (id, nature, type_contenu, taille, contenu, empreinte, rang);
  RETURN v_nombre;
END
$$;

REVOKE ALL ON FUNCTION app.joindre_pieces_demande_site(uuid, uuid[], text[], text[], integer[], bytea[], bytea[]) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Demande de devis : les pièces remplacent la carte grise unique (0007, 0015)
-- ---------------------------------------------------------------------
DROP FUNCTION app.enregistrer_demande_site(app.branche, app.type_client, text, text, text, text, text, text, text, bytea,
                                           uuid, text, integer, bytea, bytea);

CREATE FUNCTION app.enregistrer_demande_site(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_pieces_ids uuid[] DEFAULT NULL, p_pieces_natures text[] DEFAULT NULL, p_pieces_types text[] DEFAULT NULL,
  p_pieces_tailles integer[] DEFAULT NULL, p_pieces_contenus bytea[] DEFAULT NULL, p_pieces_empreintes bytea[] DEFAULT NULL)
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

  PERFORM app.joindre_pieces_demande_site(v_id, p_pieces_ids, p_pieces_natures, p_pieces_types, p_pieces_tailles,
                                          p_pieces_contenus, p_pieces_empreintes);

  RETURN QUERY SELECT v_id, v_numero;
END
$$;

-- ---------------------------------------------------------------------
-- Rappel d'échéance : l'attestation ou le contrat actuel peut être joint (mêmes règles qu'en 0015)
-- ---------------------------------------------------------------------
DROP FUNCTION app.enregistrer_rappel_echeance(app.branche, app.type_client, text, text, text, date, text, text, bytea);

CREATE FUNCTION app.enregistrer_rappel_echeance(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_echeance date, p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_pieces_ids uuid[] DEFAULT NULL, p_pieces_natures text[] DEFAULT NULL, p_pieces_types text[] DEFAULT NULL,
  p_pieces_tailles integer[] DEFAULT NULL, p_pieces_contenus bytea[] DEFAULT NULL, p_pieces_empreintes bytea[] DEFAULT NULL)
RETURNS TABLE (id uuid, numero bigint, a_traiter_le date)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_numero bigint;
  v_a_traiter_le date;
BEGIN
  IF p_echeance IS NULL OR p_echeance < app.aujourdhui() OR p_echeance > (app.aujourdhui() + interval '13 months')::date THEN
    RAISE EXCEPTION 'La date d''échéance doit être comprise entre aujourd''hui et les 13 prochains mois.'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM app.controler_limites_site(p_empreinte_ip);

  INSERT INTO app.demandes_site AS d (numero, nature, branche, profil, nom, telephone, email, echeance_actuelle,
                                      a_traiter_le, accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('demandes_site'), 'rappel_echeance', p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), p_echeance,
          greatest(app.aujourdhui(), p_echeance - app.rappel_echeance_avance()),
          p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING d.id, d.numero, d.a_traiter_le INTO v_id, v_numero, v_a_traiter_le;

  PERFORM app.joindre_pieces_demande_site(v_id, p_pieces_ids, p_pieces_natures, p_pieces_types, p_pieces_tailles,
                                          p_pieces_contenus, p_pieces_empreintes);

  RETURN QUERY SELECT v_id, v_numero, v_a_traiter_le;
END
$$;

-- ---------------------------------------------------------------------
-- Appel d'offres : cahier des charges, parc, registre de commerce, assureur actuel (mêmes règles qu'en 0015)
-- ---------------------------------------------------------------------
DROP FUNCTION app.enregistrer_appel_offres(app.branche, app.type_client, text, text, text, text, text, date, jsonb, text, text, bytea);

CREATE FUNCTION app.enregistrer_appel_offres(
  p_branche app.branche, p_profil app.type_client, p_nom text, p_telephone text, p_email text,
  p_commune text, p_besoin text, p_date_limite date, p_appel_offres jsonb,
  p_accord_traitement text, p_accord_whatsapp text, p_empreinte_ip bytea,
  p_pieces_ids uuid[] DEFAULT NULL, p_pieces_natures text[] DEFAULT NULL, p_pieces_types text[] DEFAULT NULL,
  p_pieces_tailles integer[] DEFAULT NULL, p_pieces_contenus bytea[] DEFAULT NULL, p_pieces_empreintes bytea[] DEFAULT NULL)
RETURNS TABLE (id uuid, numero bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_numero bigint;
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

  INSERT INTO app.demandes_site AS d (numero, nature, branche, profil, nom, telephone, email, commune, besoin,
                                      date_limite_offre, appel_offres, accord_traitement, accord_whatsapp, empreinte_ip)
  VALUES (app.numero_suivant('demandes_site'), 'appel_offres', p_branche, p_profil, btrim(p_nom), p_telephone,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_commune), ''), nullif(btrim(p_besoin), ''),
          p_date_limite, p_appel_offres, p_accord_traitement, nullif(btrim(p_accord_whatsapp), ''), p_empreinte_ip)
  RETURNING d.id, d.numero INTO v_id, v_numero;

  PERFORM app.joindre_pieces_demande_site(v_id, p_pieces_ids, p_pieces_natures, p_pieces_types, p_pieces_tailles,
                                          p_pieces_contenus, p_pieces_empreintes);

  RETURN QUERY SELECT v_id, v_numero;
END
$$;

-- ---------------------------------------------------------------------
-- Droits : les trois portes d'entrée du site restent réservées à l'API
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  app.enregistrer_demande_site(app.branche, app.type_client, text, text, text, text, text, text, text, bytea,
                               uuid[], text[], text[], integer[], bytea[], bytea[]),
  app.enregistrer_rappel_echeance(app.branche, app.type_client, text, text, text, date, text, text, bytea,
                                  uuid[], text[], text[], integer[], bytea[], bytea[]),
  app.enregistrer_appel_offres(app.branche, app.type_client, text, text, text, text, text, date, jsonb, text, text, bytea,
                               uuid[], text[], text[], integer[], bytea[], bytea[])
  TO dbs_api;
