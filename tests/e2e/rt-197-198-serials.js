// Migrations 197 + 198 — numéros de série, test RÉEL (« Applique 197 et 198 », 1er nov. 2026) sur Boutique Alpha, par
// les routes normales du serveur LOCAL, compte propriétaire. Produit TEST dédié, gardé en exemple :
//   création (0 en stock) → suivi activé → réassort de 3 numéros (une transaction) → numéro déjà pris refusé (rien
//   écrit) → vente EN LIGNE : sans numéro / numéro inconnu / doublon refusés, vente valide (numéro vendu, renvoyé pour
//   le ticket) → modification de la vente refusée → vente HORS LIGNE synchronisée avec un numéro inconnu (gardée,
//   « à vérifier ») → annulation des deux ventes (numéros remis en stock, stock rendu) → numéroter au-delà du stock
//   refusé → correction d'un numéro.
// Restent en exemple : le produit TEST, ses 3 numéros, les deux ventes annulées, le journal.
// Usage : CAPTURE_BASE=http://localhost:3000 RT198_GO=oui node tests/e2e/rt-197-198-serials.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT198_GO !== 'oui') { console.error('Écriture réelle : RT198_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'TEST Téléphone numéroté (rt-197)'
const PRICE = 150000
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const uuid = () => require('crypto').randomUUID()

;(async () => {
  const W = await enableWrite({ test: 'numéros de série après les 197 et 198', routes: [/\/api\/(products|sales)/] })
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
  const { data: already } = await db.from('products').select('id').eq('shop_id', ALPHA).eq('name', NAME)
  if ((already || []).length) { console.log(`Arrêt : « ${NAME} » existe déjà, rien écrit.`); process.exit(1) }
  const tag = Date.now().toString(36).toUpperCase()
  const S = [1, 2, 3].map(i => `RT197-${tag}-${i}`)
  const prodState = async id => (await db.from('products').select('quantity').eq('id', id).single()).data.quantity
  const serialState = async s => (await db.from('product_serials').select('status, sale_item_id').eq('shop_id', ALPHA).eq('serial', s).maybeSingle()).data

  console.log('\n1. Produit suivi et réassort')
  const created = await call('POST', '/api/products', { shop_id: ALPHA, name: NAME, selling_price: PRICE, buying_price: 0, quantity: 0, unit: 'piece', is_active: true })
  const P = created.body.data || created.body.product || created.body
  ok(created.status === 200 && P?.id, `produit créé (${created.status})`, created.body)
  const tr = await call('PATCH', '/api/products', { id: P.id, shop_id: ALPHA, track_serials: true })
  ok(tr.status === 200 && (await db.from('products').select('track_serials').eq('id', P.id).single()).data.track_serials === true, 'suivi des numéros activé')
  const noSerial = await call('PUT', '/api/products', { product_id: P.id, shop_id: ALPHA, quantity_to_add: 3, buying_price: 100000 })
  ok(noSerial.status === 400 && noSerial.body.code === 'serial_count_mismatch', `réassort sans numéros refusé : « ${noSerial.body.error} »`)
  const rs = await call('PUT', '/api/products', { product_id: P.id, shop_id: ALPHA, quantity_to_add: 3, buying_price: 100000, serials: S })
  const inStock = (await db.from('product_serials').select('serial, batch_id').eq('product_id', P.id).eq('status', 'in_stock')).data
  ok(rs.status === 200 && await prodState(P.id) === 3 && inStock.length === 3 && inStock.every(x => x.batch_id), `réassort : 3 en stock, 3 numéros rattachés au lot (${rs.status})`, rs.body)
  const dup = await call('PUT', '/api/products', { product_id: P.id, shop_id: ALPHA, quantity_to_add: 1, serials: [S[0].toLowerCase()] })
  ok(dup.status === 409 && dup.body.code === 'serial_taken' && await prodState(P.id) === 3, `numéro déjà pris refusé : « ${dup.body.error} », stock inchangé`)

  console.log('\n2. Vente en ligne')
  const sale = (items, extra = {}) => ({ shop_id: ALPHA, subtotal: items.reduce((s, i) => s + i.quantity * i.unit_price, 0), discount: 0, tax: 0,
    total: items.reduce((s, i) => s + i.quantity * i.unit_price, 0), payment_method: 'cash', client_request_id: uuid(), items,
    payments: [{ amount: items.reduce((s, i) => s + i.quantity * i.unit_price, 0), method: 'cash' }], ...extra })
  const line = (serials, qty = serials.length || 1) => ({ product_id: P.id, product_name: NAME, quantity: qty, unit_price: PRICE, original_price: PRICE, ...(serials.length ? { serials } : {}) })
  const r1 = await call('POST', '/api/sales/checkout', sale([line([], 1)]))
  ok(r1.status === 400 && r1.body.code === 'serial_count_mismatch', `sans numéro : refusée « ${r1.body.error} »`)
  const r2 = await call('POST', '/api/sales/checkout', sale([line(['INCONNU-' + tag])]))
  ok(r2.status === 400 && r2.body.code === 'serial_not_in_stock', `numéro inconnu : refusée « ${r2.body.error} »`)
  const r3 = await call('POST', '/api/sales/checkout', sale([line([S[0], S[0].toLowerCase()])]))
  ok(r3.status === 400 && r3.body.code === 'serial_duplicate_input', `même numéro deux fois : refusée « ${r3.body.error} »`)
  ok(await prodState(P.id) === 3, 'refus : stock inchangé (3)')
  const r4 = await call('POST', '/api/sales/checkout', sale([line([S[0]])]))
  const sold = await serialState(S[0])
  ok(r4.status === 200 && r4.body.sale?.sale_number && sold?.status === 'sold' && sold.sale_item_id, `vente ${r4.body.sale?.sale_number} : ${S[0]} vendu`, r4.body)
  ok(JSON.stringify(r4.body.sale?.sale_items?.[0]?.serials) === JSON.stringify([S[0]]), 'numéro renvoyé avec la ligne (ticket)')
  ok(await prodState(P.id) === 2, 'stock 3 → 2')
  const ed = await call('POST', '/api/sales/edit', { sale_id: r4.body.sale?.id, payment_method: 'cash', items: [{ product_id: P.id, product_name: NAME, quantity: 1, unit_price: PRICE }] })
  ok(ed.status === 400 && ed.body.code === 'sale_has_serials_not_editable', `modification refusée : « ${ed.body.error} »`)

  console.log('\n3. Vente hors ligne synchronisée')
  const localId = `local-rt197-${tag}`
  const off = await call('POST', '/api/sales/sync', { local_id: localId, shop_id: ALPHA, subtotal: 2 * PRICE, discount: 0, tax: 0, total: 2 * PRICE, payment_method: 'cash',
    payments: [{ amount: 2 * PRICE, method: 'cash' }], created_at: new Date(Date.now() - 60000).toISOString(),
    items: [{ product_id: P.id, product_name: NAME, quantity: 2, unit_price: PRICE, original_price: PRICE, subtotal: 2 * PRICE, serials: [S[1], 'INCONNU-' + tag] }] })
  const offSale = off.body.sale
  ok(off.status === 200 && offSale?.id && String(offSale.review_reason || '').includes('serial_unresolved'), `gardée « à vérifier » (${offSale?.review_reason})`, off.body)
  ok((await serialState(S[1]))?.status === 'sold', `${S[1]} vendu (numéro valide)`)

  console.log('\n4. Annulations')
  const c1 = await call('POST', '/api/sales/cancel', { sale_id: r4.body.sale?.id, reason: 'TEST rt-197' })
  const c2 = await call('POST', '/api/sales/cancel', { sale_id: offSale?.id, reason: 'TEST rt-197' })
  ok(c1.status === 200 && c2.status === 200, `deux ventes annulées (${c1.status}, ${c2.status})`, [c1.body, c2.body])
  const back = await Promise.all(S.map(serialState))
  ok(back.every(x => x?.status === 'in_stock' && !x.sale_item_id), `${S.join(', ')} remis en stock`, back)
  ok(await prodState(P.id) === 3, `stock rendu (${await prodState(P.id)})`)

  console.log('\n5. Fiche : numérotation et correction')
  const over = await call('POST', '/api/products/serials', { shop_id: ALPHA, product_id: P.id, serials: [`RT197-${tag}-X`] })
  ok(over.status === 400 && over.body.code === 'serial_exceeds_stock', `numéro de plus que le stock refusé : « ${over.body.error} »`)
  const list = await call('GET', `/api/products/serials?shop_id=${ALPHA}&product_id=${P.id}`)
  const target = (list.body.data || []).find(x => x.serial === S[2])
  const fix = await call('PATCH', '/api/products/serials', { shop_id: ALPHA, id: target?.id, serial: `${S[2]}-B` })
  ok(fix.status === 200 && (await serialState(`${S[2]}-B`))?.status === 'in_stock', `${S[2]} corrigé en ${S[2]}-B`)
  const search = await call('GET', `/api/products/serials?shop_ids=${ALPHA}&q=${encodeURIComponent(S[0])}`)
  ok(search.status === 200 && search.body.data?.[0]?.product_name === NAME, 'recherche d’un numéro : produit trouvé')

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`  lignes modifiées : ${vf.modified.join(' | ')}`)
  console.log(`  traces gardées : ${vf.remaining.length} lignes`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
