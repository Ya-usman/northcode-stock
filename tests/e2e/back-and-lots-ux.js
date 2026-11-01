// Signalements du 1er nov. 2026 (téléphone) : LECTURE SEULE, serveur local, Boutique Alpha, propriétaire.
//  1. Retour (flèche du téléphone / du navigateur) : depuis la fiche d'un produit ouverte dans Stock › Produits, le
//     retour FERME la fiche et reste sur Produits (avant : renvoyait à la Vue d'ensemble) ; fermée par la croix ou
//     Échap, aucune étape « dans le vide » ne reste ; formulaire avec saisie : la confirmation s'affiche, « Continuer la
//     modification » garde le panneau, un second retour redemande, « Abandonner » ferme.
//  2. Lot périmé dans la fiche : explication + « Traiter le lot périmé » (ouvre le panneau de traitement, refermé
//     sans rien enregistrer) ; menu « … » du lot aux libellés écrits.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/back-and-lots-ux.js
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
  const today = new Date().toISOString().slice(0, 10)
  const { data: lots } = await db.from('product_batches').select('product_id, expiry_date, products(name, is_active)').eq('shop_id', ALPHA).gt('quantity', 0).lt('expiry_date', today).limit(20)
  const expiredLot = (lots || []).find(l => l.products?.is_active)
  console.log(`Repère : lot périmé de « ${expiredLot?.products?.name} » (${expiredLot?.expiry_date})`)

  const s = await session({ width: 390, height: 844, scale: 1, locale: 'fr' })
  const page = s.page
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
  const writes = []
  await page.route(/\/(api|rest\/v1)\//, r => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) || (/\/rest\/v1\/rpc\//.test(r.request().url()) && /sellable|business_date|shop_today/.test(r.request().url()))
    ? r.fallback() : (writes.push(r.request().method() + ' ' + new URL(r.request().url()).pathname), r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))))
  const drawer = page.locator('[data-testid="product-detail"]')
  const path = () => new URL(page.url()).pathname
  const openSheet = async name => {
    await page.getByLabel(require('../../messages/fr.json').products.search_placeholder).first().fill(name); await wait(1500)
    await page.locator('[data-product-name]', { hasText: name }).first().click()
    await drawer.waitFor({ timeout: 15000 })
    await wait(800)
  }

  console.log('\n1. Retour depuis la fiche produit')
  await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(5000)
  await page.locator('main a[href="/fr/stock/products"]:visible').first().click()
  await page.waitForURL(/\/fr\/stock\/products/, { timeout: 30000 }); await wait(5000)
  await openSheet(expiredLot.products.name)
  await page.goBack(); await wait(1200)
  ok(path() === '/fr/stock/products' && await drawer.count() === 0, `retour : fiche fermée, toujours sur Produits (${path()})`)
  await openSheet(expiredLot.products.name)
  await page.keyboard.press('Escape'); await wait(1000)
  ok(await drawer.count() === 0, 'Échap ferme la fiche')
  await page.goBack(); await wait(2500)
  ok(path() === '/fr/stock', `fiche déjà fermée : un seul retour revient à la Vue d'ensemble, aucune étape « dans le vide » (${path()})`)
  await page.goForward(); await wait(4000)
  ok(path() === '/fr/stock/products', `avancer : de nouveau sur Produits (${path()})`)

  console.log('\n2. Formulaire avec saisie : la confirmation protège la saisie')
  await page.locator('[data-tour="add-product-menu"]:visible').first().click()
  await page.getByRole('menuitem', { name: 'Ajouter un produit' }).click()
  const form = page.locator('#product-form'); await form.waitFor({ timeout: 15000 }); await wait(800)
  await form.locator('input').first().fill('TEST retour (non enregistré)')
  await page.goBack(); await wait(1000)
  const unsaved = page.getByTestId('unsaved-changes-dialog')
  ok(await unsaved.count() === 1 && await form.count() === 1, 'retour avec saisie : « Modifications non enregistrées », le formulaire reste')
  await page.getByRole('button', { name: 'Continuer la modification' }).click(); await wait(800)
  ok(await unsaved.count() === 0 && await form.count() === 1 && (await form.locator('input').first().inputValue()) === 'TEST retour (non enregistré)', '« Continuer la modification » : formulaire et saisie gardés')
  await page.goBack(); await wait(1000)
  ok(await unsaved.count() === 1, 'second retour : la confirmation revient (étape gardée)')
  await page.getByRole('button', { name: 'Abandonner' }).click(); await wait(1200)
  ok(await form.count() === 0 && path() === '/fr/stock/products', `« Abandonner » : formulaire fermé, toujours sur Produits (${path()})`)

  console.log('\n3. Lot périmé dans la fiche')
  await openSheet(expiredLot.products.name)
  await drawer.getByTestId('product-detail-batches').scrollIntoViewIfNeeded().catch(() => {})
  const row = drawer.locator('[data-batch-row][data-expired="1"]').first()
  await row.waitFor({ timeout: 15000 }).catch(() => {})
  ok(await row.count() === 1, 'lot périmé repéré dans la fiche')
  ok(/ne se vend plus/.test(await row.innerText()) && await row.getByTestId('batch-treat').count() === 1, 'explication + bouton « Traiter le lot périmé »')
  await row.screenshot({ path: `${OUT}/back-lots-lot-perime.png` }).catch(() => {})
  await row.getByTestId('batch-actions').click(); await wait(400)
  const items = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  ok(items.join(' / ') === 'Traiter le lot périmé / Corriger la quantité / Modifier la date de péremption / Supprimer le lot', `menu « … » du lot : ${items.join(' / ')}`)
  await page.keyboard.press('Escape'); await wait(400)
  await row.getByTestId('batch-treat').click(); await wait(1500)
  const treat = page.getByTestId('batch-treatment-actions')
  ok(await treat.count() === 1, 'panneau « Traiter le lot » ouvert depuis la fiche')
  await page.screenshot({ path: `${OUT}/back-lots-traitement.png` })
  await page.goBack(); await wait(1200)
  ok(await treat.count() === 0 && await drawer.count() === 1, 'retour : le panneau de traitement se ferme, la fiche reste')
  await page.goBack(); await wait(1200)
  ok(await drawer.count() === 0 && path() === '/fr/stock/products', 'retour : la fiche se ferme, toujours sur Produits')
  const stockWrites = writes.filter(w => /product|batch|treatment|stock/.test(w))
  ok(!stockWrites.length, `aucune écriture de stock envoyée (${stockWrites.length} ; autres requêtes bloquées : ${writes.length})`, writes)
  ok(!errors.length, 'aucune erreur JavaScript', errors)
  await s.browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
