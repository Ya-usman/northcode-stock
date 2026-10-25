// Bons de commande — changements de statut (lib/api/purchase-order-status.ts + PATCH /api/purchase-orders).
// Test PUR : faux client et faux modules (authentification, droits, journal, traduction), aucun appel réseau ni base.
// Usage : node tests/e2e/po-status-transitions-pure.mjs   (Node ≥ 23 : lecture directe du TypeScript)
import { register } from 'node:module'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

// ── 1. Matrice exhaustive ───────────────────────────────────────────────────
const T = await import(new URL('lib/api/purchase-order-status.ts', ROOT).href)
const S = ['draft', 'sent', 'partial', 'received', 'cancelled']
ok(JSON.stringify(T.PO_STATUSES) === JSON.stringify(S), 'statuts connus : draft, sent, partial, received, cancelled')
const ALLOWED = new Set(['draft>sent', 'draft>cancelled', 'sent>cancelled'])
for (const from of S) for (const to of S) {
  const r = T.checkPoStatusTransition(from, to)
  const want = from === to ? 'noop' : ALLOWED.has(`${from}>${to}`) ? 'allowed' : 'not_allowed'
  ok(r.kind === want, `${from} → ${to} : ${want}${r.kind === 'not_allowed' ? ` (${r.reason})` : ''}`)
}
const reason = (f, t) => T.checkPoStatusTransition(f, t).reason
for (const [f, t] of [['draft', 'received'], ['sent', 'received'], ['draft', 'partial'], ['sent', 'partial']])
  ok(reason(f, t) === 'receipt_only', `${f} → ${t} : refus « réception uniquement » (protège contre le cas BC-2026-0001)`)
for (const f of ['received', 'partial']) for (const t of ['cancelled', 'draft', 'sent'])
  ok(reason(f, t) === 'already_received', `${f} → ${t} : refus « déjà réceptionné »`)
ok(reason('received', 'partial') === 'already_received' && reason('partial', 'received') === 'already_received', 'received ↔ partial : refus « déjà réceptionné »')
for (const t of ['draft', 'sent', 'partial', 'received']) ok(reason('cancelled', t) === 'not_allowed', `cancelled → ${t} : refus`)
ok(reason('sent', 'draft') === 'not_allowed', 'sent → draft : refus')
for (const bad of ['foo', '', 'RECEIVED', 'Cancelled', 'paid'])
  ok(T.checkPoStatusTransition('draft', bad).kind === 'unknown_status', `statut inconnu « ${bad} » : invalid_status`)
ok(T.PO_TRANSITION_NOT_ALLOWED === 'purchase_order_status_transition_not_allowed' && T.PO_STATUS_CHANGED === 'purchase_order_status_changed', 'codes d’erreur métier')

// ── 2. Messages fr / en / ha ────────────────────────────────────────────────
const cat = Object.fromEntries(['fr', 'en', 'ha'].map(l => [l, JSON.parse(readFileSync(new URL(`messages/${l}.json`, ROOT), 'utf8')).api_errors]))
const KEYS = ['po_status_changed', 'po_already_received', 'po_status_receipt_only', 'po_status_transition_not_allowed', 'po_items_or_status']
for (const l of ['fr', 'en', 'ha']) ok(KEYS.every(k => typeof cat[l][k] === 'string' && cat[l][k].trim().length > 10), `${l} : les 5 messages existent`)
for (const r of ['already_received', 'receipt_only', 'not_allowed']) ok(KEYS.includes(T.poTransitionErrorKey(r)), `clé de message pour ${r}`)
ok(cat.fr.po_status_changed === 'Ce bon de commande a été modifié entre-temps. La liste a été rechargée.', 'fr : message « modifié entre-temps » exact')
ok(cat.en.po_status_changed === 'This purchase order was updated in the meantime. The list has been refreshed.', 'en : message « modifié entre-temps » exact')
ok(cat.fr.po_already_received === 'Ce bon a déjà été réceptionné, totalement ou partiellement. Il ne peut plus être annulé. Utilisez une opération de correction ou de retour adaptée.', 'fr : message « déjà réceptionné » exact')
ok(cat.en.po_already_received === 'This purchase order has already been partially or fully received and can no longer be cancelled. Use the appropriate correction or return workflow.', 'en : message « déjà réceptionné » exact')

// ── 3. Faux client PostgREST (enregistre chaque requête) ────────────────────
// db.status = statut réel en base ; readStatus = statut renvoyé à la lecture (≠ db.status pour simuler une course)
function fakeAdmin(db) {
  const log = []
  const run = (q) => {
    log.push(q)
    if (q.table === 'purchase_orders' && q.op === 'select')
      return { data: { status: db.readStatus ?? db.status, reference: 'BC-TEST', supplier_id: 'sup1', is_opening_balance: !!db.opening }, error: null }
    if (q.table === 'purchase_orders' && q.op === 'update') {
      if (db.updateError) return { data: null, error: { message: 'erreur base' } }
      const st = q.filters.find(f => f[0] === 'status')
      if (st && st[1] !== db.status) return { data: null, error: null } // 0 ligne : la condition ne correspond plus
      if (q.payload.status) db.status = q.payload.status
      return { data: { id: 'po1', shop_id: 'shop1', status: db.status, reference: 'BC-TEST', updated_at: 'now' }, error: null }
    }
    if (q.table === 'profiles') return { data: { full_name: 'Testeur' }, error: null }
    return { data: null, error: null }
  }
  const from = (table) => {
    const q = { table, op: null, payload: null, cols: null, filters: [] }
    const b = {
      select(cols) { if (!q.op) q.op = 'select'; q.cols = cols ?? '*'; return b },
      update(p) { q.op = 'update'; q.payload = p; return b },
      insert(p) { q.op = 'insert'; q.payload = p; return b },
      delete() { q.op = 'delete'; return b },
      eq(c, v) { q.filters.push([c, v]); return b },
      single() { q.term = 'single'; return Promise.resolve(run(q)) },
      maybeSingle() { q.term = 'maybeSingle'; return Promise.resolve(run(q)) },
      then(res, rej) { return Promise.resolve(run(q)).then(res, rej) },
    }
    return b
  }
  return { log, from, rpc: async () => ({ data: null, error: null }) }
}

// ── 4. updatePoStatusAtomically : une seule instruction conditionnée au statut lu ──
{
  const db = { status: 'sent' }; const a = fakeAdmin(db)
  const r = await T.updatePoStatusAtomically(a, { id: 'po1', shopId: 'shop1', from: 'sent', updates: { status: 'cancelled' } })
  const q = a.log[0]
  ok(a.log.length === 1 && q.op === 'update' && q.term === 'maybeSingle', 'une seule requête UPDATE (pas de lecture séparée)')
  ok(JSON.stringify(q.filters) === JSON.stringify([['id', 'po1'], ['shop_id', 'shop1'], ['status', 'sent']]), 'WHERE id AND shop_id AND status = statut lu')
  ok(!/amount|balance|price|paid/.test(q.cols), `colonnes renvoyées sans montants (${q.cols})`)
  ok(!r.conflict && !r.error && r.data.status === 'cancelled', 'statut inchangé entre-temps : écriture faite')
}
{
  const db = { status: 'received' }; const a = fakeAdmin(db)
  const r = await T.updatePoStatusAtomically(a, { id: 'po1', shopId: 'shop1', from: 'sent', updates: { status: 'cancelled' } })
  ok(r.conflict && !r.error && r.data === null && db.status === 'received', 'statut changé entre-temps : 0 ligne → conflict, rien écrit')
}
{
  const a = fakeAdmin({ status: 'sent', updateError: true })
  const r = await T.updatePoStatusAtomically(a, { id: 'po1', shopId: 'shop1', from: 'sent', updates: { status: 'cancelled' } })
  ok(!r.conflict && r.error?.message === 'erreur base', 'erreur base renvoyée telle quelle (pas confondue avec un conflit)')
}

// ── 5. Route PATCH réelle, dépendances remplacées par de faux modules ───────
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__po.admin`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: { id: 'u1', email: 'test@example.invalid' }, supabase: {} }); export const checkShopRole = async () => globalThis.__po.role ?? 'owner'`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__po.audit.push(e) }; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/role-permissions': `export const canViewCost = async () => true; export const canViewFeature = async () => true; export const canWriteFeature = async () => globalThis.__po.canWrite ?? true`,
  '@/lib/api/supplier-access': `export const orderWithoutCost = (x) => x`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k) => 'T:' + k`,
  '@/lib/api/shop-objects': `export const supplierOfShop = async () => true; export const productsOutsideShop = async () => []`,
}
const hooks = `
const MOCKS = ${JSON.stringify(MOCKS)}; const ROOT = ${JSON.stringify(ROOT.href)};
export async function resolve(spec, ctx, next) {
  if (spec in MOCKS) return { url: 'mock:' + spec, shortCircuit: true }
  if (spec.startsWith('@/')) return next(new URL(spec.slice(2) + '.ts', ROOT).href, ctx)
  return next(spec, ctx)
}
export async function load(url, ctx, next) {
  if (url.startsWith('mock:')) return { format: 'module', source: MOCKS[url.slice(5)], shortCircuit: true }
  return next(url, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hooks))
const route = await import(new URL('app/api/purchase-orders/route.ts', ROOT).href)

async function patch(db, body) {
  const admin = fakeAdmin(db)
  globalThis.__po = { admin, audit: [] }
  const req = new Request('http://local/api/purchase-orders', { method: 'PATCH', body: JSON.stringify({ id: 'po1', shop_id: 'shop1', ...body }) })
  const res = await route.PATCH(req)
  const writes = admin.log.filter(q => q.op && q.op !== 'select')
  return { res, writes, log: admin.log, audit: globalThis.__po.audit, db }
}
const STOCK_TABLES = ['products', 'product_batches', 'suppliers', 'stock_movements', 'supplier_payments', 'purchase_order_items']

for (const from of S) for (const to of S) {
  if (from === to) continue
  const r = await patch({ status: from }, { status: to })
  if (ALLOWED.has(`${from}>${to}`)) {
    const u = r.writes.find(q => q.table === 'purchase_orders' && q.op === 'update')
    ok(r.res.status === 200 && r.writes.length === 1 && u && u.filters.some(f => f[0] === 'status' && f[1] === from) && u.payload.status === to
       && r.audit.length === 1 && r.audit[0].action === (to === 'cancelled' ? 'purchase_order.cancel' : 'purchase_order.send'),
       `PATCH ${from} → ${to} : 200, 1 UPDATE conditionné (status = ${from}), 1 trace ${r.audit[0]?.action}`)
    ok(!('received_at' in u.payload) && !('total_amount' in u.payload), `PATCH ${from} → ${to} : ni received_at ni montant écrits`)
  } else {
    const want = from === 'received' || from === 'partial' ? 'po_already_received'
      : from === 'cancelled' ? 'po_status_transition_not_allowed'
      : (to === 'received' || to === 'partial') ? 'po_status_receipt_only' : 'po_status_transition_not_allowed'
    ok(r.res.status === 409 && r.res.body.code === 'purchase_order_status_transition_not_allowed' && r.res.body.error === 'T:' + want
       && r.writes.length === 0 && r.audit.length === 0 && r.db.status === from,
       `PATCH ${from} → ${to} : 409 ${want}, aucune écriture, aucune trace`)
  }
}

// Même statut → même statut : aucune écriture (avant : updated_at réécrit, sent_at / cancelled_by restampés, trace en double)
for (const s of S) {
  const r = await patch({ status: s }, { status: s })
  ok(r.res.status === 200 && r.res.body.unchanged === true && r.writes.length === 0 && r.audit.length === 0 && !('total_amount' in r.res.body.data),
     `PATCH ${s} → ${s} : 200 sans écriture ni trace, réponse sans montants`)
}

// Concurrence : A lit « sent », une réception passe le bon en « received », A tente « sent → cancelled »
{
  const r = await patch({ readStatus: 'sent', status: 'received' }, { status: 'cancelled' })
  const u = r.writes.filter(q => q.op === 'update')
  ok(r.res.status === 409 && r.res.body.code === 'purchase_order_status_changed' && r.res.body.error === 'T:po_status_changed',
     'course sent → (réception) → cancelled : 409 purchase_order_status_changed')
  ok(u.length === 1 && u[0].filters.some(f => f[0] === 'status' && f[1] === 'sent') && r.db.status === 'received',
     'course : l’UPDATE conditionné n’a touché aucune ligne, le bon reste « received »')
  ok(r.audit.length === 0 && !r.log.some(q => STOCK_TABLES.includes(q.table)),
     'course : aucune trace d’annulation, aucune requête sur stock / lots / dette / paiements / lignes')
}
// Même course avec brouillon → envoyé
{
  const r = await patch({ readStatus: 'draft', status: 'cancelled' }, { status: 'sent' })
  ok(r.res.status === 409 && r.res.body.code === 'purchase_order_status_changed' && r.db.status === 'cancelled' && r.audit.length === 0,
     'course draft → (annulé ailleurs) → sent : 409, rien écrit')
}
// Statut inconnu, lignes + statut ensemble, reprise de dette, droits
{
  let r = await patch({ status: 'draft' }, { status: 'foo' })
  ok(r.res.status === 400 && r.res.body.error === 'T:invalid_status' && r.writes.length === 0, 'statut inconnu : 400 invalid_status, aucune écriture')
  r = await patch({ status: 'draft' }, { status: 'sent', items: [{ product_id: 'p1', product_name: 'X', quantity_ordered: 1 }] })
  ok(r.res.status === 400 && r.res.body.error === 'T:po_items_or_status' && r.writes.length === 0, 'lignes + changement de statut : 400, aucune écriture (lignes non remplacées)')
  r = await patch({ status: 'draft' }, { status: 'draft', items: [{ product_id: 'p1', product_name: 'X', quantity_ordered: 2 }] })
  ok(r.res.status === 200 && r.writes.some(q => q.table === 'purchase_order_items' && q.op === 'insert') && r.audit.length === 0,
     'brouillon : modification des lignes inchangée (statut identique accepté)')
  r = await patch({ status: 'sent' }, { items: [{ product_id: 'p1', product_name: 'X', quantity_ordered: 2 }] })
  ok(r.res.status === 400 && r.res.body.error === 'T:draft_only_editable' && r.writes.length === 0, 'lignes d’un bon envoyé : refus inchangé')
  r = await patch({ status: 'received', opening: true }, { status: 'cancelled' })
  ok(r.res.status === 400 && r.res.body.error === 'T:opening_not_editable' && r.writes.length === 0, 'reprise de dette : refus inchangé')
  globalThis.__po = null
  const admin = fakeAdmin({ status: 'sent' }); globalThis.__po = { admin, audit: [], canWrite: false }
  const res = await route.PATCH(new Request('http://local/x', { method: 'PATCH', body: JSON.stringify({ id: 'po1', shop_id: 'shop1', status: 'cancelled' }) }))
  ok(res.status === 403 && admin.log.length === 0, 'sans droit d’écriture « Fournisseurs » : 403, aucune requête')
}

// ── 6. La réception reste la seule voie vers « partial » / « received » ──────
const routeSrc = readFileSync(new URL('app/api/purchase-orders/route.ts', ROOT), 'utf8')
ok(!/received_at/.test(routeSrc.slice(routeSrc.indexOf('export async function PATCH'), routeSrc.indexOf('export async function DELETE'))), 'PATCH n’écrit plus jamais received_at')
const recvSrc = readFileSync(new URL('app/api/purchase-orders/receive/route.ts', ROOT), 'utf8')
ok(recvSrc.includes("rpc('apply_purchase_order_receipt'"), 'réception : toujours apply_purchase_order_receipt (inchangée)')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
