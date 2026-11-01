// Migration 200 — kits assemblés, test RÉEL (« Pousse 200 », 1er nov. 2026) sur Boutique Alpha, serveur LOCAL, compte
// propriétaire. Produits TEST dédiés, gardés en exemple : « TEST Savon kit (rt-200) » (10, coût 200), « TEST Parfum kit
// (rt-200) » (3, coût 1 500) et le kit « TEST Panier cadeau (rt-200) » = 2 savons + 1 parfum.
//   composition (refus : kit lui-même, produit suivi par numéro de série) → 3 assemblables → 4 refusés (parfum
//   manquant, rien écrit) → 3 assemblés (coût 1 900) → 1 désassemblé → mouvements lisibles.
// Usage : CAPTURE_BASE=http://localhost:3000 RT200_GO=oui node tests/e2e/rt-200-kits.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT200_GO !== 'oui') { console.error('Écriture réelle : RT200_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const N = { soap: 'TEST Savon kit (rt-200)', perfume: 'TEST Parfum kit (rt-200)', kit: 'TEST Panier cadeau (rt-200)' }
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const W = await enableWrite({ test: 'kits assemblés après la 200', routes: [/\/api\/products/] })
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
  const { data: exists } = await db.from('products').select('id').eq('shop_id', ALPHA).in('name', Object.values(N))
  if ((exists || []).length) { console.log('Arrêt : produits TEST des kits déjà présents, rien écrit.'); process.exit(1) }
  const qty = async id => (await db.from('products').select('quantity').eq('id', id).single()).data.quantity

  console.log('\n1. Produits et composition')
  const mk = (name, quantity, buying, selling) => call('POST', '/api/products', { shop_id: ALPHA, name, selling_price: selling, buying_price: buying, quantity, unit: 'piece', is_active: true })
  const soap = (await mk(N.soap, 10, 200, 400)).body.data, perfume = (await mk(N.perfume, 3, 1500, 3000)).body.data, kit = (await mk(N.kit, 0, 0, 5000)).body.data
  ok(soap?.id && perfume?.id && kit?.id, 'trois produits TEST créés (savon 10, parfum 3, panier 0)')
  const self = await call('PUT', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, components: [{ product_id: kit.id, quantity: 1 }] })
  ok(self.status === 400 && self.body.code === 'kit_components_invalid', `le kit lui-même refusé : « ${self.body.error} »`)
  const { data: tracked } = await db.from('products').select('id').eq('shop_id', ALPHA).eq('track_serials', true).limit(1).maybeSingle()
  if (tracked) {
    const tr = await call('PUT', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, components: [{ product_id: tracked.id, quantity: 1 }] })
    ok(tr.status === 400 && tr.body.code === 'kit_component_not_allowed', `produit suivi par numéro refusé : « ${tr.body.error} »`)
  }
  const put = await call('PUT', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, components: [{ product_id: soap.id, quantity: 2 }, { product_id: perfume.id, quantity: 1 }] })
  ok(put.status === 200 && (await db.from('products').select('is_kit').eq('id', kit.id).single()).data.is_kit === true, 'composition enregistrée : 2 savons + 1 parfum, produit marqué « kit »')
  const g = await call('GET', `/api/products/kits?shop_id=${ALPHA}&product_id=${kit.id}`)
  ok(g.status === 200 && g.body.data?.assemblable === 3 && g.body.data.components.length === 2, `3 kits assemblables (savon 10 / 2, parfum 3 / 1)`, g.body)

  console.log('\n2. Assemblage')
  const four = await call('POST', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, action: 'assemble', quantity: 4 })
  ok(four.status === 409 && four.body.code === 'kit_component_short' && /Parfum/.test(four.body.error || ''), `4 kits refusés : « ${four.body.error} »`)
  ok(await qty(kit.id) === 0 && await qty(soap.id) === 10 && await qty(perfume.id) === 3, 'refus : rien écrit')
  const three = await call('POST', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, action: 'assemble', quantity: 3, notes: 'TEST rt-200' })
  ok(three.status === 200 && await qty(kit.id) === 3 && await qty(soap.id) === 4 && await qty(perfume.id) === 0, `3 assemblés : panier 3, savon 4, parfum 0 (${three.status})`, three.body)
  const kitRow = (await db.from('products').select('buying_price').eq('id', kit.id).single()).data
  const lot = (await db.from('product_batches').select('buying_price, quantity').eq('product_id', kit.id).eq('source', 'assembly').single()).data
  ok(Number(kitRow.buying_price) === 1900 && Number(lot.buying_price) === 1900 && lot.quantity === 3, 'coût du panier : 2 × 200 + 1 500 = 1 900 (produit et lot)')

  console.log('\n3. Désassemblage')
  const dis = await call('POST', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, action: 'disassemble', quantity: 1 })
  ok(dis.status === 200 && await qty(kit.id) === 2 && await qty(soap.id) === 6 && await qty(perfume.id) === 1, 'panier 3 → 2, savon 4 → 6, parfum 0 → 1')
  const tooMany = await call('POST', '/api/products/kits', { shop_id: ALPHA, product_id: kit.id, action: 'disassemble', quantity: 5 })
  ok(tooMany.status === 409 && tooMany.body.code === 'kit_component_short', `désassembler 5 refusé : « ${tooMany.body.error} »`)

  console.log('\n4. Mouvements et journal')
  const { data: moves } = await db.from('stock_movements').select('product_id, type, reason').in('product_id', [kit.id, soap.id, perfume.id]).in('reason', ['Assemblage', 'Désassemblage', `Assemblage ${N.kit}`, `Désassemblage ${N.kit}`])
  ok((moves || []).length === 6, `6 mouvements d'assemblage / désassemblage (${(moves || []).length})`, moves)
  const { data: logs } = await db.from('audit_logs').select('action').eq('shop_id', ALPHA).eq('target_id', kit.id).in('action', ['kit.update', 'kit.assemble', 'kit.disassemble'])
  ok((logs || []).length === 3, 'journal : composition, assemblage, désassemblage')

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
