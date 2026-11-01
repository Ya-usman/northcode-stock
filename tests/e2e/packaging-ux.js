// Étape 9 du Stock (1er nov. 2026) : conditionnements d'achat à l'écran. LECTURE SEULE, serveur local, Boutique Alpha,
// compte propriétaire. Repose sur le « carton de 24 » gardé en exemple sur « Aspirateur Roweta » par rt-195.
//  - fiche produit : section « Conditionnements d'achat », carton de 24 par défaut, formulaire d'ajout avec aperçu
//    (refermé sans enregistrer) ;
//  - réapprovisionnement simple : saisie « en cartons », équivalent « Soit 48 pièces » (refermé sans valider) ;
//  - haoussa : section et colis traduits, aucun texte français.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/packaging-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const PRODUCT = 'Aspirateur Roweta'
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
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/(products|purchase-orders|stock)/.test(r.url())) writes.push(r.url()) })
    const drawer = page.locator('[data-testid="product-detail"]')

    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    await page.getByLabel(m.products.search_placeholder).first().fill(PRODUCT); await wait(1500)
    await page.locator('[data-product-name]', { hasText: PRODUCT }).first().click()
    await drawer.waitFor({ timeout: 15000 })
    const sec = drawer.locator('[data-testid="product-packagings"]')
    await sec.locator('[data-testid="packaging-row"]').first().waitFor({ timeout: 20000 }).catch(() => {})
    const rows = await sec.locator('[data-testid="packaging-row"]').allInnerTexts()
    const carton = locale === 'ha' ? /kwali na guda 24/i : /carton de 24 pièces/i
    ok(rows.length === 1 && carton.test(rows[0]) && rows[0].includes(m.packaging.default), `section : 1 conditionnement « ${rows[0]?.replace(/\s+/g, ' ')} », par défaut`, rows)
    const drawerText = await drawer.innerText()
    ok(drawerText.includes(m.packaging.title), `titre de section « ${m.packaging.title} »`)

    await sec.locator('[data-testid="packaging-add"]').scrollIntoViewIfNeeded()
    await sec.locator('[data-testid="packaging-add"]').click(); await wait(400)
    await sec.locator('[data-testid="packaging-units"]').fill('12'); await wait(300)
    const form = await sec.locator('[data-testid="packaging-form"]').innerText()
    const preview = locale === 'ha' ? /kwali na guda 12/i : /carton de 12 pièces/i
    ok(preview.test(form), `aperçu du formulaire : « ${form.split('\n').find(x => preview.test(x)) || form.replace(/\s+/g, ' ').slice(0, 80)} »`)
    await sec.screenshot({ path: `${OUT}/packaging-${locale}-${width}-fiche.png` })
    await sec.getByRole('button', { name: m.packaging.cancel }).click(); await wait(300)
    ok(await sec.locator('[data-testid="packaging-form"]').count() === 0, 'formulaire refermé sans enregistrer')

    if (locale === 'ha') {
      ok(!/Conditionnement|Par défaut|carton de|pièces|Aperçu/.test(drawerText + form), 'haoussa : aucun texte français dans la section')
    } else {
      // Réapprovisionnement depuis la fiche, saisi en cartons
      await drawer.locator('[data-testid="product-detail-actions"]').getByRole('button', { name: m.products.restock_button ?? 'Réapprovisionner' }).first().click().catch(async () => {
        await drawer.locator('[data-testid="product-detail-actions"]').getByText('Réapprovisionner').first().click()
      })
      await page.locator('[data-testid="restock-pack-select"]').waitFor({ timeout: 15000 })
      const priceInput = page.locator('input[name="buying_price"]')
      ok(/carton de 24/i.test(await page.locator('[data-testid="restock-pack-select"]').innerText()), 'réassort : le colis par défaut est choisi à l’ouverture')
      await page.locator('[data-testid="restock-pack-select"]').click(); await wait(300)
      await page.getByRole('option', { name: 'pièces', exact: true }).click(); await wait(300)
      const unitPh = Number(await priceInput.getAttribute('placeholder'))
      await page.locator('[data-testid="restock-pack-select"]').click(); await wait(300)
      await page.getByRole('option', { name: /carton de 24/i }).click(); await wait(300)
      const packPh = Number(await priceInput.getAttribute('placeholder'))
      ok(unitPh > 0 && Math.abs(packPh - unitPh * 24) < 0.01, `exemple de prix : ${unitPh} la pièce → ${packPh} le carton (× 24)`)
      await page.locator('[data-testid="restock-quantity"]').fill('2'); await wait(300)
      const eq = (await page.locator('[data-testid="restock-equivalent"]').innerText().catch(() => '')).trim()
      ok(eq === 'Soit 48 pièces', `réassort en cartons : 2 cartons → « ${eq} »`)
      const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('[data-testid="restock-quantity"]') })
      const dlgText = await dlg.innerText()
      ok(/Nombre de cartons/.test(dlgText) && /Prix d’achat par carton/.test(dlgText), 'libellés « Nombre de cartons » et « Prix d’achat par carton »')
      await dlg.screenshot({ path: `${OUT}/packaging-${locale}-${width}-reassort.png` })
      await page.keyboard.press('Escape'); await wait(600)
    }
    ok(!writes.length, `aucune écriture envoyée (${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
