-- =====================================================================
-- 0009 · Nouveau type de relance : documents des véhicules (visite technique, vignette, carte de transport)
--
-- Seule dans sa migration : PostgreSQL n'autorise l'emploi d'une nouvelle valeur d'énumération
-- qu'une fois la transaction qui l'a ajoutée validée. La migration 0010 s'en sert.
-- =====================================================================
ALTER TYPE app.type_relance ADD VALUE 'documents_vehicules';
