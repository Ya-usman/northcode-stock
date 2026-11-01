-- ============================================================
-- 194 : inventaire tournant (étape 14 du Stock, 31 oct. 2026)
-- ============================================================
-- Compter régulièrement QUELQUES produits plutôt que tout le stock d'un coup :
-- 1. inventory_sessions.scope ('full' = tout le stock, comme avant ; 'cycle' = inventaire tournant) et
--    scope_product_ids (produits choisis au démarrage, 'cycle' seulement).
-- 2. start_cycle_inventory_session(shop, user, produits) : démarre un inventaire tournant sur des produits ACTIFS de
--    la boutique (doublons et produits étrangers écartés, 200 au plus) ; même verrou et même règle « une seule
--    session en cours par boutique » que start_inventory_session (une session en cours est reprise telle quelle).
-- 3. record_inventory_count : texte de PRODUCTION (175) + refus d'un produit hors du périmètre d'un inventaire
--    tournant (product_out_of_scope). Rien d'autre ne change ; la finalisation est inchangée (elle n'a jamais touché
--    aux produits non comptés).
-- 4. product_last_counted(shop) : date du dernier comptage de chaque produit (sessions terminées, ligne courante),
--    pour choisir les produits à compter en priorité.
-- Tout reste réservé au serveur (service_role). Additive, ré-exécutable.
-- Retour arrière : supabase/rollbacks/194_cycle_inventory_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.inventory_sessions ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full';
ALTER TABLE public.inventory_sessions ADD COLUMN IF NOT EXISTS scope_product_ids uuid[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_sessions_scope_check') THEN
    ALTER TABLE public.inventory_sessions ADD CONSTRAINT inventory_sessions_scope_check CHECK (
      (scope = 'full' AND scope_product_ids IS NULL)
      OR (scope = 'cycle' AND scope_product_ids IS NOT NULL AND cardinality(scope_product_ids) BETWEEN 1 AND 200)
    );
  END IF;
END $$;

-- ── 2. Démarrer un inventaire tournant ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_cycle_inventory_session(p_shop_id uuid, p_user uuid, p_product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_id    uuid;
  v_ref   text;
  v_scope text;
  v_year  text := to_char(now(), 'YYYY');
  v_seq   int;
  v_ids   uuid[];
  v_total int;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:' || p_shop_id::text, 0));

  select id, reference, scope into v_id, v_ref, v_scope from inventory_sessions where shop_id = p_shop_id and status = 'in_progress';
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', true, 'scope', v_scope);
  end if;

  -- Produits actifs de CETTE boutique seulement, sans doublon, dans l'ordre donné, 200 au plus
  select coalesce(array_agg(x.id order by x.ord), '{}') into v_ids from (
    select distinct on (p.id) p.id, u.ord
      from unnest(coalesce(p_product_ids, '{}'::uuid[])) with ordinality as u(pid, ord)
      join products p on p.id = u.pid and p.shop_id = p_shop_id and p.is_active
     order by p.id, u.ord
  ) x;
  v_ids := v_ids[1:200];
  v_total := coalesce(cardinality(v_ids), 0);
  if v_total = 0 then raise exception 'nothing_to_count'; end if;

  select coalesce(max(nullif(split_part(reference, '-', 3), '')::int), 0) + 1 into v_seq
    from inventory_sessions where shop_id = p_shop_id and reference like 'INV-' || v_year || '-%';
  v_ref := 'INV-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into inventory_sessions (shop_id, reference, status, started_by, products_total, scope, scope_product_ids)
    values (p_shop_id, v_ref, 'in_progress', p_user, v_total, 'cycle', v_ids)
    returning id into v_id;
  perform _inventory_audit(p_shop_id, p_user, 'inventory.start', v_id,
    jsonb_build_object('reference', v_ref, 'products_total', v_total, 'scope', 'cycle'));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', false, 'scope', 'cycle');
end;
$$;

-- ── 3. Comptage : refus hors du périmètre d'un inventaire tournant ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_inventory_count(p_session_id uuid, p_shop_id uuid, p_product_id uuid, p_counted_qty integer, p_user uuid, p_expected_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status  text;
  v_shop    uuid;
  v_cur_id  uuid;
  v_cur_qty int;
  v_cur_by  uuid;
  v_cur_at  timestamptz;
  v_qty     int;
  v_name    text;
  v_unit    text;
  v_new     uuid;
  v_scope   text;
  v_ids     uuid[];
begin
  if p_counted_qty is null or p_counted_qty < 0 then raise exception 'invalid_quantity'; end if;

  select status, shop_id, scope, scope_product_ids into v_status, v_shop, v_scope, v_ids from inventory_sessions where id = p_session_id for share;
  if not found or v_shop <> p_shop_id then raise exception 'session_not_found'; end if;
  if v_status <> 'in_progress' then raise exception 'session_closed'; end if;
  -- 194 : inventaire tournant, seuls les produits choisis au démarrage se comptent
  if v_scope = 'cycle' and not (p_product_id = any(v_ids)) then raise exception 'product_out_of_scope'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_product_id::text, 0));

  select id, counted_qty, counted_by, counted_at into v_cur_id, v_cur_qty, v_cur_by, v_cur_at
    from inventory_counts where session_id = p_session_id and product_id = p_product_id and superseded_at is null;

  if v_cur_id is distinct from p_expected_count_id then
    return jsonb_build_object('conflict', true, 'current', case when v_cur_id is null then null else
      jsonb_build_object('id', v_cur_id, 'counted_qty', v_cur_qty, 'counted_by', v_cur_by, 'counted_at', v_cur_at) end);
  end if;

  select quantity, name, unit into v_qty, v_name, v_unit from products where id = p_product_id and shop_id = p_shop_id;
  if not found then raise exception 'product_not_found'; end if;

  if v_cur_id is not null then
    update inventory_counts set superseded_at = now(), superseded_by = p_user where id = v_cur_id;
  end if;
  insert into inventory_counts (session_id, shop_id, product_id, product_name, unit, theoretical_qty, counted_qty, counted_by)
    values (p_session_id, p_shop_id, p_product_id, v_name, v_unit, v_qty, p_counted_qty, p_user)
    returning id into v_new;
  update inventory_sessions set updated_at = now() where id = p_session_id;

  return jsonb_build_object('conflict', false, 'id', v_new, 'theoretical_qty', v_qty,
                            'counted_qty', p_counted_qty, 'delta', p_counted_qty - v_qty, 'replaced', v_cur_id is not null);
end;
$function$;

-- ── 4. Date du dernier comptage de chaque produit ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.product_last_counted(p_shop_id uuid)
RETURNS TABLE (product_id uuid, last_counted_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select c.product_id, max(coalesce(s.completed_at, c.counted_at))
    from inventory_counts c
    join inventory_sessions s on s.id = c.session_id
   where c.shop_id = p_shop_id and s.status = 'completed' and c.superseded_at is null and c.product_id is not null
   group by c.product_id
$$;

REVOKE ALL ON FUNCTION public.start_cycle_inventory_session(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_inventory_count(uuid, uuid, uuid, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_last_counted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_cycle_inventory_session(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_inventory_count(uuid, uuid, uuid, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_last_counted(uuid) TO service_role;

-- ── Contrôle : sinon la migration est annulée ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF position('product_out_of_scope' IN pg_get_functiondef('public.record_inventory_count(uuid,uuid,uuid,integer,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '194 : contrôle du périmètre absent';
  END IF;
  IF has_function_privilege('authenticated', 'public.start_cycle_inventory_session(uuid,uuid,uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.product_last_counted(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_inventory_count(uuid,uuid,uuid,integer,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '194 : fonction exécutable depuis le navigateur';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
