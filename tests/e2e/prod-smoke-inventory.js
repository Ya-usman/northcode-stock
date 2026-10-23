// Contrôle EN LIGNE de pure lecture après push de 2620eb9 (Inventaire v2). Marché Soleil ; store/capture.js bloque toute
// écriture. Aucun inventaire démarré : on ouvre l'écran, on choisit la boutique, on lit.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function open(filter) {
  const s = await session({ width: 390, height: 844, scale: 1, locale: 'fr' })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, filter)
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/fr/stock/inventory-count`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(7000)
  return s
}
;(async () => {
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open(AKWA)
    live = await s.page.getByTestId('inventory-idle').isVisible().catch(() => false) || await s.page.getByTestId('inventory-session').isVisible().catch(() => false)
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvel écran Inventaire :', live ? 'en ligne' : 'pas encore')
    if (live) {
      ok(await s.page.getByTestId('inventory-idle').isVisible() && /Inventaire physique/.test(await s.page.locator('main').innerText()), 'Akwa : « Inventaire physique » + « Démarrer un inventaire » (aucun inventaire en cours)')
      ok(/Marché Soleil Akwa/.test(await s.page.getByTestId('inventory-shop').innerText()), 'boutique rappelée : « Inventaire : Marché Soleil Akwa »')
      const r = await s.page.evaluate(async id => { const x = await fetch(`/api/stock/inventory-sessions?shop_id=${id}`); return { status: x.status, j: await x.json() } }, AKWA)
      const leaks = (r.j.products || []).filter(p => 'quantity' in p || 'buying_price' in p || 'selling_price' in p).length
      ok(r.status === 200 && (r.j.products || []).length > 0 && leaks === 0, `serveur : ${r.j.products?.length} produits SANS stock ni prix (${leaks} fuite)`)
      ok(s.page.evaluate && await s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'téléphone : pas de défilement horizontal')
      ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  const s = await open('all')
  ok(await s.page.getByTestId('inventory-pick-shop').isVisible() && await s.page.getByTestId('inventory-start').count() === 0, '« Toutes » : la boutique est demandée avant tout inventaire')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
