// Lot 4 — Crédits et Historique des ventes en contexte boutique. LECTURE SEULE (compte vitrine Marché Soleil) : toute
// écriture /api et /rest/v1 est interceptée (corps relu, jamais envoyée) ; boutique active cachée volontairement sur
// Bastos pour prouver qu'elle n'est plus jamais utilisée.
// Usage : CAPTURE_BASE=http://localhost:3000 node lot4-scope.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE } = require('./lib/capture.js')
const ExcelJS = require(ROOT + '/node_modules/exceljs')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const SHOPS = [AKWA, BONA, BASTOS]
const OWNER = 'ghislainx123@gmail.com', FATOU = 'ghislainx123+fatou@gmail.com', MARIAM = 'ghislainx123+mariam@gmail.com'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
// Fermeture d'un navigateur pendant une navigation : rejet interne de Playwright, sans rapport avec l'app
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
// Écritures de fond de l'application, sans rapport avec Crédits / Historique (dernière activité du profil, rôle de la
// session) : interceptées comme les autres, mais pas comptées comme une action de l'écran
const BACKGROUND = w => (w.method === 'PATCH' && w.path === '/rest/v1/profiles') || w.path === '/api/auth/set-role'
const userWrites = s => s.writes.filter(w => !BACKGROUND(w))
const low = x => String(x || '').toLocaleLowerCase('fr')

async function open(path, { email = OWNER, shop = null, width = 1366, height = 900 } = {}) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  // En-tête : « Toutes » (ou la boutique demandée) ; boutique active cachée sur Bastos
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.writes = []; s.errors = []; s.requests = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('request', r => s.requests.push(r.url()))
  const record = route => {
    const r = route.request(), url = new URL(r.url())
    if (['GET', 'HEAD'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, body })
    return route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.startsWith('/rest/') ? '[]' : '{}' })
  }
  await s.page.route(/\/api\//, record)
  await s.page.route(/\/rest\/v1\//, record)
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(7000)
  return s
}
const pickerOptions = async page => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); return p.locator('[data-shop-option]').evaluateAll(els => els.map(e => e.getAttribute('data-shop-option'))) }
const pick = async (page, id) => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); await p.locator(`[data-shop-option="${id}"]`).click(); await page.waitForTimeout(1500) }
const xlsxText = async (page, trigger, name) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()])
  const file = `${__dirname}/out/${name}.xlsx`; await dl.saveAs(file)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file)
  return wb.worksheets.map(ws => ws.getSheetValues().flat().join(' ')).join(' ')
}

;(async () => {
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users
  const fatouId = users.find(u => u.email === FATOU).id
  const { data: sales } = await db.from('sales').select('id, shop_id, sale_number, payment_status, sale_status, balance').in('shop_id', SHOPS).eq('sale_status', 'active').order('created_at', { ascending: false }).limit(400)
  const bastosSale = sales.find(x => x.shop_id === BASTOS)
  const pendingSale = sales.find(x => ['pending', 'partial'].includes(x.payment_status) && Number(x.balance) > 0)

  // ══ 1. Crédits — propriétaire, « Toutes les boutiques » ══════════════════
  console.log('1. Crédits — propriétaire, « Toutes les boutiques » (boutique cachée sur Bastos)')
  let s = await open('payments'); let page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  const cardShops = await page.locator('[data-debtor-shop]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-debtor-shop')))])
  ok(cardShops.length >= 1 && cardShops.every(id => SHOPS.includes(id)), `dettes de toutes les boutiques du contexte, chaque carte rattachée à sa boutique (${cardShops.length} boutique(s))`)
  // Reprise de dette : choix explicite, jamais la boutique cachée
  await page.getByTestId('opening-open').click()
  const opts = await pickerOptions(page)
  ok(opts.length === 3 && await page.getByTestId('opening-drawer').count() === 0, `« Ajouter une dette existante » → « Dans quelle boutique ? » (${opts.length} boutiques), aucun panneau avant le choix`)
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(600)
  ok(await page.getByTestId('opening-drawer').count() === 0, 'annuler le choix : rien n’est ouvert, aucune boutique prise à la place')
  await page.getByTestId('opening-open').click(); await pick(page, BONA)
  const dr = page.getByTestId('opening-drawer'); await dr.waitFor({ timeout: 10000 })
  ok(low(await page.getByTestId('opening-shop').innerText()).includes('marché soleil bonapriso') && await page.getByTestId('opening-shops').count() === 0,
    'panneau de reprise : « Boutique : Marché Soleil Bonapriso » rappelée, plus de boutons de boutique présélectionnés')
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  // Journal : toutes les boutiques du contexte
  await page.getByRole('button', { name: /^Journal/ }).click(); await page.waitForTimeout(2500)
  const auditReq = s.requests.find(u => u.includes('/api/payments/audit'))
  const auditShops = auditReq ? (new URL(auditReq).searchParams.get('shop_ids') || '').split(',') : []
  ok(auditShops.length === 3 && SHOPS.every(id => auditShops.includes(id)), `journal des crédits : les 3 boutiques demandées (avant : boutique cachée seule) (${auditShops.length})`)
  await page.getByRole('button', { name: /^Crédits en cours|^En cours/ }).first().click().catch(() => {}); await page.waitForTimeout(800)
  // Export Excel : colonne Boutique, intitulé « Toutes les boutiques »
  const txt = await xlsxText(page, async () => { await page.getByRole('button', { name: /Exporter en PDF|Export/ }).first().click(); await page.getByTestId('export-xlsx').click() }, 'lot4-debts')
  ok(/Boutique/.test(txt) && /Toutes les boutiques/.test(txt), 'Excel des créances : colonne « Boutique », intitulé « Toutes les boutiques »')
  // Remboursement : modes de paiement du pays de la boutique DE LA DETTE
  await page.getByTestId('debtor-repay').first().click(); await page.waitForTimeout(1000)
  const dlg = await page.getByRole('dialog').last().innerText()
  ok(/MTN|Orange/i.test(dlg), 'remboursement : modes de paiement du pays de la dette (Mobile Money du Cameroun)')
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  ok(userWrites(s).length === 0, `aucune écriture de l’écran (${userWrites(s).map(w => w.method + ' ' + w.path).join(', ') || '0'}) — toutes interceptées de toute façon`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  // (Changement de boutique pendant une fenêtre ouverte : impossible pour l'utilisateur — la fenêtre recouvre l'en-tête ;
  //  la fermeture au changement de contexte reste un filet de sécurité, comme dans les lots précédents.)

  console.log('\n2. Caissière d’Akwa (une seule boutique) : pas de badge, pas de journal')
  s = await open('payments', { email: FATOU }); page = s.page
  ok(await page.getByTestId('shop-scope-badge').count() === 0, 'aucun badge de contexte')
  ok(await page.getByRole('button', { name: /^Journal/ }).count() === 0, 'onglet « Journal » absent (rôle hors direction)')
  const fShops = await page.locator('[data-debtor-shop]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-debtor-shop')))])
  ok(fShops.every(id => id === AKWA), `dettes d’Akwa seulement (${fShops.length} boutique)`)
  await s.browser.close()

  console.log('\n3. Navigation (règle D2) — gestionnaire de stock de Bastos : ni Crédits ni Historique')
  s = await open('stock', { email: MARIAM }); page = s.page
  const links = await page.locator('aside a, nav a').evaluateAll(els => els.map(e => e.getAttribute('href')))
  ok(!links.some(h => /\/payments$/.test(h || '')) && !links.some(h => /\/sales\/history$/.test(h || '')), 'menu sans « Crédits » ni « Historique des ventes » (aucun droit dans aucune boutique)')
  await s.browser.close()

  // ══ 5. Historique des ventes ═════════════════════════════════════════════
  console.log('\n4. Historique des ventes — propriétaire, « Toutes les boutiques »')
  s = await open('sales/history'); page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  // Période : l'année (assez de ventes dans chaque boutique)
  await page.locator('main button[role="combobox"]').first().click(); await page.getByRole('option', { name: /^Année$|^Cette année$/ }).click(); await page.waitForTimeout(5000)
  const rowShops = await page.locator('[data-sale-shop]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-sale-shop')))])
  ok(rowShops.length >= 2 && rowShops.every(id => SHOPS.includes(id)), `ventes de plusieurs boutiques, chacune rattachée à sa boutique (${rowShops.length})`)
  // Modification d'une vente de Bastos : produits et modes de paiement de Bastos
  if (bastosSale && await page.locator(`[data-sale-row="${bastosSale.id}"]`).count()) {
    await page.locator(`[data-sale-row="${bastosSale.id}"]`).click(); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^Modifier$/ }).first().click(); await page.waitForTimeout(900)
    const before = s.requests.length
    await page.getByPlaceholder(/Rechercher un produit/).last().fill('a'); await page.waitForTimeout(1500)
    const prodReq = s.requests.slice(before).find(u => u.includes('/rest/v1/products'))
    ok(!!prodReq && prodReq.includes(`shop_id=eq.${BASTOS}`) && !prodReq.includes('shop_id=in.'), `modification de ${bastosSale.sale_number} (Bastos) : produits de Bastos seulement (avant : toutes les boutiques)`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  } else ok(false, 'vente de Bastos introuvable dans la liste')
  // Encaissement : modes de paiement du pays de la vente (avant : liste figée Espèces / Virement / Paystack)
  if (pendingSale && await page.locator(`[data-sale-row="${pendingSale.id}"]`).count()) {
    await page.locator(`[data-sale-row="${pendingSale.id}"]`).click(); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^Valider paiement$/ }).first().click(); await page.waitForTimeout(800)
    await page.getByRole('dialog').last().locator('button[role="combobox"]').click(); await page.waitForTimeout(400)
    const methods = await page.getByRole('option').allInnerTexts()
    ok(methods.length >= 3 && !methods.some(m => /Paystack/i.test(m)) && methods.some(m => /MTN|Orange/i.test(m)), `encaissement : modes du pays de la vente (${methods.join(', ')})`)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  } else ok(true, 'aucune vente à encaisser dans la période : contrôle sans objet')
  // Journal : toutes les boutiques du contexte
  await page.getByRole('button', { name: /Journal/ }).first().click(); await page.waitForTimeout(3000)
  const logsReq = s.requests.find(u => u.includes('/api/sales/logs'))
  const logShops = logsReq ? (new URL(logsReq).searchParams.get('shop_ids') || '').split(',') : []
  ok(SHOPS.every(id => logShops.includes(id)), 'journal des ventes : les 3 boutiques demandées')
  await page.getByRole('button', { name: /^Ventes$/ }).first().click(); await page.waitForTimeout(3000)
  const htxt = await xlsxText(page, async () => { await page.getByRole('button', { name: /Exporter en PDF/ }).first().click(); await page.getByTestId('export-xlsx').click() }, 'lot4-sales').catch(e => 'ERREUR ' + e.message)
  ok(/Toutes les boutiques/.test(htxt) && /Boutique/.test(htxt), 'Excel des ventes : intitulé « Toutes les boutiques », colonne Boutique')
  ok(userWrites(s).length === 0, `aucune écriture de l’écran (${userWrites(s).map(w => w.method + ' ' + w.path).join(', ') || '0'}) — toutes interceptées de toute façon`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n5. Historique — caissière d’Akwa : ses propres ventes seulement')
  s = await open('sales/history', { email: FATOU }); page = s.page
  // Liste et statistiques (le simple comptage « la boutique a-t-elle déjà vendu ? » n'est pas concerné)
  const salesReq = s.requests.filter(u => u.includes('/rest/v1/sales?') && !/select=id(&|$)/.test(u))
  ok(salesReq.length > 0 && salesReq.every(u => u.includes(`cashier_id=eq.${fatouId}`)), 'requêtes des ventes filtrées sur ses propres ventes (boutique où elle est caissière)')
  ok(await page.getByRole('button', { name: /Journal/ }).count() === 0, 'onglet « Journal » absent')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
