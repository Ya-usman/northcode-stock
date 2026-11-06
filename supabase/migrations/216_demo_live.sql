-- 216 — Compte de démonstration VIVANT (carte blanche de l'utilisateur, 6 nov. 2026).
-- Une entreprise marquée « démo » (entities.is_demo, réservée aux comptes internes) reçoit toutes les 15 minutes,
-- aux heures d'ouverture de ses boutiques (7 h → 20 h, fuseau de la boutique), des ventes générées par la VRAIE
-- fonction de vente (complete_sale) : stock, lots, paiements et rapports suivent exactement le chemin d'une vente
-- réelle. Chaque matin (créneau de 7 h), réassort des produits presque épuisés (stock + mouvement + lot, comme la
-- route de réassort de l'application) et reprise des charges récurrentes (loyer, salaires, factures, transport).
-- Rythme : moyenne des ventes de la boutique sur les 7 derniers jours, répartie selon l'heure et le jour de la
-- semaine (plafond 12 ventes par créneau). Produits choisis parmi le stock VENDABLE (sellable_stock, 178), pondérés
-- par les ventes des 14 derniers jours.
-- Portée : UNIQUEMENT les boutiques d'une entreprise is_demo ET is_internal (contrainte). Aucune autre donnée lue
-- ou écrite. Aucun accès des comptes connectés ou anonymes (fonction et journal réservés au serveur).
-- Idempotence : un créneau (boutique, début) n'est traité qu'une fois (journal demo_live_runs, purgé après 30 jours).
-- Arrêt : SELECT cron.unschedule('demo-live-sales'); ou entities.is_demo = false.
-- Retour arrière : supabase/rollbacks/216_demo_live_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- ── 1. Marquage « démo » (réservé aux comptes internes) ───────────────────────────────────────────────────────
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_demo_internal_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_demo_internal_check CHECK (NOT is_demo OR is_internal);
  END IF;
END $$;

-- ── 2. Journal des créneaux traités (réservé au serveur) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_live_runs (
  shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  slot_start timestamptz NOT NULL,
  sales      int NOT NULL DEFAULT 0,
  restocked  int NOT NULL DEFAULT 0,
  expenses   int NOT NULL DEFAULT 0,
  errors     int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, slot_start)
);
ALTER TABLE public.demo_live_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_live_runs FROM PUBLIC, anon, authenticated;

-- ── 3. Génération d'un créneau de 15 minutes ─────────────────────────────────────────────────────────────────
-- p_at : instant de référence (par défaut maintenant) ; le créneau traité est le quart d'heure ÉCOULÉ avant p_at.
CREATE OR REPLACE FUNCTION public.demo_live_tick(p_at timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Poids des heures (7 h → 19 h) et des jours (dimanche → samedi) : mêmes valeurs que l'historique de démonstration
  c_hours  CONSTANT numeric[] := ARRAY[2, 4, 5, 6, 7, 8, 6, 5, 5, 6, 8, 9, 4];
  c_hsum   CONSTANT numeric := 75;
  c_days   CONSTANT numeric[] := ARRAY[0.6, 0.95, 0.95, 1, 1.05, 1.15, 1.35];
  c_months CONSTANT text := 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
  v_end    timestamptz := date_bin('15 minutes', p_at, TIMESTAMPTZ '2000-01-01 00:00:00+00');
  v_start  timestamptz := v_end - interval '15 minutes';
  s        record;
  p        record;
  v_local  timestamp;
  v_hour   int;
  v_bdate  date;
  v_daily  numeric;
  v_n      int;
  v_count  int;
  v_offs   numeric[];
  v_w      jsonb;
  v_items  jsonb;
  v_sub    numeric;
  v_disc   numeric;
  v_total  numeric;
  v_method text;
  v_r      numeric;
  v_cashier  uuid;
  v_customer uuid;
  v_new    int;
  v_add    int;
  v_need   int;
  v_life   int;
  v_supp   text;
  v_sales  int;
  v_rest   int;
  v_exp    int;
  v_err    int;
  v_lasterr text;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  DELETE FROM demo_live_runs WHERE slot_start < now() - interval '30 days';

  FOR s IN
    SELECT sh.id, sh.owner_id, sh.timezone AS tz
      FROM shops sh JOIN entities e ON e.id = sh.entity_id
     WHERE e.is_demo AND e.is_internal AND sh.deleted_at IS NULL AND sh.timezone IS NOT NULL
     ORDER BY sh.id
  LOOP
    v_local := v_start AT TIME ZONE s.tz;
    v_hour  := extract(hour FROM v_local)::int;
    CONTINUE WHEN v_hour < 7 OR v_hour > 19;

    -- Créneau déjà traité : rien (relance, rattrapage)
    INSERT INTO demo_live_runs (shop_id, slot_start) VALUES (s.id, v_start) ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;

    v_bdate := v_local::date;
    v_sales := 0; v_rest := 0; v_exp := 0; v_err := 0; v_lasterr := NULL;

    -- Ventes des 14 derniers jours par produit (pondération du choix et du réassort)
    SELECT coalesce(jsonb_object_agg(x.product_id, x.sold), '{}'::jsonb) INTO v_w
      FROM (SELECT si.product_id, sum(si.quantity) AS sold
              FROM sales sa JOIN sale_items si ON si.sale_id = sa.id
             WHERE sa.shop_id = s.id AND sa.sale_status = 'active' AND si.product_id IS NOT NULL
               AND sa.created_at >= v_start - interval '14 days' AND sa.created_at < v_start
             GROUP BY si.product_id) x;

    -- ── Matin (créneau de 7 h) : réassort et charges récurrentes ──
    IF v_hour = 7 AND extract(minute FROM v_local) < 15 THEN
      FOR p IN
        SELECT pr.id, pr.quantity, pr.buying_price, pr.supplier_id, st.sellable,
               coalesce((v_w ->> pr.id::text)::numeric, 0) AS sold14
          FROM products pr CROSS JOIN LATERAL sellable_stock(pr.id, v_bdate) st
         WHERE pr.shop_id = s.id AND pr.is_active
           AND NOT coalesce(pr.track_serials, false) AND NOT coalesce(pr.is_kit, false)
      LOOP
        -- Réassort quand il reste moins de 3 jours de ventes : de quoi tenir ~10 jours, par multiples de 6
        CONTINUE WHEN p.sellable >= greatest(ceil(p.sold14 / 14.0 * 3), 4);
        v_need := greatest(ceil(p.sold14 / 14.0 * 10), 12)::int;
        v_add  := (ceil(greatest(v_need - p.sellable, 6) / 6.0) * 6)::int;
        -- Durée de vie : celle du dernier lot daté du produit (aucune date si le produit n'en a jamais eu)
        SELECT (b.expiry_date - b.received_at::date) INTO v_life
          FROM product_batches b
         WHERE b.product_id = p.id AND b.expiry_date IS NOT NULL AND b.received_at IS NOT NULL
         ORDER BY b.created_at DESC LIMIT 1;
        SELECT name INTO v_supp FROM suppliers WHERE id = p.supplier_id;
        UPDATE products SET quantity = quantity + v_add WHERE id = p.id RETURNING quantity INTO v_new;
        INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by, previous_qty, new_qty, created_at)
        VALUES (s.id, p.id, 'in', v_add, CASE WHEN v_supp IS NOT NULL THEN 'Restock from ' || v_supp ELSE 'Restock' END,
                s.owner_id, v_new - v_add, v_new, v_start + interval '2 minutes');
        INSERT INTO product_batches (shop_id, product_id, supplier_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at)
        VALUES (s.id, p.id, p.supplier_id, v_add, v_add, coalesce(p.buying_price, 0),
                CASE WHEN v_life > 0 THEN v_bdate + v_life END, 'restock', v_start + interval '2 minutes');
        v_rest := v_rest + 1;
        v_life := NULL; v_supp := NULL;
      END LOOP;

      -- Charges : loyer, salaires et factures un mois après les précédentes, transport et fournitures chaque semaine
      INSERT INTO expenses (shop_id, amount, description, date, created_by, category, payment_method, client_request_id)
      SELECT e.shop_id, e.amount,
             regexp_replace(e.description, '(, | d''| de )(' || c_months || ')$', ''),
             v_bdate, s.owner_id, e.category, e.payment_method, 'demo-live-exp-' || e.id
        FROM expenses e
       WHERE e.shop_id = s.id
         AND ((e.category IN ('rent', 'salaries', 'electricity', 'water', 'internet') AND e.date = (v_bdate - interval '1 month')::date)
           OR (e.category IN ('transport', 'supplies') AND e.date = v_bdate - 7))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_exp = ROW_COUNT;
    END IF;

    -- ── Ventes du créneau ──
    SELECT count(*) / 7.0 INTO v_daily FROM sales
     WHERE shop_id = s.id AND sale_status = 'active' AND created_at >= v_start - interval '7 days' AND created_at < v_start;
    v_daily := least(greatest(v_daily, 4), 80);
    v_n := least(floor(v_daily * c_days[extract(dow FROM v_local)::int + 1] * c_hours[v_hour - 6] / c_hsum / 4 + random())::int, 12);

    IF v_n > 0 THEN
      SELECT array_agg(o ORDER BY o) INTO v_offs FROM (SELECT random() AS o FROM generate_series(1, v_n)) g;
      FOR k IN 1..v_n LOOP
        BEGIN
          v_r := random();
          v_count := CASE WHEN v_r < 0.30 THEN 1 WHEN v_r < 0.60 THEN 2 WHEN v_r < 0.82 THEN 3 WHEN v_r < 0.94 THEN 4 ELSE 5 END;
          SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', x.id, 'product_name', x.name, 'quantity', x.q,
                                                       'unit_price', x.selling_price, 'buying_price', coalesce(x.buying_price, 0))), '[]'::jsonb),
                 coalesce(sum(x.q * x.selling_price), 0)
            INTO v_items, v_sub
            FROM (SELECT pr.id, pr.name, pr.selling_price, pr.buying_price,
                         least(st.sellable, CASE WHEN random() < 0.75 THEN 1 WHEN random() < 0.8 THEN 2 ELSE 3 END) AS q
                    FROM products pr CROSS JOIN LATERAL sellable_stock(pr.id, v_bdate) st
                   WHERE pr.shop_id = s.id AND pr.is_active AND pr.selling_price > 0 AND st.sellable >= 1
                     AND NOT coalesce(pr.track_serials, false) AND NOT coalesce(pr.is_kit, false)
                   ORDER BY -ln(1 - random()) / (1 + coalesce((v_w ->> pr.id::text)::numeric, 0))
                   LIMIT v_count) x;
          CONTINUE WHEN jsonb_array_length(v_items) = 0;

          v_disc  := CASE WHEN v_sub >= 3000 AND random() < 0.04 THEN greatest(100, round(v_sub * 0.05 / 100) * 100) ELSE 0 END;
          v_total := v_sub - v_disc;
          v_r := random();
          v_method := CASE WHEN v_r < 0.56 THEN 'cash' WHEN v_r < 0.78 THEN 'orange_money' WHEN v_r < 0.95 THEN 'mtn_momo'
                           WHEN v_total >= 10000 THEN 'transfer' ELSE 'cash' END;
          SELECT user_id INTO v_cashier FROM shop_members
           WHERE shop_id = s.id AND is_active AND NOT coalesce(suspended_by_plan, false)
             AND role IN ('owner', 'shop_manager', 'manager', 'cashier')
           ORDER BY random() LIMIT 1;
          v_customer := NULL;
          IF random() < 0.2 THEN
            SELECT id INTO v_customer FROM customers
             WHERE shop_id = s.id AND deleted_at IS NULL AND merged_into IS NULL ORDER BY random() LIMIT 1;
          END IF;

          PERFORM complete_sale(
            p_shop_id => s.id, p_cashier_id => coalesce(v_cashier, s.owner_id), p_customer_id => v_customer,
            p_customer_name => NULL, p_customer_phone => NULL,
            p_subtotal => v_sub, p_discount => v_disc, p_tax => 0, p_total => v_total,
            p_payment_method => v_method, p_notes => NULL, p_paystack_reference => NULL,
            p_client_request_id => 'demo-live-' || s.id || '-' || to_char(v_start AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI') || '-' || k,
            p_items => v_items,
            p_payments => jsonb_build_array(jsonb_build_object('amount', v_total, 'method', v_method)),
            p_due_date => NULL,
            p_created_at => v_start + v_offs[k] * interval '15 minutes');
          v_sales := v_sales + 1;
        EXCEPTION WHEN OTHERS THEN
          v_err := v_err + 1; v_lasterr := left(SQLERRM, 300);
        END;
      END LOOP;
    END IF;

    UPDATE demo_live_runs SET sales = v_sales, restocked = v_rest, expenses = v_exp, errors = v_err, last_error = v_lasterr
     WHERE shop_id = s.id AND slot_start = v_start;
    v_out := v_out || jsonb_build_object('shop_id', s.id, 'sales', v_sales, 'restocked', v_rest, 'expenses', v_exp, 'errors', v_err);
  END LOOP;

  RETURN jsonb_build_object('slot_start', v_start, 'shops', v_out);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.demo_live_tick(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 4. Tâche planifiée : toutes les 15 minutes ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-live-sales';
  PERFORM cron.schedule('demo-live-sales', '*/15 * * * *', 'SELECT public.demo_live_tick()');
END $$;

-- ── 5. Contrôles ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'demo-live-sales' AND schedule = '*/15 * * * *') THEN
    RAISE EXCEPTION '216 : tâche planifiée absente';
  END IF;
  IF has_function_privilege('anon', 'public.demo_live_tick(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.demo_live_tick(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '216 : fonction accessible aux comptes connectés ou anonymes';
  END IF;
  IF EXISTS (SELECT 1 FROM entities WHERE is_demo) THEN
    RAISE EXCEPTION '216 : aucune entreprise ne doit être « démo » à l''installation';
  END IF;
END $$;
