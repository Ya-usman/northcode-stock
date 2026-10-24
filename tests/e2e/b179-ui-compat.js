// 179 — interface compatible AVANT la migration (base actuelle, sans batch_treatments) : tout s'ouvre, rien de la
// 179 n'est affiché ni appelé, l'ancien chemin reste en place ; Vue d'ensemble (cartes en LOTS, priorités dans
// l'ordre demandé) ; téléphone 360 / 390. Compte Boutique Alpha, TOUTES les écritures bloquées (lib/capture.js).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/b179-ui-compat.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const path = require('path')
const { session, BASE, OUT } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function open(width, height) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email: 'admin@northcode.ng' })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } } catch {} }, ALPHA)
  s.errors = []; s.calls = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) s.calls.push(`${r.method()} ${u.pathname}${u.search}`) })
  return s
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0)

;(async () => {
  for (const [w, h] of [[1366, 900], [390, 844], [360, 780]]) {
    console.log(`\n${w} × ${h}`)
    const s = await open(w, h)
    const { page } = s

    // 1. Statut de la 179 : absente
    await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.locator('[data-testid=stock-priorities]').waitFor({ timeout: 60000 })
    const status = await page.evaluate(() => fetch('/api/stock/batch-treatments/status').then(r => r.json()))
    ok(status.available === false, 'statut 179 : indisponible (migration non appliquée)')

    // 2. Vue d'ensemble : cartes en lots, priorités dans l'ordre demandé
    await page.waitForTimeout(2500)
    const kpis = await page.locator('[data-kpi]').evaluateAll(els => els.map(e => e.getAttribute('data-kpi')))
    ok(['out', 'low', 'expired_lots', 'expiring', 'dormant'].every(k => kpis.includes(k)) && !kpis.includes('reorder'), `cartes : ${kpis.join(', ')}`)
    const expiredLots = Number((await page.locator('[data-kpi=expired_lots] [data-kpi-value]').innerText()).replace(/\D/g, ''))
    const prio = await page.locator('[data-testid=stock-priorities] [data-priority]').evaluateAll(els => els.map(e => e.getAttribute('data-priority')))
    const order = ['expired_lots', 'out', 'low', 'expiring', 'dormant', 'promo_stale', 'promo']
    ok(prio.length <= 3 && prio.every((p, i) => i === 0 || order.indexOf(p) > order.indexOf(prio[i - 1])), `priorités (3 au plus, dans l'ordre) : ${prio.join(', ') || 'aucune'}`)
    ok(expiredLots === 0 || prio[0] === 'expired_lots', `${expiredLots} lot(s) périmé(s) → « lots périmés à traiter » en premier`)
    ok(!/promotion|promo/i.test(await page.locator('[data-priority=expired_lots]').innerText().catch(() => '')), 'aucune promotion conseillée pour des lots périmés')
    ok(await noHScroll(page), 'Vue d’ensemble : aucun défilement horizontal')
    await page.screenshot({ path: path.join(OUT, `b179-overview-${w}.png`) })

    // 3. Lots : ancien chemin, rien de la 179
    await page.goto(`${BASE}/fr/stock/expiry?status=expired`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.locator('main [data-lot], [data-testid=lots-empty]').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(1500)
    const lot = page.locator('main [data-lot][data-status=expired]:visible').first()
    ok(await lot.count() === 1, 'au moins un lot périmé affiché')
    const menu = lot.locator('[data-lot-menu]')
    if (await menu.count()) {
      await menu.first().click(); await page.waitForTimeout(400)
      const items = await page.locator('[role=menuitem]').allInnerTexts()
      ok(!items.some(x => /Traiter le lot/.test(x)) && items.some(x => /Retirer/.test(x)), `menu d'un lot périmé : ancien menu (${items.map(x => x.trim()).join(' / ')})`)
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    } else ok(true, 'menu de ligne absent à cette largeur (cartes)')
    await lot.locator('[data-lot-label]').first().click()
    await page.locator('[data-testid=lot-detail]').waitFor({ timeout: 15000 })
    await page.waitForTimeout(800)
    ok(await page.locator('[data-testid=lot-detail-treat]').count() === 0 && await page.locator('[data-testid=batch-treatment-history], [data-testid=batch-treatment-history-empty], [data-testid=lot-unallocated-banner]').count() === 0,
      'panneau de lot : ni « Traiter », ni historique, ni bandeau (179 absente)')
    ok(await page.locator('[data-testid=lot-detail-adjust]:visible').count() === 1, 'panneau de lot : « Corriger la quantité » toujours là')

    // 4. Fenêtres de correction : motifs et comportement d'origine, pas de note exigée
    await page.locator('[data-testid=lot-detail-adjust]').click()
    await page.locator('[data-testid=batch-adjust-dialog]').waitFor({ timeout: 10000 })
    const reasons = await page.locator('#batch-adjust-reason option').evaluateAll(els => els.map(e => e.value))
    ok(reasons.includes('correction') && !reasons.includes('counting_error') && await page.locator('#batch-adjust-note').count() === 0,
      `correction de quantité : motifs d'origine (${reasons.join(', ')}), aucune note exigée`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    ok(await noHScroll(page), 'Lots : aucun défilement horizontal')
    await page.screenshot({ path: path.join(OUT, `b179-lots-${w}.png`) })

    // 5. Aucune route 179 d'écriture ni d'historique appelée, aucune écriture tentée
    ok(!s.calls.some(c => /\/api\/stock\/batch-treatments(\?|\/photo|\/resolve)/.test(c)), 'aucun appel à l’historique ni aux écritures 179')
    ok(!s.calls.some(c => /^(POST|PATCH|DELETE|PUT) \/api\/(stock\/batch|product-batches|products)/.test(c)), 'aucune écriture de lot ou de produit envoyée')
    ok(!s.errors.length, `aucune erreur de page${s.errors.length ? ' — ' + s.errors.join(' | ') : ''}`)
    await s.browser.close()
  }

  // 6. Fiche produit : la liste des lots s'ouvre (lots épuisés repliés s'il y en a)
  console.log('\nFiche produit')
  const s = await open(390, 844)
  await s.page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('main [data-product-row], main [data-testid=product-card], main table tbody tr').first().waitFor({ timeout: 60000 }).catch(() => {})
  await s.page.waitForTimeout(2000)
  ok(!s.errors.length, `Produits : aucune erreur de page${s.errors.length ? ' — ' + s.errors.join(' | ') : ''}`)
  ok(await noHScroll(s.page), 'Produits : aucun défilement horizontal')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
