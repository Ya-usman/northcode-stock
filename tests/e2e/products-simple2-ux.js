// Lot « simplicité » n° 2 : liste Produits (2 nov. 2026). LECTURE SEULE, serveur local, Boutique Alpha, propriétaire ;
// tout envoi est intercepté.
//  1. téléphone : recherche sans résultat = message exact + « Effacer la recherche et les filtres » ; explication au
//     toucher de « N périmés » (n'ouvre pas la fiche) ; ni « En stock » ni « Surstock » ; mesures sous le nom ;
//  2. ordinateur : statut vide quand tout va bien ; plus d'icône promotion sur la ligne (dans « … », « suggérée ») ;
//     « Réapprovisionner » sur la ligne seulement si le stock est bas ; « Code-barres / référence », jamais « SKU ».
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/products-simple2-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const mm = line.match(/^([A-Z_0-9]+)=(.*)$/); if (mm) env[mm[1]] = mm[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const m = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 400) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

const open = async (w, h) => {
  const s = await session({ width: w, height: h, scale: 1, locale: 'fr' })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = []
  // Mesures simulées sur un produit (lecture seule) pour vérifier la ligne « Verre · Boîte »
  await s.page.route(/\/rest\/v1\/products\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch(); let body = await res.text()
    try { const arr = JSON.parse(body); if (Array.isArray(arr)) { for (const p of arr) if (p.id === MEASURED) p.sale_measures = [{ key: 'glass', units: 2, price: 1000 }, { key: 'box', units: 5, price: 2400 }]; body = JSON.stringify(arr) } } catch {}
    return route.fulfill({ response: res, body })
  })
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    // Ouverture de session (boutique épinglée : rôle et profil) : interceptée aussi, hors décompte
    const w = `${r.method()} ${new URL(r.url()).pathname}`
    if (w !== 'POST /api/auth/set-role' && w !== 'PATCH /rest/v1/profiles') sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
  return { ...s, errors, sent }
}
let MEASURED = null

;(async () => {
  const { data: prods } = await db.from('products').select('id, name, quantity, low_stock_threshold').eq('shop_id', ALPHA).eq('is_active', true).eq('track_serials', false).gt('quantity', 30).order('name').limit(5)
  MEASURED = prods[0].id
  const today = new Date().toISOString().slice(0, 10)
  // Repère : un produit dont une part est VRAIMENT non vendable (règle de lib/stock/sellable : un lot périmé couvert par
  // des lots frais au-delà du stock physique ne compte pas). Avant (6 nov.) : premier lot périmé venu, sans ordre, qui
  // pouvait tomber sur « Banane » (1 468 en stock, 1 472 en lots frais, donc 0 périmé affiché, à raison).
  const { data: exp } = await db.from('product_batches').select('product_id, products!inner(name, is_active, quantity)').eq('shop_id', ALPHA).gt('quantity', 0).lt('expiry_date', today).eq('products.is_active', true)
  const candidates = []
  for (const id of Array.from(new Set((exp || []).map(e => e.product_id)))) {
    const { data: lots } = await db.from('product_batches').select('quantity, expiry_date').eq('product_id', id).gt('quantity', 0)
    let fresh = 0, expired = 0
    for (const l of lots || []) { if (l.expiry_date && l.expiry_date < today) expired += Number(l.quantity); else fresh += Number(l.quantity) }
    const p = (exp.find(e => e.product_id === id)).products
    const physical = Math.max(0, Math.floor(Number(p.quantity) || 0))
    const nonSellable = physical - Math.min(physical, fresh + Math.max(physical - fresh - expired, 0))
    if (nonSellable > 0) candidates.push({ name: p.name.trim(), nonSellable })
  }
  candidates.sort((a, b) => b.nonSellable - a.nonSellable || a.name.localeCompare(b.name))
  const expiredName = candidates[0]?.name
  console.log(`Repères : mesures simulées sur « ${prods[0].name.trim()} » ; lot périmé : « ${expiredName || 'aucun'} »`)

  console.log('\n1. Téléphone')
  let s = await open(390, 844); let page = s.page
  const search = page.getByLabel(m.products.search_placeholder).first()
  ok(await search.count() === 1 && !/SKU/.test(await search.getAttribute('aria-label') || ''), `recherche : « ${m.products.search_placeholder} »`)
  await search.fill('zzzzqq'); await wait(1500)
  const none = norm(await page.getByTestId('products-no-match').innerText().catch(() => ''))
  ok(none === 'Aucun produit ne correspond à « zzzzqq ».' && !norm(await page.locator('main').innerText()).includes(m.products.add_first), `sans résultat : « ${none} », plus de « ${m.products.add_first} »`)
  await page.screenshot({ path: OUT + '/simple2-vide.png' })
  await page.getByTestId('products-clear-filters').click(); await wait(1500)
  ok(await page.locator('[data-product-card]').count() > 5 && (await search.inputValue()) === '', `« ${m.products.clear_search_filters} » : liste complète de retour`)
  const cardsText = norm(await page.locator('[data-product-card]').allInnerTexts().then(a => a.join(' | ')))
  ok(!/En stock|Surstock/.test(cardsText), 'aucune carte ne porte « En stock » ni « Surstock »')
  const measured = norm(await page.locator(`[data-product-card="${MEASURED}"] [data-card-measures]`).innerText().catch(() => ''))
  ok(measured === 'Verre · Boîte', `mesures sous le nom : « ${measured} »`)
  if (expiredName) {
    await search.fill(expiredName); await wait(1500)
    const hint = page.getByTestId('hint-expired').first()
    ok(await hint.count() === 1, '« N périmés » est un bouton d’explication')
    await hint.click(); await wait(600)
    const txt = norm(await page.getByTestId('hint-expired-text').innerText().catch(() => ''))
    ok(txt === m.products.expired_qty_hint, `au toucher : « ${txt} »`)
    ok(await page.locator('[data-testid="product-detail"]').count() === 0, 'la fiche ne s’ouvre pas')
    await page.screenshot({ path: OUT + '/simple2-explication.png' })
    await page.getByTestId('hint-expired-action').click(); await wait(2500)
    ok(await page.locator('[data-testid="product-detail"]').count() === 1 && (await page.locator('[data-testid="product-detail"]').innerText()).includes(expiredName), `« ${m.products.view_batches} » dans la bulle : ouvre la fiche du produit sur ses lots`)
    await page.keyboard.press('Escape'); await wait(500)
  } else console.log('  (aucun lot périmé actif à Alpha : explication au toucher non vérifiée)')
  ok(!s.errors.length && !s.sent.length, `aucune erreur JavaScript, aucun envoi (${s.sent.length})`, { errors: s.errors, sent: s.sent })
  await s.browser.close()

  console.log('\n2. Ordinateur')
  s = await open(1366, 900); page = s.page
  if (await page.locator('table').count() === 0) { await page.getByTitle(m.products.view_table).first().click(); await wait(2000) }
  const heads = norm(await page.locator('table thead').first().innerText())
  ok(heads.includes(m.products.col_sku) && !/SKU/.test(heads), `colonne « ${m.products.col_sku} »`)
  const rows = await page.locator('tbody tr[data-product-row]').evaluateAll(trs => trs.map(tr => ({ text: tr.innerText.replace(/\s+/g, ' '), tag: !!tr.querySelector('svg.lucide-tag'), restock: !!tr.querySelector('[data-row-restock]'), low: /Stock faible|Rupture/.test(tr.innerText) })))
  ok(rows.length > 5 && rows.every(r => !/En stock|Surstock/.test(r.text)), `${rows.length} lignes : ni « En stock » ni « Surstock »`)
  ok(rows.every(r => !r.tag), 'plus d’icône promotion sur les lignes')
  ok(rows.every(r => r.restock === r.low || (r.restock && !r.low)) && rows.filter(r => r.low).every(r => r.restock), `« Réapprovisionner » sur les lignes en stock bas (${rows.filter(r => r.restock).length}), pas ailleurs`)
  ok(rows.filter(r => !r.low).length === 0 || rows.filter(r => !r.low).some(r => !r.restock), 'lignes en stock normal : pas de bouton « Réapprovisionner »')
  const firstNormal = page.locator('tbody tr[data-product-row]').filter({ hasNot: page.locator('[data-row-restock]') }).first()
  await firstNormal.getByRole('button', { name: m.products.more_actions }).click(); await wait(500)
  const menu = (await page.getByRole('menuitem').allInnerTexts()).map(norm)
  ok(menu[0] === m.actions.restock && menu.some(x => x.startsWith(m.products.promo_action)), `menu « … » : ${menu.join(' / ')}`)
  await page.keyboard.press('Escape'); await wait(300)
  await page.screenshot({ path: OUT + '/simple2-ordinateur.png' })
  ok(!s.errors.length && !s.sent.length, `aucune erreur JavaScript, aucun envoi (${s.sent.length})`, { errors: s.errors, sent: s.sent })
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
