-- =====================================================================
-- 0019 · Nouveau type de relance : échéance d'une prime payée en plusieurs fois
--
-- Seule dans sa migration : PostgreSQL n'autorise l'emploi d'une nouvelle valeur d'énumération
-- qu'une fois la transaction qui l'a ajoutée validée. La migration 0020 s'en sert.
-- =====================================================================
ALTER TYPE app.type_relance ADD VALUE 'echeance_paiement';
