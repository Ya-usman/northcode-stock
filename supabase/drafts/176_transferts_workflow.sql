-- ============================================================
-- PROPOSITION v2 FINALE — Transferts entre boutiques, traçabilité LOT PAR LOT
-- (numéro attribué à l'application ; NON appliquée — à valider)
--
-- Cible validée par l'utilisateur (14 oct. 2026)
--   Statuts : brouillon → en transit → reçu ; annulé ; réception partielle.
--   « Reçu avec écart » = reçu + has_discrepancy (pas de statut de plus).
--   Envoyer = droit Transferts en modification sur la SOURCE ; réceptionner =
--   même droit sur la DESTINATION (contrôlés par les routes) ; la base vérifie
--   que les deux boutiques sont de la même entreprise.
--
--   ENVOI (une seule transaction, jamais deux fois) : stock du produit ET lots
--   source diminuent ; la règle FEFO existante choisit les lots ; chaque
--   ALLOCATION (lot source, péremption, coût, quantité) est enregistrée et
--   devient la source de vérité du stock en transit.
--   RÉCEPTION : par défaut, les unités reçues vont aux allocations qui
--   périment le plus tôt (règle déterministe) ; un lot destination par lot
--   source reçu : même péremption, coût du lot source, lien vers le transfert
--   et vers le lot source, quantité réellement reçue. La répartition est
--   enregistrée allocation par allocation (« auto ») : une correction manuelle
--   pourra s'y ajouter plus tard sans changer le modèle.
--   POUR CHAQUE ALLOCATION : envoyé = reçu + rendu à la source + perdu + en
--   transit (« en transit » est calculé, jamais saisi ; contrainte en base).
--   ANNULATION : seulement si rien n'a été reçu ni réglé ; les quantités
--   reviennent dans les lots source exacts. Après une réception partielle :
--   pas d'annulation globale, seul le reliquat se règle.
--   PERTE / CASSE / VOL : sort du reliquat, n'entre nulle part, ne revient
--   pas ; mouvement explicite (type « transit_loss ») et audit, avec le
--   transfert et le lot d'origine. JAMAIS PARTI : rendu aux lots source exacts.
--   SURPLUS : signalé et gardé, aucun stock modifié (règle à valider à part).
--
-- LOTS PÉRIMÉS (décision du 15 oct.) : jamais transférés par le parcours normal.
--   Quantité transférable = stock du produit − unités des lots déjà périmés ;
--   au-delà, l'envoi est refusé avec la quantité réellement transférable. La
--   règle FEFO existante choisit ensuite parmi les lots NON périmés. (Un
--   déplacement de périmés — destruction, retour fournisseur — sera un parcours
--   séparé.)
--
-- Quantité SANS LOT (stock du produit non couvert par ses lots — données
-- d'avant cette migration, ou produits créés / importés sans lot) — décision du 15 oct. :
--   • à la SOURCE, la part couverte par des lots part en allocations « lot » ;
--     le reste part en UNE allocation « sans lot connu » : aucun faux lot n'est
--     créé à la source, rien n'est perdu (le stock du produit baisse de la
--     quantité réelle) ;
--   • à la DESTINATION, cette part entre dans un LOT TECHNIQUE « origine non
--     tracée » : sans date de péremption (inconnue, jamais inventée), origine
--     transfert, lien vers le transfert, coût seulement si une valeur fiable est
--     connue dans le transfert. La destination garde ainsi stock = lots ; le lot
--     pourra être complété plus tard (une date, si elle devient connue) ;
--   • rendue à la source (annulation, jamais parti), elle revient au stock du
--     produit sans lot, comme elle était partie.
--
-- Historique : rien n'est corrigé ici. Les 6 transferts existants reçoivent
-- des allocations « ancien modèle » (sans lot, quantités déjà connues) pour
-- rester lisibles et pour que les 2 transferts encore en route puissent être
-- reçus ; leurs lots source n'ont jamais été décomptés : c'est l'objet du
-- rapport séparé et d'une éventuelle réparation dédiée.
--
-- Corrections du 15 oct. 2026 (après vérification contre la base réelle) :
--   • statut : « annulé » seulement si tout est revenu à la source (avant : une perte totale donnait « annulé ») ;
--   • coût d'un lot créé à la réception ou recréé lors d'un retour : inconnu = NULL, jamais 0.
--
-- Retour arrière : rollback_transferts_workflow.sql (même dossier).
-- ============================================================

begin;

-- ── 1. Transferts : statuts et envoi ───────────────────────────────────────
alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check
  check (status in ('draft', 'sent', 'partially_received', 'received', 'cancelled'));

alter table public.stock_transfers
  add column sent_at          timestamptz,
  add column sent_by          uuid references auth.users(id) on delete set null,
  add column has_discrepancy  boolean not null default false,
  add column updated_at       timestamptz not null default now();

-- Les 6 transferts existants ont tous été envoyés au moment de leur création
update public.stock_transfers set sent_at = created_at, sent_by = created_by;

create unique index stock_transfers_source_reference on public.stock_transfers (source_shop_id, reference);
create index stock_transfers_open_destination on public.stock_transfers (destination_shop_id) where status in ('sent', 'partially_received');

-- ── 2. Lignes : surplus signalé ─────────────────────────────────────────────
-- quantity_received reste la somme reçue de la ligne (tenue à jour par les fonctions, lue par l'ancien écran)
alter table public.stock_transfer_items
  add column quantity_surplus  int not null default 0 check (quantity_surplus >= 0),
  add column surplus_status    text check (surplus_status in ('pending', 'resolved'));

-- ── 3. Allocations : quels lots sont partis, et ce qu'ils sont devenus ──────
create table public.stock_transfer_allocations (
  id                   uuid primary key default gen_random_uuid(),
  transfer_id          uuid not null references public.stock_transfers(id) on delete cascade,
  item_id              uuid not null references public.stock_transfer_items(id) on delete cascade,
  coverage             text not null check (coverage in ('batch', 'uncovered', 'legacy')),
                       -- batch : unités sorties d'un lot précis ; uncovered : stock sans lot ;
                       -- legacy : transfert d'avant cette migration (lots non décomptés à l'époque)
  source_batch_id      uuid references public.product_batches(id) on delete set null,
  source_expiry_date   date,                 -- figés : restent lisibles même si le lot source disparaît
  source_received_at   timestamptz,
  unit_cost            numeric,              -- coût du lot source (réservé au serveur, comme tout prix d'achat)
  quantity_sent        int not null check (quantity_sent > 0),
  quantity_received    int not null default 0 check (quantity_received >= 0),
  quantity_returned    int not null default 0 check (quantity_returned >= 0),
  quantity_lost        int not null default 0 check (quantity_lost >= 0),
  quantity_in_transit  int generated always as (quantity_sent - quantity_received - quantity_returned - quantity_lost) stored,
  created_at           timestamptz not null default now(),
  constraint stock_transfer_allocations_balance check (quantity_received + quantity_returned + quantity_lost <= quantity_sent),
  constraint stock_transfer_allocations_batch_has_lot check (coverage <> 'batch' or source_received_at is not null)
);
create index stock_transfer_allocations_transfer on public.stock_transfer_allocations (transfer_id);
create index stock_transfer_allocations_item on public.stock_transfer_allocations (item_id);
create index stock_transfer_allocations_source_batch on public.stock_transfer_allocations (source_batch_id) where source_batch_id is not null;
create index stock_transfer_allocations_in_transit on public.stock_transfer_allocations (transfer_id) where quantity_in_transit > 0;

-- ── 4. Réceptions (une par passage) et leur répartition par allocation ──────
create table public.stock_transfer_receipts (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references public.stock_transfers(id) on delete cascade,
  receipt_key  uuid not null unique,          -- idempotence : une réception renvoyée n'est appliquée qu'une fois
  received_by  uuid references auth.users(id) on delete set null,
  received_at  timestamptz not null default now(),
  note         text
);
create index stock_transfer_receipts_transfer on public.stock_transfer_receipts (transfer_id, received_at);

create table public.stock_transfer_receipt_lines (
  id                      uuid primary key default gen_random_uuid(),
  receipt_id              uuid not null references public.stock_transfer_receipts(id) on delete cascade,
  item_id                 uuid not null references public.stock_transfer_items(id) on delete cascade,
  allocation_id           uuid references public.stock_transfer_allocations(id) on delete cascade,
  kind                    text not null check (kind in ('received', 'surplus')),
  quantity                int not null check (quantity > 0),
  assignment              text not null default 'auto' check (assignment in ('auto', 'manual')),
  destination_product_id  uuid references public.products(id) on delete set null,
  destination_batch_id    uuid references public.product_batches(id) on delete set null,
  movement_id             uuid,               -- mouvement « entrée » de la ligne (un par produit et par réception)
  constraint stock_transfer_receipt_lines_kind check ((kind = 'received') = (allocation_id is not null))
);
create index stock_transfer_receipt_lines_receipt on public.stock_transfer_receipt_lines (receipt_id);
create index stock_transfer_receipt_lines_allocation on public.stock_transfer_receipt_lines (allocation_id) where allocation_id is not null;
create index stock_transfer_receipt_lines_item on public.stock_transfer_receipt_lines (item_id);

-- ── 5. Écarts réglés : rendus à la source, perdus ───────────────────────────
create table public.stock_transfer_settlements (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references public.stock_transfers(id) on delete cascade,
  item_id        uuid not null references public.stock_transfer_items(id) on delete cascade,
  allocation_id  uuid not null references public.stock_transfer_allocations(id) on delete cascade,
  kind           text not null check (kind in ('returned', 'lost')),
  reason         text not null check (reason in ('cancelled', 'not_sent', 'transport_loss', 'breakage', 'theft', 'other')),
  note           text,
  quantity       int not null check (quantity > 0),
  action_key     uuid not null,               -- idempotence d'une action (une action peut toucher plusieurs allocations)
  settled_by     uuid references auth.users(id) on delete set null,
  settled_at     timestamptz not null default now(),
  restored_batch_id  uuid references public.product_batches(id) on delete set null,   -- lot source crédité (retour)
  movement_id    uuid,
  constraint stock_transfer_settlements_kind check ((kind = 'returned') = (reason in ('cancelled', 'not_sent'))),
  constraint stock_transfer_settlements_other_note check (reason <> 'other' or coalesce(btrim(note), '') <> ''),
  constraint stock_transfer_settlements_once unique (action_key, allocation_id)
);
create index stock_transfer_settlements_transfer on public.stock_transfer_settlements (transfer_id);
create index stock_transfer_settlements_allocation on public.stock_transfer_settlements (allocation_id);

-- ── 6. Liens de traçabilité sur les lots et les mouvements ─────────────────
alter table public.product_batches
  add column origin_transfer_id  uuid references public.stock_transfers(id) on delete set null,
  add column origin_batch_id     uuid references public.product_batches(id) on delete set null,
  add column origin_untracked    boolean not null default false;   -- lot technique : stock source sans lot connu
create index product_batches_origin_transfer on public.product_batches (origin_transfer_id) where origin_transfer_id is not null;
create index product_batches_origin_batch on public.product_batches (origin_batch_id) where origin_batch_id is not null;

alter table public.stock_movements
  add column transfer_id  uuid references public.stock_transfers(id) on delete set null,
  add column batch_id     uuid references public.product_batches(id) on delete set null;
create index stock_movements_transfer on public.stock_movements (transfer_id) where transfer_id is not null;
create index stock_movements_batch on public.stock_movements (batch_id) where batch_id is not null;

-- Perte pendant le transport : un mouvement explicite qui ne change AUCUN stock (avant / après vides)
alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check
  check (type in ('in', 'out', 'adjustment', 'sale', 'transit_loss'));

-- ── 7. Réservé au serveur ───────────────────────────────────────────────────
alter table public.stock_transfer_allocations    enable row level security;
alter table public.stock_transfer_receipts       enable row level security;
alter table public.stock_transfer_receipt_lines  enable row level security;
alter table public.stock_transfer_settlements    enable row level security;
revoke all on table public.stock_transfer_allocations   from anon, authenticated;
revoke all on table public.stock_transfer_receipts      from anon, authenticated;
revoke all on table public.stock_transfer_receipt_lines from anon, authenticated;
revoke all on table public.stock_transfer_settlements   from anon, authenticated;

-- ── 8. Les 6 transferts existants (rien n'est corrigé, tout reste lisible) ──
-- Une allocation « ancien modèle » par ligne, aux quantités déjà connues
insert into public.stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent, quantity_received, quantity_returned, quantity_lost)
select t.id, i.id, 'legacy', i.buying_price, i.quantity_sent,
       case when t.status = 'received' then coalesce(i.quantity_received, 0) else 0 end,
       case when t.status = 'cancelled' then i.quantity_sent else 0 end,
       case when t.status = 'received' then i.quantity_sent - coalesce(i.quantity_received, 0) else 0 end
from public.stock_transfers t join public.stock_transfer_items i on i.stock_transfer_id = t.id;

-- Réceptions des 3 transferts reçus, et le règlement de l'annulé
insert into public.stock_transfer_receipts (transfer_id, receipt_key, received_by, received_at)
select id, gen_random_uuid(), received_by, coalesce(received_at, created_at) from public.stock_transfers where status = 'received';
insert into public.stock_transfer_receipt_lines (receipt_id, item_id, allocation_id, kind, quantity, destination_product_id)
select r.id, a.item_id, a.id, 'received', a.quantity_received, i.destination_product_id
from public.stock_transfer_receipts r
join public.stock_transfer_allocations a on a.transfer_id = r.transfer_id and a.quantity_received > 0
join public.stock_transfer_items i on i.id = a.item_id;
insert into public.stock_transfer_settlements (transfer_id, item_id, allocation_id, kind, reason, quantity, action_key, settled_by, settled_at)
select a.transfer_id, a.item_id, a.id, 'returned', 'cancelled', a.quantity_returned, gen_random_uuid(), t.cancelled_by, coalesce(t.cancelled_at, t.created_at)
from public.stock_transfer_allocations a join public.stock_transfers t on t.id = a.transfer_id
where a.quantity_returned > 0;

-- Mouvements existants rattachés à leur transfert quand le rattachement est certain
-- (référence + boutique, et un seul transfert possible)
update public.stock_movements m set transfer_id = x.id
from (
  select m2.id as movement_id, min(t.id::text)::uuid as id, count(*) as n
  from public.stock_movements m2
  join public.stock_transfers t
    on m2.reason like '%' || t.reference || '%'
   and ((m2.reason like 'Transfert % vers %' and m2.shop_id = t.source_shop_id)
     or (m2.reason like 'Annulation transfert %' and m2.shop_id = t.source_shop_id)
     or (m2.reason like 'Transfert % depuis %' and m2.shop_id = t.destination_shop_id))
  group by m2.id
) x
where m.id = x.movement_id and x.n = 1;

-- ── 9. Fonctions internes ───────────────────────────────────────────────────
create or replace function public._transfer_check_shops(p_source uuid, p_dest uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_source is null or p_dest is null or p_source = p_dest then raise exception 'transfer_same_shop'; end if;
  if not exists (select 1 from shops s join shops d on d.entity_id = s.entity_id where s.id = p_source and d.id = p_dest) then
    raise exception 'transfer_other_company';
  end if;
end;
$$;

create or replace function public._transfer_replace_items(p_transfer_id uuid, p_source uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_row   record;
  v_count int := 0;
begin
  delete from stock_transfer_items where stock_transfer_id = p_transfer_id;
  for v_row in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::int)::int as quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
     where nullif(e->>'product_id', '') is not null and nullif(e->>'quantity', '') is not null
     group by 1 having sum((e->>'quantity')::int) > 0
  loop
    insert into stock_transfer_items (stock_transfer_id, source_product_id, product_name, unit, quantity_sent)
      select p_transfer_id, p.id, p.name, p.unit, v_row.quantity from products p where p.id = v_row.product_id and p.shop_id = p_source;
    if not found then raise exception 'product_not_found'; end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Régler le reliquat EN TRANSIT d'une ligne : rendu à la source (annulé, jamais parti) ou perdu.
-- Ordre : les allocations qui périment le plus TARD d'abord (celles qui restent après une
-- réception partielle, puisque les unités reçues vont aux plus proches de leur péremption).
create or replace function public._transfer_settle_item(
  p_item_id uuid, p_reason text, p_note text, p_user uuid, p_action_key uuid
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_it       record;
  v_a        record;
  v_kind     text;
  v_qty      int;
  v_total    int := 0;
  v_batch    uuid;
  v_prev     int;
  v_mv       uuid;
  v_label    text;
begin
  if p_reason is null or p_reason not in ('cancelled', 'not_sent', 'transport_loss', 'breakage', 'theft', 'other') then
    raise exception 'settlement_reason_required';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'settlement_note_required'; end if;
  v_kind := case when p_reason in ('cancelled', 'not_sent') then 'returned' else 'lost' end;

  select i.*, t.reference as ref, t.source_shop_id as src into v_it
    from stock_transfer_items i join stock_transfers t on t.id = i.stock_transfer_id where i.id = p_item_id;

  for v_a in
    select * from stock_transfer_allocations
     where item_id = p_item_id and quantity_in_transit > 0
     order by (coverage = 'batch') asc, source_expiry_date desc nulls first, source_received_at desc nulls first, id desc
     for update
  loop
    v_qty := v_a.quantity_in_transit;
    v_batch := null; v_mv := null;

    if v_kind = 'returned' then
      -- Rendu aux lots source EXACTS ; lot disparu entre-temps : recréé à l'identique (même péremption, même coût)
      if v_a.coverage = 'batch' then
        update product_batches set quantity = quantity + v_qty, updated_at = now() where id = v_a.source_batch_id
          returning id into v_batch;
        if v_batch is null then
          insert into product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                       origin_transfer_id, origin_batch_id)
            values (v_it.src, v_it.source_product_id, v_qty, v_qty, case when v_a.unit_cost > 0 then v_a.unit_cost else null end, v_a.source_expiry_date, 'adjustment',
                    coalesce(v_a.source_received_at, now()), v_it.stock_transfer_id, null)
            returning id into v_batch;
        end if;
      end if;
      update stock_transfer_allocations set quantity_returned = quantity_returned + v_qty where id = v_a.id;
    else
      -- Perdu : sort du reliquat, n'entre nulle part ; mouvement explicite, aucun stock modifié
      update stock_transfer_allocations set quantity_lost = quantity_lost + v_qty where id = v_a.id;
      v_label := case p_reason when 'transport_loss' then 'Perte' when 'breakage' then 'Casse' when 'theft' then 'Vol' else 'Autre' end;
      insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, transfer_id, batch_id)
        values (v_it.src, v_it.source_product_id, 'transit_loss', v_qty, null, null,
                'Transfert ' || v_it.ref || ' — ' || v_label || ' pendant le transport', nullif(btrim(p_note), ''), p_user,
                v_it.stock_transfer_id, v_a.source_batch_id)
        returning id into v_mv;
    end if;

    insert into stock_transfer_settlements (transfer_id, item_id, allocation_id, kind, reason, note, quantity, action_key, settled_by, restored_batch_id, movement_id)
      values (v_it.stock_transfer_id, p_item_id, v_a.id, v_kind, p_reason, nullif(btrim(p_note), ''), v_qty, p_action_key, p_user, v_batch, v_mv);
    v_total := v_total + v_qty;
  end loop;

  -- Retour : le stock du produit source remonte d'autant (un mouvement par ligne)
  if v_kind = 'returned' and v_total > 0 and v_it.source_product_id is not null then
    select quantity into v_prev from products where id = v_it.source_product_id and shop_id = v_it.src;
    if found then
      update products set quantity = v_prev + v_total, updated_at = now() where id = v_it.source_product_id;
      insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
        values (v_it.src, v_it.source_product_id, 'in', v_total, v_prev, v_prev + v_total,
                'Annulation transfert ' || v_it.ref || case when p_reason = 'not_sent' then ' — quantité non envoyée' else '' end,
                p_user, v_it.stock_transfer_id)
        returning id into v_mv;
      update stock_transfer_settlements set movement_id = v_mv where action_key = p_action_key and item_id = p_item_id and kind = 'returned';
    end if;
  end if;

  if v_total > 0 and p_reason <> 'cancelled' then
    update stock_transfers set has_discrepancy = true, updated_at = now() where id = v_it.stock_transfer_id;
  end if;
  return v_total;
end;
$$;

-- Statut d'après les allocations (source de vérité)
create or replace function public._transfer_refresh_status(p_transfer_id uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_sent     int;
  v_transit  int;
  v_received int;
  v_returned int;
  v_status   text;
begin
  select sum(quantity_sent), sum(quantity_in_transit), sum(quantity_received), sum(quantity_returned)
    into v_sent, v_transit, v_received, v_returned from stock_transfer_allocations where transfer_id = p_transfer_id;
  -- « Annulé » seulement si TOUT est revenu à la source. Rien reçu mais des unités perdues (perte, casse, vol) :
  -- le transfert est terminé AVEC écart (« reçu » + has_discrepancy), jamais « annulé ». (Correction du 15 oct.)
  v_status := case
    when v_transit = v_sent then 'sent'
    when v_transit > 0 then 'partially_received'
    when v_returned = v_sent then 'cancelled'
    else 'received' end;
  update stock_transfers
     set status = v_status,
         received_at = case when v_status = 'received' then now() else received_at end,
         received_by = case when v_status = 'received' then p_user else received_by end,
         cancelled_at = case when v_status = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when v_status = 'cancelled' then p_user else cancelled_by end,
         has_discrepancy = has_discrepancy or exists (select 1 from stock_transfer_items where stock_transfer_id = p_transfer_id and quantity_surplus > 0),
         updated_at = now()
   where id = p_transfer_id;
  return v_status;
end;
$$;

-- ── 10. Fonctions appelées par les routes ───────────────────────────────────

create or replace function public.create_stock_transfer(
  p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_send boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
  v_ref  text;
begin
  perform _transfer_check_shops(p_source, p_dest);
  perform pg_advisory_xact_lock(hashtextextended('transfer-ref:' || p_source::text, 0));
  select coalesce(max(nullif(split_part(reference, '-', 3), '')::int), 0) + 1 into v_seq
    from stock_transfers where source_shop_id = p_source and reference like 'TR-' || v_year || '-%';
  v_ref := 'TR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  insert into stock_transfers (reference, source_shop_id, destination_shop_id, status, notes, created_by)
    values (v_ref, p_source, p_dest, 'draft', nullif(btrim(p_notes), ''), p_user)
    returning id into v_id;
  if _transfer_replace_items(v_id, p_source, p_items) = 0 then raise exception 'transfer_empty'; end if;
  if p_send then return send_stock_transfer_draft(v_id, p_source, p_user); end if;
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'draft');
end;
$$;

create or replace function public.update_stock_transfer_draft(
  p_transfer_id uuid, p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_src     uuid;
  v_updated timestamptz;
begin
  select status, source_shop_id, updated_at into v_status, v_src, v_updated from stock_transfers where id = p_transfer_id for update;
  if not found or v_src <> p_source then raise exception 'transfer_not_found'; end if;
  if v_status <> 'draft' then raise exception 'transfer_not_draft'; end if;
  if p_expected_updated_at is not null and v_updated <> p_expected_updated_at then raise exception 'transfer_changed'; end if;
  perform _transfer_check_shops(p_source, p_dest);
  update stock_transfers set destination_shop_id = p_dest, notes = nullif(btrim(p_notes), ''), updated_at = now() where id = p_transfer_id;
  if _transfer_replace_items(p_transfer_id, p_source, p_items) = 0 then raise exception 'transfer_empty'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', 'draft');
end;
$$;

-- Envoyer : stock ET lots source décomptés (FEFO), allocations enregistrées ; jamais deux fois
create or replace function public.send_stock_transfer_draft(p_transfer_id uuid, p_source uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_src       uuid;
  v_dest      uuid;
  v_ref       text;
  v_dest_name text;
  v_it        record;
  v_prev      int;
  v_buy       numeric;
  v_sell      numeric;
  v_name      text;
  v_unit      text;
  v_left      int;
  v_b         record;
  v_take      int;
  v_expired   int;
begin
  select status, source_shop_id, destination_shop_id, reference into v_status, v_src, v_dest, v_ref
    from stock_transfers where id = p_transfer_id for update;
  if not found or v_src <> p_source then raise exception 'transfer_not_found'; end if;
  if v_status in ('sent', 'partially_received', 'received') then
    return jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', v_status, 'already_sent', true);
  end if;
  if v_status <> 'draft' then raise exception 'transfer_not_draft'; end if;
  perform _transfer_check_shops(v_src, v_dest);
  select name into v_dest_name from shops where id = v_dest;

  -- Produits verrouillés dans un ordre fixe (comme une vente : produit puis ses lots)
  perform 1 from products
    where id in (select source_product_id from stock_transfer_items where stock_transfer_id = p_transfer_id)
    order by id for update;

  for v_it in select * from stock_transfer_items where stock_transfer_id = p_transfer_id order by source_product_id loop
    select quantity, buying_price, selling_price, name, unit into v_prev, v_buy, v_sell, v_name, v_unit
      from products where id = v_it.source_product_id and shop_id = v_src;
    if not found then raise exception 'product_not_found'; end if;
    -- Transférable = stock − unités des lots déjà périmés (un lot qui périme aujourd'hui ne l'est pas encore)
    select coalesce(sum(quantity), 0) into v_expired from product_batches
      where product_id = v_it.source_product_id and quantity > 0 and expiry_date < current_date;
    if v_prev - v_expired < v_it.quantity_sent then
      raise exception 'insufficient_transferable_stock' using detail = jsonb_build_object(
        'product', v_name, 'transferable', greatest(v_prev - v_expired, 0), 'expired', v_expired, 'requested', v_it.quantity_sent)::text;
    end if;

    update products set quantity = v_prev - v_it.quantity_sent, updated_at = now() where id = v_it.source_product_id;
    insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
      values (v_src, v_it.source_product_id, 'out', v_it.quantity_sent, v_prev, v_prev - v_it.quantity_sent,
              'Transfert ' || v_ref || ' vers ' || v_dest_name, p_user, p_transfer_id);

    -- Lots : la règle FEFO existante (même tri que deplete_product_batches) choisit ce qui part, parmi les lots NON périmés
    v_left := v_it.quantity_sent;
    for v_b in select id, quantity, expiry_date, buying_price, received_at from product_batches
                where product_id = v_it.source_product_id and quantity > 0
                  and (expiry_date is null or expiry_date >= current_date)
                order by expiry_date asc nulls last, received_at asc
                for update loop
      exit when v_left <= 0;
      v_take := least(v_b.quantity, v_left);
      update product_batches set quantity = quantity - v_take, updated_at = now() where id = v_b.id;
      insert into stock_transfer_allocations (transfer_id, item_id, coverage, source_batch_id, source_expiry_date, source_received_at, unit_cost, quantity_sent)
        values (p_transfer_id, v_it.id, 'batch', v_b.id, v_b.expiry_date, v_b.received_at, coalesce(v_b.buying_price, v_buy), v_take);
      v_left := v_left - v_take;
    end loop;
    -- Stock non couvert par un lot : il part tel quel, sans lot inventé
    if v_left > 0 then
      insert into stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent)
        values (p_transfer_id, v_it.id, 'uncovered', v_buy, v_left);
    end if;

    update stock_transfer_items set product_name = v_name, unit = v_unit, buying_price = v_buy, selling_price = v_sell where id = v_it.id;
  end loop;

  update stock_transfers set status = 'sent', sent_at = now(), sent_by = p_user, updated_at = now() where id = p_transfer_id;
  return jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', 'sent', 'already_sent', false);
end;
$$;

-- Réceptionner (tout ou partie). p_lines : [{ item_id, quantity_received, destination_product_id?,
--   remainder?: 'later' | 'close', settlement_reason?, settlement_note? }]
create or replace function public.receive_stock_transfer_lines(
  p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_src       uuid;
  v_destshop  uuid;
  v_ref       text;
  v_src_name  text;
  v_ids       uuid[];
  v_receipt   uuid;
  v_line      jsonb;
  v_it        record;
  v_transit   int;
  v_q         int;
  v_acc       int;
  v_surplus   int;
  v_dest_pid  uuid;
  v_prev      int;
  v_mv        uuid;
  v_left      int;
  v_a         record;
  v_take      int;
  v_batch     uuid;
begin
  select status, source_shop_id, destination_shop_id, reference into v_status, v_src, v_destshop, v_ref
    from stock_transfers where id = p_transfer_id for update;
  if not found or v_destshop <> p_dest then raise exception 'transfer_not_found'; end if;
  if exists (select 1 from stock_transfer_receipts where receipt_key = p_receipt_key) then
    return jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', v_status, 'replayed', true);
  end if;
  if v_status not in ('sent', 'partially_received') then raise exception 'transfer_not_in_transit'; end if;
  select name into v_src_name from shops where id = v_src;

  -- Produits touchés (destination, et source pour un retour) verrouillés dans un ordre fixe
  select array_agg(x) into v_ids from (
    select nullif(l->>'destination_product_id', '')::uuid as x from jsonb_array_elements(p_lines) l
    union select destination_product_id from stock_transfer_items where stock_transfer_id = p_transfer_id
    union select source_product_id from stock_transfer_items where stock_transfer_id = p_transfer_id
  ) s where x is not null;
  perform 1 from products where id = any(v_ids) order by id for update;

  insert into stock_transfer_receipts (transfer_id, receipt_key, received_by, note)
    values (p_transfer_id, p_receipt_key, p_user, nullif(btrim(p_note), ''))
    returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_it from stock_transfer_items
      where id = nullif(v_line->>'item_id', '')::uuid and stock_transfer_id = p_transfer_id for update;
    continue when not found;

    select coalesce(sum(quantity_in_transit), 0) into v_transit from stock_transfer_allocations where item_id = v_it.id;
    v_q := greatest(coalesce(nullif(v_line->>'quantity_received', '')::int, 0), 0);
    v_acc := least(v_q, v_transit);
    v_surplus := v_q - v_acc;
    v_mv := null;
    v_dest_pid := coalesce(nullif(v_line->>'destination_product_id', '')::uuid, v_it.destination_product_id);

    if v_acc > 0 then
      if v_dest_pid is not null then
        select quantity into v_prev from products where id = v_dest_pid and shop_id = p_dest;
        if not found then raise exception 'destination_product_not_found'; end if;
      else
        insert into products (shop_id, name, unit, buying_price, selling_price, quantity, is_active)
          values (p_dest, v_it.product_name, v_it.unit, coalesce(v_it.buying_price, 0), coalesce(v_it.selling_price, v_it.buying_price, 0), 0, true)
          returning id, quantity into v_dest_pid, v_prev;
      end if;
      update products set quantity = v_prev + v_acc, updated_at = now() where id = v_dest_pid;
      insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
        values (p_dest, v_dest_pid, 'in', v_acc, v_prev, v_prev + v_acc, 'Transfert ' || v_ref || ' depuis ' || v_src_name, p_user, p_transfer_id)
        returning id into v_mv;

      -- Répartition par défaut : les allocations qui périment le plus tôt d'abord (déterministe)
      v_left := v_acc;
      for v_a in select * from stock_transfer_allocations
                  where item_id = v_it.id and quantity_in_transit > 0
                  order by (coverage = 'batch') desc, source_expiry_date asc nulls last, source_received_at asc nulls last, id
                  for update loop
        exit when v_left <= 0;
        v_take := least(v_a.quantity_in_transit, v_left);
        v_batch := null;
        -- Un lot destination par lot source reçu : même péremption, coût du lot source, liens d'origine
        if v_a.coverage = 'batch' then
          insert into product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                       origin_transfer_id, origin_batch_id)
            values (p_dest, v_dest_pid, v_take, v_take, case when v_a.unit_cost > 0 then v_a.unit_cost else null end, v_a.source_expiry_date, 'transfer', now(),
                    p_transfer_id, v_a.source_batch_id)
            returning id into v_batch;
        end if;
        -- « Sans lot connu » et « ancien modèle » : lot TECHNIQUE « origine non tracée » — sans date (inconnue),
        -- coût seulement s'il est connu dans le transfert, lien vers le transfert ; la destination garde stock = lots
        if v_a.coverage <> 'batch' then
          insert into product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                       origin_transfer_id, origin_batch_id, origin_untracked)
            values (p_dest, v_dest_pid, v_take, v_take, case when v_a.unit_cost > 0 then v_a.unit_cost else null end, null, 'transfer', now(),
                    p_transfer_id, null, true)
            returning id into v_batch;
        end if;
        update stock_transfer_allocations set quantity_received = quantity_received + v_take where id = v_a.id;
        insert into stock_transfer_receipt_lines (receipt_id, item_id, allocation_id, kind, quantity, assignment, destination_product_id, destination_batch_id, movement_id)
          values (v_receipt, v_it.id, v_a.id, 'received', v_take, 'auto', v_dest_pid, v_batch, v_mv);
        v_left := v_left - v_take;
      end loop;
    end if;

    -- Surplus : signalé et gardé ; aucun stock modifié (règle de résolution à valider)
    if v_surplus > 0 then
      insert into stock_transfer_receipt_lines (receipt_id, item_id, kind, quantity, destination_product_id)
        values (v_receipt, v_it.id, 'surplus', v_surplus, v_dest_pid);
      update stock_transfer_items set quantity_surplus = quantity_surplus + v_surplus, surplus_status = 'pending' where id = v_it.id;
    end if;

    update stock_transfer_items
       set quantity_received = coalesce(quantity_received, 0) + v_acc,
           destination_product_id = coalesce(v_dest_pid, destination_product_id)
     where id = v_it.id;

    -- Reliquat : « arrivera plus tard » (rien) ou « clôturer cet écart » (motif)
    if v_transit - v_acc > 0 and v_line->>'remainder' = 'close' then
      perform _transfer_settle_item(v_it.id, v_line->>'settlement_reason', v_line->>'settlement_note', p_user, p_receipt_key);
    end if;
  end loop;

  perform _transfer_refresh_status(p_transfer_id, p_user);
  return (select jsonb_build_object('id', t.id, 'reference', t.reference, 'status', t.status, 'has_discrepancy', t.has_discrepancy, 'replayed', false,
                                    'in_transit', (select coalesce(sum(quantity_in_transit), 0) from stock_transfer_allocations where transfer_id = t.id))
            from stock_transfers t where t.id = p_transfer_id);
end;
$$;

-- Régler plus tard un reliquat resté en route (« le reste n'arrivera pas » / « jamais parti »)
create or replace function public.settle_stock_transfer_item(
  p_transfer_id uuid, p_dest uuid, p_user uuid, p_item_id uuid, p_reason text, p_note text, p_action_key uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_destshop uuid;
  v_src_pid  uuid;
begin
  select status, destination_shop_id into v_status, v_destshop from stock_transfers where id = p_transfer_id for update;
  if not found or v_destshop <> p_dest then raise exception 'transfer_not_found'; end if;
  if exists (select 1 from stock_transfer_settlements where action_key = p_action_key) then
    return jsonb_build_object('id', p_transfer_id, 'status', v_status, 'replayed', true);
  end if;
  if v_status not in ('sent', 'partially_received') then raise exception 'transfer_not_in_transit'; end if;
  if p_reason = 'cancelled' then raise exception 'settlement_reason_required'; end if;
  select source_product_id into v_src_pid from stock_transfer_items where id = p_item_id and stock_transfer_id = p_transfer_id;
  if not found then raise exception 'item_not_found'; end if;
  if v_src_pid is not null then perform 1 from products where id = v_src_pid for update; end if;
  if _transfer_settle_item(p_item_id, p_reason, p_note, p_user, p_action_key) = 0 then raise exception 'nothing_in_transit'; end if;
  return jsonb_build_object('id', p_transfer_id, 'status', _transfer_refresh_status(p_transfer_id, p_user), 'replayed', false);
end;
$$;

-- Annuler : brouillon (aucun stock) ; envoyé et RIEN encore reçu ni réglé (tout revient aux lots source exacts).
-- Après une réception partielle : refusé (on ne réécrit pas l'histoire), seul le reliquat se règle.
create or replace function public.cancel_stock_transfer(p_transfer_id uuid, p_source_shop_id uuid, p_performed_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_src    uuid;
  v_key    uuid := gen_random_uuid();
  v_it     record;
begin
  select status, source_shop_id into v_status, v_src from stock_transfers where id = p_transfer_id for update;
  if not found or v_src is distinct from p_source_shop_id then raise exception 'transfer_not_found'; end if;
  if v_status = 'cancelled' then return; end if;                       -- déjà annulé : rien de plus
  if v_status = 'draft' then
    update stock_transfers set status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() where id = p_transfer_id;
    return;
  end if;
  if v_status <> 'sent' or exists (select 1 from stock_transfer_allocations
                                     where transfer_id = p_transfer_id and quantity_in_transit <> quantity_sent) then
    raise exception 'transfer_not_cancellable';
  end if;
  perform 1 from products where id in (select source_product_id from stock_transfer_items where stock_transfer_id = p_transfer_id)
    order by id for update;
  for v_it in select id from stock_transfer_items where stock_transfer_id = p_transfer_id order by source_product_id loop
    perform _transfer_settle_item(v_it.id, 'cancelled', null, p_performed_by, v_key);
  end loop;
  update stock_transfers set status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() where id = p_transfer_id;
end;
$$;

-- ── 11. Anciennes fonctions : même nom, même appel, nouvelles règles ────────
create or replace function public.send_stock_transfer(
  p_source_shop_id uuid, p_destination_shop_id uuid, p_performed_by uuid, p_notes text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return create_stock_transfer(p_source_shop_id, p_destination_shop_id, p_performed_by, p_notes, p_items, true);
end;
$$;

create or replace function public.receive_stock_transfer(
  p_transfer_id uuid, p_destination_shop_id uuid, p_performed_by uuid, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb;
begin
  -- Ancien écran : une seule réception ; chaque manque est réglé avec la catégorie choisie
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', e->>'transfer_item_id',
           'quantity_received', coalesce(nullif(e->>'quantity_received', '')::int, 0),
           'destination_product_id', e->>'destination_product_id',
           'remainder', 'close',
           'settlement_reason', case e->>'discrepancy_category'
                                  when 'transport_loss' then 'transport_loss' when 'theft' then 'theft'
                                  when 'breakage' then 'breakage' else 'other' end,
           'settlement_note', coalesce(nullif(btrim(e->>'discrepancy_detail'), ''), 'Écart saisi avec une ancienne version de l’application')
         )), '[]'::jsonb)
    into v_lines from jsonb_array_elements(p_items) e;
  perform receive_stock_transfer_lines(p_transfer_id, p_destination_shop_id, p_performed_by, gen_random_uuid(), v_lines, null);
  return jsonb_build_object('id', p_transfer_id);
end;
$$;

-- ── 12. Exécution : serveur seulement ───────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._transfer_check_shops(uuid, uuid)',
    'public._transfer_replace_items(uuid, uuid, jsonb)',
    'public._transfer_settle_item(uuid, text, text, uuid, uuid)',
    'public._transfer_refresh_status(uuid, uuid)',
    'public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean)',
    'public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz)',
    'public.send_stock_transfer_draft(uuid, uuid, uuid)',
    'public.receive_stock_transfer_lines(uuid, uuid, uuid, uuid, jsonb, text)',
    'public.settle_stock_transfer_item(uuid, uuid, uuid, uuid, text, text, uuid)',
    'public.cancel_stock_transfer(uuid, uuid, uuid)',
    'public.send_stock_transfer(uuid, uuid, uuid, text, jsonb)',
    'public.receive_stock_transfer(uuid, uuid, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

