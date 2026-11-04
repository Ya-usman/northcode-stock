// Offre sur mesure (4 nov. 2026, étape 3). LECTURE SEULE, serveur local ; toute écriture est interceptée.
// Simulés : demandes et devis (réponses de /api/billing/custom, /api/billing/custom/quote, /api/admin/custom-quotes) ;
// envois (demande, paiement, devis) interceptés pour vérifier ce que l'écran envoie (jamais de montant).
// Comptes : Marché Soleil (propriétaire), Jean-Paul (gérant), admin@northcode.ng (administration).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/custom-plan-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const m = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const TOKEN = 'tok_TestDevisSurMesure_0123456789'
const iso = d => new Date(Date.now() + d * 86400000).toISOString()
const QUOTED = { id: 'q1', state: 'quoted', req_shops: 5, req_seats: 12, currency: 'XOF', monthly_price: 29000, limit_shops: 5, limit_seats: 12, decline_reason: null, valid_until: iso(12), price_until: null, token: TOKEN, created_at: iso(-1) }
const QUOTE_PAGE = (over = {}) => ({
  quote: { state: 'quoted', monthly_price: 29000, billing_period: 'annual', period_total: 290000, currency: 'XOF', limit_shops: 5, limit_seats: 12, client_note: 'Merci pour votre confiance.', valid_until: iso(12), price_until: null, ...over },
  entity: { name: 'Marché Soleil' }, payable: over.state === 'expired' ? null : 'first',
})

async function open({ email = 'ghislainx123@gmail.com', mocks = {}, path = '/billing', width = 1366, height = 900 }) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []; const posts = []; const real = []
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request(), u = new URL(r.url()), w = `${r.method()} ${u.pathname}`
    if (mocks[w] !== undefined) {
      if (r.method() !== 'GET') posts.push({ w, body: JSON.parse(r.postData() || '{}') })
      const v = typeof mocks[w] === 'function' ? mocks[w](u) : mocks[w]
      return route.fulfill({ status: v.status || 200, contentType: 'application/json', body: JSON.stringify(v.body ?? v) })
    }
    if (w === 'GET /api/billing/custom' && mocks.realCustom) { const res = await route.fetch(); real.push(res.status()); return route.fulfill({ response: res }) }
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    if (['POST /api/reports/margin', 'POST /api/team/status'].includes(w)) return route.fallback()
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  return { ...s, errors, sent, posts, real }
}

;(async () => {
  console.log('1. Page Abonnement : carte « Sur mesure » et demande de devis')
  let s = await open({ mocks: { 'GET /api/billing/custom': { quotes: [], current: null }, 'POST /api/billing/custom': { ok: true, id: 'q-new' } } }); let page = s.page
  const sec = page.getByTestId('custom-plan-section')
  await sec.scrollIntoViewIfNeeded()
  ok(await sec.isVisible() && norm(await sec.innerText()).includes('À partir de 4 boutiques') && norm(await sec.innerText()).includes('Prix garanti 1 an'), 'carte « Sur mesure · À partir de 4 boutiques »')
  await page.getByTestId('custom-request-open').click(); await wait(900)
  const drawer = page.getByTestId('custom-request-drawer')
  ok(await drawer.isVisible(), '« Demander un devis » : formulaire')
  await page.getByTestId('custom-shops').fill('3'); await page.getByTestId('custom-seats').fill('10'); await wait(300)
  ok(await page.getByTestId('custom-too-small').isVisible() && await drawer.getByRole('button', { name: m.custom_quote.send }).isDisabled(), '3 boutiques et 10 employés : formules et options suffisent, envoi désactivé')
  await page.getByTestId('custom-shops').fill('5'); await page.getByTestId('custom-seats').fill('12')
  await page.locator('#custom-needs').fill('Deux dépôts'); await wait(300)
  await page.screenshot({ path: OUT + '/custom-form.png' })
  await drawer.getByRole('button', { name: m.custom_quote.send }).click(); await wait(1500)
  const p0 = s.posts[0]?.body || {}
  ok(p0.shops === 5 && p0.seats === 12 && p0.period === 'annual' && p0.needs === 'Deux dépôts', 'envoyé : 5 boutiques, 12 employés, 1 an, besoins', p0)
  ok(await page.getByTestId('custom-request-sent').isVisible(), '« Demande reçue »')
  ok(s.sent.length === 0 && s.errors.length === 0, `aucune autre écriture ni erreur JS (${[...s.sent, ...s.errors].join(' | ') || 'aucune'})`)
  await s.browser.close()

  console.log('\n2. Devis reçu, puis page du devis et paiement')
  s = await open({ mocks: { 'GET /api/billing/custom': { quotes: [QUOTED], current: null } } }); page = s.page
  const st = page.getByTestId('custom-status')
  await st.scrollIntoViewIfNeeded()
  ok(norm(await st.innerText()).includes('Devis reçu : 29 000 F CFA par mois, valable jusqu'), `état : « ${norm(await st.innerText())} »`)
  await page.screenshot({ path: OUT + '/custom-status.png' })
  ok(await page.getByTestId('custom-request-open').count() === 0, 'devis en cours : pas de bouton « Demander un devis » (une seule demande à la fois)')
  await s.browser.close()
  s = await open({ path: `/billing/quote/${TOKEN}`, mocks: { 'GET /api/billing/custom/quote': QUOTE_PAGE(), 'POST /api/billing/custom/quote': { authorization_url: `${BASE}/fr/billing?paiement=simule` } } }); page = s.page
  const card = page.getByTestId('quote-card')
  ok(norm(await page.getByTestId('quote-limits').innerText()) === '5 boutiques, 12 employés' && norm(await page.getByTestId('quote-total').innerText()) === '290 000 F CFA', 'page du devis : 5 boutiques, 12 employés, total 290 000 F CFA')
  ok(norm(await card.innerText()).includes('Merci pour votre confiance') && norm(await card.innerText()).includes('Prix garanti 1 an'), 'message de l\'équipe et garantie affichés')
  await page.screenshot({ path: OUT + '/custom-quote-page.png' })
  await page.getByTestId('quote-pay').click(); await wait(2500)
  const p1 = s.posts[0]?.body || {}
  ok(p1.token === TOKEN && !('amount' in p1) && !('monthly_price' in p1), 'payer : seul le lien du devis est envoyé, AUCUN montant', p1)
  ok(/paiement=simule/.test(page.url()), 'redirigé vers le paiement')
  await s.browser.close()
  s = await open({ path: `/billing/quote/${TOKEN}`, mocks: { 'GET /api/billing/custom/quote': QUOTE_PAGE({ state: 'expired', valid_until: iso(-2) }) } }); page = s.page
  ok(await page.getByTestId('quote-expired').isVisible() && await page.getByTestId('quote-pay').count() === 0, 'devis expiré : message, pas de bouton « Payer »')
  await s.browser.close()
  s = await open({ path: `/billing/quote/${TOKEN}`, mocks: { 'GET /api/billing/custom/quote': { status: 404, body: { error: m.api_errors.custom_quote_not_found } } } }); page = s.page
  ok(norm(await page.getByTestId('quote-error').innerText()).includes('Devis introuvable'), 'lien inconnu ou devis d\'un autre compte : « Devis introuvable »')
  await s.browser.close()

  console.log('\n3. Administration : prix conseillé, devis, envoi')
  const LIST = { quotes: [{ id: 'q1', entity_name: 'Marché Soleil', state: 'requested', req_shops: 5, req_seats: 12, req_period: 'annual', monthly_price: null, currency: null, created_at: iso(0), valid_until: null, price_until: null }] }
  const DETAIL = {
    quote: { id: 'q1', state: 'requested', status: 'requested', req_shops: 5, req_seats: 12, req_period: 'annual', req_needs: 'Deux dépôts', req_phone: '+237600000000', created_at: iso(0) },
    entity: { name: 'Marché Soleil', plan: 'business', plan_expires_at: iso(300) }, used: { shops: 3, seats: 4 },
    pricing: { country: 'CM', country_name: 'Cameroun', currency: 'XAF', reason: 'declared' }, prices: { business: 15000, seat: 1500, shop: 4000 }, suggested_monthly: 29000,
  }
  s = await open({ email: 'admin@northcode.ng', path: '/admin/quotes', mocks: {
    'GET /api/admin/custom-quotes': u => (u.searchParams.get('id') ? DETAIL : LIST),
    'POST /api/admin/custom-quotes': { ok: true, email: 'sent', whatsapp: 'Bonjour, voici votre devis StockShop sur mesure…', link: `${BASE}/fr/billing/quote/${TOKEN}` },
  } }); page = s.page
  await page.getByTestId('custom-quote-row').first().click(); await wait(1500)
  ok(norm(await page.getByTestId('custom-suggested').innerText()).includes('Prix conseillé : 29 000 F CFA / mois'), 'prix conseillé : 29 000 F CFA par mois')
  ok(norm(await page.getByTestId('custom-total').innerText()) === '290 000 F CFA', 'total 1 an : 290 000 F CFA (10 mois payés)')
  await page.getByTestId('custom-monthly').fill('27000'); await wait(300)
  ok(norm(await page.getByTestId('custom-total').innerText()) === '270 000 F CFA' && norm(await page.getByTestId('custom-quote-drawer').innerText()).includes('remise de 7 %'), 'prix modifié : total recalculé, remise affichée')
  await page.screenshot({ path: OUT + '/custom-admin.png' })
  await page.getByTestId('custom-send').click(); await wait(2000)
  const p2 = s.posts.find(p => p.w === 'POST /api/admin/custom-quotes')?.body || {}
  ok(p2.action === 'send' && p2.monthly_price === 27000 && p2.billing_period === 'annual' && p2.limit_shops === 5 && p2.limit_seats === 12, 'envoyé : prix, durée et limites du devis', p2)
  ok(await page.getByTestId('custom-whatsapp').isVisible(), 'texte WhatsApp prêt à copier')
  ok(s.errors.length === 0, `aucune erreur JS (${s.errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n4. Page d\'accueil et accès réels')
  // Visiteur sans compte : navigateur sans session
  const { chromium } = require('playwright-core')
  const vb = await chromium.launch({ channel: 'msedge', headless: true })
  const vp = await (await vb.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-FR' })).newPage()
  await vp.goto(`${BASE}/fr`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(5000)
  const lc = vp.getByTestId('landing-custom')
  await lc.scrollIntoViewIfNeeded().catch(() => {})
  ok(await lc.count() === 1 && norm(await lc.innerText()).includes('Sur mesure · à partir de 4 boutiques'), 'accueil : carte « Sur mesure » (essai, puis devis dans l\'application)')
  await vp.screenshot({ path: OUT + '/custom-landing.png' })
  await vb.close()
  s = await open({ mocks: { realCustom: true } }); page = s.page
  ok(s.real[s.real.length - 1] === 200, `propriétaire : demandes lisibles (${s.real.join(',')})`)
  await s.browser.close()
  s = await open({ email: 'ghislainx123+jeanpaul@gmail.com', mocks: { realCustom: true } }); page = s.page
  ok(await page.getByTestId('custom-plan-section').count() === 0, `gérant : pas de section « Sur mesure » (${s.real.join(',') || 'page non accessible'})`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
