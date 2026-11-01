// Étape 14 du Stock (1er nov. 2026) : inventaire tournant à l'écran. LECTURE SEULE (rien n'est démarré), serveur local,
// Boutique Alpha, compte propriétaire. Repose sur INV-2026-0007 (tournant, abandonné) laissé par rt-194.
//  - bouton « Inventaire tournant » → panneau, aperçu de 20 produits (taille par défaut), passage à 10 ;
//  - bouton « Compter ces 20 produits » (pluriel ICU) ; produits « jamais compté » ou « compté le … » ;
//  - historique : étiquette « Tournant » sur l'inventaire tournant ;
//  - haoussa : textes traduits, aucun texte français.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/inventory-cycle-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const listCount = page => page.locator('[data-testid="inventory-cycle-list"] li').count()

;(async () => {
  for (const [locale, width, height] of [['fr', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`).inventoryCount
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    // Écritures Stock seulement (le cookie de rôle /api/auth/set-role est le fonctionnement normal de la session)
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && r.url().includes('/api/stock/')) writes.push(r.url()) })

    await page.goto(`${BASE}/${locale}/stock/inventory-count`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByTestId('inventory-cycle-open').waitFor({ timeout: 60000 })
    ok((await page.getByTestId('inventory-cycle-open').innerText()).trim() === m.cycle_open, `bouton « ${m.cycle_open} »`)
    await page.getByTestId('inventory-cycle-open').click()
    await page.getByTestId('inventory-cycle-list').waitFor({ timeout: 30000 })
    const items = await page.locator('[data-testid="inventory-cycle-list"] li').allInnerTexts()
    const panel = await page.getByTestId('inventory-cycle').innerText()
    ok(items.length === 20, `aperçu par défaut : ${items.length} produits`)
    const never = m.cycle_never, last = m.cycle_last.split('{date}')[0].trim()
    ok(items.every(x => x.includes(never) || x.includes(last)), `chaque produit : « ${never} » ou « ${last} … »`, items.slice(0, 3))
    const startLabel = (await page.getByTestId('inventory-cycle-start').innerText()).trim()
    ok(/20/.test(startLabel) && !/\(s\)|#/.test(startLabel), `bouton « ${startLabel} »`)
    await page.screenshot({ path: `${OUT}/cycle-${locale}-${width}.png` })
    await page.getByTestId('inventory-cycle-size-10').click()
    for (let i = 0; i < 30 && (await listCount(page)) !== 10; i++) await wait(500)
    const n10 = await listCount(page)
    ok(n10 === 10 && /10/.test(await page.getByTestId('inventory-cycle-start').innerText()), `taille 10 : ${n10} produits, bouton mis à jour`)
    if (locale === 'ha') ok(!/Inventaire|jamais compté|compté le|produits|Compter/.test(panel), 'haoussa : aucun texte français dans le panneau', panel.slice(0, 200))

    await page.getByTestId('inventory-history').click()
    await page.getByText('INV-2026-0007').first().waitFor({ timeout: 20000 }).catch(() => {})
    const row = page.locator('p', { hasText: 'INV-2026-0007' }).first()
    ok((await row.count()) === 1 && (await row.innerText()).includes(m.cycle_badge), `historique : INV-2026-0007 marqué « ${m.cycle_badge} »`)
    ok(!writes.length, `aucune écriture Stock envoyée (${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
