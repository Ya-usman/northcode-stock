// Contrôle EN LIGNE de pure lecture après push de 5903428 + 3367bfa (lot 2). Marché Soleil ; store/capture.js bloque toute
// écriture. On ouvre, on choisit, on lit — aucun enregistrement (les fenêtres sont fermées sans valider).
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function open(path) {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  // « Toutes les boutiques », boutique active cachée sur Bastos (elle ne doit plus rien décider)
  await s.page.addInitScript(() => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', 'all'); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} })
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(7000)
  return s
}
;(async () => {
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open('suppliers?view=purchase_orders')
    const n = await s.page.locator('[data-po-card]').count()
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · bons visibles en « Toutes » :', n)
    if (n === 4) {
      live = true
      ok((await s.page.locator('[data-po-card="BC-2026-0004"] [data-po-shop]').innerText().catch(() => '')).includes('Marché Soleil Akwa'), 'Fournisseurs › bons : les 4 bons d’Akwa visibles en « Toutes », boutique rappelée')
      await s.page.getByRole('button', { name: /Nouveau bon de commande/ }).first().click()
      const opts = await s.page.getByTestId('shop-picker').locator('[data-shop-option]').count().catch(() => 0)
      ok(opts === 3 && await s.page.getByTestId('po-drawer').count() === 0, 'nouveau bon : « Pour quelle boutique ? » (3 boutiques), rien d’ouvert avant le choix')
      ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  for (const [path, btn, label] of [['categories', '[data-tour="add-category"]', 'Catégories : ajouter'], ['customers', '[data-testid="customers-add"]', 'Clients : ajouter']]) {
    const s = await open(path)
    ok(await s.page.getByTestId('shop-scope-badge').isVisible().catch(() => false), `${label.split(' :')[0]} : badge « Toutes les boutiques »`)
    await s.page.locator(btn).first().click()
    const n = await s.page.getByTestId('shop-picker').locator('[data-shop-option]').count().catch(() => 0)
    ok(n === 3, `${label} en « Toutes » → choix de la boutique (${n} boutiques), annulé sans rien enregistrer`)
    ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
