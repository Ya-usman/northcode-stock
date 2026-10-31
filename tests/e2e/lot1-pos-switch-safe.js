// Lot 1 — une vente ne survit jamais à un changement de boutique (Akwa → Bastos). MODE SÛR, compte vitrine Marché Soleil :
//  - serveur local obligatoire (store/capture.js refuse toute autre adresse sans drapeau lecture seule) ;
//  - service worker bloqué ; TOUTE écriture vers /api et /rest/v1 bloquée ; /api/sales/sync → 503 (aucune synchro possible) ;
//  - encaissements SIMULÉS (réponse fabriquée ou coupure réseau simulée) : aucune vente n'atteint le serveur ;
//  - contexte de navigateur éphémère, fermé alors que tout est encore bloqué : la vente mise en file disparaît avec lui.
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const readStore = (page, store) => page.evaluate(store => new Promise(res => { const r = indexedDB.open('stockshop-offline'); r.onsuccess = () => { try { const q = r.result.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]) } catch { res([]) } }; r.onerror = () => res([]) }), store)
const fakeSale = (n, shopId) => ({ already_existed: false, sale: {
  id: '33333333-3333-4333-8333-' + String(n).padStart(12, '0'), shop_id: shopId, sale_number: `TEST-${n}`, receipt_token: `tokswitch${n}abcdefgh`,
  total: 500, subtotal: 500, discount: 0, tax: 0, amount_paid: 500, balance: 0, payment_method: n === 1 ? 'mtn_momo' : 'cash',
  payment_status: 'paid', sale_status: 'active', created_at: new Date().toISOString(),
  sale_items: [{ id: 'i' + n, product_name: 'Article test', quantity: 1, unit_price: 500, subtotal: 500 }],
} })

;(async () => {
  const names = shop => db.from('products').select('name').eq('shop_id', shop).eq('is_active', true).gt('quantity', 2).order('name').then(r => r.data.map(p => p.name))
  const akwaProducts = await names(AKWA), bastosProducts = await names(BASTOS)
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  const page = s.page
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
  await page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} ; window.open = () => null }, AKWA)
  // Blocages (déclarés en premier = les moins prioritaires), puis réponses simulées
  const sent = { checkout: [], sync: 0, otherWrites: [] }
  await page.route(/\/api\//, r => { if (['GET', 'HEAD'].includes(r.request().method())) return r.fallback(); sent.otherWrites.push(new URL(r.request().url()).pathname); return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test : écriture bloquée"}' }) })
  await page.route(/\/rest\/v1\//, r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test : écriture bloquée"}' }))
  await page.route('**/api/sales/sync', r => { sent.sync++; return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test : synchro bloquée"}' }) })
  let mode = 'ok-akwa'
  await page.route('**/api/sales/checkout', r => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}') } catch {}
    sent.checkout.push({ mode, body })
    if (mode === 'abort') return r.abort('internetdisconnected')
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSale(mode === 'ok-akwa' ? 1 : 2, mode === 'ok-akwa' ? AKWA : BASTOS)) })
  })
  await page.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  const grid = page.locator('[data-tour="pos-grid"]')
  await grid.waitFor({ timeout: 60000 }); await page.waitForTimeout(2500)
  const addProduct = async name => { await grid.getByText(name, { exact: false }).first().click(); await page.waitForTimeout(600) }
  const receiptOpen = () => page.getByTestId('receipt-number').isVisible().catch(() => false)
  const closeReceipt = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(800) }
  // Vrais pluriels depuis le 31 oct. 2026 (« 1 facture en attente », plus « facture(s) »)
  const pendingBanner = () => page.getByText(/factures? en attente/).first().isVisible().catch(() => false)
  const nameField = page.getByPlaceholder(/Nom complet du client/).first()

  console.log('Akwa : facture en attente, vente (client + MTN MoMo), vente mise en file')
  await addProduct(akwaProducts[0])
  await page.getByRole('button', { name: /Mettre en attente/ }).first().click()
  await page.locator('form').getByRole('button', { name: /Mettre en attente/ }).click(); await page.waitForTimeout(1500)
  ok(await pendingBanner(), 'Akwa : « 1 facture en attente »')
  await addProduct(akwaProducts[1])
  await nameField.fill('TEST Client Akwa'); await page.waitForTimeout(500)
  await page.keyboard.press('Escape').catch(() => {})
  await page.getByRole('button', { name: /MTN MoMo/ }).first().click(); await page.waitForTimeout(400)
  await page.locator('[data-tour="pos-checkout"]:visible').first().click()
  await page.getByTestId('receipt-number').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200)
  const akwaReceipt = await page.getByRole('dialog').innerText()
  if (process.env.DBG) { console.log('DBG checkout', JSON.stringify(sent.checkout.map(c => ({ mode: c.mode, shop: c.body.shop_id, pm: c.body.payment_method })))); console.log('DBG dialog', akwaReceipt.slice(0, 300).split(String.fromCharCode(10)).join(' | ')); await page.screenshot({ path: __dirname + '/out/switch-dbg-1.png' }) }
  ok(akwaReceipt.includes('Marché Soleil Akwa') && sent.checkout[0]?.body.shop_id === AKWA && sent.checkout[0]?.body.payment_method === 'mtn_momo',
    'vente Akwa simulée : reçu « Marché Soleil Akwa », MTN MoMo, boutique Akwa envoyée')
  await closeReceipt()
  mode = 'abort'
  await addProduct(akwaProducts[2])
  await page.getByRole('button', { name: 'Montant exact' }).first().click().catch(() => {}); await page.waitForTimeout(300)
  await page.locator('[data-tour="pos-checkout"]:visible').first().click()
  await page.getByTestId('receipt-queued').waitFor({ timeout: 40000 }); await page.waitForTimeout(1500)
  let queued = await readStore(page, 'pending_sales')
  ok(queued.length === 1 && queued[0].shop_id === AKWA, `vente Akwa mise en file (coupure simulée) : ${queued.length} en file, boutique Akwa`)
  await closeReceipt()
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500)

  console.log('\nEn-tête → Bastos')
  await page.locator('aside button', { hasText: 'Marché Soleil Akwa' }).first().click(); await page.waitForTimeout(400)
  await page.locator('aside button', { hasText: 'Marché Soleil Bastos' }).last().click(); await page.waitForTimeout(4000)
  await grid.waitFor({ timeout: 30000 }); await page.waitForTimeout(1500)
  const main = await page.locator('main').innerText()
  ok(/Vendre dans:?\s*Marché Soleil Bastos/.test(main), 'caisse de Bastos (« Vendre dans : Marché Soleil Bastos »)')
  ok(!(await receiptOpen()) && await page.getByTestId('receipt-queued').count() === 0 && !(await page.getByRole('dialog').count()), 'aucun reçu Akwa (ni vente simulée, ni vente en file) affiché')
  ok(!(await pendingBanner()), 'aucune facture en attente d’Akwa')
  ok(await page.locator('[data-tour="pos-open-cart"]:visible').count() === 0 && await page.locator('[data-tour="pos-checkout"]:visible').isDisabled().catch(() => true), 'panier vide')
  ok((await nameField.inputValue().catch(() => '')) === '', 'aucun client d’Akwa (champ client vide)')
  queued = await readStore(page, 'pending_sales')
  ok(queued.length === 1 && queued[0].shop_id === AKWA, 'la vente en file reste à Akwa (ni supprimée, ni rattachée à Bastos)')

  console.log('\nVente Bastos (simulée)')
  mode = 'ok-bastos'
  const n0 = sent.checkout.length
  await addProduct(bastosProducts[0])
  await page.getByRole('button', { name: 'Montant exact' }).first().click().catch(() => {}); await page.waitForTimeout(300)
  await page.locator('[data-tour="pos-checkout"]:visible').first().click()
  await page.getByTestId('receipt-number').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200)
  const b = sent.checkout.slice(n0).find(c => c.mode === 'ok-bastos')?.body || {}
  ok(b.shop_id === BASTOS, 'encaissement envoyé vers Bastos')
  ok(b.payment_method === 'cash', `moyen de paiement : ${b.payment_method} (MTN MoMo d’Akwa non repris)`)
  ok(!b.customer_id && !b.customer_name && !b.customer_phone, 'aucun client d’Akwa dans la vente de Bastos')
  ok((b.items || []).length === 1, `un seul article (rien du panier ni de la facture en attente d’Akwa) : ${(b.items || []).length}`)
  const bastosReceipt = await page.getByRole('dialog').innerText()
  ok(bastosReceipt.includes('Marché Soleil Bastos') && !bastosReceipt.includes('Marché Soleil Akwa'), 'reçu (et ticket, même boutique) : « Marché Soleil Bastos », rien d’Akwa')
  ok(sent.otherWrites.every(p => p !== '/api/sales/checkout'), `écritures bloquées : synchro ${sent.sync} tentative(s) refusée(s), autres ${sent.otherWrites.length} (${[...new Set(sent.otherWrites)].join(', ') || 'aucune'})`)
  ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
  await s.browser.close() // fermé alors que tout est encore bloqué : la file éphémère disparaît
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
