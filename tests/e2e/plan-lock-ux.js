// Fonctions réservées par formule (3 nov. 2026) : cadenas « Pro » pour le propriétaire, fonction cachée pour l'employé.
// LECTURE SEULE, serveur local, compte vitrine Marché Soleil (Akwa) ; toute écriture est interceptée.
// La formule Starter (ou l'essai) est SIMULÉE en remplaçant la réponse de /api/billing/features ; la vraie réponse
// (formule réelle du compte) est contrôlée à part. Les refus du serveur sont couverts par plan-features-pure.ts.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/plan-lock-ux.js
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

const STARTER = { plan: 'starter', features: { transfers: false, po_email: false, exports: false, long_reports: false, priority_support: false } }
const TRIAL = { plan: 'trial', features: { transfers: true, po_email: true, exports: true, long_reports: true, priority_support: false } }
const REQUIRED = { transfers: 'pro', po_email: 'pro', exports: 'pro', long_reports: 'pro', priority_support: 'business' }

async function open({ email, mock, width = 1366, height = 900 }) {
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
    // Marges des Rapports : POST en LECTURE SEULE (liste de ventes trop longue pour l'adresse), laissé passer
    if (w === 'POST /api/reports/margin') return route.fallback()
    if (w !== 'POST /api/auth/set-role' && w !== 'PATCH /rest/v1/profiles') sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return { ...s, errors, sent, real }
}
const go = async (page, path, ms = 6000) => { await page.goto(`${BASE}/fr${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(ms) }
const lockDialog = page => page.getByTestId('plan-lock-dialog')
const closeDialog = async page => { await page.keyboard.press('Escape'); await wait(500) }

;(async () => {
  const OWNER = 'ghislainx123@gmail.com', EMPLOYEE = 'ghislainx123+jeanpaul@gmail.com'

  console.log('1. Propriétaire, formule Starter (simulée)')
  let s = await open({ email: OWNER, mock: STARTER }); let page = s.page
  await go(page, '/stock/products')
  await page.getByTestId('products-more-actions').click(); await wait(600)
  const xl = page.getByTestId('export-xlsx')
  ok(await xl.getByTestId('plan-badge-exports').getAttribute('data-state').catch(() => null) === 'locked' && norm(await xl.innerText()).endsWith('Pro'), 'Produits › « … » : Excel avec cadenas et « Pro »')
  await page.screenshot({ path: OUT + '/plan-lock-menu.png' })
  const dl = []; page.on('download', d => dl.push(d))
  await xl.click(); await wait(900)
  ok(await lockDialog(page).isVisible(), 'appui : fenêtre « incluse dans la formule Pro »')
  const txt = norm(await lockDialog(page).innerText())
  ok(txt.includes('Incluse dans la formule Pro') && txt.includes(m.plan_lock.features.exports.replace('{plan}', 'Pro')) && txt.includes(m.plan_lock.see_plans), `texte : « ${txt.slice(0, 140)} »`)
  ok(!/—|–/.test(txt), 'pas de tiret long')
  await page.screenshot({ path: OUT + '/plan-lock-dialog.png' })
  await wait(800); ok(dl.length === 0, 'aucun fichier produit')
  await lockDialog(page).getByRole('button', { name: m.plan_lock.see_plans }).click(); await wait(3000)
  ok(/\/fr\/billing/.test(page.url()), '« Voir les formules » mène à l’abonnement')

  await go(page, '/stock/transfers')
  const nt = page.getByTestId('transfers-new')
  ok(await nt.getByTestId('plan-badge-transfers').count() === 1, 'Transferts : « Nouveau transfert » avec « Pro »')
  await nt.click(); await wait(900)
  ok(await lockDialog(page).isVisible() && norm(await lockDialog(page).innerText()).includes('déjà envoyés restent consultables'), 'appui : fenêtre, transferts envoyés toujours consultables')
  ok(await page.getByRole('dialog').count() === 1, 'le formulaire de transfert ne s’ouvre pas (seule la fenêtre de formule)')
  await page.screenshot({ path: OUT + '/plan-lock-transfers.png' })
  await closeDialog(page)

  await go(page, '/reports', 8000)
  await page.screenshot({ path: OUT + '/plan-lock-reports-page.png' })
  await page.getByTestId('reports-period').click(); await wait(600)
  const year = page.getByTestId('reports-preset-year')
  ok(await year.getByTestId('plan-badge-long_reports').count() === 1, 'Rapports : « Cette année » avec « Pro » (règle fixe)')
  const presets = await page.locator('[data-testid^="reports-preset-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('reports-preset-', '')))
  ok(JSON.stringify(presets) === JSON.stringify(['today', 'yesterday', 'week', 'month', 'last_month', 'quarter', 'year', 'custom']), `périodes : ${presets.join(', ')} (plus de « Semestre », « Mois dernier » ajouté)`)
  const labels = norm(await page.getByRole('listbox').innerText())
  ok(['Ce mois-ci', 'Mois dernier', 'Ce trimestre', 'Cette année'].every(x => labels.includes(x)) && !labels.includes('Semestre'), `libellés clairs : « ${labels} »`)
  ok(await page.locator('[data-testid^="reports-preset-"] [data-testid="plan-badge-long_reports"]').count() === 1, 'une seule période verrouillée')
  await page.screenshot({ path: OUT + '/plan-lock-reports.png' })
  await year.click(); await wait(900)
  ok(await lockDialog(page).isVisible(), 'choix : fenêtre')
  await closeDialog(page)
  ok(!norm(await page.getByTestId('reports-period').innerText()).includes(m.reports.this_year), 'la période ne change pas')
  await page.getByTestId('reports-period').click(); await wait(500)
  await page.getByTestId('reports-preset-last_month').click(); await wait(2500)
  ok(norm(await page.getByTestId('reports-period').innerText()) === 'Mois dernier' && await lockDialog(page).count() === 0, '« Mois dernier » : permis')
  await page.getByTestId('reports-period').click(); await wait(500)
  await page.getByTestId('reports-preset-custom').click(); await wait(1500)
  const hint = norm(await page.getByTestId('reports-window-hint').innerText().catch(() => ''))
  ok(hint === `${m.plan_lock.reports_window} ${m.plan_lock.reports_more}`, `période personnalisée : limite dite (« ${hint} »)`)
  const minDay = await page.locator('input[type="date"]').first().getAttribute('min')
  const expectMin = new Date(Date.now() - 92 * 86400000); const pad = n => String(n).padStart(2, '0')
  ok(minDay === `${expectMin.getFullYear()}-${pad(expectMin.getMonth() + 1)}-${pad(expectMin.getDate())}`, `date de début au plus tôt : ${minDay}`)
  await page.screenshot({ path: OUT + '/plan-lock-custom.png' })
  await page.getByTestId('reports-window-more').click(); await wait(900)
  ok(await lockDialog(page).isVisible() && norm(await lockDialog(page).innerText()).includes('3 derniers mois restent disponibles'), '« Plus loin avec Pro » : fenêtre')
  await closeDialog(page)

  // Bon de commande : envoi par e-mail verrouillé, WhatsApp ouvert
  await page.goto(`${BASE}/fr/suppliers`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByTestId('suppliers-tabs').waitFor({ timeout: 60000 }); await wait(1500)
  await page.getByTestId('suppliers-tabs').locator('button').nth(2).click(); await wait(2500)
  await page.getByTestId('po-send').first().click(); await wait(900)
  const email = page.getByTestId('po-send-email')
  if (await email.count()) {
    ok(await email.getByTestId('plan-badge-po_email').count() === 1 && await email.isEnabled(), 'bon : « Envoyer par e-mail » avec « Pro »')
    ok(await page.getByTestId('po-email-panel').count() === 0, 'bon : pas de formulaire d’envoi par e-mail')
    ok(await page.getByTestId('po-send-whatsapp').isEnabled(), 'bon : WhatsApp disponible')
    ok(norm(await page.getByTestId('po-send-hint').innerText()) === m.suppliers.po_send_hint_pro, 'bon : phrase d’en-tête sans promesse d’e-mail (Pro mentionné)')
    ok(await page.getByText(m.suppliers.po_email_subject, { exact: true }).count() >= 1, 'bon : objet et texte toujours copiables')
    await page.screenshot({ path: OUT + '/plan-lock-po.png' })
    await email.click(); await wait(900)
    ok(await lockDialog(page).isVisible() && norm(await lockDialog(page).innerText()).includes('WhatsApp'), 'appui : fenêtre (télécharger ou WhatsApp toujours possibles)')
  } else ok(false, 'aucun bon envoyable en brouillon ou envoyé sur la vitrine')
  ok(s.sent.length === 0, `aucune écriture (${s.sent.join(', ') || 'aucune'})`)
  ok(s.errors.length === 0, `aucune erreur JS (${s.errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n2. Téléphone, propriétaire, Starter')
  s = await open({ email: OWNER, mock: STARTER, width: 390, height: 844 }); page = s.page
  await go(page, '/stock/transfers')
  const box = await page.getByTestId('transfers-new').boundingBox()
  ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, `bouton entier à l’écran (${box && Math.round(box.width)}×${box && Math.round(box.height)})`)
  await page.screenshot({ path: OUT + '/plan-lock-phone.png' })
  ok(s.errors.length === 0, 'aucune erreur JS')
  await s.browser.close()

  console.log('\n3. Employé (Responsable), formule Starter : fonctions cachées')
  s = await open({ email: EMPLOYEE, mock: STARTER }); page = s.page
  await go(page, '/stock/transfers')
  ok(await page.getByTestId('transfers-new').count() === 0, 'pas de « Nouveau transfert »')
  ok(await page.locator('[data-testid^="plan-badge-"]').count() === 0, 'aucune étiquette « Pro »')
  await go(page, '/customers')
  const files = page.getByTestId('customers-files')
  if (await files.count()) { await files.click(); await wait(600) }
  ok(await page.getByTestId('export-xlsx').count() === 0 && await page.getByTestId('export-csv').count() === 0, 'Clients : pas d’export Excel / CSV')
  ok(s.sent.length === 0 && s.errors.length === 0, `aucune écriture ni erreur JS (${[...s.sent, ...s.errors].join(' | ') || 'aucune'})`)
  await s.browser.close()

  console.log('\n4. Propriétaire pendant l’essai (simulé) : tout marche, étiquette discrète')
  s = await open({ email: OWNER, mock: TRIAL }); page = s.page
  await go(page, '/stock/transfers')
  ok(await page.getByTestId('plan-badge-transfers').getAttribute('data-state').catch(() => null) === 'trial', '« Nouveau transfert » : étiquette « Pro » sans cadenas')
  ok(await page.getByTestId('plan-badge-transfers').locator('svg').count() === 0, 'pas de cadenas')
  await page.getByTestId('transfers-new').click(); await wait(1200)
  ok(await lockDialog(page).count() === 0 && await page.getByRole('dialog').count() === 1, 'le formulaire s’ouvre normalement (pas de fenêtre de formule)')
  await page.screenshot({ path: OUT + '/plan-lock-trial.png' })
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log('\n5. Formule réelle du compte (réponse du serveur)')
  s = await open({ email: OWNER, mock: null }); page = s.page
  await go(page, '/stock/transfers')
  const r = s.real[0]
  ok(r && typeof r.plan === 'string' && r.features && Object.keys(r.features).length === 5, `réponse : ${JSON.stringify(r)}`)
  const expectBadges = r && !r.features.transfers ? 1 : r && r.plan === 'trial' ? 1 : 0
  ok(await page.locator('[data-testid="plan-badge-transfers"]').count() === expectBadges, `étiquettes cohérentes avec la formule réelle (${expectBadges})`)
  ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
