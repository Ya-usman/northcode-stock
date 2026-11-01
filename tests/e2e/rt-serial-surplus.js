// Numéros de série : écart registre / stock et transferts (étape 11, 1er nov. 2026), test RÉEL sur Boutique Alpha,
// serveur LOCAL, compte propriétaire, produit TEST de rt-197-198 (3 en stock, 3 numéros) :
//   1. transfert d'un produit suivi SANS numéros refusé (rien écrit) — depuis la 199, il part avec ses numéros ;
//   2. vente hors ligne avec un numéro INCONNU : 1 unité sort, aucun numéro vendu → 1 numéro « en trop » ;
//   3. retrait d'un numéro en trop (motif) ; second retrait refusé (plus d'écart) ;
//   4. annulation de la vente : 1 unité sans numéro → numéroter à nouveau (le numéro retiré revient en stock).
// État final identique au départ (3 en stock, 3 numéros) ; restent la vente annulée et le journal.
// Usage : CAPTURE_BASE=http://localhost:3000 RTSURPLUS_GO=oui node tests/e2e/rt-serial-surplus.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RTSURPLUS_GO !== 'oui') { console.error('Écriture réelle : RTSURPLUS_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'TEST Téléphone numéroté (rt-197)', PRICE = 150000, YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const W = await enableWrite({ test: 'écart de numéros de série et transferts', routes: [/\/api\/(products|sales|stock-transfers)/] })
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
  const { data: P } = await db.from('products').select('id, quantity').eq('shop_id', ALPHA).eq('name', NAME).single()
  const inStock = async () => (await db.from('product_serials').select('id, serial').eq('product_id', P.id).eq('status', 'in_stock').order('serial')).data
  const qty = async () => (await db.from('products').select('quantity').eq('id', P.id).single()).data.quantity
  const start = await inStock()
  if (P.quantity !== 3 || start.length !== 3) { console.log(`Arrêt : état de départ inattendu (${P.quantity} en stock, ${start.length} numéros), rien écrit.`); process.exit(1) }

  console.log('\n1. Transfert d’un produit suivi sans numéros')
  const transfersCount = async () => (await db.from('stock_transfers').select('id', { count: 'exact', head: true }).eq('source_shop_id', ALPHA)).count
  const nBefore = await transfersCount()
  const tr = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 1 }], send: true })
  ok(tr.status === 400 && tr.body.code === 'serial_count_mismatch', `refusé : « ${tr.body.error} »`)
  ok(await qty() === 3 && await transfersCount() === nBefore, `rien écrit (stock 3, aucun nouveau transfert : ${nBefore})`)

  console.log('\n2. Écart : vente hors ligne au numéro inconnu')
  const tag = Date.now().toString(36).toUpperCase()
  const off = await call('POST', '/api/sales/sync', { local_id: `local-rtsurplus-${tag}`, shop_id: ALPHA, subtotal: PRICE, discount: 0, tax: 0, total: PRICE, payment_method: 'cash',
    payments: [{ amount: PRICE, method: 'cash' }], created_at: new Date(Date.now() - 60000).toISOString(),
    items: [{ product_id: P.id, product_name: NAME, quantity: 1, unit_price: PRICE, original_price: PRICE, subtotal: PRICE, serials: ['INCONNU-' + tag] }] })
  ok(off.status === 200 && String(off.body.sale?.review_reason || '').includes('serial_unresolved'), 'vente gardée « à vérifier »')
  ok(await qty() === 2 && (await inStock()).length === 3, 'stock 2, toujours 3 numéros en stock : 1 en trop')

  console.log('\n3. Retrait du numéro en trop')
  const victim = (await inStock())[0]
  const rm = await call('PATCH', '/api/products/serials', { shop_id: ALPHA, id: victim.id, action: 'remove', reason: 'TEST écart rt-serial-surplus' })
  const vrow = (await db.from('product_serials').select('status, removed_reason').eq('id', victim.id).single()).data
  ok(rm.status === 200 && vrow.status === 'removed' && /TEST/.test(vrow.removed_reason || ''), `${victim.serial} retiré avec son motif (ligne gardée)`)
  const again = await call('PATCH', '/api/products/serials', { shop_id: ALPHA, id: (await inStock())[0].id, action: 'remove', reason: 'x' })
  ok(again.status === 400 && again.body.code === 'serial_remove_not_surplus', `second retrait refusé : « ${again.body.error} »`)

  console.log('\n4. Annulation et renumérotation')
  const cancel = await call('POST', '/api/sales/cancel', { sale_id: off.body.sale?.id, reason: 'TEST rt-serial-surplus' })
  ok(cancel.status === 200 && await qty() === 3 && (await inStock()).length === 2, 'vente annulée : stock 3, 2 numéros (1 unité sans numéro)')
  const renum = await call('POST', '/api/products/serials', { shop_id: ALPHA, product_id: P.id, serials: [victim.serial] })
  ok(renum.status === 200 && (await inStock()).length === 3 && (await db.from('product_serials').select('status').eq('id', victim.id).single()).data.status === 'in_stock', `${victim.serial} renuméroté (même ligne, remise en stock)`)
  ok(JSON.stringify((await inStock()).map(x => x.serial)) === JSON.stringify(start.map(x => x.serial)), 'état final identique au départ (3 en stock, 3 numéros)')

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length})`, vf.modified)
  console.log(`  lignes modifiées : ${vf.modified.join(' | ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
