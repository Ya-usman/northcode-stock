// Page Plateforme (lot B du 6 nov. 2026, en onglets depuis le 7 nov.). LECTURE SEULE : visiteur sans compte, toute
// écriture interceptée.
//   1. Ordinateur : six onglets (Vente d'abord), une seule partie affichée, tout le contenu présent dans la page servie,
//      adresse par onglet, Retour du navigateur, « Suivant », clavier, captures avec texte de remplacement, équipe
//      d'exemple avec les noms de rôles de l'application, aucun lien mort.
//   2. Accueil et pied de page : les liens ouvrent le bon onglet.
//   3. Téléphone : rien ne dépasse (320 / 390 px, fr / en / ha), onglets collés sous l'en-tête, onglet actif visible.
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
const selected = p => p.locator('[role="tab"][aria-selected="true"]').innerText().catch(() => '')
const shown = p => p.locator('[role="tabpanel"]:not([hidden])').evaluateAll(ps => ps.map(x => x.id))
const hash = p => p.evaluate(() => location.hash)

;(async () => {
  console.log('1. Plateforme, ordinateur (français)')
  let v = await visit({}); let p = v.page
  ok(v.status === 200, 'page servie (200)', v.status)
  ok(norm(await p.locator('h1').innerText()) === 'Tout ce qu\'il faut pour gérer vos boutiques.', 'titre de la page')
  const tabs = await p.locator('[role="tablist"] [role="tab"]').allInnerTexts()
  ok(tabs.join('|') === 'Vente|Stock|Pilotage|Clients et crédits|Équipe|Multi-boutiques', 'six onglets, Vente en premier', tabs)
  ok(await selected(p) === 'Vente' && (await shown(p)).join() === 'vente', 'au départ : « Vente » seule affichée', await shown(p))
  ok(await p.locator('[role="tabpanel"]').count() === 6, 'les six parties sont dans la page (cachées, pas absentes)')
  const html = await (await v.ctx.request.get(`${BASE}/fr/plateforme`)).text()
  ok(/Lots et péremptions/.test(html) && /Mariam Sow/.test(html) && /Alertes par e-mail/.test(html), 'page servie : le texte de tous les onglets est dans le HTML (moteurs de recherche)')
  ok(await p.getByTestId('site-nav-platform').getAttribute('aria-current') === 'page', 'en-tête : « Plateforme » marquée comme page en cours')
  await p.getByRole('tab', { name: 'Pilotage' }).click(); await wait(500)
  ok(await selected(p) === 'Pilotage' && (await shown(p)).join() === 'pilotage' && await hash(p) === '#pilotage', 'clic sur « Pilotage » : seule cette partie, adresse #pilotage')
  const next = p.locator('[role="tabpanel"]:not([hidden]) [data-testid="platform-next"]')
  ok(norm(await next.innerText()) === 'Suivant : Clients et crédits', 'en bas de la partie : « Suivant : Clients et crédits »', await next.innerText())
  await next.scrollIntoViewIfNeeded(); await wait(300)
  await next.click(); await wait(600)
  ok(await selected(p) === 'Clients et crédits' && await hash(p) === '#clients', '« Suivant » ouvre la partie suivante')
  const navTop = await p.getByTestId('platform-nav').evaluate(e => Math.round(e.getBoundingClientRect().top))
  const panelTop = await p.locator('#clients').evaluate(e => Math.round(e.getBoundingClientRect().top))
  ok(panelTop > navTop && panelTop < 500, `après « Suivant » : retour en haut de la partie, sous les onglets (onglets ${navTop} px, partie ${panelTop} px)`)
  await p.goBack(); await wait(600)
  ok(await selected(p) === 'Pilotage' && (await shown(p)).join() === 'pilotage', 'bouton Retour du navigateur : revient à « Pilotage »')
  await p.getByRole('tab', { name: 'Pilotage' }).focus()
  await p.keyboard.press('ArrowRight'); await wait(300)
  ok(await selected(p) === 'Clients et crédits' && await p.evaluate(() => document.activeElement?.textContent) === 'Clients et crédits', 'clavier : flèche droite, onglet suivant sélectionné et focalisé')
  await p.keyboard.press('End'); await wait(300)
  ok(await selected(p) === 'Multi-boutiques' && await next.count() === 0, 'Fin : dernier onglet, sans « Suivant »')
  await p.keyboard.press('Home'); await wait(300)
  ok(await selected(p) === 'Vente', 'Début : premier onglet')
  // Captures : chaque partie affichée à son tour, image chargée avec texte de remplacement
  const imgs = []
  for (const name of ['Vente', 'Stock', 'Pilotage', 'Clients et crédits']) {
    await p.getByRole('tab', { name }).click(); await wait(400)
    const img = p.locator('[role="tabpanel"]:not([hidden]) img').first()
    await img.scrollIntoViewIfNeeded(); await wait(700)
    imgs.push(await img.evaluate(i => [i.alt, i.naturalWidth]))
  }
  ok(imgs.length === 4 && imgs.every(([alt, w]) => alt && w > 0), '4 captures chargées, avec texte de remplacement', imgs)
  await p.getByRole('tab', { name: 'Équipe' }).click(); await wait(400)
  const team = norm(await p.getByTestId('platform-team-panel').innerText())
  ok(/5 membres/.test(team) && /Aïcha Ndiaye Propriétaire Toutes les boutiques/.test(team) && /Mariam Sow Gestionnaire de stock Bastos/.test(team), 'équipe d\'exemple : noms de rôles de l\'application', team)
  const all = norm(await p.locator('main').evaluate(e => e.textContent))
  ok(!/Bilan du matin/.test(all) && /Alertes par e-mail/.test(all), 'pas de « bilan du matin » promis (réservé à l\'administration) ; alertes e-mail réelles')
  ok(/Exemple : l'équipe des boutiques de démonstration/.test(all) && /Exemple tiré des boutiques de démonstration/.test(all), 'exemples annoncés comme tels')
  const hrefs = Array.from(new Set(await p.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('#')[0]))))
  const dead = []
  for (const h of hrefs) { const r = await v.ctx.request.get(BASE + h, { maxRedirects: 0 }).catch(() => null); if (!r || r.status() >= 400) dead.push(`${h} ${r && r.status()}`) }
  ok(dead.length === 0, `aucun lien mort (${hrefs.length} liens internes)`, dead)
  const alt = await p.locator('link[rel="alternate"][hreflang]').evaluateAll(ls => ls.map(l => l.getAttribute('hreflang')))
  ok(/Plateforme/.test(await p.title()) && ['fr', 'en', 'ha'].every(l => alt.includes(l)), 'titre et versions fr / en / ha', [await p.title(), alt])
  await p.getByRole('tab', { name: 'Vente' }).click(); await p.evaluate(() => window.scrollTo(0, 0)); await wait(400)
  await p.screenshot({ path: OUT + '/site-platform-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()

  console.log('\n2. Accueil et pied de page : liens vers les onglets')
  v = await visit({ path: '' }); p = v.page
  const tiles = await p.locator('.tiles a').evaluateAll(as => as.map(a => a.getAttribute('href')))
  ok(tiles.join('|') === '/fr/plateforme#vente|/fr/plateforme#stock|/fr/plateforme#pilotage|/fr/plateforme#equipe', 'tuiles : un onglet chacune', tiles)
  ok(await p.getByRole('link', { name: 'Voir la plateforme' }).first().isVisible(), 'haut de page : « Voir la plateforme »')
  await Promise.all([p.waitForURL(/plateforme#stock$/, { timeout: 60000 }), p.locator('.tiles a').nth(1).click()])
  await wait(1500)
  ok(await selected(p) === 'Stock' && (await shown(p)).join() === 'stock', 'tuile Stock : arrive sur l\'onglet Stock', [await selected(p), await shown(p)])
  await p.locator('footer a[href$="plateforme#equipe"]').click(); await wait(800)
  ok(await selected(p) === 'Équipe' && (await shown(p)).join() === 'equipe', 'pied de page, déjà sur la page : « Équipe » ouvre son onglet', [await selected(p), await shown(p)])
  const fTop = await p.locator('#equipe').evaluate(e => Math.round(e.getBoundingClientRect().top))
  const fNav = await p.getByTestId('platform-nav').evaluate(e => Math.round(e.getBoundingClientRect().bottom))
  ok(fTop >= fNav - 2 && fTop < 500, `pied de page : la partie arrive juste sous les onglets (onglets jusqu'à ${fNav} px, partie à ${fTop} px)`)
  ok(v.errors.length === 0, 'aucune erreur JS', v.errors)
  await v.browser.close()
  v = await visit({ path: '/plateforme#inconnu' })
  ok(await selected(v.page) === 'Vente', 'adresse inconnue (#inconnu) : premier onglet')
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
  await p.getByRole('tab', { name: 'Clients et crédits' }).click(); await wait(800)
  const tab = p.locator('[role="tab"][aria-selected="true"]')
  const inView = await tab.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth })
  ok(await tab.innerText() === 'Clients et crédits' && inView, 'onglet actif visible dans la rangée', await tab.innerText())
  await p.mouse.wheel(0, 900); await wait(800)
  const stuck = await p.getByTestId('platform-nav').evaluate(e => Math.round(e.getBoundingClientRect().top))
  ok(stuck === 58, `téléphone : onglets collés sous l'en-tête (${stuck} px)`)
  const nb = p.locator('[role="tabpanel"]:not([hidden]) [data-testid="platform-next"]')
  await nb.scrollIntoViewIfNeeded(); await wait(300)
  const nbBox = await nb.boundingBox()
  ok(nbBox && nbBox.height >= 44 && nbBox.width >= 300, `« Suivant » : grand bouton pleine largeur (${nbBox && Math.round(nbBox.width)} × ${nbBox && Math.round(nbBox.height)})`)
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300)
  await p.screenshot({ path: OUT + '/site-platform-phone.png' })
  await v.browser.close()
  v = await visit({ locale: 'ha', width: 390, height: 844 })
  ok(norm(await v.page.locator('h1').innerText()) === 'Duk abin da ake buƙata don gudanar da kantunanku.', 'haoussa : titre')
  await v.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
