// Sécurité des notifications (29 oct. 2026) — routes /api/push/* et envois serveur (sendShopPush, sendUsersPush).
// Test PUR : fausse base en mémoire, faux envoi web-push (on note les appareils visés) ; les VRAIS réglages de droits
// (lib/permissions) décident qui reçoit. Usage : node tests/e2e/push-security-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
process.env.VAPID_MAILTO = 'mailto:test@x'; process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'

const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  'web-push': `export default { setVapidDetails() {}, sendNotification: async (sub, payload) => { globalThis.__t.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }) } }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.db; export const createClient = async () => ({ ...globalThis.__t.db, auth: { getUser: async () => ({ data: { user: globalThis.__t.uid ? { id: globalThis.__t.uid } : null } }) } })`,
  '@/lib/api/shop-auth': `export const checkShopRole = async (_s, uid, shop) => { const t = globalThis.__t; if (shop !== t.shopId) return null; if (uid === t.ownerId) return 'owner'; return (t.tables.shop_members.find(m => m.user_id === uid && m.shop_id === shop && m.is_active) || {}).role ?? null }`,
  '@/lib/api/role-permissions': `import { resolvePermission } from '@/lib/permissions'; export const canWriteFeature = async (_s, role, _shop, f) => !!role && resolvePermission(globalThis.__t.rp, role, f).write; export const canViewFeature = async (_s, role, _shop, f) => !!role && resolvePermission(globalThis.__t.rp, role, f).view`,
  '@/lib/api/i18n': `export const getApiTranslator = () => k => 'T:' + k; export const getLocaleTranslator = () => k => k`,
}
const hooks = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const MOCKS = ${JSON.stringify(MOCKS)}; const ROOT = ${JSON.stringify(ROOT.href)};
export async function resolve(spec, ctx, next) {
  if (spec in MOCKS) return { url: 'mock:' + spec, shortCircuit: true }
  if (spec.startsWith('@/')) for (const cand of [spec.slice(2) + '.ts', spec.slice(2) + '/index.ts']) {
    const u = new URL(cand, ROOT); if (existsSync(fileURLToPath(u))) return next(u.href, { ...ctx, parentURL: ROOT })
  }
  if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:') && !/\\.[cm]?[jt]s$/.test(spec)) {
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

// ── Fausse base : tables en mémoire, filtres eq / neq / in / lte, écritures notées ──────────────────────────────────
const SHOP = '3f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f', OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const OWNER = 'owner', MGR = 'mgr', CASH = 'cash', CASH2 = 'cash2', STOCK = 'stockm', VIEW = 'viewer', GONE = 'gone', STRANGER = 'stranger'
function fakeDb(t) {
  const writes = []
  const from = table => {
    const q = { filters: [], op: 'select', payload: null }
    const rows = () => (t.tables[table] || []).filter(r => q.filters.every(([op, c, v]) =>
      op === 'eq' ? r[c] === v : op === 'neq' ? r[c] !== v : op === 'in' ? v.includes(r[c]) : op === 'lte' ? r[c] <= v : true))
    const run = () => {
      if (q.op !== 'select') { writes.push({ table, op: q.op, payload: q.payload, filters: q.filters }); return Promise.resolve({ data: null, error: null }) }
      return Promise.resolve({ data: rows(), error: null })
    }
    const f = op => (c, v) => { q.filters.push([op, c, v]); return b }
    const b = {
      select() { return b }, eq: f('eq'), neq: f('neq'), in: f('in'), lte: f('lte'), order() { return b }, limit() { return b },
      upsert(p) { q.op = 'upsert'; q.payload = p; return b }, delete() { q.op = 'delete'; return b }, insert(p) { q.op = 'insert'; q.payload = p; return b },
      single() { return run().then(r => ({ ...r, data: r.data?.[0] ?? null })) }, maybeSingle() { return run().then(r => ({ ...r, data: r.data?.[0] ?? null })) },
      then(res, rej) { return run().then(res, rej) },
    }
    return b
  }
  return { from, writes }
}
const sub = (user_id, shop_id = SHOP) => ({ user_id, shop_id, endpoint: `https://push/${user_id}@${shop_id.slice(0, 4)}`, p256dh: 'k', auth: 'a' })
function setup(uid, rp = null) {
  const t = {
    uid, shopId: SHOP, ownerId: OWNER, rp, sent: [],
    tables: {
      shops: [{ id: SHOP, name: 'Boutique Test', currency: 'XAF', owner_id: OWNER, role_permissions: rp, low_stock_threshold: 10,
        notify_push_new_sale: true, notify_push_low_stock: true, notify_push_new_expense: true }],
      shop_members: [
        { shop_id: SHOP, user_id: OWNER, role: 'owner', is_active: true }, { shop_id: SHOP, user_id: MGR, role: 'manager', is_active: true },
        { shop_id: SHOP, user_id: CASH, role: 'cashier', is_active: true }, { shop_id: SHOP, user_id: CASH2, role: 'cashier', is_active: true },
        { shop_id: SHOP, user_id: STOCK, role: 'stock_manager', is_active: true }, { shop_id: SHOP, user_id: VIEW, role: 'viewer', is_active: true },
        { shop_id: SHOP, user_id: GONE, role: 'manager', is_active: false },
      ],
      // Tout le monde est abonné à la boutique, y compris le membre retiré et un étranger (abonnement d'avant le correctif)
      push_subscriptions: [OWNER, MGR, CASH, CASH2, STOCK, VIEW, GONE, STRANGER].map(u => sub(u)),
      products: [{ id: 'p1', shop_id: SHOP, name: 'Riz', quantity: 0, low_stock_threshold: null, is_active: true }],
      profiles: [],
    },
  }
  t.db = fakeDb(t); globalThis.__t = t; return t
}
const call = (mod, method, body) => mod[method](new Request('http://l/x', { method, body: JSON.stringify(body) }))
const who = t => t.sent.map(s => s.endpoint.replace(/^https:\/\/push\/|@.*$/g, '')).sort().join(',')

const SUB = await imp('app/api/push/subscribe/route.ts')
const SALE = await imp('app/api/push/sale/route.ts')
const LOW = await imp('app/api/push/low-stock/route.ts')
const EXP = await imp('app/api/push/new-expense/route.ts')
const REC = await imp('app/api/push/recurring-expense/route.ts')
const TEST = await imp('app/api/push/test/route.ts')
const PS = await imp('lib/api/push-server.ts')
const device = { endpoint: 'https://push/nouveau', keys: { p256dh: 'k', auth: 'a' } }

// ── 1. S'abonner ─────────────────────────────────────────────────────────────
let t = setup(STRANGER)
let r = await call(SUB, 'POST', { subscription: device, shop_id: SHOP })
ok(r.status === 403 && !t.db.writes.length, 'étranger : abonnement aux notifications d’une boutique dont il n’est pas membre REFUSÉ (403), rien d’écrit')
t = setup(GONE)
r = await call(SUB, 'POST', { subscription: device, shop_id: SHOP })
ok(r.status === 403 && !t.db.writes.length, 'membre retiré : abonnement refusé (403)')
t = setup(CASH)
r = await call(SUB, 'POST', { subscription: device, shop_id: SHOP })
ok(r.status === 200 && t.db.writes[0]?.op === 'upsert' && t.db.writes[0].payload.user_id === CASH && t.db.writes[0].payload.shop_id === SHOP, 'caissier membre : abonnement enregistré pour lui-même')
t = setup(CASH)
r = await call(SUB, 'POST', { subscription: device, shop_id: 'pas-un-identifiant' })
ok(r.status === 400 && !t.db.writes.length, 'identifiant de boutique invalide : 400')
t = setup(null)
r = await call(SUB, 'POST', { subscription: device, shop_id: SHOP })
ok(r.status === 401, 'sans session : 401')

// ── 2. Vente ─────────────────────────────────────────────────────────────────
t = setup(STRANGER)
r = await call(SALE, 'POST', { shop_id: SHOP, total: 999999, cashier_name: 'Faux', payment_label: 'cash' })
ok(r.status === 403 && t.sent.length === 0, 'étranger : ne peut PLUS envoyer une fausse notification de vente au propriétaire (403, rien envoyé)')
t = setup(VIEW)
r = await call(SALE, 'POST', { shop_id: SHOP, total: 10, payment_label: 'cash' })
ok(r.status === 403 && t.sent.length === 0, 'observateur (ne vend pas) : envoi refusé')
t = setup(CASH)
r = await call(SALE, 'POST', { shop_id: SHOP, total: 1500, cashier_name: 'Fatou', payment_label: 'Espèces' })
ok(r.status === 200 && who(t) === [OWNER, MGR, VIEW].sort().join(','), `vente d’une caissière : propriétaire, manager et observateur prévenus ; pas l’autre caissière, ni le magasinier, ni le membre retiré, ni l’étranger, ni elle-même → ${who(t)}`)
t = setup(CASH, { viewer: { sales_history: false } })
await call(SALE, 'POST', { shop_id: SHOP, total: 1500, payment_label: 'Espèces' })
ok(who(t) === [OWNER, MGR].sort().join(','), `historique des ventes masqué pour l’observateur : il n’est plus prévenu → ${who(t)}`)

// ── 3. Stock bas ─────────────────────────────────────────────────────────────
t = setup(STRANGER)
r = await call(LOW, 'POST', { shop_id: SHOP })
ok(r.status === 403 && t.sent.length === 0, 'étranger : alerte de stock refusée')
t = setup(CASH)
r = await call(LOW, 'POST', { shop_id: SHOP })
ok(r.status === 200 && who(t) === [OWNER, MGR, STOCK, VIEW].sort().join(','), `stock bas : membres qui voient le stock (propriétaire, manager, magasinier, observateur), pas les caissiers → ${who(t)}`)

// ── 4. Nouvelle dépense ──────────────────────────────────────────────────────
t = setup(CASH)
r = await call(EXP, 'POST', { shop_id: SHOP, description: 'Faux', amount_str: '1 F' })
ok(r.status === 403 && t.sent.length === 0, 'caissier (pas le droit de saisir des dépenses) : envoi refusé')
t = setup(MGR)
r = await call(EXP, 'POST', { shop_id: SHOP, description: 'Transport', amount_str: '2 000 F' })
ok(r.status === 200 && who(t) === OWNER, `nouvelle dépense saisie par le manager : propriétaire SEUL prévenu → ${who(t)}`)
t = setup(MGR); t.tables.push_subscriptions = t.tables.push_subscriptions.filter(s => s.user_id !== OWNER)
r = await call(EXP, 'POST', { shop_id: SHOP, description: 'Transport', amount_str: '2 000 F' })
ok(r.status === 200 && t.sent.length === 0, 'propriétaire sans appareil abonné : PERSONNE d’autre n’est prévenu (ancien repli « tous les abonnés » retiré)')

// ── 5. Dépenses récurrentes ──────────────────────────────────────────────────
t = setup(STRANGER)
r = await call(REC, 'POST', { shop_id: SHOP, count: 2 })
ok(r.status === 403 && t.sent.length === 0, 'étranger : notification de dépenses récurrentes refusée')
t = setup(CASH)
r = await call(REC, 'POST', { shop_id: SHOP, count: 2, amount_str: '5 000 F' })
ok(r.status === 200 && who(t) === [OWNER, MGR].sort().join(','), `dépenses récurrentes : propriétaire et manager (droit « Dépenses »), pas caissiers / magasinier / observateur → ${who(t)}`)
t = setup(null)
await PS.sendShopPush(t.db, SHOP, { title: 'x' }, 'expenses')
ok(who(t) === [OWNER, MGR].sort().join(','), `envoi serveur (dépenses récurrentes générées) : mêmes destinataires → ${who(t)}`)
t = setup(null)
await PS.sendShopPush(t.db, SHOP, { title: 'x' })
ok(!who(t).split(',').includes(GONE) && !who(t).split(',').includes(STRANGER), `envoi serveur sans droit précis : membres actuels seulement (ni retiré, ni étranger) → ${who(t)}`)

// ── 6. Envoi ciblé (demandes de prolongation) et test ─────────────────────────
t = setup(null)
await PS.sendUsersPush(t.db, SHOP, [OWNER, GONE, STRANGER], { title: 'x' })
ok(who(t) === OWNER, `envoi ciblé : une personne qui n’est plus membre est écartée → ${who(t)}`)
t = setup(STRANGER)
r = await call(TEST, 'POST', { shop_id: SHOP })
ok(r.status === 403 && t.sent.length === 0, 'test des notifications : étranger refusé')
t = setup(CASH)
r = await call(TEST, 'POST', { shop_id: SHOP })
ok(r.status === 200 && who(t) === CASH, 'test des notifications : membre, ses propres appareils seulement')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
