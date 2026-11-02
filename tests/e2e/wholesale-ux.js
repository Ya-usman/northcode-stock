// Prix de gros (migration 201, 1er nov. 2026) : écrans. LECTURE SEULE, serveur local, Boutique Alpha, propriétaire.
// Le prix de gros d'un produit d'Alpha est SIMULÉ dans les réponses lues par le navigateur (rien n'est écrit en base) ;
// tout envoi est intercepté.
//  1. formulaire « Ajouter un produit » : exemple calculé, gros au-dessus du détail refusé avant envoi, colis + stock
//     de départ en cartons converti à la pièce, carton créé après le produit ;
//  2. caisse : « Encore N … pour le prix de gros », puis badge « Prix de gros » et prix de la ligne = prix de gros ;
//  3. réassort : prix de vente proposés (résumé), « Modifier », prix sous le coût = rouge + enregistrement bloqué tant
//     que la vente à perte n'est pas confirmée ; « + Nouveau conditionnement » proposé.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/wholesale-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const m = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  // Produit d'Alpha simple (ni kit, ni numéros), avec au moins 6 en stock : on lui SIMULE un prix de gros dès 3
  const { data: cands } = await db.from('products').select('id, name, selling_price, quantity').eq('shop_id', ALPHA).eq('is_active', true)
    .eq('track_serials', false).eq('is_kit', false).gte('quantity', 6).gte('selling_price', 100).order('name').limit(10)
  const P = cands[0]
  const W = Math.floor(Number(P.selling_price) * 0.8), MIN = 3
  console.log(`Repère : « ${P.name} » (${P.selling_price} F, ${P.quantity} en stock), gros simulé ${W} F dès ${MIN}`)

  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  const page = s.page
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
  const sent = []
  // Lectures : prix de gros simulé sur le produit repère
  await page.route(/\/rest\/v1\/products\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch(); let body = await res.text()
    try { const j = JSON.parse(body); const arr = Array.isArray(j) ? j : null; if (arr) { for (const p of arr) if (p.id === P.id) { p.price_tiers = [{ min_qty: MIN, price: W }] } body = JSON.stringify(arr) } } catch {}
    return route.fulfill({ response: res, body })
  })
  // Carton simulé pour la caisse (bouton « + 1 carton ») : MIN pièces
  await page.route(/\/api\/products\/packagings\?.*pos=1/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ product_id: P.id, unit: 'carton', units_per_pack: MIN, is_default: true }] }) }))
  // Écritures : toutes interceptées
  await page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    const path = new URL(r.url()).pathname
    sent.push({ method: r.method(), path, body })
    const data = path === '/api/products' && r.method() === 'POST' ? { data: { id: '00000000-0000-4000-8000-0000000000aa' } } : path === '/api/products/packagings' ? { data: { id: '00000000-0000-4000-8000-0000000000bb', unit: body.unit, units_per_pack: body.units_per_pack, barcode: null, is_default: true } } : { ok: true }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })

  console.log('\n1. Formulaire « Ajouter un produit »')
  await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  const openAdd = async () => {
    await page.locator('[data-tour="add-product-menu"]:visible').first().click()
    await page.getByRole('menuitem', { name: m.products.add_product ?? 'Ajouter un produit' }).click()
    await page.locator('#product-form').waitFor({ timeout: 15000 }); await wait(700)
  }
  const form = page.locator('#product-form')
  await openAdd()
  await form.locator('#product-name').fill('TEST gros formulaire')
  await form.locator('[data-tour="product-prices"] input').first().fill('500')
  await form.getByRole('button', { name: new RegExp(m.product_form.more_options) }).click(); await wait(300)
  // Palier 1 : dès 24 à 520 F (au-dessus du détail : refusé)
  await form.getByTestId('product-tier-min').first().fill('24')
  await form.getByTestId('product-tier-price').first().fill('520')
  await page.locator('button[form="product-form"]').first().click(); await wait(800)
  ok(!sent.some(x => x.path === '/api/products') && (await form.innerText()).includes(m.wholesale.error_not_below_retail), 'gros au-dessus du détail : refusé avant envoi, message sous le champ')
  await form.getByTestId('product-tier-price').first().fill('450'); await wait(300)
  const ex = (await form.getByTestId('product-wholesale-example').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(/24/.test(ex) && /10 %/.test(ex) && /450/.test(ex), `exemple calculé : « ${ex} »`)
  // Palier 2 par un bouton tout prêt : « Douzaine (12) » crée un palier dès 12, prix à saisir
  await form.getByRole('button', { name: /^Douzaine \(12\)$/ }).click(); await wait(300)
  ok(await form.getByTestId('product-tier').count() === 2 && (await form.getByTestId('product-tier-min').nth(1).inputValue()) === '12', 'bouton « Douzaine (12) » : second palier dès 12')
  await form.getByTestId('product-tier-price').nth(1).fill('470'); await wait(200)
  await form.getByTestId('product-wholesale').screenshot({ path: OUT + '/wholesale-paliers.png' }).catch(() => {})
  // Colis + stock de départ en cartons
  await form.getByTestId('product-pack-unit').click(); await page.getByRole('option', { name: /^carton/i }).click(); await wait(300)
  await form.getByTestId('product-pack-units').fill('24')
  await form.getByTestId('product-initial-in-packs').check()
  await form.locator('[data-tour="product-stock"] input').last().fill('2')
  await form.locator('[data-tour="product-prices"] input').nth(1).fill('9600')
  await wait(300)
  const conv = (await form.getByTestId('product-pack-conversion').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(/48/.test(conv) && /400/.test(conv), `conversion : « ${conv} »`)
  await page.screenshot({ path: `${OUT}/wholesale-form.png` })
  await page.locator('button[form="product-form"]').first().click(); await wait(2000)
  const post = sent.find(x => x.path === '/api/products' && x.method === 'POST')
  const tiers = (post?.body.price_tiers || []).map(x => `${x.min_qty}:${x.price}`).sort().join()
  ok(post && post.body.quantity === 48 && post.body.buying_price === 400 && tiers === '12:470,24:450', `envoi : 48 pièces à 400 F, paliers ${tiers}`)
  const pack = sent.find(x => x.path === '/api/products/packagings')
  ok(pack && pack.body.unit === 'carton' && pack.body.units_per_pack === 24 && pack.body.product_id === '00000000-0000-4000-8000-0000000000aa', 'carton de 24 créé après le produit (envoi intercepté)')
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await wait(300) }
  if (await page.getByRole('button', { name: m.dialogs.unsaved_discard }).count()) await page.getByRole('button', { name: m.dialogs.unsaved_discard }).click()

  console.log('\n2. Caisse')
  await page.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  await page.getByPlaceholder(/Rechercher un produit/).first().fill(P.name.trim()); await wait(1200)
  const card = (await page.getByTestId('card-wholesale').first().innerText().catch(() => '')).trim()
  ok(card === `Gros dès ${MIN} pièces`, `carte de la grille : « ${card} »`)
  await page.locator('[data-tour="pos-grid"] button, [data-tour="pos-grid"] [role="button"]').filter({ hasText: P.name.trim() }).first().click(); await wait(800)
  const line = page.locator('main').getByText(P.name.trim(), { exact: false }).last()
  const qtyInput = page.locator('input[type="number"]').filter({ hasNot: page.locator('[disabled]') }).last()
  await qtyInput.fill(String(MIN - 1)); await qtyInput.press('Tab'); await wait(600)
  const hint = (await page.getByTestId('cart-wholesale-hint').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(/Encore 1/.test(hint) && /prix de gros/.test(hint), `rappel : « ${hint} »`)
  await qtyInput.fill(String(MIN)); await qtyInput.press('Tab'); await wait(600)
  ok(await page.getByTestId('cart-wholesale-badge').count() >= 1, 'badge « Prix de gros » sur la ligne')
  const cartText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  ok(cartText.includes(W.toLocaleString('fr-FR').replace(/ /g, ' ')) || cartText.includes(String(W)), `prix de la ligne = prix de gros (${W})`)
  await page.screenshot({ path: `${OUT}/wholesale-caisse.png` })
  const badge = (await page.getByTestId('cart-wholesale-badge').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(/^Prix de gros · −/.test(badge), `économie affichée : « ${badge} »`)
  // Retour à 1 pièce : ni badge, ni rappel (vente au détail) ; puis « + 1 carton »
  await qtyInput.fill('1'); await qtyInput.press('Tab'); await wait(600)
  ok(await page.getByTestId('cart-wholesale-badge').count() === 0 && await page.getByTestId('cart-wholesale-hint').count() === 0, 'à 1 pièce : prix de détail, aucun rappel (vente au détail)')
  await page.getByTestId('cart-add-pack').first().click(); await wait(600)
  ok((await qtyInput.inputValue()) === String(1 + MIN) && await page.getByTestId('cart-wholesale-badge').count() >= 1, `« + 1 carton » : ${1 + MIN} pièces, prix de gros appliqué`)
  void line

  console.log('\n3. Réassort : prix de vente proposés')
  await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  await page.getByLabel(m.products.search_placeholder).first().fill(P.name.trim()); await wait(1500)
  // « Réapprovisionner » : bouton de la ligne quand le stock est bas, sinon dans « … » (lot « simplicité » n° 2)
  const row = page.locator(`[data-product-card="${P.id}"], tr`).filter({ hasText: P.name.trim() }).first()
  if (await row.getByRole('button', { name: new RegExp(m.actions.restock) }).count()) await row.getByRole('button', { name: new RegExp(m.actions.restock) }).first().click()
  else { await row.getByRole('button', { name: m.products.more_actions }).first().click(); await wait(400); await page.getByRole('menuitem', { name: m.actions.restock }).click() }
  const rp = page.getByTestId('reception-prices'); await rp.waitFor({ timeout: 15000 }).catch(() => {})
  const sum = (await page.getByTestId('reception-prices-summary').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(sum.includes('Détail') && sum.includes('Gros') && sum.includes(String(MIN)), `résumé : « ${sum} »`)
  // « Saisir en » n'apparaît qu'une fois les cartons du produit chargés (jamais « pièces » puis « carton »)
  await page.getByTestId('restock-pack-select').waitFor({ timeout: 15000 }).catch(() => {})
  ok(await page.getByTestId('restock-pack-select').count() === 1, 'liste « Saisir en » proposée (avec « + Nouveau conditionnement »)')
  await page.getByTestId('restock-pack-select').click(); await wait(300)
  ok(await page.getByRole('option', { name: m.packaging.new_option }).count() === 1, `« ${m.packaging.new_option} » dans la liste`)
  await page.keyboard.press('Escape'); await wait(300)
  await page.getByTestId('reception-prices-edit').click(); await wait(300)
  // Saisie à la pièce (le produit peut avoir un carton par défaut : le prix serait alors celui d'un carton)
  await page.getByTestId('restock-pack-select').click(); await page.getByRole('option', { name: /^pièces$/ }).click(); await wait(300)
  // Coût d'achat saisi au-dessus du prix de détail : marge négative
  await page.locator('input[name="buying_price"]').fill(String(Number(P.selling_price) + 100)); await wait(400)
  const lossShown = await page.getByTestId('reception-prices-loss').count() === 1
  if (!lossShown) { await page.screenshot({ path: OUT + '/wholesale-reassort-diagnostic.png' }); console.log('    diagnostic : prix d’achat saisi « ' + await page.locator('input[name="buying_price"]').inputValue().catch(() => '?') + ' », dialogues ouverts : ' + await page.getByRole('dialog').count()) }
  ok(lossShown, 'prix sous le coût : ligne rouge et explication')
  const before = sent.length
  await page.getByRole('button', { name: new RegExp(`^${m.actions.restock}$`) }).last().click(); await wait(1200)
  ok(sent.length === before, 'enregistrement bloqué tant que la vente à perte n’est pas confirmée (rien envoyé)')
  await page.screenshot({ path: `${OUT}/wholesale-reassort.png` })
  await page.getByTestId('reception-prices-loss-ok').check(); await wait(200)
  await page.getByRole('button', { name: new RegExp(`^${m.actions.restock}$`) }).last().click(); await wait(2000)
  ok(sent.some(x => x.method === 'PUT' && x.path === '/api/products'), 'confirmée : le réassort part (intercepté)')
  ok(!errors.length, 'aucune erreur JavaScript', errors)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
