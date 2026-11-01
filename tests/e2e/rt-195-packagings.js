// Migration 195 — conditionnements d'achat, test RÉEL (délégation de l'utilisateur, « Applique la 195 », 1er nov. 2026)
// sur Boutique Alpha, par les routes normales du serveur LOCAL, compte propriétaire :
//   ajout « carton de 24 » (par défaut) → refus : doublon, 1 unité, code d'un produit → ajout « sac de 50 » avec code
//   maison → caisse : ce code est reconnu comme un colis → bon BROUILLON en colis chez le fournisseur TEST (le serveur
//   recalcule 3 × 24 = 72 même si l'appareil envoie 1) → colis d'un autre produit refusé → modification du bon (2 sacs
//   de 50 = 100) → bon ANNULÉ → retrait du « sac de 50 ».
// Restent en exemple : le « carton de 24 » du produit, le bon annulé avec ses lignes en colis, le journal.
// Aucun stock modifié. Usage : CAPTURE_BASE=http://localhost:3000 RT195_GO=oui node tests/e2e/rt-195-packagings.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT195_GO !== 'oui') { console.error('Écriture réelle : RT195_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const W = await enableWrite({ test: 'conditionnements d’achat après la 195', routes: [/\/api\/products\/packagings/, /\/api\/purchase-orders$/] })
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

  const { data: prods } = await db.from('products').select('id, name, sku, unit, quantity').eq('shop_id', ALPHA).eq('is_active', true).or('unit.is.null,unit.eq.piece').order('name').limit(2)
  const [P, Q] = prods
  const withSku = (await db.from('products').select('sku').eq('shop_id', ALPHA).not('sku', 'is', null).limit(1).single()).data
  const { data: already } = await db.from('product_packagings').select('id').eq('product_id', P.id)
  if ((already || []).length) { console.log(`Arrêt : ${P.name} a déjà un conditionnement, rien écrit.`); process.exit(1) }
  const supplier = (await db.from('suppliers').select('id, name').eq('shop_id', ALPHA).ilike('name', '%tmvwn76l93cb4%').single()).data
  const stockBefore = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data
  console.log(`Produit : ${P.name} · fournisseur : ${supplier.name}`)

  console.log('\n1. Conditionnements')
  const a = await call('POST', '/api/products/packagings', { shop_id: ALPHA, product_id: P.id, unit: 'carton', units_per_pack: 24, is_default: true })
  ok(a.status === 200 && a.body.data?.is_default === true && a.body.data?.units_per_pack === 24, `carton de 24 ajouté, par défaut (${a.status})`, a.body)
  const dup = await call('POST', '/api/products/packagings', { shop_id: ALPHA, product_id: P.id, unit: 'carton', units_per_pack: 24 })
  ok(dup.status === 409 && /existe déjà/.test(dup.body.error || ''), `doublon refusé : ${dup.status} « ${dup.body.error} »`)
  const one = await call('POST', '/api/products/packagings', { shop_id: ALPHA, product_id: P.id, unit: 'carton', units_per_pack: 1 })
  ok(one.status === 400 && /entre 2 et 100 000/.test(one.body.error || ''), `1 unité par colis refusé : « ${one.body.error} »`)
  const taken = await call('POST', '/api/products/packagings', { shop_id: ALPHA, product_id: P.id, unit: 'bag', units_per_pack: 50, barcode: withSku.sku })
  ok(taken.status === 409 && /déjà utilisé/.test(taken.body.error || ''), `code d’un produit refusé : « ${taken.body.error} »`)
  const code = 'COLIS-RT195-' + Date.now().toString(36).toUpperCase()
  const b = await call('POST', '/api/products/packagings', { shop_id: ALPHA, product_id: P.id, unit: 'bag', units_per_pack: 50, barcode: code })
  ok(b.status === 200 && b.body.data?.is_default === false && b.body.data?.barcode === code, `sac de 50 ajouté avec le code ${code}, pas par défaut`, b.body)
  const list = await call('GET', `/api/products/packagings?shop_id=${ALPHA}&product_id=${P.id}`)
  ok(list.body.data?.length === 2 && list.body.data[0].units_per_pack === 24, 'liste : 2 conditionnements, triés par taille')

  console.log('\n2. Caisse')
  const scan = await call('GET', `/api/products/packagings?shop_id=${ALPHA}&barcode=${encodeURIComponent(code)}`)
  ok(scan.status === 200 && scan.body.data?.product_id === P.id && scan.body.data?.units_per_pack === 50 && scan.body.data?.name === P.name, 'code du sac reconnu comme colis du produit', scan.body)
  ok(!('barcode' in (scan.body.data || {})) && !JSON.stringify(scan.body).match(/price|cost|quantity/), 'réponse minimale : ni prix ni stock')
  const none = await call('GET', `/api/products/packagings?shop_id=${ALPHA}&barcode=INCONNU-RT195`)
  ok(none.status === 200 && none.body.data === null, 'code inconnu : aucun colis')

  console.log('\n3. Bon de commande en colis')
  const po = await call('POST', '/api/purchase-orders', { shop_id: ALPHA, supplier_id: supplier.id, notes: 'TEST étape 9 colis (rt-195)',
    items: [{ product_id: P.id, product_name: P.name, unit: P.unit || 'piece', quantity_ordered: 1, unit_price: 100, packaging_id: a.body.data.id, pack_qty: 3 }] })
  ok(po.status === 200 && po.body.data?.id, `bon brouillon créé ${po.body.data?.reference} (${po.status})`, po.body)
  const poId = po.body.data?.id
  const { data: line1 } = await db.from('purchase_order_items').select('quantity_ordered, pack_unit, units_per_pack, pack_qty, unit_price').eq('purchase_order_id', poId)
  ok(line1?.length === 1 && line1[0].quantity_ordered === 72 && line1[0].pack_unit === 'carton' && line1[0].units_per_pack === 24 && line1[0].pack_qty === 3, 'ligne en base : 3 cartons de 24 = 72 (quantité de l’appareil ignorée)', line1)
  const cross = await call('POST', '/api/purchase-orders', { shop_id: ALPHA, supplier_id: supplier.id,
    items: [{ product_id: Q.id, product_name: Q.name, unit: 'piece', quantity_ordered: 5, unit_price: 100, packaging_id: a.body.data.id, pack_qty: 2 }] })
  ok(cross.status === 400 && /introuvable/.test(cross.body.error || ''), `colis d’un autre produit refusé : « ${cross.body.error} »`)
  const upd = await call('PATCH', '/api/purchase-orders', { id: poId, shop_id: ALPHA,
    items: [{ product_id: P.id, product_name: P.name, unit: P.unit || 'piece', quantity_ordered: 999, unit_price: 100, packaging_id: b.body.data.id, pack_qty: 2 }] })
  const { data: line2 } = await db.from('purchase_order_items').select('quantity_ordered, pack_unit, units_per_pack, pack_qty').eq('purchase_order_id', poId)
  ok(upd.status === 200 && line2?.length === 1 && line2[0].quantity_ordered === 100 && line2[0].pack_unit === 'bag' && line2[0].pack_qty === 2, 'modification : 2 sacs de 50 = 100', line2)
  const plain = await call('PATCH', '/api/purchase-orders', { id: poId, shop_id: ALPHA,
    items: [{ product_id: P.id, product_name: P.name, unit: P.unit || 'piece', quantity_ordered: 7, unit_price: 100 }, { product_id: P.id, product_name: P.name, unit: P.unit || 'piece', quantity_ordered: 1, unit_price: 100, packaging_id: a.body.data.id, pack_qty: 1 }] })
  const { data: line3 } = await db.from('purchase_order_items').select('quantity_ordered, pack_qty').eq('purchase_order_id', poId).order('quantity_ordered')
  ok(plain.status === 200 && line3?.length === 2 && line3[0].quantity_ordered === 7 && line3[0].pack_qty === null && line3[1].quantity_ordered === 24 && line3[1].pack_qty === 1, 'bon mixte : 7 à l’unité + 1 carton de 24', line3)
  const cancel = await call('PATCH', '/api/purchase-orders', { id: poId, shop_id: ALPHA, status: 'cancelled' })
  ok(cancel.status === 200 && (await db.from('purchase_orders').select('status').eq('id', poId).single()).data.status === 'cancelled', `bon annulé (${cancel.status})`)

  console.log('\n4. Retrait')
  const del = await call('DELETE', `/api/products/packagings?shop_id=${ALPHA}&id=${b.body.data.id}`)
  const { data: rest } = await db.from('product_packagings').select('unit, units_per_pack, is_default').eq('product_id', P.id)
  ok(del.status === 200 && rest.length === 1 && rest[0].unit === 'carton' && rest[0].is_default, 'sac de 50 retiré ; carton de 24 gardé par défaut', rest)
  const { data: audits } = await db.from('audit_logs').select('action').eq('shop_id', ALPHA).in('action', ['packaging.create', 'packaging.delete']).gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
  ok((audits || []).filter(x => x.action === 'packaging.create').length === 2 && (audits || []).filter(x => x.action === 'packaging.delete').length === 1, 'journal : 2 ajouts, 1 retrait', audits)
  const stockAfter = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data
  ok(JSON.stringify(stockAfter) === JSON.stringify(stockBefore), 'aucun stock modifié')

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`  traces gardées :\n    ${vf.remaining.join('\n    ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
