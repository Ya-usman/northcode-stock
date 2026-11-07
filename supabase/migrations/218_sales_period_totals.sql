-- 218 — Totaux de période de l'Historique des ventes calculés par la base (7 nov. 2026, état des lieux de la montée
-- en charge, lot S1). Avant : l'écran lisait toutes les ventes et tous les paiements de la période pour les additionner
-- dans le navigateur ; la base ne renvoyant que 1000 lignes par réponse, les totaux étaient FAUX au-delà de 1000 ventes
-- (une boutique en a déjà 2 440 sur l'année).
--   • sales_period_totals : nombre de ventes, chiffre d'affaires, reste dû (ventes annulées exclues du reste dû) ;
--   • payments_period_collected : encaissé de la période (paiements non annulés, hors abandons de créance).
-- Mêmes filtres que l'écran (boutiques, période, statut de la vente, moyen de paiement, statut du paiement) et même
-- règle « mes ventes » : dans les boutiques où la personne est vendeuse (p_mine_shop_ids), seules ses ventes
-- (cashier_id) et ses encaissements (received_by) comptent.
-- SECURITY INVOKER : les règles d'accès (RLS) des ventes et des paiements s'appliquent exactement comme pour les
-- lectures de l'écran ; aucune donnée n'est visible en plus. Aucune table modifiée.
-- Retour arrière : supabase/rollbacks/218_sales_period_totals_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sales_period_totals(
  p_shop_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_sale_statuses text[],
  p_methods text[] DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_mine_shop_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (sale_count bigint, revenue numeric, open_balance numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::bigint,
    coalesce(sum(s.total), 0)::numeric,
    coalesce(sum(s.balance) FILTER (WHERE s.sale_status <> 'cancelled'), 0)::numeric
  FROM public.sales s
  WHERE s.shop_id = ANY (p_shop_ids)
    AND s.created_at >= p_start
    AND s.created_at <= p_end
    AND s.sale_status = ANY (p_sale_statuses)
    AND (p_methods IS NULL OR s.payment_method = ANY (p_methods))
    AND (p_payment_status IS NULL OR s.payment_status = p_payment_status)
    AND (p_mine_shop_ids IS NULL OR NOT (s.shop_id = ANY (p_mine_shop_ids)) OR s.cashier_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.payments_period_collected(
  p_shop_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_sale_statuses text[] DEFAULT NULL,
  p_methods text[] DEFAULT NULL,
  p_mine_shop_ids uuid[] DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(p.amount), 0)::numeric
  FROM public.payments p
  JOIN public.sales s ON s.id = p.sale_id
  WHERE s.shop_id = ANY (p_shop_ids)
    AND p.is_cancelled = false
    AND p.is_write_off = false
    AND p.paid_at >= p_start
    AND p.paid_at <= p_end
    AND (p_sale_statuses IS NULL OR s.sale_status = ANY (p_sale_statuses))
    AND (p_methods IS NULL OR p.method = ANY (p_methods))
    AND (p_mine_shop_ids IS NULL OR NOT (s.shop_id = ANY (p_mine_shop_ids)) OR p.received_by = auth.uid())
$$;

-- Comptes connectés seulement (le retrait à PUBLIC ne suffit pas sur Supabase : anon est nommé explicitement)
REVOKE ALL ON FUNCTION public.sales_period_totals(uuid[], timestamptz, timestamptz, text[], text[], text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payments_period_collected(uuid[], timestamptz, timestamptz, text[], text[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_period_totals(uuid[], timestamptz, timestamptz, text[], text[], text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payments_period_collected(uuid[], timestamptz, timestamptz, text[], text[], uuid[]) TO authenticated, service_role;
