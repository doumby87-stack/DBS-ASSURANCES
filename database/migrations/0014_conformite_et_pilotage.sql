-- =====================================================================
-- 0014 · Conformité et pilotage (tâche 12)
--
--   · identification des clients (lutte contre le blanchiment, règlement n° 0031/CIMA/PCMA/PCE/SG/2025) :
--     fiche par client, pièce d'identité (numéro chiffré par l'API), dirigeants et bénéficiaires effectifs,
--     justificatifs chiffrés, niveau de risque, vérification de l'original et revue périodique. Un contrat ne
--     se souscrit pas pour un client à risque élevé dont la fiche n'est pas complète ;
--   · alertes sur les situations inhabituelles, et leur traitement par le gérant seul ;
--   · registre des formations du personnel ;
--   · registre des réclamations, avec ses délais en jours ouvrés, alimenté aussi par l'espace client ;
--   · factures FNE de l'agence (numéro attribué par la plateforme de la DGI, saisi par le gérant).
-- Conception : docs/architecture/adr/0013-conformite-et-pilotage.md
-- =====================================================================

-- Registres en ajout seul : une erreur se corrige par une nouvelle ligne, jamais en réécrivant l'ancienne
CREATE FUNCTION app.ajout_seul() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Registre en ajout seul : % interdit.', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

-- Aujourd'hui, à Abidjan
CREATE FUNCTION app.aujourdhui() RETURNS date
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT (now() AT TIME ZONE 'Africa/Abidjan')::date $$;

-- ---------------------------------------------------------------------
-- Identification des clients
-- ---------------------------------------------------------------------
CREATE TYPE app.niveau_risque AS ENUM ('faible', 'normal', 'eleve');
CREATE TYPE app.type_piece_identite AS ENUM (
  'cni', 'passeport', 'carte_sejour', 'carte_consulaire', 'permis_conduire', 'attestation_identite'
);

CREATE TABLE app.identifications_clients (
  client_id              uuid PRIMARY KEY REFERENCES app.clients (id),
  niveau_risque          app.niveau_risque NOT NULL DEFAULT 'normal',
  motif_risque           text,
  personne_politiquement_exposee boolean NOT NULL DEFAULT false,
  -- Personne physique : la pièce. Numéro chiffré par l'API (AES-256-GCM), ses 4 derniers caractères pour le
  -- reconnaître sans l'afficher en entier
  type_piece             app.type_piece_identite,
  numero_piece_chiffre   bytea,
  numero_piece_fin       text,
  piece_expire_le        date,
  date_naissance         date,
  nationalite            text,
  activite               text,
  adresse                text,
  -- Personne morale (le RCCM est sur la fiche client)
  numero_contribuable    text,
  forme_juridique        text,
  -- Exigée pour un risque élevé
  origine_fonds          text,
  -- Original vu par une personne de l'agence, et prochaine revue (selon le risque)
  verifiee_le            date,
  verifiee_par           uuid REFERENCES app.utilisateurs (id),
  prochaine_revue        date,
  cree_le                timestamptz NOT NULL,
  cree_par               uuid NOT NULL REFERENCES app.utilisateurs (id),
  modifie_le             timestamptz NOT NULL DEFAULT now(),
  modifie_par            uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT identifications_ppe CHECK (NOT personne_politiquement_exposee OR niveau_risque = 'eleve'),
  CONSTRAINT identifications_motif CHECK (niveau_risque = 'normal' OR char_length(btrim(coalesce(motif_risque, ''))) >= 5),
  CONSTRAINT identifications_piece CHECK ((numero_piece_chiffre IS NULL) = (numero_piece_fin IS NULL)
                                          AND (numero_piece_chiffre IS NULL OR type_piece IS NOT NULL)),
  CONSTRAINT identifications_fin CHECK (numero_piece_fin IS NULL OR numero_piece_fin ~ '^[A-Z0-9]{1,4}$'),
  CONSTRAINT identifications_naissance CHECK (date_naissance IS NULL OR date_naissance >= DATE '1900-01-01'),
  CONSTRAINT identifications_textes CHECK (
    char_length(coalesce(nationalite, '')) <= 60 AND char_length(coalesce(activite, '')) <= 120
    AND char_length(coalesce(adresse, '')) <= 300 AND char_length(coalesce(numero_contribuable, '')) <= 30
    AND char_length(coalesce(forme_juridique, '')) <= 60 AND char_length(coalesce(origine_fonds, '')) <= 500
    AND char_length(coalesce(motif_risque, '')) <= 500),
  CONSTRAINT identifications_verification CHECK ((verifiee_le IS NULL) = (verifiee_par IS NULL))
);

-- Contrôles de la fiche :
--   · une personne politiquement exposée est toujours à risque élevé ;
--   · la vérification (original vu) ne s'écrit que par app.verifier_identification ; changer la pièce, la date de
--     naissance ou la nationalité l'annule : les nouvelles données n'ont pas été vues ;
--   · prochaine revue : 3 ans (risque faible), 2 ans (normal), 1 an (élevé) après la vérification.
CREATE FUNCTION app.controler_identification() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.client_id <> OLD.client_id OR NEW.cree_le <> OLD.cree_le OR NEW.cree_par <> OLD.cree_par THEN
      RAISE EXCEPTION 'Une fiche d''identification ne change pas de client.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.modifie_le := now();
    NEW.modifie_par := securite.utilisateur_courant();
    IF current_setting('app.verification_identite', true) IS DISTINCT FROM 'oui'
       AND (NEW.verifiee_le IS DISTINCT FROM OLD.verifiee_le OR NEW.verifiee_par IS DISTINCT FROM OLD.verifiee_par) THEN
      RAISE EXCEPTION 'La vérification d''une pièce se fait par sa fonction dédiée.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF current_setting('app.verification_identite', true) IS DISTINCT FROM 'oui'
       AND (NEW.type_piece, NEW.numero_piece_chiffre, NEW.piece_expire_le, NEW.date_naissance, NEW.nationalite)
           IS DISTINCT FROM (OLD.type_piece, OLD.numero_piece_chiffre, OLD.piece_expire_le, OLD.date_naissance, OLD.nationalite) THEN
      NEW.verifiee_le := NULL;
      NEW.verifiee_par := NULL;
    END IF;
  ELSE
    NEW.verifiee_le := NULL;
    NEW.verifiee_par := NULL;
  END IF;
  IF NEW.personne_politiquement_exposee THEN
    NEW.niveau_risque := 'eleve';
    NEW.motif_risque := coalesce(nullif(btrim(NEW.motif_risque), ''), 'Personne politiquement exposée');
  END IF;
  NEW.prochaine_revue := NEW.verifiee_le + CASE NEW.niveau_risque
    WHEN 'faible' THEN interval '3 years' WHEN 'normal' THEN interval '2 years' ELSE interval '1 year' END;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.identifications_clients
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.identifications_clients
  FOR EACH ROW EXECUTE FUNCTION app.controler_identification();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.identifications_clients
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('numero_piece_chiffre');

-- Dirigeants et bénéficiaires effectifs d'une entreprise (personnes physiques qui la possèdent ou la
-- contrôlent en dernier ressort). Une personne qui n'en fait plus partie est retirée, jamais effacée.
CREATE TABLE app.dirigeants_beneficiaires (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES app.clients (id),
  nom                    text NOT NULL,
  est_dirigeant          boolean NOT NULL DEFAULT false,
  est_beneficiaire_effectif boolean NOT NULL DEFAULT false,
  part_capital           numeric(5, 2),
  nationalite            text,
  date_naissance         date,
  personne_politiquement_exposee boolean NOT NULL DEFAULT false,
  cree_le                timestamptz NOT NULL,
  cree_par               uuid NOT NULL REFERENCES app.utilisateurs (id),
  retire_le              timestamptz,
  retire_par             uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT dirigeants_role CHECK (est_dirigeant OR est_beneficiaire_effectif),
  CONSTRAINT dirigeants_part CHECK (part_capital IS NULL OR part_capital BETWEEN 0 AND 100),
  CONSTRAINT dirigeants_nom CHECK (char_length(btrim(nom)) BETWEEN 2 AND 160),
  CONSTRAINT dirigeants_nationalite CHECK (char_length(coalesce(nationalite, '')) <= 60),
  CONSTRAINT dirigeants_retrait CHECK ((retire_le IS NULL) = (retire_par IS NULL))
);
CREATE INDEX dirigeants_client_idx ON app.dirigeants_beneficiaires (client_id) WHERE retire_le IS NULL;

-- Seul changement permis : le retrait, une fois, daté et signé par la base
CREATE FUNCTION app.controler_dirigeant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.retire_le IS NOT NULL OR NEW.retire_le IS NULL
     OR (NEW.client_id, NEW.nom, NEW.est_dirigeant, NEW.est_beneficiaire_effectif, NEW.part_capital, NEW.nationalite,
         NEW.date_naissance, NEW.personne_politiquement_exposee, NEW.cree_le, NEW.cree_par)
        IS DISTINCT FROM (OLD.client_id, OLD.nom, OLD.est_dirigeant, OLD.est_beneficiaire_effectif, OLD.part_capital,
         OLD.nationalite, OLD.date_naissance, OLD.personne_politiquement_exposee, OLD.cree_le, OLD.cree_par) THEN
    RAISE EXCEPTION 'Une personne se retire (une fois), puis se rajoute si besoin : elle ne se modifie pas.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.retire_le := now();
  NEW.retire_par := securite.utilisateur_courant();
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.dirigeants_beneficiaires
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER b_controle BEFORE UPDATE ON app.dirigeants_beneficiaires
  FOR EACH ROW EXECUTE FUNCTION app.controler_dirigeant();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.dirigeants_beneficiaires
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Justificatifs (copie de la pièce, RCCM, statuts…) : JPEG, PNG ou PDF de 5 Mo au plus, analysés par
-- l'antivirus, chiffrés par l'API (contexte « piece-identification:<id> »), conservés sans modification
CREATE TYPE app.nature_justificatif AS ENUM (
  'piece_identite', 'justificatif_domicile', 'rccm', 'statuts', 'liste_beneficiaires', 'autre'
);

CREATE TABLE app.justificatifs_identification (
  id                  uuid PRIMARY KEY,
  client_id           uuid NOT NULL REFERENCES app.clients (id),
  nature              app.nature_justificatif NOT NULL,
  nom_fichier         text NOT NULL,
  type_contenu        text NOT NULL,
  taille              integer NOT NULL,
  contenu_chiffre     bytea NOT NULL,
  empreinte           bytea NOT NULL,
  etat_analyse        app.analyse_piece NOT NULL,
  depose_le           timestamptz NOT NULL,
  depose_par          uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT justificatifs_type CHECK (type_contenu IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT justificatifs_taille CHECK (taille BETWEEN 1 AND 5242880),
  CONSTRAINT justificatifs_nom CHECK (char_length(nom_fichier) BETWEEN 1 AND 120),
  CONSTRAINT justificatifs_etat CHECK (etat_analyse <> 'infectee')
);
CREATE INDEX justificatifs_client_idx ON app.justificatifs_identification (client_id);

CREATE TRIGGER a_auteur BEFORE INSERT ON app.justificatifs_identification
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('depose_par', 'depose_le');
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.justificatifs_identification
  FOR EACH ROW EXECUTE FUNCTION app.ajout_seul();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.justificatifs_identification
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser('contenu_chiffre');

-- L'original de la pièce a été vu : vérification au nom de la personne connectée, datée du jour
CREATE FUNCTION app.verifier_identification(p_client uuid) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_revue date;
  v_trouve uuid;
BEGIN
  IF NOT securite.a_le_role('gerant', 'charge_clientele') THEN
    RAISE EXCEPTION 'Seuls le gérant et le chargé de clientèle vérifient une identité.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.verification_identite', 'oui', true);
  UPDATE app.identifications_clients
  SET verifiee_le = app.aujourdhui(), verifiee_par = securite.utilisateur_courant()
  WHERE client_id = p_client
  RETURNING client_id, prochaine_revue INTO v_trouve, v_revue;
  PERFORM set_config('app.verification_identite', '', true);
  IF v_trouve IS NULL THEN
    RAISE EXCEPTION 'Fiche d''identification introuvable : remplissez-la d''abord.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_revue;
END
$$;

-- État de la fiche, sans aucune donnée d'identité : lisible par toute personne qui voit le client.
--   absente · incomplete (avec ce qui manque) · a_revoir (pièce expirée, revue due) · complete
CREATE FUNCTION app.etat_identification(p_client uuid)
RETURNS TABLE (statut text, niveau_risque app.niveau_risque, manques text[], prochaine_revue date)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_client app.clients;
  v_fiche app.identifications_clients;
  v_manques text[] := '{}';
  v_revoir text[] := '{}';
  v_aujourdhui date := app.aujourdhui();
BEGIN
  SELECT c.* INTO v_client FROM app.clients c WHERE c.id = p_client;
  IF NOT FOUND OR NOT securite.client_visible(p_client) THEN
    RAISE EXCEPTION 'Client introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT f.* INTO v_fiche FROM app.identifications_clients f WHERE f.client_id = p_client;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absente'::text, 'normal'::app.niveau_risque, ARRAY['Fiche d''identification']::text[], NULL::date;
    RETURN;
  END IF;

  IF v_client.type = 'entreprise' THEN
    IF v_client.rccm IS NULL THEN v_manques := array_append(v_manques, 'N° RCCM'); END IF;
    IF v_fiche.forme_juridique IS NULL THEN v_manques := array_append(v_manques, 'Forme juridique'); END IF;
    IF v_fiche.numero_contribuable IS NULL THEN v_manques := array_append(v_manques, 'N° de compte contribuable'); END IF;
    IF v_fiche.adresse IS NULL THEN v_manques := array_append(v_manques, 'Adresse du siège'); END IF;
    IF NOT EXISTS (SELECT 1 FROM app.dirigeants_beneficiaires d WHERE d.client_id = p_client AND d.retire_le IS NULL AND d.est_dirigeant) THEN
      v_manques := array_append(v_manques, 'Dirigeant');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.dirigeants_beneficiaires d WHERE d.client_id = p_client AND d.retire_le IS NULL AND d.est_beneficiaire_effectif) THEN
      v_manques := array_append(v_manques, 'Bénéficiaire effectif');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.justificatifs_identification j WHERE j.client_id = p_client AND j.nature = 'rccm') THEN
      v_manques := array_append(v_manques, 'Copie du RCCM');
    END IF;
    IF EXISTS (SELECT 1 FROM app.dirigeants_beneficiaires d WHERE d.client_id = p_client AND d.retire_le IS NULL
                 AND d.personne_politiquement_exposee) AND v_fiche.niveau_risque <> 'eleve' THEN
      v_manques := array_append(v_manques, 'Risque élevé (personne politiquement exposée parmi les dirigeants ou bénéficiaires)');
    END IF;
  ELSE
    IF v_fiche.numero_piece_chiffre IS NULL THEN v_manques := array_append(v_manques, 'N° de pièce d''identité'); END IF;
    IF v_fiche.piece_expire_le IS NULL THEN v_manques := array_append(v_manques, 'Date d''expiration de la pièce'); END IF;
    IF v_fiche.date_naissance IS NULL THEN v_manques := array_append(v_manques, 'Date de naissance'); END IF;
    IF v_fiche.nationalite IS NULL THEN v_manques := array_append(v_manques, 'Nationalité'); END IF;
    IF v_fiche.activite IS NULL THEN v_manques := array_append(v_manques, 'Activité'); END IF;
    IF v_fiche.adresse IS NULL THEN v_manques := array_append(v_manques, 'Adresse'); END IF;
    IF NOT EXISTS (SELECT 1 FROM app.justificatifs_identification j WHERE j.client_id = p_client AND j.nature = 'piece_identite') THEN
      v_manques := array_append(v_manques, 'Copie de la pièce d''identité');
    END IF;
  END IF;
  IF v_fiche.niveau_risque = 'eleve' AND v_fiche.origine_fonds IS NULL THEN
    v_manques := array_append(v_manques, 'Origine des fonds (risque élevé)');
  END IF;
  IF v_fiche.verifiee_le IS NULL THEN v_manques := array_append(v_manques, 'Original vu par l''agence'); END IF;

  IF v_fiche.piece_expire_le < v_aujourdhui THEN v_revoir := array_append(v_revoir, 'Pièce d''identité expirée'); END IF;
  IF v_fiche.prochaine_revue < v_aujourdhui THEN v_revoir := array_append(v_revoir, 'Revue périodique due'); END IF;

  RETURN QUERY SELECT
    CASE WHEN cardinality(v_manques) > 0 THEN 'incomplete' WHEN cardinality(v_revoir) > 0 THEN 'a_revoir' ELSE 'complete' END,
    v_fiche.niveau_risque, v_manques || v_revoir, v_fiche.prochaine_revue;
END
$$;

-- Souscription : un client à risque élevé (ou dont un dirigeant ou bénéficiaire est une personne
-- politiquement exposée) doit avoir une fiche complète et à jour. Les autres : alerte au tableau de bord.
CREATE FUNCTION app.controler_identification_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.identifications_clients f WHERE f.client_id = NEW.client_id AND f.niveau_risque = 'eleve')
     OR EXISTS (SELECT 1 FROM app.dirigeants_beneficiaires d WHERE d.client_id = NEW.client_id AND d.retire_le IS NULL
                  AND d.personne_politiquement_exposee) THEN
    IF (SELECT e.statut FROM app.etat_identification(NEW.client_id) e) <> 'complete' THEN
      RAISE EXCEPTION 'Client à risque élevé : sa fiche d''identification doit être complète, vérifiée et à jour avant toute souscription (lutte contre le blanchiment).'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER b_identification BEFORE INSERT ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION app.controler_identification_contrat();

-- Clients en relation (contrat en cours) dont la fiche n'est pas complète : à traiter par l'agence
CREATE VIEW app.v_identifications_a_completer WITH (security_invoker = true) AS
SELECT c.id AS client_id, c.nom, c.type, e.statut, e.niveau_risque, e.manques, e.prochaine_revue, c.contrats_en_cours
FROM (
  SELECT c.id, c.nom, c.type,
         (SELECT count(*)::int FROM app.contrats k WHERE k.client_id = c.id
            AND k.statut IN ('en_attente_paiement', 'en_vigueur', 'suspendu')) AS contrats_en_cours
  FROM app.clients c
  WHERE (SELECT securite.a_le_role('gerant', 'charge_clientele', 'auditeur'))
    AND EXISTS (SELECT 1 FROM app.contrats k WHERE k.client_id = c.id AND k.statut IN ('en_attente_paiement', 'en_vigueur', 'suspendu'))
) c
CROSS JOIN LATERAL app.etat_identification(c.id) e
WHERE e.statut <> 'complete';

-- ---------------------------------------------------------------------
-- Situations inhabituelles
-- ---------------------------------------------------------------------
-- Paiement par une autre personne que le client (nom noté par le caissier)
ALTER TABLE app.encaissements
  ADD COLUMN payeur_tiers text,
  ADD CONSTRAINT encaissements_payeur_tiers CHECK (payeur_tiers IS NULL OR char_length(btrim(payeur_tiers)) BETWEEN 2 AND 120);

-- Date de résiliation, tenue par la base
ALTER TABLE app.contrats ADD COLUMN resilie_le date;

CREATE FUNCTION app.dater_resiliation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.statut = 'resilie' AND OLD.statut <> 'resilie' THEN
    NEW.resilie_le := app.aujourdhui();
  ELSIF NEW.statut <> 'resilie' THEN
    NEW.resilie_le := NULL;
  ELSE
    NEW.resilie_le := OLD.resilie_le;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER b_resiliation BEFORE UPDATE ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION app.dater_resiliation();

CREATE TYPE app.decision_alerte AS ENUM ('sans_suite', 'transmise_correspondant');

-- Décision du gérant sur une alerte (une par alerte) : classée après examen, ou transmise au correspondant
-- LBC/FT de la compagnie. Jamais visible des autres rôles ni du client.
CREATE TABLE app.traitements_alertes (
  cle         text PRIMARY KEY,
  decision    app.decision_alerte NOT NULL,
  motif       text NOT NULL,
  traite_le   timestamptz NOT NULL,
  traite_par  uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT traitements_cle CHECK (cle ~ '^(especes_plafond|paiement_tiers|fractionnement|resiliation_rapide):[0-9a-f-]{36}$'),
  CONSTRAINT traitements_motif CHECK (char_length(btrim(motif)) BETWEEN 5 AND 1000)
);
CREATE TRIGGER a_auteur BEFORE INSERT ON app.traitements_alertes
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('traite_par', 'traite_le');
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.traitements_alertes
  FOR EACH ROW EXECUTE FUNCTION app.ajout_seul();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.traitements_alertes
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Alertes (seuils proposés, à confirmer avec la procédure de SanlamAllianz) :
--   · espèces : 80 % du plafond de 1 000 000 F CFA atteints sur un contrat ;
--   · paiement par un tiers ;
--   · fractionnement : 3 paiements en espèces ou plus sur un même contrat en 30 jours ;
--   · résiliation rapide : contrat résilié moins de 90 jours après sa prise d'effet, prime encaissée.
-- Réservées au gérant, même pour la lecture.
CREATE VIEW app.v_alertes WITH (security_invoker = true) AS
WITH alertes AS (
  SELECT 'especes_plafond:' || k.id AS cle, 'especes_plafond'::text AS type, k.id AS contrat_id,
         max(e.encaisse_le) AS detectee_le, sum(e.montant)::bigint AS montant,
         format('%s F CFA payés en espèces sur ce contrat (plafond : 1 000 000 F CFA)', sum(e.montant)) AS detail
  FROM app.contrats k JOIN app.encaissements e ON e.contrat_id = k.id AND e.mode = 'especes'
  GROUP BY k.id
  HAVING sum(e.montant) >= 800000
  UNION ALL
  SELECT 'paiement_tiers:' || e.id, 'paiement_tiers', e.contrat_id, e.encaisse_le, e.montant,
         format('%s F CFA payés par %s', e.montant, e.payeur_tiers)
  FROM app.encaissements e
  WHERE e.payeur_tiers IS NOT NULL AND e.montant > 0
  UNION ALL
  SELECT 'fractionnement:' || f.contrat_id, 'fractionnement', f.contrat_id, max(f.encaisse_le), NULL::bigint,
         format('%s paiements en espèces en 30 jours sur ce contrat', max(f.nombre))
  FROM (
    SELECT e.contrat_id, e.encaisse_le,
           (SELECT count(*) FROM app.encaissements x
            WHERE x.contrat_id = e.contrat_id AND x.mode = 'especes' AND x.montant > 0
              AND x.encaisse_le BETWEEN e.encaisse_le - interval '30 days' AND e.encaisse_le) AS nombre
    FROM app.encaissements e WHERE e.mode = 'especes' AND e.montant > 0
  ) f
  WHERE f.nombre >= 3
  GROUP BY f.contrat_id
  UNION ALL
  SELECT 'resiliation_rapide:' || k.id, 'resiliation_rapide', k.id, k.resilie_le::timestamptz,
         (SELECT sum(e.montant)::bigint FROM app.encaissements e WHERE e.contrat_id = k.id),
         format('Résilié le %s, %s jours après sa prise d''effet', to_char(k.resilie_le, 'DD/MM/YYYY'), k.resilie_le - k.date_effet)
  FROM app.contrats k
  WHERE k.statut = 'resilie' AND k.resilie_le < k.date_effet + 90
    AND EXISTS (SELECT 1 FROM app.encaissements e WHERE e.contrat_id = k.id AND e.montant > 0)
)
SELECT a.cle, a.type, a.contrat_id, k.numero_police, k.client_id, c.nom AS client_nom, a.detectee_le, a.montant,
       a.detail, t.decision, t.motif, t.traite_le, t.traite_par
FROM alertes a
JOIN app.contrats k ON k.id = a.contrat_id
JOIN app.clients c ON c.id = k.client_id
LEFT JOIN app.traitements_alertes t ON t.cle = a.cle
WHERE (SELECT securite.a_le_role('gerant'));

-- ---------------------------------------------------------------------
-- Formations du personnel (rappel annuel)
-- ---------------------------------------------------------------------
CREATE TYPE app.theme_formation AS ENUM (
  'lbc_ft', 'hameconnage', 'mots_de_passe', 'procedure_incident', 'donnees_personnelles'
);

CREATE TABLE app.formations_personnel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id  uuid NOT NULL REFERENCES app.utilisateurs (id),
  theme           app.theme_formation NOT NULL,
  suivie_le       date NOT NULL,
  commentaire     text,
  enregistre_le   timestamptz NOT NULL,
  enregistre_par  uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT formations_date CHECK (suivie_le >= DATE '2020-01-01'),
  CONSTRAINT formations_commentaire CHECK (char_length(coalesce(commentaire, '')) <= 300)
);
CREATE INDEX formations_utilisateur_idx ON app.formations_personnel (utilisateur_id, theme, suivie_le DESC);

CREATE FUNCTION app.controler_formation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.suivie_le > app.aujourdhui() THEN
    RAISE EXCEPTION 'Une formation s''enregistre une fois suivie, pas avant.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER a_auteur BEFORE INSERT ON app.formations_personnel
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('enregistre_par', 'enregistre_le');
CREATE TRIGGER b_controle BEFORE INSERT ON app.formations_personnel
  FOR EACH ROW EXECUTE FUNCTION app.controler_formation();
CREATE TRIGGER c_ajout_seul BEFORE UPDATE OR DELETE ON app.formations_personnel
  FOR EACH ROW EXECUTE FUNCTION app.ajout_seul();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.formations_personnel
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Pour chaque compte actif et chaque thème : dernière formation, et à refaire au-delà d'un an
CREATE VIEW app.v_formations_a_jour WITH (security_invoker = true) AS
SELECT u.id AS utilisateur_id, u.nom, u.role, t.theme,
       (SELECT max(f.suivie_le) FROM app.formations_personnel f WHERE f.utilisateur_id = u.id AND f.theme = t.theme) AS derniere,
       coalesce((SELECT max(f.suivie_le) FROM app.formations_personnel f WHERE f.utilisateur_id = u.id AND f.theme = t.theme)
                  < app.aujourdhui() - 365, true) AS a_refaire
FROM app.utilisateurs u
CROSS JOIN unnest(enum_range(NULL::app.theme_formation)) AS t(theme)
WHERE u.actif;

-- ---------------------------------------------------------------------
-- Réclamations
-- ---------------------------------------------------------------------
-- Jours ouvrés : du lundi au vendredi, hors jours fériés à date fixe en Côte d'Ivoire (1er janvier,
-- 1er mai, 7 août, 15 août, 1er novembre, 15 novembre, 25 décembre). Les fêtes à date variable (Pâques,
-- Ascension, Pentecôte, Ramadan, Tabaski, Maouloud…) ne sont pas décomptées : l'échéance est alors
-- plus courte d'un jour, jamais plus longue.
CREATE FUNCTION app.ajouter_jours_ouvres(p_depart date, p_jours integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_jour date := p_depart;
  v_restants integer := p_jours;
BEGIN
  WHILE v_restants > 0 LOOP
    v_jour := v_jour + 1;
    IF extract(isodow FROM v_jour) < 6
       AND to_char(v_jour, 'MM-DD') NOT IN ('01-01', '05-01', '08-07', '08-15', '11-01', '11-15', '12-25') THEN
      v_restants := v_restants - 1;
    END IF;
  END LOOP;
  RETURN v_jour;
END
$$;

CREATE TYPE app.canal_reclamation AS ENUM ('guichet', 'telephone', 'whatsapp', 'email', 'courrier', 'espace_client');
CREATE TYPE app.objet_reclamation AS ENUM (
  'contrat', 'prime_paiement', 'sinistre', 'attestation', 'accueil_service', 'donnees_personnelles', 'autre'
);
CREATE TYPE app.statut_reclamation AS ENUM ('recue', 'en_cours', 'repondue', 'close');
CREATE TYPE app.issue_reclamation AS ENUM ('fondee', 'partiellement_fondee', 'non_fondee');

CREATE TABLE app.reclamations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                bigint NOT NULL,
  reference             text NOT NULL,
  client_id             uuid REFERENCES app.clients (id),
  nom                   text NOT NULL,
  telephone             text,
  canal                 app.canal_reclamation NOT NULL,
  objet                 app.objet_reclamation NOT NULL,
  description           text NOT NULL,
  contrat_id            uuid REFERENCES app.contrats (id),
  sinistre_id           uuid REFERENCES app.sinistres (id),
  statut                app.statut_reclamation NOT NULL DEFAULT 'recue',
  recue_le              timestamptz NOT NULL,
  -- Engagements proposés (à valider par l'agence) : accusé de réception sous 2 jours ouvrés, réponse sous 10
  echeance_accuse       date NOT NULL,
  echeance_reponse      date NOT NULL,
  accuse_le             timestamptz,
  accuse_par            uuid REFERENCES app.utilisateurs (id),
  reponse               text,
  issue                 app.issue_reclamation,
  repondue_le           timestamptz,
  repondue_par          uuid REFERENCES app.utilisateurs (id),
  -- Recours : la compagnie, puis la Direction des Assurances
  escalade              text,
  escalade_le           timestamptz,
  close_le              timestamptz,
  cree_par              uuid REFERENCES app.utilisateurs (id),
  cree_par_gestionnaire uuid REFERENCES app.gestionnaires_portail (id),
  CONSTRAINT reclamations_numero_unique UNIQUE (numero),
  CONSTRAINT reclamations_reference_unique UNIQUE (reference),
  CONSTRAINT reclamations_nom CHECK (char_length(btrim(nom)) BETWEEN 2 AND 160),
  CONSTRAINT reclamations_telephone CHECK (telephone IS NULL OR telephone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT reclamations_description CHECK (char_length(btrim(description)) BETWEEN 10 AND 4000),
  CONSTRAINT reclamations_reponse CHECK ((reponse IS NULL) = (repondue_le IS NULL) AND (reponse IS NULL) = (issue IS NULL)
                                         AND char_length(coalesce(reponse, '')) <= 4000),
  CONSTRAINT reclamations_accuse CHECK ((accuse_le IS NULL) = (accuse_par IS NULL)),
  CONSTRAINT reclamations_escalade CHECK ((escalade IS NULL) = (escalade_le IS NULL)
                                          AND (escalade IS NULL OR escalade IN ('compagnie', 'direction_assurances'))),
  CONSTRAINT reclamations_cloture CHECK ((statut = 'close') = (close_le IS NOT NULL) AND (close_le IS NULL OR reponse IS NOT NULL)),
  CONSTRAINT reclamations_auteur CHECK ((cree_par IS NULL) <> (cree_par_gestionnaire IS NULL))
);
CREATE INDEX reclamations_client_idx ON app.reclamations (client_id, recue_le DESC);
CREATE INDEX reclamations_ouvertes_idx ON app.reclamations (recue_le) WHERE statut <> 'close';

-- À l'arrivée : numéro (REC-2026-0001), date, échéances et état fixés par la base ; nom et téléphone repris de
-- la fiche du client s'ils manquent ; contrat et sinistre du même client
CREATE FUNCTION app.preparer_reclamation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_client app.clients;
  v_annee text := to_char(app.aujourdhui(), 'YYYY');
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT c.* INTO v_client FROM app.clients c WHERE c.id = NEW.client_id;
    NEW.nom := coalesce(nullif(btrim(NEW.nom), ''), v_client.nom);
    NEW.telephone := coalesce(NEW.telephone, v_client.telephone);
  END IF;
  IF NEW.contrat_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.contrats k WHERE k.id = NEW.contrat_id AND k.client_id IS NOT DISTINCT FROM NEW.client_id) THEN
    RAISE EXCEPTION 'Ce contrat n''est pas celui du client.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sinistre_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM app.sinistres s JOIN app.contrats k ON k.id = s.contrat_id
       WHERE s.id = NEW.sinistre_id AND k.client_id IS NOT DISTINCT FROM NEW.client_id) THEN
    RAISE EXCEPTION 'Ce sinistre n''est pas celui du client.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.numero := app.numero_suivant('reclamations');
  NEW.reference := 'REC-' || v_annee || '-' || lpad(app.numero_suivant('reclamations-' || v_annee)::text, 4, '0');
  NEW.statut := 'recue';
  NEW.recue_le := now();
  NEW.echeance_accuse := app.ajouter_jours_ouvres(app.aujourdhui(), 2);
  NEW.echeance_reponse := app.ajouter_jours_ouvres(app.aujourdhui(), 10);
  NEW.accuse_le := NULL; NEW.accuse_par := NULL;
  NEW.reponse := NULL; NEW.issue := NULL; NEW.repondue_le := NULL; NEW.repondue_par := NULL;
  NEW.escalade := NULL; NEW.escalade_le := NULL; NEW.close_le := NULL;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.reclamations
  FOR EACH ROW WHEN (NEW.cree_par_gestionnaire IS NULL)
  EXECUTE FUNCTION securite.renseigner_auteur('cree_par');
CREATE TRIGGER b_preparer BEFORE INSERT ON app.reclamations
  FOR EACH ROW EXECUTE FUNCTION app.preparer_reclamation();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.reclamations
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Traitement, par le gérant ou le chargé de clientèle, étape par étape (chaque étape une seule fois, datée et
-- signée par la base) : accusé de réception, réponse avec son issue, recours, clôture.
CREATE FUNCTION app.traiter_reclamation(p_id uuid, p_action text, p_reponse text, p_issue app.issue_reclamation,
                                        p_escalade text)
RETURNS app.statut_reclamation
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_r app.reclamations;
  v_moi uuid := securite.utilisateur_courant();
BEGIN
  IF NOT securite.a_le_role('gerant', 'charge_clientele') THEN
    RAISE EXCEPTION 'Seuls le gérant et le chargé de clientèle traitent les réclamations.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.* INTO v_r FROM app.reclamations r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Réclamation introuvable.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_r.statut = 'close' THEN
    RAISE EXCEPTION 'Réclamation close : enregistrez-en une nouvelle si le client revient.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_action = 'accuser' THEN
    IF v_r.accuse_le IS NOT NULL THEN
      RAISE EXCEPTION 'Accusé de réception déjà noté.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.reclamations SET accuse_le = now(), accuse_par = v_moi, statut = 'en_cours' WHERE id = p_id;
    RETURN 'en_cours';
  ELSIF p_action = 'repondre' THEN
    IF v_r.reponse IS NOT NULL THEN
      RAISE EXCEPTION 'Réponse déjà donnée : un nouvel échange passe par le recours ou une nouvelle réclamation.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_reponse IS NULL OR char_length(btrim(p_reponse)) < 10 OR p_issue IS NULL THEN
      RAISE EXCEPTION 'Indiquez la réponse donnée au client (10 caractères au moins) et son issue.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.reclamations
    SET reponse = btrim(p_reponse), issue = p_issue, repondue_le = now(), repondue_par = v_moi, statut = 'repondue',
        accuse_le = coalesce(accuse_le, now()), accuse_par = coalesce(accuse_par, v_moi)
    WHERE id = p_id;
    RETURN 'repondue';
  ELSIF p_action = 'escalader' THEN
    IF p_escalade NOT IN ('compagnie', 'direction_assurances') THEN
      RAISE EXCEPTION 'Recours inconnu.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_r.escalade = 'direction_assurances' OR v_r.escalade = p_escalade THEN
      RAISE EXCEPTION 'Recours déjà noté.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.reclamations SET escalade = p_escalade, escalade_le = now() WHERE id = p_id;
    RETURN v_r.statut;
  ELSIF p_action = 'clore' THEN
    IF v_r.reponse IS NULL THEN
      RAISE EXCEPTION 'Répondez au client avant de clore.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.reclamations SET statut = 'close', close_le = now() WHERE id = p_id;
    RETURN 'close';
  END IF;
  RAISE EXCEPTION 'Action inconnue.' USING ERRCODE = 'check_violation';
END
$$;

-- Réclamation déposée depuis l'espace client (cinq par jour au plus)
CREATE FUNCTION portail.deposer_reclamation(p_objet app.objet_reclamation, p_description text, p_contrat uuid, p_sinistre uuid)
RETURNS TABLE (id uuid, reference text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_moi app.gestionnaires_portail := portail.gestionnaire_courant();
BEGIN
  IF (SELECT count(*) FROM app.reclamations r WHERE r.cree_par_gestionnaire = v_moi.id
        AND r.recue_le > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'Cinq réclamations par jour au plus : appelez l''agence.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
  INSERT INTO app.reclamations AS r (client_id, nom, telephone, canal, objet, description, contrat_id, sinistre_id,
                                     cree_par_gestionnaire)
  VALUES (v_moi.client_id, v_moi.nom, v_moi.telephone, 'espace_client', p_objet, btrim(p_description), p_contrat,
          p_sinistre, v_moi.id)
  RETURNING r.id, r.reference;
END
$$;

-- ---------------------------------------------------------------------
-- Factures FNE de l'agence
-- ---------------------------------------------------------------------
CREATE TYPE app.objet_facture AS ENUM ('commissions', 'frais', 'autre');

CREATE TABLE app.factures_fne (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_fne         text NOT NULL,
  emise_le           date NOT NULL,
  objet              app.objet_facture NOT NULL,
  -- Commissions d'un mois (une facture par mois)
  mois               date,
  destinataire       text NOT NULL,
  montant_ttc        bigint NOT NULL,
  commentaire        text,
  saisie_le          timestamptz NOT NULL,
  saisie_par         uuid NOT NULL REFERENCES app.utilisateurs (id),
  annulee_le         timestamptz,
  annulee_par        uuid REFERENCES app.utilisateurs (id),
  motif_annulation   text,
  CONSTRAINT factures_fne_numero_unique UNIQUE (numero_fne),
  CONSTRAINT factures_fne_numero CHECK (numero_fne ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,59}$'),
  CONSTRAINT factures_fne_montant CHECK (montant_ttc > 0),
  CONSTRAINT factures_fne_mois CHECK ((objet = 'commissions') = (mois IS NOT NULL)
                                      AND (mois IS NULL OR mois = date_trunc('month', mois)::date)),
  CONSTRAINT factures_fne_textes CHECK (char_length(btrim(destinataire)) BETWEEN 2 AND 160
                                        AND char_length(coalesce(commentaire, '')) <= 500),
  CONSTRAINT factures_fne_annulation CHECK ((annulee_le IS NULL) = (annulee_par IS NULL)
                                            AND (annulee_le IS NULL OR char_length(btrim(coalesce(motif_annulation, ''))) >= 5))
);
CREATE UNIQUE INDEX factures_fne_mois_unique ON app.factures_fne (mois) WHERE objet = 'commissions' AND annulee_le IS NULL;

-- Une facture ne se modifie pas ; elle s'annule une fois (avoir émis sur la plateforme FNE), avec son motif
CREATE FUNCTION app.controler_facture_fne() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.emise_le > app.aujourdhui() THEN
      RAISE EXCEPTION 'Date d''émission dans le futur.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.annulee_le := NULL; NEW.annulee_par := NULL; NEW.motif_annulation := NULL;
    RETURN NEW;
  END IF;
  IF OLD.annulee_le IS NOT NULL OR NEW.annulee_le IS NULL
     OR (NEW.numero_fne, NEW.emise_le, NEW.objet, NEW.mois, NEW.destinataire, NEW.montant_ttc, NEW.commentaire,
         NEW.saisie_le, NEW.saisie_par)
        IS DISTINCT FROM (OLD.numero_fne, OLD.emise_le, OLD.objet, OLD.mois, OLD.destinataire, OLD.montant_ttc,
         OLD.commentaire, OLD.saisie_le, OLD.saisie_par) THEN
    RAISE EXCEPTION 'Une facture FNE ne se modifie pas : annulez-la (une fois), puis saisissez la bonne.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.annulee_le := now();
  NEW.annulee_par := securite.utilisateur_courant();
  RETURN NEW;
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.factures_fne
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('saisie_par', 'saisie_le');
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.factures_fne
  FOR EACH ROW EXECUTE FUNCTION app.controler_facture_fne();
CREATE TRIGGER c_pas_de_suppression BEFORE DELETE ON app.factures_fne
  FOR EACH ROW EXECUTE FUNCTION app.ajout_seul();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.factures_fne
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Journal de sécurité : consultation d'une donnée très sensible (n° de pièce d'identité en entier)
-- ---------------------------------------------------------------------
ALTER TABLE securite.evenements DROP CONSTRAINT evenements_type;
ALTER TABLE securite.evenements ADD CONSTRAINT evenements_type CHECK (type IN (
  'connexion_reussie', 'connexion_echouee', 'mfa_echoue', 'compte_bloque', 'mfa_active',
  'mot_de_passe_modifie', 'acces_reinitialise', 'compte_cree', 'compte_modifie', 'deconnexion',
  'export_donnees', 'piece_telechargee', 'donnee_sensible_consultee'
));

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.identifications_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dirigeants_beneficiaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.justificatifs_identification ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.traitements_alertes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.formations_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reclamations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.factures_fne ENABLE ROW LEVEL SECURITY;

-- Identification (« très sensible ») : gérant et chargé de clientèle ; l'auditeur lit (sans pouvoir
-- déchiffrer : l'API ne déchiffre que pour le gérant et le chargé). Les autres ne voient que l'état de la fiche.
CREATE POLICY identifications_lecture ON app.identifications_clients FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'auditeur')));
CREATE POLICY identifications_creation ON app.identifications_clients FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY identifications_modification ON app.identifications_clients FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT SELECT ON app.identifications_clients TO dbs_api;
GRANT INSERT (client_id, niveau_risque, motif_risque, personne_politiquement_exposee, type_piece, numero_piece_chiffre,
              numero_piece_fin, piece_expire_le, date_naissance, nationalite, activite, adresse, numero_contribuable,
              forme_juridique, origine_fonds) ON app.identifications_clients TO dbs_api;
GRANT UPDATE (niveau_risque, motif_risque, personne_politiquement_exposee, type_piece, numero_piece_chiffre,
              numero_piece_fin, piece_expire_le, date_naissance, nationalite, activite, adresse, numero_contribuable,
              forme_juridique, origine_fonds) ON app.identifications_clients TO dbs_api;

CREATE POLICY dirigeants_lecture ON app.dirigeants_beneficiaires FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'auditeur')));
CREATE POLICY dirigeants_creation ON app.dirigeants_beneficiaires FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY dirigeants_retrait ON app.dirigeants_beneficiaires FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT SELECT ON app.dirigeants_beneficiaires TO dbs_api;
GRANT INSERT (client_id, nom, est_dirigeant, est_beneficiaire_effectif, part_capital, nationalite, date_naissance,
              personne_politiquement_exposee) ON app.dirigeants_beneficiaires TO dbs_api;
GRANT UPDATE (retire_le) ON app.dirigeants_beneficiaires TO dbs_api;

CREATE POLICY justificatifs_lecture ON app.justificatifs_identification FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'auditeur')));
CREATE POLICY justificatifs_creation ON app.justificatifs_identification FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
GRANT SELECT, INSERT ON app.justificatifs_identification TO dbs_api;

-- Alertes et décisions : le gérant seul
CREATE POLICY traitements_alertes_gerant ON app.traitements_alertes FOR ALL TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
GRANT SELECT, INSERT ON app.traitements_alertes TO dbs_api;

-- Formations : chacun lit les siennes ; le gérant les enregistre ; l'auditeur lit tout
CREATE POLICY formations_lecture ON app.formations_personnel FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur')) OR utilisateur_id = (SELECT securite.utilisateur_courant()));
CREATE POLICY formations_creation ON app.formations_personnel FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
GRANT SELECT ON app.formations_personnel TO dbs_api;
GRANT INSERT (utilisateur_id, theme, suivie_le, commentaire) ON app.formations_personnel TO dbs_api;

-- Réclamations : le registre est lu par le gérant, le chargé et l'auditeur ; le caissier et le commercial
-- enregistrent celles qu'ils reçoivent et relisent les leurs. Le traitement passe par app.traiter_reclamation.
CREATE POLICY reclamations_lecture ON app.reclamations FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'auditeur'))
         OR cree_par = (SELECT securite.utilisateur_courant()));
CREATE POLICY reclamations_creation ON app.reclamations FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'caissier', 'commercial'))
              AND (client_id IS NULL OR securite.client_visible(client_id)));
GRANT SELECT ON app.reclamations TO dbs_api;
GRANT INSERT (id, client_id, nom, telephone, canal, objet, description, contrat_id, sinistre_id) ON app.reclamations TO dbs_api;

-- Factures FNE : le gérant les saisit et les annule ; l'auditeur lit
CREATE POLICY factures_fne_lecture ON app.factures_fne FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'auditeur')));
CREATE POLICY factures_fne_creation ON app.factures_fne FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
CREATE POLICY factures_fne_annulation ON app.factures_fne FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));
GRANT SELECT ON app.factures_fne TO dbs_api;
GRANT INSERT (id, numero_fne, emise_le, objet, mois, destinataire, montant_ttc, commentaire) ON app.factures_fne TO dbs_api;
GRANT UPDATE (annulee_le, motif_annulation) ON app.factures_fne TO dbs_api;

GRANT SELECT ON app.v_identifications_a_completer, app.v_alertes, app.v_formations_a_jour TO dbs_api;

REVOKE ALL ON FUNCTION app.verifier_identification(uuid), app.etat_identification(uuid),
  app.traiter_reclamation(uuid, text, text, app.issue_reclamation, text), app.ajouter_jours_ouvres(date, integer),
  app.aujourdhui() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verifier_identification(uuid), app.etat_identification(uuid),
  app.traiter_reclamation(uuid, text, text, app.issue_reclamation, text), app.ajouter_jours_ouvres(date, integer),
  app.aujourdhui() TO dbs_api;

-- Espace client : ses réclamations (sans les auteurs de l'agence), déposées par sa fonction
CREATE POLICY reclamations_portail ON app.reclamations FOR SELECT TO dbs_portail
  USING (client_id = (SELECT portail.client_courant()));
GRANT SELECT (id, reference, client_id, objet, description, statut, canal, recue_le, echeance_reponse, accuse_le, reponse,
              repondue_le, close_le, contrat_id, sinistre_id, cree_par_gestionnaire) ON app.reclamations TO dbs_portail;
REVOKE ALL ON FUNCTION portail.deposer_reclamation(app.objet_reclamation, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portail.deposer_reclamation(app.objet_reclamation, text, uuid, uuid) TO dbs_portail;
GRANT EXECUTE ON FUNCTION app.aujourdhui() TO dbs_portail;
