// Catégories — la valeur du stock s'affiche même quand les coûts arrivent APRÈS les produits et les ventes 30 j
// (défaut constaté le 26 oct. 2026 : « Valeur : 0 F CFA », 1 chargement sur 4 en ligne). Coûts retardés de 5 s.
// LECTURE SEULE (lib/capture.js). Compte : magasinière de Bastos (droit aux coûts accordé par la 181).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/categories-cost-late.js   (ONLINE=1 : en ligne)
process.env.CAPTURE_BASE = process.env.ONLINE ? 'https://stockshop.tech' : (process.env.CAPTURE_BASE || 'http://localhost:3000')
if (process.env.ONLINE) process.env.CAPTURE_PROD_READONLY = '1'
const { session, BASE } = require('./lib/capture.js')
const wait = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
;(async () => {
  process.env.CAPTURE_EMAIL = 'ghislainx123+mariam@gmail.com'; process.env.PIN_SHOP = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  let costCalls = 0
  await s.page.route(/\/api\/costs/, async route => { costCalls++; const res = await route.fetch(); await wait(5000); await route.fulfill({ response: res }).catch(() => {}) })
  await s.page.goto(`${BASE}/fr/categories`, { waitUntil: 'domcontentloaded' }); await wait(14000)
  const values = ((await s.page.locator('main').innerText().catch(() => '')).match(/Valeur : [^\n]*/g) || [])
  ok(costCalls > 0 && values.length > 0 && values.every(v => !/Valeur : 0\s/.test(v + ' ')), `coûts arrivés en dernier : valeurs affichées (${values.slice(0, 3).join(' · ') || 'aucune'})`)
  await s.browser.close().catch(() => {})
  console.log(`${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
