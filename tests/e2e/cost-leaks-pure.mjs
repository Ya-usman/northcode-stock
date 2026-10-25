// Prix d'achat — deux fuites applicatives corrigées : réponse de POST /api/stock/inventory-count (value_delta) et
// cache local des pages (lib/offline/page-cache.ts). Test PUR : faux localStorage, faux modules, aucun réseau ni base.
// Usage : node tests/e2e/cost-leaks-pure.mjs   (Node ≥ 23 : lecture directe du TypeScript)
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

// ── 1. Cache local des pages ────────────────────────────────────────────────
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null, get length() { return store.size },
}
const C = await import(new URL('lib/offline/page-cache.ts', ROOT).href)

const transfers = [{ id: 't1', reference: 'TR-1', stock_transfer_items: [{ product_name: 'Riz', quantity_sent: 3, buying_price: 12500, selling_price: 15000 }] }]
C.setPageCache('transfers_s1', transfers)
const raw = store.get('pc_transfers_s1')
ok(!raw.includes('buying_price') && raw.includes('"selling_price":15000') && raw.includes('"quantity_sent":3'), 'transferts : buying_price retiré du cache, le reste conservé')
ok(transfers[0].stock_transfer_items[0].buying_price === 12500, 'l’objet affiché à l’écran n’est pas modifié (coût toujours affichable depuis la réponse serveur)')
ok(C.getPageCache('transfers_s1')?.[0]?.stock_transfer_items?.[0]?.quantity_sent === 3, 'transferts : relecture du cache sans coût')

const supps = [{ supplier: 'Fourn', purchase_orders: [{ reference: 'BC-1', total_amount: 9000, purchase_order_items: [{ product_name: 'Riz', quantity_ordered: 2, unit_price: 4500 }] }] }]
C.setPageCache('supplier_payments_hist_s1', supps)
const raw2 = store.get('pc_supplier_payments_hist_s1')
ok(!/"unit_price"/.test(raw2) && raw2.includes('"quantity_ordered":2') && raw2.includes('"total_amount":9000'), 'paiements fournisseurs : prix des lignes de bons retiré, total du bon conservé')

const sales = [{ sale_number: 'V-1', sale_items: [{ product_name: 'Riz', quantity: 1, unit_price: 15000, buying_price: 12500 }] }]
C.setPageCache('sales_s1', sales)
const raw3 = store.get('pc_sales_s1')
ok(raw3.includes('"unit_price":15000') && !raw3.includes('buying_price'), 'ventes : prix de VENTE (unit_price) conservé, buying_price retiré')

const nested = { prods: [{ id: 'p', buying_price: 1, batches: [{ id: 'b', buying_price: 2 }] }] }
C.setPageCache('deep', nested)
ok(!store.get('pc_deep').includes('buying_price'), 'coût retiré à toute profondeur')

store.set('pc_old_transfers', JSON.stringify({ data: transfers, cached_at: Date.now() }))
ok(C.getPageCache('old_transfers') === null && !store.has('pc_old_transfers'), 'ancienne entrée avec buying_price : ignorée ET supprimée à la lecture')
store.set('pc_old_supp', JSON.stringify({ data: supps, cached_at: Date.now() }))
ok(C.getPageCache('old_supp') === null && !store.has('pc_old_supp'), 'ancienne entrée avec prix de ligne de bon : ignorée ET supprimée à la lecture')
store.set('pc_old_format', JSON.stringify(transfers))
ok(C.getPageCache('old_format') === null && !store.has('pc_old_format'), 'ancien format (sans cached_at) avec coût : ignoré ET supprimé')
store.set('pc_clean', JSON.stringify({ data: sales.map(s => ({ ...s, sale_items: [{ product_name: 'Riz', unit_price: 15000 }] })), cached_at: Date.now() }))
ok(C.getPageCache('clean')?.[0]?.sale_items?.[0]?.unit_price === 15000, 'entrée sans coût : servie normalement')

store.clear()
store.set('pc_a', JSON.stringify({ data: transfers, cached_at: 1 })); store.set('pc_b', JSON.stringify({ data: supps, cached_at: 1 }))
store.set('pc_c', JSON.stringify({ data: [{ unit_price: 3 }], cached_at: 1 })); store.set('rq_cache_v1', '{}'); store.set('autre', '{"buying_price":1}')
const removed = C.purgeCostCaches()
ok(removed === 3 && !store.has('pc_a') && !store.has('pc_b') && store.has('pc_c') && !store.has('rq_cache_v1') && store.has('autre'),
   `purge au démarrage : transferts + bons + ancien cache Rapports supprimés, ventes conservées, hors cache non touché (${removed})`)

// ── 2. POST /api/stock/inventory-count : value_delta absent sans droit au coût ──
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => ({ rpc: async (fn, args) => { globalThis.__inv.calls.push([fn, args]); return { data: globalThis.__inv.result, error: null } } })`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: { id: 'u1' }, supabase: {} }); export const checkShopRole = async () => globalThis.__inv.role`,
  '@/lib/api/role-permissions': `export const canWriteFeature = async () => true; export const canViewFeature = async () => true; export const canViewCost = async () => globalThis.__inv.cost`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k) => 'T:' + k`,
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
const route = await import(new URL('app/api/stock/inventory-count/route.ts', ROOT).href)
const RESULT = { adjusted_count: 2, value_delta: -37500, items: [{ product_id: 'p1', product_name: 'Riz', previous_qty: 10, new_qty: 7, reason_code: 'loss', reason_label: 'Perte' }], session_id: 's1' }
async function post(role, cost) {
  globalThis.__inv = { role, cost, calls: [], result: structuredClone(RESULT) }
  const req = new Request('http://local/api/stock/inventory-count', { method: 'POST', body: JSON.stringify({ shop_id: 'shop1', items: [{ product_id: 'p1', counted_qty: 7 }] }) })
  return { res: await route.POST(req), calls: globalThis.__inv.calls }
}
let r = await post('stock_manager', false)
ok(r.res.status === 200 && r.calls.length === 1 && r.calls[0][0] === 'apply_inventory_count', 'sans droit au coût : l’inventaire est appliqué normalement (calcul interne conservé)')
ok(!('value_delta' in r.res.body.data), 'sans droit au coût : value_delta ABSENT (ni null, ni 0)')
ok(r.res.body.data.adjusted_count === 2 && r.res.body.data.session_id === 's1' && r.res.body.data.items[0].new_qty === 7 && r.res.body.data.items[0].previous_qty === 10,
   'sans droit au coût : quantités théorique / comptée, écart en unités et motifs conservés')
ok(!JSON.stringify(r.res.body).includes('37500'), 'sans droit au coût : la valeur n’apparaît nulle part dans la réponse')
r = await post('manager', true)
ok(r.res.status === 200 && r.res.body.data.value_delta === -37500, 'avec droit au coût : value_delta présent')
r = await post('owner', true)
ok(r.res.body.data.value_delta === -37500, 'propriétaire : value_delta présent')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
