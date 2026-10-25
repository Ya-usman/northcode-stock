// Étape C3 (dettes fournisseurs) — corrections applicatives : vue d'un bon selon les droits coût / dette, réponses de
// /api/suppliers sans solde dû, paiement à la réception réservé au droit « payer », purge des anciens caches, contrôle de
// compilation étendu. Test PUR : faux client et faux modules ; les RÈGLES (lib/permissions, role-permissions,
// supplier-access) sont les vraies. Usage : node tests/e2e/c3-debts-pure.mjs
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.admin; export const createClient = async () => globalThis.__t.session`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: globalThis.__t.user, supabase: globalThis.__t.session }); export const checkShopRole = async () => globalThis.__t.role`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__t.audit.push(e) }; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k) => 'T:' + k`,
  '@/lib/api/shop-objects': `export const supplierOfShop = async () => ({ id: 'sup1', name: 'Fourn' }); export const productsOutsideShop = async () => []; export const customerOfShop = async () => null`,
}
const hooks = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const MOCKS = ${JSON.stringify(MOCKS)}; const ROOT = ${JSON.stringify(ROOT.href)};
export async function resolve(spec, ctx, next) {
  if (spec in MOCKS) return { url: 'mock:' + spec, shortCircuit: true }
  if (spec.startsWith('@/')) for (const cand of [spec.slice(2) + '.ts', spec.slice(2) + '/index.ts']) {
    const u = new URL(cand, ROOT); if (existsSync(fileURLToPath(u))) return next(u.href, ctx)
  }
  return next(spec, ctx)
}
export async function load(url, ctx, next) {
  if (url.startsWith('mock:')) return { format: 'module', source: MOCKS[url.slice(5)], shortCircuit: true }
  return next(url, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hooks))
const imp = p => import(new URL(p, ROOT).href)
const SA = await imp('lib/api/supplier-access.ts')

// ── 1. Vue d'un bon selon les droits ─────────────────────────────────────────
const PO = { id: 'po1', reference: 'BC-1', status: 'received', total_amount: 750, amount_paid: 250, balance: 500, payment_status: 'partial', purchase_order_items: [{ product_name: 'Riz', quantity_ordered: 3, unit_price: 250 }] }
const keys = o => Object.keys(o).sort().join(',')
for (const [cost, debt, want] of [
  [true, true, { total: true, paid: true, line: true }], [true, false, { total: true, paid: false, line: true }],
  [false, true, { total: true, paid: false + true, line: false }], [false, false, { total: false, paid: false, line: false }],
]) {
  const v = SA.orderForViewer(PO, { cost, debt })
  const paid = 'amount_paid' in v && 'balance' in v && 'payment_status' in v
  ok(('total_amount' in v) === want.total && paid === !!want.paid && ('unit_price' in v.purchase_order_items[0]) === want.line && v.purchase_order_items[0].quantity_ordered === 3 && v.reference === 'BC-1',
     `bon vu avec coût=${cost ? 'oui' : 'non'} dette=${debt ? 'oui' : 'non'} : total ${want.total ? 'oui' : 'absent'}, payé / solde / statut ${want.paid ? 'oui' : 'ABSENTS'}, prix des lignes ${want.line ? 'oui' : 'absents'} (${keys(v)})`)
}
ok(PO.balance === 500 && PO.purchase_order_items[0].unit_price === 250, 'l’objet d’origine n’est pas modifié')

// ── 2. Routes ────────────────────────────────────────────────────────────────
function fakeDb(handler) {
  const log = []
  const from = table => {
    const q = { table, op: null, filters: [], cols: null, payload: null }
    const run = () => { log.push(q); return Promise.resolve(handler(q) ?? { data: null, error: null }) }
    const b = {
      select(c) { if (!q.op) q.op = 'select'; q.cols = c ?? '*'; return b }, insert(p) { q.op = 'insert'; q.payload = p; return b },
      update(p) { q.op = 'update'; q.payload = p; return b }, delete() { q.op = 'delete'; return b },
      eq(c, v) { q.filters.push(['eq', c, v]); return b }, in(c, v) { q.filters.push(['in', c, v]); return b }, is() { return b }, neq() { return b },
      gt() { return b }, gte() { return b }, lte() { return b }, not() { return b }, order() { return b }, range() { return b }, limit() { return b },
      single() { return run() }, maybeSingle() { return run() }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, rpc: async (fn, args) => { log.push({ rpc: fn, args }); return handler({ rpc: fn, args }) ?? { data: null, error: null } } }
}
async function call(mod, method, body, { role, rp = null, handler = () => null, url = 'http://local/x' }) {
  const h = q => (q.table === 'shops' && q.op === 'select' ? { data: { role_permissions: rp } } : q.table === 'profiles' ? { data: { full_name: 'T' } } : handler(q))
  const db = fakeDb(h)
  globalThis.__t = { admin: db, session: db, role, user: { id: 'u1', email: 't@example.invalid' }, audit: [] }
  const res = await mod[method](new Request(url, { method, body: body ? JSON.stringify(body) : undefined }))
  return { res, db }
}
const has = (o, k) => JSON.stringify(o).includes(`"${k}"`)
const SUP_ROW = { id: 'sup1', shop_id: 'shop1', name: 'Fourn', phone: null, city: null, email: null, created_at: 'x', deleted_at: null, total_owed: 9000 }

// /api/suppliers : jamais le solde dû
const suppliers = await imp('app/api/suppliers/route.ts')
const { SUPPLIER_PUBLIC_COLUMNS } = await imp('lib/suppliers/columns.ts')
for (const method of ['POST', 'PATCH']) {
  const r = await call(suppliers, method, { id: 'sup1', shop_id: 'shop1', name: 'Fourn' }, { role: 'manager', handler: q => q.table === 'suppliers' && (q.op === 'insert' || q.op === 'update')
    ? { data: q.cols === '*' ? SUP_ROW : Object.fromEntries(q.cols.split(',').map(c => c.trim()).map(c => [c, SUP_ROW[c]])) } : q.table === 'suppliers' ? { data: SUP_ROW } : null })
  const w = r.db.log.find(q => q.table === 'suppliers' && (q.op === 'insert' || q.op === 'update'))
  ok(r.res.status === 200 && w?.cols === SUPPLIER_PUBLIC_COLUMNS && !has(r.res.body, 'total_owed') && !SUPPLIER_PUBLIC_COLUMNS.includes('total_owed'),
     `${method} /api/suppliers : réponse limitée aux colonnes publiques, sans total_owed`)
}

// GET /api/purchase-orders : droits par boutique
const po = await imp('app/api/purchase-orders/route.ts')
const listHandler = q => q.table === 'purchase_orders' && q.op === 'select' ? { data: [structuredClone({ ...PO, shop_id: '11111111-1111-1111-1111-111111111111', supplier_id: 'sup1', created_by: null })] } : null
const CASES = [
  ['manager (coût + Crédits + Fournisseurs par défaut)', 'manager', null, { total: true, paid: true, line: true }],
  ['magasinier (Fournisseurs, ni coût ni Crédits)', 'stock_manager', null, { total: false, paid: false, line: false }],
  ['magasinier avec coût, sans Crédits', 'stock_manager', { stock_manager: { view_purchase_cost: true } }, { total: true, paid: false, line: true }],
  ['magasinier avec Crédits, sans coût', 'stock_manager', { stock_manager: { payments: true } }, { total: true, paid: true, line: false }],
  ['observateur (lecture Fournisseurs + Crédits, sans coût)', 'viewer', null, { total: true, paid: true, line: false }],
]
for (const [label, role, rp, want] of CASES) {
  const r = await call(po, 'GET', null, { role, rp, url: 'http://local/api/purchase-orders?shop_id=11111111-1111-1111-1111-111111111111', handler: listHandler })
  const b = r.res.body.data?.[0] || {}
  const paid = 'amount_paid' in b || 'balance' in b || 'payment_status' in b
  ok(r.res.status === 200 && ('total_amount' in b) === want.total && paid === want.paid && ('unit_price' in (b.purchase_order_items?.[0] || {})) === want.line,
     `GET /api/purchase-orders — ${label} : total ${want.total ? 'oui' : 'absent'}, payé / solde / statut ${want.paid ? 'oui' : 'ABSENTS'}, prix ${want.line ? 'oui' : 'absents'}`)
}
// Réception : paiement réservé au droit « payer »
const receive = await imp('app/api/purchase-orders/receive/route.ts')
const recvH = q => q.table === 'purchase_orders' && q.op === 'select' && q.cols?.includes('balance') ? { data: { balance: 750 } }
  : q.table === 'purchase_orders' && q.op === 'select' ? { data: { supplier_id: 'sup1', is_opening_balance: false } }
  : q.table === 'purchase_order_items' ? { data: [{ id: 'i1', product_id: 'p1', unit_price: 250 }] }
  : q.rpc === 'apply_purchase_order_receipt' ? { data: { items: [] } } : null
const ITEMS = [{ item_id: 'i1', product_id: 'p1', quantity_received: 3, unit_price: 250 }]
const SM = { stock_manager: { view_purchase_cost: true } } // Fournisseurs en modification + coût, SANS Crédits
let r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: ITEMS, payment_full: true, payment_method: 'cash' }, { role: 'stock_manager', rp: SM, handler: recvH })
ok(r.res.status === 403 && r.res.body.code === 'supplier_payment_forbidden' && r.res.body.error === 'T:po_payment_forbidden' && !r.db.log.some(q => q.rpc) && !r.db.log.some(q => q.table === 'supplier_payments'),
   'réception « payée » SANS droit de payer : 403 avant toute écriture (ni réception, ni paiement)')
r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: ITEMS, payment_amount: 100 }, { role: 'stock_manager', rp: SM, handler: recvH })
ok(r.res.status === 403 && !r.db.log.some(q => q.rpc), 'réception avec paiement partiel SANS droit de payer : 403, rien écrit')
r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: ITEMS }, { role: 'stock_manager', rp: SM, handler: recvH })
ok(r.res.status === 200 && r.db.log.some(q => q.rpc === 'apply_purchase_order_receipt') && !r.db.log.some(q => q.table === 'supplier_payments'), 'réception « à crédit » SANS droit de payer : acceptée, aucun paiement')
r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: ITEMS, payment_full: true, payment_method: 'cash' }, { role: 'manager', handler: recvH })
ok(r.res.status === 200 && r.db.log.some(q => q.table === 'supplier_payments' && q.op === 'insert' && q.payload.amount === 750), 'réception « payée » AVEC droit de payer (manager) : paiement du solde enregistré')

// ── 3. Cache local : purge des anciennes listes de fournisseurs avec solde (option A) ──
const store = new Map()
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size } }
const C = await imp('lib/offline/page-cache.ts')
store.set('pc_suppliers_s1', JSON.stringify({ data: { suppliers: [{ id: 'a', total_owed: 9000 }] }, cached_at: 1 }))
store.set('pc_stock_s1', JSON.stringify({ data: { sups: [{ id: 'a', total_owed: 1 }] }, cached_at: 1 }))
store.set('pc_supplier_debtors_s1', JSON.stringify({ data: [{ id: 'a', total_owed: 9000 }], cached_at: 1 }))
store.set('pc_supplier_payments_hist_s1', JSON.stringify({ data: [{ supplier: { total_owed: 9000 } }], cached_at: 1 }))
store.set('pc_suppliers_s2', JSON.stringify({ data: { suppliers: [{ id: 'b', name: 'X' }] }, cached_at: 1 }))
C.purgeCostCaches()
ok(!store.has('pc_suppliers_s1') && !store.has('pc_stock_s1') && store.has('pc_supplier_debtors_s1') && store.has('pc_supplier_payments_hist_s1') && store.has('pc_suppliers_s2'),
   'option A : anciennes listes de fournisseurs avec solde supprimées ; caches de dettes (personnes autorisées) et listes sans solde conservés')

// ── 4. Contrôle de compilation étendu (dossier d'essai) ──────────────────────
const dir = mkdtempSync(join(tmpdir(), 'check-reads-'))
try {
  mkdirSync(join(dir, 'app'), { recursive: true }); mkdirSync(join(dir, 'components')); mkdirSync(join(dir, 'lib'))
  const fixtures = {
    'computed_server_only.tsx': `supabase.from(kind ? 'customers' : 'supplier_payments').select('id')`,
    'computed_protected_star.tsx': `supabase.from(kind ? 'customers' : 'suppliers').select('*')`,
    'computed_protected_ok.tsx': `supabase.from(kind ? 'customers' : 'suppliers').select('id, name, phone')`,
    'nested_fkey_star.tsx': `supabase.from('product_batches').select('id, suppliers!product_batches_supplier_id_fkey(*)')`,
    'nested_star_not_first.tsx': `supabase.from('products').select('id, sale_items(id, *)')`,
    'nested_server_only_left.tsx': `supabase.from('suppliers').select('id, purchase_orders!left(id)')`,
    'literal_total_owed.tsx': `supabase.from('suppliers').select('id, total_owed')`,
  }
  for (const [f, src] of Object.entries(fixtures)) writeFileSync(join(dir, 'app', f), src + '\n')
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/security/check-direct-reads.js', ROOT))], { env: { ...process.env, CHECK_DIRECT_READS_ROOT: dir }, encoding: 'utf8' })
  const text = (out.stdout || '') + (out.stderr || '')
  const flagged = f => text.includes(`app/${f}`)
  ok(out.status === 1, 'contrôle : la construction est bloquée sur le dossier d’essai')
  for (const f of Object.keys(fixtures)) {
    const want = f !== 'computed_protected_ok.tsx'
    ok(flagged(f) === want, `contrôle : ${f.replace('.tsx', '')} ${want ? 'SIGNALÉ' : 'accepté (colonnes sans solde dû)'}`)
  }
} finally { rmSync(dir, { recursive: true, force: true }) }

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
