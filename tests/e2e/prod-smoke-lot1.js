// Contrôle EN LIGNE de pure lecture après push de eb423b3 (Caisse + Paramètres). Marché Soleil ; store/capture.js bloque
// toute écriture. Aucune vente (aucun article ajouté), aucun enregistrement : on ouvre, on choisit, on lit.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function open(path, filter) {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  if (filter) await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, filter)
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
;(async () => {
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open('sales/new')
    live = await s.page.getByTestId('pos-pick-shop').isVisible().catch(() => false)
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · écran de choix de la caisse :', live ? 'présent' : 'absent')
    if (live) {
      ok(await s.page.locator('[data-tour="pos-grid"]').count() === 0, 'caisse en « Toutes » : « Dans quelle boutique vendez-vous ? », aucun produit avant le choix')
      await s.page.getByTestId('pos-pick-shop').getByRole('button').click()
      const n = await s.page.getByTestId('shop-picker').locator('[data-shop-option]').count()
      await s.page.getByTestId('shop-picker').locator(`[data-shop-option="${AKWA}"]`).click()
      await s.page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 30000 }).catch(() => {})
      ok(n === 3 && /Vendre dans:?\s*Marché Soleil Akwa/.test(await s.page.locator('main').innerText()), `choix parmi ${n} boutiques → caisse d’Akwa (« Vendre dans : Marché Soleil Akwa »)`)
      ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  let s = await open('settings', 'all')
  ok(await s.page.getByTestId('settings-pick-shop').isVisible() && !/Informations de la boutique/i.test(await s.page.locator('main').innerText()), 'Paramètres en « Toutes » : choix de la boutique demandé, aucune section de boutique')
  await s.browser.close()
  s = await open('settings', AKWA)
  ok((await s.page.getByTestId('settings-shop').innerText().catch(() => '')).includes('Réglages de : Marché Soleil Akwa'), 'Paramètres sur Akwa : « Réglages de : Marché Soleil Akwa »')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
