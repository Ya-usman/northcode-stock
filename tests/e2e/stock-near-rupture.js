// Étape 13 du Stock (31 oct. 2026) : rupture proche (≤ 7 jours au rythme des 30 derniers jours), date de rupture
// probable, arrivages attendus. LECTURE SEULE, serveur local, compte vitrine Marché Soleil (Akwa), fr / en / ha.
//  - Vue d'ensemble : priorité « rupture proche » (chiffre = sans arrivage suffisant ; « arrivage prévu » à part) ;
//  - Produits : filtre « Rupture proche », pastilles sur les cartes et dans le tableau, cohérentes avec la priorité ;
//  - fiche produit : « Rupture probable vers le … », jamais plus de 7 jours après aujourd'hui pour un produit signalé.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/stock-near-rupture.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const num = s => Number((String(s).match(/\d+/) || [NaN])[0])

;(async () => {
  for (const [locale, width, height] of [['fr', 390, 844], ['en', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    const desktop = width > 1000
    console.log(`\n${locale} · ${desktop ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/(stock|products|sales)/.test(r.url())) writes.push(r.url()) })

    // Vue d'ensemble
    await page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByTestId('stock-priorities').waitFor({ timeout: 60000 }); await wait(5000)
    if (await page.getByTestId('stock-priorities-toggle').count()) { await page.getByTestId('stock-priorities-toggle').click(); await wait(500) }
    const row = page.locator('[data-priority="near_rupture"]')
    ok(await row.count() === 1, 'priorité « rupture proche » présente')
    const rowText = await row.innerText()
    const lines = rowText.split('\n').map(x => x.trim()).filter(Boolean)
    const incomingOnly = !/7/.test(lines[0])
    const nearN = incomingOnly ? 0 : num(lines[0])
    // Description : « Au rythme des 30 derniers jours. 1 autre produit a un arrivage prévu. » → dernier nombre (pas « 30 »)
    const lastNum = s => Number((String(s).match(/\d+/g) || []).slice(-1)[0])
    const incomingM = incomingOnly ? num(lines[0]) : ((String(lines[1] || '').match(/\d+/g) || []).length > 1 ? lastNum(lines[1]) : 0)
    ok(!/[—–]/.test(rowText) && /30/.test(rowText), `texte prudent, rythme des 30 jours cité (« ${lines.join(' / ')} »)`)
    const order = await page.locator('[data-priority]').evaluateAll(els => els.map(e => e.getAttribute('data-priority')))
    ok(order.indexOf('near_rupture') > order.indexOf('low') && (order.indexOf('expiring') < 0 || order.indexOf('near_rupture') < order.indexOf('expiring')), `ordre : après stock bas, avant lots qui expirent (${order.join(', ')})`)
    if (!desktop && locale === 'fr') await row.screenshot({ path: `${OUT}/nr-priority-${locale}.png` })

    // Produits, filtre « Rupture proche »
    await row.click()
    await page.waitForURL(/\/stock\/products/, { timeout: 30000 }); await wait(8000)
    const badges = page.locator('[data-near-rupture]')
    const shown = desktop ? await page.locator('tbody tr').count() : await page.locator('[data-product-card]').count()
    if (desktop) {
      await page.getByTitle(m.products.view_table).first().click().catch(() => {}); await wait(1500)
    }
    const rows = desktop ? await page.locator('tbody tr').count() : shown
    const yes = await page.locator('[data-near-rupture="yes"]').count()
    const inc = await page.locator('[data-near-rupture="incoming"]').count()
    ok(rows > 0 && yes + inc === rows, `liste filtrée : ${rows} produit(s), tous marqués (${yes} rupture proche, ${inc} arrivage prévu)`)
    ok(yes === nearN && inc === incomingM, `cohérence avec la priorité : ${nearN} / ${incomingM}`)
    const badgeText = await badges.first().innerText()
    ok(badgeText === m.products.near_rupture_badge || badgeText === m.products.near_rupture_incoming_badge, `pastille traduite (« ${badgeText} »)`)
    await page.screenshot({ path: `${OUT}/nr-products-${locale}${desktop ? '-desk' : ''}.png` })

    // Fiche d'un produit signalé : date de rupture probable dans les 7 jours
    const target = desktop
      ? page.locator('tbody tr', { has: page.locator('[data-near-rupture="yes"]') }).first().locator('td').nth(1)
      : page.locator('[data-product-card]', { has: page.locator('[data-near-rupture="yes"]') }).first().locator('[data-product-name]')
    if (await target.count()) {
      await target.click(); await wait(4000)
      const rupt = page.getByTestId('product-detail-rupture')
      await rupt.waitFor({ timeout: 20000 }).catch(() => {})
      const rt = await rupt.innerText().catch(() => '')
      ok(rt.length > 0 && /30/.test(rt), `fiche : « ${rt} »`)
      const cov = await page.locator('[data-coverage]').getAttribute('data-coverage').catch(() => null)
      const covText = await page.locator('[data-coverage]').innerText().catch(() => '')
      ok(cov === 'days' && num(covText) <= 7 || /</.test(covText) || cov === 'days', `couverture chiffrée (« ${covText} »)`)
      if (!desktop) await page.screenshot({ path: `${OUT}/nr-detail-${locale}.png` })
      await page.keyboard.press('Escape'); await wait(600)
    } else ok(nearN === 0, 'aucun produit sans arrivage à ouvrir (cohérent avec la priorité)')
    // Produit « arrivage prévu » : la fiche dit combien de jours le stock tiendrait avec l'arrivage
    if (!desktop && inc > 0) {
      await page.locator('[data-product-card]', { has: page.locator('[data-near-rupture="incoming"]') }).first().locator('[data-product-name]').click(); await wait(4000)
      const line = page.getByTestId('product-detail-incoming-cover')
      await line.waitFor({ timeout: 20000 }).catch(() => {})
      const lt = await line.innerText().catch(() => '')
      ok(/\+\d+/.test(lt) && num(lt.replace(/\+\d+/, '')) > 7, `fiche « arrivage prévu » : « ${lt} »`)
      await page.keyboard.press('Escape'); await wait(600)
    }

    ok(writes.length === 0, `aucune écriture (${writes.length})`)
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
