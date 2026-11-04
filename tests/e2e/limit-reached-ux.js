// « Limite atteinte » : acheter une place au moment du blocage (4 nov. 2026, étape 2 lot 2). LECTURE SEULE, serveur
// local ; toute écriture est interceptée. Compte vitrine Marché Soleil (propriétaire, Akwa). Simulés : le quota d'équipe
// (plein), l'état des options (Starter, 18 jours restants), les refus du serveur (team_limit / shop_limit) et le
// paiement (lien vers /fr/billing?success=1, comme au retour de la passerelle). Rien n'est créé.
// Aussi : fiche admin « Options payées » (lecture) et rappel avant renouvellement (simulation ?dry=1).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/limit-reached-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const mm = line.match(/^([A-Z_0-9]+)=(.*)$/); if (mm) env[mm[1]] = mm[2].trim() }
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const m = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const in18 = new Date(Date.now() + 18 * 86400000 - 3600000).toISOString()
const STATE = (over = {}) => ({
  plan: 'starter', active: true, plan_expires_at: in18, billing_period: 'monthly', currency: 'XOF', prices: { seat: 1500, shop: 4000 },
  addons: { seats: 0, shops: 0, seats_renew: 0, shops_renew: 0 }, max: { seats: 20, shops: 2 }, min_days: 3,
  renewal: { monthly_addons: 0, period_total: 5000 }, advice: null, ...over,
})

async function open({ email = 'ghislainx123@gmail.com', addons, quotaFull = false, refuse = null, path = '/team' }) {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []; const buys = []
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request(), u = new URL(r.url()), w = `${r.method()} ${u.pathname}`
    if (w === 'GET /api/billing/addons' && addons) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(addons) })
    if (w === 'GET /api/team/quota' && quotaFull) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 2, limit: 2, offered: 0, plan: 'starter', planName: 'Starter' }) })
    if (w === 'POST /api/billing/addons') { buys.push(JSON.parse(r.postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authorization_url: `${BASE}/fr/billing?success=1` }) }) }
    if (refuse && w === refuse.route) { sent.push(`${w} (refus simulé)`); return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Limite atteinte', code: refuse.code }) }) }
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    // Lecture par POST (liste d'identifiants) : e-mail et dernière connexion des membres, aucune écriture
    if (w === 'POST /api/team/status') return route.fallback()
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  return { ...s, errors, sent, buys }
}
const dlg = page => page.getByTestId('limit-reached-dialog')
const stateOf = async page => page.getByTestId('limit-reached-text').getAttribute('data-state').catch(() => null)

;(async () => {
  console.log('1. Équipe pleine : « Inviter » propose la place, paiement, retour, invitation rouverte')
  let s = await open({ addons: STATE(), quotaFull: true }); let page = s.page
  await page.getByTestId('team-invite').click(); await wait(1500)
  ok(await dlg(page).isVisible() && await stateOf(page) === 'offer', 'fenêtre « Toutes les places sont utilisées » (offre)')
  const txt = norm(await dlg(page).innerText())
  ok(txt.includes('Les employés compris dans votre formule Starter sont tous utilisés') && txt.includes('Ajouter un employé : 1 500 F CFA par mois') && /Aujourd'hui : 900 F CFA, jusqu'au/.test(txt), `texte : « ${txt.slice(0, 220)} »`)
  ok(await page.getByTestId('invite-dialog').count() === 0, 'aucun formulaire à remplir pour rien')
  await page.screenshot({ path: OUT + '/limit-offer.png' })
  await dlg(page).getByRole('button', { name: /^Ajouter et payer/ }).click()
  await page.waitForURL(/\/fr\/team/, { timeout: 30000 }).catch(() => {}); await wait(3500)
  ok(JSON.stringify(s.buys[0] && { a: s.buys[0].action, se: s.buys[0].seats, sh: s.buys[0].shops }) === '{"a":"buy","se":1,"sh":0}', 'envoyé : achat d\'1 employé (montant calculé par le serveur)', s.buys[0])
  ok(/\/fr\/team$/.test(new URL(page.url()).pathname) && await page.getByTestId('invite-dialog').isVisible(), `retour sur Équipe, invitation rouverte (${page.url()})`)
  await page.screenshot({ path: OUT + '/limit-back.png' })
  // Bandeau de limite (propriétaire) : « Ajouter une place » ouvre la même fenêtre ; aucun prix inventé
  await page.goto(`${BASE}/fr/dashboard`, { waitUntil: 'domcontentloaded' }); await wait(6000)
  const banner = page.getByTestId('plan-limit-alert')
  if (await banner.count()) {
    const btxt = norm(await banner.innerText())
    ok(!/(F CFA|€|₦)\s*\/\s*mois/.test(btxt) && btxt.includes('Toutes les places de votre formule'), `bandeau : message clair, aucun prix (« ${btxt} »)`)
    await page.getByTestId('plan-limit-add-seat').click(); await wait(1500)
    ok(await dlg(page).isVisible() && await stateOf(page) === 'offer', 'bandeau : « Ajouter une place » ouvre la fenêtre')
    await page.screenshot({ path: OUT + '/limit-banner.png' })
  } else ok(false, 'bandeau de limite absent alors que l\'équipe est pleine (simulée)')
  ok(s.errors.length === 0, `aucune erreur JS (${s.errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n2. Refus du serveur après saisie : la saisie est gardée')
  s = await open({ addons: STATE(), refuse: { route: 'POST /api/team/invite', code: 'team_limit' } }); page = s.page
  await page.getByTestId('team-invite').click(); await wait(1000)
  await page.locator('#invite-name').fill('Awa Test Ndiaye'); await page.locator('#invite-email').fill('awa.test@example.com')
  await page.getByTestId('invite-dialog').getByRole('button', { name: /Envoyer|Inviter/ }).last().click(); await wait(1800)
  ok(await dlg(page).isVisible() && await stateOf(page) === 'offer', 'refus team_limit : fenêtre « Limite atteinte »')
  await dlg(page).getByRole('button', { name: /^Ajouter et payer/ }).click()
  await page.waitForURL(/\/fr\/team/, { timeout: 30000 }).catch(() => {}); await wait(3500)
  ok(await page.locator('#invite-name').inputValue().catch(() => '') === 'Awa Test Ndiaye' && await page.locator('#invite-email').inputValue().catch(() => '') === 'awa.test@example.com', 'au retour : nom et e-mail remis')
  ok(!s.sent.some(x => !x.includes('refus simulé')), `aucune écriture (${s.sent.join(', ')})`)
  await s.browser.close()

  console.log('\n3. Autres situations')
  s = await open({ addons: STATE({ plan: 'trial', active: false, plan_expires_at: null }), quotaFull: true }); page = s.page
  await page.getByTestId('team-invite').click(); await wait(1500)
  ok(await stateOf(page) === 'trial' && norm(await dlg(page).innerText()).includes(m.limit_reached.choose_plan), 'essai : « Choisir une formule »')
  await s.browser.close()
  s = await open({ addons: STATE({ addons: { seats: 20, shops: 0, seats_renew: 20, shops_renew: 0 } }), quotaFull: true }); page = s.page
  await page.getByTestId('team-invite').click(); await wait(1500)
  ok(await stateOf(page) === 'custom' && norm(await dlg(page).innerText()).includes(m.limit_reached.request_quote), '20 employés en plus : offre sur mesure, « Demander un devis »')
  await page.screenshot({ path: OUT + '/limit-custom.png' })
  await s.browser.close()
  s = await open({ addons: STATE({ plan_expires_at: new Date(Date.now() + 2 * 86400000).toISOString() }), quotaFull: true }); page = s.page
  await page.getByTestId('team-invite').click(); await wait(1500)
  ok(await stateOf(page) === 'too_close', 'à 2 jours du renouvellement : renouveler d\'abord')
  await s.browser.close()
  s = await open({ email: 'ghislainx123+jeanpaul@gmail.com', addons: null, quotaFull: true }); page = s.page
  const inv = page.getByTestId('team-invite')
  if (await inv.count()) {
    await inv.click(); await wait(2000)
    ok(await stateOf(page) === 'not_owner' && norm(await dlg(page).innerText()).includes('Le propriétaire de l\'entreprise peut en ajouter'), 'gérant : « le propriétaire peut ajouter une place », pas de paiement')
    ok(await dlg(page).getByRole('button', { name: /^Ajouter et payer/ }).count() === 0, 'gérant : aucun bouton de paiement')
  } else ok(true, 'gérant : pas de bouton « Inviter » sur cette page (rien à acheter)')
  await s.browser.close()

  console.log('\n4. Boutique au-delà de la limite (refus du serveur)')
  s = await open({ addons: STATE(), refuse: { route: 'POST /api/shops', code: 'shop_limit' }, path: '/shops' }); page = s.page
  await page.getByTestId('shop-create').click(); await wait(1200)
  await page.getByLabel(/Nom/).first().fill('Boutique Test Plateau'); await wait(300)
  await page.getByRole('button', { name: /Créer/ }).last().click(); await wait(2000)
  ok(await dlg(page).isVisible() && norm(await dlg(page).innerText()).includes('Ajouter une boutique : 4 000 F CFA par mois'), 'fenêtre « Limite de boutiques atteinte », boutique à 4 000 F par mois')
  await page.screenshot({ path: OUT + '/limit-shop.png' })
  await dlg(page).getByRole('button', { name: /^Ajouter et payer/ }).click()
  await page.waitForURL(/\/fr\/shops/, { timeout: 30000 }).catch(() => {}); await wait(3500)
  ok(norm(await page.getByLabel(/Nom/).first().inputValue().catch(() => '')) === 'Boutique Test Plateau', 'au retour : création rouverte, nom remis')
  ok(s.buys[0]?.shops === 1, 'envoyé : achat d\'1 boutique', s.buys[0])
  await s.browser.close()

  console.log('\n5. Administration (lecture) et rappel (simulation)')
  s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: 'admin@northcode.ng' })
  const res = await s.page.request.get(`${BASE}/api/admin/entity-addons?shop_id=${AKWA}`)
  const j = await res.json().catch(() => null)
  ok(res.status() === 200 && j && j.addons && Array.isArray(j.purchases), `admin : options de l'entreprise lisibles (${res.status()})`, j)
  const post = await s.page.request.post(`${BASE}/api/admin/entity-addons`, { data: { shop_id: AKWA, kind: 'seats', quantity: 1, reason: '' } })
  ok(post.status() === 400, `admin : retrait sans motif refusé (${post.status()})`)
  await s.browser.close()
  if (env.CRON_SECRET) {
    const r = await fetch(`${BASE}/api/cron/grant-reminders?dry=1`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
    const jj = await r.json().catch(() => null)
    ok(r.status === 200 && jj && jj.dry === true && Array.isArray(jj.addon_reminders), `rappel (simulation, rien envoyé) : ${jj && JSON.stringify(jj.addon_reminders)}`)
  } else ok(false, 'CRON_SECRET absent : simulation du rappel impossible')

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
