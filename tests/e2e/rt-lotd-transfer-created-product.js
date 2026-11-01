// Lot D des ajouts (1er nov. 2026) — produit CRÉÉ à la réception d'un transfert, test RÉEL entre Boutique Alpha et
// « yahaya & zainab 2 » (même entreprise), serveur LOCAL, compte propriétaire. Accord de l'utilisateur requis.
//   1. produit TEST à Alpha : code-barres maison, seuil 7, emplacement, catégorie présente aussi à l'arrivée, 3 en stock ;
//   2. envoi de 2 unités Alpha → YZ, réception à YZ en créant le produit ;
//   3. le produit créé à YZ reprend code-barres, seuil, emplacement et la catégorie DE YZ du même nom ; 2 en stock ;
//   4. journal de YZ : « Produit créé », origine le transfert (référence, boutique de départ).
// Restent (exemples gardés) : le produit TEST à Alpha (1 en stock), celui créé à YZ (2), le transfert, mouvements et journal.
// Usage : CAPTURE_BASE=http://localhost:3000 RTLOTD_GO=oui node tests/e2e/rt-lotd-transfer-created-product.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RTLOTD_GO !== 'oui') { console.error('Écriture réelle : RTLOTD_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'
const NAME = 'TEST Fiche transférée (lot D)', SKU = 'TEST-LOTD-001', LOC = 'Rayon TEST lot D'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

;(async () => {
  const W = await enableWrite({ test: 'produit créé à la réception d’un transfert (lot D)', routes: [/\/api\/(products|stock-transfers)/] })
  const db = W.db
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: 'admin@northcode.ng' })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  const call = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))

  const { data: already } = await db.from('products').select('id').in('shop_id', [ALPHA, YZ]).eq('name', NAME)
  if ((already || []).length) { console.log('Arrêt : produit TEST du lot D déjà présent, rien écrit.'); process.exit(1) }
  const { data: catsA } = await db.from('categories').select('id, name').eq('shop_id', ALPHA)
  const { data: catsY } = await db.from('categories').select('id, name').eq('shop_id', YZ)
  // Catégorie de même nom à l'arrivée : reprise ; sinon, AUCUNE (jamais celle d'une autre boutique)
  const shared = (catsA || []).find(a => (catsY || []).some(y => norm(y.name) === norm(a.name))) || (catsA || [])[0]
  const catY = (catsY || []).find(y => norm(y.name) === norm(shared.name)) || null
  console.log(`Catégorie à Alpha : « ${shared.name} » ; à l'arrivée : ${catY ? '« ' + catY.name + ' »' : 'aucune de même nom'}`)

  console.log('\n1. Produit TEST à Alpha')
  const mk = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 900, buying_price: 500, quantity: 3, unit: 'piece', sku: SKU, low_stock_threshold: 7, location: LOC, category_id: shared.id })
  const P = mk.body.data
  ok(mk.status === 200 && P?.id, `créé : ${NAME} (3 en stock, code ${SKU}, seuil 7, « ${LOC} »)`, mk.body)

  console.log('\n2. Envoi Alpha → YZ puis réception à YZ (produit créé)')
  const sent = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 2 }], send: true })
  const T = sent.body.data?.id
  ok(sent.status === 200 && T, `envoyé ${sent.body.data?.reference}`, sent.body)
  const { data: items } = await db.from('stock_transfer_items').select('id').eq('stock_transfer_id', T)
  const rec = await call('POST', '/api/stock-transfers/receive', { transfer_id: T, acting_shop_id: YZ, receipt_key: require('crypto').randomUUID(), items: [{ transfer_item_id: items[0].id, quantity_received: 2, destination_product_id: null }] })
  const created = rec.body.data?.created_products || []
  ok(rec.status === 200 && created.length === 1, `reçu à YZ, 1 produit créé (${rec.status})`, rec.body)

  console.log('\n3. Fiche du produit créé à YZ')
  const { data: Y } = await db.from('products').select('id, name, sku, low_stock_threshold, location, category_id, quantity, is_active').eq('id', created[0]?.product_id).single()
  ok(Y.name === NAME && Y.quantity === 2, `« ${Y.name} », 2 en stock (${Y.quantity})`)
  ok(Y.sku === SKU, `code-barres repris (${Y.sku})`)
  ok(Y.low_stock_threshold === 7, `seuil repris (${Y.low_stock_threshold})`)
  ok(Y.location === LOC, `emplacement repris (${Y.location})`)
  ok(catY ? Y.category_id === catY.id : Y.category_id === null, catY ? `catégorie « ${catY.name} » de YZ (jamais celle d’Alpha)` : 'aucune catégorie de même nom à YZ : produit sans catégorie (jamais celle d’Alpha)')

  console.log('\n4. Journal de YZ')
  const { data: logs } = await db.from('audit_logs').select('action, metadata').eq('shop_id', YZ).eq('target_id', Y.id).eq('action', 'create_product')
  const meta = logs?.[0]?.metadata || {}
  ok((logs || []).length === 1 && meta.source === 'transfer' && meta.reference === sent.body.data?.reference && meta.from_shop, `« Produit créé » à la réception de ${meta.reference} (depuis ${meta.from_shop})`, logs)

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
