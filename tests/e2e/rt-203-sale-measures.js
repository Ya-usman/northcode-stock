// Migration 203 — mesures de vente, test RÉEL (accord de l'utilisateur requis) sur Boutique Alpha, serveur LOCAL, compte
// propriétaire. Produit TEST dédié, gardé en exemple : « TEST Riz mesures (rt-203) », compté en grammes (20 kg en stock,
// 750 F le kilo), vendu au verre (≈ 250 g, 200 F), à la boîte (≈ 700 g, 550 F) et au seau (≈ 8 kg, 6 500 F).
//   1. création avec 3 mesures ; mesures invalides refusées (contenu 1, kilo à 900 g) ;
//   2. ventes : boîte à 500 F refusée (prix de la mesure), mesure inconnue refusée, quantité incohérente refusée : rien écrit ;
//   3. vente de 3 boîtes + 1 seau acceptée : stock 20 000 → 9 900 g, lignes enregistrées avec leur mesure ;
//   4. reçu public : « 3 » × « … · boîte » à 550, jamais en grammes ;
//   5. modification de la vente refusée (elle s'annule et se refait) ; journal de création avec les mesures.
// Usage : CAPTURE_BASE=http://localhost:3000 RT203_GO=oui node tests/e2e/rt-203-sale-measures.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT203_GO !== 'oui') { console.error('Écriture réelle : RT203_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'TEST Riz mesures (rt-203)'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const uuid = () => require('crypto').randomUUID()
const unitPrice = (price, units) => Number((price / units).toFixed(8))

;(async () => {
  const W = await enableWrite({ test: 'mesures de vente après la 203', routes: [/\/api\/(products|sales\/checkout|sales\/edit)/] })
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
  const { data: exists } = await db.from('products').select('id').eq('shop_id', ALPHA).eq('name', NAME)
  if ((exists || []).length) { console.log('Arrêt : produit TEST des mesures déjà présent, rien écrit.'); process.exit(1) }
  const { data: shop } = await db.from('shops').select('tax_rate').eq('id', ALPHA).single()
  const taxRate = Number(shop.tax_rate) || 0
  const qty = async id => (await db.from('products').select('quantity').eq('id', id).single()).data.quantity
  const line = (pid, key, n, units, price, extra = {}) => ({ product_id: pid, product_name: NAME, quantity: n * units, unit_price: unitPrice(price, units), original_price: unitPrice(price, units), measure_key: key, measure_label: null, measure_qty: n, measure_units: units, ...extra })
  const sale = items => {
    const subtotal = items.reduce((s, i) => s + Math.round(i.quantity * i.unit_price), 0), tax = taxRate > 0 ? subtotal * taxRate / 100 : 0, total = subtotal + tax
    return call('POST', '/api/sales/checkout', { shop_id: ALPHA, client_request_id: uuid(), subtotal, discount: 0, tax, total, payment_method: 'cash', notes: 'TEST rt-203', items, payments: [{ method: 'cash', amount: total, reference: null }] })
  }
  const RIZ = [{ key: 'bucket', units: 8000, price: 6500 }, { key: 'glass', units: 250, price: 200 }, { key: 'box', units: 700, price: 550 }]

  console.log('\n1. Produit vendu à la mesure')
  const bad1 = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 0.75, buying_price: 0.5, quantity: 20000, unit: 'g', sale_measures: [{ key: 'glass', units: 1, price: 200 }] })
  ok(bad1.status === 400 && bad1.body.field === 'sale_measures', `contenu 1 refusé : « ${bad1.body.error} »`)
  const bad2 = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 0.75, buying_price: 0.5, quantity: 20000, unit: 'g', sale_measures: [{ key: 'kg', units: 900, price: 700 }] })
  ok(bad2.status === 400 && bad2.body.field === 'sale_measures', `kilo à 900 g refusé : « ${bad2.body.error} »`)
  const mk = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 0.75, buying_price: 0.5, quantity: 20000, unit: 'g', sale_measures: RIZ })
  const P = mk.body.data
  ok(mk.status === 200 && P?.id && (P.sale_measures || []).map(m => `${m.key}:${m.units}:${Number(m.price)}`).join() === 'glass:250:200,box:700:550,bucket:8000:6500', 'créé : 20 kg, verre / boîte / seau (rangés par contenu)', mk.body)
  ok(await qty(P.id) === 20000, 'stock : 20 000 g')

  console.log('\n2. Ventes refusées par le serveur (rien écrit)')
  const cheap = await sale([line(P.id, 'box', 3, 700, 500)])
  ok(cheap.status === 400 && cheap.body.code === 'price_below_floor', `3 boîtes à 500 F refusées : « ${cheap.body.error} »`)
  const unknown = await sale([line(P.id, 'bag', 1, 50000, 30000)])
  ok(unknown.status === 400 && unknown.body.code === 'measure_invalid', `sac (absent du produit) refusé : « ${unknown.body.error} »`)
  const wrongQty = await sale([line(P.id, 'box', 3, 700, 550, { quantity: 2000 })])
  ok(wrongQty.status === 400, `quantité ≠ 3 × 700 refusée (${wrongQty.status})`)
  ok(await qty(P.id) === 20000, 'refus : stock inchangé (20 000 g)')

  console.log('\n3. Vente de 3 boîtes et 1 seau')
  const good = await sale([line(P.id, 'box', 3, 700, 550), line(P.id, 'bucket', 1, 8000, 6500)])
  ok(good.status === 200, `acceptée (${good.status})`, good.body)
  ok(await qty(P.id) === 9900, 'stock 20 000 → 9 900 g (2 100 + 8 000)')
  const saleId = good.body.sale?.id || good.body.sale_id
  const { data: items } = await db.from('sale_items').select('quantity, unit_price, subtotal, measure_key, measure_label, measure_qty, measure_units').eq('product_id', P.id).order('quantity')
  ok(JSON.stringify((items || []).map(i => [i.measure_key, i.measure_qty, i.measure_units, i.quantity, Math.round(Number(i.subtotal))])) === '[["box",3,700,2100,1650],["bucket",1,8000,8000,6500]]', 'lignes enregistrées : 3 boîtes (2 100 g, 1 650 F) et 1 seau (8 000 g, 6 500 F)', items)
  const { data: s } = await db.from('sales').select('id, total, receipt_token').eq('id', saleId).single()
  ok(Number(s.total) === Math.round((1650 + 6500) * (1 + taxRate / 100)), `total ${s.total}`)

  console.log('\n4. Reçu public')
  const html = await fetch(`${BASE}/r/${s.receipt_token}`).then(r => r.text())
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#x27;|\s+/g, ' ')
  ok(text.includes(`${NAME} · boîte`) && text.includes(`${NAME} · seau`), 'lignes « … · boîte » et « … · seau »')
  ok(/3 × 550/.test(text.replace(/ /g, ' ')) && !/2100|2 100|8000 ×/.test(text.replace(/ /g, ' ')), '« 3 × 550 », jamais en grammes')

  console.log('\n5. Modification et journal')
  const ed = await call('POST', '/api/sales/edit', { sale_id: saleId, payment_method: 'cash', items: [{ product_id: P.id, product_name: NAME, quantity: 2100, unit_price: unitPrice(550, 700) }] })
  ok(ed.status === 400 && ed.body.code === 'sale_has_measures_not_editable', `modification refusée : « ${ed.body.error} »`)
  ok(await qty(P.id) === 9900, 'stock toujours 9 900 g')
  const { data: logs } = await db.from('audit_logs').select('action, metadata').eq('shop_id', ALPHA).eq('target_id', P.id).order('created_at', { ascending: true }).limit(3)
  ok((logs || []).some(l => l.action === 'create_product'), 'journal : création du produit')

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
