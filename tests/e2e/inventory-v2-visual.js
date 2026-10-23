// Inventaire v2 — rendu des étapes « comptage » et « vérification » en fr / en / ha, téléphone et ordinateur.
// AUCUNE ÉCRITURE : toute écriture /api et /rest/v1 est bloquée ; la session en cours est SIMULÉE dans la réponse de
// lecture (produits réels d'Alpha, comptages fabriqués dans ce navigateur seulement). Serveur local obligatoire.
const { openPage } = require('./lib/session.js')
const BASE = 'http://localhost:3000'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OUT = __dirname + '/out'
require('fs').mkdirSync(OUT, { recursive: true })
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
// Mots anglais qui ne doivent JAMAIS apparaître sur l'écran haoussa ou français de l'inventaire
const ENGLISH = /\b(Counted|Expected|Difference|Matches|Recount|Review differences|Finalise|Search for a product)\b/

;(async () => {
  for (const locale of ['fr', 'en', 'ha']) {
    for (const [w, h] of [[390, 844], [1280, 900]]) {
      const s = await openPage({ width: w, height: h, skipGoto: true, blockServiceWorkers: true })
      const page = s.page
      const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
      await page.addInitScript(id => { try { localStorage.setItem('dashboard_shop_filter', id) } catch {} }, ALPHA)
      await page.route(/\/api\//, r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"bloqué"}' }))
      await page.route(/\/rest\/v1\//, r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"bloqué"}' }))
      await page.route(/\/api\/stock\/inventory-sessions\?shop_id=/, async route => {
        const res = await route.fetch(); const j = await res.json()
        const ps = j.products.slice(0, 3)
        const now = new Date().toISOString()
        j.session = { id: '99999999-9999-4999-8999-999999999999', reference: 'INV-2026-0099', status: 'in_progress', started_by_name: 'Admin Owner', started_at: now, products_total: j.products.length }
        j.counts = [
          { id: 'c1', product_id: ps[0].id, product_name: ps[0].name, unit: ps[0].unit, theoretical_qty: 28, counted_qty: 28, delta: 0, reason_code: null, surplus_expiry_date: null, recount_requested_at: null, counted_at: now },
          { id: 'c2', product_id: ps[1].id, product_name: ps[1].name, unit: ps[1].unit, theoretical_qty: 28, counted_qty: 26, delta: -2, reason_code: null, surplus_expiry_date: null, recount_requested_at: null, counted_at: now },
          { id: 'c3', product_id: ps[2].id, product_name: ps[2].name, unit: ps[2].unit, theoretical_qty: 28, counted_qty: 31, delta: 3, reason_code: 'correction', surplus_expiry_date: null, recount_requested_at: null, counted_at: now },
        ]
        j.can_write = true
        return route.fulfill({ response: res, body: JSON.stringify(j) })
      })
      await page.goto(`${BASE}/${locale}/stock/inventory-count`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.waitForTimeout(6000)
      const tag = `${locale}-${w}`
      const counting = await page.getByTestId('inventory-session').isVisible().catch(() => false)
      ok(counting, `${tag} : étape comptage affichée`)
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      ok(noScroll, `${tag} : pas de défilement horizontal`)
      const firstTodo = page.locator('[data-state="todo"] [data-testid="inventory-qty"]').first()
      ok(await firstTodo.inputValue() === '' && !(await firstTodo.getAttribute('placeholder')), `${tag} : champ « quantité comptée » vide, sans exemple`)
      const listText = await page.getByTestId('inventory-list').innerText()
      if (locale !== 'en') ok(!ENGLISH.test(listText), `${tag} : aucun texte anglais dans la liste`)
      await page.screenshot({ path: `${OUT}/comptage-${tag}.png`, fullPage: false })
      await page.getByTestId('inventory-review').click(); await page.waitForTimeout(800)
      const rev = await page.getByTestId('inventory-review-step').innerText()
      ok(await page.getByTestId('inventory-review-step').locator('[data-diff-id]').count() === 2, `${tag} : vérification → 2 écarts (le conforme n'y est pas)`)
      if (locale !== 'en') ok(!ENGLISH.test(rev), `${tag} : aucun texte anglais dans la vérification`)
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} : vérification sans défilement horizontal`)
      await page.screenshot({ path: `${OUT}/verification-${tag}.png`, fullPage: false })
      ok(errors.length === 0, `${tag} : aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
      await s.browser.close()
    }
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
