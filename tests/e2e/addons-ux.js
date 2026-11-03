// Options payantes sur la page Abonnement (3 nov. 2026, étape 2). LECTURE SEULE, serveur local, compte vitrine
// Marché Soleil (propriétaire) ; toute écriture est interceptée. L'état « Starter, 18 jours restants, 1 employé en
// plus » est SIMULÉ en remplaçant la réponse de GET /api/billing/addons ; l'achat et le retrait sont interceptés (on
// vérifie ce que l'écran envoie, aucun paiement n'est créé). La réponse réelle est contrôlée à part.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/addons-ux.js
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

const in18 = new Date(Date.now() + 18 * 86400000 - 3600000).toISOString() // 18 jours entamés
const STATE = (over = {}) => ({
  plan: 'starter', active: true, plan_expires_at: in18, billing_period: 'monthly', currency: 'XOF', prices: { seat: 1500, shop: 4000 },
  addons: { seats: 1, shops: 0, seats_renew: 1, shops_renew: 0 }, max: { seats: 20, shops: 2 }, min_days: 3,
  renewal: { monthly_addons: 1500, period_total: 6500 }, advice: null, ...over,
})

async function open({ email = 'ghislainx123@gmail.com', state, width = 1366, height = 900 }) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []; const posts = []; const real = []
  await s.page.route(/\/api\/billing\/addons/, async route => {
    const r = route.request()
    if (r.method() === 'POST') { posts.push(JSON.parse(r.postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, authorization_url: `${BASE}/fr/billing?paiement=simule` }) }) }
    if (!state) { const res = await route.fetch(); real.push({ status: res.status(), body: await res.json().catch(() => null) }); return route.fulfill({ response: res }) }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
  })
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    const w = `${r.method()} ${new URL(r.url()).pathname}`
    // Achat et retrait des options : interception dédiée plus haut (simulée, rien ne part)
    if (w === 'POST /api/billing/addons') return route.fallback()
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr/billing`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  return { ...s, errors, sent, posts, real }
}
const dialog = page => page.getByTestId('addons-buy-dialog')

;(async () => {
  console.log('1. Propriétaire, Starter simulé : section « Options »')
  let s = await open({ state: STATE() }); let page = s.page
  const card = page.getByTestId('addons-card')
  ok(await card.isVisible(), 'section « Options » affichée')
  ok(norm(await page.getByTestId('addons-paid-seats').innerText()) === '1 payé', 'employés en plus : « 1 payé »')
  ok(await page.getByTestId('addons-row-shops').count() === 1, 'boutiques en plus proposées (Starter : jusqu\'à 2)')
  ok(norm(await card.innerText()).includes('1 500 F CFA par mois chacun') && norm(await card.innerText()).includes('4 000 F CFA par mois chacune'), 'prix par mois affichés')
  ok(norm(await page.getByTestId('addons-renewal').innerText()).includes('1 500 F CFA par mois'), 'options au renouvellement dites')
  await page.screenshot({ path: OUT + '/addons-card.png', fullPage: false })

  await page.getByTestId('addons-add-seats').click(); await wait(800)
  ok(await dialog(page).isVisible(), '« Ajouter » : fenêtre d\'achat')
  ok(norm(await page.getByTestId('addons-amount').innerText()) === '900 F CFA', `1 employé, 18 jours : 900 F CFA (« ${norm(await page.getByTestId('addons-amount').innerText())} »)`)
  const dtxt = norm(await dialog(page).innerText())
  ok(dtxt.includes('Pour les 18 jours restants') && dtxt.includes('Puis 1 500 F CFA de plus par mois'), 'prorata et prix mensuel expliqués')
  ok(!/—|–/.test(dtxt), 'pas de tiret long')
  await dialog(page).getByRole('button', { name: m.addons.more }).click(); await wait(300)
  ok(norm(await page.getByTestId('addons-qty').innerText()) === '2' && norm(await page.getByTestId('addons-amount').innerText()) === '1 800 F CFA', '2 employés : 1 800 F CFA')
  await page.screenshot({ path: OUT + '/addons-buy.png' })
  await dialog(page).getByRole('button', { name: /^Payer/ }).click(); await wait(2500)
  ok(JSON.stringify(s.posts[0] && { a: s.posts[0].action, se: s.posts[0].seats, sh: s.posts[0].shops }) === JSON.stringify({ a: 'buy', se: 2, sh: 0 }) && !('amount' in (s.posts[0] || {})), 'envoyé : achat de 2 employés, AUCUN montant (le serveur le calcule)', s.posts[0])
  ok(/paiement=simule/.test(page.url()), 'redirigé vers le lien de paiement')

  await page.goto(`${BASE}/fr/billing`, { waitUntil: 'domcontentloaded' }); await wait(7000)
  await page.getByTestId('addons-remove-seats').click(); await wait(700)
  const conf = norm(await page.getByRole('dialog').innerText())
  ok(conf.includes('reste active jusqu') && conf.includes('Aucun remboursement'), 'retrait : reste actif jusqu\'au renouvellement, sans remboursement')
  await page.getByRole('button', { name: m.addons.remove_confirm_btn }).click(); await wait(1500)
  ok(JSON.stringify(s.posts[1]) === JSON.stringify({ action: 'renewal', shop_id: s.posts[1]?.shop_id, seats: 0, shops: 0 }), 'envoyé : 0 employé au renouvellement', s.posts[1])

  await page.getByTestId('billing-choose-starter').click(); await wait(800)
  ok(norm(await page.getByTestId('checkout-total').innerText()) === '6 500 F CFA', `paiement Starter : formule + option = 6 500 F CFA (« ${norm(await page.getByTestId('checkout-total').innerText())} »)`)
  ok(norm(await page.getByTestId('checkout-addons').innerText()) === 'Options comprises : 1 employé en plus.', 'options comprises dites')
  const payLabel = norm(await page.getByRole('button', { name: /^Payer/ }).last().innerText())
  ok(payLabel === 'Payer 6 500 F CFA', `bouton de paiement = total options comprises (« ${payLabel} »)`)
  await page.screenshot({ path: OUT + '/addons-checkout.png' })
  ok(s.sent.length === 0, `aucune autre écriture (${s.sent.join(', ') || 'aucune'})`)
  ok(s.errors.length === 0, `aucune erreur JS (${s.errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n2. Retrait programmé, limite, conseil, renouvellement proche')
  s = await open({ state: STATE({ addons: { seats: 20, shops: 2, seats_renew: 18, shops_renew: 2 }, advice: { plan: 'pro', extraMonthly: 0 } }) }); page = s.page
  ok(norm(await page.getByTestId('addons-not-renewed-seats').innerText()).startsWith('2 employés ne seront pas renouvelés le'), 'retrait programmé dit (2 employés)')
  ok(await page.getByTestId('addons-add-seats').isDisabled() && norm(await page.getByTestId('addons-card').innerText()).includes('Maximum atteint : 20 employés en plus'), '20 employés : « Ajouter » désactivé, maximum dit')
  ok(norm(await page.getByTestId('addons-card').innerText()).includes(m.addons.shops_max_custom), '2 boutiques en plus : offre sur mesure proposée')
  ok(norm(await page.getByTestId('addons-advice').innerText()).includes('formule Pro'), 'conseil : formule Pro')
  await page.getByTestId('addons-cancel-removal-seats').click(); await wait(1200)
  ok(s.posts[0]?.seats === 20, '« Annuler le retrait » : 20 employés reconduits', s.posts[0])
  await s.browser.close()
  s = await open({ state: STATE({ plan_expires_at: new Date(Date.now() + 2 * 86400000).toISOString() }) }); page = s.page
  await page.getByTestId('addons-add-seats').click(); await wait(800)
  ok(await page.getByTestId('addons-too-close').isVisible() && await dialog(page).getByRole('button', { name: /^Payer/ }).count() === 0, 'à 2 jours du renouvellement : achat proposé après renouvellement, pas de paiement')
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n3. Téléphone')
  s = await open({ state: STATE(), width: 390, height: 844 }); page = s.page
  await page.getByTestId('addons-card').scrollIntoViewIfNeeded()
  const box = await page.getByTestId('addons-add-seats').boundingBox()
  ok(box && box.height >= 44 && box.x + box.width <= 390, `bouton « Ajouter » entier et touchable (${box && Math.round(box.height)} px)`)
  await page.screenshot({ path: OUT + '/addons-phone.png' })
  await s.browser.close()

  console.log('\n4. Réponse réelle du serveur')
  s = await open({ state: null }); page = s.page
  const r = s.real[s.real.length - 1]
  ok(r && r.status === 200 && r.body && typeof r.body.active === 'boolean' && r.body.prices && r.body.max, `propriétaire : réponse ${r && r.status} (formule ${r && r.body && r.body.plan}, ${r && r.body && JSON.stringify(r.body.prices)})`)
  ok(await page.getByTestId('addons-card').count() === (r && r.body && r.body.active ? 1 : 0), 'section affichée selon la formule réelle')
  ok(s.errors.length === 0, 'aucune erreur JS')
  await s.browser.close()
  s = await open({ email: 'ghislainx123+jeanpaul@gmail.com', state: null }); page = s.page
  const re = s.real[s.real.length - 1]
  ok(!re || re.status === 403, `employé : options refusées par le serveur (${re && re.status})`)
  ok(await page.getByTestId('addons-card').count() === 0, 'employé : pas de section « Options »')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
