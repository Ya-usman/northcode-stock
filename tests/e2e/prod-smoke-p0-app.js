// Contrôle EN LIGNE après push de 411f4aa (P0 côté application, 178 NON appliquée) — lecture seule stricte.
//   • version : l'en-tête x-user-timezone (introduit par 411f4aa) est dans les scripts de la page de connexion ;
//   • API sans connexion : création de boutique, réglages, vente → refusées (aucune écriture possible) ;
//   • navigateur (Marché Soleil, Akwa), écritures TOUTES bloquées par lib/capture.js : caisse (Pain de campagne =
//     58 vendables sur 78, ajout au panier local), Paramètres (fuseau affiché), création / modification de boutique
//     (formulaire ouvert puis fermé, jamais envoyé), Lots ; aucune erreur de page ;
//   • base : boutiques, ventes et produits de l'entreprise vitrine identiques avant / après.
// Usage : CAPTURE_BASE=https://stockshop.tech CAPTURE_PROD_READONLY=1 node tests/e2e/prod-smoke-p0-app.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const ENTITY = '20487333-ae4d-4e00-940b-7319fe009755'
process.env.PIN_SHOP = AKWA
const { session, BASE, OUT } = require('./lib/capture.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function snapshot() {
  const { data: shops } = await db.from('shops').select('*').eq('entity_id', ENTITY).order('id')
  const ids = shops.map(s => s.id)
  const { count: sales } = await db.from('sales').select('id', { count: 'exact', head: true }).in('shop_id', ids)
  const { data: last } = await db.from('products').select('updated_at').in('shop_id', ids).order('updated_at', { ascending: false }).limit(1)
  const { count: allShops } = await db.from('shops').select('id', { count: 'exact', head: true })
  return JSON.stringify({ shops, sales, last: last?.[0]?.updated_at, allShops })
}

async function visit(s, url, ready) {
  await s.page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator(ready).first().waitFor({ timeout: 60000 })
  await s.page.waitForTimeout(2500)
}

;(async () => {
  // 1. Version en ligne
  const html = await (await fetch(`${BASE}/fr/login`)).text()
  let marker = 0
  for (const src of [...new Set(html.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]) marker += ((await (await fetch(BASE + src)).text()).match(/x-user-timezone/g) || []).length
  ok(marker > 0, `version 411f4aa en ligne (x-user-timezone dans les scripts : ${marker})`)

  const before = await snapshot()

  // 2. API sans connexion : refus avant toute écriture
  const post = async (p, body, method = 'POST') => (await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status
  ok(await post('/api/shops', { name: 'TEST P0', country: 'US', timezone: 'Europe/Paris' }) === 401, 'création de boutique sans connexion : 401')
  ok(await post('/api/shops/settings', { shop_id: AKWA, timezone: 'Europe/Paris' }, 'PATCH') === 401, 'réglages de boutique (PATCH) sans connexion : 401')
  ok(await post('/api/sales/checkout', { shop_id: AKWA, items: [] }) === 401, 'vente sans connexion : 401')

  const { data: pain } = await db.from('products').select('id, name, quantity').eq('shop_id', AKWA).ilike('name', 'Pain de campagne%').limit(1).single()

  for (const [w, h] of [[1366, 900], [390, 844]]) {
    console.log(`\n${w} × ${h} — Marché Soleil / Akwa (écritures bloquées)`)
    const s = await session({ width: w, height: h, locale: 'fr', email: 'ghislainx123@gmail.com' })
    const errors = [], writes = []
    s.page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    s.page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && !/\/auth\/v1\/token/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`) })

    // Caisse
    await visit(s, '/fr/sales/new', '[data-tour="pos-grid"]')
    const input = s.page.locator('input[type="search"], input[placeholder*="echerch"]').first()
    await input.fill('Pain de campagne'); await s.page.waitForTimeout(1000)
    const card = s.page.locator('[data-tour="pos-grid"] [role="button"]', { hasText: 'Pain de campagne' }).first()
    const text = (await card.count()) ? await card.innerText() : ''
    ok(/\b58\b/.test(text) && !/\b78\b/.test(text) && await card.getAttribute('aria-disabled') !== 'true', `caisse : Pain de campagne affiche 58 vendables (physique ${pain?.quantity})`)
    await card.click(); await s.page.waitForTimeout(800)
    const openCart = s.page.locator('[data-tour="pos-open-cart"]:visible').first()
    if (await openCart.count()) { await openCart.click(); await s.page.waitForTimeout(800) }
    const qtys = await s.page.locator('input[type="number"]:visible').evaluateAll(els => els.map(e => Number(e.value)))
    ok(qtys.includes(1), `caisse : ajout au panier local (${qtys.join(', ')})`)
    await s.page.screenshot({ path: path.join(OUT, `prod-p0-pos-${w}.png`) })

    // Paramètres : fuseau de la boutique
    await visit(s, '/fr/settings', '[data-testid="time-zone-field"]')
    const tz = (await s.page.locator('[data-testid="time-zone-field"]').first().innerText()).replace(/\s+/g, ' ')
    ok(/Fuseau horaire/.test(tz) && /Douala|GMT\+1/.test(tz), `Paramètres : fuseau affiché (${tz.slice(0, 60)})`)

    // Boutiques : création puis modification — formulaire ouvert puis fermé, jamais envoyé
    await visit(s, '/fr/shops', '[data-testid="shop-create"]')
    await s.page.locator('[data-testid="shop-create"]').click(); await s.page.waitForTimeout(1200)
    ok(await s.page.locator('#shop-name:visible').count() === 1 && await s.page.locator('[data-testid="time-zone-field"]:visible').count() === 1, 'création de boutique : formulaire avec fuseau horaire')
    await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(800)
    await s.page.locator(`[data-testid="${w < 900 ? 'shop-card' : 'shop-row'}"]`).first().click()
    await s.page.locator('[data-testid="shop-edit"]').waitFor({ timeout: 60000 }); await s.page.waitForTimeout(1500)
    await s.page.locator('[data-testid="shop-edit"]').click(); await s.page.waitForTimeout(1200)
    const name = await s.page.locator('#shop-name:visible').inputValue().catch(() => '')
    const tzEdit = (await s.page.locator('[data-testid="time-zone-field"]:visible').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(name.length > 0 && /GMT/.test(tzEdit), `modification de boutique : formulaire prérempli (« ${name} », ${tzEdit.replace('Fuseau horaire', '').trim().slice(0, 40)})`)
    await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(800)

    // Lots
    await visit(s, '/fr/stock/expiry', 'main')
    ok(await s.page.locator('main').innerText().then(t => t.length > 50), 'Stock › Lots : page chargée')

    ok(!errors.length, `aucune erreur de page${errors.length ? ' — ' + errors.join(' | ') : ''}`)
    ok(!writes.some(x => /\/api\/(shops|sales)|\/rest\/v1\/(shops|sales|products)/.test(x)), `aucune écriture boutique / vente / produit tentée${writes.length ? ' (bloquées : ' + [...new Set(writes)].join(', ') + ')' : ''}`)
    await s.browser.close()
  }

  ok(await snapshot() === before, 'base : boutiques, ventes et produits de la vitrine inchangés, nombre total de boutiques inchangé')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
