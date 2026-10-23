// Construit rollback_transferts_workflow.sql en reprenant MOT POUR MOT les fonctions en service avant la
// migration : send_stock_transfer (migration 104), receive_stock_transfer et cancel_stock_transfer (102).
const fs = require('fs')
const MIG = 'C:/Users/ghisl/Desktop/Stock Manager/supabase/migrations/'
const extract = (file, name) => {
  const s = fs.readFileSync(MIG + file, 'utf8').replace(/\r\n/g, '\n')
  const a = s.indexOf('CREATE OR REPLACE FUNCTION ' + name + '(')
  if (a < 0) throw new Error(name + ' introuvable dans ' + file)
  const b = s.indexOf('$$;', s.indexOf('AS $$', a)) // fin du corps
  if (b < 0) throw new Error('fin de ' + name + ' introuvable')
  return s.slice(a, b + 3)
}
const send = extract('104_fix_transfer_ownership_check.sql', 'send_stock_transfer')
const receive = extract('102_stock_transfers.sql', 'receive_stock_transfer')
const cancel = extract('102_stock_transfers.sql', 'cancel_stock_transfer')

const sql = `-- Retour arrière de la migration « Transferts : traçabilité lot par lot ».
-- (Ce dossier n'est pas un dossier de migrations : rien ici n'est appliqué automatiquement.)
--
-- RETOUR ARRIÈRE IMMÉDIAT, sans perte, TANT QU'AUCUN TRANSFERT N'A ÉTÉ ENVOYÉ OU RÉCEPTIONNÉ AVEC LE
-- NOUVEAU MODÈLE. Ensuite, l'ancien modèle ne sait plus représenter des lots décomptés à l'envoi, une
-- réception partielle ou une perte réglée : le script s'arrête de lui-même (aucune modification) et dit
-- pourquoi. Dans ce cas on corrige en avant plutôt que de revenir en arrière.
-- Un brouillon (qui ne touche à aucun stock) est simplement passé en « annulé ».

begin;

do $$
begin
  if exists (select 1 from public.stock_transfer_allocations where coverage <> 'legacy') then
    raise exception 'Retour arrière refusé : des transferts ont été envoyés avec le nouveau modèle (lots décomptés). Aucune modification faite.';
  end if;
  if exists (select 1 from public.stock_transfer_receipts r join public.stock_transfer_allocations a on a.transfer_id = r.transfer_id
              where a.coverage = 'legacy' and r.received_at > (select min(created_at) from public.stock_transfer_allocations)) then
    raise exception 'Retour arrière refusé : un ancien transfert a été réceptionné avec le nouveau modèle. Aucune modification faite.';
  end if;
  if exists (select 1 from public.stock_transfer_settlements where reason <> 'cancelled')
     or exists (select 1 from public.stock_transfers where status = 'partially_received')
     or exists (select 1 from public.stock_movements where type = 'transit_loss') then
    raise exception 'Retour arrière refusé : réception partielle ou écart réglé avec le nouveau modèle. Aucune modification faite.';
  end if;
end $$;

-- Brouillons : aucun stock n'en dépend
update public.stock_transfers set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) where status = 'draft';

-- Nouvelles fonctions
drop function if exists public.receive_stock_transfer_lines(uuid, uuid, uuid, uuid, jsonb, text);
drop function if exists public.settle_stock_transfer_item(uuid, uuid, uuid, uuid, text, text, uuid);
drop function if exists public.send_stock_transfer_draft(uuid, uuid, uuid);
drop function if exists public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz);
drop function if exists public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean);
drop function if exists public._transfer_refresh_status(uuid, uuid);
drop function if exists public._transfer_settle_item(uuid, text, text, uuid, uuid);
drop function if exists public._transfer_replace_items(uuid, uuid, jsonb);
drop function if exists public._transfer_check_shops(uuid, uuid);

-- Anciennes fonctions, telles qu'elles étaient (migrations 104 et 102)
${send}

${receive}

${cancel}

revoke all on function public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.receive_stock_transfer(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_stock_transfer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.receive_stock_transfer(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.cancel_stock_transfer(uuid, uuid, uuid) to service_role;

-- Tables et colonnes ajoutées
drop table if exists public.stock_transfer_settlements;
drop table if exists public.stock_transfer_receipt_lines;
drop table if exists public.stock_transfer_receipts;
drop table if exists public.stock_transfer_allocations;

alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check check (type in ('in', 'out', 'adjustment', 'sale'));
alter table public.stock_movements drop column if exists batch_id, drop column if exists transfer_id;
alter table public.product_batches drop column if exists origin_batch_id, drop column if exists origin_transfer_id;
alter table public.stock_transfer_items drop column if exists surplus_status, drop column if exists quantity_surplus;

drop index if exists public.stock_transfers_open_destination;
drop index if exists public.stock_transfers_source_reference;
alter table public.stock_transfers drop column if exists updated_at, drop column if exists has_discrepancy,
  drop column if exists sent_by, drop column if exists sent_at;
alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check check (status in ('sent', 'received', 'cancelled'));

commit;
`
fs.writeFileSync(__dirname + '/rollback_transferts_workflow.sql', sql)
console.log('rollback_transferts_workflow.sql écrit —', sql.split('\n').length, 'lignes ; fonctions reprises :',
  [send, receive, cancel].map(f => f.split('(')[0].replace('CREATE OR REPLACE FUNCTION ', '') + ' (' + f.split('\n').length + ' lignes)').join(', '))
