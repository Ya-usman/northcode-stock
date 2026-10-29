// Demandes de prolongation (29 oct. 2026) — routes /api/shops/extension-requests (GET, POST, DELETE) et /decide,
// prolongation directe /api/shops/extend-hours. Test PUR : faux clients de base et faux modules ; la boutique est
// « après la fermeture » ou « avant l'ouverture » grâce à des horaires construits sur l'heure courante (UTC).
// Usage : node tests/e2e/extension-requests-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.db; export const createClient = async () => globalThis.__t.db`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: { id: globalThis.__t.uid, email: 'u@x' }, supabase: globalThis.__t.db }); export const checkShopRole = async () => globalThis.__t.role`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k, v) => 'T:' + k; export const getLocaleTranslator = (l) => (k, v) => l + ':' + k + (v ? JSON.stringify(v) : '')`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__t.audit.push(e.action) }; export const getClientIp = () => '0.0.0.0'`,
  '@/lib/api/push-server': `export const sendUsersPush = async (_a, shop, ids, p) => { globalThis.__t.push.push({ ids, p }); return ids.length }; export const sendShopPush = async () => 0`,
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

const SHOP = '3f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f', EMP = '4a1b2c3d-1111-4222-8333-944455566677', BOSS = '4a1b2c3d-2222-4222-8333-944455566677'
const REQ = '5b2c3d4e-3333-4444-8555-966677788899'
const hm = d => d.toISOString().slice(11, 16)
const nowUtc = new Date()
const afterClose = { opening_time: '00:00', closing_time: hm(new Date(nowUtc.getTime() - 60_000)) } // fermée depuis 1 min
const beforeOpen = { opening_time: hm(new Date(nowUtc.getTime() + 60 * 60_000)), closing_time: '23:59' } // ouvre dans 1 h

// Faux client : boutique, adhésions, profils, demandes ; note les écritures et les appels de fonctions
function fakeDb(st) {
  const log = []
  const from = table => {
    const q = { table, op: 'select', filters: [], payload: null }
    const run = () => {
      log.push(q)
      if (st.missingTable && table === 'hours_extension_requests') return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "hours_extension_requests" does not exist' } })
      if (table === 'shops') return Promise.resolve({ data: { id: SHOP, name: 'Boutique Test', hours_enabled: true, hours_manual_override: st.manual ? 'closed' : null, hours_extension_until: null, timezone: 'UTC', role_permissions: st.rp ?? null, ...(st.hours ?? afterClose) }, error: null })
      if (table === 'shop_members') return Promise.resolve({ data: [{ user_id: BOSS, role: 'owner' }, { user_id: EMP, role: 'cashier' }, { user_id: 'mgr', role: 'manager' }], error: null })
      if (table === 'profiles') return Promise.resolve({ data: q.filters.some(([o, c]) => o === 'eq' && c === 'id') ? { locale: 'ha' }
        : q.cols?.includes('locale') ? [{ id: EMP, full_name: 'Fatou', locale: 'fr' }, { id: BOSS, full_name: 'Patron', locale: 'en' }, { id: 'mgr', full_name: 'Gérant', locale: 'fr' }]
        : [{ id: EMP, full_name: 'Fatou' }], error: null })
      if (table === 'hours_extension_requests') {
        if (q.op === 'insert') return Promise.resolve(st.duplicate ? { data: null, error: { code: '23505' } } : { data: { id: REQ, ...q.payload, status: 'pending', created_at: nowUtc.toISOString() }, error: null })
        if (q.op === 'update') return Promise.resolve({ data: st.updateNone ? [] : [{ id: REQ }], error: null })
        if (q.filters.some(([o, c, v]) => o === 'eq' && c === 'status' && v === 'pending')) return Promise.resolve({ data: [{ id: REQ, minutes: 60, message: 'client', created_at: nowUtc.toISOString(), requested_by: EMP }], error: null })
        return Promise.resolve({ data: st.request ?? null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }
    const f = op => (c, v) => { q.filters.push([op, c, v]); return b }
    const b = {
      select(c) { q.cols = c; return b }, insert(p) { q.op = 'insert'; q.payload = p; return b }, update(p) { q.op = 'update'; q.payload = p; return b },
      eq: f('eq'), in: f('in'), lt: f('lt'), gte: f('gte'), order() { return b }, limit() { return b },
      single() { return run() }, maybeSingle() { return run() }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, rpc: async (fn, args) => { log.push({ rpc: fn, args }); return st.rpcError ? { data: null, error: st.rpcError } : { data: { hours_extension_until: '2026-10-29T21:14:00Z', hours_extension_count: 1 }, error: null } } }
}
const setup = (uid, role, st = {}) => { const db = fakeDb(st); globalThis.__t = { db, uid, role, audit: [], push: [] }; return db }
const call = (mod, method, body, qs = '') => mod[method](new Request('http://l/x' + qs, { method, body: body ? JSON.stringify(body) : undefined }))
const wrote = db => db.log.some(q => q.rpc || q.op === 'insert' || q.op === 'update' && q.payload?.status !== 'expired')

const R = await imp('app/api/shops/extension-requests/route.ts')
const D = await imp('app/api/shops/extension-requests/decide/route.ts')
const X = await imp('app/api/shops/extend-hours/route.ts')

// ── 1. Demander ─────────────────────────────────────────────────────────────
let db = setup(EMP, 'cashier')
let r = await call(R, 'POST', { shop_id: SHOP, minutes: 60, message: '  client en cours  ' })
const ins = db.log.find(q => q.op === 'insert')
ok(r.status === 200 && ins?.payload.minutes === 60 && ins.payload.message === 'client en cours' && ins.payload.requested_by === EMP, 'caissier, après la fermeture : demande de 1 h enregistrée (message nettoyé)')
const pushed = globalThis.__t.push
ok(pushed.length === 1 && pushed[0].ids.join() === BOSS && /^en:/.test(pushed[0].p.title),
   'réglages par défaut : seul le PROPRIÉTAIRE est prévenu (le manager n’a pas « Prolonger » par défaut), dans sa langue (anglais)')
db = setup(EMP, 'cashier', { rp: { manager: { extend_hours: true } } })
await call(R, 'POST', { shop_id: SHOP, minutes: 60 })
ok(globalThis.__t.push.flatMap(p => p.ids).sort().join() === [BOSS, 'mgr'].sort().join(), 'droit « Prolonger » donné au manager : propriétaire ET manager prévenus, chacun dans sa langue')
ok(globalThis.__t.audit.includes('shop.extension_requested'), 'journal : « prolongation demandée »')
db = setup(EMP, 'cashier', { hours: beforeOpen })
r = await call(R, 'POST', { shop_id: SHOP, minutes: 60 })
ok(r.status === 400 && r.body.code === 'extension_before_open' && !wrote(db), 'avant l’ouverture du matin : refusée (une prolongation n’y change rien), rien d’écrit')
db = setup(EMP, 'cashier', { manual: true })
r = await call(R, 'POST', { shop_id: SHOP, minutes: 60 })
ok(r.status === 400 && r.body.code === 'extension_manual_override' && !wrote(db), 'fermée par le propriétaire : refusée, rien d’écrit')
db = setup(EMP, 'cashier', { hours: { opening_time: '00:00', closing_time: '23:59' } })
r = await call(R, 'POST', { shop_id: SHOP, minutes: 60 })
ok(r.status === 400 && r.body.code === 'extension_shop_open', 'boutique ouverte : pas de demande')
db = setup(EMP, 'cashier')
r = await call(R, 'POST', { shop_id: SHOP, minutes: 45 })
ok(r.status === 400 && !wrote(db), 'durée hors 30 min / 1 h / 2 h : refusée')
db = setup(EMP, 'cashier', { duplicate: true })
r = await call(R, 'POST', { shop_id: SHOP, minutes: 30 })
ok(r.status === 409 && r.body.code === 'extension_request_pending', 'deuxième demande en attente : 409')
db = setup(BOSS, 'owner')
r = await call(R, 'POST', { shop_id: SHOP, minutes: 30 })
ok(r.status === 400 && r.body.code === 'extension_use_direct' && !wrote(db), 'propriétaire : pas de demande, il prolonge lui-même')
db = setup(EMP, 'cashier', { missingTable: true })
r = await call(R, 'POST', { shop_id: SHOP, minutes: 30 })
ok(r.status === 503, 'migration 186 non appliquée : demandes indisponibles (503), sans erreur serveur')

// ── 2. Lire l'état ─────────────────────────────────────────────────────────
db = setup(EMP, 'cashier', { request: { id: REQ, minutes: 60, status: 'pending', created_at: nowUtc.toISOString() } })
r = await call(R, 'GET', null, `?shop_id=${SHOP}`)
ok(r.body.phase === 'after_close' && r.body.mine?.status === 'pending' && r.body.pending.length === 0 && r.body.can_extend === false && r.body.available === true,
   'employé : sa demande en attente, phase « après la fermeture », pas la liste des autres')
db = setup(BOSS, 'owner')
r = await call(R, 'GET', null, `?shop_id=${SHOP}`)
ok(r.body.pending.length === 1 && r.body.pending[0].requester_name === 'Fatou' && r.body.can_extend === true, 'propriétaire : demandes en attente avec le nom de l’employé')
ok(db.log.some(q => q.op === 'update' && q.payload?.status === 'expired'), 'demandes dépassées passées à « expirée » à la lecture')
db = setup(EMP, 'cashier', { missingTable: true })
r = await call(R, 'GET', null, `?shop_id=${SHOP}`)
ok(r.status === 200 && r.body.available === false, 'migration 186 non appliquée : available = false (l’écran n’offre pas de demande)')

// ── 3. Annuler ─────────────────────────────────────────────────────────────
db = setup(EMP, 'cashier')
r = await call(R, 'DELETE', { shop_id: SHOP, id: REQ })
const upd = db.log.find(q => q.op === 'update' && q.payload?.status === 'cancelled')
ok(r.status === 200 && upd && upd.filters.some(([o, c, v]) => c === 'requested_by' && v === EMP) && upd.filters.some(([o, c, v]) => c === 'status' && v === 'pending'), 'annuler : seulement SA demande, et seulement si elle est en attente')

// ── 4. Accepter / refuser ──────────────────────────────────────────────────
const pendingReq = { id: REQ, shop_id: SHOP, requested_by: EMP, minutes: 60, status: 'pending' }
db = setup(BOSS, 'owner', { request: pendingReq })
r = await call(D, 'POST', { id: REQ, approve: true })
let rpc = db.log.find(q => q.rpc === 'approve_hours_extension_request')
ok(r.status === 200 && rpc?.args.p_decided_by === BOSS && rpc.args.p_request_id === REQ && globalThis.__t.push[0]?.ids.join() === EMP && /granted_push_title/.test(globalThis.__t.push[0].p.title) && globalThis.__t.push[0].p.title.startsWith('ha:'),
   'propriétaire accepte : prolongation accordée par la base, employé prévenu dans SA langue (haoussa)')
ok(globalThis.__t.audit.includes('shop.extension_request_approved'), 'journal : « demande acceptée »')
db = setup('mgr', 'manager', { request: pendingReq, rp: { manager: { extend_hours: true } } })
r = await call(D, 'POST', { id: REQ, approve: false })
ok(r.status === 200 && db.log.some(q => q.op === 'update' && q.payload?.status === 'refused') && !db.log.some(q => q.rpc) && /refused_push/.test(globalThis.__t.push[0]?.p.title), 'manager AVEC le droit « Prolonger » refuse : demande close, aucune prolongation, employé prévenu')
db = setup('mgr', 'manager', { request: pendingReq })
r = await call(D, 'POST', { id: REQ, approve: true })
ok(r.status === 403 && !wrote(db), 'manager SANS le droit « Prolonger » (défaut) : ne peut pas accepter (403)')
db = setup(EMP, 'cashier', { request: pendingReq })
r = await call(D, 'POST', { id: REQ, approve: true })
ok(r.status === 403 && !wrote(db), 'caissier : ne peut pas accepter (403)')
db = setup(BOSS, 'owner', { request: pendingReq, rpcError: { code: 'P0053', message: 'Limite' } })
r = await call(D, 'POST', { id: REQ, approve: true })
ok(r.status === 400 && r.body.code === 'extension_daily_limit' && r.body.error === 'T:extension_daily_limit', 'limite de 2 par jour (P0053) : message traduit')
db = setup(BOSS, 'owner', { request: pendingReq, updateNone: true })
r = await call(D, 'POST', { id: REQ, approve: false })
ok(r.status === 409, 'refuser une demande déjà traitée : 409')

// ── 5. Prolongation directe : 2 h acceptée, erreurs traduites ────────────────
db = setup(BOSS, 'owner')
r = await call(X, 'POST', { shop_id: SHOP, minutes: 120 })
ok(r.status === 200 && db.log.find(q => q.rpc === 'grant_hours_extension')?.args.p_minutes === 120, 'propriétaire : prolongation directe de 2 h transmise à la base')
db = setup(BOSS, 'owner', { rpcError: { code: 'P0054', message: 'Plus de prolongation' } })
r = await call(X, 'POST', { shop_id: SHOP, minutes: 30 })
ok(r.status === 400 && r.body.error === 'T:extension_too_late', 'trop tard (P0054) : message traduit au lieu du texte brut de la base')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
