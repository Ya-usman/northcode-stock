// Lot 2B, étape B1 — routes serveur qui reprennent les lectures directes du navigateur (tableau de bord, Boutiques,
// onglet Caisse de la fiche boutique, ventes en promotion, nombre de ventes avant fusion, ventes 30 j pour Catégories).
// Test PUR : faux clients de base ; les RÈGLES (lib/permissions, shop-access, role-permissions) sont les vraies.
// Usage : node tests/e2e/b1-routes-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.admin; export const createClient = async () => globalThis.__t.session`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: globalThis.__t.user, supabase: globalThis.__t.session }); export const checkShopRole = async (_s, _u, shop) => globalThis.__t.roles[shop] ?? null`,
  '@/lib/api/audit': `export const writeAuditLog = async () => {}; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k) => 'T:' + k`,
  '@/lib/rate-limit': `export const checkRateLimit = async () => null`,
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
  // Imports relatifs sans extension dans les modules TypeScript (« ./batch-status »)
  if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:') && !/.[cm]?[jt]s$/.test(spec)) {
    const u = new URL(spec + '.ts', ctx.parentURL); if (existsSync(fileURLToPath(u))) return next(u.href, ctx)
  }
  return next(spec, ctx)
}
export async function load(url, ctx, next) {
  if (url.startsWith('mock:')) return { format: 'module', source: MOCKS[url.slice(5)], shortCircuit: true }
  return next(url, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hooks))
const imp = p => import(new URL(p, ROOT).href)

const A = 'a0000000-0000-0000-0000-00000000000a', B = 'a0000000-0000-0000-0000-00000000000b'
const P1 = 'b0000000-0000-0000-0000-000000000001', C1 = 'c0000000-0000-0000-0000-000000000001', C2 = 'c0000000-0000-0000-0000-000000000002'
const U = 'u0000000-0000-0000-0000-000000000001'

// Faux client : chaque requête est notée (table, colonnes, filtres) ; `handler` fournit la réponse
function fakeDb(handler) {
  const log = []
  const from = table => {
    const q = { table, cols: null, filters: [], head: false }
    const run = () => { log.push(q); return Promise.resolve(handler(q) ?? { data: [], error: null }) }
    const f = op => (c, v) => { q.filters.push([op, c, v]); return b }
    const b = {
      select(c, o) { q.cols = c; q.head = !!o?.head; return b },
      eq: f('eq'), in: f('in'), is: f('is'), neq: f('neq'), gt: f('gt'), gte: f('gte'), lte: f('lte'), not: f('not'),
      order() { return b }, range() { return b }, limit() { return b },
      single() { return run() }, maybeSingle() { return run() }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, auth: { getUser: async () => ({ data: { user: globalThis.__t.user } }) } }
}
const has = (q, op, col, val) => q.filters.some(([o, c, v]) => o === op && c === col && (val === undefined || JSON.stringify(v) === JSON.stringify(val)))

// members : { [shop]: role } ; rp : { [shop]: role_permissions } ; data : (q) => réponse de la base « serveur »
async function call(path, url, { members = {}, rp = {}, data = () => null, user = { id: U } } = {}) {
  const session = fakeDb(q => {
    if (q.table === 'shop_members') {
      const shops = (q.filters.find(([o, c]) => o === 'in' && c === 'shop_id')?.[2]) || [q.filters.find(([o, c]) => o === 'eq' && c === 'shop_id')?.[2]]
      const rows = Object.entries(members).filter(([s]) => shops.includes(s)).map(([shop_id, role]) => ({ shop_id, role }))
      return q.filters.some(([o, c]) => o === 'eq' && c === 'shop_id') ? { data: rows[0] ?? null } : { data: rows }
    }
    if (q.table === 'shops') {
      const ids = q.filters.find(([o, c]) => o === 'in' && c === 'id')?.[2]
      if (ids) return { data: ids.map(id => ({ id, role_permissions: rp[id] ?? null })) }
      const id = q.filters.find(([o, c]) => o === 'eq' && c === 'id')?.[2]
      return { data: { role_permissions: rp[id] ?? null } }
    }
    return null
  })
  const admin = fakeDb(q => data(q))
  globalThis.__t = { session, admin, user, roles: members }
  const mod = await imp(path)
  const res = await mod.GET(new Request(url))
  return { res, admin }
}
const sel = (admin, table, pred = () => true) => admin.log.filter(q => q.table === table && pred(q))

// ── 1. /api/dashboard/live ───────────────────────────────────────────────────
const LIVE = 'app/api/dashboard/live/route.ts'
const live = shops => `http://l/api/dashboard/live?shop_ids=${shops.join(',')}&day_start=2026-10-26T00:00:00Z&day_end=2026-10-26T23:59:59Z&week_start=2026-10-20T00:00:00Z`
const salesData = q => q.table === 'sales'
  ? { data: q.cols.includes('sale_items') ? [{ id: 'w1', created_at: '2026-10-21T10:00:00Z', shop_id: A }] : [{ id: 's1', created_at: '2026-10-26T09:00:00Z', shop_id: A }, { id: 's2', created_at: '2026-10-26T11:00:00Z', shop_id: A }] }
  : q.table === 'customers' ? { data: [{ total_debt: 1500 }, { total_debt: '500' }] } : null
{
  let r = await call(LIVE, live([A]), { user: null }); ok(r.res.status === 401, 'tableau de bord : non connecté → 401')
  r = await call(LIVE, 'http://l/api/dashboard/live?shop_ids=x', { members: { [A]: 'owner' } }); ok(r.res.status === 400, 'paramètres invalides → 400')
  r = await call(LIVE, live([A, B]), { members: { [A]: 'owner' } }); ok(r.res.status === 403 && r.admin.log.length === 0, 'boutique non membre dans la demande → 403, rien lu')

  r = await call(LIVE, live([A]), { members: { [A]: 'owner' }, data: salesData })
  const today = sel(r.admin, 'sales', q => !q.cols.includes('sale_items')), week = sel(r.admin, 'sales', q => q.cols.includes('sale_items'))
  ok(r.res.status === 200 && r.res.body.today_sales.map(s => s.id).join() === 's2,s1' && r.res.body.week_sales.length === 1 && r.res.body.outstanding_debt === 2000,
     `propriétaire : ventes du jour (plus récentes d'abord), semaine, dette 2000 (${JSON.stringify(r.res.body.outstanding_debt)})`)
  ok(today.length === 1 && week.length === 1 && !today.concat(week).some(q => has(q, 'eq', 'cashier_id')) && today.every(q => has(q, 'eq', 'sale_status', 'active')),
     'propriétaire : toute la boutique (aucun filtre vendeur), ventes actives seulement')
  ok(sel(r.admin, 'customers').every(q => has(q, 'is', 'deleted_at', null)), 'dette : fiches clients non supprimées seulement (comme la base)')

  for (const role of ['cashier', 'stock_manager']) {
    r = await call(LIVE, live([A]), { members: { [A]: role }, data: salesData })
    // (magasinier : widgets de la semaine masqués par défaut → une seule lecture, celle du jour)
    const qs = sel(r.admin, 'sales')
    ok(qs.length === (role === 'cashier' ? 2 : 1) && qs.every(q => has(q, 'eq', 'cashier_id', U)), `${role} : ventes lues (${qs.length}) limitées à SES ventes (comme la base)`)
  }
  r = await call(LIVE, live([A]), { members: { [A]: 'viewer' }, data: salesData })
  ok(r.res.body.outstanding_debt === null && sel(r.admin, 'customers').length === 0 && !sel(r.admin, 'sales').some(q => has(q, 'eq', 'cashier_id')),
     'observateur : dette non envoyée (widget masqué par défaut), ventes de toute la boutique')
  r = await call(LIVE, live([A]), { members: { [A]: 'cashier' }, rp: { [A]: { cashier: { widget_today_revenue: false, widget_sales_count: false, widget_recent_sales: false } } }, data: salesData })
  ok(r.res.body.today_sales === null && sel(r.admin, 'sales', q => !q.cols.includes('sale_items')).length === 0 && Array.isArray(r.res.body.week_sales),
     'widgets du jour masqués : ventes du jour NI lues NI envoyées (null) ; semaine toujours là')
  r = await call(LIVE, live([A, B]), { members: { [A]: 'owner', [B]: 'cashier' }, data: salesData })
  const t2 = sel(r.admin, 'sales', q => !q.cols.includes('sale_items'))
  ok(t2.length === 2 && t2.some(q => has(q, 'in', 'shop_id', [A]) && !has(q, 'eq', 'cashier_id')) && t2.some(q => has(q, 'in', 'shop_id', [B]) && has(q, 'eq', 'cashier_id', U)),
     'deux boutiques, deux rôles : A toute la boutique, B seulement ses ventes — décidé boutique par boutique')
}

// ── 2. /api/shops/stats ─────────────────────────────────────────────────────
const STATS = 'app/api/shops/stats/route.ts'
const stats = shops => `http://l/api/shops/stats?shop_ids=${shops.join(',')}&day_start=2026-10-26T00:00:00Z`
const statsData = q => q.table === 'sales' ? { data: [{ shop_id: A, total: 100, created_at: '2026-10-26T08:00:00Z' }, { shop_id: A, total: 40, created_at: '2026-10-10T08:00:00Z' }] }
  : q.table === 'payments' ? { data: [{ amount: 70, sales: { shop_id: A, sale_status: 'active' } }, { amount: 999, sales: { shop_id: A, sale_status: 'cancelled' } }] }
  : q.table === 'products' ? { data: [{ shop_id: A, quantity: 0, low_stock_threshold: null, buying_price: 5 }, { shop_id: A, quantity: 3, low_stock_threshold: 5, buying_price: 10 }, { shop_id: A, quantity: 50, low_stock_threshold: null, buying_price: 2 }] }
  : q.table === 'shops' ? { data: [{ id: A, low_stock_threshold: 10 }] } : null
{
  let r = await call(STATS, stats([A]), { members: { [A]: 'manager' }, data: statsData })
  const st = r.res.body.stats?.[A]
  ok(st && st.cashToday === 70 && st.salesTodayCount === 1 && st.salesToday === 100 && st.sales30 === 140, `manager : encaissé 70 (paiement d'une vente annulée exclu), ventes du jour 1 / 100, 30 jours 140 (${JSON.stringify(st)})`)
  ok(st && st.products === 3 && st.out === 1 && st.low === 1 && st.stockValue === 130, `manager : 3 produits, 1 rupture, 1 stock bas (seuil produit), valeur 130 au coût (droit coût par défaut)`)
  ok(!sel(r.admin, 'sales').some(q => has(q, 'eq', 'cashier_id')), 'manager : ventes de toute la boutique')
  r = await call(STATS, stats([A]), { members: { [A]: 'manager' }, rp: { [A]: { manager: { sales_history: false, caisse: false, stock: false } } }, data: statsData })
  const st2 = r.res.body.stats?.[A]
  ok(st2 && st2.cashToday === null && st2.sales30 === null && st2.products === null && st2.stockValue === null && r.admin.log.length === 0,
     'sans Historique ni Contrôle de caisse ni Stock : tous les repères à null (« — »), RIEN lu')
  r = await call(STATS, stats([A]), { members: { [A]: 'manager' }, rp: { [A]: { manager: { sales_history: false, caisse: true, view_purchase_cost: false } } }, data: statsData })
  const st3 = r.res.body.stats?.[A]
  ok(st3 && st3.cashToday === 70 && st3.products === 3 && st3.stockValue === null, 'Contrôle de caisse suffit pour les ventes ; sans droit aux coûts : valeur du stock null')
  r = await call(STATS, stats([A]), { members: { [A]: 'cashier' }, rp: { [A]: { cashier: { stock: true } } }, data: statsData })
  ok(sel(r.admin, 'sales').every(q => has(q, 'eq', 'cashier_id', U)) && sel(r.admin, 'payments').every(q => has(q, 'eq', 'sales.cashier_id', U)),
     'caissier : ventes et encaissements limités aux siens (comme la base)')
  r = await call(STATS, stats([A, B]), { members: { [A]: 'manager' }, data: statsData })
  ok(r.res.status === 200 && !(B in r.res.body.stats), 'boutique sans adhésion : absente de la réponse')
}

// ── 3. /api/shops/cash ──────────────────────────────────────────────────────
const CASH = 'app/api/shops/cash/route.ts'
const cash = (shop, review) => `http://l/api/shops/cash?shop_id=${shop}&day_start=2026-10-26T00:00:00Z${review ? '&review=1' : ''}`
const cashData = q => q.table === 'payments' ? { data: [
    { amount: 100, method: 'cash', is_repayment: false, received_by: 'x', sales: { shop_id: A, sale_status: 'active', cashier_id: 'v1' } },
    { amount: 30, method: 'mobile', is_repayment: true, received_by: 'v2', sales: { shop_id: A, sale_status: 'active', cashier_id: 'v1' } },
    { amount: 500, method: 'cash', is_repayment: false, received_by: 'x', sales: { shop_id: A, sale_status: 'cancelled', cashier_id: 'v1' } }] }
  : q.table === 'sales' && q.head ? { count: 4 }
  : q.table === 'sales' ? { data: [{ id: 's9', sale_number: 'V-9', created_at: '2026-10-26T08:00:00Z', review_reason: 'offline,price' }], count: 3 }
  : q.table === 'profiles' ? { data: [{ id: 'v1', full_name: 'Vendeur 1' }, { id: 'v2', full_name: 'Vendeur 2' }] } : null
{
  let r = await call(CASH, cash(A, true), { members: { [A]: 'manager' }, data: cashData })
  const d = r.res.body
  ok(d.today && d.today.total === 130 && d.today.repayments === 30 && d.today.salesCount === 4, `encaissé 130 dont 30 de remboursements, vente annulée exclue, 4 ventes du jour (${JSON.stringify(d.today && { t: d.today.total, r: d.today.repayments })})`)
  ok(d.today?.byPerson?.map(p => `${p.name}:${p.amount}`).join() === 'Vendeur 1:100,Vendeur 2:30' && d.today?.byMethod?.map(m => m.method).join() === 'cash,mobile',
     'par personne : la vente au vendeur, le remboursement à qui l’a reçu ; par moyen de paiement')
  ok(d.review?.count === 3 && d.review.list[0].reasons.join() === 'offline,price', 'ventes à vérifier : nombre + raisons')
  r = await call(CASH, cash(A, true), { members: { [A]: 'manager' }, rp: { [A]: { manager: { caisse: false, payments: false, sales_history: false } } }, data: cashData })
  ok(r.res.body.today === null && r.res.body.review === null && r.admin.log.length === 0, 'sans aucun des droits de l’onglet : rien lu, rien envoyé')
  r = await call(CASH, cash(A, true), { members: { [A]: 'manager' }, rp: { [A]: { manager: { sales_history: false } } }, data: cashData })
  ok(r.res.body.today && r.res.body.review === null, 'sans Historique : encaissé oui, ventes à vérifier NON')
  r = await call(CASH, cash(A, false), { members: { [A]: 'manager' }, data: cashData })
  ok(r.res.body.review === null, 'ventes à vérifier non demandées : non lues')
  r = await call(CASH, cash(B, true), { members: { [A]: 'manager' }, data: cashData })
  ok(r.res.status === 403, 'boutique non membre → 403')
}

// ── 4. /api/stock/promo-sales ───────────────────────────────────────────────
const PROMO = 'app/api/stock/promo-sales/route.ts'
const promo = `http://l/api/stock/promo-sales?shop_id=${A}&product_id=${P1}&from=2026-10-01T00:00:00Z&until=2026-10-10T00:00:00Z`
{
  let r = await call(PROMO, promo, { members: { [A]: 'stock_manager' }, data: q => q.table === 'sale_items' ? { data: [{ quantity: 2 }, { quantity: 5 }] } : null })
  const q = sel(r.admin, 'sale_items')[0]
  ok(r.res.body.quantity === 7 && has(q, 'eq', 'sales.shop_id', A) && has(q, 'eq', 'product_id', P1) && !has(q, 'eq', 'sales.cashier_id'),
     'magasinier avec Stock : 7 vendus pendant la promo, TOUTES les ventes de la boutique (avant : seulement les siennes)')
  r = await call(PROMO, promo, { members: { [A]: 'cashier' } })
  ok(r.res.status === 403 && r.admin.log.length === 0, 'caissier sans Stock → 403, rien lu')
}

// ── 5. GET /api/customers/merge (nombre de ventes avant fusion) ──────────────
const MERGE = 'app/api/customers/merge/route.ts'
const merge = `http://l/api/customers/merge?shop_id=${A}&ids=${C1},${C2}`
{
  let r = await call(MERGE, merge, { members: { [A]: 'manager' }, data: q => q.table === 'sales' ? { count: has(q, 'eq', 'customer_id', C1) ? 3 : 0 } : null })
  ok(r.res.body.counts?.[C1] === 3 && r.res.body.counts?.[C2] === 0 && sel(r.admin, 'sales').every(q => has(q, 'eq', 'shop_id', A)), 'manager : 3 ventes / 0 vente, comptées dans la boutique')
  r = await call(MERGE, merge, { members: { [A]: 'cashier' } })
  ok(r.res.status === 403 && r.admin.log.length === 0, 'caissier → 403 (même droit que la fusion)')
  r = await call(MERGE, `http://l/api/customers/merge?shop_id=${A}&ids=pas-un-id`, { members: { [A]: 'manager' } })
  ok(r.res.status === 400, 'identifiant invalide → 400')
}

// ── 6. /api/stock/sold-30d : ouverte aussi au droit Catégories ───────────────
const SOLD = 'app/api/stock/sold-30d/route.ts'
{
  const soldData = q => q.table === 'sale_items' ? { data: [{ product_id: P1, quantity: 4 }] } : null
  let r = await call(SOLD, `http://l/api/stock/sold-30d?shop_ids=${A}`, { members: { [A]: 'stock_manager' }, rp: { [A]: { stock_manager: { stock: false, categories: true } } }, data: soldData })
  ok(r.res.status === 200 && r.res.body.byProduct?.[P1] === 4, 'Catégories sans Stock : ventes 30 j servies')
  r = await call(SOLD, `http://l/api/stock/sold-30d?shop_ids=${A}`, { members: { [A]: 'cashier' }, data: soldData })
  ok(r.res.status === 403, 'ni Stock ni Catégories → 403')
}

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
