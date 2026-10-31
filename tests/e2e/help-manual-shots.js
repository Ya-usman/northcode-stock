// Captures du manuel de la page Aide (31 oct. 2026) : 18 écrans par langue (fr, en, ha), téléphone 390×844,
// compte vitrine Marché Soleil (Akwa), LECTURE SEULE (écritures interceptées par lib/capture.js et comptées).
// Écrit public/manual/<langue>/<écran>.png. À relancer quand l'application sera terminée (consigne de l'utilisateur).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/help-manual-shots.js [fr,en,ha]
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const fs = require('fs')
const path = require('path')
const { session, BASE } = require('./lib/capture.js')
const OUT = path.resolve(__dirname, '../../public/manual')
const LOCALES = (process.argv[2] || 'fr,en,ha').split(',')
const wait = ms => new Promise(r => setTimeout(r, ms))
// Carte « Recevoir les notifications » masquée (elle encombre chaque écran)
const HIDE = '[data-testid="enable-notifications-card"]{display:none!important}'

const SHOTS = [
  ['dashboard', 'dashboard'],
  ['new-sale', 'sales/new', async p => { await p.locator('[data-tour="pos-grid"] > div[role="button"]').nth(1).click().catch(() => {}); await wait(800) }],
  ['sales-history', 'sales/history', async p => {
    await p.getByRole('combobox').first().click().catch(() => {}); await wait(500)
    const opts = p.getByRole('option'); const n = await opts.count()
    if (n) { await opts.nth(n >= 6 ? 5 : n - 1).click().catch(() => {}); await wait(3500); await p.evaluate(() => document.activeElement?.blur?.()) }
  }],
  ['credits', 'payments'],
  ['customers', 'customers'],
  ['stock-overview', 'stock'],
  ['stock-products', 'stock/products'],
  ['stock-transfers', 'stock/transfers'],
  ['stock-replenishment', 'stock/replenishment'],
  ['suppliers', 'suppliers'],
  ['expenses', 'expenses'],
  // Rapports : période la plus large proposée (la vitrine n'a pas de vente aujourd'hui)
  ['reports', 'reports', async p => {
    await p.getByRole('combobox').first().click().catch(() => {}); await wait(500)
    const opts = p.getByRole('option'); const n = await opts.count()
    if (n) { await opts.nth(n - 2 >= 0 ? n - 2 : 0).click().catch(() => {}); await wait(4000); await p.evaluate(() => document.activeElement?.blur?.()) }
  }],
  // Contrôle de caisse : on remonte jusqu'au dernier jour avec des ventes (14 jours au plus)
  ['cash-control', 'caisse', async (p, locale) => {
    const empty = require(`../../messages/${locale}.json`).caisse.no_sales
    for (let i = 0; i < 14; i++) {
      if (!(await p.locator('main').innerText()).includes(empty)) break
      await p.locator('main button').first().click().catch(() => {}); await wait(2500)
    }
  }],
  ['team', 'team'],
  ['shops', 'shops'],
  ['settings', 'settings', async p => { await p.getByTestId('shop-short-name').scrollIntoViewIfNeeded().catch(() => {}); await p.evaluate(() => window.scrollBy(0, -260)); await wait(500) }],
  ['avatar-menu', 'dashboard', async p => { await p.getByTestId('user-menu').click(); await wait(800) }],
  ['more-menu', 'dashboard', async p => { await p.getByTestId('nav-more').click(); await wait(1000) }],
]

;(async () => {
  let writes = 0, n = 0
  for (const locale of LOCALES) {
    fs.mkdirSync(path.join(OUT, locale), { recursive: true })
    const s = await session({ width: 390, height: 844, scale: 2, locale })
    s.page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/(sales|stock|products|payments|shops\/settings)|\/rest\/v1\/(products|sales|payments)/.test(r.url())) writes++ })
    await s.ctx.addInitScript(css => { const add = () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st) }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add) }, HIDE)
    const ONLY = (process.env.SHOTS_ONLY || '').split(',').filter(Boolean) // ex. SHOTS_ONLY=cash-control
    for (const [name, route, prep] of SHOTS.filter(([n]) => !ONLY.length || ONLY.includes(n))) {
      await s.page.goto(`${BASE}/${locale}/${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
      if (prep) await prep(s.page, locale)
      await s.page.screenshot({ path: path.join(OUT, locale, `${name}.png`) })
      n++
      console.log(`  ${locale}/${name}.png`)
      await s.page.keyboard.press('Escape').catch(() => {})
    }
    await s.browser.close()
  }
  console.log(`\n${n} captures, ${writes} tentative(s) d’écriture`)
  process.exit(writes ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 800)); process.exit(1) })
