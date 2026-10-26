// Lot 5 — sécurité serveur du tableau de bord et des rapports : MANIPULATION DIRECTE des requêtes.
// Les routes sont appelées depuis Node avec la session réelle de chaque employé (sans passer par l'interface), avec des
// paramètres modifiés à la main (filtre vendeur retiré ou falsifié, boutiques étrangères, identifiants invalides).
// Les résultats sont comparés à un calcul indépendant fait en base. LECTURE SEULE : aucune route appelée n'écrit.
// Usage : CAPTURE_BASE=http://localhost:3000 node lot5-security.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const BASE = process.env.CAPTURE_BASE
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE || '')) { console.error('Serveur local obligatoire (CAPTURE_BASE)'); process.exit(2) }
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005

async function login(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(email + ' : ' + error.message)
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { cookie, 'Content-Type': 'application/json', 'accept-language': 'fr' }, body: body ? JSON.stringify(body) : undefined })
    let json = {}; try { json = await r.json() } catch {}
    return { status: r.status, json }
  }
  return { id: data.user.id, call }
}

// Calcul indépendant : paiements d'une boutique sur une période, hors ventes annulées / paiements annulés / abandons
async function paymentsSum(shopId, from, to, sellerId = null) {
  let rows = [], page = 0
  for (;;) {
    const { data } = await admin.from('payments').select('amount, is_cancelled, is_write_off, sales!inner(shop_id, sale_status, cashier_id)')
      .eq('sales.shop_id', shopId).gte('paid_at', from).lte('paid_at', to).order('id').range(page * 1000, page * 1000 + 999)
    rows.push(...(data || [])); if (!data || data.length < 1000) break; page++
  }
  return rows.filter(p => p.sales.sale_status !== 'cancelled' && !p.is_cancelled && !p.is_write_off && (!sellerId || p.sales.cashier_id === sellerId))
    .reduce((n, p) => n + Number(p.amount), 0)
}
const weekTotal = j => (j.weekPayments || []).reduce((n, d) => n + Number(d.amount), 0)

;(async () => {
  const users = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users
  const idOf = e => users.find(u => u.email === e)?.id
  const now = new Date(), end = now.toISOString()
  const from = new Date(now.getTime() - 90 * 86400000).toISOString()
  const q = (shops, extra = '') => `shop_ids=${shops.join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}&week_start=${encodeURIComponent(from)}${extra}`

  // ══ 1. Caissière d'Akwa (Fatou) : uniquement ses ventes, quoi qu'envoie le navigateur ══
  console.log('1. Caissière d’Akwa — filtre « mes ventes » retiré ou falsifié')
  const fatou = await login('ghislainx123+fatou@gmail.com')
  const own = await paymentsSum(AKWA, from, end, fatou.id)
  const shopAll = await paymentsSum(AKWA, from, end)
  console.log(`     repère base : ses encaissements ${own} · toute la boutique ${shopAll} (90 jours)`)
  let r = await fatou.call('GET', `/api/dashboard/payments-today?${q([AKWA])}`)
  ok(r.status === 200 && near(weekTotal(r.json), own), `sans filtre vendeur : ses seules ventes (${weekTotal(r.json)} = ${own}) — jamais toute la boutique`)
  r = await fatou.call('GET', `/api/dashboard/payments-today?${q([AKWA], `&cashier_id=${idOf('ghislainx123@gmail.com')}`)}`)
  ok(r.status === 200 && near(weekTotal(r.json), own), 'avec le filtre d’un AUTRE vendeur : toujours ses seules ventes')
  r = await fatou.call('GET', `/api/dashboard/revenue-monthly?shop_ids=${AKWA}`)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString()
  const ownMonth = await paymentsSum(AKWA, monthStart, monthEnd, fatou.id)
  ok(r.status === 200 && near((r.json.data || []).reduce((n, d) => n + d.revenue, 0), ownMonth), `graphique « Mois » sans filtre : ses ventes (${ownMonth})`)
  r = await fatou.call('GET', `/api/dashboard/revenue-yearly?shop_ids=${AKWA}`)
  ok(r.status === 200 && (r.json.data || []).reduce((n, d) => n + d.revenue, 0) <= await paymentsSum(AKWA, new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).toISOString(), monthEnd, fatou.id) + 0.005, 'graphique « Année » sans filtre : pas plus que ses ventes')
  r = await fatou.call('GET', `/api/dashboard/top-products?period=year&shop_ids=${AKWA}`)
  const { data: ownSales } = await admin.from('sales').select('id').eq('shop_id', AKWA).eq('sale_status', 'active').eq('cashier_id', fatou.id).gte('created_at', new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).toISOString()).limit(1000)
  const { data: ownItems } = ownSales?.length ? await admin.from('sale_items').select('subtotal').in('sale_id', ownSales.map(s => s.id)) : { data: [] }
  const ownItemsTotal = (ownItems || []).reduce((n, i) => n + Number(i.subtotal), 0)
  ok(r.status === 200 && (r.json.data || []).reduce((n, p) => n + p.revenue, 0) <= ownItemsTotal + 0.005, 'top produits sans filtre : calculé sur ses seules ventes')
  r = await fatou.call('GET', `/api/dashboard/summary?shop_ids=${AKWA}&day_start=${encodeURIComponent(from)}&day_end=${encodeURIComponent(end)}&month_start=${encodeURIComponent(monthStart)}&month_end=${encodeURIComponent(monthEnd)}`)
  const otherRepay = (r.json.repayments || []).filter(p => p.sales?.shop_id !== AKWA)
  ok(r.status === 200 && r.json.month_global_revenue === null && r.json.month_expenses === null, 'résumé : ni encaissé global de la boutique ni dépenses (non autorisés au caissier)')
  const { data: repIds } = await admin.from('payments').select('id, sales!inner(cashier_id, shop_id)').eq('is_repayment', true).eq('sales.shop_id', AKWA).neq('sales.cashier_id', fatou.id).gte('paid_at', from)
  const foreignIds = new Set((repIds || []).map(x => x.id))
  ok(r.status === 200 && otherRepay.length === 0 && !(r.json.repayments || []).some(p => foreignIds.has(p.id)), `résumé : remboursements de SES ventes seulement (${(r.json.repayments || []).length}, aucun d’un autre vendeur parmi ${foreignIds.size})`)
  r = await fatou.call('GET', `/api/reports/summary?shop_ids=${[AKWA].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 403, `Rapports : refusés (pas de droit « Rapports ») (${r.status})`)
  r = await fatou.call('GET', `/api/dashboard/expense-revenue?shop_ids=${AKWA}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(end)}`)
  ok(r.status === 403, `graphique « Revenus vs dépenses » (CA de toute la boutique) : refusé (${r.status})`)
  r = await fatou.call('POST', '/api/reports/margin', { shop_ids: [AKWA], sale_ids: [] })
  ok(r.status === 403, `marge : refusée (${r.status})`)

  // ══ 2. Gestionnaire de stock (Mariam) : canViewCost sans « Rapports » ══
  console.log('\n2. Gestionnaire de stock de Bastos — coûts visibles en Stock, mais pas de Rapports')
  const mariam = await login('ghislainx123+mariam@gmail.com')
  r = await mariam.call('GET', `/api/reports/summary?shop_ids=${[BASTOS].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 403, `Rapports refusés malgré canViewCost (${r.status})`)
  r = await mariam.call('POST', '/api/reports/margin', { shop_ids: [BASTOS], sale_ids: [] })
  ok(r.status === 403, `marge refusée : canViewCost seul ne donne pas accès aux Rapports (${r.status})`)
  r = await mariam.call('GET', `/api/dashboard/payments-today?${q([BASTOS])}`)
  ok(r.status === 403, `graphique du chiffre d’affaires refusé (widget non autorisé à ce rôle) (${r.status})`)
  r = await mariam.call('GET', `/api/dashboard/top-products?period=month&shop_ids=${BASTOS}`)
  ok(r.status === 403, `top produits refusé (${r.status})`)

  // ══ 3. Gérant d'Akwa (Jean-Paul) : Rapports + coûts, seulement dans SA boutique ══
  console.log('\n3. Gérant d’Akwa — Rapports et coûts dans sa boutique, rien ailleurs')
  const jp = await login('ghislainx123+jeanpaul@gmail.com')
  r = await jp.call('GET', `/api/reports/summary?shop_ids=${[AKWA].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  const { data: akwaSales } = await admin.from('sales').select('total').eq('shop_id', AKWA).eq('sale_status', 'active').gte('created_at', from).lte('created_at', end)
  const akwaTotal = (akwaSales || []).reduce((n, s) => n + Number(s.total), 0)
  ok(r.status === 200 && near(r.json.totals?.revenue, akwaTotal) && !/buying_price|cogs|stock_buying_value|product_costs/.test(JSON.stringify(r.json)), `Rapports d’Akwa : encaissé de toute la boutique (${r.json.totals?.revenue} = ${akwaTotal}), aucun coût dans la réponse`)
  r = await jp.call('GET', `/api/reports/summary?shop_ids=${[AKWA, BASTOS].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 403, `Akwa + Bastos (non membre de Bastos) : refusé en bloc (${r.status})`)
  r = await jp.call('POST', '/api/reports/margin', { shop_ids: [AKWA], sale_ids: [] })
  ok(r.status === 200, `marge d’Akwa : autorisée (Rapports + coûts) (${r.status})`)

  // ══ 4. Propriétaire : ses boutiques, jamais celles d'une autre entreprise ══
  console.log('\n4. Propriétaire — boutiques étrangères et paramètres invalides')
  const owner = await login('ghislainx123@gmail.com')
  r = await owner.call('GET', `/api/reports/summary?shop_ids=${[AKWA, BONA, BASTOS].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 200 && r.json.shops?.length === 3, `3 boutiques : Rapports calculés sur les 3 (${r.json.shops?.length})`)
  r = await owner.call('GET', `/api/reports/summary?shop_ids=${[AKWA, ALPHA].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 403, `avec une boutique d’une autre entreprise (Alpha) : refusé (${r.status})`)
  r = await owner.call('GET', `/api/dashboard/payments-today?${q([AKWA, ALPHA])}`)
  ok(r.status === 403, `tableau de bord avec Alpha : refusé (${r.status})`)
  r = await owner.call('GET', `/api/dashboard/expense-revenue?shop_ids=${AKWA}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(end)}`)
  ok(r.status === 200 && near(r.json.payments.reduce((n, p) => n + p.amount, 0), await paymentsSum(AKWA, from, end)), `« Revenus vs dépenses » (propriétaire) : CA d’Akwa complet (${r.status})`)
  r = await owner.call('GET', `/api/dashboard/revenue-monthly?shop_ids=not-a-uuid`)
  ok(r.status === 400, `identifiant de boutique invalide : rejeté (${r.status})`)
  r = await owner.call('GET', `/api/reports/summary?shop_ids=${[AKWA].join(',')}&start=${encodeURIComponent('n’importe quoi')}&end=${encodeURIComponent(end)}`)
  ok(r.status === 400, `période invalide : rejetée (${r.status})`)
  r = await owner.call('GET', `/api/dashboard/payments-today?${q([AKWA, BASTOS])}`)
  const both = await paymentsSum(AKWA, from, end) + await paymentsSum(BASTOS, from, end)
  ok(r.status === 200 && near(weekTotal(r.json), both), `propriétaire : toute la boutique, aucun filtre imposé (${weekTotal(r.json)} = ${both})`)

  // ══ 5. Gérant d'Alpha : Rapports oui, graphiques du tableau de bord désactivés par réglage ══
  console.log('\n5. Gérant d’Alpha — widgets désactivés dans les réglages de la boutique')
  const mgr = await login('cassierstock@gmail.com')
  r = await mgr.call('GET', `/api/dashboard/payments-today?${q([ALPHA])}`)
  ok(r.status === 403, `graphique du chiffre d’affaires désactivé pour les gérants d’Alpha : refusé (${r.status})`)
  r = await mgr.call('GET', `/api/reports/summary?shop_ids=${[ALPHA].join(',')}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 200, `Rapports d’Alpha autorisés (${r.status})`)

  // ══ 6. Règle « Rapports sans coût » (aucun compte réel n'a ce cas : règle pure, réglages simulés) ══
  console.log('\n6. Règle pure — Rapports sans canViewCost / canViewCost sans Rapports')
  const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
  const { resolvePermission, canViewCost } = jiti(ROOT + '/lib/permissions/index.ts')
  const { reportSections } = jiti(ROOT + '/lib/api/report-sections.ts')
  const accessFor = (role, stored = null) => ({ shopId: 'x', role, view: f => resolvePermission(stored, role, f).view, cost: canViewCost(stored, role) })
  const viewer = reportSections(accessFor('viewer'))
  ok(!!viewer && viewer.encaisse && viewer.transactions && viewer.margin === false, 'Observateur (Rapports, pas de coût) : CA / ventes / paiements, AUCUNE marge')
  // Depuis le 25 oct. 2026, le coût n'est plus accordé par défaut au Gestionnaire de stock : réglage explicite ici
  const smCost = { stock_manager: { view_purchase_cost: true } }
  ok(reportSections(accessFor('stock_manager', smCost)) === null && accessFor('stock_manager', smCost).cost === true, 'Gestionnaire de stock (coûts, pas de Rapports) : aucune section')
  const mgrS = reportSections(accessFor('manager'))
  ok(!!mgrS && mgrS.margin === true, 'Gérant (Rapports + coûts) : marge autorisée')
  const cashierOn = reportSections(accessFor('cashier', { cashier: { reports: true } }))
  ok(!!cashierOn && cashierOn.ownSalesOnly === true && cashierOn.margin === false, 'Caissier avec Rapports activés : ses ventes seulement, aucune marge')

  // ══ 7. Écrans (lecture seule, vitrine) : tableau de bord et Rapports passent par le serveur ══
  console.log('\n7. Écrans — tableau de bord et Rapports (lecture seule, écritures bloquées)')
  const { session } = require('./lib/capture.js')
  const screen = async (email, pathName) => {
    const s = await session({ width: 1366, height: 900, email })
    s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
    s.direct = []; s.page.on('request', rq => { const u = rq.url(); if (/\/rest\/v1\/(payments|expenses)\?/.test(u)) s.direct.push(u) })
    await s.page.addInitScript(() => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', 'all') } } catch {} })
    await s.page.goto(`${BASE}/fr/${pathName}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await s.page.waitForTimeout(9000)
    return s
  }
  let s = await screen('ghislainx123@gmail.com', 'reports')
  const repText = await s.page.locator('main').innerText()
  ok(/Chiffre d.affaires/i.test(repText) && s.errors.length === 0, `Rapports (propriétaire) : affichés, aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  ok(s.direct.length === 0, `Rapports : plus aucune lecture directe des paiements / dépenses par le navigateur (${s.direct.length})`)
  await s.browser.close()
  s = await screen('ghislainx123@gmail.com', 'dashboard')
  ok(s.errors.length === 0 && /Revenus|Chiffre|Encaiss/i.test(await s.page.locator('main').innerText()), `tableau de bord (propriétaire) : affiché, aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  ok(s.direct.length === 0, `tableau de bord : plus aucune lecture directe des paiements / dépenses par le navigateur (${s.direct.length})`)
  await s.browser.close()
  s = await screen('ghislainx123+fatou@gmail.com', 'dashboard')
  ok(s.errors.length === 0 && s.direct.length === 0, `tableau de bord (caissière) : affiché, aucune lecture directe des paiements / dépenses${s.errors.length ? ' · ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
