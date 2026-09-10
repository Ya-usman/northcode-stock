-- ============================================================
-- Migration 140 : purge de l'historique des taux de change
-- ============================================================
-- Le cron `exchange-rates` insère ~13 lignes/jour (une par devise). On
-- conserve 120 jours d'historique par paire — utile pour l'audit — en
-- gardant TOUJOURS la ligne courante (la plus récente), même si elle est
-- plus vieille que 120 jours (fournisseur indisponible longtemps).
-- Appelée par app/api/cron/exchange-rates après un rafraîchissement réussi.

CREATE OR REPLACE FUNCTION prune_exchange_rates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    DELETE FROM exchange_rates e
    WHERE e.as_of < now() - interval '120 days'
      AND EXISTS (
        SELECT 1 FROM exchange_rates newer
        WHERE newer.base_currency  = e.base_currency
          AND newer.quote_currency = e.quote_currency
          AND newer.as_of > e.as_of
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM doomed;
  RETURN v_deleted;
END;
$$;
