// Transferts V1 (migration 188, conception validée le 30 oct. 2026) — routes /api/stock-transfers (liste, création),
// /[id] (détail, brouillon), /send, /receive, /cancel, /[id]/qr, /scan ; motifs de mouvement ; règles pures de l'écran
// (lib/stock/transfers-view). Test PUR : faux client de base et faux modules ; les routes doivent marcher AVANT la 188
// (ancien parcours) et APRÈS. Usage : node tests/e2e/transfers-188-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const MOCKS = {
  'next/server': `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) }`,
  '@/lib/supabase/server': `export const createAdminClient = async () => globalThis.__t.db; export const createClient = async () => globalThis.__t.db`,
  '@/lib/api/shop-auth': `export const getAuthedUser = async () => ({ user: globalThis.__t.uid ? { id: globalThis.__t.uid, email: 'u@x' } : null, supabase: globalThis.__t.db }); export const checkShopRole = async (_s, _u, shop) => globalThis.__t.roles[shop] ?? null`,
  '@/lib/api/role-permissions': `export const canViewCost = async (_s, role) => role === 'owner'; export const canViewFeature = async (_s, role, shop) => !!role && !(globalThis.__t.noView || []).includes(shop); export const canWriteFeature = async (_s, role, shop) => !!role && role !== 'viewer' && !(globalThis.__t.noWrite || []).includes(shop)`,
  '@/lib/api/i18n': `export const getApiTranslator = () => (k, v) => 'T:' + k + (v ? JSON.stringify(v) : '')`,
  '@/lib/api/audit': `export const writeAuditLog = async (e) => { globalThis.__t.audit.push(e.action) }; export const getClientIp = () => '0.0.0.0'`,
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

const A = '3f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f', B = '4f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f', C = '5f2c1a7e-5b6d-4c8e-9f10-2a3b4c5d6e7f'
const U = '5a1b2c3d-1111-4222-8333-944455566677', T1 = '6b2c3d4e-3333-4444-8555-966677788899', I1 = '7c3d4e5f-3333-4444-8555-966677788899'
const KEY = '8d4e5f60-3333-4444-8555-966677788899', TOK = 'a'.repeat(64), E1 = '9e5f6071-3333-4444-8555-966677788899'

// Faux client : tables en mémoire filtrées (eq / in / or), appels de fonctions notés
function fakeDb(st) {
  const log = []
  const tables = () => ({
    stock_transfers: st.transfers || [],
    stock_transfer_allocations: st.workflow ? (st.allocs || []) : null,
    stock_transfer_tokens: st.workflow ? (st.tokens || []) : null,
    shops: [{ id: A, name: 'Akwa', currency: 'XAF', entity_id: E1 }, { id: B, name: 'Bastos', currency: 'XAF', entity_id: E1 }, { id: C, name: 'Bonapriso', currency: 'XAF', entity_id: E1 }],
    profiles: [{ id: U, full_name: 'Yahaya' }],
    shop_members: st.members || [],
    products: st.products || [], product_batches: [], audit_logs: [],
  })
  const from = table => {
    const q = { table, filters: [] }
    const rows = () => {
      const all = tables()[table]
      if (all === null) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
      const data = all.filter(r => q.filters.every(([op, c, v]) => op === 'eq' ? (c.includes('!') ? true : r[c] === v) : op === 'in' ? v.includes(r[c]) : true))
        .map(r => table === 'shop_members' && st.memberShop ? { ...r, shops: { entity_id: st.memberShop[r.shop_id] } } : r)
      return { data, error: null }
    }
    const run = () => { log.push(q); return Promise.resolve(rows()) }
    const f = op => (c, v) => { q.filters.push([op, c, v]); return b }
    const b = {
      select(c) { q.cols = c; return b }, eq: f('eq'), in: f('in'), or: f('or'), ilike: f('ilike'), order() { return b }, limit() { return b },
      single() { return run().then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })) },
      maybeSingle() { return run().then(r => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })) },
      then(r, j) { return run().then(r, j) },
    }
    return b
  }
  return { log, from, rpc: async (fn, args) => { log.push({ rpc: fn, args }); return st.rpc?.[fn] ?? { data: { id: T1, reference: 'TR-2026-0007', status: 'sent' }, error: null } } }
}
const setup = (st = {}) => { const db = fakeDb(st); globalThis.__t = { db, uid: st.uid === undefined ? U : st.uid, roles: st.roles ?? { [A]: 'manager', [B]: 'manager' }, noView: st.noView, noWrite: st.noWrite, audit: [] }; return db }
const call = (fn, method, body, qs = '', params) => fn(new Request('http://l/x' + qs, { method, body: body ? JSON.stringify(body) : undefined }), params ? { params } : undefined)
const rpcOf = (db, fn) => db.log.find(x => x.rpc === fn)
const transfer = (status, extra = {}) => ({ id: T1, reference: 'TR-2026-0007', source_shop_id: A, destination_shop_id: B, status, created_by: U, sent_by: U, created_at: '2026-10-28T10:00:00Z', sent_at: '2026-10-28T10:05:00Z',
  stock_transfer_items: [{ id: I1, source_product_id: 'p1', product_name: 'Riz', unit: 'piece', quantity_sent: 10, quantity_received: extra.received ?? null, buying_price: 1900 }], ...extra })

const R = await imp('app/api/stock-transfers/route.ts')
const D = await imp('app/api/stock-transfers/[id]/route.ts')
const S = await imp('app/api/stock-transfers/send/route.ts')
const RC = await imp('app/api/stock-transfers/receive/route.ts')
const CA = await imp('app/api/stock-transfers/cancel/route.ts')
const Q = await imp('app/api/stock-transfers/[id]/qr/route.ts')
const SC = await imp('app/api/stock-transfers/scan/route.ts')
const TR = await imp('lib/api/transfers.ts')
const MR = await imp('lib/stock/movement-reason.ts')
const ML = await imp('lib/stock/movement-label.ts')
const V = await imp('lib/stock/transfers-view.ts')

// ── 1. Liste ─────────────────────────────────────────────────────────────────
let db = setup({ transfers: [transfer('sent')] })
let r = await call(R.GET, 'GET', null, `?shop_ids=${A},${B}`)
const row = r.body.data?.[0]
ok(r.status === 200 && r.body.workflow === false && row.units_sent === 10 && row.sent_by_name === 'Yahaya' && row.source_shop_name === 'Akwa',
   'liste : unités, noms (envoyé par), boutiques ; avant la 188 workflow indisponible')
ok(!('buying_price' in row.stock_transfer_items[0]), 'manager sans le droit de voir les coûts : prix d’achat retiré')
ok(row.can_receive === true && row.can_manage_source === true, 'droits par transfert : réceptionner (destination), gérer (source)')
db = setup({ transfers: [transfer('sent')], noWrite: [B] })
r = await call(R.GET, 'GET', null, `?shop_ids=${A},${B}`)
ok(r.body.data[0].can_receive === false, 'sans le droit d’écriture à la destination : pas de « Réceptionner »')
db = setup({ transfers: [transfer('sent')], noView: [A, B] })
r = await call(R.GET, 'GET', null, `?shop_ids=${A},${B}`)
ok(r.status === 403, 'sans le droit « Transferts » en lecture : 403')
db = setup({ workflow: true, transfers: [transfer('received', { received: 8, has_discrepancy: true })] })
r = await call(R.GET, 'GET', null, `?shop_ids=${A}`)
ok(r.body.workflow === true && r.body.data[0].units_missing === 2, 'après la 188 : reçu avec écart, 2 manquants')

// ── 2. Création ──────────────────────────────────────────────────────────────
const items = [{ product_id: I1, quantity: 2 }]
db = setup({})
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: B, items, send: false })
ok(r.status === 503 && !db.log.some(x => x.rpc), 'brouillon avant la 188 : indisponible (503)')
db = setup({ workflow: true })
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: B, items, send: false })
ok(rpcOf(db, 'create_stock_transfer')?.args.p_send === false && globalThis.__t.audit.length === 0, 'après la 188 : brouillon ; journal écrit par la base (pas par la route)')
db = setup({ workflow: true })
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: B, items: [{ product_id: I1, quantity: 0 }] })
ok(r.status === 400 && !db.log.some(x => x.rpc), 'quantité nulle ou négative : refusée avant la base')
db = setup({ workflow: true, rpc: { create_stock_transfer: { data: null, error: { code: 'P0067', details: '{"product":"Lait","transferable":7,"expired":3,"requested":8}' } } } })
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: B, items })
ok(r.body.error === 'T:transfer_insufficient_stock{"product":"Lait","transferable":7,"requested":8}', 'quantité > transférable : message traduit avec la quantité transférable')
db = setup({ workflow: true, rpc: { create_stock_transfer: { data: null, error: { code: 'P0060' } } } })
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: A, items })
ok(r.body.code === 'transfer_same_shop', 'source = destination : refusé (P0060)')
db = setup({ workflow: true, noWrite: [A] })
r = await call(R.POST, 'POST', { source_shop_id: A, destination_shop_id: B, items })
ok(r.status === 403 && !db.log.some(x => x.rpc), 'sans « Transferts » en modification à la source : 403')

// ── 3. Détail ─────────────────────────────────────────────────────────────────
db = setup({ workflow: true, transfers: [transfer('sent')], allocs: [{ transfer_id: T1, item_id: I1, coverage: 'batch', source_expiry_date: '2026-12-20', source_received_at: '2026-10-12T08:00:00Z', quantity_sent: 10, quantity_received: 0, quantity_missing: 0, quantity_returned: 0, quantity_in_transit: 10, destination_batch_id: null, unit_cost: 1900 }] })
r = await call(D.GET, 'GET', null, '', { id: T1 })
const lot = r.body.data?.stock_transfer_items?.[0]?.lots?.[0]
ok(r.status === 200 && lot?.source_expiry_date === '2026-12-20' && !('unit_cost' in lot) && r.body.data.can_view_cost === false, 'détail : lots avec péremption ; coût ABSENT sans le droit')
globalThis.__t.roles = { [A]: 'owner', [B]: 'manager' }
r = await call(D.GET, 'GET', null, '', { id: T1 })
ok(r.body.data.stock_transfer_items[0].lots[0].unit_cost === 1900 && r.body.data.can_view_cost === true, 'propriétaire (droit de voir les coûts) : coût du lot visible')
ok((r.body.data.history || []).map(h => h.event).join() === 'created,sent', 'historique : créé, envoyé')
db = setup({ workflow: true, transfers: [transfer('sent')], roles: { [C]: 'manager' } })
r = await call(D.GET, 'GET', null, '', { id: T1 })
ok(r.status === 403, 'membre d’une AUTRE boutique : détail refusé')

// ── 4. Envoi d'un brouillon : source relue en base ───────────────────────────
db = setup({ workflow: true, transfers: [transfer('draft')] })
r = await call(S.POST, 'POST', { transfer_id: T1, source_shop_id: C })
ok(rpcOf(db, 'send_stock_transfer_draft')?.args.p_source === A, 'boutique source falsifiée par le navigateur : ignorée, la VRAIE source est utilisée')
db = setup({ workflow: true, transfers: [transfer('draft')], noWrite: [A] })
r = await call(S.POST, 'POST', { transfer_id: T1 })
ok(r.status === 403, 'envoi sans le droit à la vraie source : 403')

// ── 5. Réception ─────────────────────────────────────────────────────────────
const lines = [{ transfer_item_id: I1, quantity_received: 8, discrepancy_category: 'breakage', discrepancy_detail: ' carton ' }]
db = setup({ workflow: true, transfers: [transfer('sent')] })
r = await call(RC.POST, 'POST', { transfer_id: T1, destination_shop_id: C, items: lines, receipt_key: KEY })
const ra = rpcOf(db, 'receive_stock_transfer_final')?.args
ok(ra?.p_dest === B && ra.p_receipt_key === KEY && ra.p_lines[0].quantity_received === 8 && ra.p_lines[0].discrepancy_category === 'breakage' && ra.p_lines[0].discrepancy_detail === 'carton',
   'réception : VRAIE destination (boutique falsifiée ignorée), clé de réception, cause et précision nettoyée')
db = setup({ workflow: true, transfers: [transfer('sent')], noWrite: [B] })
r = await call(RC.POST, 'POST', { transfer_id: T1, items: lines })
ok(r.status === 403 && !db.log.some(x => x.rpc), 'réception sans le droit à la destination : 403')
db = setup({ workflow: true, transfers: [transfer('sent')], rpc: { receive_stock_transfer_final: { data: null, error: { code: 'P0078', details: `{"received_at":"2026-10-29T14:32:00Z","received_by":"${U}"}` } } } })
r = await call(RC.POST, 'POST', { transfer_id: T1, items: lines })
ok(r.status === 409 && r.body.code === 'transfer_already_received' && r.body.received_by_name === 'Yahaya' && r.body.received_at === '2026-10-29T14:32:00Z',
   'déjà réceptionné (P0078) : 409 avec la date et le nom de la personne')
db = setup({ workflow: true, transfers: [transfer('sent')] })
r = await call(RC.POST, 'POST', { transfer_id: T1, items: [{ transfer_item_id: I1, quantity_received: -1 }] })
ok(r.status === 400 && !db.log.some(x => x.rpc), 'quantité reçue négative : refusée avant la base')
db = setup({ transfers: [transfer('sent')] })
r = await call(RC.POST, 'POST', { transfer_id: T1, items: lines })
ok(rpcOf(db, 'receive_stock_transfer') && globalThis.__t.audit.includes('stock_transfer.receive'), 'avant la 188 : ancienne réception, journal écrit par la route')

// ── 6. Annulation ────────────────────────────────────────────────────────────
db = setup({ workflow: true, transfers: [transfer('received')], rpc: { cancel_stock_transfer: { data: null, error: { code: 'P0074' } } } })
r = await call(CA.POST, 'POST', { transfer_id: T1, source_shop_id: C })
ok(rpcOf(db, 'cancel_stock_transfer')?.args.p_source_shop_id === A && r.body.code === 'transfer_not_cancellable', 'annulation : VRAIE source ; transfert reçu → refus traduit (P0074)')

// ── 7. QR ────────────────────────────────────────────────────────────────────
db = setup({ workflow: true, transfers: [transfer('sent')], tokens: [{ transfer_id: T1, token: TOK, revoked_at: null }] })
r = await call(Q.GET, 'GET', null, '?locale=fr', { id: T1 })
ok(r.status === 200 && r.body.data.url.endsWith(`/fr/stock/transfers/${T1}/receive?k=${TOK}`), 'QR : adresse de réception avec identifiant et jeton (jamais la référence seule)')
db = setup({ workflow: true, transfers: [transfer('received')], tokens: [{ transfer_id: T1, token: TOK, revoked_at: '2026-10-29' }] })
r = await call(Q.GET, 'GET', null, '', { id: T1 })
ok(r.status === 409, 'QR d’un transfert reçu : indisponible')
db = setup({ workflow: true, transfers: [transfer('sent')], tokens: [{ transfer_id: T1, token: TOK }], roles: { [C]: 'manager' } })
r = await call(Q.GET, 'GET', null, '', { id: T1 })
ok(r.status === 403, 'QR : membre d’une autre boutique refusé')

// ── 8. Scan ──────────────────────────────────────────────────────────────────
const code = `https://stockshop.tech/fr/stock/transfers/${T1}/receive?k=${TOK}`
const scanSetup = (extra = {}) => setup({ workflow: true, transfers: [transfer('sent')], tokens: [{ transfer_id: T1, token: TOK, revoked_at: null }], ...extra })
db = scanSetup()
r = await call(SC.POST, 'POST', { code, active_shop_id: B })
ok(r.body.result === 'ok' && r.body.transfer.id === T1 && !db.log.some(x => x.rpc), 'scan valide à la destination : « ok » (ouvre la réception), RIEN n’est réceptionné')
db = scanSetup()
r = await call(SC.POST, 'POST', { code: code.replace(TOK, 'b'.repeat(64)), active_shop_id: B })
ok(r.body.result === 'invalid', 'jeton faux : invalide')
db = scanSetup()
r = await call(SC.POST, 'POST', { code: 'TR-2026-0007', active_shop_id: B })
ok(r.body.result === 'invalid', 'référence lisible seule : jamais acceptée')
db = scanSetup()
r = await call(SC.POST, 'POST', { code, active_shop_id: A })
ok(r.body.result === 'wrong_shop' && r.body.transfer.destination_shop_name === 'Bastos', 'scanné depuis une autre boutique : « destiné à Bastos »')
db = scanSetup({ roles: { [C]: 'manager' }, members: [{ user_id: U, shop_id: C, is_active: true }], memberShop: { [C]: E1 } })
r = await call(SC.POST, 'POST', { code, active_shop_id: C })
ok(r.body.result === 'wrong_shop' && r.body.transfer.destination_shop_name === 'Bastos', 'employé de Bonapriso (même entreprise) : « destiné à Bastos »')
db = scanSetup({ roles: {}, members: [] })
r = await call(SC.POST, 'POST', { code, active_shop_id: C })
ok(r.body.result === 'forbidden' && !r.body.transfer, 'compte étranger à l’entreprise : refusé, AUCUN nom de boutique révélé')
db = scanSetup({ noWrite: [B] })
r = await call(SC.POST, 'POST', { code, active_shop_id: B })
ok(r.body.result === 'forbidden', 'membre de la destination sans le droit : refusé')
db = setup({ workflow: true, transfers: [transfer('received', { received_at: '2026-10-29T14:32:00Z', received_by: U })], tokens: [{ transfer_id: T1, token: TOK, revoked_at: '2026-10-29' }] })
r = await call(SC.POST, 'POST', { code, active_shop_id: B })
ok(r.body.result === 'already_received' && r.body.transfer.received_by_name === 'Yahaya', 'transfert déjà reçu : date et personne, aucune action')
db = setup({ workflow: true, transfers: [transfer('cancelled')], tokens: [{ transfer_id: T1, token: TOK, revoked_at: '2026-10-29' }] })
r = await call(SC.POST, 'POST', { code, active_shop_id: B })
ok(r.body.result === 'cancelled', 'transfert annulé (jeton révoqué) : « annulé »')
ok(TR.parseTransferCode(`STKTR:${T1}:${TOK}`)?.token === TOK && TR.parseTransferCode('n’importe quoi') === null, 'lecture du QR : forme courte acceptée, texte libre refusé')
ok(TR.sameToken(TOK, TOK) && !TR.sameToken(TOK, 'b'.repeat(64)) && !TR.sameToken(TOK, 'a'), 'comparaison des jetons (même longueur exigée)')

// ── 9. Motifs de mouvement ───────────────────────────────────────────────────
ok(MR.describeMovementReason('Transfert TR-2026-0006 : manquant à la réception')?.key === 'reason_transfer_missing', 'motif « manquant à la réception » reconnu')
const v = ML.describeMovement({ type: 'transit_loss', quantity: 2, reason: 'Transfert TR-2026-0006 : manquant à la réception', previous_qty: null, new_qty: null })
ok(v.labelKey === 'label_transfer_missing' && v.origin?.kind === 'transfer' && ML.movementDelta({ type: 'transit_loss', quantity: 2 }) === null, 'mouvement « manquant » : libellé, rattaché au transfert, aucune variation affichée')
ok(MR.describeMovementReason('Annulation transfert TR-2026-0004')?.key === 'reason_transfer_cancelled' && MR.describeMovementReason('Transfert TR-2026-0004 vers Bastos')?.key === 'reason_transfer_out', 'anciens motifs toujours reconnus')

// ── 10. Règles de l'écran ────────────────────────────────────────────────────
const now = new Date('2026-10-30T12:00:00Z')
const rows = [
  { id: '1', reference: 'TR-2026-0001', status: 'received', source_shop_id: A, destination_shop_id: B, source_shop_name: 'Marché Soleil Akwa', destination_shop_name: 'Marché Soleil Bastos', created_at: '2026-10-01T10:00:00Z', sent_at: '2026-10-01T10:00:00Z', created_by: U, stock_transfer_items: [{ source_product_id: 'p1', product_name: 'Coca-Cola 50 cl', quantity_sent: 10 }, { source_product_id: 'p2', product_name: 'Riz', quantity_sent: 14 }] },
  { id: '2', reference: 'TR-2026-0002', status: 'sent', source_shop_id: A, destination_shop_id: C, source_shop_name: 'Marché Soleil Akwa', destination_shop_name: 'Marché Soleil Bonapriso', created_at: '2026-10-27T10:00:00Z', sent_at: '2026-10-27T10:00:00Z', created_by: 'x', stock_transfer_items: [{ source_product_id: 'p2', product_name: 'Riz', quantity_sent: 18 }] },
  { id: '3', reference: 'TR-2026-0003', status: 'sent', source_shop_id: B, destination_shop_id: A, source_shop_name: 'Marché Soleil Bastos', destination_shop_name: 'Marché Soleil Akwa', created_at: '2026-10-30T08:00:00Z', sent_at: '2026-10-30T08:00:00Z', created_by: U, stock_transfer_items: [{ source_product_id: 'p3', product_name: 'Sucre', quantity_sent: 5 }] },
]
const k = V.transferKpis(rows)
ok(k.all === 3 && k.in_transit === 2 && k.received === 1, 'compteurs : Tous 3, En transit 2, Reçus 1')
ok(V.searchTransfers(rows, 'coca').map(x => x.id).join() === '1' && V.searchTransfers(rows, 'BONAPRISO').map(x => x.id).join() === '2' && V.searchTransfers(rows, '0003').map(x => x.id).join() === '3',
   'recherche : produit, boutique (sans casse), référence')
const F = { ...V.EMPTY_TRANSFER_FILTERS }
ok(V.filterTransfers(rows, { ...F, destinations: [B, C] }, now).map(x => x.id).join() === '1,2', 'OU dans une dimension : destination Bastos OU Bonapriso')
ok(V.filterTransfers(rows, { ...F, destinations: [B, C], statuses: ['sent'] }, now).map(x => x.id).join() === '2', 'ET entre dimensions : (Bastos OU Bonapriso) ET en transit')
ok(V.filterTransfers(rows, { ...F, products: ['p2'] }, now).map(x => x.id).join() === '1,2', 'filtre produit : transferts contenant le riz')
ok(V.filterTransfers(rows, { ...F, period: '7d' }, now).map(x => x.id).join() === '2,3', 'période : 7 derniers jours')
ok(V.activeFilterCount({ ...F, destinations: [B, C], period: 'month' }) === 2, 'compteur de filtres : une pastille par dimension')
ok(V.transitDays(rows[1], now) === 3 && V.isLateTransit(3) && V.transitDays(rows[2], now) === 0 && !V.isLateTransit(0) && V.transitDays(rows[0], now) === null,
   'jours en transit : 3 jours (orange à partir de 2), 0 jour, rien pour un reçu')
ok(JSON.stringify(V.transferTotals(rows[0])) === '{"products":2,"units":24}', 'totaux de carte : 2 produits · 24 unités')
const sum = V.receiveSummary([{ item_id: 'a', sent: 10, received: 10 }, { item_id: 'b', sent: 8, received: 6 }, { item_id: 'c', sent: 12, received: 15 }])
ok(sum.articles === 3 && sum.sent === 30 && sum.received === 28 && sum.missing === 2, 'résumé de réception : 3 articles, 30 envoyés, 28 reçus, écart 2 (jamais plus que l’envoyé)')
ok(V.clampReceived(-3, 8) === 0 && V.clampReceived(11, 8) === 8 && V.clampReceived(5.7, 8) === 5, 'quantité reçue bornée entre 0 et l’envoyé')
const scanLines = [{ item_id: 'a', sku: '5449000000996', sent: 2, received: 2 }, { item_id: 'b', sku: '6001', sent: 3, received: 1 }, { item_id: 'c', sku: null, sent: 4, received: 0 }]
ok(V.scanArticle(scanLines, '6001').result === 'added' && V.scanArticle(scanLines, '6001').item_id === 'b', 'scan d’un article attendu : +1 sur sa ligne')
ok(V.scanArticle(scanLines, '5449000000996').result === 'full', 'scan au-delà de la quantité envoyée : « quantité atteinte »')
ok(V.scanArticle(scanLines, '9999').result === 'unknown', 'scan d’un produit hors transfert : refusé')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
