// Horaires de boutique côté SERVEUR (lot A, 29 oct. 2026) — contrôle commun canWriteFeature, refus explicite
// « boutique fermée » (encaissement, paiements, équipe), dépenses récurrentes silencieuses, synchronisation hors ligne
// jamais refusée mais marquée « hors horaires ». Boutique fermée / ouverte simulée par la dérogation manuelle (indépendant
// de l'heure du test). Test PUR : faux clients de base et faux modules.
// Usage : node tests/e2e/shop-hours-routes-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.db; export const createClient = async () => globalThis.__t.db`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: { id: 'u1', email: 'u@x' }, supabase: globalThis.__t.db }); export const checkShopRole = async () => globalThis.__t.role`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k, v) => 'T:' + k + (v ? JSON.stringify(v) : '')`,
  '@/lib/rate-limit': `export const checkRateLimit = async () => null`,
  '@/lib/api/audit': `export const writeAuditLog = async () => {}; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/push-server': `export const sendShopPush = async () => {}`,
  '@/lib/expenses/recurring': `export const generateDueRecurringExpenses = async () => { globalThis.__t.generated++; return { created: 2 } }`,
  '@/lib/api/sale-validation': `export const validateSale = async () => ({ ok: true })`,
  '@/lib/api/sale-cost': `export const withServerCost = async (_a, _s, items) => items; export const withoutCost = s => s`,
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

const SHOP = '3f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f' // UUID valide (l'invitation contrôle le format)
// Faux client : boutique (horaires + réglages), adhésions ; note chaque requête et chaque appel de fonction
function fakeDb(state) {
  const log = []
  const from = table => {
    const q = { table, op: 'select', filters: [] }
    const run = () => {
      log.push(q)
      if (table === 'shops') return Promise.resolve({ data: { id: SHOP, role_permissions: state.rp ?? null, hours_enabled: true, opening_time: '08:00:00', closing_time: '20:00:00',
        hours_manual_override: state.closed ? 'closed' : 'open', hours_extension_until: null, timezone: 'Africa/Douala' }, error: null })
      if (table === 'shop_members') return Promise.resolve({ data: { role: state.role }, error: null })
      return Promise.resolve({ data: null, error: null })
    }
    const f = op => (c, v) => { q.filters.push([op, c, v]); return b }
    const b = {
      select() { return b }, insert() { q.op = 'insert'; return b }, update() { q.op = 'update'; return b }, upsert() { q.op = 'upsert'; return b },
      eq: f('eq'), in: f('in'), is: f('is'), not: f('not'), gte: f('gte'), lte: f('lte'), order() { return b }, limit() { return b }, range() { return b },
      single() { return run() }, maybeSingle() { return run() }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, rpc: async (fn, args) => { log.push({ rpc: fn, args }); return { data: { sale_id: 's1' }, error: null } }, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }
}
const setup = (role, closed, rp = null) => { const db = fakeDb({ role, closed, rp }); globalThis.__t = { db, role, generated: 0 }; return db }
const post = (mod, body) => mod.POST(new Request('http://l/x', { method: 'POST', body: JSON.stringify(body) }))
const wrote = db => db.log.some(q => q.rpc || ['insert', 'update', 'upsert'].includes(q.op))

// ── 1. Contrôle commun ──────────────────────────────────────────────────────
const RP = await imp('lib/api/role-permissions.ts')
let db = setup('cashier', true)
ok(await RP.canWriteFeature(db, 'cashier', SHOP, 'new_sale') === false, 'fermée : caissier → écriture refusée (contrôle commun)')
ok(await RP.canWriteFeature(db, 'manager', SHOP, 'stock') === false, 'fermée : manager → écriture refusée')
ok(await RP.canWriteFeature(db, 'owner', SHOP, 'stock') === true, 'fermée : propriétaire → toujours autorisé (exempté)')
db = setup('manager', true, { manager: { extend_hours: true } })
ok(await RP.canWriteFeature(db, 'manager', SHOP, 'extend_hours') === true, 'fermée : manager AVEC le droit « prolonger » → demander une prolongation reste permis')
db = setup('cashier', true)
ok(await RP.canWriteFeature(db, 'cashier', SHOP, 'discount', { ignoreHours: true }) === true, 'synchronisation hors ligne (ignoreHours) : pas de refus pour les horaires')
ok(await RP.canWriteFeature(db, 'viewer', SHOP, 'stock') === false, 'observateur : jamais d’écriture (inchangé)')
db = setup('cashier', false)
ok(await RP.canWriteFeature(db, 'cashier', SHOP, 'new_sale') === true, 'ouverte : caissier → autorisé')

// ── 2. Encaissement et paiements : refus explicite, rien n'est écrit ──────────
const CHECKOUT = await imp('app/api/sales/checkout/route.ts')
db = setup('cashier', true)
let r = await post(CHECKOUT, { shop_id: SHOP, client_request_id: 'c1', items: [{ product_id: 'p', quantity: 1, unit_price: 10 }], subtotal: 10, total: 10, payment_method: 'cash', payments: [] })
ok(r.status === 403 && r.body.code === 'shop_closed' && /08:00.*20:00/.test(r.body.error) && !wrote(db), `encaissement, fermée : 403 shop_closed avec les horaires, rien d’écrit (${r.body.error?.slice(0, 60)})`)
db = setup('owner', true)
r = await post(CHECKOUT, { shop_id: SHOP, client_request_id: 'c2', items: [{ product_id: 'p', quantity: 1, unit_price: 10 }], subtotal: 10, total: 10, payment_method: 'cash', payments: [] })
ok(r.body?.code !== 'shop_closed' && db.log.some(q => q.rpc === 'complete_sale'), 'encaissement, fermée : propriétaire → vente enregistrée')
db = setup('cashier', false)
r = await post(CHECKOUT, { shop_id: SHOP, client_request_id: 'c3', items: [{ product_id: 'p', quantity: 1, unit_price: 10 }], subtotal: 10, total: 10, payment_method: 'cash', payments: [] })
ok(r.body?.code !== 'shop_closed' && db.log.some(q => q.rpc === 'complete_sale'), 'encaissement, ouverte : caissier → vente enregistrée')

const PAY = await imp('app/api/payments/route.ts')
db = setup('cashier', true)
r = await post(PAY, { unpaid_sale_ids: ['s1'], amount: 10, method: 'cash', shop_id: SHOP, client_request_id: 'p1' })
ok(r.status === 403 && r.body.code === 'shop_closed' && !wrote(db), 'remboursement, fermée : 403 shop_closed, rien d’écrit (file hors ligne : réessayé à la réouverture)')

// ── 3. Équipe : un manager ne modifie pas l'équipe boutique fermée ───────────
const INVITE = await imp('app/api/team/invite/route.ts')
db = setup('manager', true)
r = await post(INVITE, { email: 'invite.test@example.com', full_name: 'X Y', role: 'cashier', shop_id: SHOP })
ok(r.status === 403 && r.body.code === 'shop_closed' && !wrote(db), 'invitation par un manager, fermée : 403 shop_closed, rien d’écrit')

// ── 4. Dépenses récurrentes : rien généré, sans erreur ────────────────────────
const REC = await imp('app/api/expenses/recurring/route.ts')
db = setup('manager', true)
r = await post(REC, { shop_id: SHOP })
ok(r.status === 200 && r.body.created === 0 && globalThis.__t.generated === 0, 'dépenses récurrentes, fermée, manager (voit les Dépenses) : { created: 0 }, rien généré')
db = setup('owner', true)
r = await post(REC, { shop_id: SHOP })
ok(r.body.created === 2 && globalThis.__t.generated === 1, 'dépenses récurrentes, fermée, propriétaire : générées')

// ── 5. Synchronisation hors ligne : jamais refusée, marquée « hors horaires » ─
const SYNC = await imp('app/api/sales/sync/route.ts')
const saleBody = { shop_id: SHOP, local_id: 'local-1', created_at: new Date().toISOString(), items: [{ product_id: 'p', product_name: 'P', quantity: 1, unit_price: 10 }], subtotal: 10, total: 10, payment_method: 'cash', payments: [{ amount: 10, method: 'cash' }] }
db = setup('cashier', true)
r = await post(SYNC, saleBody)
let rpc = db.log.find(q => q.rpc === 'complete_sale')
ok(r.body?.code !== 'shop_closed' && !!rpc && /outside_hours/.test(rpc.args.p_review_reason || ''), `vente hors ligne faite boutique fermée : enregistrée, « à vérifier » (${rpc?.args.p_review_reason})`)
db = setup('cashier', false)
await post(SYNC, saleBody)
rpc = db.log.find(q => q.rpc === 'complete_sale')
ok(!!rpc && !rpc.args.p_review_reason, 'vente hors ligne faite boutique ouverte : enregistrée, aucune marque')
db = setup('owner', true)
await post(SYNC, saleBody)
rpc = db.log.find(q => q.rpc === 'complete_sale')
ok(!!rpc && !rpc.args.p_review_reason, 'vente hors ligne du propriétaire, fermée : aucune marque (exempté)')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
