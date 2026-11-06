// Pages de tarifs (tarification étape 4B). LECTURE SEULE, serveur local ; toute écriture est interceptée.
//   1-5. Page d'accueil (visiteur sans compte) : pays de départ (hébergeur simulé via /api/geo, sinon langue), durées
//        avec le prix de la durée, options du pays, « Comparer les formules » replié, Europe = paiement bientôt
//        ouvert (plus de Stripe), téléphone sans défilement horizontal, anglais et haoussa.
//   6. /api/geo réel : pays seulement, jamais mis en cache.
//   7. Page Abonnement (Marché Soleil, propriétaire) : mêmes lignes que l'accueil, « formule », date sur le bouton
//      d'une formule moins chère (formule Pro payée SIMULÉE), paiement pas encore ouvert dit avant le clic (pays simulé).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/landing-pricing-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const DAY = 86400000
const PRO_LINES_FR = ['2 boutiques', 'Produits illimités', '5 employés + propriétaire', 'Transferts entre boutiques', 'Bons de commande envoyés au fournisseur', 'Exports Excel et historique sur 1 an']

// Visiteur sans compte ; /api/geo simulé (pays de l'hébergeur) ; toute écriture interceptée
async function visit({ locale = 'fr', geo = null, width = 1366, height = 900 }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width, height }, locale: locale === 'fr' ? 'fr-FR' : 'en-US', serviceWorkers: 'block' })
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
  await page.goto(`${BASE}/${locale}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(5000)
  await page.locator('#pricing').scrollIntoViewIfNeeded().catch(() => {}); await wait(1500)
  return { browser, page, errors, sent }
}
const text = async (page, id) => norm(await page.getByTestId(id).first().innerText().catch(() => ''))

;(async () => {
  console.log('1. Accueil en français, pays inconnu : Cameroun, prix au mois')
  let v = await visit({})
  let p = v.page
  ok(/10 000/.test(await text(p, 'landing-price-pro')) && /5 000/.test(await text(p, 'landing-price-starter')) && /15 000/.test(await text(p, 'landing-price-business')), 'prix Cameroun 5 000 / 10 000 / 15 000', [await text(p, 'landing-price-starter'), await text(p, 'landing-price-pro')])
  ok(/MTN MoMo/.test(await text(p, 'landing-pay-methods')) && await p.getByTestId('landing-pay-soon').count() === 0, 'moyens de paiement du Cameroun')
  const proCard = await text(p, 'landing-plan-pro')
  ok(PRO_LINES_FR.every(l => proCard.includes(l)), 'carte Pro : les 6 lignes, dont transferts, bons de commande, exports', proCard)
  ok(/Tout le Pro/.test(await text(p, 'landing-plan-business')) && /Historique illimité/.test(await text(p, 'landing-plan-business')), 'carte Business : tout le Pro, historique illimité')
  ok(await p.getByTestId('landing-period-monthly').getAttribute('aria-checked') === 'true', 'durée « Mensuel » choisie au départ')
  const add = await text(p, 'landing-addons')
  ok(/1 500/.test(add) && /4 000/.test(add), 'options : employé 1 500, boutique 4 000', add)
  ok(/tout le Pro/.test(await text(p, 'landing-pricing-note')), 'phrase : essai avec tout le Pro')
  await p.screenshot({ path: OUT + '/pricing-landing-month.png' })

  console.log('\n2. Durées : prix de la durée et équivalent par mois')
  await p.getByTestId('landing-period-semiannual').click(); await wait(400)
  let pro = await text(p, 'landing-plan-pro')
  ok(/55 000/.test(await text(p, 'landing-price-pro')) && /\/6 mois/.test(pro), '6 mois : 55 000 / 6 mois', pro.slice(0, 120))
  ok(/2 semaines offertes · soit 9 167/.test(pro), '6 mois : 2 semaines offertes, soit 9 167 par mois', pro.slice(0, 160))
  await p.getByTestId('landing-period-annual').click(); await wait(400)
  pro = await text(p, 'landing-plan-pro')
  ok(/100 000/.test(await text(p, 'landing-price-pro')) && /2 mois offerts · soit 8 333/.test(pro), '1 an : 100 000, 2 mois offerts, soit 8 333 par mois', pro.slice(0, 160))
  ok(await p.getByTestId('landing-period-annual').getAttribute('aria-checked') === 'true', 'durée choisie signalée (aria-checked)')
  await p.getByTestId('landing-pricing-note').scrollIntoViewIfNeeded()
  await p.getByTestId('landing-period').scrollIntoViewIfNeeded(); await wait(300)
  await p.screenshot({ path: OUT + '/pricing-landing-annual.png' })

  console.log('\n3. Comparer les formules : replié, puis ouvert')
  const tog = p.getByTestId('landing-compare-toggle')
  ok(await p.getByTestId('landing-compare').count() === 0 && await tog.getAttribute('aria-expanded') === 'false', 'replié par défaut')
  await tog.click(); await wait(400)
  ok(await tog.getAttribute('aria-expanded') === 'true' && await p.locator('[data-testid^="landing-compare-"][data-testid$="shops"], [data-testid="landing-compare"] tbody tr').count() >= 8, 'ouvert : 8 lignes')
  ok(/Boutiques 1 2 3/.test(await text(p, 'landing-compare-shops')), 'boutiques 1 / 2 / 3', await text(p, 'landing-compare-shops'))
  ok(/2 5 8/.test(await text(p, 'landing-compare-seats')), 'employés 2 / 5 / 8', await text(p, 'landing-compare-seats'))
  ok(/3 mois 1 an Illimité/.test(await text(p, 'landing-compare-history')), 'historique 3 mois / 1 an / illimité', await text(p, 'landing-compare-history'))
  ok(/Non inclus Inclus Inclus/.test(await text(p, 'landing-compare-transfers')) && /Non inclus Non inclus Inclus/.test(await text(p, 'landing-compare-support')), 'transferts dès Pro, support prioritaire en Business (lu par les lecteurs d\'écran)')
  await p.getByTestId('landing-compare').scrollIntoViewIfNeeded(); await wait(300)
  await p.screenshot({ path: OUT + '/pricing-landing-compare.png' })
  ok(!/Stripe/.test(norm(await p.locator('body').innerText())), 'Stripe n\'apparaît nulle part')
  ok(v.errors.length === 0 && v.sent.length === 0, `aucune erreur JS, rien envoyé (${v.errors.join(' | ')}${v.sent.join(',')})`)
  await v.browser.close()

  console.log('\n4. Visiteur en France (pays de l\'hébergeur) : prix en euros, paiement bientôt ouvert')
  v = await visit({ geo: 'FR' }); p = v.page
  ok(/25/.test(await text(p, 'landing-price-pro')) && /€/.test(await text(p, 'landing-price-pro')), 'Pro 25 €', await text(p, 'landing-price-pro'))
  const soon = await text(p, 'landing-pay-soon')
  ok(/ce pays \(France\)/.test(soon) &&/Visa \/ Mastercard/.test(soon) && /bientôt/.test(soon) && await p.getByTestId('landing-pay-methods').count() === 0, 'paiement par carte bientôt ouvert pour la France', soon)
  ok(/5/.test(await text(p, 'landing-addons')) && /12/.test(await text(p, 'landing-addons')), 'options en euros (5 / 12)', await text(p, 'landing-addons'))
  await p.getByTestId('landing-period').scrollIntoViewIfNeeded(); await wait(300)
  await p.screenshot({ path: OUT + '/pricing-landing-france.png' })
  ok(v.errors.length === 0, `aucune erreur JS (${v.errors.join(' | ')})`)
  await v.browser.close()

  console.log('\n5. Téléphone, anglais, haoussa')
  v = await visit({ width: 375, height: 812 }); p = v.page
  // La section Tarifs n'élargit jamais la page ; l'en-tête tient en largeur (thème, puis langue sous 360 px, dans le menu)
  const pageW = () => p.evaluate(() => document.documentElement.scrollWidth)
  const before = await pageW()
  ok(before === 375, `téléphone : la page ne défile pas de côté (${before})`)
  await p.getByTestId('landing-compare-toggle').click(); await wait(400)
  const sw = [await pageW(), before]
  ok(sw[0] <= sw[1], 'téléphone : le tableau ouvert n\'élargit pas la page', sw)
  const out = await p.evaluate(() => Array.from(document.querySelectorAll('#pricing *')).filter(e => {
    const r = e.getBoundingClientRect(); if (!r.width) return false
    let a = e.parentElement; while (a && a.id !== 'landing-compare') a = a.parentElement
    return !a && r.right > document.documentElement.clientWidth + 1
  }).length)
  ok(out === 0, 'téléphone : rien de la section Tarifs ne sort de l\'écran', out)
  const tbl = await p.getByTestId('landing-compare').evaluate(e => [e.scrollWidth, e.clientWidth, getComputedStyle(e).overflowX])
  ok(tbl[2] === 'auto', 'téléphone : le tableau défile dans son cadre', tbl)
  const h = await p.getByTestId('landing-period-semiannual').evaluate(e => e.getBoundingClientRect().height)
  ok(h >= 40, `téléphone : boutons de durée de 40 px au moins (${h})`)
  await p.getByTestId('landing-period').scrollIntoViewIfNeeded(); await wait(300)
  await p.screenshot({ path: OUT + '/pricing-landing-phone.png' })
  await v.browser.close()
  // En-tête sur petits téléphones, dans les trois langues : rien ne dépasse
  const wide = []
  for (const width of [320, 360]) for (const locale of ['fr', 'en', 'ha']) {
    v = await visit({ locale, width, height: 700 }); p = v.page
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (w[0] > w[1]) wide.push(`${locale} ${width} : ${w[0]}`)
    if (width === 320 && locale === 'fr') {
      const t = p.getByTestId('landing-menu-toggle')
      ok(await t.getAttribute('aria-label') === 'Ouvrir le menu' && await t.getAttribute('aria-expanded') === 'false', 'menu : nom accessible et état fermé')
      await t.click(); await wait(300)
      ok(await t.getAttribute('aria-label') === 'Fermer le menu' && await t.getAttribute('aria-expanded') === 'true', 'menu ouvert : « Fermer le menu »')
      ok(await p.getByTestId('landing-menu-theme').isVisible() && /Mode sombre|Mode clair/.test(await p.getByTestId('landing-menu-theme').innerText()), '320 px : thème dans le menu')
      const langs = await p.getByTestId('landing-menu-languages').innerText().catch(() => '')
      ok(await p.getByTestId('landing-menu-languages').isVisible() && /English/.test(langs) && /Français/.test(langs) && /Hausa/.test(langs), '320 px : langues dans le menu', langs)
      await p.screenshot({ path: OUT + '/pricing-landing-phone320-menu.png', clip: { x: 0, y: 0, width: 320, height: 380 } })
    }
    if (width === 360 && locale === 'fr') {
      ok(!(await p.getByTestId('landing-menu-theme').count()), '360 px : menu fermé, thème rangé dedans')
      ok(await p.getByRole('button', { name: 'Langue' }).isVisible(), "360 px : langue dans l'en-tête, avec son nom accessible")
    }
    await v.browser.close()
  }
  ok(wide.length === 0, "en-tête : aucune page plus large que l'écran (320 et 360 px, fr / en / ha)", wide)
  v = await visit({ locale: 'en' }); p = v.page
  ok(/10,000/.test(await text(p, 'landing-price-pro')) && /Paystack/.test(await text(p, 'landing-pay-methods')), 'anglais sans pays connu : Nigeria', await text(p, 'landing-price-pro'))
  ok(/Compare plans/.test(await text(p, 'landing-compare-toggle')) && /Transfers between shops/.test(await text(p, 'landing-plan-pro')), 'anglais : textes')
  ok(v.errors.length === 0, `aucune erreur JS (${v.errors.join(' | ')})`)
  await v.browser.close()
  v = await visit({ locale: 'ha', geo: 'NE' }); p = v.page
  ok(/Kwatanta shirye-shirye/.test(await text(p, 'landing-compare-toggle')) && /Tura kaya tsakanin kantuna/.test(await text(p, 'landing-plan-pro')), 'haoussa : textes')
  ok(/Flutterwave/.test(await text(p, 'landing-pay-methods')), 'Niger (hébergeur) : Flutterwave', await text(p, 'landing-pay-methods'))
  ok(v.errors.length === 0, `aucune erreur JS (${v.errors.join(' | ')})`)
  await v.browser.close()

  console.log('\n6. /api/geo réel')
  const res = await fetch(`${BASE}/api/geo`)
  const body = await res.json().catch(() => null)
  ok(res.status === 200 && body && Object.keys(body).join() === 'country', 'réponse : le pays seulement', body)
  ok(/no-store/.test(res.headers.get('cache-control') || ''), 'jamais mis en cache', res.headers.get('cache-control'))
  // En local, pas d'hébergeur donc pas de pays ; en ligne, Vercel donne le pays du visiteur (2 lettres)
  if (/localhost|127\.0\.0\.1/.test(BASE)) ok(body.country === null, 'serveur local : pays inconnu (pas d\'hébergeur)', body)
  else ok(/^[A-Z]{2}$/.test(body.country || ''), `en ligne : pays donné par l'hébergeur (${body.country})`, body)

  console.log('\n7. Page Abonnement (formule Pro payée simulée, rien n\'est envoyé)')
  const until = new Date(Date.now() + 20 * DAY).toISOString()
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: 'ghislainx123@gmail.com' })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request(), u = new URL(r.url())
    if (r.method() === 'GET' && u.pathname === '/api/billing/terms') {
      const rr = await route.fetch(); const b = await rr.json().catch(() => ({}))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...b, locked: {}, limits: null, pending: null, pricing: { country: 'FR', reason: 'override', declared: 'CM', activity_share: 0 } }) })
    }
    if (r.method() === 'GET' && u.pathname === '/rest/v1/entities' && /plan_expires_at/.test(u.searchParams.get('select') || '')) {
      const rr = await route.fetch(); let rows = await rr.json().catch(() => null)
      if (Array.isArray(rows)) rows = rows.map(e => ({ ...e, plan: 'pro', plan_expires_at: until, is_internal: false, next_plan: null, next_plan_from: null, next_plan_until: null }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    const w = `${r.method()} ${u.pathname}`
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles', 'POST /api/reports/margin', 'POST /api/team/status'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  const page = s.page
  await page.goto(`${BASE}/fr/billing`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
  const bodyText = norm(await page.locator('main').innerText().catch(() => ''))
  ok(/Changer de formule/.test(bodyText) && /Formule actuelle/.test(bodyText) && !/Changer de plan|Plan actuel/.test(bodyText), '« formule » partout', bodyText.slice(0, 200))
  const proBox = norm(await page.getByTestId('billing-renew-pro').locator('xpath=..').innerText().catch(() => ''))
  ok(PRO_LINES_FR.every(l => proBox.includes(l)), 'carte Pro : mêmes lignes que l\'accueil', proBox.slice(0, 300))
  const down = norm(await page.getByTestId('billing-choose-starter').innerText().catch(() => ''))
  const longFr = new Date(until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  ok(down === `Passer à Starter le ${longFr}`, `formule moins chère : « Passer à Starter le ${longFr} »`, down)
  ok(norm(await page.getByTestId('billing-choose-business').innerText().catch(() => '')) === 'Passer à Business', 'formule supérieure : « Passer à Business »')
  const ps = norm(await page.getByTestId('billing-pay-soon').innerText().catch(() => ''))
  ok(/votre pays \(France\)/.test(ps) && /support@stockshop\.tech/.test(ps), 'paiement pas encore ouvert : dit au-dessus des formules, avant tout clic', ps)
  // Tarif du pays + paiement pas encore ouvert : un seul encadré, une seule invitation à écrire
  const notice = page.getByTestId('billing-notice')
  const nt = norm(await notice.innerText().catch(() => ''))
  ok(await notice.count() === 1 && await notice.getByTestId('billing-pricing-country').count() === 1 && await notice.getByTestId('billing-pay-soon').count() === 1,
    'un seul encadré : tarif du pays et paiement', nt)
  ok(nt.startsWith('Tarif de France, fixé par notre équipe.') && !/Contactez-nous/.test(nt), 'pas de « Contactez-nous » en double', nt)
  await page.getByTestId('billing-period').scrollIntoViewIfNeeded().catch(() => {}); await wait(400)
  await page.screenshot({ path: OUT + '/pricing-billing.png' })
  await page.getByTestId('billing-period').getByText('6 mois').click().catch(() => {}); await wait(500)
  ok(/2 semaines offertes/.test(norm(await page.getByTestId('billing-period-note').first().innerText().catch(() => ''))), 'Abonnement : durées lues dans les textes communs')
  ok(errors.length === 0 && sent.length === 0, `aucune erreur JS, rien envoyé (${errors.join(' | ')}${sent.join(',')})`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
