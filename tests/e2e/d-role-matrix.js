// Étape D — vérification complète par rôle, EN LIGNE, LECTURE SEULE (lib/capture.js bloque toute écriture).
// Pour chaque compte réel : droits attendus calculés avec la VRAIE règle (lib/permissions) à partir des réglages relus en
// base, puis : écrans (y compris ceux non autorisés, par l'adresse), routes sensibles appelées avec sa propre session,
// toutes les réponses reçues, trames temps réel brutes, localStorage + IndexedDB, exports, capture d'écran.
// Usage : OUT_DIR=<dossier> node tests/e2e/d-role-matrix.js
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const ExcelJS = require(ROOT + '/node_modules/exceljs')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out', 'd-role-matrix')
fs.mkdirSync(OUT, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const rows = []
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`); return c }

const ALPHA = 'a0000000-0000-0000-0000-000000000001', AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const ACCOUNTS = [
  ['Propriétaire (vitrine)', 'ghislainx123@gmail.com', AKWA],
  ['Responsable', 'ghislainx123+jeanpaul@gmail.com', AKWA],
  ['Manager', 'cassierstock@gmail.com', ALPHA],
  ['Magasinier avec coût (181)', 'ghislainx123+mariam@gmail.com', BASTOS],
  ['Magasinier par défaut', 'stocshopci+magasinier@gmail.com', ALPHA],
  ['Caissière (vitrine)', 'ghislainx123+fatou@gmail.com', AKWA],
  ['Caissier (Alpha)', 'stocshopci@gmail.com', ALPHA],
  ['Observateur', 'stocshopci+observateur@gmail.com', ALPHA],
]
const PAGES = ['dashboard', 'stock/products', 'stock', 'stock/expiry', 'stock/movements', 'stock/transfers', 'suppliers', 'suppliers?view=purchase_orders', 'payments', 'reports']
const COST_RE = /"(buying_price|price_from|price_to|value_delta)"\s*:\s*-?\d|"(cogs|stock_buying_value|product_costs)"\s*:/
const POLINE_PRICE_RE = /"purchase_order_items"\s*:\s*\[[^\]]*"unit_price"/
const DEBT_RE = /"total_owed"\s*:\s*-?\d/

// Fermeture d'un navigateur pendant une navigation encore en cours : erreur interne de Playwright, sans effet sur le test
process.on('unhandledRejection', e => { if (!/Target page, context or browser has been closed/.test(String(e?.message || e))) { console.error('ERREUR', e); process.exit(1) } })
process.on('uncaughtException', e => { if (!/Target page, context or browser has been closed/.test(String(e?.message || e))) { console.error('ERREUR', e); process.exit(1) } })

;(async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'lib/permissions/index.ts')).href)
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  for (const [label, email, shop] of ACCOUNTS) {
    console.log(`\n══ ${label} — ${email}`)
    const u = users.users.find(x => x.email === email)
    const m = u && (await db.from('shop_members').select('role').eq('shop_id', shop).eq('user_id', u.id).eq('is_active', true).single()).data
    const rp = (await db.from('shops').select('role_permissions').eq('id', shop).single()).data?.role_permissions ?? null
    if (!ok(!!m, `membre actif de la boutique (rôle ${m?.role})`)) continue
    const role = m.role
    const R = {
      cost: P.canViewCost(rp, role),
      debt: P.canView(rp, role, 'payments') && P.canView(rp, role, 'suppliers'),
      reports: P.canView(rp, role, 'reports'),
      suppliers: P.canView(rp, role, 'suppliers'),
      stock: P.canView(rp, role, 'stock'),
    }
    console.log(`  droits attendus (règle réelle) : coût ${R.cost ? 'OUI' : 'non'} · dette ${R.debt ? 'OUI' : 'non'} · rapports ${R.reports ? 'oui' : 'non'} · fournisseurs ${R.suppliers ? 'oui' : 'non'} · stock ${R.stock ? 'oui' : 'non'}`)
    const product = (await db.from('products').select('id').eq('shop_id', shop).eq('is_active', true).limit(1).single()).data
    const row = { label, role, ...R, results: {} }

    process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
    const s = await session({ width: 1366, height: 900, locale: 'fr' })
    const bodies = [], frames = [], errors = [], denied = []
    s.page.on('pageerror', e => errors.push(e.message.slice(0, 100)))
    s.page.on('response', async r => {
      const url = r.url(); if (!/\/api\/|\/rest\/v1\//.test(url)) return
      if (/\/rest\/v1\//.test(url) && (r.status() === 401 || r.status() === 403)) denied.push(`${r.status()} ${url.replace(/\?.*/, '')}`)
      try { bodies.push({ url, status: r.status(), t: await r.text() }) } catch {}
    })
    s.page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') frames.push(f.payload) }))
    // SEULE exception au blocage des écritures : POST /api/reports/margin est une LECTURE (calcul du coût des ventes
    // affichées, aucune écriture dans la route) — laissé passer pour tester ses droits avec la session du compte
    await s.page.route(/\/api\/reports\/margin$/, route => (route.request().method() === 'POST' ? route.continue() : route.fallback()))

    // 1. Écrans (y compris non autorisés, par l'adresse)
    for (const p of PAGES) {
      await s.page.goto(`${BASE}/fr/${p}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
      await wait(5500)
      if (p === 'payments') { await s.page.getByRole('button', { name: 'Je dois', exact: true }).first().click({ timeout: 2000 }).catch(() => {}); await wait(3000) }
      if (p === 'stock/products') await s.page.screenshot({ path: path.join(OUT, `${label.replace(/[^\p{L}0-9]+/gu, '-')}-produits.png`) })
    }

    // 2. Routes sensibles avec SA session (GET, et POST de lecture pour la marge)
    const api = (method, url, body) => s.page.evaluate(async ({ method, url, body }) => {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      return { status: r.status, t: await r.text() }
    }, { method, url, body })
    const probes = {
      costs: await api('GET', `/api/costs?shop_ids=${shop}&batches=1`),
      margin: await s.page.evaluate(async shop => { const r = await fetch('/api/reports/margin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_ids: [shop], sale_ids: [] }) }); return { status: r.status, t: await r.text() } }, shop).catch(() => ({ status: 0, t: '' })),
      balances: await api('GET', `/api/suppliers/balances?shop_ids=${shop}`),
      debts: await api('GET', `/api/supplier-payments/debts?shop_id=${shop}`),
      prices: await api('GET', `/api/product-supplier-prices?shop_id=${shop}`),
      orders: await api('GET', `/api/purchase-orders?shop_id=${shop}`),
      journal: await api('GET', `/api/audit/journal?shop_id=${shop}&feature=stock&limit=100`),
      detail: product ? await api('GET', `/api/stock/product-detail?shop_id=${shop}&product_id=${product.id}`) : { status: 0, t: '' },
      transfers: await api('GET', `/api/stock-transfers?shop_ids=${shop}`),
    }
    ok((probes.costs.status === 200) === R.cost, `/api/costs : ${probes.costs.status} (${R.cost ? 'autorisé' : 'refusé'} attendu)`)
    ok((probes.margin.status === 200) === (R.cost && R.reports), `/api/reports/margin : ${probes.margin.status} (${R.cost && R.reports ? 'autorisé' : 'refusé'} attendu)`)
    ok((probes.balances.status === 200) === R.debt, `/api/suppliers/balances : ${probes.balances.status} (${R.debt ? 'autorisé' : 'refusé'} attendu)`)
    ok((probes.debts.status === 200) === R.debt, `/api/supplier-payments/debts : ${probes.debts.status} (${R.debt ? 'autorisé' : 'refusé'} attendu)`)
    ok((probes.prices.status === 200) === R.cost, `/api/product-supplier-prices : ${probes.prices.status} (${R.cost ? 'autorisé' : 'refusé'} attendu)`)
    if (probes.orders.status === 200) {
      const list = JSON.parse(probes.orders.t).data || []
      const withPaid = list.some(p => 'amount_paid' in p || 'balance' in p || 'payment_status' in p)
      const withLine = list.some(p => (p.purchase_order_items || []).some(l => 'unit_price' in l))
      ok((list.length === 0 || withPaid === R.debt) && (list.length === 0 || !withLine || R.cost) && (!R.cost || !list.length || withLine || list.every(p => !(p.purchase_order_items || []).length)),
         `/api/purchase-orders (${list.length} bon(s)) : payé / solde ${withPaid ? 'présents' : 'absents'}, prix des lignes ${withLine ? 'présents' : 'absents'}`)
    } else ok(!R.suppliers, `/api/purchase-orders : ${probes.orders.status} (sans accès Fournisseurs)`)
    if (probes.journal.status === 200) ok(R.cost || !COST_RE.test(probes.journal.t), `/api/audit/journal : ${R.cost ? 'coûts permis' : 'aucun prix d’achat'}`)
    if (probes.detail.status === 200) ok(R.cost || !COST_RE.test(probes.detail.t), `/api/stock/product-detail : ${R.cost ? 'coût permis' : 'aucun coût'}`)
    if (probes.transfers.status === 200) ok(R.cost || !COST_RE.test(probes.transfers.t), `/api/stock-transfers : ${R.cost ? 'coûts permis' : 'aucun coût'}`)

    // 3. Tout ce qui a été reçu (écrans + sondes)
    const all = [...bodies, ...Object.entries(probes).map(([k, v]) => ({ url: `/sonde/${k}`, status: v.status, t: v.t }))]
    const ok200 = all.filter(b => b.status === 200)
    const costLeaks = R.cost ? [] : ok200.filter(b => COST_RE.test(b.t) || POLINE_PRICE_RE.test(b.t)).map(b => b.url.replace(/\?.*/, ''))
    const debtLeaks = R.debt ? [] : ok200.filter(b => DEBT_RE.test(b.t) || (/purchase-orders|supplier-payments/.test(b.url) && /"(amount_paid|balance|payment_status)"\s*:/.test(b.t))).map(b => b.url.replace(/\?.*/, ''))
    ok(costLeaks.length === 0, `réseau (${ok200.length} réponses) : ${R.cost ? 'coût permis' : 'aucun coût reçu'}${costLeaks.length ? ' — FUITE : ' + [...new Set(costLeaks)].join(', ') : ''}`)
    ok(debtLeaks.length === 0, `réseau : ${R.debt ? 'dettes permises' : 'aucune dette fournisseur reçue'}${debtLeaks.length ? ' — FUITE : ' + [...new Set(debtLeaks)].join(', ') : ''}`)
    ok(ok200.filter(b => /\/rest\/v1\//.test(b.url)).every(b => !/"buying_price"\s*:|"total_owed"\s*:/.test(b.t)), 'lectures directes de la base : jamais de buying_price ni de total_owed (même avec les droits)')
    ok(frames.every(f => !f.includes('buying_price') && !f.includes('total_owed')), `temps réel : ${frames.length} trame(s), aucune avec coût ni dette`)

    // 4. Stockage sur l'appareil
    const store = await s.page.evaluate(async () => {
      const ls = Object.keys(localStorage).map(k => [k, localStorage.getItem(k) || ''])
      const idb = []
      try {
        for (const d of (await indexedDB.databases?.()) || []) {
          const dbx = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
          for (const st of dbx.objectStoreNames) {
            const all = await new Promise(res => { const tx = dbx.transaction(st, 'readonly'); const rq = tx.objectStore(st).getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res([]) })
            idb.push([`${d.name}/${st}`, JSON.stringify(all)])
          }
          dbx.close()
        }
      } catch {}
      return { ls, idb }
    })
    const lsCost = store.ls.filter(([, v]) => v.includes('"buying_price"') || POLINE_PRICE_RE.test(v)).map(([k]) => k)
    const idbCost = store.idb.filter(([, v]) => v.includes('"buying_price"')).map(([k]) => k)
    const lsDebt = store.ls.filter(([k, v]) => DEBT_RE.test(v) && !(R.debt && /^pc_supplier_(debtors|payments_hist)_/.test(k))).map(([k]) => k)
    ok(lsCost.length === 0 && idbCost.length === 0, `appareil : aucun coût en localStorage (${store.ls.length} clés) ni en IndexedDB (${store.idb.length} magasins)${lsCost.concat(idbCost).length ? ' — ' + lsCost.concat(idbCost).join(', ') : ''}`)
    ok(lsDebt.length === 0, `appareil : dettes seulement dans les caches de dettes ${R.debt ? '(droit présent)' : '(aucune)'}${lsDebt.length ? ' — ' + lsDebt.join(', ') : ''}`)

    // 5. Exports (si l'écran est accessible)
    const exportCheck = async (pagePath, trigger, checkFn, name) => {
      await s.page.goto(`${BASE}/fr/${pagePath}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
      const t = s.page.locator(trigger).first()
      if (!(await t.count())) return null
      await t.click(); await wait(500)
      const dl = s.page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
      await s.page.locator('[data-testid="export-xlsx"]').first().click().catch(() => {})
      const d = await dl; if (!d) return 'aucun téléchargement'
      const f = path.join(OUT, `${label.replace(/[^\p{L}0-9]+/gu, '-')}-${name}.xlsx`); await d.saveAs(f)
      const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f)
      const ws = wb.worksheets[0]; const values = []
      ws.eachRow(r => values.push(r.values.slice(1).map(v => (v && typeof v === 'object' && 'result' in v ? v.result : v))))
      return checkFn(values)
    }
    if (R.stock) {
      const res = await exportCheck('stock/products', '[data-testid="products-more-actions"]', vals => {
        const head = (vals.find(r => r.some(c => /Prix d.achat/i.test(String(c)))) || [])
        const col = head.findIndex(c => /Prix d.achat/i.test(String(c)))
        if (col < 0) return R.cost ? 'colonne prix d’achat absente' : 'ok'
        const filled = vals.slice(vals.indexOf(head) + 1).filter(r => r[col] !== null && r[col] !== undefined && r[col] !== '' && !/total/i.test(String(r[0])))
        return R.cost ? (filled.length ? 'ok' : 'prix d’achat vides') : (filled.length ? `FUITE : ${filled.length} prix d’achat` : 'ok')
      }, 'export-produits')
      if (res !== null) ok(res === 'ok', `export Excel des produits : ${res === 'ok' ? (R.cost ? 'prix d’achat présents' : 'aucun prix d’achat') : res}`)
    }
    if (R.suppliers) {
      const res = await exportCheck('suppliers', '[data-testid="suppliers-files"]', vals => {
        const hasDebt = vals.some(r => r.some(c => /dû|Montant dû|Dette/i.test(String(c))))
        return hasDebt === R.debt ? 'ok' : (hasDebt ? 'FUITE : colonne dette' : 'colonne dette absente')
      }, 'export-fournisseurs')
      if (res !== null) ok(res === 'ok', `export Excel des fournisseurs : ${res === 'ok' ? (R.debt ? 'colonne dette présente' : 'sans colonne dette') : res}`)
    }
    ok(errors.length === 0 && denied.length === 0, `aucune erreur JavaScript ni lecture refusée${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}${denied.length ? ' — ' + [...new Set(denied)].join(', ') : ''}`)
    await wait(1500)
    await s.browser.close().catch(() => {})
    row.results = { costLeaks: costLeaks.length, debtLeaks: debtLeaks.length, probes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.status])) }
    rows.push(row)
  }
  fs.writeFileSync(path.join(OUT, 'matrice.json'), JSON.stringify(rows, null, 2))
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
