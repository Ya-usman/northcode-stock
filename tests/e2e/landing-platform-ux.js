// Page Plateforme (lot B du 6 nov. 2026). LECTURE SEULE : visiteur sans compte, toute écriture interceptée.
//   1. Ordinateur : titre, 6 pastilles, la pastille active suit la lecture et un clic mène à la section, captures
//      chargées avec texte de remplacement, équipe d'exemple avec les noms de rôles de l'application, aucun lien mort.
//   2. Accueil : la page apparaît dans l'en-tête, les tuiles mènent aux sections de la plateforme.
//   3. Téléphone : rien ne dépasse (320 / 390 px, fr / en / ha), pastilles collées sous l'en-tête.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/landing-platform-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

async function visit({ locale = 'fr', path = '/plateforme', width = 1440, height = 900 }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const mobile = width < 500
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: locale === 'fr' ? 'fr-FR' : 'en-US', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []
  await page.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url())
    if (u.pathname === '/api/geo') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"country":null}' })
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    sent.push(`${r.method()} ${u.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const res = await page.goto(`${BASE}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 120000 }); await wait(1200)
  return { browser, ctx, page, errors, sent, status: res && res.status() }
}
const activePill = p => p.locator('[data-testid="platform-nav"] a[aria-current="true"]').innerText().catch(() => '')

;(async () => {
  console.log('1. Plateforme, ordinateur (français)')
  let v = await visit({}); let p = v.page
  ok(v.status === 200, 'page servie (200)', v.status)
  ok(norm(await p.locator('h1').innerText()) === 'Tout ce qu\'il faut pour gérer vos boutiques.', 'titre de la page')
  const pills = await p.locator('[data-testid="platform-nav"] a').allInnerTexts()
  ok(pills.join('|') === 'Multi-boutiques|Vente|Stock|Pilotage|Clients et crédits|Équipe', 'six pastilles', pills)
  ok(await activePill(p) === 'Multi-boutiques', 'au départ : « Multi-boutiques » active')
  ok(await p.getByTestId('site-nav-platform').getAttribute('aria-current') === 'page', 'en-tête : « Plateforme » marquée comme page en cours')
  await p.locator('[data-testid="platform-nav"] a', { hasText: 'Pilotage' }).click(); await wait(1500)
  const top = await p.locator('#pilotage').evaluate(e => e.getBoundingClientRect().top)
  ok(top >= 100 && top <= 200, `clic sur « Pilotage » : la section arrive sous les pastilles (${Math.round(top)} px)`)
  ok(await activePill(p) === 'Pilotage', 'pastille « Pilotage » active')
  await p.locator('#equipe').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 200); await wait(1200)
  ok(await activePill(p) === 'Équipe', 'en lisant jusqu\'à l\'équipe : la pastille suit', await activePill(p))
  const stuck = await p.getByTestId('platform-nav').evaluate(e => Math.round(e.getBoundingClientRect().top))
  ok(stuck === 68, `pastilles collées sous l'en-tête (${stuck} px)`)
  // Captures : toutes chargées (après défilement), texte de remplacement
  for (const id of ['vente', 'stock', 'pilotage', 'clients']) { await p.locator(`#${id}`).scrollIntoViewIfNeeded(); await wait(500) }
  const imgs = await p.locator('main img').evaluateAll(is => is.map(i => [i.alt, i.naturalWidth]))
  ok(imgs.length === 4 && imgs.every(([alt, w]) => alt && w > 0), '4 captures chargées, avec texte de remplacement', imgs)
  const team = norm(await p.getByTestId('platform-team-panel').innerText())
  ok(/5 membres/.test(team) && /Aïcha Ndiaye Propriétaire Toutes les boutiques/.test(team) && /Mariam Sow Gestionnaire de stock Bastos/.test(team), 'équipe d\'exemple : noms de rôles de l\'application', team)
  const all = norm(await p.locator('main').innerText())
  ok(!/Bilan du matin/.test(all) && /Alertes par e-mail/.test(all), 'pas de « bilan du matin » promis (réservé à l\'administration) ; alertes e-mail réelles')
  ok(/Exemple : l'équipe des boutiques de démonstration/.test(all) && /Exemple tiré des boutiques de démonstration/.test(all), 'exemples annoncés comme tels')
  const hrefs = Array.from(new Set(await p.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('#')[0]))))
  const dead = []
  for (const h of hrefs) { const r = await v.ctx.request.get(BASE + h, { maxRedirects: 0 }).catch(() => null); if (!r || r.status() >= 400) dead.push(`${h} ${r && r.status()}`) }
  ok(dead.length === 0, `aucun lien mort (${hrefs.length} liens internes)`, dead)
  const alt = await p.locator('link[rel="alternate"][hreflang]').evaluateAll(ls => ls.map(l => l.getAttribute('hreflang')))
  ok(/Plateforme/.test(await p.title()) && ['fr', 'en', 'ha'].every(l => alt.includes(l)), 'titre et versions fr / en / ha', [await p.title(), alt])
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300)
  await p.screenshot({ path: OUT + '/site-platform-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()

  console.log('\n2. Accueil : liens vers la plateforme')
  v = await visit({ path: '' }); p = v.page
  const tiles = await p.locator('.tiles a').evaluateAll(as => as.map(a => a.getAttribute('href')))
  ok(tiles.join('|') === '/fr/plateforme#vente|/fr/plateforme#stock|/fr/plateforme#pilotage|/fr/plateforme#equipe', 'tuiles : une section chacune', tiles)
  ok(await p.getByRole('link', { name: 'Voir la plateforme' }).first().isVisible(), 'haut de page : « Voir la plateforme »')
  await Promise.all([p.waitForURL(/plateforme#stock$/, { timeout: 60000 }), p.locator('.tiles a').nth(1).click()])
  await wait(1500)
  ok(await activePill(p) === 'Stock', 'tuile Stock : arrive sur la section Stock, pastille active', await activePill(p))
  await v.browser.close()

  console.log('\n3. Téléphone')
  const wide = []
  for (const width of [320, 390]) for (const locale of ['fr', 'en', 'ha']) {
    v = await visit({ locale, width, height: 760 })
    const w = await v.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (w[0] > w[1]) wide.push(`${locale} ${width} : ${w[0]}`)
    if (v.errors.length) wide.push(`${locale} ${width} : erreur JS ${v.errors[0]}`)
    await v.browser.close()
  }
  ok(wide.length === 0, 'rien ne dépasse de l\'écran (320 et 390 px, fr / en / ha)', wide)
  v = await visit({ width: 390, height: 844 }); p = v.page
  await p.locator('#clients').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 150); await wait(1200)
  const navTop = await p.getByTestId('platform-nav').evaluate(e => Math.round(e.getBoundingClientRect().top))
  ok(navTop === 58, `téléphone : pastilles collées sous l'en-tête (${navTop} px)`)
  const pill = p.locator('[data-testid="platform-nav"] a[aria-current="true"]')
  const inView = await pill.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth })
  ok(await pill.innerText() === 'Clients et crédits' && inView, 'pastille active visible dans la rangée', await pill.innerText())
  await p.screenshot({ path: OUT + '/site-platform-phone.png' })
  await v.browser.close()
  v = await visit({ locale: 'ha', width: 390, height: 844 })
  ok(norm(await v.page.locator('h1').innerText()) === 'Duk abin da ake buƙata don gudanar da kantunanku.', 'haoussa : titre')
  await v.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
