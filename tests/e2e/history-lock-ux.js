// Historique par formule (3 nov. 2026) : 3 derniers mois en Starter, 12 en Pro, sans limite en Business.
// LECTURE SEULE, serveur local, compte vitrine Marché Soleil (Akwa) ; toute écriture est interceptée.
// La formule est SIMULÉE en remplaçant la réponse de /api/billing/features ; une durée très courte (2 jours) sert à
// atteindre la limite de la caisse et des dépenses sans cliquer 90 fois. Les routes du serveur sont couvertes par
// plan-features-pure.ts.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/history-lock-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const m = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const REQUIRED = { transfers: 'pro', po_email: 'pro', exports: 'pro', long_reports: 'pro', unlimited_history: 'business', priority_support: 'business' }
const F = (pro, biz) => ({ transfers: pro, po_email: pro, exports: pro, long_reports: pro, unlimited_history: biz, priority_support: biz })
const STARTER = { plan: 'starter', history_days: 92, features: F(false, false) }
const STARTER_SHORT = { plan: 'starter', history_days: 2, features: F(false, false) }
const PRO = { plan: 'pro', history_days: 366, features: F(true, false) }
const pad = n => String(n).padStart(2, '0')
const dayStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const earliest = days => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days); return dayStr(d) }

async function open({ email = 'ghislainx123@gmail.com', mock, width = 1366, height = 900 }) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []; const real = []
  await s.page.route(/\/api\/billing\/features/, async route => {
    if (!mock) { const res = await route.fetch(); real.push(await res.json().catch(() => null)); return route.fulfill({ response: res }) }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...mock, required: REQUIRED }) })
  })
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    const w = `${r.method()} ${new URL(r.url()).pathname}`
    if (w === 'POST /api/reports/margin') return route.fallback() // lecture seule (POST pour une longue liste)
    // Envois automatiques des pages, interceptés (rien ne part) : rôle de session, profil, dépenses récurrentes dues
    // (générées par le serveur à l'ouverture de Dépenses, sans doublon possible)
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles', 'POST /api/expenses/recurring'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return { ...s, errors, sent, real }
}
const go = async (page, path, ms = 6000) => { await page.goto(`${BASE}/fr${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(ms) }
const lockDialog = page => page.getByTestId('plan-lock-dialog')
const closeDialog = async page => { await page.keyboard.press('Escape'); await wait(500) }
const hint3 = `${m.plan_lock.history_window_3m} ${m.plan_lock.history_more.replace('{plan}', 'Pro')}`

;(async () => {
  console.log('1. Starter (3 mois), propriétaire')
  let s = await open({ mock: STARTER }); let page = s.page
  await go(page, '/sales/history')
  await page.getByTestId('sales-period').click(); await wait(600)
  const presets = await page.locator('[data-testid^="sales-preset-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('sales-preset-', '')))
  ok(JSON.stringify(presets) === JSON.stringify(['today', 'yesterday', 'week', 'month', 'last_month', 'quarter', 'year', 'custom']), `Historique des ventes : mêmes périodes que les Rapports (${presets.join(', ')})`)
  ok(await page.getByTestId('sales-preset-year').getByTestId('plan-badge-long_reports').count() === 1, '« Cette année » avec « Pro »')
  await page.getByTestId('sales-preset-year').click(); await wait(900)
  ok(await lockDialog(page).isVisible() && norm(await lockDialog(page).innerText()).includes('3 derniers mois restent disponibles'), 'choix : fenêtre « historique sur plus de 3 mois »')
  await closeDialog(page)
  await page.getByTestId('sales-period').click(); await wait(500)
  await page.getByTestId('sales-preset-custom').click(); await wait(1500)
  ok(norm(await page.getByTestId('sales-history-hint').innerText().catch(() => '')) === hint3, 'période personnalisée : limite dite')
  ok(await page.locator('input[type="date"]').first().getAttribute('min') === earliest(92), `date de début au plus tôt : ${earliest(92)}`)
  await page.screenshot({ path: OUT + '/history-sales.png' })

  await go(page, '/dashboard', 9000)
  const year = page.getByTestId('chart-period-year').first()
  ok(await year.count() === 1 && await year.locator('svg').count() === 1, 'Tableau de bord : « Année » avec cadenas')
  await year.click(); await wait(900)
  ok(await lockDialog(page).isVisible(), 'appui : fenêtre')
  await closeDialog(page)
  const trend = norm(await page.locator('body').innerText())
  ok(trend.includes(m.dashboard?.monthly_trend ? m.dashboard.monthly_trend.replace('{months}', '3') : 'Revenus vs Dépenses (3 mois)'), 'graphique revenus / dépenses sur 3 mois (pas de mois vides trompeurs)')
  await page.screenshot({ path: OUT + '/history-dashboard.png' })

  await go(page, '/stock/movements')
  ok(norm(await page.getByTestId('movements-history-hint').innerText().catch(() => '')) === hint3, 'Mouvements de stock : limite dite')
  const mvFrom = page.locator('input[type="date"]').first()
  ok(await mvFrom.getAttribute('min') === earliest(92), 'Mouvements : date de début au plus tôt')
  ok(s.sent.length === 0, `aucune écriture (${s.sent.join(', ') || 'aucune'})`)
  ok(s.errors.length === 0, `aucune erreur JS (${s.errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n2. Limite atteinte (durée simulée de 2 jours) : caisse et dépenses')
  s = await open({ mock: STARTER_SHORT }); page = s.page
  await go(page, '/caisse')
  const prev = page.getByTestId('caisse-prev-day')
  await prev.click(); await wait(1200); await prev.click(); await wait(1200)
  ok(await page.getByTestId('caisse-history-hint').count() === 1, 'Caisse : au premier jour permis, la limite est dite')
  await prev.click(); await wait(900)
  ok(await lockDialog(page).isVisible(), 'Caisse : un jour de plus = fenêtre « Pro »')
  await page.screenshot({ path: OUT + '/history-caisse.png' })
  await closeDialog(page)
  await go(page, '/expenses')
  ok(await page.getByTestId('expenses-history-hint').count() === 1, 'Dépenses : mois précédent hors période, limite dite')
  await page.getByTestId('expenses-prev-month').click(); await wait(900)
  ok(await lockDialog(page).isVisible(), 'Dépenses : mois précédent = fenêtre « Pro »')
  await page.screenshot({ path: OUT + '/history-expenses.png' })
  ok(s.sent.length === 0 && s.errors.length === 0, `aucune écriture ni erreur JS (${[...s.sent, ...s.errors].join(' | ') || 'aucune'})`)
  await s.browser.close()

  console.log('\n3. Pro (12 mois) : « Cette année » permise, Business pour aller plus loin')
  s = await open({ mock: PRO }); page = s.page
  await go(page, '/sales/history')
  await page.getByTestId('sales-period').click(); await wait(600)
  ok(await page.locator('[data-testid^="sales-preset-"] [data-testid^="plan-badge-"]').count() === 0, 'aucune période verrouillée')
  await page.getByTestId('sales-preset-custom').click(); await wait(1500)
  const h = norm(await page.getByTestId('sales-history-hint').innerText().catch(() => ''))
  ok(h === `${m.plan_lock.history_window_12m} ${m.plan_lock.history_more.replace('{plan}', 'Business')}`, `limite dite : « ${h} »`)
  ok(await page.locator('input[type="date"]').first().getAttribute('min') === earliest(366), 'date de début au plus tôt : 366 jours')
  await page.getByTestId('sales-history-hint-more').click(); await wait(900)
  ok(await lockDialog(page).isVisible() && norm(await lockDialog(page).innerText()).includes('Incluse dans la formule Business'), 'fenêtre : formule Business')
  await closeDialog(page)
  await go(page, '/dashboard', 9000)
  ok(await page.getByTestId('chart-period-year').first().locator('svg').count() === 0, 'tableau de bord : « Année » sans cadenas')
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n4. Employé (Responsable), Starter : pas de lien vers les formules')
  s = await open({ email: 'ghislainx123+jeanpaul@gmail.com', mock: STARTER }); page = s.page
  await go(page, '/stock/movements')
  ok(norm(await page.getByTestId('movements-history-hint').innerText().catch(() => '')) === m.plan_lock.history_window_3m, 'limite dite, sans « Plus loin avec Pro »')
  ok(await page.locator('[data-testid$="-hint-more"]').count() === 0, 'aucun lien vers les formules')
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n5. Formule réelle du compte : aucune limite affichée si sans limite')
  s = await open({ mock: null }); page = s.page
  await go(page, '/stock/movements')
  const r = s.real.filter(x => x && x.features).pop() // dernière réponse valide (une lecture avant la session prête peut échouer)
  ok(r && typeof r.history_days === 'number', `réponse : history_days = ${r && r.history_days}`)
  ok(await page.getByTestId('movements-history-hint').count() === (r && r.history_days >= 0 ? 1 : 0), 'phrase cohérente avec la formule réelle')
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
