// Lot D du 7 nov. 2026 : page Tarifs restylée (formule + durée transmises, questions fréquentes selon le pays), page Aide
// publique, inscription « Vous avez choisi ». LECTURE SEULE : visiteur sans compte, toute écriture interceptée (aucun
// compte créé), /api/geo simulé.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/landing-help-offer-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

async function visit({ locale = 'fr', path = '/tarifs', geo = 'CM', width = 1440, height = 900, storage = null }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const mobile = width < 500
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: locale === 'fr' ? 'fr-FR' : 'en-US', serviceWorkers: 'block' })
  if (storage) await ctx.addInitScript(v => { try { localStorage.setItem('stockshop_chosen_offer', v) } catch {} }, storage)
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
  const res = await page.goto(`${BASE}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 120000 }); await wait(1500)
  return { browser, ctx, page, errors, sent, status: res && res.status() }
}
const deadLinks = async v => {
  const hrefs = Array.from(new Set(await v.page.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('#')[0].split('?')[0]))))
  const dead = []
  for (const h of hrefs) { const r = await v.ctx.request.get(BASE + h, { maxRedirects: 0 }).catch(() => null); if (!r || r.status() >= 400) dead.push(`${h} ${r && r.status()}`) }
  return { dead, n: hrefs.length }
}

;(async () => {
  console.log('1. Tarifs (Cameroun)')
  let v = await visit({}); let p = v.page
  ok(v.status === 200 && await p.getByTestId('site-nav-pricing').getAttribute('aria-current') === 'page', 'page servie, « Tarifs » page en cours')
  const href = id => p.getByTestId(`landing-cta-${id}`).getAttribute('href')
  ok(await href('pro') === '/fr/register?plan=pro&period=monthly', 'Pro : inscription avec formule et durée (mensuel)', await href('pro'))
  await p.getByTestId('landing-period-annual').click(); await wait(300)
  ok(await href('pro') === '/fr/register?plan=pro&period=annual' && await href('business') === '/fr/register?plan=business&period=annual', 'durée 1 an : les liens suivent', [await href('pro'), await href('business')])
  const faq = p.getByTestId('pricing-faq')
  ok(await faq.locator('details').count() === 4, 'questions fréquentes : 4 (celles de la page Abonnement)')
  const pay = norm(await faq.locator('details').nth(2).innerText())
  await faq.locator('details').nth(2).locator('summary').click(); await wait(200)
  const payOpen = norm(await faq.locator('details').nth(2).innerText())
  ok(/NotchPay/.test(payOpen) && /MTN/.test(payOpen) && /Cameroun/.test(payOpen), 'paiement : passerelle et moyens du Cameroun', payOpen.slice(0, 200))
  await p.screenshot({ path: OUT + '/site-pricing-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  const d1 = await deadLinks(v)
  ok(d1.dead.length === 0, `aucun lien mort (${d1.n})`, d1.dead)
  await v.browser.close()
  v = await visit({ geo: 'FR' }); p = v.page
  await p.getByTestId('pricing-faq').locator('details').nth(2).locator('summary').click(); await wait(200)
  const payFr = norm(await p.getByTestId('pricing-faq').locator('details').nth(2).innerText())
  ok(/pas encore ouvert/.test(payFr) && /France/.test(payFr) && !/Stripe/.test(payFr), 'France : paiement en ligne pas encore ouvert, dit clairement (jamais Stripe)', payFr.slice(0, 200))
  await v.browser.close()

  console.log('\n2. Aide')
  v = await visit({ path: '/aide' }); p = v.page
  ok(v.status === 200 && norm(await p.locator('h1').innerText()) === 'Questions fréquentes', 'page servie, titre')
  ok(await p.getByTestId('site-nav-help').getAttribute('aria-current') === 'page', 'en-tête : « Aide » page en cours')
  const groups = await p.locator('.help-group h2').allInnerTexts()
  ok(groups.join('|') === 'Commencer|Au quotidien|Abonnement', 'trois groupes de questions', groups)
  ok(await p.locator('.help-faq details').count() === 10, '10 questions')
  const shopsQ = p.locator('.help-faq details', { hasText: 'plusieurs boutiques' })
  await shopsQ.locator('summary').click(); await wait(200)
  const shopsA = norm(await shopsQ.innerText())
  ok(/1 boutique avec Starter, 2 boutiques avec Pro, 3 boutiques avec Business/.test(shopsA), 'boutiques par formule lues dans les règles', shopsA)
  const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().textContent())
  ok(ld['@type'] === 'FAQPage' && ld.mainEntity.length === 10 && ld.mainEntity.every(q => q.name && q.acceptedAnswer.text), 'données structurées FAQPage (10 questions)')
  ok(await p.getByTestId('help-contact').locator('a[href="mailto:support@stockshop.tech"]').count() === 1, 'contact : écrire au support')
  const all = norm(await p.locator('main').innerText())
  ok(!/WhatsApp support|assuran|bilan du matin/i.test(all), 'aucune promesse non tenue (WhatsApp du support, assurances, bilan du matin)')
  const d2 = await deadLinks(v)
  ok(d2.dead.length === 0, `aucun lien mort (${d2.n})`, d2.dead)
  await p.screenshot({ path: OUT + '/site-help-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()

  console.log('\n3. Inscription : formule choisie')
  v = await visit({ path: '/register?plan=pro&period=annual' }); p = v.page
  const side = norm(await p.getByTestId('register-trial-side').innerText().catch(() => ''))
  ok(/Vous avez choisi : Pro, 1 an/.test(side) && /Ce que contient l'essai/.test(side) && /2 boutiques/.test(side), 'ordinateur : « Vous avez choisi : Pro, 1 an » et contenu de l\'essai à côté du formulaire', side.slice(0, 200))
  ok(/Pro \(1 an\) vous sera proposé en premier/.test(side) && /Rien n'est prélevé automatiquement/.test(side), 'fin de l\'essai expliquée')
  const stored = await p.evaluate(() => localStorage.getItem('stockshop_chosen_offer'))
  ok(stored === '{"plan":"pro","period":"annual"}', 'choix gardé sur l\'appareil (inscription avec Google)', stored)
  await p.screenshot({ path: OUT + '/site-register-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()
  v = await visit({ path: '/register?plan=gratuit&period=toujours' })
  ok(await v.page.getByTestId('register-chosen-offer').count() === 0 && /Ce que contient l'essai/.test(norm(await v.page.getByTestId('register-trial-side').innerText())), 'formule inconnue dans l\'adresse : ignorée, contenu de l\'essai seul')
  await v.browser.close()
  v = await visit({ path: '/register', width: 390, height: 844, storage: '{"plan":"business","period":"semiannual"}' }); p = v.page
  const top = norm(await p.getByTestId('register-trial-top').innerText().catch(() => ''))
  ok(/Vous avez choisi : Business, 6 mois/.test(top), 'téléphone : choix gardé sur l\'appareil affiché au-dessus du formulaire', top.slice(0, 120))
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  ok(w[0] <= w[1], 'téléphone : rien ne dépasse', w)
  await p.screenshot({ path: OUT + '/site-register-phone.png' })
  await v.browser.close()

  console.log('\n4. Téléphone (Tarifs et Aide)')
  const wide = []
  for (const width of [320, 390]) for (const locale of ['fr', 'en', 'ha']) for (const path of ['/tarifs', '/aide']) {
    v = await visit({ locale, width, height: 760, path })
    const ww = await v.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (ww[0] > ww[1]) wide.push(`${locale}${path} ${width} : ${ww[0]}`)
    if (v.errors.length) wide.push(`${locale}${path} ${width} : erreur JS ${v.errors[0]}`)
    await v.browser.close()
  }
  ok(wide.length === 0, 'rien ne dépasse (320 et 390 px, fr / en / ha)', wide)
  v = await visit({ locale: 'ha', path: '/aide' })
  ok(norm(await v.page.locator('h1').innerText()) === 'Tambayoyin da aka fi yi', 'haoussa : titre de l\'Aide')
  await v.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
