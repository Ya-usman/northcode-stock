// Lot 2B, étape B1 — les chiffres affichés sont-ils IDENTIQUES avant / après le passage des lectures par le serveur ?
// Relève, pour 8 comptes, le texte affiché du tableau de bord, de Boutiques, de la fiche boutique (vue d'ensemble et
// onglet Caisse) et de Catégories. LECTURE SEULE (lib/capture.js bloque toute écriture).
// Usage :
//   ONLINE=1 OUT=<avant.json> node tests/e2e/b1-figures.js        version en ligne (avant)
//   OUT=<apres.json> node tests/e2e/b1-figures.js                 serveur local (après)
//   node tests/e2e/b1-figures.js --compare <avant.json> <apres.json>
const fs = require('fs')
const wait = ms => new Promise(r => setTimeout(r, ms))

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3).map(f => JSON.parse(fs.readFileSync(f, 'utf8')))
  let same = 0, diff = 0
  for (const acc of Object.keys(a)) for (const page of Object.keys(a[acc])) {
    const x = a[acc][page], y = b[acc]?.[page]
    if (x === y) { same++; continue }
    diff++
    const xl = (x || '').split('\n'), yl = (y || '').split('\n')
    console.log(`DIFFÉRENCE ${acc} · ${page}`)
    for (let i = 0; i < Math.max(xl.length, yl.length); i++) if (xl[i] !== yl[i]) console.log(`    avant : ${xl[i] ?? '∅'}\n    après : ${yl[i] ?? '∅'}`)
  }
  console.log(`${same} écran(s) identique(s), ${diff} différent(s)`)
  process.exit(diff ? 1 : 0)
}

process.env.CAPTURE_BASE = process.env.ONLINE ? 'https://stockshop.tech' : 'http://localhost:3000'
if (process.env.ONLINE) process.env.CAPTURE_PROD_READONLY = '1'
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001', AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
// [compte, boutique, gère l'équipe (pages Boutiques)]
const ACCOUNTS = [
  ['ghislainx123@gmail.com', AKWA, true], ['ghislainx123+jeanpaul@gmail.com', AKWA, true], ['cassierstock@gmail.com', ALPHA, true],
  ['ghislainx123+mariam@gmail.com', BASTOS, false], ['stocshopci+magasinier@gmail.com', ALPHA, false],
  ['ghislainx123+fatou@gmail.com', AKWA, false], ['stocshopci@gmail.com', ALPHA, false], ['stocshopci+observateur@gmail.com', ALPHA, false],
]
const text = async page => (await page.locator('main').innerText().catch(() => ''))
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')

;(async () => {
  const out = {}
  for (const [email, shop, manager] of ACCOUNTS) {
    process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
    const s = await session({ width: 1366, height: 900, locale: 'fr' })
    const got = out[email] = {}
    const visit = async (path, ms = 9000) => {
      await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
      await wait(ms)
    }
    await visit('dashboard', 12000); got.dashboard = await text(s.page)
    await visit('categories'); got.categories = await text(s.page)
    if (manager) {
      await visit('shops'); got.shops = await text(s.page)
      await visit(`shops/${shop}`); got.shop_overview = await text(s.page)
      const tab = s.page.getByTestId('shop-tab-cash')
      if (await tab.count()) { await tab.click(); await wait(7000); got.shop_cash = await text(s.page) }
    }
    console.log(`${email} : ${Object.keys(got).join(', ')}`)
    await s.browser.close().catch(() => {})
  }
  fs.writeFileSync(process.env.OUT || 'b1-figures.json', JSON.stringify(out, null, 1))
  console.log(`écrit : ${process.env.OUT || 'b1-figures.json'}`)
  process.exit(0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
