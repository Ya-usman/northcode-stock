// Étape 10 du Stock (1er nov. 2026) : emplacement d'un produit à l'écran. LECTURE SEULE, serveur local, Boutique Alpha,
// compte propriétaire. Repose sur « Rayon 2, étagère A » gardé en exemple sur « Aspirateur Roweta » par rt-196.
//  - Produits : la recherche « étagère A » trouve le produit ;
//  - fiche produit : emplacement sous le nom ;
//  - formulaire de modification : champ « Emplacement » prérempli (refermé sans enregistrer) ;
//  - haoussa : libellé « Wuri ».
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/location-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const PRODUCT = 'Aspirateur Roweta', LOC = 'Rayon 2, étagère A'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  for (const [locale, width, height] of [['fr', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/(products|stock)/.test(r.url())) writes.push(r.url()) })
    const drawer = page.locator('[data-testid="product-detail"]')

    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    await page.getByLabel(m.products.search_placeholder).first().fill('étagère A'); await wait(1500)
    const shown = await page.locator('[data-product-name]').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()))
    ok(shown.length > 0 && shown.every(x => x.includes('Aspirateur Roweta')), `recherche « étagère A » : ${shown.length} élément(s), tous « ${PRODUCT} »`, shown.slice(0, 3))
    await page.locator('[data-product-name]', { hasText: PRODUCT }).first().click()
    await drawer.waitFor({ timeout: 15000 })
    const loc = drawer.getByTestId('product-detail-location')
    await loc.waitFor({ timeout: 15000 }).catch(() => {})
    ok((await loc.count()) === 1 && (await loc.innerText()).includes(LOC), `fiche : emplacement « ${(await loc.innerText().catch(() => '')).trim()} »`)
    await drawer.screenshot({ path: `${OUT}/location-${locale}-${width}-fiche.png`, clip: undefined }).catch(() => {})

    // Formulaire de modification : champ prérempli (refermé sans enregistrer)
    await drawer.locator('[data-testid="product-detail-actions"]').getByText(m.products.edit_product ?? 'Modifier', { exact: false }).first().click().catch(async () => {
      await drawer.locator('[data-testid="product-detail-actions"] button').filter({ hasText: /Modifier|Gyara|Edit/ }).first().click()
    })
    const field = page.getByTestId('product-location')
    await field.waitFor({ timeout: 15000 }).catch(() => {})
    ok((await field.count()) === 1 && (await field.inputValue()) === LOC, `formulaire : champ prérempli « ${await field.inputValue().catch(() => '')} »`)
    const label = (await page.locator('label[for="product-location"]').innerText().catch(() => '')).trim()
    ok(label.startsWith(m.product_form.location_label), `libellé « ${label} »`)
    await field.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/location-${locale}-${width}-form.png` })
    await page.keyboard.press('Escape'); await wait(600)
    ok(!writes.length, `aucune écriture envoyée (${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
