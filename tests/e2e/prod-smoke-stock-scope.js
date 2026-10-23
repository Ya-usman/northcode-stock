// Contrôle EN LIGNE (lecture seule, Marché Soleil) après push de 965fbc8 + 8666236.
// capture.js bloque toute écriture (réponse 204) ; seules des lectures atteignent le serveur.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

// shop : undefined = appareil neuf (aucune mémoire) ; null = « Toutes » ; id = boutique
async function open(path, { shop, width = 1366, height = 900 } = {}) {
  const s = await session({ width, height, scale: 1, locale: 'fr' })
  if (shop !== undefined) await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all') } } catch {} }, [shop])
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const count = async page => Number(((await page.getByTestId('products-count').innerText()).match(/\d+/) || [0])[0])
const refs = async page => { const t = await page.locator('main').innerText(); return ['TR-2026-0001', 'TR-2026-0002'].filter(r => t.includes(r)).join(',') }

;(async () => {
  // Attente du déploiement : appareil neuf → « Toutes les boutiques » (badge) sur Produits
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open('stock/products')
    const mode = await s.page.getByTestId('shop-scope-badge').getAttribute('data-scope-mode', { timeout: 3000 }).catch(() => null)
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · badge :', mode || 'absent')
    await s.browser.close()
    if (mode === 'all_shops') live = true; else await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }

  const errs = []
  let s = await open('stock/products')
  ok((await s.page.getByTestId('shop-scope-badge').innerText()).trim() === 'Toutes les boutiques' && await count(s.page) === 82, `appareil neuf : « Toutes les boutiques », ${await count(s.page)} produits`)
  await s.page.locator('[data-tour="add-product-menu"]:visible').first().click(); await s.page.locator('[data-tour="add-product-item"]').click()
  ok(await s.page.getByTestId('shop-picker').waitFor({ timeout: 10000 }).then(() => true).catch(() => false) && await s.page.getByTestId('product-drawer').count() === 0, 'créer en « Toutes » : « Dans quelle boutique ? », aucun panneau avant le choix (annulé)')
  errs.push(...s.errors); await s.browser.close()

  s = await open('stock/products', { shop: AKWA })
  ok(await s.page.getByTestId('shop-scope-badge').count() === 0 && await count(s.page) === 38, `Akwa : ${await count(s.page)} produits, pas de badge`)
  errs.push(...s.errors); await s.browser.close()

  s = await open('stock', { shop: null })
  ok((await s.page.getByTestId('overview-shop-context').innerText()).trim() === 'Toutes les boutiques', 'Vue d’ensemble : « Toutes les boutiques »')
  errs.push(...s.errors); await s.browser.close()
  s = await open('stock', { shop: AKWA })
  ok((await s.page.getByTestId('overview-shop-context').innerText()).trim() === 'Akwa', 'Vue d’ensemble : « Akwa »')
  errs.push(...s.errors); await s.browser.close()

  for (const path of ['stock/movements', 'stock/expiry']) {
    s = await open(path, { shop: null })
    ok(await s.page.getByTestId('shop-scope-badge').isVisible(), `${path} en « Toutes » : badge présent`)
    errs.push(...s.errors); await s.browser.close()
  }

  s = await open('stock/inventory-count', { shop: null })
  ok(await s.page.getByTestId('inventory-pick-shop').isVisible() && await s.page.locator('input[type=number]').count() === 0, 'Inventaire en « Toutes » : choix de la boutique demandé, aucun comptage')
  errs.push(...s.errors); await s.browser.close()

  for (const [shop, exp, name] of [[null, 'TR-2026-0001,TR-2026-0002', 'Toutes'], [AKWA, 'TR-2026-0001,TR-2026-0002', 'Akwa (source)'], [BASTOS, 'TR-2026-0002', 'Bastos (destination)']]) {
    s = await open('stock/transfers', { shop }); await s.page.waitForTimeout(1500)
    const r = await refs(s.page)
    ok(r === exp, `Transferts ${name} : ${r || 'aucun'}`)
    errs.push(...s.errors); await s.browser.close()
  }
  ok(errs.length === 0, `aucune erreur JavaScript${errs.length ? ' : ' + errs.join(' | ') : ''}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
