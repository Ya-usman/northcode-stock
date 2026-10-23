// Inventaire v2 (migration 175 + nouvel écran) — TEST RÉEL sur Boutique Alpha UNIQUEMENT, sur des produits « TEST inv … »
// créés pour l'occasion (parcours normal), puis supprimés par le parcours normal. Aucun autre produit n'est compté :
// la finalisation ne peut ajuster que ces produits.
// MODE ÉCRITURE explicite (lib/write-mode.js) : référence unique par exécution dans le nom des produits ; à la fin,
// seules les lignes NOUVELLES d'Alpha qui citent cette exécution (produits, lots, mouvements, comptages, sessions,
// journal) sont supprimées, une à une. Mise à jour (23 oct. 2026) — ancienne hypothèse : les sessions d'essai restaient
// dans l'historique d'Alpha. Réel : aucune trace laissée.
// Seule manipulation directe (fixture) : le stock d'un produit TEST abaissé en base pour SIMULER des ventes faites
// pendant l'inventaire (aucune vente réelle créée). Serveur local obligatoire (lib-session refuse toute autre adresse).
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { openPage } = require('./lib/session.js')
const { enableWrite } = require('./lib/write-mode.js')
const BASE = 'http://localhost:3000'
let W = null
const P = {}             // produits TEST de cette exécution
const SESS = new Set()   // sessions d'inventaire créées par CETTE exécution
const LINKED_IDS = new Set()   // lignes rattachées aux produits TEST, relevées avant leur suppression
let cleaned = false
// Lignes nouvelles d'Alpha qui citent cette exécution (référence, produits TEST, sessions) — une à une, par identifiant
async function cleanupRun() {
  if (!W || cleaned) return true
  cleaned = true
  const tokens = [W.RUN, W.RUN.toUpperCase(), ...Object.values(P).map(x => x.id), ...SESS, ...LINKED_IDS]
  const cites = r => { const j = JSON.stringify(r); return tokens.some(t => j.includes(t)) }
  return W.finish({
    inventory_counts: cites, stock_movements: cites, product_batches: cites, stock_reservations: cites,
    audit_logs: cites, deleted_records_log: cites, inventory_sessions: r => SESS.has(r.id), products: cites,
  })
}
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
let stamp = null   // = référence de l'exécution (W.RUN), posée au démarrage

const api = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = {}; try { j = await r.json() } catch {}
  return { status: r.status, json: j }
}, { method, url, body })

async function session(opts = {}) {
  const s = await openPage({ width: opts.width || 1280, height: opts.height || 900, skipGoto: true, write: W })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, [opts.filter || ALPHA])
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 140)))
  return s
}
const gotoInventory = async page => {
  await page.goto(`${BASE}/fr/stock/inventory-count`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(5000)
}
const card = (page, id) => page.locator(`[data-product-id="${id}"]`)
async function countVia(page, p, qty, bySku = false) {
  await page.getByTestId('inventory-search').fill(bySku ? p.sku : p.name); await page.waitForTimeout(500)
  const c = card(page, p.id)
  const input = c.getByTestId('inventory-qty')
  if (!(await input.count())) await c.getByTestId('inventory-recount').click()
  await input.fill(String(qty)); await c.getByTestId('inventory-validate').click()
  await page.waitForTimeout(1500)
  return c
}

;(async () => {
  W = await enableWrite({ test: 'inventory-v2', routes: [/\/api\/products(\?|$)/, /\/api\/stock\/inventory-sessions(\/|\?|$)/] })
  stamp = W.RUN.toUpperCase()
  // ── Préalable : aucune session en cours sur Alpha (on ne touche jamais à l'inventaire de quelqu'un) ──
  const { data: open } = await db.from('inventory_sessions').select('id, reference').eq('shop_id', ALPHA).eq('status', 'in_progress')
  if (open?.length) { console.log('Un inventaire est déjà en cours sur Alpha (' + open[0].reference + ') : test arrêté sans rien faire.'); process.exit(1) }

  let s = await session(); let page = s.page
  await page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded' })

  console.log('Préparation : 6 produits « TEST inv » dans Boutique Alpha (parcours normal)')
  const specs = [
    { key: 'A', qty: 28, sku: `TINV${stamp}A` }, { key: 'B', qty: 28 }, { key: 'C', qty: 28 },
    { key: 'D', qty: 0 }, { key: 'E', qty: 5 }, { key: 'F', qty: 3 },
  ]
  for (const sp of specs) {
    const r = await api(page, 'POST', '/api/products', { shop_id: ALPHA, name: `TEST inv ${sp.key} ${stamp}`, selling_price: 500, buying_price: 300, quantity: sp.qty, unit: 'piece', sku: sp.sku || null, is_active: true })
    if (r.status !== 200 || !r.json?.data?.id) throw new Error(`création impossible ${sp.key} : ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
    P[sp.key] = { id: r.json.data.id, name: `TEST inv ${sp.key} ${stamp}`, sku: sp.sku || null, qty: sp.qty }
  }
  ok(Object.keys(P).length === 6, 'produits TEST créés (A 28 avec code-barres, B 28, C 28, D 0, E 5, F 3)')
  const qtyOf = async k => (await db.from('products').select('quantity').eq('id', P[k].id).single()).data.quantity

  let sessionId = null
  try {
    console.log('\n1. Aucun inventaire en cours')
    await gotoInventory(page)
    ok(await page.getByTestId('inventory-idle').isVisible() && await page.getByTestId('inventory-start').isVisible(), '« Inventaire physique » + « Démarrer un inventaire » (aucun produit ni quantité affichés)')
    const g = await api(page, 'GET', `/api/stock/inventory-sessions?shop_id=${ALPHA}`)
    const leaks = (g.json.products || []).filter(p => 'quantity' in p || 'buying_price' in p || 'selling_price' in p).length
    ok(g.status === 200 && g.json.products.length > 0 && leaks === 0, `liste des produits SANS stock enregistré ni prix (${g.json.products.length} produits, ${leaks} fuite)`)

    console.log('\n2. Démarrer : session, rien au stock')
    await page.getByTestId('inventory-start').click(); await page.waitForTimeout(3000)
    const { data: sess } = await db.from('inventory_sessions').select('id, reference, status, products_total').eq('shop_id', ALPHA).eq('status', 'in_progress').single()
    sessionId = sess.id
    SESS.add(sessionId)
    ok(await page.getByTestId('inventory-session').isVisible() && (await page.getByTestId('inventory-session').innerText()).includes(sess.reference), `session ${sess.reference} créée et affichée (${sess.products_total} produits)`)
    ok(await qtyOf('A') === 28 && await qtyOf('E') === 5, 'démarrer ne modifie aucun stock')
    const r2 = await api(page, 'POST', '/api/stock/inventory-sessions', { shop_id: ALPHA })
    ok(r2.json?.data?.resumed === true && r2.json.data.id === sessionId, 'démarrer une 2e fois = reprendre la même session (une seule en cours)')

    console.log('\n3. Comptage à l’aveugle')
    await page.getByTestId('inventory-search').fill(P.B.name); await page.waitForTimeout(500)
    const inputB = card(page, P.B.id).getByTestId('inventory-qty')
    ok(await inputB.inputValue() === '' && !(await inputB.getAttribute('placeholder')) && !/28/.test(await card(page, P.B.id).innerText()),
      'champ VIDE, aucun exemple, le stock enregistré (28) n’apparaît nulle part avant le comptage')
    let c = await countVia(page, P.B, 26)
    let txt = await c.innerText()
    ok(/26 comptés/.test(txt) && /Écart : -2/.test(txt) && /Théorique : 28/.test(txt), 'B : compté 26 → « 26 comptés », « Écart : -2 », « Théorique : 28 » (affiché APRÈS)')
    c = await countVia(page, P.A, 28, true)
    ok(/Conforme/.test(await c.innerText()) && await c.getAttribute('data-state') === 'conform', 'A retrouvé par son code-barres, compté 28 → « Conforme », aucun motif demandé')
    c = await countVia(page, P.C, 31); ok(/Écart : \+3/.test(await c.innerText()), 'C : compté 31 → « Écart : +3 »')
    c = await countVia(page, P.D, 4); ok(/Écart : \+4/.test(await c.innerText()), 'D : stock 0, compté 4 → « Écart : +4 »')
    c = await countVia(page, P.E, 1); ok(/Écart : -4/.test(await c.innerText()), 'E : compté 1 → « Écart : -4 »')
    await page.getByTestId('inventory-search').fill(P.F.name); await page.waitForTimeout(500)
    ok(await card(page, P.F.id).getAttribute('data-state') === 'todo', 'F non compté → reste « À compter »')
    ok(await qtyOf('B') === 28 && await qtyOf('C') === 28, 'compter ne modifie aucun stock')

    console.log('\n4. Reprise après fermeture')
    await s.browser.close()
    s = await session(); page = s.page; await gotoInventory(page)
    const prog = await page.getByTestId('inventory-progress').innerText()
    ok(/^5 \/ \d+ produits comptés/.test(prog.trim()), `nouvelle ouverture : progression conservée (« ${prog.trim()} »)`)
    await page.getByTestId('inventory-search').fill(P.B.name); await page.waitForTimeout(500)
    ok(/26 comptés/.test(await card(page, P.B.id).innerText()), 'le comptage de B est toujours là')

    console.log('\n5. Deux appareils : jamais d’écrasement silencieux')
    const other = await session(); await other.page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded' })
    const conf = await api(other.page, 'POST', `/api/stock/inventory-sessions/${sessionId}/count`, { shop_id: ALPHA, product_id: P.B.id, counted_qty: 25, expected_count_id: null })
    ok(conf.json?.data?.conflict === true && conf.json.data.current?.counted_qty === 26, '2e appareil (comptage chargé avant celui de B) → « conflit », comptage actuel 26 renvoyé, rien écrit')
    await other.browser.close()
    await page.getByTestId('inventory-search').fill(P.B.name); await page.waitForTimeout(400)
    ok(/26 comptés/.test(await card(page, P.B.id).innerText()), 'B garde 26')

    console.log('\n6. Filtres')
    await page.getByTestId('inventory-search').fill(`TEST inv`); await page.waitForTimeout(400)
    await page.locator('[data-filter="diff"]').click(); await page.waitForTimeout(300)
    let ids = await page.locator('[data-product-id]').evaluateAll(els => els.map(e => e.getAttribute('data-product-id')))
    ok(ids.length === 4 && [P.B, P.C, P.D, P.E].every(p => ids.includes(p.id)), `« Avec écart » : B, C, D, E (${ids.length})`)
    await page.locator('[data-filter="todo"]').click(); await page.waitForTimeout(300)
    ids = await page.locator('[data-product-id]').evaluateAll(els => els.map(e => e.getAttribute('data-product-id')))
    ok(ids.includes(P.F.id) && !ids.includes(P.A.id), '« À compter » : F présent, A (compté) absent')
    await page.locator('[data-filter="all"]').click()

    console.log('\n7. Vérification des écarts')
    await page.getByTestId('inventory-review').click(); await page.waitForTimeout(800)
    const step = page.getByTestId('inventory-review-step')
    ok(await step.locator('[data-diff-id]').count() === 4 && await page.getByTestId('inventory-finalize').isDisabled(), '4 écarts listés ; « Finaliser » bloqué tant qu’un motif manque')
    const summary = await page.getByTestId('inventory-review-summary').innerText()
    ok(/1 produit conforme/.test(summary) && /non comptés : leur stock ne sera pas modifié/.test(summary), `résumé : « ${summary.trim()} »`)
    const reasonFor = { [P.B.name]: 'loss', [P.C.name]: 'correction', [P.D.name]: 'correction', [P.E.name]: 'damage' }
    for (const row of await step.locator('[data-diff-id]').all()) {
      const name = (await row.locator('p').first().innerText()).trim()
      await row.getByTestId('inventory-reason').selectOption(reasonFor[name]); await page.waitForTimeout(600)
      if (name === P.C.name) { await row.locator('input[type=date]').fill('2027-03-15'); await page.waitForTimeout(800) }
    }
    ok(await step.locator('input[type=date]').count() === 2, 'date de péremption facultative proposée pour les 2 surplus seulement (C, D)')
    ok(await page.getByTestId('inventory-finalize').isEnabled(), 'tous les motifs donnés → « Finaliser » disponible')

    console.log('\n8. Ventes pendant l’inventaire → conflit, rien appliqué')
    if (W.before.products.has(P.E.id)) throw new Error('fixture : E n’est pas un produit de cette exécution')
    await db.from('products').update({ quantity: 2 }).eq('id', P.E.id).eq('shop_id', ALPHA) // fixture : 3 ventes simulées sur E (TEST de cette exécution)
    const movBefore = (await db.from('stock_movements').select('id', { count: 'exact', head: true }).eq('count_session_id', sessionId)).count
    await page.getByTestId('inventory-finalize').click(); await page.waitForTimeout(600)
    ok(/Les 4 écarts vont ajuster le stock/.test(await page.getByTestId('inventory-finalize-points').innerText()), 'confirmation claire : écarts → stock, clôture, historique')
    await page.getByRole('dialog').getByRole('button', { name: 'Finaliser l’inventaire' }).click(); await page.waitForTimeout(3000)
    ok(await page.getByTestId('inventory-recount-required').isVisible() && (await page.getByTestId('inventory-recount-required').innerText()).includes(P.E.name),
      'E : stock actuel 2 + écart −4 < 0 → « Certains produits doivent être recomptés », E listé')
    const movAfter = (await db.from('stock_movements').select('id', { count: 'exact', head: true }).eq('count_session_id', sessionId)).count
    ok(await qtyOf('B') === 28 && await qtyOf('C') === 28 && await qtyOf('E') === 2 && movAfter === movBefore, 'rien n’est appliqué ni écrêté (B 28, C 28, E 2, aucun mouvement)')

    console.log('\n9. Recompter E, finaliser')
    await page.getByTestId('inventory-search').fill(P.E.name); await page.waitForTimeout(400)
    ok(/À recompter/.test(await card(page, P.E.id).innerText()), 'E marqué « À recompter »')
    c = await countVia(page, P.E, 1)
    ok(/Écart : -1/.test(await c.innerText()) && /Théorique : 2/.test(await c.innerText()), 'recompté 1 : nouveau théorique 2 (noté maintenant), écart -1')
    await page.getByTestId('inventory-review').click(); await page.waitForTimeout(800)
    const rowE = page.getByTestId('inventory-review-step').locator('[data-diff-id]').filter({ hasText: P.E.name })
    ok(await rowE.getByTestId('inventory-reason').inputValue() === '', 'le recomptage efface l’ancien motif de E (nouvelle ligne)')
    await rowE.getByTestId('inventory-reason').selectOption('damage'); await page.waitForTimeout(700)
    await page.getByTestId('inventory-finalize').click(); await page.waitForTimeout(500)
    await page.getByRole('dialog').getByRole('button', { name: 'Finaliser l’inventaire' }).click(); await page.waitForTimeout(3500)
    ok(await page.getByTestId('inventory-idle').isVisible().catch(() => false), 'inventaire finalisé → retour à l’écran « Démarrer un inventaire »')

    console.log('\n10. Résultat en base')
    const q = { A: await qtyOf('A'), B: await qtyOf('B'), C: await qtyOf('C'), D: await qtyOf('D'), E: await qtyOf('E'), F: await qtyOf('F') }
    ok(q.A === 28 && q.B === 26 && q.C === 31 && q.D === 4 && q.E === 1 && q.F === 3, `stock : A ${q.A}, B ${q.B}, C ${q.C}, D ${q.D}, E ${q.E}, F ${q.F} (écart appliqué au stock du moment ; F non compté inchangé)`)
    const { data: mv } = await db.from('stock_movements').select('product_id, type, quantity, previous_qty, new_qty, reason').eq('count_session_id', sessionId)
    const mvOf = k => mv.find(m => m.product_id === P[k].id)
    ok(mv.length === 4 && mvOf('B')?.reason === 'Inventaire physique — Perte' && mvOf('B').previous_qty === 28 && mvOf('B').new_qty === 26 && mvOf('E')?.reason === 'Inventaire physique — Dommage' && mvOf('E').previous_qty === 2 && mvOf('E').new_qty === 1 && !mvOf('A'),
      `4 mouvements (B −2 Perte, C +3, D +4, E −1 Dommage, 2 → 1), aucun pour A conforme`)
    const { data: lots } = await db.from('product_batches').select('product_id, quantity, expiry_date, source, origin_inventory_session_id, buying_price').in('product_id', [P.B.id, P.C.id, P.D.id])
    const lotC = lots.find(l => l.product_id === P.C.id && l.source === 'inventory')
    const lotD = lots.find(l => l.product_id === P.D.id && l.source === 'inventory')
    const lotB = lots.filter(l => l.product_id === P.B.id).reduce((n, l) => n + l.quantity, 0)
    ok(lotC && lotC.quantity === 3 && lotC.expiry_date === '2027-03-15' && lotC.origin_inventory_session_id === sessionId, 'surplus C : lot « Inventaire » de 3, péremption 15/03/2027, lié à la session')
    ok(lotD && lotD.quantity === 4 && lotD.expiry_date === null && Number(lotD.buying_price) === 300, 'surplus D : lot « Inventaire » de 4, « Sans date », coût = prix d’achat du produit')
    ok(lotB === 26, `manque B : lots épuisés par la règle FEFO existante (28 → ${lotB})`)
    const { data: audit } = await db.from('audit_logs').select('action, metadata').eq('target_id', sessionId)
    const fin = audit.find(a => a.action === 'inventory.finalize')
    ok(audit.some(a => a.action === 'inventory.start') && fin && fin.metadata.adjusted === 4 && fin.metadata.discrepancies === 4, `journal : inventory.start + inventory.finalize (${fin?.metadata.counted} comptés, ${fin?.metadata.adjusted} ajustés)`)
    const again = await api(page, 'POST', `/api/stock/inventory-sessions/${sessionId}/finalize`, { shop_id: ALPHA })
    ok(again.json?.data?.already_completed === true && await qtyOf('B') === 26 && await qtyOf('C') === 31, 'finaliser une 2e fois → « déjà terminée », rien réappliqué')

    console.log('\n11. Historique')
    await page.getByTestId('inventory-history').click(); await page.waitForTimeout(2000)
    const hd = page.getByTestId('inventory-history-drawer')
    const hText = await hd.innerText()
    ok(hText.includes(sess.reference) && /Terminé/.test(hText) && /4 écarts/.test(hText), `« ${sess.reference} · Terminé · … · 4 écarts » dans les inventaires précédents`)
    await hd.locator(`[data-history-id="${sessionId}"]`).click(); await page.waitForTimeout(2000)
    const dd = await page.getByTestId('inventory-detail-drawer').innerText()
    ok(dd.includes(P.B.name) && /Perte/.test(dd) && dd.includes(P.A.name) && /Conforme/.test(dd), 'détail en lecture seule : lignes, motifs, conformes')
    await page.keyboard.press('Escape'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500)

    console.log('\n12. Abandon : aucun stock modifié')
    await gotoInventory(page)
    await page.getByTestId('inventory-start').click(); await page.waitForTimeout(3000)
    const { data: s2 } = await db.from('inventory_sessions').select('id').eq('shop_id', ALPHA).eq('status', 'in_progress').single()
    SESS.add(s2.id)
    await countVia(page, P.A, 10)
    await page.getByTestId('inventory-abandon').click(); await page.waitForTimeout(400)
    await page.getByRole('dialog').getByRole('button', { name: 'Abandonner l’inventaire' }).click(); await page.waitForTimeout(2500)
    const { data: s2b } = await db.from('inventory_sessions').select('status').eq('id', s2.id).single()
    const { data: a2 } = await db.from('audit_logs').select('action').eq('target_id', s2.id)
    ok(s2b.status === 'cancelled' && await qtyOf('A') === 28 && a2.some(a => a.action === 'inventory.cancel'), 'abandonné : statut « Abandonné », A reste 28, journal inventory.cancel')

    console.log('\n13. Accès réservé au serveur, boutique contrôlée')
    const anonClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const direct = await anonClient.from('inventory_sessions').select('id').limit(1)
    ok(!!direct.error || (direct.data || []).length === 0, `lecture directe des tables par le navigateur refusée (${direct.error?.code || 'vide'})`)
    const foreign = await api(page, 'GET', `/api/stock/inventory-sessions?shop_id=${AKWA}`)
    ok(foreign.status === 403, `boutique d’une autre entreprise → refus (${foreign.status})`)

    console.log('\n14. « Toutes les boutiques » : choix explicite')
    ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    await s.browser.close()
    s = await session({ filter: 'all' }); page = s.page; await gotoInventory(page)
    ok(await page.getByTestId('inventory-pick-shop').isVisible() && await page.getByTestId('inventory-start').count() === 0, '« Toutes » : la boutique est demandée avant tout inventaire')
    await page.getByTestId('inventory-pick-shop').getByRole('button').click()
    await page.getByTestId('shop-picker').locator(`[data-shop-option="${ALPHA}"]`).click(); await page.waitForTimeout(4000)
    ok((await page.getByTestId('inventory-shop').innerText()).includes('Boutique Alpha') && await page.getByTestId('inventory-idle').isVisible(), 'Alpha choisie : « Inventaire : Boutique Alpha »')

    console.log('\n15. Téléphone (390 px)')
    await s.browser.close()
    s = await session({ width: 390, height: 844 }); page = s.page; await gotoInventory(page)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal')
    const btn = await page.getByTestId('inventory-start').boundingBox()
    ok(btn && btn.height >= 44, `bouton principal confortable au doigt (${Math.round(btn?.height || 0)} px)`)
    await page.screenshot({ path: __dirname + '/out/inventory-idle-390.png' })
  } finally {
    console.log('\nNettoyage : produits TEST supprimés par le parcours normal')
    await s.page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    // Seules les sessions de CETTE exécution encore ouvertes (jamais celle de quelqu'un d'autre)
    const leftover = ((await db.from('inventory_sessions').select('id').eq('shop_id', ALPHA).eq('status', 'in_progress')).data || []).filter(l => !W.before.inventory_sessions.has(l.id))
    for (const l of leftover) await api(s.page, 'POST', `/api/stock/inventory-sessions/${l.id}/cancel`, { shop_id: ALPHA })
    // Avant la suppression des produits TEST : identifiants des lignes qui les citent (mouvements, lots, comptages) —
    // la suppression détache ces lignes du produit (produit = vide) ; le nettoyage les retrouve par leur identifiant
    const pids = Object.values(P).map(x => x.id)
    if (pids.length) for (const t of ['stock_movements', 'product_batches', 'inventory_counts']) {
      const rows = (await db.from(t).select('id').eq('shop_id', ALPHA).in('product_id', pids)).data || []
      rows.forEach(r => LINKED_IDS.add(r.id))
    }
    await W.checkpoint()
    let gone = 0
    for (const k of Object.keys(P)) { const r = await api(s.page, 'DELETE', `/api/products?id=${P[k].id}&shop_id=${ALPHA}`); if (r.status === 200) gone++ }
    const still = (await db.from('products').select('id').in('id', Object.values(P).map(p => p.id))).data || []
    ok(gone === 6 && still.length === 0, `produits TEST supprimés (${gone}/6), aucun restant`)
    await s.browser.close()
    ok(await cleanupRun(), 'mode écriture : rien de préexistant touché, aucune trace restante en base')
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(async e => {
  console.error('ERREUR', e.message.slice(0, 500))
  // Arrêt imprévu : nettoyage quand même (lignes de cette exécution seulement)
  try { await cleanupRun() } catch (c) { console.error('NETTOYAGE IMPOSSIBLE', c.message) }
  console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1)
})
