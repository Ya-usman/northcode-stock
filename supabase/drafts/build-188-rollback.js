// Construit supabase/rollbacks/188_transfers_workflow_rollback.sql en reprenant MOT POUR MOT (fins de ligne
// comprises) les fonctions en service avant la 188 : send_stock_transfer (migration 104), receive_stock_transfer et
// cancel_stock_transfer (102). Le banc 188_local_validation.sh compare leur empreinte à celle de la production.
// Usage (racine du dépôt) : node supabase/drafts/build-188-rollback.js [--crlf]
//   --crlf : fins de ligne Windows dans les corps repris (si la production a été installée depuis un fichier CRLF)
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const MIG = path.join(ROOT, 'supabase/migrations/')
const CRLF = process.argv.includes('--crlf')
const extract = (file, name) => {
  const s = fs.readFileSync(MIG + file, 'utf8')
  const a = s.indexOf('CREATE OR REPLACE FUNCTION ' + name + '(')
  if (a < 0) throw new Error(name + ' introuvable dans ' + file)
  const b = s.indexOf('$$;', s.indexOf('AS $$', a)) // fin du corps
  if (b < 0) throw new Error('fin de ' + name + ' introuvable')
  const body = s.slice(a, b + 3)
  return CRLF ? body.replace(/\r?\n/g, '\r\n') : body
}
const send = extract('104_fix_transfer_ownership_check.sql', 'send_stock_transfer')
const receive = extract('102_stock_transfers.sql', 'receive_stock_transfer')
const cancel = extract('102_stock_transfers.sql', 'cancel_stock_transfer')

const sql = `-- Retour arrière de 188_transfers_workflow.sql — à lancer seulement sur décision explicite (éditeur SQL en urgence).
-- GÉNÉRÉ par supabase/drafts/build-188-rollback.js : ne pas modifier à la main.
--
-- Sans perte TANT QU'AUCUN TRANSFERT N'A ÉTÉ ENVOYÉ OU RÉCEPTIONNÉ AVEC LE NOUVEAU MODÈLE. Ensuite, l'ancien modèle ne
-- sait plus représenter des lots décomptés à l'envoi ni un écart enregistré : le script s'arrête de lui-même (aucune
-- modification) et dit pourquoi ; on corrige alors en avant.
-- Un brouillon (aucun stock) est simplement passé en « annulé ».
-- Ne touche JAMAIS stock_movements.batch_id (colonne de la 179, utilisée par le traitement des lots périmés).
-- Recrée send_stock_transfer (104), receive_stock_transfer et cancel_stock_transfer (102) tels qu'en production.
-- Ne touche pas supabase_migrations : enregistrer ensuite l'état (« supabase migration repair --status reverted 188 »).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stock_transfer_allocations WHERE coverage <> 'legacy') THEN
    RAISE EXCEPTION 'Retour arrière refusé : des transferts ont été envoyés avec le nouveau modèle (lots décomptés). Aucune modification faite.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_transfers WHERE receipt_key IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE type = 'transit_loss')
     OR EXISTS (SELECT 1 FROM public.product_batches WHERE origin_transfer_id IS NOT NULL OR origin_untracked) THEN
    RAISE EXCEPTION 'Retour arrière refusé : un transfert a été réceptionné avec le nouveau modèle. Aucune modification faite.';
  END IF;
END $$;

-- Brouillons : aucun stock n'en dépend
UPDATE public.stock_transfers SET status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) WHERE status = 'draft';

-- Nouvelles fonctions
DROP FUNCTION IF EXISTS public.receive_stock_transfer_final(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.send_stock_transfer_draft(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public._transfer_replace_items(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._transfer_check_shops(uuid, uuid);
DROP FUNCTION IF EXISTS public._transfer_audit(uuid, uuid, text, uuid, jsonb);

-- Anciennes fonctions, telles qu'elles étaient (migrations 104 et 102)
${send}

${receive}

${cancel}

REVOKE ALL ON FUNCTION public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.receive_stock_transfer(uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid, uuid, uuid) TO service_role;

-- Tables et colonnes ajoutées par la 188 (stock_movements.batch_id N'EST PAS touchée : elle appartient à la 179)
DROP TABLE IF EXISTS public.stock_transfer_tokens;
DROP TABLE IF EXISTS public.stock_transfer_allocations;

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN ('in', 'out', 'adjustment', 'sale'));
ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS transfer_id;
ALTER TABLE public.product_batches DROP COLUMN IF EXISTS origin_batch_id, DROP COLUMN IF EXISTS origin_transfer_id, DROP COLUMN IF EXISTS origin_untracked;

DROP INDEX IF EXISTS public.stock_transfers_in_transit_destination;
DROP INDEX IF EXISTS public.stock_transfers_source_reference;
ALTER TABLE public.stock_transfers DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS has_discrepancy, DROP COLUMN IF EXISTS receipt_key,
  DROP COLUMN IF EXISTS sent_by, DROP COLUMN IF EXISTS sent_at;
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check CHECK (status IN ('sent', 'received', 'cancelled'));

NOTIFY pgrst, 'reload schema';
COMMIT;
`
const out = path.join(ROOT, 'supabase/rollbacks/188_transfers_workflow_rollback.sql')
fs.writeFileSync(out, sql)
console.log('188_transfers_workflow_rollback.sql écrit :', sql.split('\n').length, 'lignes ; fonctions reprises :',
  [send, receive, cancel].map(f => f.split('(')[0].replace('CREATE OR REPLACE FUNCTION ', '') + ' (' + f.split('\n').length + ' lignes)').join(', '), CRLF ? '(CRLF)' : '(LF)')
