// Mesures de vente (migration 203, 2 nov. 2026) : écrans. LECTURE SEULE, serveur local, Boutique Alpha, propriétaire.
// Les mesures sont SIMULÉES dans les réponses lues par le navigateur (rien n'est écrit en base) ; tout envoi est
// intercepté (l'encaissement reçoit un refus simulé, aucune vente n'est enregistrée ni mise en file).
//  1. formulaire « Ajouter un produit » en grammes : prix au kilo, stock en kg, bloc « Vente à la mesure » en tête,
//     contrôle avant envoi, « environ 8 kg », envoi en grammes ;
//  2. caisse, produit à la pièce vendu aussi au paquet : choix « À l'unité » / « Paquet », deux lignes distinctes,
//     « 2 400 F / paquet », nombre de paquets, stock partagé ;
//  3. caisse, produit en grammes vendu uniquement par mesures : carte « Verre · Boîte · Seau », « 200 F / verre »,
//     stock en kg, pas d'« À l'unité » ; ligne « · Boîtes » ; encaissement envoyé avec la mesure (intercepté).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/sale-measures-ux.js
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
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 400) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  // Deux produits simples d'Alpha (ni kit, ni numéros, sans lot périmé) : P vendu aussi au paquet de 2,
  // Q présenté comme du riz en grammes (37,5 kg) vendu au verre, à la boîte, au seau
  const { data: cands } = await db.from('products').select('id, name, selling_price, quantity').eq('shop_id', ALPHA).eq('is_active', true)
    .eq('track_serials', false).eq('is_kit', false).gte('quantity', 6).gte('selling_price', 100).order('name').limit(20)
  const { data: expired } = await db.from('product_batches').select('product_id').eq('shop_id', ALPHA).gt('quantity', 0).lt('expiry_date', new Date().toISOString().slice(0, 10))
  const bad = new Set((expired || []).map(b => b.product_id))
  const usable = cands.filter(p => !bad.has(p.id))
  const P = usable[0], Q = usable[1]
  const PACK = Math.round(Number(P.selling_price) * 2 * 0.95)
  const RIZ = [{ key: 'glass', units: 250, price: 200 }, { key: 'box', units: 700, price: 550 }, { key: 'bucket', units: 8000, price: 6500 }]
  console.log(`Repères : « ${P.name} » (${P.selling_price} F, paquet de 2 à ${PACK} F) ; « ${Q.name} » présenté comme riz en grammes`)

  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  const page = s.page
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []
  await page.route(/\/rest\/v1\/products\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch(); let body = await res.text()
    try {
      const arr = JSON.parse(body)
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p.id === P.id) p.sale_measures = [{ key: 'pack', units: 2, price: PACK }]
          if (p.id === Q.id) { p.unit = 'g'; p.quantity = 37500; p.selling_price = 0.75; p.sale_measures = RIZ; p.price_tiers = null }
        }
        body = JSON.stringify(arr)
      }
    } catch {}
    return route.fulfill({ response: res, body })
  })
  // Lots de Q présentés en grammes (sinon le vendable resterait celui de la vraie fiche)
  await page.route(/\/rest\/v1\/product_batches\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch(); let body = await res.text()
    try { const arr = JSON.parse(body); if (Array.isArray(arr)) { for (const b of arr) if (b.product_id === Q.id) b.quantity = Number(b.quantity) * 1000; body = JSON.stringify(arr) } } catch {}
    return route.fulfill({ response: res, body })
  })
  await page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    const path = new URL(r.url()).pathname
    sent.push({ method: r.method(), path, body })
    if (path === '/api/sales/checkout') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'TEST — vente interceptée' }) })
    const data = path === '/api/products' && r.method() === 'POST' ? { data: { id: '00000000-0000-4000-8000-0000000000aa' } } : { ok: true }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })

  console.log('\n1. Formulaire « Ajouter un produit » en grammes')
  await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  const qrow = norm(await page.locator('tr').filter({ hasText: Q.name.trim() }).first().innerText().catch(() => ''))
  ok(/750 F CFA \/ kg/.test(qrow) && /37,5\s*kg/.test(qrow), 'liste Produits : « 750 F CFA / kg » et « 37,5 kg » (jamais au gramme)', qrow)
  await page.locator('[data-tour="add-product-menu"]:visible').first().click()
  await page.getByRole('menuitem', { name: m.products.add_product ?? 'Ajouter un produit' }).click()
  const form = page.locator('#product-form'); await form.waitFor({ timeout: 15000 }); await wait(700)
  ok(await form.getByTestId('product-measures-block').count() === 1 && !(await form.getByTestId('product-measures-block').isVisible()), 'unité « pièce » : le bloc « Vente à la mesure » est rangé dans « Plus d’options »')
  await form.locator('#product-name').fill('TEST riz mesures')
  await form.locator('[data-tour="product-stock"] button[role="combobox"]').first().click(); await page.getByRole('option', { name: /^g$/ }).click(); await wait(400)
  const prices = norm(await form.locator('[data-tour="product-prices"]').innerText())
  ok(prices.includes(m.measures.price_per_kg) && prices.includes(m.measures.buy_per_kg), `prix au kilo : « ${prices.slice(0, 90)} »`)
  ok(await form.getByTestId('product-qty-coarse').count() === 1 && norm(await form.locator('[data-tour="product-stock"]').innerText()).includes('kg'), 'stock de départ saisi en kg')
  ok(await form.getByTestId('product-measures-block').isVisible(), 'bloc « Vente à la mesure » en tête (produit en grammes)')
  ok(await form.getByTestId('product-wholesale').count() === 0 && await form.getByTestId('product-pack').count() === 0, 'ni paliers de gros ni colis pour un produit en grammes (les mesures les remplacent)')
  await form.getByTestId('product-price-coarse').fill('750')
  await form.getByTestId('product-qty-coarse').fill('37,5')
  const pickKey = async (i, label) => { await form.getByTestId('product-measure-key').nth(i).click(); await page.getByRole('option', { name: label, exact: true }).click(); await wait(250) }
  await pickKey(0, 'Verre')
  await form.getByTestId('product-measure-price').nth(0).fill('200')
  // Contenu oublié : refus avant envoi, message sous le bloc
  await page.locator('button[form="product-form"]').first().click(); await wait(800)
  ok(!sent.some(x => x.path === '/api/products') && norm(await form.innerText()).includes(m.measures.error_incomplete), 'mesure sans contenu : refusée avant envoi, message clair')
  await form.getByTestId('product-measure-units').nth(0).fill('250')
  await form.getByTestId('product-measure-add').click(); await pickKey(1, 'Boîte')
  await form.getByTestId('product-measure-price').nth(1).fill('550'); await form.getByTestId('product-measure-units').nth(1).fill('700')
  await form.getByTestId('product-measure-add').click(); await pickKey(2, 'Seau')
  await form.getByTestId('product-measure-price').nth(2).fill('6500'); await form.getByTestId('product-measure-units').nth(2).fill('8000'); await wait(300)
  const big = norm(await form.getByTestId('product-measure-big').first().innerText().catch(() => ''))
  ok(big === 'environ 8 kg', `contenu du seau : « ${big} »`)
  await form.getByTestId('product-measure-add').click(); await pickKey(3, 'Kilo'); await wait(200)
  ok(norm(await form.getByTestId('product-measure-fixed').first().innerText().catch(() => '')) === '1 kg', 'kilo : contenu fixe « 1 kg »')
  await form.getByTestId('product-measure-price').nth(3).fill('760')
  ok(norm(await form.getByTestId('product-measures-only').innerText().catch(() => '')) === m.measures.only_measures, `explication : « ${m.measures.only_measures} »`)
  await form.getByTestId('product-measures-block').screenshot({ path: OUT + '/measures-form-block.png' }).catch(() => {})
  await page.screenshot({ path: OUT + '/measures-form.png' })
  await page.locator('button[form="product-form"]').first().click(); await wait(2000)
  const post = sent.find(x => x.path === '/api/products' && x.method === 'POST')
  const ms = (post?.body.sale_measures || []).map(x => `${x.key}:${x.units}:${x.price}`).join()
  ok(post && post.body.unit === 'g' && post.body.quantity === 37500 && Math.abs(post.body.selling_price - 0.75) < 1e-9, `envoi en grammes : unité ${post?.body.unit}, ${post?.body.quantity} g, ${post?.body.selling_price} F le gramme`)
  ok(ms === 'glass:250:200,box:700:550,bucket:8000:6500,kg:1000:760', `mesures envoyées : ${ms}`)
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await wait(300) }
  if (await page.getByRole('button', { name: m.dialogs.unsaved_discard }).count()) await page.getByRole('button', { name: m.dialogs.unsaved_discard }).click()

  console.log('\n2. Caisse : produit à la pièce vendu aussi au paquet')
  await page.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  const search = page.getByPlaceholder(/Rechercher un produit/).first()
  const grid = page.locator('[data-tour="pos-grid"]')
  await search.fill(P.name.trim()); await wait(1200)
  ok(norm(await page.getByTestId('card-measures').first().innerText().catch(() => '')) === 'Paquet', 'carte : « Paquet » proposé')
  await grid.locator('[role="button"]').filter({ hasText: P.name.trim() }).first().click(); await wait(800)
  const picker = page.getByTestId('measure-picker')
  ok(await picker.isVisible().catch(() => false), 'fenêtre « Choisir la mesure » ouverte')
  const ptext = norm(await picker.innerText().catch(() => ''))
  ok(ptext.includes(m.measures.pick_unit) && ptext.includes('Paquet') && ptext.includes('2 pièces'), `choix : « ${ptext.slice(0, 160)} »`)
  await page.screenshot({ path: OUT + '/measures-picker-pack.png' })
  await page.getByTestId('measure-pick').first().click(); await wait(600)
  ok(norm(await page.getByTestId('cart-measure').first().innerText().catch(() => '')) === '· Paquet', 'ligne du panier « … · Paquet »')
  const chip = norm(await page.getByTestId('cart-measure-price').first().innerText().catch(() => ''))
  ok(chip === `${PACK.toLocaleString('fr-FR').replace(/ /g, ' ')} F CFA / paquet` || /\/ paquet$/.test(chip), `prix fixe de la mesure : « ${chip} »`)
  await page.getByLabel(m.sales.qty_increase).first().click(); await wait(500)
  ok(norm(await page.getByTestId('cart-measure').first().innerText()) === '· Paquets' && (await page.getByLabel('Paquets', { exact: true }).first().inputValue()) === '2', '« + » : 2 paquets')
  // À l'unité en plus : seconde ligne distincte
  await search.fill(P.name.trim()); await wait(800)
  await grid.locator('[role="button"]').filter({ hasText: P.name.trim() }).first().click(); await wait(600)
  await page.getByTestId('measure-pick-unit').click(); await wait(600)
  ok(await page.getByTestId('cart-measure').count() === 1 && await page.locator('input[type="number"]').count() >= 2, 'à l’unité en plus : deux lignes (paquets, pièce)')
  await page.screenshot({ path: OUT + '/measures-cart-pack.png' })
  await page.getByRole('button', { name: m.sales.clear_cart }).first().click().catch(() => {}); await wait(500)
  await page.getByRole('dialog').getByRole('button', { name: m.sales.clear_cart }).last().click().catch(() => {}); await wait(600)
  ok(await page.getByTestId('cart-measure').count() === 0, 'panier vidé')

  console.log('\n3. Caisse : riz en grammes vendu uniquement par mesures')
  await search.fill(Q.name.trim()); await wait(1200)
  const qcard = grid.locator('[role="button"]').filter({ hasText: Q.name.trim() }).first()
  const ctext = norm(await qcard.innerText().catch(() => ''))
  ok(ctext.includes('Verre · Boîte · Seau'), `carte : mesures « Verre · Boîte · Seau »`, ctext)
  ok(/200 F CFA \/ verre/.test(ctext), 'carte : prix de la plus petite mesure « 200 F CFA / verre »', ctext)
  ok(/kg/.test(ctext) && !/37500/.test(ctext.replace(/\s/g, '')), 'carte : stock en kg, jamais en grammes', ctext)
  await qcard.click(); await wait(800)
  const qtext = norm(await picker.innerText().catch(() => ''))
  ok(await page.getByTestId('measure-pick-unit').count() === 0 && qtext.includes('environ 700 g') && qtext.includes('environ 8 kg'), `pas d’« À l’unité », contenus affichés : « ${qtext.slice(0, 200)} »`)
  await page.screenshot({ path: OUT + '/measures-picker-riz.png' })
  await page.getByTestId('measure-pick').nth(1).click(); await wait(500)
  await page.getByLabel(m.sales.qty_increase).first().click(); await wait(300)
  await page.getByLabel(m.sales.qty_increase).first().click(); await wait(500)
  ok(norm(await page.getByTestId('cart-measure').first().innerText()) === '· Boîtes', 'ligne « Riz · Boîtes »')
  const mainText = norm(await page.locator('main').innerText())
  ok(mainText.includes('1 650'), '3 boîtes : 1 650 F CFA', mainText.slice(0, 300))
  await page.screenshot({ path: OUT + '/measures-cart-riz.png' })
  await page.getByRole('button', { name: 'Montant exact' }).first().click().catch(() => {}); await wait(400)
  await page.locator('[data-tour="pos-checkout"]:visible').first().click().catch(() => {}); await wait(2500)
  const sale = sent.find(x => x.path === '/api/sales/checkout')
  const it = sale?.body.items?.[0] || {}
  ok(sale && it.measure_key === 'box' && it.measure_qty === 3 && it.measure_units === 700 && it.quantity === 2100 && Math.round(it.quantity * it.unit_price) === 1650 && sale.body.total === 1650,
    `encaissement envoyé : ${it.measure_qty} × ${it.measure_key} (${it.quantity} g), total ${sale?.body.total} (intercepté, refus simulé)`, it)
  const pending = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('stockshop-offline'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('pending_sales')) return res(0); const q = d.transaction('pending_sales').objectStore('pending_sales').count(); q.onsuccess = () => res(q.result); q.onerror = () => res(-1) }; r.onerror = () => res(-1) }))
  ok(pending === 0, `aucune vente mise en file hors connexion (${pending})`)
  ok(!errors.length, 'aucune erreur JavaScript', errors)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
