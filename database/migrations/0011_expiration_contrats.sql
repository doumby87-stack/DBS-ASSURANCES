-- =====================================================================
-- 0011 · Expiration des contrats
--
-- Jusqu'ici, un contrat restait « en vigueur » après son échéance tant que personne ne changeait son statut :
-- l'écran pouvait laisser croire qu'un client parti était encore couvert. Désormais, la maintenance de l'API
-- fait passer chaque heure à « expiré » tout contrat en vigueur dont l'échéance est passée (heure d'Abidjan).
--   · un contrat expiré non renouvelé reste au tableau des échéances, pour être relancé ;
--   · le rappel « vous n'êtes plus couvert » part toujours dans les 7 jours qui suivent l'échéance (0010) ;
--   · un avenant ne se fait que sur un contrat en vigueur, et la caisse reste ouverte au règlement d'un reste dû.
-- Un contrat qui n'a jamais été payé garde son statut « en attente de paiement » : il n'a jamais couvert.
-- =====================================================================

CREATE FUNCTION app.expirer_contrats() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombre integer;
BEGIN
  UPDATE app.contrats SET statut = 'expire'
  WHERE statut = 'en_vigueur' AND date_echeance < (now() AT TIME ZONE 'Africa/Abidjan')::date;
  GET DIAGNOSTICS v_nombre = ROW_COUNT;
  RETURN v_nombre;
END
$$;
REVOKE ALL ON FUNCTION app.expirer_contrats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expirer_contrats() TO dbs_api;

-- Tableau des échéances (0004) : mêmes colonnes ; les contrats expirés non renouvelés y restent
CREATE OR REPLACE VIEW app.v_echeances_contrats WITH (security_invoker = true) AS
SELECT c.id AS contrat_id, c.client_id, c.numero_police, c.branche, c.date_echeance,
       c.date_echeance - (now() AT TIME ZONE 'Africa/Abidjan')::date AS jours_restants
FROM app.contrats c
WHERE c.statut IN ('en_vigueur', 'expire')
  AND c.date_echeance <= (now() AT TIME ZONE 'Africa/Abidjan')::date + 60
  AND NOT EXISTS (SELECT 1 FROM app.contrats r WHERE r.renouvelle_id = c.id);
