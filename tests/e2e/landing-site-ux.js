// Nouvel accueil et habillage des pages publiques (lot A du 6 nov. 2026). LECTURE SEULE : visiteur sans compte, toute
// écriture interceptée, /api/geo simulé.
//   1. Ordinateur : titres, aucun chiffre ni avis inventé, navigation = pages en ligne seulement, aucun lien mort,
//      captures chargées avec texte de remplacement, données d'exemple annoncées comme telles, métadonnées et langues.
//   2. Prix de départ : pays de l'hébergeur (Cameroun, Nigeria), sinon langue.
//   3. Langue (menu déroulant) et thème (mode sombre) sur ordinateur.
//   4. Téléphone : rien ne dépasse (320 / 390 px, fr / en / ha), bouton d'essai collant après le haut de page seulement,
//      menu ☰ (pages, « Langue : … », thème, boutons), haoussa.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/landing-site-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

async function visit({ locale = 'fr', path = '', geo = null, width = 1440, height = 900, dark = false }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const mobile = width < 500
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light', locale: locale === 'fr' ? 'fr-FR' : 'en-US', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []
  await page.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url())
    if (u.pathname === '/api/geo') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: geo }) })
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    sent.push(`${r.method()} ${u.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const res = await page.goto(`${BASE}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 120000 }); await wait(1200)
  return { browser, ctx, page, errors, sent, status: res && res.status() }
}

;(async () => {
  console.log('1. Accueil, ordinateur (français)')
  let v = await visit({ geo: 'CM' }); let p = v.page
  ok(v.status === 200, 'page servie (200)', v.status)
  const h1 = norm(await p.locator('h1').innerText())
  ok(h1 === 'Toutes vos boutiques. Un seul système. Une vision complète.', `titre : « ${h1} »`)
  const all = norm(await p.locator('body').innerText())
  ok(!/500\+|2B\+|4[,.]9|avis|Musa|Mbarga|Koné/i.test(all), 'aucun chiffre ni avis inventé (500+, 4,9, avis…)')
  ok(/Exemple tiré des boutiques de démonstration/.test(all), 'panneau multi-boutiques annoncé comme exemple')
  // Navigation : seulement les pages en ligne ; aucun lien interne mort
  const navLinks = await p.locator('.site-nav a').evaluateAll(as => as.map(a => a.getAttribute('href')))
  ok(navLinks.length >= 1 && navLinks.every(h => /^\/fr\/(tarifs|plateforme|metiers|aide)$/.test(h)), 'en-tête : pages publiques seulement', navLinks)
  const hrefs = Array.from(new Set(await p.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('#')[0]))))
  const dead = []
  for (const h of hrefs) { const r = await v.ctx.request.get(BASE + h, { maxRedirects: 0 }).catch(() => null); if (!r || r.status() >= 400) dead.push(`${h} ${r && r.status()}`) }
  ok(dead.length === 0, `aucun lien mort (${hrefs.length} liens internes)`, dead)
  // Captures : chargées, texte de remplacement ; cartes de la scène dans les marges seulement (masquées à 1440 px)
  const imgs = await p.locator('.scene img').evaluateAll(is => is.map(i => [i.alt, i.naturalWidth, i.currentSrc.includes('webp') || i.currentSrc.includes('/_next/image')]))
  ok(imgs.length === 2 && imgs.every(([alt, w]) => alt && w > 0), 'captures chargées, avec texte de remplacement', imgs)
  ok(!(await p.locator('.float.f1').isVisible()) && !(await p.locator('.float.f3').isVisible()) && await p.locator('.float.f2').isVisible(), '1440 px : seule la carte du haut reste (les autres sortiraient de l\'écran)')
  // Métadonnées : titre, description, langues
  ok(/StockShop/.test(await p.title()) && /30 jours/.test(await p.locator('meta[name="description"]').getAttribute('content')), 'titre et description de la page', await p.title())
  const alt = await p.locator('link[rel="alternate"][hreflang]').evaluateAll(ls => ls.map(l => l.getAttribute('hreflang')))
  ok(['fr', 'en', 'ha'].every(l => alt.includes(l)), 'versions fr / en / ha déclarées', alt)
  // Polices servies par le site lui-même (jamais Google : la construction en dépendait et a échoué le 6 nov. 2026)
  const fonts = await p.evaluate(async () => {
    await document.fonts.ready
    const files = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.woff2|fonts\.(googleapis|gstatic)/.test(n))
    return { files, title: document.fonts.check('800 40px "Montserrat Site"'), text: document.fonts.check('400 16px "Noto Sans Site"'), h1: getComputedStyle(document.querySelector('h1')).fontFamily }
  })
  ok(fonts.title && fonts.text && /Montserrat Site/.test(fonts.h1), 'polices du site chargées (titres Montserrat, texte Noto Sans)', fonts)
  // (le nom « StockShop » du logo garde sa police next/font, elle aussi servie par le site : /_next/static/media)
  ok(fonts.files.some(f => f === BASE + '/fonts/noto-sans-latin.woff2') && fonts.files.some(f => f === BASE + '/fonts/montserrat-latin.woff2')
    && fonts.files.every(f => f.startsWith(BASE + '/')) && !fonts.files.some(f => /latin-ext/.test(f)), 'polices servies par le site, aucune par Google ; le jeu étendu n\'est pas chargé en français', fonts.files)
  ok(norm(await p.getByTestId('site-price-from').innerText()) === '5 000 F CFA', 'prix de départ du Cameroun : 5 000 F CFA', await p.getByTestId('site-price-from').innerText())
  ok(/1 boutique/.test(all) && /2 boutiques/.test(all) && /3 boutiques/.test(all), 'formules : boutiques lues dans les règles (1 / 2 / 3)')
  await p.screenshot({ path: OUT + '/site-home-pc.png' })

  console.log('\n2. Langue et thème (ordinateur)')
  await p.getByTestId('site-lang').click(); await wait(300)
  const langs = norm(await p.getByTestId('site-lang-list').innerText())
  ok(langs === 'Français English Hausa', `menu des langues : « ${langs} »`)
  await p.getByTestId('site-theme').click(); await wait(300)
  ok(await p.evaluate(() => document.documentElement.classList.contains('dark')), 'thème : mode sombre appliqué')
  const bg = await p.locator('.mk').evaluate(e => getComputedStyle(e).backgroundColor)
  ok(bg === 'rgb(9, 21, 36)', 'mode sombre : fond du site sombre', bg)
  await p.getByTestId('site-theme').click(); await wait(200)
  await p.getByTestId('site-lang').click(); await wait(200)
  await Promise.all([p.waitForURL(/\/en$/, { timeout: 60000 }), p.getByTestId('site-lang-list').getByText('English').click()])
  await wait(1500)
  ok(norm(await p.locator('h1').innerText()) === 'All your shops. One system. The full picture.', 'English : même page dans l\'autre langue')
  const cookie = (await v.ctx.cookies()).find(c => c.name === 'NEXT_LOCALE')
  ok(cookie && cookie.value === 'en', 'choix de langue retenu (cookie)', cookie && cookie.value)
  ok(v.errors.length === 0 && v.sent.length === 0, `aucune erreur JS, aucun envoi (${v.sent.length})`, { errors: v.errors, sent: v.sent })
  await v.browser.close()

  console.log('\n3. Prix de départ selon le pays')
  v = await visit({ locale: 'en', geo: 'NG' })
  ok(norm(await v.page.getByTestId('site-price-from').innerText()) === '₦5,000', 'Nigeria : ₦5,000', await v.page.getByTestId('site-price-from').innerText())
  await v.browser.close()
  v = await visit({ locale: 'fr', geo: null })
  ok(norm(await v.page.getByTestId('site-price-from').innerText()) === '5 000 F CFA', 'pays inconnu, français : Cameroun')
  await v.browser.close()

  console.log('\n4. Téléphone')
  const wide = []
  for (const width of [320, 390]) for (const locale of ['fr', 'en', 'ha']) for (const path of ['', '/tarifs']) {
    v = await visit({ locale, width, height: 760, path })
    const w = await v.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (w[0] > w[1]) wide.push(`${locale}${path} ${width} : ${w[0]}`)
    if (v.errors.length) wide.push(`${locale}${path} ${width} : erreur JS ${v.errors[0]}`)
    await v.browser.close()
  }
  ok(wide.length === 0, 'rien ne dépasse de l\'écran (320 et 390 px, fr / en / ha, accueil et tarifs)', wide)
  v = await visit({ width: 390, height: 844 }); p = v.page
  const sticky = p.getByTestId('site-sticky-trial')
  ok(await sticky.getAttribute('aria-hidden') === 'true', 'bouton d\'essai collant caché en haut de page (le bouton du haut suffit)')
  await p.mouse.wheel(0, 1600); await wait(800)
  ok(await sticky.getAttribute('aria-hidden') === 'false' && /Essayer gratuitement 30 jours/.test(await sticky.innerText()), 'après le haut de page : « Essayer gratuitement 30 jours » collé en bas')
  const sh = await sticky.locator('a').evaluate(e => e.getBoundingClientRect().height)
  ok(sh >= 44, `bouton collant de ${sh} px (≥ 44)`)
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300)
  ok(!(await p.getByTestId('site-lang').isVisible()) && !(await p.getByTestId('site-login').isVisible()), 'en-tête du téléphone : logo et menu seulement')
  await p.getByTestId('site-menu-toggle').click(); await wait(300)
  const mm = norm(await p.getByTestId('site-mmenu').innerText())
  ok(/Tarifs/.test(mm) && /Langue Français/.test(mm) && /Mode clair/.test(mm) && /Mode sombre/.test(mm) && /Essayer gratuitement 30 jours/.test(mm) && /Se connecter/.test(mm), 'menu : pages, « Langue : Français », thème, essai, connexion', mm)
  const bodyLocked = await p.evaluate(() => document.body.style.overflow)
  ok(bodyLocked === 'hidden', 'menu ouvert : la page derrière ne défile pas')
  await p.keyboard.press('Escape'); await wait(200)
  ok(!(await p.getByTestId('site-mmenu').count()), 'Échap ferme le menu')
  await p.screenshot({ path: OUT + '/site-home-phone.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'téléphone : aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()
  v = await visit({ locale: 'ha', width: 390, height: 844 })
  ok(norm(await v.page.locator('h1').innerText()) === 'Duk kantunanku. Tsari ɗaya. Cikakken hoto.', 'haoussa : titre', await v.page.locator('h1').innerText())
  const haFonts = await v.page.evaluate(async () => { await document.fonts.ready; return performance.getEntriesByType('resource').map(e => e.name).filter(n => /latin-ext/.test(n)) })
  ok(haFonts.some(f => /montserrat-latin-ext/.test(f)), 'haoussa : jeu étendu chargé pour ɗ ƙ ɓ (titres dans la bonne police)', haFonts)
  await v.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
