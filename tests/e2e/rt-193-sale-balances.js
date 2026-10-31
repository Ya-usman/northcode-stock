// Migration 193 — stock « avant / après » des mouvements de la caisse. ÉCRITURE RÉELLE (délégation de l'utilisateur
// du 31 oct. 2026, « Applique 193 ») sur Boutique Alpha : UNE vente (1 unité, espèces) puis son ANNULATION (stock remis), par le propriétaire d'Alpha (boutique
// peut-être fermée aux heures du test), par les routes normales du serveur LOCAL. Aucune suppression : la vente
// annulée, ses mouvements et le journal restent (numéro BOU-… consommé), comme pour rt-185.
// Attendu : mouvement de vente « avant N, après N−1 » ; mouvement d'annulation « avant N−1, après N » ; stock et lots
// remis à l'identique.
// Usage : CAPTURE_BASE=http://localhost:3000 RT193_GO=oui node tests/e2e/rt-193-sale-balances.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT193_GO !== 'oui') { console.error('Écriture réelle : RT193_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
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
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

;(async () => {
  const W = await enableWrite({ test: 'stock avant / après après la 193 — vente réelle puis annulation', routes: [/\/api\/sales\/(checkout|cancel)$/] })
  const admin = W.db
  const login = async email => {
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) throw new Error(`${email} : ${error.message}`)
    const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
    const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
    return { cookie: parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') }
  }
  // Propriétaire pour les deux gestes : la boutique peut être fermée (horaires, lot A côté serveur) aux heures du test
  const manager = await login('admin@northcode.ng'), cashier = manager

  // Produit : le moins cher avec un lot vendable (non périmé) et au moins 5 en stock
  const { data: prods } = await admin.from('products').select('id, name, selling_price, quantity').eq('shop_id', ALPHA).eq('is_active', true).gte('quantity', 5).order('selling_price').limit(15)
  const today = new Date().toISOString().slice(0, 10)
  let product = null
  for (const p of prods || []) {
    const { data: lots } = await admin.from('product_batches').select('quantity, expiry_date').eq('product_id', p.id).gt('quantity', 0)
    if ((lots || []).some(l => !l.expiry_date || l.expiry_date.slice(0, 10) >= today)) { product = p; break }
  }
  if (!product) throw new Error('aucun produit d’Alpha avec du stock vendable')
  const N = Number(product.quantity)
  const batchesBefore = (await admin.from('product_batches').select('id, quantity').eq('product_id', product.id).order('id')).data || []
  console.log(`Produit : « ${product.name} » (stock ${N})`)

  const price = Number(product.selling_price)
  const res = await fetch(`${BASE}/api/sales/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashier.cookie }, body: JSON.stringify({
    shop_id: ALPHA, customer_id: null, customer_name: null, customer_phone: null, subtotal: price, discount: 0, tax: 0, total: price,
    payment_method: 'cash', notes: `TEST avant/après 193 ${W.RUN}`, paystack_reference: null, client_request_id: `rt193-${W.RUN}`, due_date: null,
    items: [{ product_id: product.id, product_name: product.name, quantity: 1, unit_price: price, original_price: price }],
    payments: [{ method: 'cash', amount: price, reference: null }],
  }) })
  const { data: sale } = await admin.from('sales').select('id, sale_number').eq('client_request_id', `rt193-${W.RUN}`).maybeSingle()
  ok(res.status === 200 && !!sale, `vente réelle enregistrée : ${res.status} · ${sale?.sale_number || ''}`)
  if (!sale) throw new Error('vente absente : arrêt')
  const { data: mvSale } = await admin.from('stock_movements').select('type, quantity, previous_qty, new_qty, reason').eq('product_id', product.id).eq('type', 'sale').ilike('reason', `%${sale.sale_number}%`)
  ok(mvSale?.length === 1 && mvSale[0].previous_qty === N && mvSale[0].new_qty === N - 1, `mouvement de vente : avant ${mvSale?.[0]?.previous_qty}, après ${mvSale?.[0]?.new_qty} (attendu ${N} → ${N - 1})`)

  const cr = await fetch(`${BASE}/api/sales/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: manager.cookie }, body: JSON.stringify({ sale_id: sale.id, reason: `TEST avant/après 193 ${W.RUN}` }) })
  const after = (await admin.from('sales').select('sale_status').eq('id', sale.id).single()).data
  ok(cr.status === 200 && after?.sale_status === 'cancelled', `annulation par le manager : ${cr.status} · ${after?.sale_status}`)
  const { data: mvBack } = await admin.from('stock_movements').select('type, previous_qty, new_qty, reason').eq('product_id', product.id).eq('type', 'in').ilike('reason', `%${sale.sale_number}%`)
  ok(mvBack?.length === 1 && mvBack[0].previous_qty === N - 1 && mvBack[0].new_qty === N, `mouvement d'annulation : avant ${mvBack?.[0]?.previous_qty}, après ${mvBack?.[0]?.new_qty} (attendu ${N - 1} → ${N})`)

  const p2 = (await admin.from('products').select('quantity').eq('id', product.id).single()).data
  const batchesAfter = (await admin.from('product_batches').select('id, quantity').eq('product_id', product.id).order('id')).data || []
  ok(Number(p2.quantity) === N && JSON.stringify(batchesAfter) === JSON.stringify(batchesBefore), `stock remis à l'identique (${N} → ${p2.quantity}, lots identiques)`)

  const v = await W.verify()
  console.log(`\nBilan base (Alpha) : ${v.removed.length} supprimée(s), ${v.modified.length} modifiée(s), ${v.remaining.length} nouvelle(s)`)
  for (const x of v.modified) console.log(`  modifiée : ${x}`)
  for (const x of v.remaining) console.log(`  nouvelle : ${x}`)
  ok(v.removed.length === 0, 'aucune ligne préexistante supprimée')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
