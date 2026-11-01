// Lot « simplicité » n° 1 : Caisse (1er nov. 2026). LECTURE SEULE : serveur local (ou production avec
// CAPTURE_PROD_READONLY=1), Boutique Alpha, propriétaire ; toute écriture est bloquée, rien n'est vendu ni supprimé.
//  - « Scanner » traduit (avant : « Scan » en dur) ; aide du lecteur vouvoyée, sans « SKU » ;
//  - aucune liste de produits (simulée vide) : « Aucun produit à vendre » + « Ajouter un produit » (lien) ;
//  - anciennes factures en attente (simulées sur l'appareil, 8 jours) : la suppression groupée DEMANDE confirmation ;
//    « Annuler » garde tout ;
//  - haoussa : aucun des anciens textes français en dur.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/pos-simple-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
// Anciens textes en dur : « Scan » seul (pas « Scanner »), « SKU »
const OLD = /(^|\s)Scan(\s|$)|SKU/

;(async () => {
  for (const [locale, width, height] of [['fr', 1366, 900], ['fr', 390, 844], ['ha', 1366, 900]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const writes = []
    await page.route(/\/(api|rest\/v1)\//, r => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method())
      ? r.fallback() : (writes.push(r.request().method() + ' ' + new URL(r.request().url()).pathname), r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))))

    // 1. Écran normal : bouton « Scanner », aide du lecteur
    await page.goto(`${BASE}/${locale}/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    const scanBtn = page.getByRole('button', { name: m.sales.scan_button, exact: true })
    ok(await scanBtn.count() >= 1, `bouton « ${m.sales.scan_button} »`)
    if (width > 1000) ok((await page.locator('main').innerText()).includes(m.sales.scan_hint), `aide : « ${m.sales.scan_hint} »`)
    ok(!OLD.test((await page.locator('main').innerText()).replace(/\s+/g, ' ')), 'aucun ancien texte en dur (« Scan », « SKU »)')

    // 2. Factures en attente anciennes (simulées sur l'appareil) : suppression groupée confirmée
    const old = new Date(Date.now() - 8 * 86400000).toISOString()
    await page.evaluate(([shopId, created]) => {
      const draft = (id, label) => ({ id, label, createdAt: created, shopId, cart: [], customerName: '', customerPhone: '', discount: 0, notes: '', paymentMethod: 'cash' })
      localStorage.setItem('nc_sale_drafts', JSON.stringify([draft('test-pos-ux-1', 'TEST ancienne 1'), draft('test-pos-ux-2', 'TEST ancienne 2')]))
    }, [ALPHA, old])
    await page.reload({ waitUntil: 'domcontentloaded' }); await wait(7000)
    // Accès à la liste : bandeau (ordinateur) ou barre du bas (téléphone)
    const heldEntry = page.locator('button:visible', { hasText: /en attente|jira/i }).first()
    await heldEntry.click().catch(() => {}); await wait(1200)
    const staleBtn = page.getByTestId('held-stale-delete')
    ok(await staleBtn.count() === 1, 'liste des factures en attente : bouton de suppression des anciennes')
    await staleBtn.click(); await wait(600)
    const dialog = page.getByRole('dialog').last()
    const dtext = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/2/.test(dtext) && (locale !== 'fr' || /anciennes factures en attente/.test(dtext) && /redeviennent disponibles/.test(dtext)), `confirmation demandée : « ${dtext.slice(0, 160)} »`)
    await page.screenshot({ path: `${OUT}/pos-simple-${locale}-${width}-confirm.png` })
    await dialog.getByRole('button', { name: m.actions?.cancel ?? 'Annuler' }).first().click().catch(async () => { await page.keyboard.press('Escape') }); await wait(600)
    ok(await page.getByTestId('held-card').count() === 2, '« Annuler » : les 2 factures restent')
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('nc_sale_drafts') || '[]').length)
    ok(kept === 2, `sur l’appareil : ${kept} factures gardées`)
    await page.evaluate(() => localStorage.removeItem('nc_sale_drafts'))
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await wait(300) }

    // 3. Aucun produit à vendre (liste simulée vide, cache de l'appareil compris)
    await page.route(/\/rest\/v1\/products\?/, r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
    await page.evaluate(() => new Promise(res => { try { const q = indexedDB.deleteDatabase('stockshop-offline'); q.onsuccess = q.onerror = q.onblocked = () => res(null) } catch { res(null) } }))
    await page.reload({ waitUntil: 'domcontentloaded' }); await wait(7000)
    const guide = page.getByTestId('pos-no-products')
    await guide.waitFor({ timeout: 20000 }).catch(() => {})
    ok(await guide.isVisible().catch(() => false) && (await guide.innerText()).includes(m.sales.no_products_title), `« ${m.sales.no_products_title} » affiché`)
    const action = guide.getByTestId('empty-guide-action')
    ok(await action.count() === 1 && (await action.getAttribute('href')) === `/${locale}/stock/products` && (await action.innerText()).trim() === m.sales.no_products_action, `bouton « ${m.sales.no_products_action} » vers Produits`)
    await page.screenshot({ path: `${OUT}/pos-simple-${locale}-${width}-vide.png` })
    const stockWrites = writes.filter(w => /sale|product|reserv|stock|payment/.test(w))
    ok(!stockWrites.length, `aucune écriture de vente ou de stock (${stockWrites.length} ; autres bloquées : ${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
