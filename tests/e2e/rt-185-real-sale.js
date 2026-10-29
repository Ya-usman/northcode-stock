// Migration 185 — temps réel des ventes et paiements selon le droit du rôle. ÉCRITURE RÉELLE autorisée par l'utilisateur
// le 29 oct. 2026 sur Boutique Alpha : UNE vente (1 unité, espèces) par la caissière d'Alpha, puis son ANNULATION par le
// manager (stock remis), par les routes normales du serveur LOCAL. Aucune suppression : la vente annulée, ses mouvements
// et le journal restent (numéro BOU-… consommé) ; bilan complet affiché à la fin.
// Écoutent le temps réel (comme le tableau de bord) : manager (Historique), caissière (ses ventes), observateur de test
// (aucun droit sur les ventes). Attendu : manager et caissière reçoivent vente, paiement et annulation ; l'observateur RIEN.
// Usage : CAPTURE_BASE=http://localhost:3000 RT185_GO=oui node tests/e2e/rt-185-real-sale.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT185_GO !== 'oui') { console.error('Écriture réelle : RT185_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const wait = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

;(async () => {
  const W = await enableWrite({ test: 'temps réel après la 185 — vente réelle puis annulation', routes: [/\/api\/sales\/(checkout|cancel)$/] })
  const admin = W.db
  // Session réelle d'un compte : client (temps réel, comme le navigateur) + cookie (routes du serveur local)
  const login = async email => {
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) throw new Error(`${email} : ${error.message}`)
    c.realtime.setAuth(data.session.access_token)
    const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
    const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
    return { email, c, cookie: parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; '), events: [] }
  }
  const manager = await login('cassierstock@gmail.com'), cashier = await login('stocshopci@gmail.com'), viewer = await login('stocshopci+observateur@gmail.com')
  const listeners = [manager, cashier, viewer]

  // Abonnements, comme useDashboardRealtime : ventes de la boutique (insertion, modification) et paiements
  await Promise.all(listeners.map(L => new Promise((resolve, reject) => {
    const ch = L.c.channel(`rt185-${W.RUN}-${L.email}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales', filter: `shop_id=eq.${ALPHA}` }, p => L.events.push(['sale+', p.new.id, p.new.sale_status]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: `shop_id=eq.${ALPHA}` }, p => L.events.push(['sale~', p.new.id, p.new.sale_status]))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments' }, p => L.events.push(['pay+', p.new.sale_id]))
    const t = setTimeout(() => reject(new Error(`${L.email} : abonnement non confirmé`)), 20000)
    ch.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(t); resolve() } })
  })))
  console.log('Abonnements temps réel confirmés : manager, caissière, observateur')
  await wait(2000)

  // Produit : actif, le moins cher parmi ceux qui ont du stock vendable confortable (≥ 5)
  // (depuis la 178, un lot périmé n'est pas vendable : on exige un lot non périmé avec du stock)
  const { data: prods } = await admin.from('products').select('id, name, selling_price, quantity').eq('shop_id', ALPHA).eq('is_active', true).gte('quantity', 5).order('selling_price').limit(15)
  const today = new Date().toISOString().slice(0, 10)
  let product = null
  for (const p of prods || []) {
    const { data: lots } = await admin.from('product_batches').select('quantity, expiry_date').eq('product_id', p.id).gt('quantity', 0)
    if ((lots || []).some(l => !l.expiry_date || l.expiry_date.slice(0, 10) >= today)) { product = p; break }
  }
  if (!product) throw new Error('aucun produit d’Alpha avec du stock')
  const batchesBefore = (await admin.from('product_batches').select('id, quantity').eq('product_id', product.id).order('id')).data || []
  console.log(`Produit : « ${product.name} » à ${product.selling_price} (stock ${product.quantity})`)

  // 1. Vente réelle par la caissière
  const price = Number(product.selling_price)
  const res = await fetch(`${BASE}/api/sales/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashier.cookie }, body: JSON.stringify({
    shop_id: ALPHA, customer_id: null, customer_name: null, customer_phone: null, subtotal: price, discount: 0, tax: 0, total: price,
    payment_method: 'cash', notes: `TEST temps réel 185 ${W.RUN}`, paystack_reference: null, client_request_id: `rt185-${W.RUN}`, due_date: null,
    items: [{ product_id: product.id, product_name: product.name, quantity: 1, unit_price: price, original_price: price }],
    payments: [{ method: 'cash', amount: price, reference: null }],
  }) })
  const body = await res.json().catch(() => ({}))
  const saleId = body?.sale?.id || body?.sale_id || body?.data?.sale_id || body?.id
  const { data: sale } = await admin.from('sales').select('id, sale_number, cashier_id, sale_status').eq('client_request_id', `rt185-${W.RUN}`).maybeSingle()
  ok(res.status === 200 && !!sale, `vente enregistrée par la caissière : ${res.status} · ${sale?.sale_number || JSON.stringify(body).slice(0, 120)}`)
  if (!sale) throw new Error('vente absente : arrêt sans annulation')
  void saleId
  await wait(8000)
  const got = L => L.events.filter(e => e[1] === sale.id)
  ok(got(manager).some(e => e[0] === 'sale+') && got(manager).some(e => e[0] === 'pay+'), `manager (Historique) : vente ET paiement reçus en direct (${got(manager).map(e => e[0]).join(', ') || 'rien'})`)
  ok(got(cashier).some(e => e[0] === 'sale+') && got(cashier).some(e => e[0] === 'pay+'), `caissière : SA vente et son paiement reçus en direct (${got(cashier).map(e => e[0]).join(', ') || 'rien'})`)
  ok(viewer.events.length === 0, `observateur (aucun droit sur les ventes) : RIEN reçu (${viewer.events.length} événement)`)

  // 2. Annulation par le manager (stock remis)
  const cr = await fetch(`${BASE}/api/sales/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: manager.cookie }, body: JSON.stringify({ sale_id: sale.id, reason: `TEST temps réel 185 ${W.RUN}` }) })
  const after = (await admin.from('sales').select('sale_status').eq('id', sale.id).single()).data
  ok(cr.status === 200 && after?.sale_status === 'cancelled', `annulation par le manager : ${cr.status} · statut ${after?.sale_status}`)
  await wait(8000)
  ok(got(manager).some(e => e[0] === 'sale~' && e[2] === 'cancelled'), 'manager : annulation reçue en direct')
  ok(got(cashier).some(e => e[0] === 'sale~' && e[2] === 'cancelled'), 'caissière : annulation de SA vente reçue en direct')
  ok(viewer.events.length === 0, `observateur : toujours RIEN reçu (${viewer.events.length} événement)`)

  // 3. Stock remis à l'identique
  const p2 = (await admin.from('products').select('quantity').eq('id', product.id).single()).data
  const batchesAfter = (await admin.from('product_batches').select('id, quantity').eq('product_id', product.id).order('id')).data || []
  ok(Number(p2.quantity) === Number(product.quantity) && JSON.stringify(batchesAfter) === JSON.stringify(batchesBefore), `stock remis à l'identique (produit ${product.quantity} → ${p2.quantity}, lots identiques)`)

  for (const L of listeners) { await L.c.removeAllChannels(); await L.c.auth.signOut({ scope: 'local' }).catch(() => {}) }
  // Bilan des traces (aucune suppression : décision de l'utilisateur ensuite)
  const v = await W.verify()
  console.log(`\nBilan base (Alpha) : ${v.removed.length} ligne(s) préexistante(s) supprimée(s), ${v.modified.length} modifiée(s), ${v.remaining.length} nouvelle(s)`)
  for (const x of v.removed) console.log(`  supprimée : ${x}`)
  for (const x of v.modified) console.log(`  modifiée : ${x}`)
  for (const x of v.remaining) console.log(`  nouvelle : ${x}`)
  ok(v.removed.length === 0, 'aucune ligne préexistante supprimée')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
