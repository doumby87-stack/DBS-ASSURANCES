-- =====================================================================
-- 0006 · Relances automatiques et consentements
--
-- Pour la tâche 6 :
--   · app.consentements : accord ou refus de chaque client pour être relancé sur WhatsApp ou par SMS,
--     avec la façon dont il a été recueilli (loi n° 2013-450, règles de Meta). En ajout seul : c'est
--     une preuve. Un « STOP » envoyé par le client est enregistré sans intervention humaine ;
--   · app.v_relances_dues : ce qu'il faut annoncer aujourd'hui (échéance à J-30, J-15, J-7, le jour
--     même, contrat expiré depuis moins de 7 jours, devis envoyé resté sans réponse, avancement
--     d'un sinistre) et qui n'a pas encore été planifié ;
--   · app.relances : la file d'envoi. Une seule relance par étape et par objet (clé unique) :
--     la planification peut tourner autant de fois qu'on veut sans envoyer deux fois le même message ;
--   · fonctions réservées au planificateur de l'API, qui travaille sans utilisateur connecté : elles
--     font chacune une seule chose, avec leurs propres contrôles. Personne n'insère une relance à la main.
-- =====================================================================

CREATE TYPE app.canal_relance AS ENUM ('whatsapp', 'sms');
CREATE TYPE app.type_relance AS ENUM (
  'echeance_j30', 'echeance_j15', 'echeance_j7', 'echeance_jour', 'contrat_expire',
  'devis_sans_reponse', 'sinistre_avancement'
);
-- a_envoyer → envoyee → remise → lue ; echec et annulee sont définitifs
CREATE TYPE app.statut_relance AS ENUM ('a_envoyer', 'envoyee', 'remise', 'lue', 'echec', 'annulee');
-- agence : recueilli par le personnel (guichet, téléphone, formulaire) ; reponse_client : « STOP » reçu
CREATE TYPE app.source_consentement AS ENUM ('agence', 'reponse_client');

-- Délai avant de relancer un devis envoyé resté sans réponse, en jours
CREATE FUNCTION app.delai_relance_devis_jours() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;
-- Nombre d'essais d'envoi avant d'abandonner une relance
CREATE FUNCTION app.essais_relance_max() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;
GRANT EXECUTE ON FUNCTION app.delai_relance_devis_jours(), app.essais_relance_max() TO dbs_api;

-- ---------------------------------------------------------------------
-- Consentements (ajout seul : un changement d'avis est une nouvelle ligne)
-- ---------------------------------------------------------------------
CREATE TABLE app.consentements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordre d'enregistrement : le dernier choix du client pour un canal est celui qui compte
  ordre           bigint GENERATED ALWAYS AS IDENTITY,
  client_id       uuid NOT NULL REFERENCES app.clients (id),
  canal           app.canal_relance NOT NULL,
  accorde         boolean NOT NULL,
  source          app.source_consentement NOT NULL DEFAULT 'agence',
  -- Comment le choix a été exprimé : « accord oral au guichet », « formulaire signé », message reçu…
  preuve          text NOT NULL,
  enregistre_le   timestamptz NOT NULL,
  -- Personne qui l'a noté ; vide quand le client a répondu « STOP » lui-même
  enregistre_par  uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT consentements_ordre_unique UNIQUE (ordre),
  CONSTRAINT consentements_preuve_longueur CHECK (char_length(btrim(preuve)) BETWEEN 3 AND 300),
  CONSTRAINT consentements_auteur CHECK ((source = 'agence') = (enregistre_par IS NOT NULL))
);
CREATE INDEX consentements_client_idx ON app.consentements (client_id, canal, ordre DESC);

-- L'auteur et la date viennent de la transaction, jamais de l'application. Sans utilisateur
-- déclaré (réponse « STOP » traitée par le planificateur), l'auteur reste vide, ce qu'exige
-- consentements_auteur pour une réponse du client et interdit pour une saisie de l'agence.
CREATE FUNCTION app.horodater_consentement() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.enregistre_par := nullif(current_setting('app.utilisateur_id', true), '')::uuid;
  NEW.enregistre_le := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION app.interdire_modification_preuve() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Un consentement est une preuve : % interdit, enregistrez le nouveau choix du client', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER a_auteur BEFORE INSERT ON app.consentements
  FOR EACH ROW EXECUTE FUNCTION app.horodater_consentement();
CREATE TRIGGER b_ajout_seul BEFORE UPDATE OR DELETE ON app.consentements
  FOR EACH ROW EXECUTE FUNCTION app.interdire_modification_preuve();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.consentements
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- Dernier choix connu du client pour un canal ; sans choix enregistré : pas de relance
CREATE FUNCTION app.consentement_actuel(p_client uuid, p_canal app.canal_relance) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce((SELECT c.accorde FROM app.consentements c
                   WHERE c.client_id = p_client AND c.canal = p_canal
                   ORDER BY c.ordre DESC LIMIT 1), false)
$$;

CREATE VIEW app.v_consentements WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.client_id, c.canal)
       c.client_id, c.canal, c.accorde, c.source, c.preuve, c.enregistre_le, c.enregistre_par
FROM app.consentements c
ORDER BY c.client_id, c.canal, c.ordre DESC;

-- ---------------------------------------------------------------------
-- Sinistres : date du dernier changement de statut, pour en informer le client
-- (les sinistres déjà enregistrés n'en ont pas : ils ne déclenchent aucun message)
-- ---------------------------------------------------------------------
ALTER TABLE app.sinistres ADD COLUMN statut_modifie_le timestamptz;

CREATE FUNCTION app.horodater_statut_sinistre() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.statut_modifie_le := now();
  ELSE
    NEW.statut_modifie_le := OLD.statut_modifie_le;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER c_horodatage_statut BEFORE INSERT OR UPDATE ON app.sinistres
  FOR EACH ROW EXECUTE FUNCTION app.horodater_statut_sinistre();

-- ---------------------------------------------------------------------
-- Relances
-- ---------------------------------------------------------------------
CREATE TABLE app.relances (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Étape et objet : « echeance_j30:<contrat> », « sinistre_avancement:<sinistre>:<statut> »…
  cle                      text NOT NULL,
  type                     app.type_relance NOT NULL,
  client_id                uuid NOT NULL REFERENCES app.clients (id),
  contrat_id               uuid REFERENCES app.contrats (id),
  devis_id                 uuid REFERENCES app.devis (id),
  sinistre_id              uuid REFERENCES app.sinistres (id),
  canal                    app.canal_relance NOT NULL,
  -- Numéro au moment de l'envoi (E.164) : la preuve de ce qui a été envoyé, et à qui
  destinataire             text NOT NULL,
  -- Ce que le message annonce (nom, branche, n° de police, date…), rédigé par l'API au moment d'envoyer
  parametres               jsonb NOT NULL,
  statut                   app.statut_relance NOT NULL DEFAULT 'a_envoyer',
  -- Raison d'un échec ou d'une annulation (jamais de donnée personnelle)
  motif                    text,
  tentatives               smallint NOT NULL DEFAULT 0,
  prochaine_tentative      timestamptz NOT NULL DEFAULT now(),
  -- Identifiant donné par WhatsApp ou l'opérateur SMS, pour suivre la remise et la lecture
  identifiant_fournisseur  text,
  planifiee_le             timestamptz NOT NULL DEFAULT now(),
  envoyee_le               timestamptz,
  remise_le                timestamptz,
  lue_le                   timestamptz,
  annulee_le               timestamptz,
  -- Personne qui a annulé ; vide quand le planificateur abandonne (consentement retiré, trop tard)
  annulee_par              uuid REFERENCES app.utilisateurs (id),
  CONSTRAINT relances_cle_unique UNIQUE (cle),
  CONSTRAINT relances_fournisseur_unique UNIQUE (identifiant_fournisseur),
  CONSTRAINT relances_objet CHECK (CASE type
    WHEN 'devis_sans_reponse' THEN devis_id IS NOT NULL AND contrat_id IS NULL AND sinistre_id IS NULL
    WHEN 'sinistre_avancement' THEN sinistre_id IS NOT NULL AND contrat_id IS NOT NULL AND devis_id IS NULL
    ELSE contrat_id IS NOT NULL AND devis_id IS NULL AND sinistre_id IS NULL
  END),
  CONSTRAINT relances_destinataire_format CHECK (destinataire ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT relances_motif_longueur CHECK (motif IS NULL OR char_length(motif) <= 300),
  CONSTRAINT relances_tentatives CHECK (tentatives BETWEEN 0 AND 10),
  CONSTRAINT relances_envoi_identifie CHECK (statut NOT IN ('envoyee', 'remise', 'lue') OR identifiant_fournisseur IS NOT NULL),
  CONSTRAINT relances_annulation CHECK ((statut = 'annulee') = (annulee_le IS NOT NULL))
);
CREATE INDEX relances_a_envoyer_idx ON app.relances (prochaine_tentative) WHERE statut = 'a_envoyer';
CREATE INDEX relances_client_idx ON app.relances (client_id, planifiee_le DESC);
CREATE INDEX relances_planifiees_idx ON app.relances (planifiee_le DESC);

-- Le contenu d'une relance ne change jamais ; son statut suit un ordre précis.
-- Le personnel ne fait qu'une chose : annuler une relance pas encore partie.
CREATE FUNCTION app.controler_relance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_utilisateur uuid := nullif(current_setting('app.utilisateur_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une relance ne se supprime pas : annulez-la' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.cle, NEW.type, NEW.client_id, NEW.contrat_id, NEW.devis_id, NEW.sinistre_id, NEW.canal, NEW.destinataire,
      NEW.parametres, NEW.planifiee_le)
     IS DISTINCT FROM (OLD.cle, OLD.type, OLD.client_id, OLD.contrat_id, OLD.devis_id, OLD.sinistre_id, OLD.canal,
      OLD.destinataire, OLD.parametres, OLD.planifiee_le) THEN
    RAISE EXCEPTION 'Le contenu d''une relance ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    IF v_utilisateur IS NOT NULL AND NOT (OLD.statut = 'a_envoyer' AND NEW.statut = 'annulee') THEN
      RAISE EXCEPTION 'Seule une relance pas encore envoyée peut être annulée' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((OLD.statut = 'a_envoyer' AND NEW.statut IN ('envoyee', 'echec', 'annulee'))
         OR (OLD.statut = 'envoyee' AND NEW.statut IN ('remise', 'lue', 'echec'))
         OR (OLD.statut = 'remise' AND NEW.statut = 'lue')) THEN
      RAISE EXCEPTION 'Une relance « % » ne peut pas passer à « % »', OLD.statut, NEW.statut USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statut = 'annulee' THEN
      NEW.annulee_le := now();
      NEW.annulee_par := v_utilisateur;
      IF v_utilisateur IS NULL AND NEW.motif IS NULL THEN
        RAISE EXCEPTION 'Une relance abandonnée par le planificateur porte son motif' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF (NEW.annulee_le, NEW.annulee_par) IS DISTINCT FROM (OLD.annulee_le, OLD.annulee_par) THEN
    RAISE EXCEPTION 'Une annulation ne se modifie pas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER b_controle BEFORE UPDATE OR DELETE ON app.relances
  FOR EACH ROW EXECUTE FUNCTION app.controler_relance();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.relances
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- ---------------------------------------------------------------------
-- Ce qu'il faut annoncer aujourd'hui et qui n'est pas encore planifié
-- (security_invoker : à l'écran, chacun n'y voit que ce que ses droits permettent)
-- ---------------------------------------------------------------------
CREATE VIEW app.v_relances_dues WITH (security_invoker = true) AS
WITH candidats AS (
  -- Contrats en vigueur, pas encore renouvelés : une étape à J-30, J-15, J-7, le jour de l'échéance,
  -- puis « vous n'êtes plus couvert » dans les 7 jours qui suivent
  SELECT (CASE WHEN e.j BETWEEN 16 AND 30 THEN 'echeance_j30'
               WHEN e.j BETWEEN 8 AND 15 THEN 'echeance_j15'
               WHEN e.j BETWEEN 1 AND 7 THEN 'echeance_j7'
               WHEN e.j = 0 THEN 'echeance_jour'
               ELSE 'contrat_expire' END)::app.type_relance AS type,
         e.client_id, e.id AS contrat_id, NULL::uuid AS devis_id, NULL::uuid AS sinistre_id, NULL::text AS etape,
         jsonb_build_object('branche', e.branche, 'numeroPolice', e.numero_police, 'dateEcheance', e.date_echeance) AS parametres
  FROM (SELECT k.id, k.client_id, k.branche, k.numero_police, k.date_echeance, k.statut,
               k.date_echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS j
        FROM app.contrats k) e
  WHERE e.statut = 'en_vigueur' AND e.j BETWEEN -7 AND 30
    AND NOT EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = e.id)
  UNION ALL
  -- Devis envoyé resté sans réponse (au-delà d'un mois, il n'est plus relancé)
  SELECT 'devis_sans_reponse'::app.type_relance, d.client_id, NULL, d.id, NULL, NULL,
         jsonb_build_object('branche', d.branche)
  FROM app.devis d
  WHERE d.statut = 'envoye'
    AND d.modifie_le <= now() - make_interval(days => app.delai_relance_devis_jours())
    AND d.modifie_le > now() - interval '30 days'
  UNION ALL
  -- Sinistre : chaque statut (déclaration comprise) est annoncé une fois, dans la semaine
  SELECT 'sinistre_avancement'::app.type_relance, k.client_id, k.id, NULL, s.id, s.statut::text,
         jsonb_build_object('statut', s.statut, 'survenuLe', s.survenu_le, 'branche', k.branche,
                            'numeroPolice', k.numero_police)
  FROM app.sinistres s
  JOIN app.contrats k ON k.id = s.contrat_id
  WHERE s.statut_modifie_le > now() - interval '7 days'
), avec_cle AS (
  SELECT c.type::text || ':' || coalesce(c.devis_id, c.sinistre_id, c.contrat_id)::text || coalesce(':' || c.etape, '') AS cle,
         c.*
  FROM candidats c
)
SELECT a.cle, a.type, a.client_id, a.contrat_id, a.devis_id, a.sinistre_id,
       a.parametres || jsonb_build_object('nom', cl.nom) AS parametres, cl.telephone
FROM avec_cle a
JOIN app.clients cl ON cl.id = a.client_id
WHERE NOT EXISTS (SELECT 1 FROM app.relances r WHERE r.cle = a.cle);

-- ---------------------------------------------------------------------
-- Fonctions du planificateur (sans utilisateur connecté). SECURITY DEFINER : elles voient toutes
-- les lignes, mais ne font que ce qui est écrit ici ; l'API ne peut rien insérer d'autre.
-- ---------------------------------------------------------------------

-- Planifie les relances dues, sur le premier canal actif auquel le client a consenti
-- (WhatsApp d'abord). Sans consentement, rien n'est planifié : le tableau de bord le signale.
CREATE FUNCTION app.planifier_relances(p_canaux app.canal_relance[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  INSERT INTO app.relances (cle, type, client_id, contrat_id, devis_id, sinistre_id, canal, destinataire, parametres)
  SELECT d.cle, d.type, d.client_id, d.contrat_id, d.devis_id, d.sinistre_id, x.canal, d.telephone, d.parametres
  FROM app.v_relances_dues d
  CROSS JOIN LATERAL (SELECT CASE
      WHEN 'whatsapp' = ANY (p_canaux) AND app.consentement_actuel(d.client_id, 'whatsapp') THEN 'whatsapp'::app.canal_relance
      WHEN 'sms' = ANY (p_canaux) AND app.consentement_actuel(d.client_id, 'sms') THEN 'sms'::app.canal_relance
    END AS canal) x
  WHERE x.canal IS NOT NULL
  ON CONFLICT (cle) DO NOTHING;
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  RETURN v_nombre;
END
$$;

-- Réserve un lot de relances à envoyer maintenant. Avant cela, abandonne celles dont le client a
-- retiré son consentement et celles qui n'ont pas pu partir en 48 heures (le message serait périmé).
-- L'essai est compté avant l'envoi : si l'API s'arrête en plein envoi, la relance repart plus tard.
CREATE FUNCTION app.prendre_relances_a_envoyer(p_canaux app.canal_relance[], p_limite integer)
RETURNS TABLE (id uuid, type app.type_relance, canal app.canal_relance, destinataire text, parametres jsonb,
               tentatives smallint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  UPDATE app.relances r SET statut = 'annulee', motif = 'Consentement retiré avant l''envoi'
  WHERE r.statut = 'a_envoyer' AND NOT app.consentement_actuel(r.client_id, r.canal);
  UPDATE app.relances r SET statut = 'annulee', motif = 'Pas envoyée dans les 48 heures'
  WHERE r.statut = 'a_envoyer' AND r.planifiee_le < now() - interval '48 hours';

  RETURN QUERY
  UPDATE app.relances r
  SET tentatives = r.tentatives + 1,
      prochaine_tentative = now() + make_interval(mins => 15 * (r.tentatives + 1))
  FROM (SELECT x.id FROM app.relances x
        WHERE x.statut = 'a_envoyer' AND x.canal = ANY (p_canaux) AND x.prochaine_tentative <= now()
        ORDER BY x.planifiee_le
        LIMIT greatest(least(p_limite, 200), 0)
        FOR UPDATE SKIP LOCKED) choix
  WHERE r.id = choix.id
  RETURNING r.id, r.type, r.canal, r.destinataire, r.parametres, r.tentatives;
END
$$;

-- Résultat d'un envoi : identifiant du fournisseur si le message est parti ; sinon l'erreur,
-- et un nouvel essai plus tard sauf si l'erreur est définitive ou les essais épuisés.
CREATE FUNCTION app.enregistrer_envoi(p_relance uuid, p_identifiant text, p_erreur text, p_definitif boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_identifiant IS NOT NULL THEN
    UPDATE app.relances
    SET statut = 'envoyee', envoyee_le = now(), identifiant_fournisseur = left(p_identifiant, 200), motif = NULL
    WHERE id = p_relance AND statut = 'a_envoyer';
  ELSE
    UPDATE app.relances
    SET motif = left(coalesce(p_erreur, 'Erreur inconnue'), 300),
        statut = CASE WHEN p_definitif OR tentatives >= app.essais_relance_max() THEN 'echec'::app.statut_relance
                      ELSE 'a_envoyer'::app.statut_relance END
    WHERE id = p_relance AND statut = 'a_envoyer';
  END IF;
END
$$;

-- Accusé du fournisseur : remis, lu ou en échec. Un accusé arrivé en retard ne fait jamais reculer
-- le statut (« lu » reste « lu » si « remis » arrive après). Renvoie false si l'identifiant est inconnu.
CREATE FUNCTION app.enregistrer_statut_fournisseur(p_identifiant text, p_statut text, p_erreur text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_relance app.relances;
BEGIN
  SELECT * INTO v_relance FROM app.relances WHERE identifiant_fournisseur = p_identifiant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_statut = 'remise' AND v_relance.statut = 'envoyee' THEN
    UPDATE app.relances SET statut = 'remise', remise_le = now() WHERE id = v_relance.id;
  ELSIF p_statut = 'lue' AND v_relance.statut IN ('envoyee', 'remise') THEN
    UPDATE app.relances SET statut = 'lue', lue_le = now(), remise_le = coalesce(remise_le, now()) WHERE id = v_relance.id;
  ELSIF p_statut = 'echec' AND v_relance.statut = 'envoyee' THEN
    UPDATE app.relances SET statut = 'echec', motif = left(coalesce(p_erreur, 'Échec signalé par le fournisseur'), 300)
    WHERE id = v_relance.id;
  END IF;
  RETURN true;
END
$$;

-- Le client a répondu « STOP » : retrait de son consentement pour ce canal, sur chaque fiche qui
-- porte ce numéro. Le message reçu (tronqué) et l'heure servent de preuve. Renvoie le nombre de fiches.
CREATE FUNCTION app.enregistrer_desinscription(p_telephone text, p_canal app.canal_relance, p_message text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  INSERT INTO app.consentements (client_id, canal, accorde, source, preuve)
  SELECT c.id, p_canal, false, 'reponse_client',
         'Message « ' || left(regexp_replace(btrim(coalesce(p_message, '')), '\s+', ' ', 'g'), 40) || ' » reçu le '
           || to_char(now() AT TIME ZONE 'Africa/Abidjan', 'DD/MM/YYYY à HH24:MI')
  FROM app.clients c
  WHERE c.telephone = p_telephone;
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  RETURN v_nombre;
END
$$;

GRANT EXECUTE ON FUNCTION app.planifier_relances(app.canal_relance[]),
  app.prendre_relances_a_envoyer(app.canal_relance[], integer),
  app.enregistrer_envoi(uuid, text, text, boolean),
  app.enregistrer_statut_fournisseur(text, text, text),
  app.enregistrer_desinscription(text, app.canal_relance, text) TO dbs_api;

-- ---------------------------------------------------------------------
-- Droits (docs/securite/controle-des-acces.md)
-- ---------------------------------------------------------------------
ALTER TABLE app.consentements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.relances ENABLE ROW LEVEL SECURITY;

-- Consentements : visibles de qui voit le client ; notés par qui tient les fiches clients
CREATE POLICY consentements_lecture ON app.consentements FOR SELECT TO dbs_api
  USING (securite.client_visible(client_id));
CREATE POLICY consentements_creation ON app.consentements FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')) AND securite.client_visible(client_id));

-- Relances : suivies par qui gère les contrats, les devis et les sinistres ; annulées par le gérant
-- ou le chargé de clientèle. Aucun droit d'insertion : seul le planificateur les crée.
CREATE POLICY relances_lecture ON app.relances FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));
CREATE POLICY relances_annulation ON app.relances FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));

GRANT SELECT ON app.consentements, app.relances TO dbs_api;
GRANT INSERT (client_id, canal, accorde, preuve) ON app.consentements TO dbs_api;
GRANT UPDATE (statut) ON app.relances TO dbs_api;
GRANT SELECT ON app.v_consentements, app.v_relances_dues TO dbs_api;
