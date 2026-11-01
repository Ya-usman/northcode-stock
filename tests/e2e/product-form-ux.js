// Lot C des ajouts (1er nov. 2026) : formulaire « Ajouter un produit » simplifié + seuil d'alerte. LECTURE SEULE :
// serveur local, Boutique Alpha, propriétaire ; l'envoi POST /api/products est INTERCEPTÉ (rien n'est créé).
//  - visible d'emblée : nom, prix, unité, stock de départ, photo ; « Plus d'options » repliée (catégorie, code-barres,
//    seuil, fournisseur, emplacement) ;
//  - seuil : vide = null envoyé (seuil de la boutique, rappelé en grisé), 0 = 0 envoyé, phrase d'aide visible ;
//  - erreur du serveur sur le code-barres : « Plus d'options » s'ouvre et le message s'affiche sous le champ ;
//  - modification d'un produit qui a un emplacement : la section s'ouvre seule.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/product-form-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  const { data: shop } = await db.from('shops').select('low_stock_threshold').eq('id', ALPHA).single()
  const shopTh = shop.low_stock_threshold || 10
  const { data: withLoc } = await db.from('products').select('name').eq('shop_id', ALPHA).eq('is_active', true).not('location', 'is', null).limit(1).maybeSingle()
  const m = require('../../messages/fr.json')

  for (const [width, height] of [[390, 844], [1366, 900]]) {
    console.log(`\n${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const s = await session({ width, height, scale: 1, locale: 'fr' })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const posts = []
    let reply = null
    await page.route(/\/api\/products(\?|$)/, async route => {
      const r = route.request()
      if (r.method() !== 'POST') return route.fallback()
      posts.push(JSON.parse(r.postData() || '{}'))
      const res = reply || { status: 200, body: { data: { id: '00000000-0000-4000-8000-000000000001' } } }
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) })
    })
    await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
    const openAdd = async () => {
      await page.locator('[data-tour="add-product-menu"]:visible').first().click()
      await page.getByRole('menuitem', { name: m.products.add_product ?? 'Ajouter un produit' }).click()
      await page.locator('#product-form').waitFor({ timeout: 15000 }); await wait(800)
    }
    const form = page.locator('#product-form')
    const visible = async sel => form.locator(sel).first().isVisible().catch(() => false)
    await openAdd()
    ok(await visible('#product-name') && await visible('[data-tour="product-prices"]') && await visible('[data-tour="product-stock"]'), 'visible : nom, prix, unité et stock de départ')
    ok(await form.getByText(m.product_form.take_photo).first().isVisible(), 'photo visible d’emblée (avant : cachée dans « Options avancées »)')
    ok(!(await visible('#product-sku')) && !(await visible('[data-testid="product-threshold"]')) && !(await visible('[data-testid="product-location"]')), '« Plus d’options » repliée : code-barres, seuil, emplacement cachés')
    ok((await form.innerText()).includes(m.product_form.more_options_hint), `résumé de la section : « ${m.product_form.more_options_hint} »`)
    await form.getByRole('button', { name: new RegExp(m.product_form.more_options) }).click(); await wait(400)
    const th = form.getByTestId('product-threshold')
    ok(await th.isVisible() && (await th.getAttribute('placeholder')) === m.product_form.threshold_placeholder.replace('{count}', String(shopTh)), `seuil vide : « ${await th.getAttribute('placeholder')} » en grisé`)
    ok((await form.innerText()).includes(m.product_form.threshold_hint), 'phrase d’aide du seuil visible')
    await page.screenshot({ path: `${OUT}/product-form-${width}.png`, fullPage: false })

    // Envoi 1 : seuil vide → null
    await form.locator('#product-name').fill('TEST formulaire seuil')
    const price = form.locator('[data-tour="product-prices"] input').first()
    await price.fill('750')
    await page.locator('button[form="product-form"]').first().click(); await wait(1500)
    ok(posts.length === 1 && posts[0].low_stock_threshold === null, `seuil vide envoyé « null » (${JSON.stringify(posts[0]?.low_stock_threshold)})`)
    // Envoi 2 : seuil 0 → 0, et erreur serveur sur le code-barres → section ouverte, message sous le champ
    await page.keyboard.press('Escape'); await wait(600)
    if (await page.getByRole('button', { name: m.dialogs.unsaved_discard }).count()) await page.getByRole('button', { name: m.dialogs.unsaved_discard }).click()
    await wait(600)
    await openAdd()
    await form.locator('#product-name').fill('TEST formulaire seuil 0')
    await form.locator('[data-tour="product-prices"] input').first().fill('750')
    await form.getByRole('button', { name: new RegExp(m.product_form.more_options) }).click(); await wait(300)
    await form.getByTestId('product-threshold').fill('0')
    await form.locator('#product-sku').fill('REF-TEST-1')
    await form.getByRole('button', { name: new RegExp(m.product_form.more_options) }).click(); await wait(300)
    ok(!(await visible('#product-sku')), 'section refermée avant l’envoi')
    reply = { status: 409, body: { error: 'Ce code-barres est déjà utilisé par « Banane ». Changez-le ou laissez le champ vide.', field: 'sku' } }
    await page.locator('button[form="product-form"]').first().click(); await wait(1500)
    ok(posts.length === 2 && posts[1].low_stock_threshold === 0, `seuil 0 envoyé « 0 » (${JSON.stringify(posts[1]?.low_stock_threshold)})`)
    ok(await visible('#product-sku') && (await form.innerText()).includes('déjà utilisé par « Banane »'), 'erreur du serveur sur le code-barres : section rouverte, message sous le champ')
    reply = null
    await page.keyboard.press('Escape'); await wait(600)
    if (await page.getByRole('button', { name: m.dialogs.unsaved_discard }).count()) await page.getByRole('button', { name: m.dialogs.unsaved_discard }).click()
    await wait(800)

    // Modification d'un produit avec emplacement : la section s'ouvre seule
    if (withLoc) {
      await page.getByLabel(m.products.search_placeholder).first().fill(withLoc.name.trim()); await wait(1500)
      await page.locator('[data-product-name]', { hasText: withLoc.name.trim() }).first().click()
      const drawer = page.locator('[data-testid="product-detail"]'); await drawer.waitFor({ timeout: 15000 })
      await drawer.locator('[data-testid="product-detail-actions"] button').filter({ hasText: /Modifier/ }).first().click()
      await page.locator('#product-form').waitFor({ timeout: 15000 }); await wait(800)
      ok(await visible('[data-testid="product-location"]'), `modification de « ${withLoc.name.trim()} » (emplacement rempli) : « Plus d’options » ouverte d’emblée`)
      await page.keyboard.press('Escape'); await wait(500)
    }
    ok(posts.length === 2, `aucun autre envoi (${posts.length})`)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
