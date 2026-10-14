-- ============================================================
-- 175 — Inventaire physique : vraie session, comptage à l'aveugle
-- Version finale VALIDÉE par l'utilisateur le 15 oct. 2026, appliquée le 15 oct. 2026 (avant l'écran, sur son
-- choix, pour des tests réels). 174 reste réservé à l'étape C2 (prix d'achat).
--
-- Règles validées par l'utilisateur (14 oct. 2026) :
--   • UNE session en cours par boutique ; elle se reprend après fermeture de
--     l'application, par tout employé qui a l'interrupteur « Inventaire ».
--   • Démarrer, compter, motiver : AUCUN changement de stock.
--   • Au comptage d'un produit, le serveur note le stock enregistré À CET
--     INSTANT (théorique de référence) ; écart = compté − théorique.
--   • À la finalisation, on applique l'ÉCART au stock du moment :
--       stock final = stock actuel + écart
--     (une vente faite après le comptage n'est jamais effacée).
--   • Un recomptage remplace le précédent, qui reste dans l'historique ;
--     deux appareils ne s'écrasent pas sans le savoir (contrôle de version).
--
-- Décisions du 15 oct. 2026 :
--   • Si « stock actuel + écart » deviendrait NÉGATIF (trop de ventes depuis le
--     comptage), rien n'est écrêté ni appliqué : la finalisation s'arrête, la
--     ligne est marquée « à recompter », le reste de la session est conservé.
--   • Écart POSITIF : les unités retrouvées entrent dans un lot d'origine
--     « Inventaire » (date de péremption facultative saisie à la vérification,
--     jamais inventée ; coût = prix d'achat du produit s'il est connu ; lien vers
--     la session).
--   • Écart NÉGATIF : la fonction d'épuisement des lots existante (FEFO) retire
--     les unités — répartition automatique, inférée, pas une certitude physique.
--   • Motifs : Correction, Dommage, Perte, Vol, Expiration, Autre. Une erreur de
--     comptage se corrige en recomptant, ce n'est pas un motif.
--
-- Ce qui ne change pas : apply_inventory_count (ancien écran) reste en place
-- pour les versions de l'application encore en cache ; il sera retiré quand
-- le nouvel écran sera en ligne. Les mouvements de stock gardent leur format
-- (« Inventaire physique — <motif> », count_session_id) : Mouvements, journal
-- et « dernier comptage » continuent de les lire sans modification.
--
-- Ajouts de la version finale (15 oct. 2026), après vérification contre la base réelle :
--   • journal d'activité écrit DANS la transaction (démarrage, abandon, finalisation) : pas de
--     finalisation sans trace, pas de trace sans finalisation ;
--   • finaliser une session sans aucun comptage est refusé (nothing_counted).
--
-- Retour arrière : rollback_175_inventory_sessions.sql (même dossier).
-- ============================================================

begin;

-- ── 1. Sessions ─────────────────────────────────────────────────────────────
create table public.inventory_sessions (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id) on delete cascade,
  reference          text not null,                       -- INV-2026-0001, par boutique et par année
  status             text not null default 'in_progress'
                     check (status in ('in_progress', 'completed', 'cancelled')),
  started_by         uuid references auth.users(id) on delete set null,
  started_at         timestamptz not null default now(),
  completed_by       uuid references auth.users(id) on delete set null,
  completed_at       timestamptz,
  cancelled_by       uuid references auth.users(id) on delete set null,
  cancelled_at       timestamptz,
  products_total     int not null default 0,              -- produits actifs au démarrage (« 12 / 38 »)
  counted_total      int,                                 -- figé à la finalisation
  discrepancy_total  int,                                 -- figé à la finalisation
  legacy             boolean not null default false,      -- inventaire d'avant cette migration (seuls ses écarts sont connus)
  updated_at         timestamptz not null default now(),
  constraint inventory_sessions_completed_has_date check (status <> 'completed' or completed_at is not null),
  constraint inventory_sessions_cancelled_has_date check (status <> 'cancelled' or cancelled_at is not null)
);

-- Une seule session en cours par boutique (garantie par la base, pas seulement par l'écran)
create unique index inventory_sessions_one_in_progress on public.inventory_sessions (shop_id) where status = 'in_progress';
create unique index inventory_sessions_reference on public.inventory_sessions (shop_id, reference);
create index inventory_sessions_shop_started on public.inventory_sessions (shop_id, started_at desc);

-- ── 2. Comptages ────────────────────────────────────────────────────────────
-- Une ligne par comptage. La ligne « courante » d'un produit est celle qui
-- n'est pas remplacée (superseded_at nul) ; un recomptage remplace la ligne
-- courante et la garde comme historique (qui, quand, combien).
create table public.inventory_counts (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.inventory_sessions(id) on delete cascade,
  shop_id          uuid not null references public.shops(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  product_name     text not null,                         -- figé : lisible même si le produit est renommé ou supprimé
  unit             text,
  theoretical_qty  int not null,                          -- stock enregistré AU MOMENT du comptage (lu par le serveur)
  counted_qty      int not null check (counted_qty >= 0),
  delta            int generated always as (counted_qty - theoretical_qty) stored,
  reason_code      text check (reason_code in ('correction', 'damage', 'loss', 'theft', 'expiry', 'other')),
  surplus_expiry_date  date,                      -- écart positif : péremption des unités retrouvées (facultative)
  recount_requested_at timestamptz,               -- conflit à la finalisation : produit à recompter
  counted_by       uuid references auth.users(id) on delete set null,
  counted_at       timestamptz not null default now(),
  superseded_at    timestamptz,
  superseded_by    uuid references auth.users(id) on delete set null,
  -- Rempli à la finalisation : ce qui a réellement été appliqué
  applied_before   int,
  applied_after    int,
  applied_delta    int,
  movement_id      uuid references public.stock_movements(id) on delete set null
);

create unique index inventory_counts_current on public.inventory_counts (session_id, product_id) where superseded_at is null;
create index inventory_counts_session on public.inventory_counts (session_id);
create index inventory_counts_product on public.inventory_counts (product_id);
create index inventory_counts_movement on public.inventory_counts (movement_id) where movement_id is not null;

-- ── 2 bis. Lots : origine « Inventaire » et lien vers la session ──────────────
-- (la contrainte des origines reprend TOUTES les valeurs existantes, plus 'inventory')
alter table public.product_batches drop constraint if exists product_batches_source_check;
alter table public.product_batches add constraint product_batches_source_check
  check (source in ('backfill', 'restock', 'purchase_order', 'adjustment', 'transfer', 'inventory'));
alter table public.product_batches
  add column origin_inventory_session_id uuid references public.inventory_sessions(id) on delete set null;
create index product_batches_origin_inventory on public.product_batches (origin_inventory_session_id)
  where origin_inventory_session_id is not null;

-- ── 3. Réservé au serveur ───────────────────────────────────────────────────
-- Aucune règle d'accès pour le navigateur : tout passe par les routes, qui
-- appliquent l'interrupteur « Inventaire » (même modèle que les achats, C1).
alter table public.inventory_sessions enable row level security;
alter table public.inventory_counts   enable row level security;
revoke all on table public.inventory_sessions from anon, authenticated;
revoke all on table public.inventory_counts   from anon, authenticated;

-- ── 4. Inventaires existants ────────────────────────────────────────────────
-- Les 6 validations déjà faites deviennent des sessions terminées, avec le
-- MÊME identifiant que leur count_session_id : leurs mouvements y restent
-- rattachés. Seuls leurs écarts sont connus (les produits conformes ne
-- laissaient aucune trace) : legacy = true, l'écran l'indique.
insert into public.inventory_sessions (
  id, shop_id, reference, status, started_by, started_at, completed_by, completed_at,
  products_total, counted_total, discrepancy_total, legacy
)
select
  g.session_id, g.shop_id,
  'INV-' || to_char(g.at, 'YYYY') || '-' || lpad(row_number() over (partition by g.shop_id, to_char(g.at, 'YYYY') order by g.at)::text, 4, '0'),
  'completed', g.by, g.at, g.by, g.at, 0, g.n, g.n, true
from (
  select count_session_id as session_id, (array_agg(shop_id))[1] as shop_id, min(created_at) as at,
         (array_agg(performed_by order by created_at))[1] as by, count(*)::int as n
  from public.stock_movements
  where count_session_id is not null
  group by count_session_id
) g;

insert into public.inventory_counts (
  session_id, shop_id, product_id, product_name, unit, theoretical_qty, counted_qty, reason_code,
  counted_by, counted_at, applied_before, applied_after, applied_delta, movement_id
)
select
  m.count_session_id, m.shop_id, m.product_id, coalesce(p.name, '—'), p.unit, m.previous_qty, m.new_qty,
  case split_part(m.reason, ' — ', 2)
    when 'Dommage' then 'damage' when 'Perte' then 'loss' when 'Vol' then 'theft'
    when 'Expiration' then 'expiry' when 'Autre' then 'other' else 'correction'
  end,
  m.performed_by, m.created_at, m.previous_qty, m.new_qty, m.new_qty - m.previous_qty, m.id
from public.stock_movements m
left join public.products p on p.id = m.product_id
where m.count_session_id is not null and m.previous_qty is not null and m.new_qty is not null;

-- ── 5. Fonctions (exécutées par le serveur seulement) ───────────────────────

-- Journal d'activité, dans la MÊME transaction que l'action : entreprise de la boutique, e-mail de l'auteur
create or replace function public._inventory_audit(p_shop_id uuid, p_user uuid, p_action text, p_session_id uuid, p_meta jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (shop_id, entity_id, actor_id, actor_email, action, target_id, target_type, metadata)
  values (p_shop_id, (select entity_id from shops where id = p_shop_id), p_user,
          (select email from auth.users where id = p_user), p_action, p_session_id::text, 'inventory_session',
          coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- Démarrer — ou reprendre la session en cours (démarrer deux fois = reprendre)
create or replace function public.start_inventory_session(p_shop_id uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_ref   text;
  v_year  text := to_char(now(), 'YYYY');
  v_seq   int;
  v_total int;
begin
  -- Deux démarrages simultanés pour la même boutique : l'un attend l'autre
  perform pg_advisory_xact_lock(hashtextextended('inventory:' || p_shop_id::text, 0));

  select id, reference into v_id, v_ref from inventory_sessions where shop_id = p_shop_id and status = 'in_progress';
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', true);
  end if;

  select coalesce(max(nullif(split_part(reference, '-', 3), '')::int), 0) + 1 into v_seq
    from inventory_sessions where shop_id = p_shop_id and reference like 'INV-' || v_year || '-%';
  v_ref := 'INV-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  select count(*)::int into v_total from products where shop_id = p_shop_id and is_active;

  insert into inventory_sessions (shop_id, reference, status, started_by, products_total)
    values (p_shop_id, v_ref, 'in_progress', p_user, v_total)
    returning id into v_id;
  perform _inventory_audit(p_shop_id, p_user, 'inventory.start', v_id, jsonb_build_object('reference', v_ref, 'products_total', v_total));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', false);
end;
$$;

-- Enregistrer le comptage d'un produit.
-- p_expected_count_id : la ligne courante que l'appareil avait chargée (nulle s'il n'y en avait pas).
-- Si la ligne a changé entre-temps (un autre employé a compté), rien n'est écrit : la réponse
-- « conflict » donne le comptage actuel ; l'écran demande de confirmer, puis renvoie avec ce nouvel identifiant.
create or replace function public.record_inventory_count(
  p_session_id uuid, p_shop_id uuid, p_product_id uuid, p_counted_qty int, p_user uuid, p_expected_count_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
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
begin
  if p_counted_qty is null or p_counted_qty < 0 then raise exception 'invalid_quantity'; end if;

  -- Session verrouillée en partage : une finalisation en cours la verrouille en exclusif
  select status, shop_id into v_status, v_shop from inventory_sessions where id = p_session_id for share;
  if not found or v_shop <> p_shop_id then raise exception 'session_not_found'; end if;
  if v_status <> 'in_progress' then raise exception 'session_closed'; end if;

  -- Un seul comptage à la fois pour un même produit de la session
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_product_id::text, 0));

  select id, counted_qty, counted_by, counted_at into v_cur_id, v_cur_qty, v_cur_by, v_cur_at
    from inventory_counts where session_id = p_session_id and product_id = p_product_id and superseded_at is null;

  if v_cur_id is distinct from p_expected_count_id then
    return jsonb_build_object('conflict', true, 'current', case when v_cur_id is null then null else
      jsonb_build_object('id', v_cur_id, 'counted_qty', v_cur_qty, 'counted_by', v_cur_by, 'counted_at', v_cur_at) end);
  end if;

  -- Théorique de référence : le stock enregistré à cet instant
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
$$;

-- Vérification d'un écart : motif, et pour un écart positif la péremption des unités retrouvées (facultative)
create or replace function public.set_inventory_count_details(p_count_id uuid, p_shop_id uuid, p_reason text, p_surplus_expiry_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is not null and p_reason not in ('correction', 'damage', 'loss', 'theft', 'expiry', 'other') then raise exception 'invalid_reason'; end if;
  update inventory_counts c
     set reason_code = coalesce(p_reason, c.reason_code),
         surplus_expiry_date = case when c.delta > 0 then p_surplus_expiry_date else null end
    from inventory_sessions s
   where c.id = p_count_id and c.shop_id = p_shop_id and c.superseded_at is null
     and s.id = c.session_id and s.status = 'in_progress';
  if not found then raise exception 'count_not_found'; end if;
end;
$$;

-- Abandonner : aucun stock modifié, les comptages restent dans l'historique de la session
create or replace function public.cancel_inventory_session(p_session_id uuid, p_shop_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update inventory_sessions set status = 'cancelled', cancelled_by = p_user, cancelled_at = now(), updated_at = now()
    where id = p_session_id and shop_id = p_shop_id and status = 'in_progress';
  if not found then raise exception 'session_not_found'; end if;
  perform _inventory_audit(p_shop_id, p_user, 'inventory.cancel', p_session_id,
    jsonb_build_object('reference', (select reference from inventory_sessions where id = p_session_id),
                       'counted', (select count(*) from inventory_counts where session_id = p_session_id and superseded_at is null)));
end;
$$;

-- Finaliser : une seule transaction ; idempotente (une session terminée n'est jamais réappliquée)
create or replace function public.finalize_inventory_session(p_session_id uuid, p_shop_id uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_shop      uuid;
  v_c         record;
  v_before    int;
  v_after     int;
  v_applied   int;
  v_buy       numeric;
  v_label     text;
  v_movement  uuid;
  v_counted   int := 0;
  v_disc      int := 0;
  v_adjusted  int := 0;
  v_conflicts jsonb;
begin
  select status, shop_id into v_status, v_shop from inventory_sessions where id = p_session_id for update;
  if not found or v_shop <> p_shop_id then raise exception 'session_not_found'; end if;
  if v_status = 'completed' then
    return (select jsonb_build_object('id', id, 'status', 'completed', 'already_completed', true, 'counted', counted_total, 'discrepancies', discrepancy_total)
              from inventory_sessions where id = p_session_id);
  end if;
  if v_status <> 'in_progress' then raise exception 'session_closed'; end if;

  -- Au moins un produit compté
  if not exists (select 1 from inventory_counts where session_id = p_session_id and superseded_at is null) then
    raise exception 'nothing_counted';
  end if;

  -- Tout écart doit avoir son motif
  if exists (select 1 from inventory_counts
              where session_id = p_session_id and superseded_at is null and delta <> 0 and reason_code is null) then
    raise exception 'reason_required';
  end if;

  -- Produits verrouillés dans un ordre fixe (identifiant) : pas d'interblocage avec une vente en cours
  perform 1 from products
    where id in (select product_id from inventory_counts
                  where session_id = p_session_id and superseded_at is null and delta <> 0 and product_id is not null)
    order by id for update;

  -- Conflit : trop d'activité depuis le comptage (stock actuel + écart < 0). Rien n'est appliqué ni écrêté :
  -- les lignes concernées sont marquées « à recompter » et la session reste en cours.
  select coalesce(jsonb_agg(jsonb_build_object('count_id', c.id, 'product_id', c.product_id, 'product_name', c.product_name,
                                               'theoretical_qty', c.theoretical_qty, 'counted_qty', c.counted_qty, 'current_qty', p.quantity)), '[]'::jsonb)
    into v_conflicts
    from inventory_counts c join products p on p.id = c.product_id
   where c.session_id = p_session_id and c.superseded_at is null and c.delta <> 0 and p.quantity + c.delta < 0;
  if jsonb_array_length(v_conflicts) > 0 then
    update inventory_counts set recount_requested_at = now()
     where id in (select (x->>'count_id')::uuid from jsonb_array_elements(v_conflicts) x);
    return jsonb_build_object('id', p_session_id, 'status', 'recount_required', 'conflicts', v_conflicts);
  end if;

  for v_c in
    select * from inventory_counts where session_id = p_session_id and superseded_at is null order by product_id
  loop
    v_counted := v_counted + 1;
    continue when v_c.delta = 0;
    v_disc := v_disc + 1;
    continue when v_c.product_id is null;                -- produit supprimé depuis le comptage

    select quantity, buying_price into v_before, v_buy from products where id = v_c.product_id and shop_id = p_shop_id;
    continue when not found;

    -- Écart appliqué au stock DU MOMENT, jamais d'écrasement (le cas négatif a été arrêté plus haut)
    v_after := v_before + v_c.delta;
    v_applied := v_c.delta;
    v_movement := null;

    if v_applied <> 0 then
      update products set quantity = v_after, updated_at = now() where id = v_c.product_id;
      -- Lots : surplus = lot d'origine « Inventaire » (date facultative, coût du produit s'il est connu) ;
      -- manque = fonction d'épuisement existante (FEFO) — répartition inférée, pas une certitude physique
      if v_applied > 0 then
        insert into product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                     origin_inventory_session_id)
          values (p_shop_id, v_c.product_id, v_applied, v_applied, case when v_buy > 0 then v_buy else null end,
                  v_c.surplus_expiry_date, 'inventory', now(), p_session_id);
      else
        perform deplete_product_batches(v_c.product_id, -v_applied);
      end if;

      v_label := case v_c.reason_code
        when 'damage' then 'Dommage' when 'loss' then 'Perte' when 'theft' then 'Vol'
        when 'expiry' then 'Expiration' when 'other' then 'Autre' else 'Correction de stock' end;
      insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, count_session_id)
        values (p_shop_id, v_c.product_id, 'adjustment', v_applied, v_before, v_after,
                'Inventaire physique — ' || v_label, p_user, p_session_id)
        returning id into v_movement;
      v_adjusted := v_adjusted + 1;
    end if;

    update inventory_counts set applied_before = v_before, applied_after = v_after, applied_delta = v_applied, movement_id = v_movement
      where id = v_c.id;
  end loop;

  update inventory_sessions
     set status = 'completed', completed_by = p_user, completed_at = now(),
         counted_total = v_counted, discrepancy_total = v_disc, updated_at = now()
   where id = p_session_id;
  perform _inventory_audit(p_shop_id, p_user, 'inventory.finalize', p_session_id,
    jsonb_build_object('reference', (select reference from inventory_sessions where id = p_session_id),
                       'counted', v_counted, 'discrepancies', v_disc, 'adjusted', v_adjusted));

  return jsonb_build_object('id', p_session_id, 'status', 'completed', 'already_completed', false, 'counted', v_counted,
                            'discrepancies', v_disc, 'adjusted', v_adjusted);
end;
$$;

-- Fonctions : appelables par le serveur seulement (sur Supabase, retirer PUBLIC ne suffit pas — migration 154)
revoke all on function public._inventory_audit(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.start_inventory_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_inventory_count(uuid, uuid, uuid, int, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_inventory_count_details(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.cancel_inventory_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_inventory_session(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._inventory_audit(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.start_inventory_session(uuid, uuid) to service_role;
grant execute on function public.record_inventory_count(uuid, uuid, uuid, int, uuid, uuid) to service_role;
grant execute on function public.set_inventory_count_details(uuid, uuid, text, date) to service_role;
grant execute on function public.cancel_inventory_session(uuid, uuid, uuid) to service_role;
grant execute on function public.finalize_inventory_session(uuid, uuid, uuid) to service_role;

commit;
