// Contrôle EN LIGNE APRÈS application de la migration 179 (25 oct. 2026) — lecture seule.
// (prod-smoke-179-app.js reste le contrôle de l'état PRÉ-179 : il n'est pas modifié.)
//   • API sans connexion : routes de traitement, lots, produits, boutiques, propriétaire → refusées ;
//   • fonctions 179 côté serveur : appelées UNIQUEMENT avec des paramètres refusés AVANT toute écriture (action
//     inconnue, identifiant de requête trop court, traitement inexistant) — codes attendus ; delete_shops n'est
//     jamais appelée (présence vérifiée par la base) ; adjust_batch_quantity refusée au serveur ;
//   • clé publique (anon) : aucune fonction 179 exécutable, tables 179 illisibles ;
//   • navigateur (Marché Soleil, écritures TOUTES bloquées par lib/capture.js) en fr / en / ha, 1366 / 390 / 360 :
//     l'application détecte la 179 ; Lots & péremptions › lot PÉRIMÉ → panneau avec « Traiter le lot périmé »
//     (jamais cliqué) et historique vide affichable ; Vue d'ensemble, Produits, Mouvements, Historique, vente ciblée ;
//     aucune clé brute, aucune erreur de page ;
//   • base : vitrine identique avant / après ; 0 traitement, 0 photo, 0 mouvement lié.
// Usage : CAPTURE_BASE=https://stockshop.tech CAPTURE_PROD_READONLY=1 node tests/e2e/prod-smoke-179-post.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const ENTITY = '20487333-ae4d-4e00-940b-7319fe009755'
const ZERO = '00000000-0000-4000-8000-000000000000'
process.env.PIN_SHOP = AKWA
const { session, BASE, OUT } = require('./lib/capture.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const msg = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8').replace(/^﻿/, ''))
const RAW = /\b(stock|sales|batch_treatment|common|nav|expiry|products)\.[a-z_]+(\.[a-z_]+)*\b/

async function snapshot() {
  const { data: shops } = await db.from('shops').select('*').eq('entity_id', ENTITY).order('id')
  const ids = shops.map(s => s.id)
  const { count: sales } = await db.from('sales').select('id', { count: 'exact', head: true }).in('shop_id', ids)
  const { data: lots } = await db.from('product_batches').select('id, quantity, expiry_date').in('shop_id', ids).order('id')
  const { data: last } = await db.from('products').select('updated_at').in('shop_id', ids).order('updated_at', { ascending: false }).limit(1)
  const { count: allShops } = await db.from('shops').select('id', { count: 'exact', head: true })
  const { count: bt } = await db.from('batch_treatments').select('id', { count: 'exact', head: true })
  const { count: ph } = await db.from('batch_treatment_photos').select('id', { count: 'exact', head: true })
  const { count: mv } = await db.from('stock_movements').select('id', { count: 'exact', head: true }).not('batch_treatment_id', 'is', null)
  return JSON.stringify({ shops, sales, lots, last: last?.[0]?.updated_at, allShops, bt, ph, mv })
}
async function visit(s, url, ms = 6000) {
  await s.page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('main').first().waitFor({ timeout: 60000 })
  await s.page.waitForTimeout(ms)
}
const visible = s => s.page.locator('main').first().innerText()

;(async () => {
  const before = await snapshot()
  const b = JSON.parse(before)
  ok(b.bt === 0 && b.ph === 0 && b.mv === 0, `état de départ : ${b.bt} traitement, ${b.ph} photo, ${b.mv} mouvement lié`)

  // 1. API sans connexion
  const call = async (p, body, method = 'POST') => (await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).status
  for (const [p, method, body] of [
    [`/api/stock/batch-treatments/status`, 'GET', null],
    ['/api/stock/batch-treatments', 'POST', { batch_id: ZERO, action: 'dispose', quantity: 1, request_id: 'TEST-SMOKE-179-POST' }],
    ['/api/stock/batch-treatments/photo', 'POST', { treatment_id: ZERO }],
    ['/api/stock/batch-treatments/resolve', 'POST', { sale_id: ZERO, batch_id: ZERO, quantity: 1 }],
    ['/api/product-batches/adjust', 'PATCH', { batch_id: ZERO, shop_id: AKWA, new_quantity: 1 }],
    ['/api/product-batches/expiry', 'PATCH', { batch_id: ZERO, shop_id: AKWA, expiry_date: '2030-01-01' }],
    ['/api/products', 'DELETE', { id: ZERO }],
    [`/api/shops/${ZERO}`, 'POST', null],
    [`/api/admin/owner/${ZERO}`, 'DELETE', null],
  ]) ok([401, 403].includes(await call(p, body, method)), `${method} ${p} sans connexion : refusé`)

  // 2. Fonctions 179 (serveur) : refus AVANT toute écriture
  const tb = await db.rpc('treat_batch', { p_shop_id: AKWA, p_batch_id: ZERO, p_action: 'TEST_invalide', p_quantity: null, p_new_quantity: null,
    p_new_expiry_date: null, p_reason_code: null, p_note: null, p_request_id: 'TEST-SMOKE-179-POST', p_performed_by: ZERO, p_corrects_treatment_id: null })
  ok(tb.error?.code === 'P0043', `treat_batch présente : action inconnue → ${tb.error?.code} (P0043, refus avant tout verrou)`)
  const ru = await db.rpc('resolve_unallocated', { p_shop_id: AKWA, p_sale_id: ZERO, p_product_id: ZERO, p_batch_id: ZERO, p_quantity: 1,
    p_note: 'x', p_request_id: 'x', p_performed_by: ZERO })
  ok(ru.error?.code === 'P0043', `resolve_unallocated présente : identifiant de requête trop court → ${ru.error?.code} (P0043)`)
  const rp = await db.rpc('register_batch_treatment_photo', { p_shop_id: AKWA, p_treatment_id: ZERO, p_storage_path: `${AKWA}/x/y/z.jpg`,
    p_mime_type: 'image/jpeg', p_size_bytes: 1, p_uploaded_by: ZERO })
  ok(rp.error?.code === 'P0047', `register_batch_treatment_photo présente : traitement inexistant → ${rp.error?.code} (P0047)`)
  const uc = await db.rpc('unallocated_candidates', { p_batch_id: ZERO })
  ok(!uc.error && Array.isArray(uc.data) && uc.data.length === 0, 'unallocated_candidates présente : lot inexistant → liste vide')
  const ab = await db.rpc('adjust_batch_quantity', { p_batch_id: ZERO, p_shop_id: AKWA, p_new_quantity: 1, p_reason_code: 'correction', p_performed_by: ZERO })
  ok(!!ab.error && /permission denied|42501/.test(`${ab.error.code} ${ab.error.message}`), `adjust_batch_quantity retirée au serveur → ${ab.error?.code}`)
  const bt = await db.from('batch_treatments').select('id').limit(1)
  ok(!bt.error, 'table batch_treatments lisible par le serveur → l’application passe sur les chemins 179')

  // 3. Clé publique : rien de la 179
  for (const [fn, args] of [['treat_batch', { p_shop_id: AKWA, p_batch_id: ZERO, p_action: 'dispose', p_quantity: 1, p_new_quantity: null, p_new_expiry_date: null,
      p_reason_code: null, p_note: null, p_request_id: 'TEST-SMOKE-ANON', p_performed_by: ZERO, p_corrects_treatment_id: null }],
    ['resolve_unallocated', { p_shop_id: AKWA, p_sale_id: ZERO, p_product_id: ZERO, p_batch_id: ZERO, p_quantity: 1, p_note: 'x', p_request_id: 'TEST-SMOKE-ANON', p_performed_by: ZERO }],
    ['delete_shops', { p_shop_ids: [ZERO] }], ['unallocated_candidates', { p_batch_id: ZERO }]]) {
    const r = await anon.rpc(fn, args)
    ok(!!r.error && /42501|PGRST202|permission/.test(`${r.error.code} ${r.error.message}`), `clé publique : ${fn} non exécutable (${r.error?.code})`)
  }
  for (const t of ['batch_treatments', 'batch_treatment_photos']) {
    const r = await anon.from(t).select('id').limit(1)
    ok(!!r.error || (r.data || []).length === 0, `clé publique : ${t} illisible (${r.error?.code || 'aucune ligne'})`)
  }

  // 4. Navigateur
  const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10) // date à Douala (UTC+1)
  const { data: expired } = await db.from('product_batches').select('id, quantity, expiry_date').eq('shop_id', AKWA).gt('quantity', 0).lt('expiry_date', today).order('expiry_date').limit(1)
  ok(expired?.length === 1, `lot périmé en stock à Akwa pour le contrôle du panneau (${expired?.[0]?.expiry_date ?? 'aucun'})`)
  const { data: sale } = await db.from('sales').select('id, sale_number').eq('shop_id', AKWA).in('sale_status', ['active', 'cancelled']).order('created_at', { ascending: true }).limit(1).single()
  for (const [locale, w, h] of [['fr', 1366, 900], ['en', 1366, 900], ['ha', 1366, 900], ['fr', 390, 844], ['fr', 360, 780]]) {
    console.log(`\n${locale} ${w} × ${h} — Marché Soleil / Akwa (écritures bloquées)`)
    const M = msg(locale)
    const s = await session({ width: w, height: h, locale, email: 'ghislainx123@gmail.com' })
    const errors = [], writes = []
    s.page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    s.page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && !/\/auth\/v1\/token/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`) })
    await visit(s, `/${locale}/stock/expiry?status=expired`, 7000)
    const avail = await s.page.evaluate(async () => (await (await fetch('/api/stock/batch-treatments/status')).json()).available)
    ok(avail === true, 'l’application détecte la 179 (status : available = true)')
    const row = s.page.locator(`main [data-lot="${expired[0].id}"]`)
    ok(await row.count() === 1, 'Lots & péremptions › Périmés : le lot périmé est listé')
    await row.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await s.page.waitForTimeout(300)
    await row.locator('[data-lot-label]').click()
    await s.page.locator('[data-testid=lot-detail]').waitFor({ timeout: 15000 }); await s.page.waitForTimeout(2500)
    const treat = s.page.locator('[data-testid=lot-detail-treat]')
    ok(await treat.count() === 1 && (await treat.innerText()).includes(M.stock?.batch_treatment?.treat_action ?? M.batch_treatment?.treat_action),
      `panneau du lot : « ${(M.stock?.batch_treatment ?? M.batch_treatment).treat_action} » présent (jamais cliqué)`)
    const detail = await s.page.locator('[data-testid=lot-detail]').innerText()
    ok(detail.includes((M.stock?.batch_treatment ?? M.batch_treatment).history_title) && await s.page.locator('[data-testid=batch-treatment-history-empty]').count() === 1,
      'panneau du lot : historique des traitements affiché, vide')
    ok(!RAW.test(detail), `panneau du lot : aucune clé brute${RAW.test(detail) ? ' — ' + detail.match(RAW)[0] : ''}`)
    if (w < 900) await s.page.screenshot({ path: path.join(OUT, `prod-179-post-lot-${locale}-${w}.png`) })
    await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(800)
    for (const [label, url] of [['Vue d\'ensemble', '/stock'], ['Produits', '/stock/products'], ['Mouvements', '/stock/movements'], ['Historique des ventes', '/sales/history']]) {
      await visit(s, `/${locale}${url}`)
      const text = await visible(s)
      ok(text.length > 80 && !RAW.test(text), `${label} : page chargée, aucune clé brute${RAW.test(text) ? ' — ' + text.match(RAW)[0] : ''}`)
    }
    await visit(s, `/${locale}/sales/history?sale_id=${sale.id}`, 7000)
    const shown = M.sales.target_shown.replace('{number}', sale.sale_number)
    ok((await visible(s)).includes(shown), `vente ciblée ${sale.sale_number} : « ${shown} »`)
    ok(!errors.length, `aucune erreur de page${errors.length ? ' — ' + errors.join(' | ') : ''}`)
    ok(!writes.some(x => /\/api\/(stock\/batch-treatments|product-batches|products|shops|admin)/.test(x)), `aucun appel d'écriture 179 / lot / boutique${writes.length ? ' (bloquées : ' + [...new Set(writes)].join(', ') + ')' : ''}`)
    await s.browser.close()
  }

  ok(await snapshot() === before, 'base : vitrine inchangée ; toujours 0 traitement, 0 photo, 0 mouvement lié')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
