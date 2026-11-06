// Dépenses par jour du calendrier LOCAL (correctif du 6 nov. 2026) — compte de démonstration, fuseau de Douala.
// Avant : « Aujourd'hui » comptait les dépenses de la veille, « Dépenses du mois » celles du dernier jour du mois
// précédent (bornes UTC coupées). Attentes calculées depuis la base (lecture seule), selon les jours de Douala.
// Usage : CAPTURE_BASE=http://localhost:<port> CAPTURE_TZ=Africa/Douala node tests/e2e/expense-days-ux.js
const fs = require('fs')
const path = require('path')
const { session, BASE } = require('./lib/capture.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const EMAIL = 'stocshopci+demo@gmail.com'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/[\s  ]+/g, ' ').trim()
const num = s => Number(String(s).replace(/[^\d]/g, ''))
const douala = (offsetDays = 0) => new Date(Date.now() + 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10)

;(async () => {
  if (process.env.CAPTURE_TZ !== 'Africa/Douala') throw new Error('CAPTURE_TZ=Africa/Douala obligatoire (le défaut ne se voit qu\'à l\'est de UTC)')
  // Attentes : dépenses réelles des boutiques du compte, par jour de Douala
  const users = []
  for (let page = 1; page < 30; page++) { const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 }); users.push(...data.users); if (data.users.length < 1000) break }
  const owner = users.find(u => u.email === EMAIL)
  const { data: shops } = await db.from('shops').select('id').eq('owner_id', owner.id).is('deleted_at', null)
  const { data: exps } = await db.from('expenses').select('date, amount').in('shop_id', shops.map(s => s.id)).eq('is_recurring', false).gte('date', douala(-40))
  const sum = f => exps.filter(e => f(e.date)).reduce((n, e) => n + Number(e.amount), 0)
  const today = douala(), yesterday = douala(-1), monthStart = today.slice(0, 8) + '01'
  const want = { today: sum(d => d === today), yesterday: sum(d => d === yesterday), month: sum(d => d >= monthStart && d <= today), before: sum(d => d === douala(-Number(today.slice(8)))) }
  console.log('  attendu (base) :', JSON.stringify(want))

  const s = await session({ width: 1440, height: 900, email: EMAIL })
  const p = s.page
  await p.route(/\/api\/reports\/margin$/, r => r.continue())
  const errors = []; p.on('pageerror', e => errors.push(e.message.slice(0, 160)))

  await p.goto(`${BASE}/fr/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(14000)
  const dash = norm(await p.locator('main').innerText())
  const m = dash.match(/Dépenses du mois \S+ F CFA ([\d ]+) F CFA/)
  ok(m && num(m[1]) === want.month, `tableau de bord : « Dépenses du mois » = ${want.month} (sans le ${douala(-Number(today.slice(8)))}, ${want.before})`, m && m[1])

  await p.goto(`${BASE}/fr/reports`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(10000)
  const readExp = async () => { const t = norm(await p.locator('main').innerText()); const x = t.match(/Dépenses ([\d ]+) F CFA/); return x ? num(x[1]) : null }
  const todayShown = await readExp()
  ok(todayShown === want.today, `Rapports « Aujourd'hui » : dépenses = ${want.today} (pas celles d'hier, ${want.yesterday})`, todayShown)
  await p.screenshot({ path: path.join(__dirname, 'out', 'expense-days-today.png') })
  // « Hier »
  await p.locator('main button[role="combobox"]').first().click(); await wait(500)
  await p.getByRole('option', { name: 'Hier', exact: true }).click(); await wait(8000)
  const yShown = await readExp()
  ok(yShown === want.yesterday, `Rapports « Hier » : dépenses = ${want.yesterday}`, yShown)
  await p.screenshot({ path: path.join(__dirname, 'out', 'expense-days-yesterday.png') })
  ok(errors.length === 0, `aucune erreur JS (${errors.join(' | ')})`)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
