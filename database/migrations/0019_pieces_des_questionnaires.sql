-- =====================================================================
-- 0019 · Demande de devis du site : quatre documents de plus, d'après les questionnaires des compagnies
--
-- La comparaison des questionnaires de souscription avec le formulaire du site
-- (docs/audit/2026-11-questionnaires-des-compagnies.md) a ajouté au formulaire les questions qui fixent le prix et
-- celles qui disent quel questionnaire envoyer (devis-par-assurance.ts, sans changement en base : les réponses sont
-- du JSON contrôlé par l'API). Elle propose aussi quatre documents que les compagnies demandent :
--   · questionnaire_compagnie : le questionnaire de la compagnie, déjà rempli par le client ;
--   · rapport_sol_controle    : le rapport de sol ou du bureau de contrôle d'un chantier ;
--   · planning_plans          : le planning et les plans du chantier ;
--   · plan_plantation         : la carte ou le plan d'une plantation.
-- Seule la liste des natures permises change. Ce sont des photos ou des PDF, jamais des classeurs Excel.
-- =====================================================================

ALTER TABLE app.pieces_demandes_site
  DROP CONSTRAINT pieces_demandes_site_nature,
  ADD CONSTRAINT pieces_demandes_site_nature CHECK (nature IN (
    'carte_grise', 'attestation_precedente', 'liste_vehicules', 'carte_transport', 'registre_commerce',
    'photos_bien', 'devis_travaux', 'liste_materiel', 'liste_personnes', 'cahier_des_charges',
    'questionnaire_compagnie', 'rapport_sol_controle', 'planning_plans', 'plan_plantation', 'autre'));
