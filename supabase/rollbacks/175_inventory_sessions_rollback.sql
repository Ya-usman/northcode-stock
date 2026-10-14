-- Retour arrière de la migration « Inventaire physique : vraie session ».
-- À n'exécuter QUE si le nouvel écran d'inventaire pose problème.
--
-- Effet : supprime les sessions et leurs comptages. Le STOCK n'est pas touché :
-- les ajustements déjà appliqués par des finalisations restent (produits, lots,
-- mouvements « Inventaire physique — … » avec leur count_session_id), et l'ancien
-- écran les relit comme avant. Une session EN COURS est perdue (aucun stock n'en
-- dépend : rien n'est appliqué avant la finalisation).
-- Le journal d'activité (inventory.start / cancel / finalize) est CONSERVÉ : c'est l'historique de ce qui a eu lieu.
-- (Ce dossier n'est pas un dossier de migrations : rien ici n'est appliqué automatiquement.)

begin;

drop function if exists public.finalize_inventory_session(uuid, uuid, uuid);
drop function if exists public.cancel_inventory_session(uuid, uuid, uuid);
drop function if exists public.set_inventory_count_details(uuid, uuid, text, date);
drop function if exists public.record_inventory_count(uuid, uuid, uuid, int, uuid, uuid);
drop function if exists public.start_inventory_session(uuid, uuid);
drop function if exists public._inventory_audit(uuid, uuid, text, uuid, jsonb);

-- Lots créés par un surplus d'inventaire : ils restent (ce sont des unités réelles), leur origine redevient « Ajustement »
update public.product_batches set source = 'adjustment' where source = 'inventory';
drop index if exists public.product_batches_origin_inventory;
alter table public.product_batches drop column if exists origin_inventory_session_id;
alter table public.product_batches drop constraint if exists product_batches_source_check;
alter table public.product_batches add constraint product_batches_source_check
  check (source in ('backfill', 'restock', 'purchase_order', 'adjustment', 'transfer'));

drop table if exists public.inventory_counts;
drop table if exists public.inventory_sessions;

commit;
