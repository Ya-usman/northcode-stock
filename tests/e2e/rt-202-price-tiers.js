// Migration 202 — paliers de prix de gros, test RÉEL (accord de l'utilisateur requis) sur Boutique Alpha, serveur LOCAL, compte
// propriétaire. Produit TEST dédié, gardé en exemple : « TEST Gros (rt-202) » (20 en stock, 500 F, paliers dès 5 : 450 F, dès 10 : 420 F).
//   1. création avec 2 paliers ; palier au-dessus du détail refusé (création et modification) ;
//   2. vente de 4 pièces à 450 F REFUSÉE (minimum pas atteint) : rien écrit ;
//   3. vente de 5 pièces à 450 F puis de 10 à 420 F ACCEPTÉES (meilleur palier atteint) : stock 20 → 5 ;
//   4. prix changé « à la réception » : journal avec la référence.
// Usage : CAPTURE_BASE=http://localhost:3000 RT202_GO=oui node tests/e2e/rt-202-price-tiers.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT202_GO !== 'oui') { console.error('Écriture réelle : RT202_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'TEST Gros (rt-202)'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const uuid = () => require('crypto').randomUUID()

;(async () => {
  const W = await enableWrite({ test: 'paliers de gros après la 202', routes: [/\/api\/(products|sales\/checkout)/] })
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
  if ((exists || []).length) { console.log('Arrêt : produit TEST du gros déjà présent, rien écrit.'); process.exit(1) }
  const { data: shop } = await db.from('shops').select('tax_rate').eq('id', ALPHA).single()
  const taxRate = Number(shop.tax_rate) || 0
  const qty = async id => (await db.from('products').select('quantity').eq('id', id).single()).data.quantity
  const sale = (pid, quantity, unit) => {
    const subtotal = Math.round(quantity * unit), tax = taxRate > 0 ? subtotal * taxRate / 100 : 0, total = subtotal + tax
    return call('POST', '/api/sales/checkout', { shop_id: ALPHA, client_request_id: uuid(), subtotal, discount: 0, tax, total, payment_method: 'cash', notes: 'TEST rt-202',
      items: [{ product_id: pid, product_name: NAME, quantity, unit_price: unit, original_price: 500 }], payments: [{ method: 'cash', amount: total, reference: null }] })
  }

  console.log('\n1. Produit avec prix de gros')
  const bad = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 500, buying_price: 300, quantity: 10, unit: 'piece', price_tiers: [{ min_qty: 5, price: 550 }] })
  ok(bad.status === 400 && bad.body.field === 'price_tiers', `gros au-dessus du détail refusé à la création : « ${bad.body.error} »`)
  const mk = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: 500, buying_price: 300, quantity: 20, unit: 'piece', price_tiers: [{ min_qty: 10, price: 420 }, { min_qty: 5, price: 450 }] })
  const P = mk.body.data
  ok(mk.status === 200 && P?.id && JSON.stringify((P.price_tiers || []).map(x => [x.min_qty, Number(x.price)])) === '[[5,450],[10,420]]', 'créé : 20 en stock, paliers dès 5 : 450 F, dès 10 : 420 F (triés)', mk.body)
  const up = await call('PATCH', '/api/products', { id: P.id, shop_id: ALPHA, selling_price: 400 })
  ok(up.status === 400 && up.body.field === 'price_tiers', `détail baissé sous le gros refusé : « ${up.body.error} »`)

  console.log('\n2. Ventes : le serveur contrôle le minimum')
  const four = await sale(P.id, 4, 450)
  ok(four.status === 400 && four.body.code === 'price_below_floor', `4 pièces à 450 F refusées : « ${four.body.error} »`)
  ok(await qty(P.id) === 20, 'refus : stock inchangé (20)')
  const five = await sale(P.id, 5, 450)
  ok(five.status === 200, `5 pièces à 450 F acceptées (${five.status})`, five.body)
  const nine = await sale(P.id, 9, 420)
  ok(nine.status === 400 && nine.body.code === 'price_below_floor', `9 pièces à 420 F refusées (palier de 10 pas atteint) : « ${nine.body.error} »`)
  const ten = await sale(P.id, 10, 420)
  ok(ten.status === 200, `10 pièces à 420 F acceptées (${ten.status})`, ten.body)
  ok(await qty(P.id) === 5, 'stock 20 → 5')
  const { data: items } = await db.from('sale_items').select('unit_price, quantity').eq('product_id', P.id).order('quantity')
  ok(JSON.stringify((items || []).map(i => [i.quantity, Number(i.unit_price)])) === '[[5,450],[10,420]]', 'lignes enregistrées : 5 × 450 F et 10 × 420 F')

  console.log('\n3. Prix changé à la réception : journal')
  const rec = await call('PATCH', '/api/products', { id: P.id, shop_id: ALPHA, selling_price: 520, price_tiers: [{ min_qty: 5, price: 460 }, { min_qty: 10, price: 430 }], reception_ref: 'BC-TEST-202' })
  ok(rec.status === 200, `prix revus (${rec.status})`, rec.body)
  const { data: logs } = await db.from('audit_logs').select('metadata').eq('shop_id', ALPHA).eq('target_id', P.id).eq('action', 'update_product').order('created_at', { ascending: false }).limit(1)
  const meta = logs?.[0]?.metadata || {}
  ok(meta.reception_ref === 'BC-TEST-202' && meta.changes?.selling_price?.to === 520 && (meta.changes?.price_tiers?.to || []).map(x => x.min_qty + ':' + Number(x.price)).join() === '5:460,10:430', 'journal : « à la réception de BC-TEST-202 », détail 500 → 520, paliers revus', meta)

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
