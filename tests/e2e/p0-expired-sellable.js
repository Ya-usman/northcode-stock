// P0 « périmé non vendable » — tests SQL de la migration 178, À LANCER APRÈS SON APPLICATION.
// Écritures UNIQUEMENT sur Boutique Alpha (vérifiée en base avant toute écriture), sur des produits « TEST P0 <run> »
// créés par le test ; nettoyage par identifiants (ventes, lignes, lots, mouvements, produits) ; photo d'Alpha
// avant / après (produits et lots préexistants inchangés). Ventes passées par complete_sale / edit_sale /
// cancel_sale avec le rôle serveur, exactement comme les routes de l'application.
// Usage : node tests/e2e/p0-expired-sellable.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
const TZ = jiti(ROOT + '/lib/time/time-zones.ts')

const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const RUN = `TEST P0 ${Date.now().toString(36)}`
let pass = 0, fail = 0
// Arrêt IMMÉDIAT au premier écart (consigne du 24 oct. 2026) : plus aucune écriture, pas de nettoyage automatique,
// identifiants TEST affichés, état relu en lecture seule
class Stop extends Error {}
let stopped = null
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`); if (!c) { stopped = m; throw new Stop(m) } }
const check = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const created = { products: [], sales: [] }
let cashier = null, today = null, tz = null

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

async function product(label, physical, lots) {
  const { data: p, error } = await db.from('products').insert({
    shop_id: ALPHA, name: `${RUN} ${label}`, quantity: physical, selling_price: 100, buying_price: 50, is_active: true, unit: 'piece',
  }).select('id').single()
  if (error) throw new Error('création produit : ' + error.message)
  created.products.push(p.id)
  const ids = []
  for (const [i, l] of lots.entries()) {
    const { data: b, error: e2 } = await db.from('product_batches').insert({
      shop_id: ALPHA, product_id: p.id, quantity: l.q, initial_quantity: l.q, expiry_date: l.exp ?? null, source: 'adjustment',
      received_at: new Date(Date.now() - (lots.length - i) * 60000).toISOString(),
    }).select('id').single()
    if (e2) throw new Error('création lot : ' + e2.message)
    ids.push(b.id)
  }
  return { id: p.id, lots: ids }
}
const qtyOf = async id => Number((await db.from('products').select('quantity').eq('id', id).single()).data.quantity)
const lotQ = async id => Number((await db.from('product_batches').select('quantity').eq('id', id).single()).data.quantity)

async function sell(productId, qty, { offline = null, requestId = null } = {}) {
  const rid = requestId || `${RUN}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await db.rpc('complete_sale', {
    p_shop_id: ALPHA, p_cashier_id: cashier, p_customer_id: null, p_customer_name: null, p_customer_phone: null,
    p_subtotal: qty * 100, p_discount: 0, p_tax: 0, p_total: qty * 100, p_payment_method: 'cash', p_notes: RUN,
    p_paystack_reference: null, p_client_request_id: rid, p_items: [{ product_id: productId, product_name: RUN, quantity: qty, unit_price: 100, buying_price: 50 }],
    p_payments: [], p_due_date: null, p_created_at: offline, p_receipt_token: null, p_review_reason: null,
  })
  if (data?.sale?.id && !created.sales.includes(data.sale.id)) created.sales.push(data.sale.id)
  return { data, error, rid }
}
async function itemOf(saleId) {
  const { data: items } = await db.from('sale_items').select('id, quantity, stock_shortfall, batch_unallocated, product_id').eq('sale_id', saleId)
  const it = items[0]
  const { data: allocs } = await db.from('sale_item_batches').select('batch_id, quantity').eq('sale_item_id', it.id)
  const alloc = (allocs || []).reduce((n, a) => n + a.quantity, 0)
  return { ...it, allocs: allocs || [], alloc, untracked: it.quantity - it.stock_shortfall - it.batch_unallocated - alloc }
}
const invariant = (it, label) => ok(it.untracked >= 0 && it.quantity === it.stock_shortfall + it.untracked + it.batch_unallocated + it.alloc,
  `${label} — invariant : ${it.quantity} = écart ${it.stock_shortfall} + sans lot ${it.untracked} + non attribué ${it.batch_unallocated} + lots ${it.alloc}`)
const edit = (saleId, productId, qty) => db.rpc('edit_sale', {
  p_sale_id: saleId, p_edited_by: cashier, p_customer_id: null, p_payment_method: 'cash', p_notes: RUN,
  p_items: [{ product_id: productId, product_name: RUN, quantity: qty, unit_price: 100 }],
})

async function snapshotAlpha() {
  const [{ data: p }, { data: b }, { data: shop }, { count: sales }, { data: cust }] = await Promise.all([
    db.from('products').select('id, quantity, updated_at').eq('shop_id', ALPHA).not('name', 'like', 'TEST P0 %').order('id'),
    db.from('product_batches').select('id, quantity, expiry_date').eq('shop_id', ALPHA).order('id'),
    db.from('shops').select('name, country, timezone').eq('id', ALPHA).single(),
    db.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA),
    db.from('customers').select('id, total_debt').eq('shop_id', ALPHA).order('id'),
  ])
  return JSON.stringify({ p, b, shop, sales, cust })
}
const saleCounter = async () => (await db.from('shop_sale_counters').select('counter').eq('shop_id', ALPHA).maybeSingle()).data?.counter ?? null

// Lignes TEST par table, retrouvées UNIQUEMENT par les identifiants créés
async function testCounts() {
  const c = async (t, col, ids) => ids.length ? (await db.from(t).select('*', { count: 'exact', head: true }).in(col, ids)).count : 0
  const items = created.sales.length ? ((await db.from('sale_items').select('id').in('sale_id', created.sales)).data || []).map(i => i.id) : []
  return {
    produits: await c('products', 'id', created.products), lots: await c('product_batches', 'product_id', created.products),
    mouvements: await c('stock_movements', 'product_id', created.products), ventes: await c('sales', 'id', created.sales),
    lignes: items.length, allocations: await c('sale_item_batches', 'sale_item_id', items), paiements: await c('payments', 'sale_id', created.sales),
  }
}

async function cleanup() {
  for (const id of created.sales) {
    const { data: items } = await db.from('sale_items').select('id').eq('sale_id', id)
    for (const it of items || []) await db.from('sale_item_batches').delete().eq('sale_item_id', it.id)
    await db.from('payments').delete().eq('sale_id', id)
    await db.from('sale_items').delete().eq('sale_id', id)
    await db.from('sales').delete().eq('id', id).eq('shop_id', ALPHA)
  }
  for (const id of created.products) {
    await db.from('stock_movements').delete().eq('product_id', id).eq('shop_id', ALPHA)
    await db.from('product_batches').delete().eq('product_id', id).eq('shop_id', ALPHA)
    await db.from('products').delete().eq('id', id).eq('shop_id', ALPHA)
  }
}

;(async () => {
  // ── Garde : Boutique Alpha, migration 178 présente ──
  const { data: alpha } = await db.from('shops').select('id, name, country, timezone').eq('id', ALPHA).single()
  if (!alpha || alpha.name !== 'Boutique Alpha') throw new Error('cible inattendue : écriture refusée')
  if (!alpha.timezone) throw new Error('migration 178 absente (shops.timezone) : tests non lancés')
  tz = alpha.timezone
  const { data: bd } = await db.rpc('shop_business_date', { p_shop_id: ALPHA, p_at: new Date().toISOString() })
  today = bd
  cashier = (await db.from('shop_members').select('user_id').eq('shop_id', ALPHA).eq('role', 'owner').eq('is_active', true).limit(1).single()).data.user_id
  const before = await snapshotAlpha()
  const counterBefore = await saleCounter()
  console.log(`Alpha : ${alpha.country} / ${tz} — date métier ${today} — référence ${RUN}`)

  try {
    console.log('\n1. Date métier et fuseau')
    ok(today === TZ.businessDate(tz), `shop_business_date(Alpha) = ${today} = date de ${tz} côté application`)
    const { data: us } = await db.from('shops').select('id, timezone').eq('country', 'US').limit(1).single()
    const at = '2026-10-24T03:00:00Z'
    const { data: usDate } = await db.rpc('shop_business_date', { p_shop_id: us.id, p_at: at })
    ok(us.timezone === 'America/Chicago' && usDate === '2026-10-23', `boutique US : lit shops.timezone (America/Chicago) → ${usDate} pour ${at}`)
    const { data: zones } = await db.rpc('country_time_zones', { p_country: 'US' })
    ok(JSON.stringify(zones) === JSON.stringify(TZ.countryTimeZones('US')), 'country_time_zones(US) identique à l’application')
    for (const c of TZ.KNOWN_TIME_ZONE_COUNTRIES) {
      const { data: d } = await db.rpc('country_default_time_zone', { p_country: c })
      if (d !== TZ.countryDefaultTimeZone(c)) { ok(false, `défaut ${c} : base ${d} ≠ application ${TZ.countryDefaultTimeZone(c)}`) }
    }
    ok(true, `country_default_time_zone identique à l’application pour ${TZ.KNOWN_TIME_ZONE_COUNTRIES.length} pays`)
    const { count: nulls } = await db.from('shops').select('id', { count: 'exact', head: true }).is('timezone', null)
    ok(nulls === 0, 'aucune boutique sans fuseau')

    console.log('\n2. Garde pays ↔ fuseau (aucune écriture ne passe)')
    for (const [tzv, why] of [['UTC+1', 'non IANA'], ['America/Chicago', 'incohérent avec le pays'], ['Europe/Paris', 'incohérent avec le pays']]) {
      const { error } = await db.from('shops').update({ timezone: tzv }).eq('id', ALPHA)
      ok(error && error.code === 'P0031', `Alpha (${alpha.country}) + ${tzv} → refus P0031 (${why})`)
    }
    ok((await db.from('shops').select('timezone').eq('id', ALPHA).single()).data.timezone === tz, 'fuseau d’Alpha inchangé')

    console.log('\n3. Vente EN LIGNE : FEFO sans périmé, refus au-delà du vendable')
    let P = await product('frais20-perime5', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    let r = await sell(P.id, 3)
    ok(!r.error, 'CAS 1 — vente de 3 acceptée')
    ok(await lotQ(P.lots[1]) === 17 && await lotQ(P.lots[0]) === 5 && await qtyOf(P.id) === 22, 'CAS 1 — lot frais −3, lot périmé intact (5), produit 22')
    invariant(await itemOf(r.data.sale.id), 'CAS 1')
    P = await product('cas2-3', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    r = await sell(P.id, 20)
    ok(!r.error && await lotQ(P.lots[1]) === 0 && await lotQ(P.lots[0]) === 5, 'CAS 2 — vente de 20 (= vendable) acceptée, périmé intact')
    P = await product('cas3', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    r = await sell(P.id, 21)
    const d3 = r.error?.details ? JSON.parse(r.error.details) : {}
    ok(r.error?.code === 'P0030' && d3.sellable === 20 && d3.non_sellable === 5 && d3.requested === 21, `CAS 3 — vente de 21 refusée P0030 {vendable 20, non vendable 5}`)
    ok(await qtyOf(P.id) === 25 && await lotQ(P.lots[1]) === 20, 'CAS 3 — rien n’a bougé (transaction annulée)')
    P = await product('cas4', 5, [{ q: 5, exp: addDays(today, -1) }])
    r = await sell(P.id, 1)
    ok(r.error?.code === 'P0030' && JSON.parse(r.error.details).sellable === 0, 'CAS 4 / H6 — produit entièrement périmé : non vendable')
    P = await product('cas5', 5, [{ q: 5, exp: today }])
    r = await sell(P.id, 5)
    ok(!r.error && await lotQ(P.lots[0]) === 0, 'CAS 5 — lot qui périme AUJOURD’HUI : encore vendable')
    P = await product('cas6', 5, [{ q: 5, exp: addDays(today, -1) }])
    ok((await sell(P.id, 1)).error?.code === 'P0030', 'CAS 6 — lot périmé hier : exclu')
    P = await product('cas-A', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    ok(!(await sell(P.id, 20)).error, 'A — physique 25, périmé 5 (réservations ignorées par le serveur) : 20 accepté')
    P = await product('cas-A2', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    ok((await sell(P.id, 21)).error?.code === 'P0030', 'A — 21 refusé')

    console.log('\n4. Lots historiquement incohérents (H1 à H5)')
    P = await product('H2', 20, [{ q: 3, exp: addDays(today, 30) }])
    r = await sell(P.id, 5)
    let it = await itemOf(r.data.sale.id)
    ok(!r.error && it.alloc === 3 && it.untracked === 2 && it.batch_unallocated === 0, 'H2 — physique 20, lot frais 3 : vente 5 → 3 sur le lot, 2 sans lot, aucun écart')
    const { data: s2 } = await db.from('sales').select('review_reason').eq('id', r.data.sale.id).single()
    ok(!String(s2.review_reason || '').includes('expired_stock_unresolved'), 'H2 — pas d’alerte périmé (aucun périmé en cause)')
    invariant(it, 'H2')
    P = await product('H3', 10, [{ q: 5, exp: addDays(today, 30) }, { q: 12, exp: addDays(today, -3) }])
    r = await sell(P.id, 6)
    ok(r.error?.code === 'P0030' && JSON.parse(r.error.details).sellable === 5, 'H3/H4 — physique 10 < lots (frais 5, périmé 12) : vendable 5, 6 refusé')
    ok(!(await sell(P.id, 5)).error, 'H4 — les 5 frais connus restent vendables')
    P = await product('H5', 7, [])
    r = await sell(P.id, 7)
    it = await itemOf(r.data.sale.id)
    ok(!r.error && it.untracked === 7 && it.alloc === 0, 'H5 — produit sans lot : vente normale (comportement historique)')

    console.log('\n5. Vente HORS LIGNE : jamais refusée, jamais d’allocation au périmé')
    P = await product('offline', 13, [{ q: 10, exp: addDays(today, -5) }, { q: 3, exp: addDays(today, 30) }])
    r = await sell(P.id, 5, { offline: new Date().toISOString() })
    it = await itemOf(r.data.sale.id)
    ok(!r.error && await qtyOf(P.id) === 8, 'CAS 9 — vente hors ligne de 5 conservée, produit −5 (8)')
    ok(await lotQ(P.lots[1]) === 0 && await lotQ(P.lots[0]) === 10 && it.batch_unallocated === 2 && it.alloc === 3, 'CAS 9 — lot frais −3, lot périmé intact (10), batch_unallocated = 2')
    const { data: s9 } = await db.from('sales').select('review_reason').eq('id', r.data.sale.id).single()
    ok(String(s9.review_reason).includes('expired_stock_unresolved'), 'CAS 9 — vente « à vérifier » (expired_stock_unresolved)')
    invariant(it, 'CAS 9')
    const offSale = r.data.sale.id, offRid = r.rid
    r = await sell(P.id, 5, { offline: new Date().toISOString(), requestId: offRid })
    ok(r.data?.already_existed === true && await qtyOf(P.id) === 8 && await lotQ(P.lots[1]) === 0, 'CAS 11 — double synchronisation : rien n’est déduit deux fois')

    console.log('\n6. Modification et annulation (par écart)')
    let e = await edit(offSale, P.id, 4)
    it = await itemOf(offSale)
    ok(!e.error && await qtyOf(P.id) === 9 && it.batch_unallocated === 1 && await lotQ(P.lots[1]) === 0 && await lotQ(P.lots[0]) === 10, 'D — 5 → 4 : produit +1, non attribué 2 → 1, lots inchangés')
    invariant(it, 'D')
    e = await edit(offSale, P.id, 2)
    it = await itemOf(offSale)
    ok(!e.error && await qtyOf(P.id) === 11 && it.batch_unallocated === 0 && await lotQ(P.lots[1]) === 1 && await lotQ(P.lots[0]) === 10, 'E — 4 → 2 : produit +2, non attribué → 0, lot frais +1, périmé intact')
    invariant(it, 'E')
    const { error: ce } = await db.rpc('cancel_sale', { p_sale_id: offSale, p_cancelled_by: cashier, p_reason: RUN })
    ok(!ce && await qtyOf(P.id) === 13 && await lotQ(P.lots[1]) === 3 && await lotQ(P.lots[0]) === 10, 'C — annulation : produit +2 (13), lot frais +2 (3), lot périmé jamais touché (10)')
    P = await product('cancel-direct', 13, [{ q: 10, exp: addDays(today, -5) }, { q: 3, exp: addDays(today, 30) }])
    r = await sell(P.id, 5, { offline: new Date().toISOString() })
    await db.rpc('cancel_sale', { p_sale_id: r.data.sale.id, p_cancelled_by: cashier, p_reason: RUN })
    ok(await qtyOf(P.id) === 13 && await lotQ(P.lots[1]) === 3 && await lotQ(P.lots[0]) === 10, 'C — vente 5 (3 + 2 non attribuées) annulée : produit +5, lot frais +3, périmé intact')
    P = await product('edit-up', 25, [{ q: 5, exp: addDays(today, -2) }, { q: 20, exp: addDays(today, 30) }])
    r = await sell(P.id, 10)
    e = await edit(r.data.sale.id, P.id, 21)
    ok(e.error?.code === 'P0030', 'CAS 7 — augmentation 10 → 21 au-delà du vendable : refusée P0030')
    e = await edit(r.data.sale.id, P.id, 20)
    it = await itemOf(r.data.sale.id)
    ok(!e.error && await lotQ(P.lots[1]) === 0 && await lotQ(P.lots[0]) === 5 && it.alloc === 20, 'CAS 7 — augmentation 10 → 20 : lots frais seulement, périmé intact')
    invariant(it, 'CAS 7')
    e = await edit(r.data.sale.id, P.id, 20)
    const { count: mv } = await db.from('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', P.id).like('reason', 'Modification vente%')
    ok(!e.error && mv === 1, 'produit inchangé à la modification : aucun nouveau mouvement')

    console.log('\n7. Date métier de la VENTE (hors ligne, minuit)')
    // Lot qui périme le jour J (date de la boutique) : vente hors ligne datée de J 23 h 30 locale → vendable ;
    // datée de J+1 00 h 30 locale → périmé, jamais alloué (même si synchronisée bien plus tard).
    const J = today
    const localToUtc = (date, hh, mm) => { // instant UTC de « date hh:mm » dans le fuseau d'Alpha
      const guess = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
      const local = TZ.businessDate(tz, guess)
      const off = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
      return new Date(guess.getTime() - off).toISOString()
    }
    P = await product('minuit-avant', 4, [{ q: 4, exp: addDays(J, -1) }])
    r = await sell(P.id, 2, { offline: localToUtc(addDays(J, -1), 23, 50) })
    it = await itemOf(r.data.sale.id)
    ok(it.alloc === 2 && it.batch_unallocated === 0, `G/H — vente hors ligne la veille à 23 h 50 (locale), lot périmant ce jour-là : alloué (évalué à la date DE LA VENTE)`)
    P = await product('minuit-apres', 4, [{ q: 4, exp: addDays(J, -1) }])
    r = await sell(P.id, 2, { offline: localToUtc(J, 0, 10) })
    it = await itemOf(r.data.sale.id)
    ok(it.alloc === 0 && it.batch_unallocated === 2 && await lotQ(P.lots[0]) === 4, `G/I — vente hors ligne à 00 h 10 (locale) le lendemain : lot périmé jamais alloué (non attribué 2)`)

    console.log('\n8. Fonctions internes non exécutables directement')
    for (const fn of [['allocate_sale_batches', { p_product_id: P.id, p_qty: 1, p_as_of: today }], ['deplete_product_batches', { p_product_id: P.id, p_qty: 1, p_sale_item_id: null }],
      ['sellable_stock', { p_product_id: P.id, p_as_of: today }], ['shop_business_date', { p_shop_id: ALPHA }], ['edit_sale', { p_sale_id: r.data.sale.id, p_edited_by: cashier, p_customer_id: null, p_payment_method: 'cash', p_notes: '', p_items: [] }]]) {
      const { error } = await anon.rpc(fn[0], fn[1])
      ok(error && (error.code === '42501' || /permission denied/i.test(error.message)), `${fn[0]} : refusé au rôle anonyme (${error && error.code})`)
    }
  } catch (e) {
    if (!(e instanceof Stop)) { stopped = 'ERREUR ' + String(e.message).slice(0, 200); fail++; console.log('  ÉCHEC ' + stopped) }
  }
  if (stopped) {
    console.log('\nARRÊT IMMÉDIAT — ' + stopped)
    console.log('Aucune écriture supplémentaire, aucun nettoyage automatique. Objets TEST créés (identifiants) :')
    console.log(JSON.stringify(created))
    console.log('Lignes TEST présentes (lecture seule) :', JSON.stringify(await testCounts()))
    console.log('Alpha préexistant identique :', (await snapshotAlpha()) === before)
    console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(2)
  }

  console.log('\n9. Nettoyage par identifiants')
  const made = await testCounts()
  await cleanup()
  const left = await testCounts()
  const total = o => Object.values(o).reduce((n, v) => n + v, 0)
  console.log('  lignes TEST créées    :', JSON.stringify(made), '=', total(made))
  console.log('  lignes TEST restantes :', JSON.stringify(left), '=', total(left))
  check(total(left) === 0, `nettoyage : ${total(made)} lignes TEST supprimées par identifiant, 0 restante`)
  const { count: byName } = await db.from('products').select('id', { count: 'exact', head: true }).like('name', `${RUN}%`)
  const { count: salesByNote } = await db.from('sales').select('id', { count: 'exact', head: true }).eq('notes', RUN)
  check(byName === 0 && salesByNote === 0, 'aucun produit ni vente au nom du test (contrôle indépendant des identifiants)')
  check((await snapshotAlpha()) === before, 'Alpha : boutique, produits, lots, ventes et clients préexistants identiques avant / après')
  const counterAfter = await saleCounter()
  console.log(`  compteur de numéros de vente d’Alpha : ${counterBefore} → ${counterAfter} (${created.sales.length} ventes TEST numérotées, opération attendue)`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR hors du bloc de test :', e.message, '— objets créés :', JSON.stringify(created), '(aucun nettoyage automatique)'); process.exit(2) })
