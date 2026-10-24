// Contrôle EN LIGNE après push de 19d768d → 20f960d (179 côté application, migration 179 NON appliquée) — lecture seule.
//   • version : la route /api/stock/batch-treatments/status (19d768d) répond (401 sans connexion, plus 404) ;
//   • API sans connexion : traitements, photos, résolution, ajustement / date de lot, suppression de produit,
//     suppression définitive de boutique, suppression de propriétaire → 401 (aucune écriture possible) ;
//   • base pré-179 vue par l'application : delete_shops absente → PGRST202 (seul cas de repli de deleteShops ;
//     appel avec une liste VIDE, qui ne supprimerait rien même si la fonction existait) ; table batch_treatments
//     absente → la détection de l'application répond « indisponible » ;
//   • navigateur (Marché Soleil, consultation ; écritures TOUTES bloquées par lib/capture.js) en fr / en / ha :
//     Vue d'ensemble, Produits, Lots & péremptions, Mouvements, Historique, vente ciblée (?sale_id) avec bandeau
//     traduit ; aucune clé de traduction brute, aucune erreur de page, aucun appel aux routes 179 d'écriture ;
//     téléphone 390 ;
//   • base : boutiques, ventes, lots et produits de la vitrine identiques avant / après.
// Usage : CAPTURE_BASE=https://stockshop.tech CAPTURE_PROD_READONLY=1 node tests/e2e/prod-smoke-179-app.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const ENTITY = '20487333-ae4d-4e00-940b-7319fe009755'
const ZERO = '00000000-0000-4000-8000-000000000000'
process.env.PIN_SHOP = AKWA
const { session, BASE, OUT } = require('./lib/capture.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const msg = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8').replace(/^﻿/, ''))

async function snapshot() {
  const { data: shops } = await db.from('shops').select('*').eq('entity_id', ENTITY).order('id')
  const ids = shops.map(s => s.id)
  const { count: sales } = await db.from('sales').select('id', { count: 'exact', head: true }).in('shop_id', ids)
  const { data: lots } = await db.from('product_batches').select('id, quantity, expiry_date').in('shop_id', ids).order('id')
  const { data: last } = await db.from('products').select('updated_at').in('shop_id', ids).order('updated_at', { ascending: false }).limit(1)
  const { count: allShops } = await db.from('shops').select('id', { count: 'exact', head: true })
  return JSON.stringify({ shops, sales, lots, last: last?.[0]?.updated_at, allShops })
}
async function visit(s, url, ms = 6000) {
  await s.page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('main').first().waitFor({ timeout: 60000 })
  await s.page.waitForTimeout(ms)
}
const visible = s => s.page.locator('main').first().innerText()
// Clé de traduction restée brute (ex. « stock.batch_treatment.title », « sales.target_shown »)
const RAW = /\b(stock|sales|batch_treatment|common|nav)\.[a-z_]+(\.[a-z_]+)*\b/

;(async () => {
  // 1. Version en ligne
  const st = await fetch(`${BASE}/api/stock/batch-treatments/status?shop_id=${AKWA}`)
  ok(st.status === 401, `version 19d768d+ en ligne : /api/stock/batch-treatments/status répond ${st.status} (401 attendu, 404 = ancienne version)`)

  const before = await snapshot()

  // 2. API sans connexion : refus avant toute écriture
  const call = async (p, body, method = 'POST') => (await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).status
  for (const [p, method, body] of [
    ['/api/stock/batch-treatments', 'POST', { batch_id: ZERO, action: 'dispose', quantity: 1, request_id: 'TEST-SMOKE-179' }],
    ['/api/stock/batch-treatments/photo', 'POST', { treatment_id: ZERO }],
    ['/api/stock/batch-treatments/resolve', 'POST', { sale_id: ZERO, batch_id: ZERO, quantity: 1 }],
    ['/api/product-batches/adjust', 'PATCH', { batch_id: ZERO, shop_id: AKWA, new_quantity: 1 }],
    ['/api/product-batches/expiry', 'PATCH', { batch_id: ZERO, shop_id: AKWA, expiry_date: '2030-01-01' }],
    ['/api/products', 'DELETE', { id: ZERO }],
    [`/api/shops/${ZERO}`, 'POST', null],
    [`/api/admin/owner/${ZERO}`, 'DELETE', null],
  ]) ok([401, 403].includes(await call(p, body, method)), `${method} ${p} sans connexion : refusé`)

  // 3. Base pré-179 vue par l'application
  const rpc = await db.rpc('delete_shops', { p_shop_ids: [] })
  ok(rpc.error?.code === 'PGRST202', `delete_shops absente : ${rpc.error?.code} (seul cas où deleteShops revient au DELETE d'origine)`)
  const bt = await db.from('batch_treatments').select('id').limit(1)
  ok(!!bt.error, `table batch_treatments absente → l'application répond « indisponible » (${bt.error?.code})`)

  // 4. Navigateur en fr / en / ha
  const { data: sale } = await db.from('sales').select('id, sale_number, created_at').eq('shop_id', AKWA).in('sale_status', ['active', 'cancelled']).order('created_at', { ascending: true }).limit(1).single()
  for (const [locale, w, h] of [['fr', 1366, 900], ['en', 1366, 900], ['ha', 1366, 900], ['fr', 390, 844]]) {
    console.log(`\n${locale} ${w} × ${h} — Marché Soleil / Akwa (écritures bloquées)`)
    const M = msg(locale)
    const s = await session({ width: w, height: h, locale, email: 'ghislainx123@gmail.com' })
    const errors = [], writes = []
    s.page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    s.page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && !/\/auth\/v1\/token/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`) })
    for (const [label, url] of [['Vue d\'ensemble', '/stock'], ['Produits', '/stock/products'], ['Lots & péremptions', '/stock/expiry'],
                               ['Mouvements', '/stock/movements'], ['Historique des ventes', '/sales/history']]) {
      await visit(s, `/${locale}${url}`)
      const text = await visible(s)
      ok(text.length > 80 && !RAW.test(text), `${label} : page chargée, aucune clé brute${RAW.test(text) ? ' — ' + text.match(RAW)[0] : ''}`)
    }
    // Vente ciblée (« Voir la vente ») : la plus ancienne vente DE CAISSE d'Akwa (active / annulée — l'historique ne montre
    // jamais les reprises de dette « opening »), masquée par « Aujourd'hui » sans le ciblage
    await visit(s, `/${locale}/sales/history?sale_id=${sale.id}`, 7000)
    const shown = M.sales.target_shown.replace('{number}', sale.sale_number)
    const text = await visible(s)
    ok(text.includes(shown) && await s.page.locator('[data-testid="sale-target-clear"]').count() === 1,
      `vente ciblée ${sale.sale_number} : bandeau « ${shown} » + « ${M.sales.target_clear} »`)
    await visit(s, `/${locale}/sales/history?sale_id=${ZERO}`, 5000)
    ok((await visible(s)).includes(M.sales.target_unavailable), `vente inexistante : « ${M.sales.target_unavailable.slice(0, 50)}… »`)
    if (w < 900) await s.page.screenshot({ path: path.join(OUT, `prod-179-history-${locale}-${w}.png`) })
    ok(!errors.length, `aucune erreur de page${errors.length ? ' — ' + errors.join(' | ') : ''}`)
    ok(!writes.some(x => /\/api\/(stock\/batch-treatments|product-batches|products|shops|admin)/.test(x)), `aucun appel d'écriture 179 / lot / boutique${writes.length ? ' (bloquées : ' + [...new Set(writes)].join(', ') + ')' : ''}`)
    await s.browser.close()
  }

  ok(await snapshot() === before, 'base : boutiques, ventes, lots et produits de la vitrine inchangés, nombre total de boutiques inchangé')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
