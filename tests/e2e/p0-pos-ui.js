// Caisse — « périmé ≠ vendable » côté application (P0, migration 178), téléphone 360 / 390 px et hors ligne.
// Fonctionne AVANT comme APRÈS la 178 (règle calculée par l'application : lib/stock/sellable).
// Deux produits « TEST P0 UI <run> » créés sur Boutique Alpha (vérifiée en base) puis supprimés par identifiant :
//   A : 5 unités, uniquement un lot périmé → carte grisée « Stock périmé », ajout refusé ;
//   B : 25 unités (5 périmées + 20 fraîches) → quantité affichée 20, panier plafonné à 20.
// Navigateur : toute écriture interceptée (aucune vente). Usage : CAPTURE_BASE=http://localhost:3000 node p0-pos-ui.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE, LOCAL, OUT } = require('./lib/capture.js')
if (!LOCAL) { console.error('Serveur local uniquement (le test crée des produits sur Alpha)'); process.exit(1) }
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const RUN = `TEST P0 UI ${Date.now().toString(36)}`
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
const created = []
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function product(label, qty, lots) {
  const { data: p, error } = await db.from('products').insert({ shop_id: ALPHA, name: `${RUN} ${label}`, quantity: qty, selling_price: 100, buying_price: 50, is_active: true, unit: 'piece' }).select('id').single()
  if (error) throw new Error(error.message)
  created.push(p.id)
  for (const l of lots) {
    const { error: e } = await db.from('product_batches').insert({ shop_id: ALPHA, product_id: p.id, quantity: l.q, initial_quantity: l.q, expiry_date: l.exp, source: 'adjustment' })
    if (e) throw new Error(e.message)
  }
  return p.id
}
async function cleanup() {
  for (const id of created) {
    await db.from('stock_movements').delete().eq('product_id', id).eq('shop_id', ALPHA)
    await db.from('product_batches').delete().eq('product_id', id).eq('shop_id', ALPHA)
    await db.from('products').delete().eq('id', id).eq('shop_id', ALPHA)
  }
}

async function open(width, height) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email: 'admin@northcode.ng' })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } } catch {} }, ALPHA)
  s.writes = []; s.errors = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.route(/\/api\//, route => {
    const r = route.request(), url = new URL(r.url())
    if (r.method() === 'GET' || url.pathname === '/api/auth/set-role') return route.fallback()
    s.writes.push(`${r.method()} ${url.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 60000 })
  await s.page.waitForTimeout(3000)
  return s
}
const search = async (s, text) => {
  const input = s.page.locator('input[type="search"], input[placeholder*="echerch"]').first()
  await input.fill(text); await s.page.waitForTimeout(800)
}
const card = (s, label) => s.page.locator('[data-tour="pos-grid"] [role="button"]', { hasText: `${RUN} ${label}` }).first()

;(async () => {
  const { data: alpha } = await db.from('shops').select('name').eq('id', ALPHA).single()
  if (alpha?.name !== 'Boutique Alpha') throw new Error('cible inattendue')
  await product('A-perime', 5, [{ q: 5, exp: day(-3) }])
  await product('B-mixte', 25, [{ q: 5, exp: day(-3) }, { q: 20, exp: day(40) }])
  try {
    for (const [w, h] of [[360, 780], [390, 844]]) {
      console.log(`\nTéléphone ${w} × ${h}`)
      const s = await open(w, h)
      await search(s, RUN)
      const A = card(s, 'A-perime'), B = card(s, 'B-mixte')
      ok(await A.count() === 1 && await A.getAttribute('aria-disabled') === 'true' && /Stock périmé/.test(await A.innerText()), 'A : carte grisée « Stock périmé »')
      await A.click({ force: true }); await s.page.waitForTimeout(600)   // carte aria-disabled : un toucher reste possible (message)
      ok(await s.page.getByText(`${RUN} A-perime : stock périmé`).count() > 0 && await B.count() === 1, 'A : message « … : stock périmé » au toucher, recherche gardée')
      ok(/\b20\b/.test(await B.innerText()) && !/\b25\b/.test(await B.innerText()), 'B : quantité affichée = 20 vendables (pas 25)')
      // Chaque ajout réussi vide la recherche (comportement normal de la caisse) : on la relance avant chaque ajout
      for (let i = 0; i < 22; i++) { await search(s, RUN); await B.click(); await s.page.waitForTimeout(80) }
      await s.page.waitForTimeout(800)
      const openCart = s.page.locator('[data-tour="pos-open-cart"]:visible').first()
      if (await openCart.count()) { await openCart.click(); await s.page.waitForTimeout(800) }
      const qtys = await s.page.locator('input[type="number"]:visible').evaluateAll(els => els.map(e => Number(e.value)))
      ok(qtys.includes(20) && !qtys.some(q => q > 20), `B : panier plafonné à 20 après 22 ajouts (${qtys.join(', ')})`)
      ok(!s.writes.some(w => /checkout|sales\/sync/.test(w)), 'aucune vente envoyée')
      ok((await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, 'aucun défilement horizontal')
      await s.page.screenshot({ path: path.join(OUT, `p0-pos-${w}.png`) })
      if (w === 390) {
        // Sans service worker (bloqué par les tests), une page ne se recharge pas hors ligne : la coupure est simulée en
        // bloquant les lectures de produits et de lots — la caisse doit alors s'appuyer sur son cache local (lots compris)
        console.log('\nSans réseau vers la base (cache local de la caisse)')
        let blocked = 0
        await s.page.route(/\/rest\/v1\/(products|product_batches)\?/, route => { blocked++; return route.abort() })
        await s.page.reload({ waitUntil: 'domcontentloaded' })
        await s.page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 60000 })
        await s.page.waitForTimeout(3000)
        await search(s, RUN)
        const A2 = card(s, 'A-perime'), B2 = card(s, 'B-mixte')
        ok(blocked > 0, `lectures de produits / lots coupées (${blocked})`)
        ok(await A2.count() === 1 && await A2.getAttribute('aria-disabled') === 'true', 'cache : A toujours grisé (lots gardés dans le cache)')
        ok(await B2.count() === 1 && /\b20\b/.test(await B2.innerText()), 'cache : B affiche toujours 20 vendables')
        s.errors.length = 0   // requêtes coupées volontairement
      }
      ok(!s.errors.length, `aucune erreur de page${s.errors.length ? ' — ' + s.errors.join(' | ') : ''}`)
      await s.browser.close()
    }
  } catch (e) {
    ok(false, 'ERREUR : ' + String(e.message).slice(0, 200).replace(/\s+/g, ' '))
  } finally {
    await cleanup()
    const { count } = await db.from('products').select('id', { count: 'exact', head: true }).like('name', `${RUN}%`)
    ok(count === 0, `produits de test supprimés par identifiant (${created.length}), aucune trace`)
    console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
  }
})().catch(async e => { console.error('ERREUR', e.message); try { await cleanup() } catch {} process.exit(1) })
