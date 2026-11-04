// Changements de formule sur la page Abonnement (tarification étape 4A-1, migration 212). LECTURE SEULE, serveur local,
// compte vitrine Marché Soleil (propriétaire) ; toute écriture est interceptée. Les cas « à la suite », « descente
// programmée », « montée avec crédit », « refus » et « changement programmé » sont SIMULÉS en remplaçant la réponse de
// GET /api/billing/change-preview (et /api/billing/terms pour le changement programmé). La réponse réelle est
// contrôlée à part (elle doit fonctionner aussi avant la 212, colonnes absentes).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/plan-change-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const DAY = 86400000
const at = d => new Date(Date.now() + d * DAY).toISOString()
const longFr = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const PREVIEW = (over = {}) => ({
  plan: 'pro', period: 'monthly', current_plan: 'pro', schedule: 'stack', currency: 'XAF', amount: 10000, credit: 0, amount_due: 10000,
  starts_at: at(15), ends_at: at(46), blocked: null, pending: null, paused: { shops: 0, seats: 0 }, renew: { seats: 0, shops: 0 }, ...over,
})

async function open({ preview, pending = undefined, width = 1366, height = 900 }) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email: 'ghislainx123@gmail.com' })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []; const asked = []; const real = []
  await s.page.route(/\/api\/billing\/change-preview/, async route => {
    asked.push(Object.fromEntries(new URL(route.request().url()).searchParams))
    if (!preview) { const res = await route.fetch(); real.push({ status: res.status(), body: await res.json().catch(() => null) }); return route.fulfill({ response: res }) }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(typeof preview === 'function' ? preview(asked[asked.length - 1]) : preview) })
  })
  if (pending !== undefined) await s.page.route(/\/api\/billing\/terms/, async route => {
    const res = await route.fetch(); const body = await res.json().catch(() => ({}))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, pending }) })
  })
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    const w = `${r.method()} ${new URL(r.url()).pathname}`
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr/billing`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  return { ...s, errors, sent, asked, real }
}
// Ouvre le paiement d'une formule : « Choisir » / « Passer à », ou « Renouveler » si c'est la formule en cours
async function choose(page, id) {
  const renew = page.getByTestId(`billing-renew-${id}`)
  if (await renew.count()) await renew.click(); else await page.getByTestId(`billing-choose-${id}`).click()
  await wait(1500)
}
const payBtn = page => page.getByRole('button', { name: /^Payer/ }).last()

;(async () => {
  console.log('1. Renouvellement anticipé : à la suite de la période en cours')
  let s = await open({ preview: q => PREVIEW({ plan: q.plan, current_plan: q.plan }) }); let page = s.page
  const renewBtns = await page.locator('[data-testid^="billing-renew-"]').count()
  const current = norm(await page.locator('body').innerText()).includes('Renouvellement le')
  ok(!current || renewBtns === 1, `formule en cours : bouton « Renouveler » (et plus de bouton grisé) (${renewBtns})`)
  await choose(page, 'pro')
  ok(s.asked.length > 0 && s.asked[s.asked.length - 1].plan === 'pro' && s.asked[s.asked.length - 1].period === 'monthly', 'aperçu demandé au serveur (formule, durée)', s.asked)
  const stack = page.getByTestId('checkout-schedule')
  ok(await stack.getAttribute('data-schedule') === 'stack', 'manière : à la suite')
  ok(norm(await stack.innerText()) === `Votre période actuelle continue : la nouvelle commence le ${longFr(at(15))} et se termine le ${longFr(at(46))}.`, `dates dites (« ${norm(await stack.innerText())} »)`)
  ok(await page.getByTestId('checkout-prorata').count() === 0, 'pas de crédit')
  await page.screenshot({ path: OUT + '/plan-change-stack.png' })
  ok(s.sent.length === 0 && s.errors.length === 0, `aucune écriture ni erreur JS (${[...s.sent, ...s.errors].join(', ') || 'aucune'})`)
  await s.browser.close()

  console.log('\n2. Descente : appliquée à la fin de la période, ce qui sera mis en pause')
  s = await open({ preview: PREVIEW({ plan: 'starter', current_plan: 'business', schedule: 'next', amount: 5000, amount_due: 5000, paused: { shops: 1, seats: 2 } }) }); page = s.page
  await choose(page, 'starter')
  const next = page.getByTestId('checkout-schedule')
  const nt = norm(await next.innerText())
  ok(await next.getAttribute('data-schedule') === 'next', 'manière : à la fin de la période')
  ok(nt.includes(`Vous gardez la formule Business jusqu'au ${longFr(at(15))}. La formule Starter commence ensuite.`), 'formule gardée jusqu\'à la fin dite', nt)
  ok(norm(await page.getByTestId('checkout-paused-shops').innerText()) === '1 boutique sera mise en pause à cette date.', 'boutique mise en pause (singulier)')
  ok(norm(await page.getByTestId('checkout-paused-seats').innerText()) === '2 employés seront mis en pause à cette date.', 'employés mis en pause (pluriel)')
  ok(nt.includes('Rien n\'est effacé'), 'rien n\'est effacé, dit')
  ok(!/—|–|\(s\)/.test(nt), 'pas de tiret long ni « (s) »')
  await page.screenshot({ path: OUT + '/plan-change-next.png' })
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n3. Montée : tout de suite, avec le crédit des jours payés')
  s = await open({ preview: PREVIEW({ plan: 'business', current_plan: 'pro', schedule: 'now', amount: 15000, credit: 5000, amount_due: 10000, starts_at: new Date().toISOString(), ends_at: at(31) }) }); page = s.page
  await choose(page, 'business')
  const pr = norm(await page.getByTestId('checkout-prorata').innerText())
  ok(pr.includes('Crédit des jours non utilisés') && pr.includes('5 000'), 'crédit affiché', pr)
  ok(norm(await page.getByTestId('checkout-due').innerText()).startsWith('10 000'), 'à payer aujourd\'hui : 10 000')
  ok(norm(await page.getByTestId('checkout-schedule').innerText()).startsWith('La formule Business est active tout de suite'), 'montée immédiate dite')
  const label = norm(await payBtn(page).innerText())
  ok(/^Payer 10 000/.test(label), `bouton de paiement = montant après crédit (« ${label} »)`)
  await page.screenshot({ path: OUT + '/plan-change-upgrade.png' })
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n4. Refus : changement déjà programmé')
  s = await open({ preview: PREVIEW({ plan: 'business', schedule: 'now', blocked: 'plan_change_pending', pending: { plan: 'starter', from: at(15) } }), pending: { plan: 'starter', from: at(15) } }); page = s.page
  ok(norm(await page.getByTestId('billing-pending-change').innerText()) === `Changement programmé : formule Starter à partir du ${longFr(at(15))}.`, 'carte « Votre formule » : changement programmé dit')
  await choose(page, 'business')
  ok(norm(await page.getByTestId('checkout-blocked').innerText()) === `Un changement vers la formule Starter est déjà programmé le ${longFr(at(15))}.`, 'refus expliqué')
  ok(await payBtn(page).isDisabled(), 'paiement impossible')
  await page.screenshot({ path: OUT + '/plan-change-blocked.png' })
  await s.browser.close()
  s = await open({ preview: PREVIEW({ plan: 'business', schedule: 'now', credit: 9000, amount: 8000, amount_due: 0, blocked: 'upgrade_choose_longer' }) }); page = s.page
  await choose(page, 'business')
  ok(norm(await page.getByTestId('checkout-blocked').innerText()).includes('choisissez une durée plus longue'), 'crédit supérieur au prix : durée plus longue proposée')
  ok(await payBtn(page).isDisabled() && s.sent.length === 0, 'paiement impossible, aucune écriture')
  await s.browser.close()

  console.log('\n5. Téléphone')
  s = await open({ preview: PREVIEW({ plan: 'starter', current_plan: 'business', schedule: 'next', amount: 5000, amount_due: 5000, paused: { shops: 1, seats: 2 } }), width: 390, height: 844 }); page = s.page
  await choose(page, 'starter')
  const box = await page.getByTestId('checkout-schedule').boundingBox()
  const sw = await page.evaluate(() => document.documentElement.scrollWidth)
  ok(box && box.x >= 0 && box.x + box.width <= 390 && sw <= 390, `explication entière à l'écran, pas de défilement de côté (${sw} px)`)
  await page.screenshot({ path: OUT + '/plan-change-phone.png' })
  await s.browser.close()

  console.log('\n6. Réponse réelle du serveur (aperçu, lecture seule)')
  s = await open({ preview: null }); page = s.page
  await choose(page, 'business')
  const r = s.real[s.real.length - 1]
  const b = r && r.body
  ok(r && r.status === 200 && b && ['now', 'stack', 'next'].includes(b.schedule) && typeof b.amount_due === 'number' && b.paused && 'blocked' in b, `aperçu réel : ${r && r.status} (${b && b.schedule}, ${b && b.amount_due} ${b && b.currency}, refus ${b && b.blocked})`)
  ok(b && Math.abs(b.amount_due - Math.max(0, b.amount - b.credit)) < 0.01, 'à payer = prix moins crédit')
  ok(s.errors.length === 0 && s.sent.length === 0, 'aucune erreur JS ni écriture')
  await s.browser.close()

  console.log('\n7. Admin : remboursement d\'un paiement fait par erreur (simulé, rien ne part)')
  {
    const rows = [
      { reference: 'SS-TEST-RECENT', kind: 'plan', plan: 'pro', billing_period: 'monthly', currency: 'XAF', amount_due: 10000, paid_amount: 10000, gateway: 'notchpay', status: 'paid', settled_at: at(-0.5), schedule: 'now', prev_plan: 'starter', addon_seats: 0, addon_shops: 0, entity_name: 'Entreprise Test' },
      { reference: 'SS-TEST-OLD', kind: 'plan', plan: 'business', billing_period: 'monthly', currency: 'XAF', amount_due: 15000, paid_amount: 15000, gateway: 'notchpay', status: 'paid', settled_at: at(-3), schedule: 'stack', prev_plan: 'business', addon_seats: 0, addon_shops: 0, entity_name: 'Entreprise Test 2' },
      { reference: 'SS-TEST-DONE', kind: 'addon', plan: null, billing_period: null, currency: 'XAF', amount_due: 1500, paid_amount: 1500, gateway: 'notchpay', status: 'refunded', settled_at: at(-1), schedule: 'now', prev_plan: null, addon_seats: 1, addon_shops: 0, entity_name: 'Entreprise Test 3' },
    ]
    const s2 = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: 'admin@northcode.ng' })
    const errors = []; s2.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
    const posts = [], sent = [], real = []
    let mock = true
    await s2.page.route(/\/(api|rest\/v1)\//, async route => {
      const r = route.request(), w = `${r.method()} ${new URL(r.url()).pathname}`
      if (w === 'GET /api/admin/payments/refund') {
        if (!mock) { const res = await route.fetch(); real.push({ status: res.status(), body: await res.json().catch(() => null) }); return route.fulfill({ response: res }) }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ payments: rows }) })
      }
      if (w === 'POST /api/admin/payments/refund') {
        const body = JSON.parse(r.postData() || '{}'); posts.push(body)
        if (body.reference === 'SS-TEST-OLD' && !body.late) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Paiement confirmé il y a 72 h (règle : 48 h). Confirmez pour rembourser quand même.', code: 'late' }) })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, restored: "formule d'avant remise (starter)" }) })
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
      if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    page = s2.page
    await page.goto(`${BASE}/fr/admin/payments`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    const panel = page.getByTestId('payment-refunds-panel')
    ok(await panel.isVisible(), 'panneau « Paiements des 7 derniers jours » affiché')
    ok(norm(await panel.innerText()).includes('signalé sous 48 h'), 'règle des 48 h dite')
    ok(await page.getByTestId('refund-open').count() === 2 && await page.getByTestId('refund-done').count() === 1, 'remboursable : 2 paiements ; déjà remboursé : marqué')
    await page.getByTestId('refund-open').first().click(); await wait(400)
    ok(await page.getByTestId('refund-confirm').isDisabled(), 'motif vide : confirmation impossible')
    await page.getByTestId('refund-reason').fill('Double paiement signalé par le client'); await wait(200)
    await panel.screenshot({ path: OUT + '/plan-change-refund.png' })
    await page.getByTestId('refund-confirm').click(); await wait(1500)
    ok(JSON.stringify(posts[0]) === JSON.stringify({ reference: 'SS-TEST-RECENT', reason: 'Double paiement signalé par le client', late: false }), 'envoyé : référence + motif, sans montant', posts[0])
    await page.getByTestId('refund-open').last().click(); await wait(400)
    ok(norm(await panel.innerText()).includes('plus de 48 h'), 'paiement de plus de 48 h : avertissement')
    await page.getByTestId('refund-reason').fill('Erreur de formule'); await page.getByTestId('refund-confirm').click(); await wait(1500)
    ok(posts[1] && posts[1].late === false && norm(await page.getByTestId('refund-confirm').innerText()) === 'Confirmer malgré le délai', 'refus du serveur (48 h) : confirmation explicite demandée')
    await page.getByTestId('refund-confirm').click(); await wait(1500)
    ok(posts[2] && posts[2].late === true && posts[2].reference === 'SS-TEST-OLD', 'seconde confirmation : envoyée avec « malgré le délai »', posts[2])
    ok(sent.length === 0 && errors.length === 0, `aucune autre écriture ni erreur JS (${[...sent, ...errors].join(', ') || 'aucune'})`)
    mock = false
    await page.goto(`${BASE}/fr/admin/payments`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    const rr = real[real.length - 1]
    ok(rr && rr.status === 200 && Array.isArray(rr.body && rr.body.payments), `liste réelle (lecture) : ${rr && rr.status}, ${rr && rr.body && rr.body.payments && rr.body.payments.length} paiement(s)`)
    await s2.browser.close()
  }
  {
    const s3 = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: 'ghislainx123@gmail.com' })
    const res = await s3.page.request.get(`${BASE}/api/admin/payments/refund`)
    ok([401, 403].includes(res.status()), `propriétaire de boutique : liste refusée (${res.status()})`)
    await s3.browser.close()
  }

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
