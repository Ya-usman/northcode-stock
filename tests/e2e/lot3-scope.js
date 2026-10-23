// Lot 3 — Dépenses (+ budgets) et Notes en contexte boutique. LECTURE SEULE (compte vitrine Marché Soleil) : toute
// écriture /api et /rest/v1 interceptée (corps relu) ; boutique active cachée volontairement sur Bastos. La dépense
// hors connexion reste dans un navigateur ÉPHÉMÈRE fermé encore hors ligne (aucune synchronisation possible).
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE } = require('./lib/capture.js')
const ExcelJS = require(ROOT + '/node_modules/exceljs')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const FULL = { [AKWA]: 'Marché Soleil Akwa', [BONA]: 'Marché Soleil Bonapriso', [BASTOS]: 'Marché Soleil Bastos' }
let pass = 0, fail = 0
// Fermeture d'un navigateur encore hors ligne : rejet interne de Playwright, sans rapport avec l'app
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
process.on('uncaughtException', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const low = x => String(x || '').toLowerCase()

async function open(path, { shop = null, width = 1366, height = 900, offFeature = null } = {}) {
  const s = await session({ width, height, scale: 1, locale: 'fr' })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.writes = []; s.errors = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  if (offFeature) {
    await s.page.route(/\/rest\/v1\/(shops|shop_members)\?/, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const res = await route.fetch(); let body = await res.text()
      try {
        const patch = x => { if (Array.isArray(x)) return x.map(patch); if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = patch(v); if (o.id === BASTOS && 'role_permissions' in o) o.role_permissions = { ...(o.role_permissions || {}), general: { ...((o.role_permissions || {}).general || {}), [offFeature]: false } }; return o } return x }
        body = JSON.stringify(patch(JSON.parse(body))).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false')
      } catch {}
      return route.fulfill({ response: res, body })
    })
  }
  const record = route => {
    const r = route.request(), url = new URL(r.url())
    if (['GET', 'HEAD'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    return route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.startsWith('/rest/') ? '[]' : JSON.stringify({ ok: true, data: { id: 'x' } }) })
  }
  await s.page.route(/\/api\//, record)
  await s.page.route(/\/rest\/v1\/(notes|expenses|expense_budgets)/, record)
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6500)
  return s
}
const pickerOptions = async page => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); return p.locator('[data-shop-option]').evaluateAll(els => els.map(e => e.getAttribute('data-shop-option'))) }
const pick = async (page, id) => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); await p.locator(`[data-shop-option="${id}"]`).click(); await page.waitForTimeout(1200) }
const lastWrite = (s, path, method) => [...s.writes].reverse().find(w => w.path === path && (!method || w.method === method))
const readStore = (page, store) => page.evaluate(store => new Promise(res => { const r = indexedDB.open('stockshop-offline'); r.onsuccess = () => { try { const q = r.result.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]) } catch { res([]) } }; r.onerror = () => res([]) }), store)

;(async () => {
  const month = new Date().toISOString().slice(0, 7)
  const exps = (await db.from('expenses').select('id, shop_id, description, date, is_recurring').in('shop_id', [AKWA, BONA, BASTOS]).eq('is_recurring', false).gte('date', month + '-01')).data
  const akwaExp = exps.find(e => e.shop_id === AKWA)
  const shopsWithExp = [...new Set(exps.map(e => e.shop_id))]
  console.log(`Repères : ${exps.length} dépenses ce mois (${shopsWithExp.map(x => FULL[x]).join(', ')}), budgets à Akwa seulement`)

  console.log('\n1. Dépenses en « Toutes » (boutique cachée : Bastos)')
  let s = await open('expenses'); let page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  const shopsOnRows = await page.locator('[data-expense-shop]').allInnerTexts()
  ok(shopsOnRows.length === exps.length && shopsOnRows.every(x => Object.values(FULL).includes(x.trim())), `chaque ligne rappelle sa boutique (${shopsOnRows.length} lignes)`)
  const groups = await page.locator('[data-budget-shop]').evaluateAll(els => els.map(e => e.getAttribute('data-budget-shop')))
  const akwaGroup = page.locator(`[data-budget-shop="${AKWA}"]`)
  ok(groups.includes(AKWA) && /Marché Soleil Akwa/.test(await akwaGroup.innerText()) && /\//.test(await akwaGroup.innerText()),
    `budgets PAR boutique : sections ${groups.map(g => FULL[g]).join(', ')} ; budgets d’Akwa comparés à ses dépenses (avant : budgets de la boutique cachée Bastos — aucun — face à toutes les dépenses)`)
  await akwaGroup.locator('button[aria-label]').first().click(); await page.waitForTimeout(800)
  const bd = page.getByTestId('budget-dialog'); await bd.waitFor({ timeout: 8000 })
  ok(low(await bd.innerText()).includes('marché soleil akwa'), 'fenêtre de budget : « Budgets · Marché Soleil Akwa »')
  await bd.locator('#budget-amount').fill('123456'); await page.waitForTimeout(300)
  await bd.getByRole('button', { name: /Enregistrer/ }).last().click(); await page.waitForTimeout(1500)
  let w = lastWrite(s, '/api/expenses/budgets', 'PUT')
  ok(w && w.body.shop_id === AKWA, `budget enregistré dans ${FULL[w?.body.shop_id] || w?.body.shop_id} (intercepté)`)
  // Nouvelle dépense : boutique choisie
  await page.getByTestId('expenses-add').click()
  const opts = await pickerOptions(page)
  ok(opts.length === 3 && await page.getByTestId('expense-drawer').count() === 0, `nouvelle dépense : « Dans quelle boutique ? » (${opts.length} boutiques), aucun panneau avant le choix`)
  await pick(page, BONA)
  const dr = page.getByTestId('expense-drawer'); await dr.waitFor({ timeout: 8000 })
  ok(low(await dr.innerText()).includes('boutique : marché soleil bonapriso'), 'panneau : « Boutique : Marché Soleil Bonapriso »')
  await dr.locator('#expense-amount').fill('2500'); await dr.locator('#expense-description').fill('TEST dépense lot 3')
  await dr.getByRole('button', { name: /^Ajouter/ }).last().click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/expenses', 'POST')
  ok(w && w.body.shop_id === BONA, `dépense envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (interceptée)`)
  // Modification d'une dépense d'Akwa : sa boutique
  const row = page.locator('[data-testid="expense-row"]').filter({ hasText: akwaExp.description }).first()
  await row.locator('button[aria-label="Modifier"]').click(); await dr.waitFor({ timeout: 8000 })
  ok(low(await dr.innerText()).includes('boutique : marché soleil akwa'), `modification de « ${akwaExp.description} » : « Boutique : Marché Soleil Akwa »`)
  await dr.locator('#expense-description').fill(akwaExp.description + ' '); await page.waitForTimeout(200)
  await dr.getByRole('button', { name: /Enregistrer/ }).last().click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/expenses', 'PATCH')
  ok(w && w.body.shop_id === AKWA, `modification envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (boutique de la dépense)`)
  // Export Excel : colonne Boutique, titre « Toutes les boutiques »
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), (async () => { await page.getByRole('button', { name: /Télécharger/ }).first().click(); await page.getByTestId('export-xlsx').click() })()])
  const file = `${__dirname}/out/lot3-export.xlsx`; await dl.saveAs(file)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file)
  const sheetText = wb.worksheets.map(ws => ws.getSheetValues().flat().join(' ')).join(' ')
  ok(/Boutique/.test(sheetText) && /Marché Soleil Akwa/.test(sheetText) && /Toutes les boutiques/.test(sheetText), 'Excel : colonne « Boutique », intitulé « Toutes les boutiques » (plus le nom de la boutique cachée)')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n2. Dépense hors connexion : dans la boutique choisie')
  s = await open('expenses'); page = s.page
  await s.page.context().setOffline(true); await page.waitForTimeout(4000)
  await page.getByTestId('expenses-add').click(); await pick(page, BASTOS)
  const dr2 = page.getByTestId('expense-drawer'); await dr2.waitFor({ timeout: 8000 })
  await dr2.locator('#expense-amount').fill('1500'); await dr2.locator('#expense-description').fill('TEST dépense hors ligne lot 3')
  await dr2.getByRole('button', { name: /Ajouter/ }).last().click(); await page.waitForTimeout(2000)
  const pend = await readStore(page, 'pending_expenses')
  ok(pend.length === 1 && pend[0].shop_id === BASTOS, `mise en file hors connexion dans ${FULL[pend[0]?.shop_id] || pend[0]?.shop_id} (avant : boutique cachée)`)
  await s.browser.close() // fermé ENCORE hors ligne : la file éphémère disparaît, aucune synchronisation

  console.log('\n3. Une boutique précise : une seule section de budgets')
  s = await open('expenses', { shop: AKWA }); page = s.page
  const g2 = await page.locator('[data-budget-shop]').evaluateAll(els => els.map(e => e.getAttribute('data-budget-shop')))
  ok(g2.length === 1 && g2[0] === AKWA && !/Marché Soleil Akwa/.test(await page.getByTestId('expenses-budgets').innerText()) && await page.locator('[data-expense-shop]').count() === 0,
    'Akwa : budgets d’Akwa seulement, sans titre de boutique ni nom sur les lignes')
  await page.getByTestId('expenses-add').click(); await page.waitForTimeout(1200)
  ok(await page.getByTestId('shop-picker').count() === 0 && await page.getByTestId('expense-drawer').isVisible(), 'nouvelle dépense : Akwa, sans question')
  await s.browser.close()

  console.log('\n4. Notes')
  s = await open('notes'); page = s.page
  const toolbar = await page.locator('main').innerText()
  ok(!/Toutes les boutiques\s*▾|Marché Soleil Akwa\s*▾/.test(toolbar) && await page.locator('main button[aria-haspopup="listbox"]').count() === 0, 'plus aucun sélecteur de boutique dans la page (l’en-tête seul décide)')
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  await page.getByRole('button', { name: /Nouvelle note/ }).first().click()
  const nOpts = await pickerOptions(page)
  await pick(page, AKWA)
  const ns = page.getByTestId('note-shop'); await ns.waitFor({ timeout: 8000 })
  ok(nOpts.length === 3 && /Marché Soleil Akwa/.test(await ns.innerText()) && await page.getByRole('dialog').locator('select').count() === 0, 'nouvelle note : boutique choisie, rappelée, non modifiable (plus de liste de toutes les boutiques)')
  await page.getByRole('dialog').locator('textarea').fill('TEST note lot 3'); await page.waitForTimeout(200)
  await page.getByRole('dialog').getByRole('button', { name: /Créer|Enregistrer|Ajouter/ }).last().click(); await page.waitForTimeout(1500)
  w = s.writes.find(x => x.path === '/rest/v1/notes' && x.method === 'POST')
  ok(w && w.body.shop_id === AKWA, `note créée dans ${FULL[w?.body.shop_id] || w?.body.shop_id} (interceptée)`)
  await s.browser.close()

  console.log('\n5. Navigation : droit par boutique (« Dépenses » coupé à Bastos, dans ce navigateur)')
  s = await open('expenses', { shop: BASTOS, offFeature: 'expenses' }); page = s.page
  ok(!/Dépenses/.test(await page.locator('aside nav').innerText().catch(() => '')), 'en-tête Bastos : « Dépenses » absent')
  await s.browser.close()
  s = await open('expenses', { offFeature: 'expenses' }); page = s.page
  ok(/Dépenses/.test(await page.locator('aside nav').innerText().catch(() => '')), '« Toutes » : « Dépenses » présent (droit à Akwa et Bonapriso)')
  await page.getByTestId('expenses-add').click()
  const o5 = await pickerOptions(page)
  ok(o5.length === 2 && !o5.includes(BASTOS), `nouvelle dépense : boutiques autorisées seulement (${o5.map(x => FULL[x]).join(', ')})`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
