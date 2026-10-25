// 179 — TEST RÉEL en production dans une BOUTIQUE TEST DÉDIÉE, supprimée à la fin par le workflow officiel.
// ÉCRIT EN BASE DE PRODUCTION : ne se lance que sur autorisation explicite (B179_TEST_SHOP_GO=oui).
//
// Parcours : boutique « TEST 179 <exécution> » créée par la vraie route (compte d'essai admin@northcode.ng, entreprise
// d'Alpha) → préparation directe (fournisseur, produit 5, lot 5 J+30, mouvement « Stock initial ») → traitements par
// la vraie route /api/stock/batch-treatments (A ajustement +1, B idempotence + P0041, C date → hier, D destruction 2,
// E retour fournisseur 1, F historique, G destruction finale 3) → archivage par la vraie route produits →
// désactivation puis suppression définitive (super_admin) : POST /api/shops/[id] → deleteShops → delete_shops.
//
// Gardes : serveur LOCAL (même code que la production, base de production) ; TEST_SHOP_ID ≠ ALPHA_SHOP_ID vérifié
// avant chaque écriture ; navigateur : seules 5 routes passent, chacune limitée aux identifiants TEST de l'exécution ;
// ventes, profils, réglages, tout le reste → bloqués ; fenêtre sans tâche planifiée ; arrêt au premier écart, SANS
// nettoyage (état et identifiants affichés).
// Traces CONSERVÉES volontairement (décision du 25 oct. 2026) : R1 audit_logs « archive_product » (shop_id → NULL
// après suppression), R2 deleted_records_log (copie du produit au moment de la cascade) ; R3 entity_members.updated_at.
// Usage (après GO) : B179_TEST_SHOP_GO=oui CAPTURE_BASE=http://localhost:3000 node tests/e2e/b179-real-test-shop.js
//
// Exécution de référence — 25 oct. 2026, 00 h 14 UTC, migration 179 déjà installée en production :
//   exécution t179mvn2stxw34ff71 · 45/45 · 0 résidu opérationnel (boutique TEST entièrement supprimée par
//   delete_shops) · R1 et R2 conservées volontairement · R3 constaté (accepté) · Alpha inchangée (traitements,
//   mouvements, produits, lots, compteur de ventes) · 4 ventes historiques BOU-0408 / 0483 / 0489 / 0504 inchangées.
//   (Un premier lancement juste avant s'était arrêté à l'étape 1 sans rien écrire : le droit de création était retiré
//   avant l'envoi de la requête ; corrigé — il est retiré après la réponse.)
// Ne pas relancer sans nouvelle autorisation : chaque exécution laisse ses propres traces R1 / R2.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ROOT = path.resolve(__dirname, '../..')

// ── 0. Garde-fous AVANT toute connexion ──────────────────────────────────────────────────────────────────────────
const refuse = m => { console.error('REFUS : ' + m); process.exit(2) }
if (process.env.B179_TEST_SHOP_GO !== 'oui') refuse('autorisation explicite absente (B179_TEST_SHOP_GO=oui) — rien n’est lancé')
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.CAPTURE_BASE || '')) refuse('serveur local obligatoire (CAPTURE_BASE)')
if (process.env.CAPTURE_PROD_READONLY) refuse('CAPTURE_PROD_READONLY positionné : ce test écrit, il ne peut pas tourner en lecture seule')
// Tâches planifiées (UTC) : Vercel (vercel.json) + pg_cron (daily-report 20:00, low-stock-alert 07:00)
const CRONS = ['04:00', '04:30', '05:00', '06:00', '07:00', '07:15', '08:00', '09:00', '19:30', '20:00']
const minutesToNextCron = (now = new Date()) => Math.min(...CRONS.map(hm => {
  const [h, m] = hm.split(':').map(Number); let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m)
  if (d <= now.getTime()) d += 86400e3; return (d - now.getTime()) / 60e3
}))
if (minutesToNextCron() < 45) refuse(`prochaine tâche planifiée dans ${Math.floor(minutesToNextCron())} min (< 45) : fenêtre trop courte`)

const env = {}
for (const l of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ALPHA_SHOP_ID = 'a0000000-0000-0000-0000-000000000001'
const ALPHA_ENTITY_ID = 'c7978fca-2e9f-499c-a0ef-e4db9e12d483'
const OWNER_ID = '69c7fc88-b01a-481c-856e-b02075ee0cdd'
const OWNER_EMAIL = 'admin@northcode.ng'
const HISTORICAL = ['BOU-0408', 'BOU-0483', 'BOU-0489', 'BOU-0504']
const RUN = 't179' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
const TAG = `TEST 179 ${RUN}`
const RID = step => `TEST-179-${RUN}-${step}`                  // request_id : 8 à 120 caractères [A-Za-z0-9_.:-]
const G = { shopId: null, supplierId: null, productId: null, batchId: null, auditId: null, step: '0 préparation', createLeft: 1 }

let pass = 0
const ok = (c, m) => { if (!c) throw Object.assign(new Error(m), { stop: true }); pass++; console.log(`  ok    ${m}`) }
const sha = v => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex')
const one = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data }

// ── Garde du navigateur : 5 routes, chacune limitée aux identifiants TEST de l'exécution ────────────────────────
const RULES = [
  { label: 'création de la boutique TEST', method: 'POST', path: p => p === '/api/shops',
    check: (b) => !G.shopId && G.createLeft > 0 && b?.name === TAG },
  { label: 'traitement du lot TEST', method: 'POST', path: p => p === '/api/stock/batch-treatments',
    check: (b) => !!G.batchId && b?.batch_id === G.batchId },
  { label: 'archivage du produit TEST', method: 'DELETE', path: p => p === '/api/products',
    check: (_b, url) => !!G.productId && url.searchParams.get('id') === G.productId },
  { label: 'désactivation de la boutique TEST', method: 'DELETE', path: p => !!G.shopId && p === `/api/shops/${G.shopId}`, check: () => true },
  { label: 'suppression définitive de la boutique TEST', method: 'POST', path: p => !!G.shopId && p === `/api/shops/${G.shopId}`, check: () => true },
]
function ruleFor(method, urlStr, body) {
  const url = new URL(urlStr)
  if (url.origin !== process.env.CAPTURE_BASE.replace(/\/$/, '')) return null
  if (G.shopId && G.shopId === ALPHA_SHOP_ID) return null                  // jamais Alpha comme boutique TEST
  if (/\/api\/sales\/|\/api\/offline|\/rest\/v1\//.test(url.pathname)) return null
  return RULES.find(r => r.method === method && r.path(url.pathname) && r.check(body, url)) || null
}
const guard = {
  sent: [], blocked: [],
  allows(request) {
    let body = null; try { body = request.postDataJSON() } catch {}
    const r = ruleFor(request.method(), request.url(), body)
    if (r) this.sent.push(r.label); else this.blocked.push(`${request.method()} ${new URL(request.url()).pathname}`)
    return !!r
  },
}
let page = null
async function api(method, url, body) {
  // Double garde : refus AVANT l'envoi si la requête ne vise pas un objet TEST de l'exécution
  if (!ruleFor(method, process.env.CAPTURE_BASE + url, body)) throw Object.assign(new Error(`écriture refusée par la garde : ${method} ${url}`), { stop: true })
  const res = await page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    let json = null; try { json = await r.json() } catch {}
    return { status: r.status, json }
  }, { method, url, body })
  if (method === 'POST' && url === '/api/shops') G.createLeft--
  return res
}

// ── Lectures (clé serveur, aucune écriture) ──────────────────────────────────────────────────────────────────────
async function realData() {
  const alphaTreatments = (await db.from('batch_treatments').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA_SHOP_ID)).count
  const alphaMovements = (await db.from('stock_movements').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA_SHOP_ID)).count
  const counter = (await one(db.from('shop_sale_counters').select('counter').eq('shop_id', ALPHA_SHOP_ID).maybeSingle()))?.counter ?? null
  const hist = await one(db.from('sales').select('id, sale_number, sale_status, review_reason, reviewed_at').eq('shop_id', ALPHA_SHOP_ID).in('sale_number', HISTORICAL).order('id'))
  const histItems = await one(db.from('sale_items').select('id, sale_id, quantity, batch_unallocated, stock_shortfall').in('sale_id', hist.map(s => s.id)).order('id'))
  const histAlloc = histItems.length ? await one(db.from('sale_item_batches').select('id, sale_item_id, batch_id, quantity').in('sale_item_id', histItems.map(i => i.id)).order('id')) : []
  const alphaProducts = await one(db.from('products').select('id, quantity, is_active').eq('shop_id', ALPHA_SHOP_ID).order('id'))
  const alphaLots = await one(db.from('product_batches').select('id, quantity, expiry_date').eq('shop_id', ALPHA_SHOP_ID).order('id'))
  const realShops = (await db.from('shops').select('id', { count: 'exact', head: true }).not('name', 'like', 'TEST 179 %')).count
  const owner = await one(db.from('entity_members').select('entity_id, user_id, role, is_active, updated_at').eq('entity_id', ALPHA_ENTITY_ID).eq('user_id', OWNER_ID).maybeSingle())
  return { alphaTreatments, alphaMovements, counter, histCount: hist.length, hist: sha([hist, histItems, histAlloc]), alpha: sha([alphaProducts, alphaLots]), realShops,
           ownerRole: owner?.role, ownerActive: owner?.is_active, ownerUpdatedAt: owner?.updated_at }
}
async function state() {
  const p = G.productId ? await one(db.from('products').select('quantity, is_active').eq('id', G.productId).maybeSingle()) : null
  const l = G.batchId ? await one(db.from('product_batches').select('quantity, expiry_date').eq('id', G.batchId).maybeSingle()) : null
  const t = G.batchId ? await one(db.from('batch_treatments').select('id, action, quantity, lot_qty_before, lot_qty_after, product_qty_before, product_qty_after, supplier_id, supplier_name, request_id, created_at').eq('batch_id', G.batchId).order('created_at')) : []
  const m = G.productId ? await one(db.from('stock_movements').select('id, type, quantity, previous_qty, new_qty, batch_id, batch_treatment_id, created_at').eq('product_id', G.productId).order('created_at')) : []
  return { product: p, lot: l, treatments: t, movements: m }
}
async function testObjectsPresent() {
  const out = {}
  if (!G.shopId) return out
  for (const t of ['shops', 'shop_members', 'products', 'product_batches', 'suppliers', 'batch_treatments', 'batch_treatment_photos', 'stock_movements', 'sales',
                   'categories', 'customers', 'expenses', 'notes', 'shop_notes', 'shop_sale_counters', 'subscriptions', 'push_subscriptions', 'admin_notifications',
                   'inventory_sessions', 'inventory_counts', 'purchase_orders', 'product_supplier_prices', 'stock_reservations', 'opening_balance_counters',
                   'expense_budgets', 'agent_commissions', 'audit_logs', 'deleted_records_log']) {
    const col = t === 'shops' ? 'id' : 'shop_id'
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true }).eq(col, G.shopId)
    out[t] = error ? `erreur ${error.code}` : count
  }
  if (G.batchId) out.sale_item_batches = (await db.from('sale_item_batches').select('id', { count: 'exact', head: true }).eq('batch_id', G.batchId)).count
  return out
}
const step = s => { G.step = s; console.log(`\n${s}`) }

;(async () => {
  const { session, BASE } = require('./lib/capture.js')
  console.log(`TEST RÉEL 179 — boutique « ${TAG} » · serveur ${BASE} · prochaine tâche planifiée dans ${Math.floor(minutesToNextCron())} min`)

  step('0. Contrôles préalables (lecture seule)')
  const shopRow = await one(db.from('shops').select('id, name, entity_id, owner_id, deleted_at').eq('id', ALPHA_SHOP_ID).single())
  const ownerUser = (await db.auth.admin.getUserById(OWNER_ID)).data.user
  ok(shopRow.name === 'Boutique Alpha' && shopRow.entity_id === ALPHA_ENTITY_ID && ownerUser?.email === OWNER_EMAIL, 'Alpha, son entreprise et le compte d’essai sont ceux attendus')
  ok(!!(await one(db.from('admin_users').select('tier').eq('user_id', OWNER_ID).is('revoked_at', null).maybeSingle()))?.tier, 'le compte d’essai est super_admin (suppression définitive)')
  ok((await db.from('shops').select('id', { count: 'exact', head: true }).like('name', 'TEST 179 %')).count === 0, 'aucune boutique « TEST 179 … » préexistante')
  ok((await db.from('batch_treatments').select('id').limit(1)).error === null, 'la 179 est présente')
  const before = await realData()
  ok(before.histCount === 4, 'les 4 ventes historiques sont présentes')

  const s = await session({ email: OWNER_EMAIL, write: guard })
  page = s.page
  await page.goto(`${BASE}/fr/stock/expiry`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(3000)

  step('1. Boutique TEST (vraie route POST /api/shops)')
  const created = await api('POST', '/api/shops', { name: TAG, city: 'TEST' })
  ok(created.status === 200 && created.json?.shop?.id, `boutique créée (${created.status})`)
  G.shopId = created.json.shop.id
  ok(G.shopId !== ALPHA_SHOP_ID, `TEST_SHOP_ID ${G.shopId} ≠ ALPHA_SHOP_ID`)
  const ts = await one(db.from('shops').select('id, name, entity_id, owner_id, deleted_at, timezone, currency, country').eq('id', G.shopId).single())
  ok(ts.name === TAG && ts.entity_id === ALPHA_ENTITY_ID && ts.owner_id === OWNER_ID && !ts.deleted_at, `en base : « ${ts.name} », entreprise d’Alpha, ${ts.country} / ${ts.currency} / ${ts.timezone}`)
  ok((await one(db.from('shop_members').select('role, is_active').eq('shop_id', G.shopId).eq('user_id', OWNER_ID).single())).role === 'owner', 'appartenance propriétaire créée')

  step('2. Préparation directe (boutique TEST uniquement ; mêmes champs que la création de produit de l’application)')
  const today = (await db.rpc('shop_business_date', { p_shop_id: G.shopId, p_at: new Date().toISOString() })).data
  const d = n => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const insert = async (table, row) => {
    if (row.shop_id !== G.shopId || G.shopId === ALPHA_SHOP_ID) throw Object.assign(new Error(`insertion hors boutique TEST refusée (${table})`), { stop: true })
    return (await one(db.from(table).insert(row).select('id').single())).id
  }
  G.supplierId = await insert('suppliers', { shop_id: G.shopId, name: `${TAG} fournisseur` })
  G.productId = await insert('products', { shop_id: G.shopId, name: `${TAG} produit`, quantity: 5, selling_price: 100, buying_price: 50, unit: 'piece', is_active: true, supplier_id: G.supplierId })
  await insert('stock_movements', { shop_id: G.shopId, product_id: G.productId, type: 'in', quantity: 5, reason: 'Stock initial', performed_by: OWNER_ID, previous_qty: 0, new_qty: 5 })
  G.batchId = await insert('product_batches', { shop_id: G.shopId, product_id: G.productId, supplier_id: G.supplierId, quantity: 5, initial_quantity: 5, buying_price: 50, expiry_date: d(30), source: 'backfill' })
  let st = await state()
  ok(st.product.quantity === 5 && st.lot.quantity === 5 && st.lot.expiry_date === d(30) && st.movements.length === 1, `produit 5, lot 5 (péremption ${d(30)}), 1 mouvement « Stock initial »`)
  console.log(`  identifiants : TEST_SHOP_ID ${G.shopId} · SUPPLIER_ID ${G.supplierId} · PRODUCT_ID ${G.productId} · BATCH_ID ${G.batchId}`)

  const treat = (b) => api('POST', '/api/stock/batch-treatments', { batch_id: G.batchId, ...b })

  step('A. quantity_adjustment +1 (counting_error)')
  const a = await treat({ action: 'quantity_adjustment', new_quantity: 6, reason_code: 'counting_error', request_id: RID('A') })
  st = await state()
  ok(a.status === 200 && a.json?.data?.already === false, `accepté (${a.status})`)
  ok(st.product.quantity === 6 && st.lot.quantity === 6 && st.treatments.length === 1 && st.treatments[0].action === 'quantity_adjustment' && st.treatments[0].quantity === 1, 'produit 6, lot 6, 1 traitement (+1)')
  ok(st.movements.length === 2 && st.movements[1].type === 'adjustment' && st.movements[1].quantity === 1 && st.movements[1].batch_id === G.batchId && st.movements[1].batch_treatment_id === st.treatments[0].id,
    '1 mouvement d’ajustement +1, lié au lot et au traitement')

  step('B. Idempotence')
  const b1 = await treat({ action: 'quantity_adjustment', new_quantity: 6, reason_code: 'counting_error', request_id: RID('A') })
  st = await state()
  ok(b1.status === 200 && b1.json?.data?.already === true && b1.json.data.treatment_id === st.treatments[0].id && st.treatments.length === 1 && st.movements.length === 2 && st.product.quantity === 6,
    'même requête rejouée : même événement, aucun double effet')
  const b2 = await treat({ action: 'quantity_adjustment', new_quantity: 7, reason_code: 'counting_error', request_id: RID('A') })
  st = await state()
  ok(b2.status === 409 && b2.json?.code === 'batch_request_conflict' && st.treatments.length === 1 && st.movements.length === 2 && st.product.quantity === 6, 'même identifiant, autre valeur → P0041 (409), rien modifié')

  step('C. date_correction J+30 → hier')
  const c = await treat({ action: 'date_correction', new_expiry_date: d(-1), note: `${TAG} étiquette relue`, request_id: RID('C') })
  st = await state()
  ok(c.status === 200 && st.lot.expiry_date === d(-1) && st.product.quantity === 6 && st.lot.quantity === 6 && st.movements.length === 2 && st.treatments.length === 2,
    `date ${d(-1)}, produit / lot 6 inchangés, aucun mouvement, 2e traitement`)

  step('D. dispose 2')
  const dd = await treat({ action: 'dispose', quantity: 2, request_id: RID('D') })
  st = await state()
  ok(dd.status === 200 && st.product.quantity === 4 && st.lot.quantity === 4 && st.movements.length === 3 && st.movements[2].type === 'out' && st.movements[2].quantity === 2, 'produit 4, lot 4, mouvement de sortie 2')

  step('E. supplier_return 1')
  const e = await treat({ action: 'supplier_return', quantity: 1, request_id: RID('E') })
  st = await state()
  const ev = st.treatments[3]
  ok(e.status === 200 && st.product.quantity === 3 && st.lot.quantity === 3 && st.movements.length === 4 && st.movements[3].type === 'out' && st.movements[3].quantity === 1, 'produit 3, lot 3, mouvement de sortie 1')
  ok(ev?.action === 'supplier_return' && ev.supplier_id === G.supplierId && ev.supplier_name === `${TAG} fournisseur`, 'fournisseur copié dans l’événement')

  step('F. Historique (vraie route GET)')
  const h = await page.evaluate(async id => (await fetch(`/api/stock/batch-treatments?batch_id=${id}`)).json(), G.batchId)
  const seq = (h.treatments || []).slice().reverse()
  ok(h.available === true && seq.length === 4 && seq.map(x => x.action).join(',') === 'quantity_adjustment,date_correction,dispose,supplier_return', `4 événements dans l’ordre : ${seq.map(x => x.action).join(' → ')}`)
  ok(seq.map(x => `${x.lot_qty_before}>${x.lot_qty_after}`).join(',') === '5>6,6>6,6>4,4>3', `quantités du lot : ${seq.map(x => `${x.lot_qty_before}→${x.lot_qty_after}`).join(', ')}`)

  step('G. dispose final 3')
  const g = await treat({ action: 'dispose', quantity: 3, request_id: RID('G') })
  st = await state()
  ok(g.status === 200 && st.product.quantity === 0 && st.lot && st.lot.quantity === 0 && st.treatments.length === 5, 'produit 0, lot 0 CONSERVÉ, 5e traitement')
  const signed = st.movements.map(m => m.type === 'out' ? -m.quantity : m.quantity)
  ok(st.movements.length === 5 && signed.join(',') === '5,1,-2,-1,-3' && signed.reduce((x, y) => x + y, 0) === 0 && st.product.quantity === 0,
    `mouvements ${signed.join(' / ')} → solde 0 = stock produit ; correction de date et idempotence : 0 mouvement`)

  step('Archivage du produit (vraie route DELETE /api/products)')
  const ar = await api('DELETE', `/api/products?id=${G.productId}`)
  st = await state()
  ok(ar.status === 200 && ar.json?.archived === true && st.product && st.product.is_active === false, `produit archivé, non supprimé (« ${ar.json?.message} »)`)
  const audits = await one(db.from('audit_logs').select('id, action, target_id, metadata, entity_id').eq('shop_id', G.shopId))
  ok(audits.length === 1 && audits[0].action === 'archive_product' && audits[0].target_id === G.productId && String(audits[0].metadata?.product_name).includes(RUN), 'journal : une ligne archive_product attribuable à l’exécution (R1)')
  G.auditId = audits[0].id

  step('Inventaire avant suppression (point 10)')
  const pre = await testObjectsPresent()
  const files = (await db.storage.from('batch-treatment-photos').list(G.shopId)).data || []
  ok(pre.shops === 1 && pre.products === 1 && pre.product_batches === 1 && pre.batch_treatments === 5 && pre.stock_movements === 5 && pre.suppliers === 1 && pre.sales === 0
    && pre.batch_treatment_photos === 0 && pre.sale_item_batches === 0 && files.length === 0, `objets TEST : ${JSON.stringify(pre)} · fichiers ${files.length}`)

  step('Suppression de la boutique TEST (désactivation → suppression définitive super_admin → deleteShops → delete_shops)')
  const soft = await api('DELETE', `/api/shops/${G.shopId}`)
  ok(soft.status === 200 && !!(await one(db.from('shops').select('deleted_at').eq('id', G.shopId).single())).deleted_at, 'boutique TEST désactivée')
  ok((await one(db.from('profiles').select('shop_id').eq('id', OWNER_ID).single())).shop_id === ALPHA_SHOP_ID, 'profil du compte d’essai toujours sur Alpha')
  const hard = await api('POST', `/api/shops/${G.shopId}`)
  ok(hard.status === 200 && hard.json?.success === true, `suppression définitive acceptée (${hard.status})`)

  step('Contrôles après suppression')
  const post = await testObjectsPresent()
  const zero = Object.entries(post).filter(([t]) => t !== 'deleted_records_log').every(([, n]) => n === 0)
  ok(zero, `0 donnée opérationnelle TEST : ${JSON.stringify(post)}`)
  for (const [t, col, id] of [['products', 'id', G.productId], ['product_batches', 'id', G.batchId], ['suppliers', 'id', G.supplierId], ['batch_treatments', 'batch_id', G.batchId],
                              ['stock_movements', 'product_id', G.productId], ['sale_item_batches', 'batch_id', G.batchId]])
    ok((await db.from(t).select('id', { count: 'exact', head: true }).eq(col, id)).count === 0, `${t} : 0 ligne pour l’identifiant TEST`)
  const r1 = await one(db.from('audit_logs').select('id, shop_id, action, target_id, entity_id, metadata').eq('id', G.auditId).maybeSingle())
  ok(r1 && r1.shop_id === null && r1.action === 'archive_product' && r1.target_id === G.productId && String(r1.metadata?.product_name).includes(RUN), `R1 conservée : audit_logs ${G.auditId} (shop_id NULL, entreprise ${r1?.entity_id})`)
  const r2 = await one(db.from('deleted_records_log').select('id, table_name, record_id, shop_id, record_data').eq('record_id', G.productId))
  ok(r2.length === 1 && r2[0].table_name === 'products' && r2[0].shop_id === G.shopId && String(r2[0].record_data?.name).includes(RUN), `R2 conservée : deleted_records_log ${r2[0]?.id}`)

  step('Données réelles (avant / après)')
  const after = await realData()
  ok(after.alphaTreatments === before.alphaTreatments && after.alphaMovements === before.alphaMovements, `Alpha : traitements ${after.alphaTreatments}, mouvements ${after.alphaMovements} — identiques`)
  ok(after.counter === before.counter, `compteur de ventes d’Alpha inchangé (${after.counter})`)
  ok(after.hist === before.hist, '4 ventes historiques identiques (ventes, lignes, allocations)')
  ok(after.alpha === before.alpha, 'produits et lots d’Alpha identiques')
  ok(after.realShops === before.realShops, `boutiques réelles : ${after.realShops} (hors TEST) — inchangé`)
  ok(after.ownerRole === before.ownerRole && after.ownerActive === before.ownerActive, `entity_members du propriétaire : rôle et statut inchangés (R3 : updated_at ${before.ownerUpdatedAt === after.ownerUpdatedAt ? 'inchangé' : 'modifié, accepté'})`)
  ok(!guard.blocked.some(x => /\/api\/(shops|products|stock|product-batches)/.test(x)), `navigateur : ${guard.sent.length} écriture(s) autorisée(s), ${guard.blocked.length} bloquée(s)${guard.blocked.length ? ' (' + [...new Set(guard.blocked)].join(', ') + ')' : ''}`)

  await s.browser.close()
  console.log(`\nTEST RÉEL 179 — ${pass} contrôles réussis · exécution ${RUN} · traces conservées : audit_logs ${G.auditId}, deleted_records_log ${r2[0].id}`)
  process.exit(0)
})().catch(async e => {
  // ARRÊT au premier écart : aucun nettoyage, état et identifiants affichés
  console.error(`\nARRÊT — étape « ${G.step} » : ${e.message}`)
  console.error(`  RUN ${RUN} · TEST_SHOP_ID ${G.shopId} · PRODUCT_ID ${G.productId} · BATCH_ID ${G.batchId} · SUPPLIER_ID ${G.supplierId}`)
  try { console.error('  état : ' + JSON.stringify(await state())); console.error('  objets TEST présents : ' + JSON.stringify(await testObjectsPresent())) } catch (x) { console.error('  lecture de l’état impossible : ' + x.message) }
  console.error(`  prochaine tâche planifiée dans ${Math.floor(minutesToNextCron())} min — AUCUN nettoyage tenté`)
  process.exit(1)
})
