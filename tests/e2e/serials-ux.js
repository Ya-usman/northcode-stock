// Étape 11 du Stock (1er nov. 2026) : numéros de série à l'écran. LECTURE SEULE (aucun encaissement : écritures
// interceptées), serveur local, Boutique Alpha, compte propriétaire. Repose sur le produit TEST de rt-197-198
// (3 numéros en stock) :
//  - caisse : le produit suivi ouvre la fenêtre des numéros (liste en stock), choix d'un numéro → ligne du panier avec
//    son numéro et le bouton « 1 numéro » (pas de − / +) ;
//  - fiche produit : interrupteur actif, « 3 numéros en stock pour 3 unités », onglets En stock / Vendus ;
//  - Produits : la recherche d'un numéro affiche « Numéros de série trouvés ».
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/serials-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const NAME = 'TEST Téléphone numéroté (rt-197)'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  const { data: P } = await db.from('products').select('id, quantity, track_serials').eq('shop_id', 'a0000000-0000-0000-0000-000000000001').eq('name', NAME).maybeSingle()
  if (!P) { console.log(`Arrêt : « ${NAME} » absent (lancer rt-197-198-serials d’abord).`); process.exit(1) }
  const { data: serials } = await db.from('product_serials').select('serial').eq('product_id', P.id).eq('status', 'in_stock').order('serial')
  console.log(`Produit TEST : ${P.quantity} en stock, ${serials.length} numéros en stock`)

  for (const [locale, width, height] of [['fr', 390, 844], ['fr', 1366, 900]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const checkouts = []; page.on('request', r => { if (r.method() === 'POST' && /\/api\/sales\/(checkout|sync)/.test(r.url())) checkouts.push(r.url()) })

    // Caisse
    await page.goto(`${BASE}/${locale}/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
    await page.getByPlaceholder(m.sales.search_or_scan).first().fill('numéroté'); await wait(1200)
    await page.locator('[role="button"]', { hasText: NAME }).first().click()
    const picker = page.getByTestId('serial-picker')
    await picker.waitFor({ timeout: 15000 }).catch(() => {})
    await page.getByTestId('serial-list').waitFor({ timeout: 20000 }).catch(() => {})
    const shown = await page.locator('[data-testid="serial-list"] li').allInnerTexts()
    ok(shown.length === serials.length && serials.every(x => shown.some(y => y.includes(x.serial))), `caisse : fenêtre des numéros, ${shown.length} en stock`, shown)
    await page.locator('[data-testid="serial-list"] li button').first().click(); await wait(300)
    const confirmBtn = picker.getByRole('button', { name: /Valider 1 numéro/ })
    ok(await confirmBtn.count() === 1, 'bouton « Valider 1 numéro »')
    await page.screenshot({ path: `${OUT}/serials-${width}-picker.png` })
    await confirmBtn.click(); await wait(800)
    const cartSerial = (await page.getByTestId('cart-serials-list').first().innerText().catch(() => '')).trim()
    ok(serials.some(x => x.serial === cartSerial), `panier : numéro « ${cartSerial} » sur la ligne`)
    ok((await page.getByTestId('cart-serials').first().innerText().catch(() => '')).includes('1 numéro'), 'panier : bouton « 1 numéro » à la place de − / +')
    await page.screenshot({ path: `${OUT}/serials-${width}-cart.png` })

    // Fiche produit
    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
    await page.getByLabel(m.products.search_placeholder).first().fill('numéroté'); await wait(1500)
    await page.locator('[data-product-name]', { hasText: NAME }).first().click()
    const sec = page.locator('[data-testid="product-detail"] [data-testid="product-serials"]')
    await sec.getByTestId('serials-count').waitFor({ timeout: 20000 }).catch(() => {})
    const count = (await sec.getByTestId('serials-count').innerText().catch(() => '')).trim()
    ok(/^3 numéros en stock pour 3 unités$/.test(count), `fiche : « ${count} »`)
    ok(await sec.getByTestId('serials-toggle').getAttribute('aria-checked') === 'true', 'fiche : suivi activé')
    await sec.screenshot({ path: `${OUT}/serials-${width}-fiche.png` })
    for (let i = 0; i < 3 && (await page.locator('[data-testid="product-detail"]').count()); i++) { await page.keyboard.press('Escape'); await wait(500) }

    // Recherche d'un numéro
    await page.getByLabel(m.products.search_placeholder).first().fill(serials[0].serial); await wait(2500)
    const hits = page.getByTestId('serial-hits')
    await hits.waitFor({ timeout: 15000 }).catch(() => {})
    const hitText = (await hits.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(hitText.includes(serials[0].serial) && hitText.includes(NAME) && /En stock/.test(hitText), `recherche « ${serials[0].serial} » : ${hitText.slice(0, 120)}`)
    ok(!checkouts.length, `aucune vente envoyée (${checkouts.length})`, checkouts)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
