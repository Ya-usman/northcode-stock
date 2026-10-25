// Permission « Voir les prix d'achat et les coûts » — écrans par rôle, serveur LOCAL, compte vitrine Marché Soleil en
// LECTURE SEULE (lib/capture.js bloque toute écriture ; l'enregistrement des réglages est intercepté par ce test et n'est
// jamais transmis). Réseau relu : aucune réponse ne doit contenir buying_price pour un rôle sans le droit.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/cost-permission-ui.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE, LOCAL } = require('./lib/capture.js')
const fr = require(ROOT + '/messages/fr.json')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'

// noCost : depuis la 181, la magasinière de Bastos GARDE le coût (réglage explicite). Pour tester un rôle de stock SANS
// la permission, CE navigateur seul lit stock_manager.view_purchase_cost = false (aucune écriture ; le serveur applique
// ses propres règles, testées dans cost-permission-pure). Horaires neutralisés comme dans lib/capture.js.
async function open(email, shop, path, { noCost = false } = {}) {
  process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  if (noCost) await s.page.route(/\/rest\/v1\/shops\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    let body = (await res.text()).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false')
    try {
      const fix = x => (x && typeof x === 'object' && 'role_permissions' in x
        ? { ...x, role_permissions: { ...(x.role_permissions || {}), stock_manager: { ...((x.role_permissions || {}).stock_manager || {}), view_purchase_cost: false } } } : x)
      const j = JSON.parse(body); body = JSON.stringify(Array.isArray(j) ? j.map(fix) : fix(j))
    } catch {}
    return route.fulfill({ response: res, body })
  })
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.bodies = []; s.costCalls = 0
  s.page.on('response', async r => {
    const u = r.url()
    if (!/\/api\/|\/rest\/v1\//.test(u)) return
    if (/\/api\/costs/.test(u)) s.costCalls++
    try { const t = await r.text(); s.bodies.push({ u, t }) } catch {}
  })
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const leaks = s => s.bodies.filter(b => /"buying_price"\s*:\s*-?\d/.test(b.t)).map(b => b.u.replace(/\?.*/, ''))

;(async () => {
  if (!LOCAL) throw new Error('serveur local uniquement')
  const snap = async () => JSON.stringify((await db.from('shops').select('id, role_permissions').in('id', [AKWA, BASTOS]).order('id')).data)
  const before = await snap()

  console.log('\n0. Magasinière (Bastos), réglage RÉEL — accès au coût conservé par la 181')
  let s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'stock/products')
  ok(s.costCalls > 0, 'coûts demandés à /api/costs (droit conservé par la 181)')
  ok(s.bodies.filter(b => /\/rest\/v1\//.test(b.u)).every(b => !/"buying_price"\s*:/.test(b.t)), 'lectures directes de la base : jamais de buying_price')
  await s.browser.close()

  console.log('\n1. Magasinière (Bastos) — permission retirée (dans ce navigateur seulement) : aucun coût, travail de stock possible')
  s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'stock/products', { noCost: true })
  let page = s.page
  ok(await page.locator('[data-product-row], [data-product-card]').count() > 0, 'liste des produits affichée')
  ok(s.costCalls === 0, 'aucune demande à /api/costs')
  await page.locator('[data-tour="add-product-menu"]').click(); await page.waitForTimeout(400)
  await page.locator('[data-tour="add-product-item"]').click(); await page.waitForTimeout(1500)
  const formText = await page.locator('[role="dialog"]').last().innerText().catch(() => '')
  ok(formText.includes(fr.products.selling_price) && !formText.includes(fr.products.buying_price), `ajout d'un produit : prix de vente oui, « ${fr.products.buying_price} » absent`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  if (await page.locator('[role="dialog"]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
  const restockBtn = page.locator(`button[title="${fr.actions.restock}"]`).first()
  if (await restockBtn.count()) {
    await restockBtn.click(); await page.waitForTimeout(1200)
    const rt = await page.locator('[role="dialog"]').last().innerText().catch(() => '')
    ok(rt.length > 0 && !rt.includes(fr.products.restock_buying_price), `réassort possible, sans champ « ${fr.products.restock_buying_price} »`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  } else ok(false, 'bouton de réassort visible')
  ok(leaks(s).length === 0, `réseau : aucune réponse avec un prix d'achat${leaks(s).length ? ' — ' + [...new Set(leaks(s))].join(', ') : ''}`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'suppliers?view=purchase_orders', { noCost: true })
  page = s.page
  const newPo = page.getByRole('button', { name: /Nouveau bon de commande/ }).first()
  if (await newPo.count()) {
    await newPo.click(); await page.waitForTimeout(1200)
    const sup = page.getByTestId('po-supplier')
    if (await sup.count()) { await sup.click(); await page.waitForTimeout(400); await page.getByRole('option').first().click().catch(() => {}); await page.waitForTimeout(1200) }
    const dt = await page.getByTestId('po-drawer').innerText().catch(() => '')
    ok(dt.length > 0 && !dt.includes(fr.suppliers.po_price_short) && await page.getByTestId('po-total').count() === 0, `nouveau bon : quantités oui, ni « ${fr.suppliers.po_price_short} » ni total`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400); await page.keyboard.press('Escape')
  } else ok(false, 'bouton « Nouveau bon de commande »')
  ok(leaks(s).length === 0, `Fournisseurs : aucune réponse avec un prix d'achat${leaks(s).length ? ' — ' + [...new Set(leaks(s))].join(', ') : ''}`)
  await s.browser.close()

  console.log('\n2. Manager (Akwa) — permission par défaut OUI : coût disponible par le serveur')
  s = await open('ghislainx123+jeanpaul@gmail.com', AKWA, 'stock/products')
  page = s.page
  ok(s.costCalls > 0, 'coûts demandés à /api/costs (route serveur)')
  ok(s.bodies.filter(b => /\/rest\/v1\//.test(b.u)).every(b => !/"buying_price"\s*:/.test(b.t)), 'lectures directes de la base : jamais de buying_price, même avec le droit')
  await page.locator('[data-tour="add-product-menu"]').click(); await page.waitForTimeout(400)
  await page.locator('[data-tour="add-product-item"]').click(); await page.waitForTimeout(1500)
  ok((await page.locator('[role="dialog"]').last().innerText().catch(() => '')).includes(fr.products.buying_price), `ajout d'un produit : « ${fr.products.buying_price} » proposé`)
  await page.keyboard.press('Escape')
  await s.browser.close()

  console.log('\n3. Propriétaire — réglages : « Finances & coûts », propriétaire verrouillé')
  s = await open('ghislainx123@gmail.com', AKWA, 'settings')
  page = s.page
  let sent = null
  await page.route('**/api/team/permissions', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    sent = JSON.parse(route.request().postData() || '{}')
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"changes":1}' })
  })
  const tab = name => page.getByRole('button', { name, exact: true }).first()
  await tab(fr.roles.manager).click(); await page.waitForTimeout(600)
  const sec = page.getByTestId('perm-section-finance')
  ok(await sec.isVisible() && (await sec.innerText()).includes(fr.settings.perm_view_purchase_cost) && (await sec.innerText()).includes(fr.settings.perm_view_purchase_cost_desc), `onglet « ${fr.roles.manager} » : section « ${fr.settings.perm_section_finance} » avec libellé et description`)
  ok(await page.getByTestId('perm-view-purchase-cost').getAttribute('data-state') === 'checked', `« ${fr.roles.manager} » : coût ACTIVÉ par défaut`)
  const ownerSw = page.getByTestId('perm-owner-cost').getByRole('switch')
  ok(await ownerSw.isDisabled() && await ownerSw.getAttribute('data-state') === 'checked' && (await page.getByTestId('perm-owner-cost').innerText()).includes(fr.settings.perm_owner_keeps_cost), 'propriétaire : ON verrouillé, « Le propriétaire conserve toujours ce droit. »')
  await tab(fr.settings.role_cashier).click(); await page.waitForTimeout(600)
  ok(await page.getByTestId('perm-view-purchase-cost').getAttribute('data-state') === 'unchecked', `« ${fr.settings.role_cashier} » : coût DÉSACTIVÉ par défaut`)
  await page.getByTestId('perm-view-purchase-cost').click(); await page.waitForTimeout(1500)
  ok(sent && sent.shop_id === AKWA && sent.role_permissions?.cashier?.view_purchase_cost === true && sent.role_permissions?.manager?.view_purchase_cost === true,
     'activation pour le Caissier : réglage complet envoyé (cashier.view_purchase_cost = true), intercepté — rien écrit')
  await tab(fr.settings.perm_general_tab).click(); await page.waitForTimeout(600)
  ok(await page.getByTestId('perm-section-finance').count() === 0, `onglet « ${fr.settings.perm_general_tab} » : pas de réglage du coût (le propriétaire le garde toujours)`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  ok(await snap() === before, 'base : réglages d’Akwa et de Bastos inchangés')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
