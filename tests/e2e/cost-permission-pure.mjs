// Permission explicite « Voir les prix d'achat et les coûts » (view_purchase_cost) — règle centrale, transition
// ciblée (migration 181), journal des réglages et gardes des routes serveur. Test PUR : faux client et faux modules
// (authentification, journal, traduction) ; la RÈGLE (lib/permissions + lib/api/role-permissions) est la vraie.
// Usage : node tests/e2e/cost-permission-pure.mjs   (Node ≥ 23 : lecture directe du TypeScript)
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

// ── Faux modules (seules les dépendances extérieures sont remplacées) ───────
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.admin; export const createClient = async () => globalThis.__t.session`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: globalThis.__t.user, supabase: globalThis.__t.session }); export const checkShopRole = async () => globalThis.__t.role`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__t.audit.push(e) }; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k) => 'T:' + k`,
  '@/lib/api/shop-objects': `export const supplierOfShop = async () => ({ id: 'sup1', name: 'Fourn' }); export const productsOutsideShop = async () => []; export const customerOfShop = async () => null`,
  '@/lib/api/batch-treatments': `export const batchTreatmentsAvailable = async () => false; export const batchTreatmentErrorResponse = () => null; export const validRequestId = () => false; export const legacyReason = (c) => c; export const treatmentReason = (c) => c`,
}
const hooks = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const MOCKS = ${JSON.stringify(MOCKS)}; const ROOT = ${JSON.stringify(ROOT.href)};
export async function resolve(spec, ctx, next) {
  if (spec in MOCKS) return { url: 'mock:' + spec, shortCircuit: true }
  if (spec.startsWith('@/')) {
    for (const cand of [spec.slice(2) + '.ts', spec.slice(2) + '/index.ts', spec.slice(2) + '.json']) {
      const u = new URL(cand, ROOT); if (existsSync(fileURLToPath(u))) return next(u.href, cand.endsWith('.json') ? { ...ctx, importAttributes: { type: 'json' } } : ctx)
    }
  }
  return next(spec, ctx)
}
export async function load(url, ctx, next) {
  if (url.startsWith('mock:')) return { format: 'module', source: MOCKS[url.slice(5)], shortCircuit: true }
  return next(url, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hooks))
const imp = p => import(new URL(p, ROOT).href)
const P = await imp('lib/permissions/index.ts')
const RP = await imp('lib/api/role-permissions.ts')
const CF = await imp('lib/api/cost-fields.ts')

// ── 1. Règle centrale, rôle par rôle, permission ON / OFF ───────────────────
const ROLES = ['shop_manager', 'manager', 'stock_manager', 'cashier', 'viewer']
const DEF = { shop_manager: true, manager: true, stock_manager: false, cashier: false, viewer: false }
for (const r of ROLES) ok(P.canViewCost(null, r) === DEF[r], `défaut ${r} : ${DEF[r] ? 'OUI' : 'NON'} (D1)`)
for (const r of ROLES) {
  ok(P.canViewCost({ [r]: { view_purchase_cost: true } }, r) === true, `${r} avec la permission (ON) : voit le coût`)
  ok(P.canViewCost({ [r]: { view_purchase_cost: false } }, r) === false, `${r} sans la permission (OFF) : ne voit pas le coût`)
}
for (const o of ['owner', 'super_admin']) {
  ok(P.canViewCost(null, o) && P.canViewCost({ general: { view_purchase_cost: false }, manager: { view_purchase_cost: false } }, o), `${o} : TOUJOURS (aucun réglage ne le retire)`)
}
ok(!P.canViewCost(null, null) && !P.canViewCost(null, undefined) && !P.canViewCost(null, 'inconnu'), 'sans rôle / rôle inconnu : jamais')
// Fin de la déduction implicite
const fullWrite = { stock: true, stock_write: true, suppliers: true, suppliers_write: true }
ok(!P.canViewCost({ stock_manager: { ...fullWrite } }, 'stock_manager') && !P.canViewCost({ cashier: { ...fullWrite } }, 'cashier'), 'Stock / Fournisseurs en MODIFICATION ne donnent plus le coût (magasinier, caissier)')
ok(!P.canViewCost({ cashier: { stock: true } }, 'cashier'), 'ancien « oui » Stock (droit hérité) du caissier : plus de coût')
ok(!P.canViewCost({ manager: { ...fullWrite, view_purchase_cost: false } }, 'manager'), 'manager en modification partout mais permission OFF : pas de coût')
ok(P.canViewCost({ manager: { stock: false, stock_write: false, suppliers: false } }, 'manager'), 'manager sans Stock ni Fournisseurs : coût selon la permission seule (défaut OUI)')
ok(P.canView({ general: { view_purchase_cost: false }, cashier: { view_purchase_cost: true } }, 'cashier', 'view_purchase_cost'), 'onglet « Général » : ne masque jamais ce droit (GENERAL_EXEMPT)')
ok(!P.canView({ general: { stock: false } }, 'manager', 'stock'), '« Général » : continue de masquer les autres fonctions')
ok(P.canViewCost({ viewer: { view_purchase_cost: true } }, 'viewer') && !P.canWrite({ viewer: { stock_write: true } }, 'viewer', 'stock'), 'Observateur : coût si attribué explicitement, toujours sans modification')

// ── 2. Les 3 accès humains conservés (181) et aucun autre changement ─────────
// Réglages relus en base le 25 oct. 2026 (lecture seule) ; null = aucun réglage enregistré
const SNAP = {
  'a0000000-0000-0000-0000-000000000001': { viewer: { stock: false, suppliers: false, stock_write: false, suppliers_write: false }, cashier: { stock: true, suppliers: false, stock_write: false, suppliers_write: false }, manager: { stock: true, suppliers: true, stock_write: true, suppliers_write: true }, shop_manager: { stock: true, suppliers: true, stock_write: true, suppliers_write: true }, stock_manager: { stock: true, suppliers: true, stock_write: true, suppliers_write: true }, general: { stock: true, suppliers: true } },
  '7313d74e-43dd-4b36-a59e-17ba370d29a1': null, 'ee61afdd-197e-4028-829d-22d4d62a259f': null,
  'abec3e3f-3e92-4ff0-a374-d2d88f57899b': null, 'f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0': null,
  'e665d4a0-da40-4436-a3b2-1b377760a47b': null, '0b0d0458-aa1d-417d-8db3-4d5d101034af': null,
  '0abb0ff4-f951-442e-8ed9-30ddd4aeac2a': { viewer: { stock: true, suppliers: true }, cashier: { stock: true, suppliers: true }, manager: { stock: true, suppliers: true }, shop_manager: { stock: true, suppliers: true }, stock_manager: { stock: true, suppliers: true } },
  'e54adfef-7b41-4c46-a3a4-d387d35d0a96': null,
  'bdf511df-a716-4c05-b1b2-0634d53e256c': { viewer: { stock: true, suppliers: true, stock_write: false, suppliers_write: false }, cashier: { stock: true, suppliers: false, stock_write: true, suppliers_write: false }, manager: { stock: true, suppliers: false, stock_write: true, suppliers_write: true }, shop_manager: { stock: true, suppliers: true, stock_write: true, suppliers_write: true }, stock_manager: { stock: true, suppliers: true, stock_write: true, suppliers_write: true }, general: { stock: true, suppliers: true } },
}
const MEMBERS = [ // [boutique, rôle] des membres actifs (hors propriétaires), relus le 25 oct.
  ['a0000000-0000-0000-0000-000000000001', 'cashier'], ['a0000000-0000-0000-0000-000000000001', 'manager'],
  ['7313d74e-43dd-4b36-a59e-17ba370d29a1', 'cashier'], ['7313d74e-43dd-4b36-a59e-17ba370d29a1', 'shop_manager'],
  ['ee61afdd-197e-4028-829d-22d4d62a259f', 'cashier'], ['ee61afdd-197e-4028-829d-22d4d62a259f', 'shop_manager'],
  ['abec3e3f-3e92-4ff0-a374-d2d88f57899b', 'stock_manager'], ['f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0', 'stock_manager'],
  ['e665d4a0-da40-4436-a3b2-1b377760a47b', 'cashier'], ['0b0d0458-aa1d-417d-8db3-4d5d101034af', 'cashier'],
  ['0abb0ff4-f951-442e-8ed9-30ddd4aeac2a', 'manager'],
  ['e54adfef-7b41-4c46-a3a4-d387d35d0a96', 'cashier'], ['e54adfef-7b41-4c46-a3a4-d387d35d0a96', 'manager'],
  ['bdf511df-a716-4c05-b1b2-0634d53e256c', 'cashier'], ['bdf511df-a716-4c05-b1b2-0634d53e256c', 'manager'], ['bdf511df-a716-4c05-b1b2-0634d53e256c', 'manager'],
]
const TARGETS = [['bdf511df-a716-4c05-b1b2-0634d53e256c', 'cashier'], ['abec3e3f-3e92-4ff0-a374-d2d88f57899b', 'stock_manager'], ['f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0', 'stock_manager']]
// Ancienne règle (avant le 25 oct.) : propriétaire OU Stock en modification OU Fournisseurs en modification
const oldRule = (rp, role) => P.resolvePermission(rp, role, 'stock').write || P.resolvePermission(rp, role, 'suppliers').write
const after181 = structuredClone(SNAP)
for (const [s, r] of TARGETS) after181[s] = { ...(after181[s] || {}), [r]: { ...((after181[s] || {})[r] || {}), view_purchase_cost: true } }
for (const [s, r] of TARGETS) ok(oldRule(SNAP[s], r) && !P.canViewCost(SNAP[s], r) && P.canViewCost(after181[s], r), `cible ${s.slice(0, 8)}… ${r} : avait le coût, l'aurait perdu sans la 181, le garde avec la 181`)
const diffs = MEMBERS.filter(([s, r]) => oldRule(SNAP[s], r) !== P.canViewCost(after181[s], r))
ok(diffs.length === 0, `les ${MEMBERS.length} membres actifs : accès au coût IDENTIQUE avant / après (181 + nouveau code)${diffs.length ? ' — écarts : ' + JSON.stringify(diffs) : ''}`)
const noMemberCashierShops = ['0abb0ff4-f951-442e-8ed9-30ddd4aeac2a']
ok(noMemberCashierShops.every(s => oldRule(SNAP[s], 'cashier') && !P.canViewCost(after181[s], 'cashier')), 'ancien droit du rôle Caissier SANS caissier inscrit : passe au nouveau défaut NON (voulu)')
// Ancien code + données de la 181 : la nouvelle clé est ignorée (compatibilité de l'ordre 181 → code)
ok(MEMBERS.every(([s, r]) => oldRule(after181[s], r) === oldRule(SNAP[s], r)), 'ancien code sur les données de la 181 : aucun changement (clé ignorée)')

// ── 3. Changement de permission « à chaud » : relu à CHAQUE requête ──────────
{
  let stored = { manager: { view_purchase_cost: true } }; let reads = 0
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { reads++; return { data: { role_permissions: stored } } } }) }) }) }
  const a = await RP.canViewCost(sb, 'manager', 'shop1')
  stored = { manager: { view_purchase_cost: false } }
  const b = await RP.canViewCost(sb, 'manager', 'shop1')
  stored = { manager: { view_purchase_cost: true } }
  const c = await RP.canViewCost(sb, 'manager', 'shop1')
  ok(a === true && b === false && c === true && reads === 3, 'manager connecté : retrait puis réactivation pris en compte à la requête suivante (réglage relu à chaque fois, aucun cache)')
  ok(await RP.canViewCost(sb, 'owner', 'shop1') === true, 'propriétaire : sans lecture de réglage, toujours oui')
}

// ── 4. Journal des réglages : changements réels seulement ────────────────────
ok(P.permissionChanges(null, null).length === 0 && P.permissionChanges(SNAP['bdf511df-a716-4c05-b1b2-0634d53e256c'], structuredClone(SNAP['bdf511df-a716-4c05-b1b2-0634d53e256c'])).length === 0, 'même réglage renvoyé : aucune entrée')
ok(P.permissionChanges(null, { manager: { view_purchase_cost: true } }).length === 0, 'valeur explicite égale au défaut : aucune entrée')
const ch = P.permissionChanges({ cashier: {} }, { cashier: { view_purchase_cost: true } })
ok(ch.length === 1 && ch[0].role === 'cashier' && ch[0].permission === 'view_purchase_cost' && ch[0].from === false && ch[0].to === true, 'caissier : coût activé → 1 entrée (rôle, permission, ancien, nouveau)')
ok(P.permissionChanges(null, { general: { view_purchase_cost: false } }).length === 0, '« Général » sur le coût : ignoré, aucune entrée')
ok(P.permissionChanges({ cashier: { stock: true } }, { cashier: { stock: true, stock_write: true } }).length === 0, 'ancien « oui » (modification héritée) rendu explicite : aucun changement réel')

// ── 5. Champs de coût ────────────────────────────────────────────────────────
const deep = { buying_price: 1, name: 'x', items: [{ price_from: 1, price_to: 2, q: 3 }], metadata: { changes: { buying_price: { from: 1, to: 2 }, name: { from: 'a', to: 'b' } } }, value_delta: 9 }
const om = CF.omitCost(deep)
ok(!('buying_price' in om) && !('value_delta' in om) && om.items[0].q === 3 && !('price_from' in om.items[0]) && !('buying_price' in om.metadata.changes) && om.metadata.changes.name.to === 'b' && deep.buying_price === 1,
   'omitCost : clés de coût ABSENTES à toute profondeur, le reste intact, original non modifié')
ok(CF.costVisible(deep, true) === deep, 'costVisible avec le droit : valeur inchangée')

// ── 6. Routes serveur (faux client, vraie règle) ─────────────────────────────
function fakeDb(handler) {
  const log = []
  const from = table => {
    const q = { table, op: null, filters: [], cols: null, payload: null }
    const run = () => { log.push(q); return Promise.resolve(handler(q) ?? { data: null, error: null }) }
    const b = {
      select(c) { if (!q.op) q.op = 'select'; q.cols = c ?? '*'; return b }, insert(p) { q.op = 'insert'; q.payload = p; return b },
      update(p) { q.op = 'update'; q.payload = p; return b }, upsert(p) { q.op = 'upsert'; q.payload = p; return b }, delete() { q.op = 'delete'; return b },
      eq(c, v) { q.filters.push(['eq', c, v]); return b }, in(c, v) { q.filters.push(['in', c, v]); return b }, is() { return b }, neq() { return b },
      gt() { return b }, gte() { return b }, lte() { return b }, not() { return b }, order() { return b }, range() { return b }, limit() { return b }, ilike() { return b },
      single() { q.term = 'single'; return run() }, maybeSingle() { q.term = 'maybeSingle'; return run() }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, rpc: async (fn, args) => { const q = { rpc: fn, args }; log.push(q); return handler(q) ?? { data: null, error: null } } }
}
const writes = (db, table) => db.log.filter(q => q.table === table && q.op && q.op !== 'select')
async function call(mod, method, body, { role, rp = null, handler = () => null, url = 'http://local/x' }) {
  const h = q => (q.table === 'shops' && q.op === 'select' ? { data: { role_permissions: rp } } : q.table === 'profiles' ? { data: { full_name: 'Testeur' } } : handler(q))
  const db = fakeDb(h)
  globalThis.__t = { admin: db, session: db, role, user: { id: 'u1', email: 't@example.invalid' }, audit: [] }
  const req = new Request(url, { method, body: body ? JSON.stringify(body) : undefined })
  const res = await mod[method](req)
  return { res, db, audit: globalThis.__t.audit }
}
const has = (o, k) => JSON.stringify(o).includes(`"${k}"`)

const products = await imp('app/api/products/route.ts')
const prodRow = q => ({ data: { id: 'p1', shop_id: 'shop1', name: 'Riz', selling_price: 100, quantity: q.payload?.quantity ?? 0, buying_price: q.payload?.buying_price ?? 0 } })
// POST
for (const [role, sees] of [['stock_manager', false], ['manager', true]]) {
  const r = await call(products, 'POST', { shop_id: 'shop1', name: 'Riz', selling_price: 100, buying_price: 500, quantity: 4 }, { role, handler: q => q.table === 'products' && q.op === 'insert' ? prodRow(q) : q.table === 'stock_movements' ? { data: { id: 'm1' } } : null })
  const ins = writes(r.db, 'products')[0], lot = writes(r.db, 'product_batches')[0]
  ok(r.res.status === 200 && (('buying_price' in ins.payload) === sees) && lot.payload.buying_price === (sees ? 500 : null) && has(r.res.body, 'buying_price') === sees,
     `POST /api/products ${role} ${sees ? 'avec' : 'SANS'} coût : prix ${sees ? 'écrit' : 'ignoré (produit et lot)'}, réponse ${sees ? 'avec' : 'SANS champ'} buying_price`)
}
// PATCH
{
  const handler = q => q.table === 'products' && q.op === 'update' ? { data: { id: 'p1', name: q.payload.name ?? 'Riz', buying_price: q.payload.buying_price ?? 400, selling_price: 100 } } : q.table === 'products' ? { data: { name: 'Riz', buying_price: 400, selling_price: 100 } } : null
  let r = await call(products, 'PATCH', { id: 'p1', shop_id: 'shop1', name: 'Riz 2', buying_price: 999 }, { role: 'stock_manager', handler })
  let up = writes(r.db, 'products')[0]
  ok(r.res.status === 200 && !('buying_price' in up.payload) && up.payload.name === 'Riz 2' && !has(r.res.body, 'buying_price') && !r.audit.some(a => has(a, 'buying_price') && a.metadata?.changes?.buying_price),
     'PATCH /api/products magasinier SANS coût : buying_price injecté ignoré, nom modifié, réponse sans coût')
  r = await call(products, 'PATCH', { id: 'p1', shop_id: 'shop1', buying_price: 999 }, { role: 'stock_manager', handler })
  ok(r.res.status === 400 && r.res.body.error === 'T:no_valid_fields' && writes(r.db, 'products').length === 0, 'PATCH buying_price seul SANS coût : refusé proprement (400), rien écrit')
  r = await call(products, 'PATCH', { id: 'p1', shop_id: 'shop1', buying_price: 999 }, { role: 'manager', handler })
  up = writes(r.db, 'products')[0]
  ok(r.res.status === 200 && up.payload.buying_price === 999 && r.res.body.data.buying_price === 999, 'PATCH manager AVEC coût : prix modifié et renvoyé')
  r = await call(products, 'PATCH', { id: 'p1', shop_id: 'shop1', is_favorite: true }, { role: 'cashier', rp: { cashier: { new_sale: true } }, handler })
  ok(r.res.status === 200 && !has(r.res.body, 'buying_price'), 'favori seul (caissier) : réponse réduite, sans coût')
}
// PUT réassort
for (const [role, sees] of [['stock_manager', false], ['manager', true]]) {
  const r = await call(products, 'PUT', { product_id: 'p1', shop_id: 'shop1', quantity_to_add: 10, buying_price: 600, supplier_id: 'sup1' }, { role, handler: q => q.table === 'suppliers' ? { data: { id: 'sup1', name: 'Fourn' } } : q.table === 'products' && q.op === 'select' ? { data: { name: 'Riz', quantity: 10, buying_price: 400, shop_id: 'shop1' } } : q.table === 'products' && q.op === 'update' ? { data: { id: 'p1' } } : null })
  const up = writes(r.db, 'products')[0], lot = writes(r.db, 'product_batches')[0], cmp = writes(r.db, 'product_supplier_prices')
  ok(r.res.status === 200 && ('buying_price' in up.payload) === sees && lot.payload.buying_price === (sees ? 600 : 400) && cmp.length === (sees ? 1 : 0) && !has(r.res.body, 'buying_price'),
     `PUT réassort ${role} ${sees ? 'avec' : 'SANS'} coût : ${sees ? 'prix pris (coût moyen + lot à 600)' : 'prix saisi ignoré, lot au coût DÉJÀ connu (400), coût produit inchangé'}`)
}
// Lots : promo, date
const promo = await imp('app/api/product-batches/promo/route.ts')
const expiry = await imp('app/api/product-batches/expiry/route.ts')
const lotRow = { id: 'b1', shop_id: 'shop1', product_id: 'p1', quantity: 5, buying_price: 300, promo_price: 80, expiry_date: '2027-01-01' }
for (const [role, sees] of [['stock_manager', false], ['manager', true]]) {
  let r = await call(promo, 'PATCH', { id: 'b1', shop_id: 'shop1', promo_price: 80, promo_until: '2027-01-01' }, { role, handler: q => q.table === 'product_batches' ? { data: q.op === 'update' ? lotRow : { promo_price: null, promo_until: null, product_id: 'p1' } } : q.table === 'products' ? { data: { name: 'Riz' } } : null })
  ok(r.res.status === 200 && has(r.res.body, 'buying_price') === sees && r.res.body.data.promo_price === 80, `PATCH promo lot ${role} : modifiable, coût ${sees ? 'présent' : 'ABSENT'}`)
  r = await call(expiry, 'PATCH', { id: 'b1', shop_id: 'shop1', expiry_date: '2027-01-01' }, { role, handler: q => q.table === 'product_batches' ? { data: q.op === 'update' ? lotRow : { expiry_date: null, product_id: 'p1' } } : q.table === 'products' ? { data: { name: 'Riz' } } : null })
  ok(r.res.status === 200 && has(r.res.body, 'buying_price') === sees && r.res.body.data.expiry_date === '2027-01-01', `PATCH date de lot ${role} : modifiable, coût ${sees ? 'présent' : 'ABSENT'}`)
}
// Journal Stock
const journal = await imp('app/api/audit/journal/route.ts')
const LOGS = [{ id: 'l1', action: 'update_product', metadata: { product_name: 'Riz', changes: { buying_price: { from: 400, to: 450 }, name: { from: 'R', to: 'Riz' } } } }, { id: 'l2', action: 'create_product', metadata: { product_name: 'Riz', buying_price: 400, selling_price: 100 } }]
for (const [role, sees] of [['stock_manager', false], ['manager', true]]) {
  const r = await call(journal, 'GET', null, { role, url: 'http://local/api/audit/journal?shop_id=shop1&feature=stock', handler: q => q.table === 'audit_logs' ? { data: structuredClone(LOGS), count: 2 } : null })
  const logs = r.res.body.logs || []
  ok(r.res.status === 200 && logs.length === 2 && has(logs, 'buying_price') === sees && logs[0].metadata.changes.name.to === 'Riz' && logs[1].metadata.selling_price === 100,
     `journal Stock ${role} : ${sees ? 'anciens / nouveaux prix d’achat visibles' : 'entrées conservées SANS prix d’achat'}`)
}
// Réception d'un bon
const receive = await imp('app/api/purchase-orders/receive/route.ts')
function recvHandler(p2cost) {
  return q => {
    if (q.table === 'purchase_orders' && q.op === 'select' && q.cols?.includes('balance')) return { data: { balance: 5000 } }
    if (q.table === 'purchase_orders' && q.op === 'select') return { data: { supplier_id: 'sup1', is_opening_balance: false } }
    if (q.table === 'purchase_order_items') return { data: [{ id: 'i1', product_id: 'p1', unit_price: 250 }, { id: 'i2', product_id: 'p2', unit_price: null }] }
    if (q.table === 'products' && q.op === 'select') return { data: [{ id: 'p2', buying_price: p2cost }] }
    if (q.rpc === 'apply_purchase_order_receipt') return { data: { items: [{ product_id: 'p1', product_name: 'Riz', previous_qty: 1, new_qty: 3, price_from: 200, price_to: 230 }] } }
    return null
  }
}
const RITEMS = [{ item_id: 'i1', product_id: 'p1', quantity_received: 2, unit_price: 999 }, { item_id: 'i2', product_id: 'p2', quantity_received: 1, unit_price: 999 }]
{
  let r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: RITEMS }, { role: 'stock_manager', rp: { stock_manager: { suppliers: true, suppliers_write: true } }, handler: recvHandler(0) })
  ok(r.res.status === 409 && r.res.body.code === 'purchase_order_price_required' && r.res.body.error === 'T:po_price_required' && !r.db.log.some(q => q.rpc),
     'réception SANS coût, ligne sans prix ni coût connu : 409 « une personne autorisée doit faire cette réception », rien reçu')
  r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: RITEMS, payment_full: true, payment_method: 'cash' }, { role: 'stock_manager', rp: { stock_manager: { suppliers: true, suppliers_write: true } }, handler: recvHandler(300) })
  const rpc = r.db.log.find(q => q.rpc === 'apply_purchase_order_receipt'), pay = writes(r.db, 'supplier_payments')[0]
  ok(r.res.status === 200 && rpc.args.p_items[0].unit_price === 250 && rpc.args.p_items[1].unit_price === null, 'réception SANS coût : prix de l’appareil (999) ignorés → prix DÉJÀ connus du bon (250) / coût du produit (ligne sans prix)')
  ok(pay && pay.payload.amount === 5000, '« Payé en totalité » sans coût : montant calculé par le serveur (solde du bon), jamais 0')
  ok(!has(r.res.body, 'price_from') && !has(r.res.body, 'price_to') && r.res.body.data.items[0].new_qty === 3, 'réponse de réception SANS coût : ni ancien ni nouveau prix d’achat')
  r = await call(receive, 'POST', { shop_id: 'shop1', purchase_order_id: 'po1', items: RITEMS }, { role: 'manager', handler: recvHandler(0) })
  const rpc2 = r.db.log.find(q => q.rpc === 'apply_purchase_order_receipt')
  ok(r.res.status === 200 && rpc2.args.p_items[0].unit_price === 999 && has(r.res.body, 'price_from'), 'réception AVEC coût : prix saisis pris en compte, ancien / nouveau prix renvoyés')
}
// Bons de commande : création et modification d'un brouillon
const po = await imp('app/api/purchase-orders/route.ts')
{
  const handler = q => q.table === 'purchase_orders' && q.op === 'insert' ? { data: { id: 'po1', reference: 'BC-1', total_amount: 0, balance: 0, amount_paid: 0 } } : q.table === 'purchase_orders' ? { count: 0 } : null
  let r = await call(po, 'POST', { shop_id: 'shop1', supplier_id: 'sup1', items: [{ product_id: 'p1', product_name: 'Riz', quantity_ordered: 3, unit_price: 250 }] }, { role: 'stock_manager', rp: { stock_manager: { suppliers: true, suppliers_write: true } }, handler })
  let items = writes(r.db, 'purchase_order_items')[0]
  ok(r.res.status === 200 && items.payload[0].unit_price === null && !has(r.res.body, 'unit_price') && !has(r.res.body, 'total_amount'), 'création d’un bon SANS coût : bon sans prix, réponse sans prix ni montants')
  r = await call(po, 'POST', { shop_id: 'shop1', supplier_id: 'sup1', items: [{ product_id: 'p1', product_name: 'Riz', quantity_ordered: 3, unit_price: 250 }] }, { role: 'manager', handler })
  items = writes(r.db, 'purchase_order_items')[0]
  ok(r.res.status === 200 && items.payload[0].unit_price === 250, 'création d’un bon AVEC coût : prix enregistré')
  const draft = q => q.table === 'purchase_orders' && q.op === 'select' ? { data: { status: 'draft', reference: 'BC-1', supplier_id: 'sup1', is_opening_balance: false } }
    : q.table === 'purchase_order_items' && q.op === 'select' ? { data: [{ product_id: 'p1', unit_price: 250 }] }
    : q.table === 'purchase_orders' && q.op === 'update' ? { data: { id: 'po1', total_amount: 750, balance: 750 } } : null
  r = await call(po, 'PATCH', { id: 'po1', shop_id: 'shop1', items: [{ product_id: 'p1', product_name: 'Riz', quantity_ordered: 5 }, { product_id: 'p3', product_name: 'Sel', quantity_ordered: 1, unit_price: 7 }] }, { role: 'stock_manager', rp: { stock_manager: { suppliers: true, suppliers_write: true } }, handler: draft })
  items = writes(r.db, 'purchase_order_items').find(q => q.op === 'insert')
  ok(r.res.status === 200 && items.payload[0].unit_price === 250 && items.payload[0].quantity_ordered === 5 && items.payload[1].unit_price === null && !has(r.res.body, 'total_amount'),
     'modification d’un brouillon SANS coût : prix déjà posés CONSERVÉS (250), nouvelle ligne sans prix, réponse sans montants')
}
// Réglages des rôles : journal des changements réels
const perms = await imp('app/api/team/permissions/route.ts')
{
  const run = async (role, before, after) => {
    const db = fakeDb(q => q.table === 'shops' && q.op === 'select' ? { data: { role_permissions: before } } : q.table === 'profiles' ? { data: { full_name: 'Proprio' } } : null)
    db.auth = { getUser: async () => ({ data: { user: { id: 'own1', email: 'o@example.invalid' } } }) }
    globalThis.__t = { admin: db, session: db, role, user: { id: 'own1' }, audit: [] }
    const res = await perms.PATCH(new Request('http://local/x', { method: 'PATCH', body: JSON.stringify({ shop_id: 'shop1', role_permissions: after }) }))
    return { res, db, audit: globalThis.__t.audit }
  }
  let r = await run('owner', { cashier: {} }, { cashier: { view_purchase_cost: true } })
  const e = r.audit[0]
  ok(r.res.status === 200 && r.audit.length === 1 && e.action === 'permissions.update' && e.shop_id === 'shop1' && e.actor_id === 'own1' && e.metadata.role === 'cashier' && e.metadata.permission === 'view_purchase_cost' && e.metadata.from === false && e.metadata.to === true,
     'propriétaire active le coût du Caissier : 1 entrée permissions.update (auteur, boutique, rôle, permission, ancien, nouveau)')
  r = await run('owner', SNAP['bdf511df-a716-4c05-b1b2-0634d53e256c'], structuredClone(SNAP['bdf511df-a716-4c05-b1b2-0634d53e256c']))
  ok(r.res.status === 200 && r.audit.length === 0 && writes(r.db, 'shops').length === 1, 'mêmes valeurs renvoyées : enregistré, AUCUNE entrée de journal')
  r = await run('manager', null, { manager: { view_purchase_cost: true } })
  ok(r.res.status === 403 && writes(r.db, 'shops').length === 0 && r.audit.length === 0, 'un manager ne peut pas s’attribuer le coût (403, rien écrit)')
}

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
