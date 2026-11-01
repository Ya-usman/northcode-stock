// Migration 199 — transferts d'un produit suivi avec ses numéros de série, test RÉEL (« Applique 199 », 1er nov. 2026)
// entre Boutique Alpha et « yahaya & zainab 2 » (même entreprise), serveur LOCAL, compte propriétaire, produit TEST de
// rt-197-198 (3 en stock, 3 numéros). Aller-retour complet, état final identique au départ :
//   1. Alpha → YZ, 2 unités avec 2 numéros (refus : nombre incorrect, numéro inconnu) ;
//   2. réception à YZ : 1 arrivé (produit d'arrivée créé et suivi), 1 manquant (retiré « manquant au transfert ») ;
//      refus : numéro pas en transit, nombre ≠ unités reçues ;
//   3. retour YZ → Alpha du numéro arrivé, réception à Alpha ;
//   4. le numéro manquant revient par un réassort à Alpha (même ligne, remise en stock) ;
//   5. transfert envoyé puis ANNULÉ : numéro remis en stock au départ.
// Restent : les transferts (reçus, annulé), le produit TEST créé à YZ (0 en stock), leurs mouvements et le journal.
// Usage : CAPTURE_BASE=http://localhost:3000 RT199_GO=oui node tests/e2e/rt-199-transfer-serials.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT199_GO !== 'oui') { console.error('Écriture réelle : RT199_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'TEST Téléphone numéroté (rt-197)', YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const uuid = () => require('crypto').randomUUID()

;(async () => {
  const W = await enableWrite({ test: 'transferts de numéros de série après la 199', routes: [/\/api\/(products|stock-transfers)/] })
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
  const serialsOf = async (shop, status = 'in_stock') => (await db.from('product_serials').select('id, serial, product_id').eq('shop_id', shop).eq('status', status).ilike('serial', 'RT197-%').order('serial')).data
  const start = await serialsOf(ALPHA)
  if (P.quantity !== 3 || start.length !== 3) { console.log(`Arrêt : état de départ inattendu (${P.quantity} en stock, ${start.length} numéros), rien écrit.`); process.exit(1) }
  const [A, B, C] = start.map(x => x.serial)
  const qty = async id => (await db.from('products').select('quantity').eq('id', id).single()).data.quantity
  const detail = async id => (await call('GET', `/api/stock-transfers/${id}`)).body.data
  const receive = (tr, acting, lines) => call('POST', '/api/stock-transfers/receive', { transfer_id: tr, acting_shop_id: acting, receipt_key: uuid(), items: lines })

  console.log('\n1. Envoi Alpha → YZ avec numéros')
  const bad = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 2 }], send: true, serials: [{ product_id: P.id, serials: [A] }] })
  ok(bad.status === 400 && bad.body.code === 'serial_count_mismatch', `1 numéro pour 2 unités refusé : « ${bad.body.error} »`)
  const unk = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 1 }], send: true, serials: [{ product_id: P.id, serials: ['INCONNU-RT199'] }] })
  ok(unk.status === 400 && unk.body.code === 'serial_not_in_stock', `numéro inconnu refusé : « ${unk.body.error} »`)
  ok(await qty(P.id) === 3, 'refus : stock inchangé (3)')
  const sent = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 2 }], send: true, serials: [{ product_id: P.id, serials: [A, B.toLowerCase()] }] })
  const T1 = sent.body.data?.id
  ok(sent.status === 200 && T1 && await qty(P.id) === 1, `envoyé ${sent.body.data?.reference}, stock Alpha 3 → 1`, sent.body)
  ok((await serialsOf(ALPHA, 'in_transit')).map(x => x.serial).join() === [A, B].join(), `${A} et ${B} en transit`)

  console.log('\n2. Réception à YZ : 1 arrivé, 1 manquant')
  const d1 = await detail(T1)
  const it1 = d1.stock_transfer_items[0]
  ok((it1.serials || []).filter(x => x.status === 'in_transit').length === 2, 'détail : 2 numéros en transit sur la ligne')
  const r0 = await receive(T1, YZ, [{ transfer_item_id: it1.id, quantity_received: 1, serials_received: [C] }])
  ok(r0.status === 400 && r0.body.code === 'serial_not_in_transit', `numéro pas en transit refusé : « ${r0.body.error} »`)
  const r1 = await receive(T1, YZ, [{ transfer_item_id: it1.id, quantity_received: 2, serials_received: [A] }])
  ok(r1.status === 400 && r1.body.code === 'serial_count_mismatch', `1 numéro pour 2 unités reçues refusé : « ${r1.body.error} »`)
  const r2 = await receive(T1, YZ, [{ transfer_item_id: it1.id, quantity_received: 1, serials_received: [A], discrepancy_category: 'transport_loss', discrepancy_detail: 'TEST rt-199' }])
  const yzP = (await db.from('stock_transfer_items').select('destination_product_id').eq('id', it1.id).single()).data.destination_product_id
  ok(r2.status === 200 && yzP, `reçu (${r2.status}), produit d'arrivée ${yzP ? 'créé' : 'absent'}`, r2.body)
  ok((await db.from('products').select('track_serials, quantity').eq('id', yzP).single()).data.track_serials === true && await qty(yzP) === 1, 'produit d’arrivée : suivi activé, 1 en stock')
  const yzIn = await serialsOf(YZ)
  ok(yzIn.length === 1 && yzIn[0].serial === A && yzIn[0].product_id === yzP, `${A} en stock à YZ, rattaché au produit d'arrivée`)
  const bRow = (await db.from('product_serials').select('status, removed_reason').eq('shop_id', ALPHA).eq('serial', B).single()).data
  ok(bRow.status === 'removed' && /Manquant au transfert/.test(bRow.removed_reason || ''), `${B} non arrivé : retiré (« ${bRow.removed_reason} »)`)

  console.log('\n3. Retour YZ → Alpha')
  const back = await call('POST', '/api/stock-transfers', { source_shop_id: YZ, destination_shop_id: ALPHA, items: [{ product_id: yzP, quantity: 1 }], send: true, serials: [{ product_id: yzP, serials: [A] }] })
  const T2 = back.body.data?.id
  ok(back.status === 200 && T2 && await qty(yzP) === 0, `retour envoyé ${back.body.data?.reference}`, back.body)
  const it2 = (await detail(T2)).stock_transfer_items[0]
  const r3 = await receive(T2, ALPHA, [{ transfer_item_id: it2.id, quantity_received: 1, destination_product_id: P.id, serials_received: [A] }])
  ok(r3.status === 200 && await qty(P.id) === 2, `reçu à Alpha (${r3.status}), stock 1 → 2`, r3.body)
  ok((await serialsOf(ALPHA)).map(x => x.serial).join() === [A, C].join() && (await serialsOf(YZ)).length === 0, `${A} revenu à Alpha ; plus rien à YZ`)

  console.log('\n4. Le numéro manquant revient par un réassort')
  const rs = await call('PUT', '/api/products', { product_id: P.id, shop_id: ALPHA, quantity_to_add: 1, serials: [B] })
  ok(rs.status === 200 && await qty(P.id) === 3 && (await serialsOf(ALPHA)).length === 3, `${B} remis en stock (même ligne), stock 3`, rs.body)

  console.log('\n5. Envoi puis annulation')
  const s3 = await call('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, items: [{ product_id: P.id, quantity: 1 }], send: true, serials: [{ product_id: P.id, serials: [C] }] })
  const T3 = s3.body.data?.id
  ok(s3.status === 200 && (await serialsOf(ALPHA, 'in_transit')).map(x => x.serial).join() === C, `${C} en transit`)
  const cancel = await call('POST', '/api/stock-transfers/cancel', { transfer_id: T3 })
  ok(cancel.status === 200 && await qty(P.id) === 3 && (await serialsOf(ALPHA)).map(x => x.serial).join() === [A, B, C].join(), `annulé : ${C} remis en stock, stock 3`, cancel.body)

  const end = await serialsOf(ALPHA)
  ok(end.length === 3 && await qty(P.id) === 3, 'état final identique au départ (3 en stock, 3 numéros)')
  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length})`, vf.modified)
  console.log(`  lignes modifiées : ${vf.modified.join(' | ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
