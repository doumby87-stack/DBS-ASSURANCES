-- =====================================================================
-- 0013 · Espace client des particuliers, paiement en ligne, déclaration des sinistres (tâche 9)
--
--   · le portail (0012) s'ouvre aux particuliers : un seul accès, le leur, créé par l'agence ou, à la
--     première demande de code, automatiquement pour le numéro que l'agence a enregistré sur leur fiche ;
--   · paiement d'une prime en ligne (Mobile Money) : la base trace chaque paiement demandé et n'enregistre
--     l'encaissement qu'après la confirmation du prestataire, vérifiée par l'API. Un paiement en ligne n'entre
--     dans la caisse d'aucun caissier ; il part au bordereau de reversement comme les autres ;
--   · déclaration d'un sinistre depuis le portail, avec ses photos et documents (analysés, chiffrés) : la
--     déclaration arrive à l'agence, qui la suit comme les autres.
-- Conception : docs/architecture/adr/0012-espace-client-et-paiement-en-ligne.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- Accès des particuliers
-- ---------------------------------------------------------------------
ALTER TABLE app.gestionnaires_portail ADD COLUMN cree_automatiquement boolean NOT NULL DEFAULT false;
ALTER TABLE app.gestionnaires_portail DROP CONSTRAINT gestionnaires_portail_auteur;
ALTER TABLE app.gestionnaires_portail ADD CONSTRAINT gestionnaires_portail_auteur
  CHECK ((cree_par IS NOT NULL)::int + (cree_par_gestionnaire IS NOT NULL)::int + cree_automatiquement::int = 1);

DROP TRIGGER a_auteur ON app.gestionnaires_portail;
CREATE TRIGGER a_auteur BEFORE INSERT ON app.gestionnaires_portail
  FOR EACH ROW WHEN (NEW.cree_par_gestionnaire IS NULL AND NOT NEW.cree_automatiquement)
  EXECUTE FUNCTION securite.renseigner_auteur('cree_par');

-- Entreprises et professionnels : plusieurs accès. Particulier : un seul, le sien, titulaire.
CREATE OR REPLACE FUNCTION app.controler_gestionnaire() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_type app.type_client;
BEGIN
  SELECT c.type INTO v_type FROM app.clients c WHERE c.id = NEW.client_id;
  IF TG_OP = 'UPDATE' AND (NEW.client_id <> OLD.client_id OR NEW.telephone <> OLD.telephone
                           OR NEW.cree_le <> OLD.cree_le OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
                           OR NEW.cree_par_gestionnaire IS DISTINCT FROM OLD.cree_par_gestionnaire
                           OR NEW.cree_automatiquement <> OLD.cree_automatiquement) THEN
    RAISE EXCEPTION 'Un accès au portail ne change ni de client ni de numéro : désactivez-le et créez-en un autre.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_type = 'particulier' AND NEW.actif THEN
    IF NEW.role <> 'titulaire' THEN
      RAISE EXCEPTION 'Un particulier a un seul accès, le sien : choisissez le rôle titulaire.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM app.gestionnaires_portail g WHERE g.client_id = NEW.client_id AND g.actif AND g.id <> NEW.id) THEN
      RAISE EXCEPTION 'Ce client a déjà un accès à l''espace client.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.actif THEN
    NEW.desactive_le := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.actif THEN
    NEW.desactive_le := now();
  END IF;
  RETURN NEW;
END
$$;

-- Le titulaire d'un particulier n'a pas de collaborateurs
CREATE OR REPLACE FUNCTION portail.ajouter_gestionnaire(p_nom text, p_telephone text, p_ip inet) RETURNS uuid
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
  IF EXISTS (SELECT 1 FROM app.clients c WHERE c.id = v_moi.client_id AND c.type = 'particulier') THEN
    RAISE EXCEPTION 'Les collaborateurs sont réservés aux entreprises.' USING ERRCODE = 'check_violation';
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

-- Demande de code (0012), avec l'ouverture automatique de l'espace d'un particulier : son numéro est celui
-- que l'agence a enregistré sur sa fiche (un seul client particulier, au moins un contrat), et il n'a jamais
-- eu d'accès (un accès retiré par l'agence ne se rouvre pas tout seul). La réponse reste la même pour tous.
CREATE OR REPLACE FUNCTION portail.preparer_code(p_telephone text, p_empreinte bytea, p_ip inet, p_duree interval)
RETURNS TABLE (statut text, gestionnaire_id uuid, nom text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gestionnaire app.gestionnaires_portail;
  v_client app.clients;
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
    SELECT c.* INTO v_client FROM app.clients c
    WHERE c.telephone = p_telephone AND c.type = 'particulier'
      AND EXISTS (SELECT 1 FROM app.contrats k WHERE k.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM app.gestionnaires_portail g WHERE g.client_id = c.id)
      AND (SELECT count(*) FROM app.clients d WHERE d.telephone = p_telephone) = 1;
    IF FOUND THEN
      INSERT INTO app.gestionnaires_portail (client_id, nom, telephone, role, cree_automatiquement)
      VALUES (v_client.id, left(v_client.nom, 120), p_telephone, 'titulaire', true)
      RETURNING * INTO v_gestionnaire;
    END IF;
  END IF;
  IF v_gestionnaire.id IS NULL THEN
    INSERT INTO portail.evenements (type, telephone, adresse_ip) VALUES ('code_refuse', p_telephone, p_ip);
    RETURN QUERY SELECT 'inconnu'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  UPDATE portail.codes_connexion c SET annule_le = now()
  WHERE c.gestionnaire_id = v_gestionnaire.id AND c.utilise_le IS NULL AND c.annule_le IS NULL;
  INSERT INTO portail.codes_connexion (gestionnaire_id, empreinte, expire_le, adresse_ip)
  VALUES (v_gestionnaire.id, p_empreinte, now() + p_duree, p_ip);
  INSERT INTO portail.evenements (type, gestionnaire_id, telephone, adresse_ip)
  VALUES ('code_envoye', v_gestionnaire.id, p_telephone, p_ip);
  RETURN QUERY SELECT 'envoyer'::text, v_gestionnaire.id, v_gestionnaire.nom;
END
$$;

-- La session dit aussi le type de client (l'espace s'adapte : flotte d'une entreprise, contrats d'un particulier)
DROP FUNCTION portail.lire_session(bytea, interval);
CREATE FUNCTION portail.lire_session(p_empreinte bytea, p_inactivite interval)
RETURNS TABLE (gestionnaire_id uuid, client_id uuid, nom text, telephone text, role app.role_gestionnaire,
               entreprise text, type_client app.type_client, expire_le timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE portail.sessions s SET derniere_activite_le = now()
  FROM app.gestionnaires_portail g JOIN app.clients c ON c.id = g.client_id
  WHERE s.empreinte = p_empreinte AND g.id = s.gestionnaire_id AND g.actif
    AND s.expire_le > now() AND s.derniere_activite_le > now() - p_inactivite
  RETURNING g.id, g.client_id, g.nom, g.telephone, g.role, c.nom, c.type, s.expire_le;
END
$$;
REVOKE ALL ON FUNCTION portail.lire_session(bytea, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portail.lire_session(bytea, interval) TO dbs_api;

-- ---------------------------------------------------------------------
-- Paiement en ligne d'une prime
-- ---------------------------------------------------------------------
CREATE TYPE app.statut_paiement_en_ligne AS ENUM ('initie', 'en_attente', 'accepte', 'refuse', 'abandonne', 'a_regulariser');

CREATE TABLE app.paiements_en_ligne (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Numéro continu, et référence transmise au prestataire (une transaction, une référence)
  numero               bigint NOT NULL,
  reference            text NOT NULL,
  contrat_id           uuid NOT NULL REFERENCES app.contrats (id),
  gestionnaire_id      uuid NOT NULL REFERENCES app.gestionnaires_portail (id),
  montant              bigint NOT NULL,
  prestataire          text NOT NULL,
  statut               app.statut_paiement_en_ligne NOT NULL DEFAULT 'initie',
  cree_le              timestamptz NOT NULL DEFAULT now(),
  modifie_le           timestamptz NOT NULL DEFAULT now(),
  -- Remis par le prestataire : page de paiement, moyen utilisé (Wave, Orange Money…), n° de l'opérateur
  url_paiement         text,
  moyen                text,
  reference_operateur  text,
  -- Encaissement enregistré à la confirmation ; motif quand l'agence doit régulariser
  encaissement_id      uuid REFERENCES app.encaissements (id),
  motif                text,
  CONSTRAINT paiements_en_ligne_numero_unique UNIQUE (numero),
  CONSTRAINT paiements_en_ligne_reference_unique UNIQUE (reference),
  CONSTRAINT paiements_en_ligne_encaissement_unique UNIQUE (encaissement_id),
  CONSTRAINT paiements_en_ligne_montant CHECK (montant BETWEEN 100 AND 10000000),
  CONSTRAINT paiements_en_ligne_prestataire CHECK (prestataire ~ '^[a-z_]{3,30}$'),
  CONSTRAINT paiements_en_ligne_accepte CHECK ((statut = 'accepte') = (encaissement_id IS NOT NULL)),
  CONSTRAINT paiements_en_ligne_url CHECK (url_paiement IS NULL OR (url_paiement ~ '^https?://' AND char_length(url_paiement) <= 1000)),
  CONSTRAINT paiements_en_ligne_textes CHECK (char_length(coalesce(moyen, '')) <= 60
    AND char_length(coalesce(reference_operateur, '')) <= 120 AND char_length(coalesce(motif, '')) <= 500)
);
CREATE INDEX paiements_en_ligne_contrat_idx ON app.paiements_en_ligne (contrat_id, cree_le DESC);
CREATE INDEX paiements_en_ligne_gestionnaire_idx ON app.paiements_en_ligne (gestionnaire_id, cree_le DESC);

CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.paiements_en_ligne
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Encaissement d'un paiement en ligne : sans caissier (il n'entre dans aucune caisse), relié à son paiement
ALTER TABLE app.encaissements
  ALTER COLUMN encaisse_par DROP NOT NULL,
  ADD COLUMN paiement_en_ligne_id uuid REFERENCES app.paiements_en_ligne (id),
  ADD CONSTRAINT encaissements_auteur CHECK (encaisse_par IS NOT NULL OR (paiement_en_ligne_id IS NOT NULL AND montant > 0)),
  ADD CONSTRAINT encaissements_en_ligne CHECK (paiement_en_ligne_id IS NULL OR mode = 'mobile_money');
CREATE UNIQUE INDEX encaissements_paiement_en_ligne_unique ON app.encaissements (paiement_en_ligne_id)
  WHERE paiement_en_ligne_id IS NOT NULL;

DROP TRIGGER a_auteur ON app.encaissements;
CREATE TRIGGER a_auteur BEFORE INSERT ON app.encaissements
  FOR EACH ROW WHEN (NEW.paiement_en_ligne_id IS NULL)
  EXECUTE FUNCTION securite.renseigner_auteur('encaisse_par');

-- Contrôle de la caisse (0010) : un paiement en ligne n'a pas de caisse ; le prestataire n'accepte que des
-- montants ronds (multiples de 5 F CFA), d'où une tolérance de 4 F CFA au-delà du reste à payer
CREATE OR REPLACE FUNCTION app.controler_caisse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_prime bigint;
  v_total bigint;
  v_caissier uuid;
  v_cloture timestamptz;
  v_tolerance bigint := CASE WHEN NEW.paiement_en_ligne_id IS NOT NULL THEN 4 ELSE 0 END;
BEGIN
  IF NEW.annule_encaissement_id IS NOT NULL THEN
    SELECT o.encaisse_par INTO v_caissier FROM app.encaissements o WHERE o.id = NEW.annule_encaissement_id;
  END IF;
  v_caissier := coalesce(v_caissier, NEW.encaisse_par);

  -- Toujours dans le même ordre (contrat, puis caisse) pour qu'aucune attente ne se croise
  SELECT k.prime_ttc + k.primes_avenants INTO v_prime FROM app.contrats k WHERE k.id = NEW.contrat_id FOR UPDATE;
  IF v_caissier IS NOT NULL THEN
    PERFORM app.verrouiller_caisse(v_caissier);
    SELECT max(c.fin) INTO v_cloture FROM app.clotures_caisse c WHERE c.caissier_id = v_caissier;
    IF v_cloture IS NOT NULL AND NEW.encaisse_le <= v_cloture THEN
      RAISE EXCEPTION 'Caisse clôturée le % : un encaissement ne peut pas être daté d''avant. Réessayez.',
        to_char(v_cloture AT TIME ZONE 'Africa/Abidjan', 'DD/MM/YYYY à HH24:MI') USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.montant > 0 THEN
    v_total := app.total_encaisse(NEW.contrat_id);
    IF v_total + NEW.montant > v_prime + v_tolerance THEN
      RAISE EXCEPTION 'Montant supérieur au reste à payer : % F CFA restent à régler sur ce contrat',
        greatest(v_prime - v_total, 0) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Le portail prépare un paiement : contrat de l'entreprise ou du particulier connecté, reste à payer, montant
-- rond ; cinq paiements au plus par heure et par personne. L'API transmet ensuite la référence au prestataire.
CREATE FUNCTION portail.preparer_paiement(p_contrat uuid, p_montant bigint, p_prestataire text)
RETURNS TABLE (id uuid, numero bigint, reference text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
  v_contrat app.contrats;
  v_reste bigint;
  v_numero bigint;
BEGIN
  SELECT k.* INTO v_contrat FROM app.contrats k WHERE k.id = p_contrat AND k.client_id = v_moi.client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrat introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_contrat.statut NOT IN ('en_attente_paiement', 'en_vigueur') THEN
    RAISE EXCEPTION 'Ce contrat ne se paie plus en ligne : appelez l''agence.' USING ERRCODE = 'check_violation';
  END IF;
  v_reste := v_contrat.prime_ttc + v_contrat.primes_avenants - app.total_encaisse(v_contrat.id);
  IF v_reste <= 0 THEN
    RAISE EXCEPTION 'Ce contrat est entièrement payé.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_montant % 5 <> 0 OR p_montant < least(100, v_reste) OR p_montant > v_reste + 4 THEN
    RAISE EXCEPTION 'Montant invalide : de 100 F CFA au reste à payer (% F CFA), en multiple de 5.', v_reste
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM app.paiements_en_ligne p WHERE p.gestionnaire_id = v_moi.id
        AND p.cree_le > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Trop de paiements commencés en une heure : terminez ceux en cours, ou réessayez plus tard.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Un paiement en cours pour ce contrat est remplacé : on ne paie pas deux fois la même prime
  UPDATE app.paiements_en_ligne p SET statut = 'abandonne', modifie_le = now()
  WHERE p.contrat_id = v_contrat.id AND p.statut IN ('initie', 'en_attente') AND p.cree_le < now() - interval '30 minutes';
  IF EXISTS (SELECT 1 FROM app.paiements_en_ligne p WHERE p.contrat_id = v_contrat.id AND p.statut IN ('initie', 'en_attente')) THEN
    RAISE EXCEPTION 'Un paiement est déjà en cours pour ce contrat : terminez-le, ou réessayez dans 30 minutes.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_numero := app.numero_suivant('paiements_en_ligne');
  RETURN QUERY
  INSERT INTO app.paiements_en_ligne AS p (numero, reference, contrat_id, gestionnaire_id, montant, prestataire)
  VALUES (v_numero, 'DBS-' || lpad(v_numero::text, 8, '0'), v_contrat.id, v_moi.id, p_montant, p_prestataire)
  RETURNING p.id, p.numero, p.reference;
END
$$;

-- Réponse du prestataire à la demande : page de paiement (le client y est envoyé), ou échec (le paiement est
-- abandonné aussitôt, pour qu'un nouvel essai soit possible)
CREATE FUNCTION portail.lier_paiement(p_paiement uuid, p_url text, p_motif text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE app.paiements_en_ligne p
  SET statut = CASE WHEN p_url IS NULL THEN 'abandonne' ELSE 'en_attente' END::app.statut_paiement_en_ligne,
      url_paiement = p_url, motif = left(p_motif, 500), modifie_le = now()
  WHERE p.id = p_paiement AND p.gestionnaire_id = (portail.gestionnaire_courant()).id AND p.statut = 'initie';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
END
$$;

-- Résultat du paiement, tel que l'API l'a vérifié auprès du prestataire (jamais sur la seule foi d'une
-- notification reçue). Sans utilisateur connecté. Rejouable : un paiement déjà conclu ne change plus.
--   · accepté pour le montant demandé : encaissement enregistré (mobile money, référence du prestataire),
--     contrat mis en vigueur s'il est soldé ;
--   · accepté mais impossible à encaisser (montant différent, prime déjà soldée entre-temps) : « à régulariser »
--     par l'agence, avec le motif ; l'argent est reçu, il ne se perd pas ;
--   · refusé ou abandonné : noté, rien n'est encaissé.
CREATE FUNCTION app.conclure_paiement_en_ligne(p_reference text, p_resultat text, p_montant bigint, p_moyen text,
                                               p_reference_operateur text)
RETURNS app.statut_paiement_en_ligne
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_paiement app.paiements_en_ligne;
  v_encaissement uuid;
BEGIN
  SELECT p.* INTO v_paiement FROM app.paiements_en_ligne p WHERE p.reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement en ligne inconnu : %', left(p_reference, 40) USING ERRCODE = 'no_data_found';
  END IF;
  IF v_paiement.statut IN ('accepte', 'refuse', 'a_regulariser') THEN
    RETURN v_paiement.statut;
  END IF;
  IF p_resultat NOT IN ('accepte', 'refuse', 'abandonne') THEN
    RAISE EXCEPTION 'Résultat de paiement inconnu : %', left(p_resultat, 40) USING ERRCODE = 'check_violation';
  END IF;

  IF p_resultat <> 'accepte' THEN
    UPDATE app.paiements_en_ligne SET statut = p_resultat::app.statut_paiement_en_ligne, moyen = left(p_moyen, 60),
      modifie_le = now() WHERE id = v_paiement.id;
    RETURN p_resultat::app.statut_paiement_en_ligne;
  END IF;

  UPDATE app.paiements_en_ligne SET moyen = left(p_moyen, 60), reference_operateur = left(p_reference_operateur, 120),
    modifie_le = now() WHERE id = v_paiement.id;
  IF p_montant IS DISTINCT FROM v_paiement.montant THEN
    UPDATE app.paiements_en_ligne SET statut = 'a_regulariser',
      motif = format('Montant confirmé par le prestataire (%s F CFA) différent du montant demandé (%s F CFA)', p_montant, v_paiement.montant)
    WHERE id = v_paiement.id;
    RETURN 'a_regulariser';
  END IF;
  BEGIN
    INSERT INTO app.encaissements (contrat_id, montant, mode, reference_externe, paiement_en_ligne_id)
    VALUES (v_paiement.contrat_id, v_paiement.montant, 'mobile_money', v_paiement.prestataire || ':' || v_paiement.reference, v_paiement.id)
    RETURNING id INTO v_encaissement;
  EXCEPTION WHEN check_violation THEN
    UPDATE app.paiements_en_ligne SET statut = 'a_regulariser', motif = left('Paiement reçu mais non encaissé : ' || SQLERRM, 500)
    WHERE id = v_paiement.id;
    RETURN 'a_regulariser';
  END;
  UPDATE app.paiements_en_ligne SET statut = 'accepte', encaissement_id = v_encaissement WHERE id = v_paiement.id;
  RETURN 'accepte';
END
$$;
REVOKE ALL ON FUNCTION app.conclure_paiement_en_ligne(text, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.conclure_paiement_en_ligne(text, text, bigint, text, text) TO dbs_api;

-- Paiements en attente depuis plus de 10 minutes, à vérifier auprès du prestataire par la maintenance horaire :
-- si le client ne revient pas sur la page de retour et qu'une notification se perd, l'argent reçu est quand même
-- encaissé, avant tout abandon. Rend seulement les références, les plus anciennes d'abord.
CREATE FUNCTION app.paiements_en_ligne_a_verifier(p_limite integer) RETURNS TABLE (reference text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p.reference FROM app.paiements_en_ligne p
  WHERE p.statut IN ('initie', 'en_attente') AND p.cree_le < now() - interval '10 minutes'
  ORDER BY p.cree_le
  LIMIT least(greatest(p_limite, 1), 200)
$$;
REVOKE ALL ON FUNCTION app.paiements_en_ligne_a_verifier(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.paiements_en_ligne_a_verifier(integer) TO dbs_api;

-- Un paiement resté sans réponse plus d'un jour est abandonné (maintenance horaire de l'API, après la vérification
-- ci-dessus). Un résultat qui arrive ensuite (notification) est encore enregistré : « abandonné » n'est pas définitif.
CREATE FUNCTION app.abandonner_paiements_en_ligne() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  UPDATE app.paiements_en_ligne SET statut = 'abandonne', modifie_le = now()
  WHERE statut IN ('initie', 'en_attente') AND cree_le < now() - interval '1 day';
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  RETURN v_nombre;
END
$$;
REVOKE ALL ON FUNCTION app.abandonner_paiements_en_ligne() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.abandonner_paiements_en_ligne() TO dbs_api;

-- L'agence régularise un paiement reçu mais non encaissé (remboursé, ou affecté autrement), avec le motif
CREATE FUNCTION app.regulariser_paiement_en_ligne(p_paiement uuid, p_motif text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT securite.a_le_role('gerant') THEN
    RAISE EXCEPTION 'Seul le gérant régularise un paiement en ligne.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motif IS NULL OR char_length(btrim(p_motif)) < 5 THEN
    RAISE EXCEPTION 'Indiquez ce qui a été fait (remboursement, affectation…).' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE app.paiements_en_ligne SET statut = 'refuse', modifie_le = now(),
    motif = left(motif || ' — Régularisé par ' || (SELECT u.nom FROM app.utilisateurs u WHERE u.id = securite.utilisateur_courant())
                 || ' : ' || btrim(p_motif), 500)
  WHERE id = p_paiement AND statut = 'a_regulariser';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun paiement à régulariser.' USING ERRCODE = 'no_data_found';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app.regulariser_paiement_en_ligne(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.regulariser_paiement_en_ligne(uuid, text) TO dbs_api;

-- ---------------------------------------------------------------------
-- Déclaration d'un sinistre depuis le portail
-- ---------------------------------------------------------------------
ALTER TABLE app.sinistres
  -- Récit et lieu donnés par le client (visibles par lui) ; la description reste la note interne de l'agence
  ADD COLUMN circonstances text,
  ADD COLUMN lieu text,
  ADD COLUMN declare_par_gestionnaire uuid REFERENCES app.gestionnaires_portail (id),
  ALTER COLUMN cree_par DROP NOT NULL,
  ADD CONSTRAINT sinistres_auteur CHECK ((cree_par IS NULL) <> (declare_par_gestionnaire IS NULL)),
  ADD CONSTRAINT sinistres_circonstances CHECK (circonstances IS NULL OR char_length(circonstances) <= 4000),
  ADD CONSTRAINT sinistres_lieu CHECK (lieu IS NULL OR char_length(lieu) <= 200);

DROP TRIGGER a_auteur ON app.sinistres;
CREATE TRIGGER a_auteur BEFORE INSERT ON app.sinistres
  FOR EACH ROW WHEN (NEW.declare_par_gestionnaire IS NULL)
  EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');

CREATE TABLE app.pieces_sinistres (
  id                  uuid PRIMARY KEY,
  sinistre_id         uuid NOT NULL REFERENCES app.sinistres (id),
  nom_fichier         text NOT NULL,
  type_contenu        text NOT NULL,
  taille              integer NOT NULL,
  -- AES-256-GCM, clé de l'API, contexte « piece-sinistre:<id> » ; SHA-256 du fichier en clair
  contenu_chiffre     bytea NOT NULL,
  empreinte           bytea NOT NULL,
  etat_analyse        app.analyse_piece NOT NULL,
  depose_le           timestamptz NOT NULL DEFAULT now(),
  depose_par          uuid REFERENCES app.utilisateurs (id),
  depose_par_gestionnaire uuid REFERENCES app.gestionnaires_portail (id),
  CONSTRAINT pieces_sinistres_type CHECK (type_contenu IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT pieces_sinistres_taille CHECK (taille BETWEEN 1 AND 5242880),
  CONSTRAINT pieces_sinistres_nom CHECK (char_length(nom_fichier) BETWEEN 1 AND 120),
  CONSTRAINT pieces_sinistres_etat CHECK (etat_analyse <> 'infectee'),
  CONSTRAINT pieces_sinistres_auteur CHECK ((depose_par IS NULL) <> (depose_par_gestionnaire IS NULL))
);
CREATE INDEX pieces_sinistres_sinistre_idx ON app.pieces_sinistres (sinistre_id);
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.pieces_sinistres
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_avenant();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.pieces_sinistres
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('contenu_chiffre');

-- Déclaration par la personne connectée : contrat de son entreprise (ou le sien), véhicule couvert ce jour-là
-- (vérifié par 0012), date passée de moins d'un an ; dix déclarations par jour au plus.
CREATE FUNCTION portail.declarer_sinistre(p_contrat uuid, p_vehicule uuid, p_survenu_le date, p_nature app.nature_sinistre,
                                          p_dommages_corporels boolean, p_lieu text, p_circonstances text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.contrats k WHERE k.id = p_contrat AND k.client_id = v_moi.client_id) THEN
    RAISE EXCEPTION 'Contrat introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_survenu_le IS NULL OR p_survenu_le > (now() AT TIME ZONE 'Africa/Abidjan')::date
     OR p_survenu_le < (now() AT TIME ZONE 'Africa/Abidjan')::date - 365 THEN
    RAISE EXCEPTION 'Date du sinistre invalide : aujourd''hui ou dans l''année écoulée.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_circonstances IS NULL OR char_length(btrim(p_circonstances)) < 10 THEN
    RAISE EXCEPTION 'Décrivez ce qui s''est passé (10 caractères au moins).' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM app.sinistres s WHERE s.declare_par_gestionnaire = v_moi.id
        AND s.cree_le > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Dix déclarations par jour au plus : appelez l''agence.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO app.sinistres (contrat_id, vehicule_id, survenu_le, declare_le, nature, dommages_corporels, lieu, circonstances,
                             declare_par_gestionnaire, cree_le)
  VALUES (p_contrat, p_vehicule, p_survenu_le, (now() AT TIME ZONE 'Africa/Abidjan')::date, p_nature,
          coalesce(p_dommages_corporels, p_nature = 'corporel'), nullif(btrim(p_lieu), ''), btrim(p_circonstances), v_moi.id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Photos et documents joints par la personne qui a déclaré (huit au plus par sinistre, dans les 7 jours)
CREATE FUNCTION portail.joindre_piece_sinistre(p_id uuid, p_sinistre uuid, p_nom text, p_type text, p_taille integer,
                                               p_contenu bytea, p_empreinte bytea, p_etat app.analyse_piece)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.sinistres s JOIN app.contrats k ON k.id = s.contrat_id
                 WHERE s.id = p_sinistre AND k.client_id = v_moi.client_id AND s.declare_le > (now() AT TIME ZONE 'Africa/Abidjan')::date - 7) THEN
    RAISE EXCEPTION 'Sinistre introuvable, ou déclaré il y a plus de 7 jours : envoyez vos documents à l''agence.'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT count(*) FROM app.pieces_sinistres p WHERE p.sinistre_id = p_sinistre) >= 8 THEN
    RAISE EXCEPTION 'Huit documents au plus par sinistre.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO app.pieces_sinistres (id, sinistre_id, nom_fichier, type_contenu, taille, contenu_chiffre, empreinte, etat_analyse,
                                    depose_par_gestionnaire)
  VALUES (p_id, p_sinistre, left(p_nom, 120), p_type, p_taille, p_contenu, p_empreinte, p_etat, v_moi.id);
END
$$;

REVOKE ALL ON FUNCTION portail.preparer_paiement(uuid, bigint, text), portail.lier_paiement(uuid, text, text),
  portail.declarer_sinistre(uuid, uuid, date, app.nature_sinistre, boolean, text, text),
  portail.joindre_piece_sinistre(uuid, uuid, text, text, integer, bytea, bytea, app.analyse_piece) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portail.preparer_paiement(uuid, bigint, text), portail.lier_paiement(uuid, text, text),
  portail.declarer_sinistre(uuid, uuid, date, app.nature_sinistre, boolean, text, text),
  portail.joindre_piece_sinistre(uuid, uuid, text, text, integer, bytea, bytea, app.analyse_piece) TO dbs_portail;

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.paiements_en_ligne ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pieces_sinistres ENABLE ROW LEVEL SECURITY;

-- Personnel : paiements en ligne lus par qui voit la caisse ; pièces des sinistres par qui suit les sinistres
CREATE POLICY paiements_en_ligne_lecture ON app.paiements_en_ligne FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'caissier', 'charge_clientele', 'auditeur')));
GRANT SELECT ON app.paiements_en_ligne TO dbs_api;
CREATE POLICY pieces_sinistres_lecture ON app.pieces_sinistres FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));
GRANT SELECT ON app.pieces_sinistres TO dbs_api;

-- Portail : ses paiements, ses déclarations et leurs pièces, le récit qu'il a donné
CREATE POLICY paiements_en_ligne_portail ON app.paiements_en_ligne FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));
GRANT SELECT (id, numero, reference, contrat_id, montant, statut, cree_le, modifie_le, url_paiement, moyen, encaissement_id)
  ON app.paiements_en_ligne TO dbs_portail;
CREATE POLICY pieces_sinistres_portail ON app.pieces_sinistres FOR SELECT TO dbs_portail
  USING (EXISTS (SELECT 1 FROM app.sinistres s WHERE s.id = sinistre_id));
GRANT SELECT (id, sinistre_id, nom_fichier, type_contenu, taille, depose_le) ON app.pieces_sinistres TO dbs_portail;
GRANT SELECT (circonstances, lieu, declare_par_gestionnaire) ON app.sinistres TO dbs_portail;
