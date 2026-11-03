-- =====================================================================
-- 0002 · Données métier et règles de l'agence
--
-- Clients, véhicules, contrats, encaissements, reversements à la compagnie, sinistres.
-- Les règles qui ne doivent jamais être contournées sont appliquées ici, dans la base,
-- et pas seulement dans l'application :
--   · plafond de 1 000 000 F CFA d'espèces par police ;
--   · pas de contrat « en vigueur » sans prime entièrement payée (Code CIMA, art. 13) ;
--   · encaissements jamais modifiés ni supprimés : une erreur se corrige par contre-passation ;
--   · reversement préparé par une personne et validé par une autre (principe des quatre yeux) ;
--   · délai de 30 jours pour reverser les primes encaissées (Code CIMA, art. 542) suivi en continu.
-- Montants en francs CFA, nombres entiers (le franc CFA n'a pas de centimes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
CREATE TYPE app.type_client AS ENUM ('particulier', 'professionnel', 'entreprise');

CREATE TYPE app.branche AS ENUM (
  'automobile', 'deux_roues', 'flotte', 'habitation', 'multirisque_professionnelle',
  'incendie_risques_divers', 'responsabilite_civile', 'individuelle_accident',
  'transport_marchandises', 'chantier_construction', 'industrie_bris_de_machines',
  'agricole', 'evenementiel', 'autre'
);

CREATE TYPE app.statut_contrat AS ENUM ('en_attente_paiement', 'en_vigueur', 'suspendu', 'resilie', 'expire');

CREATE TYPE app.mode_paiement AS ENUM ('especes', 'cheque', 'mobile_money', 'virement');

CREATE TYPE app.nature_sinistre AS ENUM ('materiel', 'corporel', 'vol', 'incendie', 'bris_de_glace', 'degat_des_eaux', 'autre');

CREATE TYPE app.statut_sinistre AS ENUM (
  'declare', 'transmis_compagnie', 'expertise', 'offre_recue', 'regle', 'refuse', 'classe_sans_suite'
);

-- Plafond des paiements en espèces par police (repris sur le site : « jusqu'à 1 000 000 F CFA par police »).
-- Une évolution réglementaire passe par une nouvelle migration, donc par une revue et l'historique Git.
CREATE FUNCTION app.plafond_especes_par_police() RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT 1000000::bigint $$;

-- Délai de reversement des primes encaissées à la compagnie, en jours (Code CIMA, art. 542)
CREATE FUNCTION app.delai_reversement_jours() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;

GRANT EXECUTE ON FUNCTION app.plafond_especes_par_police(), app.delai_reversement_jours() TO dbs_api;

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
CREATE TABLE app.clients (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                     app.type_client NOT NULL,
  nom                      text NOT NULL,
  telephone                text NOT NULL,
  email                    text,
  commune                  text,
  rccm                     text,
  -- Numéro de pièce d'identité chiffré par l'API (AES-256-GCM) : jamais stocké en clair
  piece_identite_chiffree  bytea,
  apporteur_id             uuid REFERENCES app.utilisateurs (id),
  cree_le                  timestamptz NOT NULL,
  cree_par                 uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT clients_nom_longueur CHECK (char_length(btrim(nom)) BETWEEN 2 AND 160),
  -- Format international E.164 : +2250749360702
  CONSTRAINT clients_telephone_format CHECK (telephone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT clients_email_format CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$')),
  CONSTRAINT clients_commune_longueur CHECK (commune IS NULL OR char_length(commune) <= 80)
);
CREATE INDEX clients_telephone_idx ON app.clients (telephone);  -- détection des doublons
CREATE INDEX clients_apporteur_idx ON app.clients (apporteur_id);

-- ---------------------------------------------------------------------
-- Véhicules (avec les échéances administratives suivies pour les transporteurs)
-- ---------------------------------------------------------------------
CREATE TABLE app.vehicules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  uuid NOT NULL REFERENCES app.clients (id),
  immatriculation            text NOT NULL,
  numero_chassis             text,
  marque                     text,
  modele                     text,
  genre                      text,
  usage                      text,
  puissance_fiscale          smallint,
  valeur_venale              bigint,
  echeance_visite_technique  date,
  echeance_vignette          date,
  echeance_carte_transport   date,
  cree_le                    timestamptz NOT NULL,
  cree_par                   uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT vehicules_immatriculation_unique UNIQUE (immatriculation),
  CONSTRAINT vehicules_immatriculation_format CHECK (immatriculation ~ '^[A-Z0-9][A-Z0-9 -]{2,14}$'),
  CONSTRAINT vehicules_puissance CHECK (puissance_fiscale IS NULL OR puissance_fiscale BETWEEN 1 AND 99),
  CONSTRAINT vehicules_valeur CHECK (valeur_venale IS NULL OR valeur_venale >= 0)
);
CREATE INDEX vehicules_client_idx ON app.vehicules (client_id);

-- ---------------------------------------------------------------------
-- Contrats
-- ---------------------------------------------------------------------
CREATE TABLE app.contrats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES app.clients (id),
  numero_police  text,  -- attribué par SanlamAllianz
  branche        app.branche NOT NULL,
  date_effet     date NOT NULL,
  date_echeance  date NOT NULL,
  prime_ttc      bigint NOT NULL,
  statut         app.statut_contrat NOT NULL DEFAULT 'en_attente_paiement',
  cree_le        timestamptz NOT NULL,
  cree_par       uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT contrats_numero_police_unique UNIQUE (numero_police),
  CONSTRAINT contrats_periode CHECK (date_echeance > date_effet),
  CONSTRAINT contrats_prime_positive CHECK (prime_ttc > 0)
);
CREATE INDEX contrats_client_idx ON app.contrats (client_id);
CREATE INDEX contrats_echeance_idx ON app.contrats (date_echeance) WHERE statut = 'en_vigueur';

-- Véhicules couverts par un contrat (une flotte = un contrat, plusieurs véhicules)
CREATE TABLE app.contrats_vehicules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrat_id          uuid NOT NULL REFERENCES app.contrats (id),
  vehicule_id         uuid NOT NULL REFERENCES app.vehicules (id),
  numero_attestation  text,  -- attestation digitale ASACI
  ajoute_le           date NOT NULL,
  retire_le           date,
  CONSTRAINT contrats_vehicules_unique UNIQUE (contrat_id, vehicule_id),
  CONSTRAINT contrats_vehicules_attestation_unique UNIQUE (numero_attestation),
  CONSTRAINT contrats_vehicules_periode CHECK (retire_le IS NULL OR retire_le >= ajoute_le)
);

-- ---------------------------------------------------------------------
-- Reversements à la compagnie (bordereaux)
-- ---------------------------------------------------------------------
CREATE TABLE app.reversements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_bordereau    text NOT NULL,
  periode_debut       date NOT NULL,
  periode_fin         date NOT NULL,
  prepare_le          timestamptz NOT NULL,
  prepare_par         uuid NOT NULL REFERENCES app.utilisateurs (id),
  valide_le           timestamptz,
  valide_par          uuid REFERENCES app.utilisateurs (id),
  verse_le            date,
  reference_virement  text,
  CONSTRAINT reversements_bordereau_unique UNIQUE (numero_bordereau),
  CONSTRAINT reversements_periode CHECK (periode_fin >= periode_debut),
  CONSTRAINT reversements_validation_complete CHECK ((valide_le IS NULL) = (valide_par IS NULL)),
  -- Principe des quatre yeux : celui qui prépare ne valide pas
  CONSTRAINT reversements_quatre_yeux CHECK (valide_par IS NULL OR valide_par <> prepare_par),
  CONSTRAINT reversements_versement_apres_validation CHECK (verse_le IS NULL OR valide_le IS NOT NULL),
  CONSTRAINT reversements_reference_versement CHECK (verse_le IS NULL OR reference_virement IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Encaissements : un reçu par paiement, jamais modifié, jamais supprimé
-- ---------------------------------------------------------------------
CREATE TABLE app.encaissements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_recu             bigint GENERATED ALWAYS AS IDENTITY,
  contrat_id              uuid NOT NULL REFERENCES app.contrats (id),
  montant                 bigint NOT NULL,
  mode                    app.mode_paiement NOT NULL,
  -- N° de transaction Mobile Money, de chèque ou de virement
  reference_externe       text,
  -- Contre-passation : montant négatif qui annule un encaissement erroné, avec son motif
  annule_encaissement_id  uuid REFERENCES app.encaissements (id),
  motif                   text,
  encaisse_le             timestamptz NOT NULL DEFAULT now(),
  encaisse_par            uuid NOT NULL REFERENCES app.utilisateurs (id),
  reversement_id          uuid REFERENCES app.reversements (id),
  CONSTRAINT encaissements_recu_unique UNIQUE (numero_recu),
  CONSTRAINT encaissements_montant CHECK (
    (montant > 0 AND annule_encaissement_id IS NULL)
    OR (montant < 0 AND annule_encaissement_id IS NOT NULL AND char_length(btrim(coalesce(motif, ''))) >= 5)
  ),
  -- Traçabilité : tout paiement autre qu'en espèces a une référence vérifiable
  CONSTRAINT encaissements_reference CHECK (mode = 'especes' OR montant < 0 OR reference_externe IS NOT NULL)
);
-- Idempotence : une même transaction Mobile Money, un même chèque, n'est enregistré qu'une fois
CREATE UNIQUE INDEX encaissements_reference_unique ON app.encaissements (mode, reference_externe)
  WHERE montant > 0 AND reference_externe IS NOT NULL;
-- Un encaissement ne peut être contre-passé qu'une fois
CREATE UNIQUE INDEX encaissements_annulation_unique ON app.encaissements (annule_encaissement_id)
  WHERE annule_encaissement_id IS NOT NULL;
CREATE INDEX encaissements_contrat_idx ON app.encaissements (contrat_id);
CREATE INDEX encaissements_a_reverser_idx ON app.encaissements (encaisse_le) WHERE reversement_id IS NULL;

-- ---------------------------------------------------------------------
-- Sinistres
-- ---------------------------------------------------------------------
CREATE TABLE app.sinistres (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrat_id           uuid NOT NULL REFERENCES app.contrats (id),
  vehicule_id          uuid REFERENCES app.vehicules (id),
  survenu_le           date NOT NULL,
  declare_le           date NOT NULL DEFAULT current_date,
  nature               app.nature_sinistre NOT NULL,
  dommages_corporels   boolean NOT NULL DEFAULT false,
  description          text,
  statut               app.statut_sinistre NOT NULL DEFAULT 'declare',
  reference_compagnie  text,
  cree_le              timestamptz NOT NULL,
  cree_par             uuid NOT NULL REFERENCES app.utilisateurs (id),
  CONSTRAINT sinistres_dates CHECK (declare_le >= survenu_le),
  CONSTRAINT sinistres_description_longueur CHECK (description IS NULL OR char_length(description) <= 4000)
);
CREATE INDEX sinistres_contrat_idx ON app.sinistres (contrat_id);

-- =====================================================================
-- Règles appliquées par déclencheurs
-- Les fonctions qui doivent voir toutes les lignes (sommes, contrôles) sont en SECURITY DEFINER :
-- le filtrage par utilisateur ne doit pas fausser un plafond ou un total.
-- =====================================================================

-- Total encaissé sur un contrat (contre-passations déduites)
CREATE FUNCTION app.total_encaisse(p_contrat uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT coalesce(sum(e.montant), 0)::bigint FROM app.encaissements e WHERE e.contrat_id = p_contrat $$;

-- Code CIMA, art. 13 : pas de garantie sans paiement de la prime
CREATE FUNCTION app.controler_contrat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_encaisse bigint;
BEGIN
  IF NEW.statut = 'en_vigueur' THEN
    v_encaisse := app.total_encaisse(NEW.id);
    IF v_encaisse < NEW.prime_ttc THEN
      RAISE EXCEPTION 'Contrat non mis en vigueur : prime de % F CFA, % F CFA encaissés (Code CIMA, art. 13)',
        NEW.prime_ttc, v_encaisse
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION app.controler_encaissement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_total_especes bigint;
  v_origine app.encaissements;
BEGIN
  IF NEW.encaisse_le > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Date d''encaissement dans le futur' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.encaisse_le < now() - make_interval(days => app.delai_reversement_jours()) THEN
    RAISE EXCEPTION 'Encaissement daté de plus de % jours : saisie tardive à faire régulariser par le gérant',
      app.delai_reversement_jours() USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reversement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un encaissement est rattaché à un bordereau après sa saisie, pas pendant'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.montant < 0 THEN
    SELECT * INTO v_origine FROM app.encaissements WHERE id = NEW.annule_encaissement_id;
    IF NOT FOUND OR v_origine.montant < 0 OR v_origine.contrat_id <> NEW.contrat_id
       OR v_origine.mode <> NEW.mode OR NEW.montant <> -v_origine.montant THEN
      RAISE EXCEPTION 'Contre-passation invalide : elle doit annuler exactement un encaissement du même contrat et du même mode'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.mode = 'especes' AND NEW.montant > 0 THEN
    -- Verrouille le contrat : deux caisses ne peuvent pas dépasser le plafond en même temps
    PERFORM 1 FROM app.contrats WHERE id = NEW.contrat_id FOR UPDATE;
    SELECT coalesce(sum(e.montant), 0) INTO v_total_especes
    FROM app.encaissements e
    WHERE e.contrat_id = NEW.contrat_id AND e.mode = 'especes';
    IF v_total_especes + NEW.montant > app.plafond_especes_par_police() THEN
      RAISE EXCEPTION 'Plafond des espèces dépassé : % F CFA déjà réglés en espèces sur cette police, plafond de % F CFA',
        v_total_especes, app.plafond_especes_par_police()
        USING ERRCODE = 'check_violation',
              HINT = 'Le reste doit être réglé par chèque à l''ordre de SanlamAllianz CI, Mobile Money ou virement.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Seule modification permise : rattacher l'encaissement à un bordereau encore ouvert
CREATE FUNCTION app.proteger_encaissement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_valide_le timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un encaissement ne se supprime pas : enregistrez une contre-passation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'reversement_id') IS DISTINCT FROM (to_jsonb(OLD) - 'reversement_id')
     OR OLD.reversement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Un encaissement ne se modifie pas : enregistrez une contre-passation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.reversement_id IS NOT NULL THEN
    SELECT r.valide_le INTO v_valide_le FROM app.reversements r WHERE r.id = NEW.reversement_id FOR SHARE;
    IF v_valide_le IS NOT NULL THEN
      RAISE EXCEPTION 'Bordereau déjà validé : il ne peut plus recevoir d''encaissement'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION app.controler_reversement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.valide_le := NULL;
    NEW.valide_par := NULL;
    NEW.verse_le := NULL;
    RETURN NEW;
  END IF;

  IF OLD.verse_le IS NOT NULL THEN
    RAISE EXCEPTION 'Bordereau déjà versé à la compagnie : il ne se modifie plus'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.numero_bordereau, NEW.periode_debut, NEW.periode_fin, NEW.prepare_le, NEW.prepare_par)
     IS DISTINCT FROM (OLD.numero_bordereau, OLD.periode_debut, OLD.periode_fin, OLD.prepare_le, OLD.prepare_par) THEN
    RAISE EXCEPTION 'Le numéro, la période et l''auteur d''un bordereau ne se modifient pas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.valide_le IS NULL AND NEW.valide_le IS NOT NULL THEN
    -- La validation est toujours attribuée à l'utilisateur authentifié, à l'heure du serveur
    NEW.valide_par := securite.utilisateur_courant();
    NEW.valide_le := now();
    IF NOT EXISTS (SELECT 1 FROM app.encaissements e WHERE e.reversement_id = NEW.id) THEN
      RAISE EXCEPTION 'Bordereau vide : rattachez-y des encaissements avant de le valider'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.valide_le, NEW.valide_par) IS DISTINCT FROM (OLD.valide_le, OLD.valide_par) THEN
    RAISE EXCEPTION 'Une validation ne se modifie pas et ne s''annule pas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION app.controler_sinistre() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.survenu_le > current_date THEN
    RAISE EXCEPTION 'Date de survenance dans le futur' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Déclencheurs. PostgreSQL les exécute par ordre alphabétique : a_ (auteur) puis b_ (contrôles), z_ (journal) en dernier.
CREATE TRIGGER a_auteur BEFORE INSERT ON app.clients
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER a_auteur BEFORE INSERT ON app.vehicules
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER a_auteur BEFORE INSERT ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER a_auteur BEFORE INSERT ON app.sinistres
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('cree_par', 'cree_le');
CREATE TRIGGER a_auteur BEFORE INSERT ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('encaisse_par');
CREATE TRIGGER a_auteur BEFORE INSERT ON app.reversements
  FOR EACH ROW EXECUTE FUNCTION securite.renseigner_auteur('prepare_par', 'prepare_le');

CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE OF statut, prime_ttc ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION app.controler_contrat();
CREATE TRIGGER b_controle BEFORE INSERT ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION app.controler_encaissement();
CREATE TRIGGER b_protection BEFORE UPDATE OR DELETE ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION app.proteger_encaissement();
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE ON app.reversements
  FOR EACH ROW EXECUTE FUNCTION app.controler_reversement();
CREATE TRIGGER b_controle BEFORE INSERT OR UPDATE OF survenu_le ON app.sinistres
  FOR EACH ROW EXECUTE FUNCTION app.controler_sinistre();

CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.clients
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.vehicules
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.contrats
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.contrats_vehicules
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.encaissements
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.reversements
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();
CREATE TRIGGER z_journal AFTER INSERT OR UPDATE OR DELETE ON app.sinistres
  FOR EACH ROW EXECUTE FUNCTION audit.journaliser();

-- =====================================================================
-- Contrôle d'accès ligne par ligne (matrice : docs/securite/controle-des-acces.md)
-- Aucune politique = aucun accès. Aucun droit DELETE n'est accordé : rien ne s'efface.
-- =====================================================================
ALTER TABLE app.clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vehicules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contrats           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contrats_vehicules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.encaissements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reversements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sinistres          ENABLE ROW LEVEL SECURITY;

-- Le client est-il visible par l'utilisateur courant ? (l'apporteur ne voit que les siens)
CREATE FUNCTION securite.client_visible(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT securite.a_le_role('gerant', 'charge_clientele', 'caissier', 'commercial', 'auditeur')
      OR (securite.a_le_role('apporteur')
          AND EXISTS (SELECT 1 FROM app.clients c
                      WHERE c.id = p_client AND c.apporteur_id = securite.utilisateur_courant()))
$$;
GRANT EXECUTE ON FUNCTION securite.client_visible(uuid) TO dbs_api;

-- Clients
CREATE POLICY clients_lecture ON app.clients FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'caissier', 'commercial', 'auditeur'))
         OR ((SELECT securite.a_le_role('apporteur')) AND apporteur_id = (SELECT securite.utilisateur_courant())));
CREATE POLICY clients_creation ON app.clients FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial'))
              OR ((SELECT securite.a_le_role('apporteur')) AND apporteur_id = (SELECT securite.utilisateur_courant())));
CREATE POLICY clients_modification ON app.clients FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));

-- Véhicules
CREATE POLICY vehicules_lecture ON app.vehicules FOR SELECT TO dbs_api
  USING (securite.client_visible(client_id));
CREATE POLICY vehicules_creation ON app.vehicules FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));
CREATE POLICY vehicules_modification ON app.vehicules FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial')));

-- Contrats
CREATE POLICY contrats_lecture ON app.contrats FOR SELECT TO dbs_api
  USING (securite.client_visible(client_id));
CREATE POLICY contrats_creation ON app.contrats FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY contrats_modification ON app.contrats FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));

CREATE POLICY contrats_vehicules_lecture ON app.contrats_vehicules FOR SELECT TO dbs_api
  USING (EXISTS (SELECT 1 FROM app.contrats c WHERE c.id = contrat_id));  -- hérite du filtrage des contrats
CREATE POLICY contrats_vehicules_creation ON app.contrats_vehicules FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY contrats_vehicules_modification ON app.contrats_vehicules FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));

-- Encaissements : la caisse. Seul le gérant enregistre une contre-passation.
CREATE POLICY encaissements_lecture ON app.encaissements FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'caissier', 'charge_clientele', 'auditeur')));
CREATE POLICY encaissements_creation ON app.encaissements FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'caissier'))
              AND (montant > 0 OR (SELECT securite.a_le_role('gerant'))));
CREATE POLICY encaissements_rattachement ON app.encaissements FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'caissier')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'caissier')));

-- Reversements : préparés par la caisse, validés et versés par le gérant
CREATE POLICY reversements_lecture ON app.reversements FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'caissier', 'auditeur')));
CREATE POLICY reversements_preparation ON app.reversements FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'caissier')));
CREATE POLICY reversements_validation ON app.reversements FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant')))
  WITH CHECK ((SELECT securite.a_le_role('gerant')));

-- Sinistres
CREATE POLICY sinistres_lecture ON app.sinistres FOR SELECT TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele', 'commercial', 'auditeur')));
CREATE POLICY sinistres_creation ON app.sinistres FOR INSERT TO dbs_api
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));
CREATE POLICY sinistres_modification ON app.sinistres FOR UPDATE TO dbs_api
  USING ((SELECT securite.a_le_role('gerant', 'charge_clientele')))
  WITH CHECK ((SELECT securite.a_le_role('gerant', 'charge_clientele')));

-- Droits par colonne : l'auteur, les dates de création et les numéros de reçu ne sont jamais modifiables
GRANT SELECT, INSERT ON app.clients, app.vehicules, app.contrats, app.contrats_vehicules,
  app.encaissements, app.reversements, app.sinistres TO dbs_api;
GRANT UPDATE (type, nom, telephone, email, commune, rccm, piece_identite_chiffree, apporteur_id)
  ON app.clients TO dbs_api;
GRANT UPDATE (immatriculation, numero_chassis, marque, modele, genre, usage, puissance_fiscale, valeur_venale,
              echeance_visite_technique, echeance_vignette, echeance_carte_transport)
  ON app.vehicules TO dbs_api;
GRANT UPDATE (numero_police, branche, date_effet, date_echeance, prime_ttc, statut) ON app.contrats TO dbs_api;
GRANT UPDATE (numero_attestation, retire_le) ON app.contrats_vehicules TO dbs_api;
GRANT UPDATE (reversement_id) ON app.encaissements TO dbs_api;
GRANT UPDATE (valide_le, verse_le, reference_virement) ON app.reversements TO dbs_api;
GRANT UPDATE (statut, reference_compagnie, description, dommages_corporels) ON app.sinistres TO dbs_api;

-- =====================================================================
-- Vues de pilotage (security_invoker : chacun n'y voit que ce que ses droits permettent)
-- =====================================================================
CREATE VIEW app.v_soldes_contrats WITH (security_invoker = true) AS
SELECT c.id AS contrat_id, c.client_id, c.numero_police, c.branche, c.statut, c.prime_ttc,
       coalesce(sum(e.montant), 0)::bigint AS total_encaisse,
       (c.prime_ttc - coalesce(sum(e.montant), 0))::bigint AS reste_a_payer
FROM app.contrats c
LEFT JOIN app.encaissements e ON e.contrat_id = c.id
GROUP BY c.id;

-- Primes encaissées pas encore versées à la compagnie, avec le compte à rebours des 30 jours
CREATE VIEW app.v_encaissements_a_reverser WITH (security_invoker = true) AS
SELECT e.id AS encaissement_id, e.numero_recu, e.contrat_id, e.montant, e.mode, e.encaisse_le,
       e.reversement_id, r.numero_bordereau,
       (e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date + app.delai_reversement_jours() AS date_limite,
       ((e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date + app.delai_reversement_jours())
         - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours_restants,
       ((e.encaisse_le AT TIME ZONE 'Africa/Abidjan')::date + app.delai_reversement_jours())
         < (now() AT TIME ZONE 'Africa/Abidjan')::date AS en_retard
FROM app.encaissements e
LEFT JOIN app.reversements r ON r.id = e.reversement_id
WHERE r.verse_le IS NULL;

-- Contrats à renouveler dans les 60 jours
CREATE VIEW app.v_echeances_contrats WITH (security_invoker = true) AS
SELECT c.id AS contrat_id, c.client_id, c.numero_police, c.branche, c.date_echeance,
       c.date_echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours_restants
FROM app.contrats c
WHERE c.statut = 'en_vigueur'
  AND c.date_echeance <= (now() AT TIME ZONE 'Africa/Abidjan')::date + 60;

-- Échéances administratives des véhicules (visite technique, vignette, carte de transport) dans les 60 jours
CREATE VIEW app.v_echeances_vehicules WITH (security_invoker = true) AS
SELECT v.id AS vehicule_id, v.client_id, v.immatriculation, e.document, e.echeance,
       e.echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours_restants
FROM app.vehicules v
CROSS JOIN LATERAL (VALUES
  ('visite_technique', v.echeance_visite_technique),
  ('vignette', v.echeance_vignette),
  ('carte_de_transport', v.echeance_carte_transport)
) AS e(document, echeance)
WHERE e.echeance IS NOT NULL
  AND e.echeance <= (now() AT TIME ZONE 'Africa/Abidjan')::date + 60;

-- Suivi des sinistres : délai de déclaration et, en cas de dommages corporels, date limite
-- indicative de l'offre d'indemnisation (Code CIMA, art. 231 : six mois après l'accident)
CREATE VIEW app.v_sinistres_suivi WITH (security_invoker = true) AS
SELECT s.id AS sinistre_id, s.contrat_id, s.nature, s.statut, s.survenu_le, s.declare_le,
       s.declare_le - s.survenu_le AS delai_declaration_jours,
       CASE WHEN s.dommages_corporels THEN (s.survenu_le + interval '6 months')::date END AS limite_offre_indicative
FROM app.sinistres s;

GRANT SELECT ON app.v_soldes_contrats, app.v_encaissements_a_reverser, app.v_echeances_contrats,
  app.v_echeances_vehicules, app.v_sinistres_suivi TO dbs_api;
