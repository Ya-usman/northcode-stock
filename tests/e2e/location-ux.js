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
// Fermeture du navigateur après un téléchargement : rejet « has been closed » sans conséquence
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

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

    if (width > 1000) {
      // Tableau : colonne facultative « Emplacement » (bouton « Colonnes »), valeur du produit
      for (let i = 0; i < 4 && (await drawer.count()); i++) { await page.keyboard.press('Escape'); await wait(500) }
      await page.getByRole('button', { name: /^Colonnes/ }).click()
      const pop = page.locator('[data-radix-popper-content-wrapper]').first(); await pop.waitFor({ timeout: 5000 })
      const labels = (await pop.locator('label').allInnerTexts()).map(x => x.trim())
      ok(labels.includes('Emplacement'), `« Colonnes » propose « Emplacement » (${labels.join(' / ')})`)
      await pop.getByLabel('Emplacement', { exact: true }).check(); await page.keyboard.press('Escape'); await wait(500)
      const cell = page.locator('tr', { hasText: PRODUCT }).locator('[data-testid="product-row-location"]').first()
      ok((await cell.count()) === 1 && (await cell.innerText()).trim() === LOC, `tableau : colonne Emplacement « ${(await cell.innerText().catch(() => '')).trim()} »`)
      await page.screenshot({ path: `${OUT}/location-fr-1366-table.png` })
      // Export Excel : colonne « Emplacement » avec la valeur du produit
      await page.getByLabel(m.products.search_placeholder).first().fill(''); await wait(800)
      await page.locator('[data-testid="products-more-actions"]').first().click(); await wait(500)
      const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
      await page.locator('[data-testid="export-xlsx"]').first().click().catch(() => {})
      const d = await dl
      if (!d) ok(false, 'export Excel : aucun téléchargement')
      else {
        const file = `${OUT}/location-export.xlsx`; await d.saveAs(file)
        const ExcelJS = require(require('path').resolve(__dirname, '../..') + '/node_modules/exceljs')
        const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file)
        const rows = []; wb.worksheets[0].eachRow(r => rows.push(r.values.slice(1).map(v => (v && typeof v === 'object' && 'result' in v ? v.result : v))))
        const head = rows.find(r => r.some(c => String(c) === 'Emplacement')) || []
        const col = head.indexOf('Emplacement')
        const row = rows.find(r => r[0] === PRODUCT)
        ok(col >= 0 && row && row[col] === LOC, `export Excel : colonne « Emplacement », « ${row ? row[col] : '?'} » pour ${PRODUCT}`)
      }
    }
    ok(!writes.length, `aucune écriture envoyée (${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
