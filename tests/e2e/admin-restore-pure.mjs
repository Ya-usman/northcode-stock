// Panneau de restauration du super admin (26 oct. 2026) — GET /api/admin/restore (listes lues par le serveur) et
// restaurations limitées à la boutique indiquée. Test PUR : faux client de base et faux contrôle d'accès.
// Usage : node tests/e2e/admin-restore-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.admin`,
  '@/lib/api/require-admin': `export const requireAdmin = async () => globalThis.__t.isAdmin ? { user: { id: 'sa', email: 'sa@x' }, tier: 'super_admin' } : { error: { body: { error: 'interdit' }, status: 403 } }`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__t.audit.push(e) }; export const getClientIp = () => '0.0.0.0'`,
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
const R = await import(new URL('app/api/admin/restore/route.ts', ROOT).href)

const SHOP = 'a0000000-0000-0000-0000-00000000000a', OTHER = 'a0000000-0000-0000-0000-00000000000b'
function fakeDb(rows) {
  const log = []
  const from = table => {
    const q = { table, op: 'select', filters: [], payload: null }
    const run = () => {
      log.push(q)
      const match = (rows[table] || []).filter(r => q.filters.every(([op, c, v]) => op === 'eq' ? r[c] === v : op === 'not' ? r[c] !== null : true))
      return Promise.resolve({ data: q.op === 'update' ? match.map(r => ({ id: r.id })) : match, error: null })
    }
    const f = op => (c, v, w) => { q.filters.push([op, c, op === 'not' ? w : v]); return b }
    const b = {
      select() { return b }, update(p) { q.op = 'update'; q.payload = p; return b },
      eq: f('eq'), not: f('not'), order() { return b }, then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from }
}
const DATA = {
  deleted_records_log: [{ id: 'l1', shop_id: SHOP, table_name: 'products', record_data: { name: 'Riz' } }, { id: 'l2', shop_id: OTHER, table_name: 'products' }],
  products: [{ id: 'p1', shop_id: SHOP, is_active: false, name: 'Savon' }, { id: 'p2', shop_id: OTHER, is_active: false }],
  customers: [{ id: 'c1', shop_id: SHOP, deleted_at: '2026-10-14T10:00:00Z', name: 'TEST' }, { id: 'c2', shop_id: SHOP, deleted_at: null, name: 'Actif' }, { id: 'c3', shop_id: OTHER, deleted_at: '2026-10-01T00:00:00Z' }],
}
const call = async (method, url, body, isAdmin = true) => {
  const admin = fakeDb(DATA); globalThis.__t = { admin, isAdmin, audit: [] }
  const res = await R[method](new Request(url, { method, body: body ? JSON.stringify(body) : undefined }))
  return { res, admin, audit: globalThis.__t.audit }
}

let r = await call('GET', `http://l/api/admin/restore?shop_id=${SHOP}`, null, false)
ok(r.res.status === 403 && r.admin.log.length === 0, 'non super admin : 403, rien lu')
r = await call('GET', 'http://l/api/admin/restore?shop_id=x')
ok(r.res.status === 400, 'boutique invalide : 400')
r = await call('GET', `http://l/api/admin/restore?shop_id=${SHOP}`)
const b = r.res.body
ok(b.deleted_products?.map(x => x.id).join() === 'l1' && b.archived_products?.map(x => x.id).join() === 'p1' && b.deleted_customers?.map(x => x.id).join() === 'c1',
   `listes de la boutique seulement : journal ${b.deleted_products?.length}, archivés ${b.archived_products?.length}, clients supprimés ${b.deleted_customers?.length} (client actif exclu)`)

r = await call('POST', 'http://l/api/admin/restore', { action: 'restore_customer', customer_id: 'c1', shop_id: SHOP })
ok(r.res.status === 200 && r.audit.length === 1 && r.admin.log.some(q => q.op === 'update' && q.filters.some(([o, c, v]) => o === 'eq' && c === 'shop_id' && v === SHOP)), 'restaurer un client de la boutique : fait, limité à la boutique, journalisé')
r = await call('POST', 'http://l/api/admin/restore', { action: 'restore_customer', customer_id: 'c3', shop_id: SHOP })
ok(r.res.status === 404 && r.audit.length === 0, 'client d’une AUTRE boutique : 404, rien journalisé')
r = await call('POST', 'http://l/api/admin/restore', { action: 'reactivate_product', product_id: 'p2', shop_id: SHOP })
ok(r.res.status === 404 && r.audit.length === 0, 'produit d’une AUTRE boutique : 404')
r = await call('POST', 'http://l/api/admin/restore', { action: 'reactivate_product', product_id: 'p1', shop_id: SHOP })
ok(r.res.status === 200 && r.audit[0]?.action === 'admin.restore_product', 'réactiver un produit de la boutique : fait, journalisé')
r = await call('POST', 'http://l/api/admin/restore', { action: 'reactivate_product', product_id: 'p1' })
ok(r.res.status === 400, 'sans boutique : 400')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
