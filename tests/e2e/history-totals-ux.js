// Totaux de période de l'Historique calculés par la base (migration 218, 7 nov. 2026, état des lieux de la montée en
// charge). Avant : l'écran additionnait les lignes reçues, et la base n'en renvoie que 1000 par réponse : au-delà de
// 1000 ventes, nombre, CA, encaissé et reste dû étaient faux.
// LECTURE SEULE : compte de démonstration (Marché Soleil démo, plus de 1000 ventes sur l'année à Akwa) ; toute écriture
// est interceptée par lib/capture.js. Comparaison avec un calcul INDÉPENDANT (toutes les lignes lues page par page avec
// la clé serveur, additionnées ici), encadré avant / après car le compte de démonstration vend en continu.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/history-totals-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const AKWA_DEMO = '78e6e774-730f-48d5-8aed-b0cc9c1a4ce8', DEMO_OWNER = 'stocshopci+demo@gmail.com'
process.env.PIN_SHOP = AKWA_DEMO
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

// Même période que l'écran (« Cette année » : 1er janvier à minuit LOCAL jusqu'à la fin du jour local)
const now = new Date()
const START = new Date(now.getFullYear(), 0, 1).toISOString()
const END = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString()

async function allRows(build) {
  const rows = []
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build().range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}
// Calcul indépendant : ventes actives + annulées de la période ; encaissé = paiements non annulés, hors abandons
async function truth(shopIds) {
  const sales = await allRows(() => db.from('sales').select('id, total, balance, sale_status')
    .in('shop_id', shopIds).in('sale_status', ['active', 'cancelled']).gte('created_at', START).lte('created_at', END).order('id'))
  const pays = await allRows(() => db.from('payments').select('id, amount, sales!inner(shop_id)')
    .in('sales.shop_id', shopIds).eq('is_cancelled', false).eq('is_write_off', false).gte('paid_at', START).lte('paid_at', END).order('id'))
  return {
    count: sales.length,
    revenue: sales.reduce((s, r) => s + Number(r.total), 0),
    balance: sales.filter(r => r.sale_status !== 'cancelled').reduce((s, r) => s + Number(r.balance), 0),
    collected: pays.reduce((s, r) => s + Number(r.amount), 0),
  }
}
const between = (v, a, b) => v >= Math.min(a, b) - 0.005 && v <= Math.max(a, b) + 0.005

async function check(label, shopFilter, shopIds) {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: DEMO_OWNER })
  const errors = [], rpc = []
  s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  s.page.on('request', r => { if (/\/rest\/v1\/rpc\/(sales_period_totals|payments_period_collected)/.test(r.url())) rpc.push(r.method()) })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__f')) { sessionStorage.setItem('__f', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, shopFilter)
  await s.page.goto(`${BASE}/fr/sales/history`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  await s.page.getByTestId('sales-period').click(); await wait(400)
  await s.page.getByTestId('sales-preset-year').click()
  const before = await truth(shopIds)
  const stats = s.page.getByTestId('history-period-stats')
  await s.page.waitForFunction(() => Number(document.querySelector('[data-testid="history-period-stats"]')?.getAttribute('data-count') || 0) > 1000, null, { timeout: 60000 }).catch(() => {})
  const ui = await stats.evaluate(e => ({ count: +e.dataset.count, revenue: +e.dataset.revenue, collected: +e.dataset.collected, balance: +e.dataset.balance })).catch(() => null)
  const after = await truth(shopIds)
  ok(!!ui && ui.count > 1000, `${label} : plus de 1000 ventes sur l'année (${ui && ui.count})`, ui)
  ok(!!ui && between(ui.count, before.count, after.count), `${label} : nombre de ventes = la base (${before.count}…${after.count})`, { ui: ui && ui.count, before: before.count, after: after.count })
  ok(!!ui && between(ui.revenue, before.revenue, after.revenue), `${label} : chiffre d'affaires = la base`, { ui: ui && ui.revenue, before: before.revenue, after: after.revenue })
  ok(!!ui && between(ui.collected, before.collected, after.collected), `${label} : encaissé = la base`, { ui: ui && ui.collected, before: before.collected, after: after.collected })
  ok(!!ui && between(ui.balance, before.balance, after.balance), `${label} : reste dû = la base (ventes annulées exclues)`, { ui: ui && ui.balance, before: before.balance, after: after.balance })
  ok(rpc.length >= 2 && rpc.every(m => m === 'GET'), `${label} : totaux demandés à la base, en lecture (${rpc.join(', ')})`)
  const rows = await s.page.locator('main table tbody tr, main [data-sale-id]').count()
  ok(rows > 0, `${label} : la liste des ventes s'affiche (${rows} lignes)`)
  await s.page.screenshot({ path: `${OUT}/history-totals-${label.replace(/\W+/g, '-')}.png` })
  ok(errors.length === 0, `${label} : aucune erreur JavaScript`, errors)
  await s.browser.close()
}

;(async () => {
  const { data: demoShops } = await db.from('shops').select('id, entity_id').eq('entity_id', (await db.from('shops').select('entity_id').eq('id', AKWA_DEMO).single()).data.entity_id).is('deleted_at', null)
  const allIds = (demoShops || []).map(x => x.id)
  console.log('1. Boutique de démonstration Akwa, « Cette année »')
  await check('Akwa', AKWA_DEMO, [AKWA_DEMO])
  console.log('\n2. Toutes les boutiques de démonstration, « Cette année »')
  await check('Toutes', 'all', allIds)
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
