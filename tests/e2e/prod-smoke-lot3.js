// Contrôle EN LIGNE de pure lecture après push de 79342ab (lot 3 : Dépenses + budgets, Notes). Marché Soleil ;
// lib/capture.js bloque toute écriture. Rien n'est enregistré : les choix de boutique sont annulés.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function open(path, filter = 'all') {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, filter)
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(7000)
  return s
}
;(async () => {
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open('expenses')
    live = await s.page.locator('[data-budget-shop]').count() > 0
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · budgets par boutique :', live ? 'en ligne' : 'pas encore')
    if (live) {
      const groups = await s.page.locator('[data-budget-shop]').count()
      ok(groups >= 1 && /Marché Soleil Akwa/.test(await s.page.locator(`[data-budget-shop="${AKWA}"]`).innerText()), `Dépenses en « Toutes » : budgets par boutique (${groups} sections), ceux d’Akwa visibles malgré la boutique cachée sur Bastos`)
      ok(await s.page.locator('[data-expense-shop]').count() > 0, 'chaque dépense rappelle sa boutique')
      await s.page.getByTestId('expenses-add').click()
      const n = await s.page.getByTestId('shop-picker').locator('[data-shop-option]').count().catch(() => 0)
      ok(n === 3 && await s.page.getByTestId('expense-drawer').count() === 0, `nouvelle dépense → « Dans quelle boutique ? » (${n}), annulé sans rien enregistrer`)
      ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  const s = await open('notes')
  ok(await s.page.locator('main button[aria-haspopup="listbox"]').count() === 0 && await s.page.getByTestId('shop-scope-badge').isVisible(), 'Notes : plus de sélecteur de boutique dans la page, badge « Toutes les boutiques »')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
