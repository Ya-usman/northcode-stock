// Lot 2 — Fournisseurs (+ bons de commande), Catégories, Clients en contexte boutique ; contrôles serveur des objets rattachés.
// Partie A (écrans) : compte vitrine Marché Soleil, LECTURE SEULE — toute écriture /api interceptée (corps relu), boutique
// active cachée volontairement sur Bastos pour prouver qu'elle n'est plus jamais utilisée.
// Partie B (serveur) : Boutique Alpha (compte d'essai), MODE ÉCRITURE explicite (lib/write-mode.js) activé pour cette
// partie seulement — requêtes conçues pour être REFUSÉES avant écriture ; un seul bon d'essai « TEST <exécution> »
// (brouillon) créé puis supprimé par le parcours normal ; à la fin, seules les lignes nouvelles de cette exécution
// sont supprimées, une à une ; vérifications en base (lecture).
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE } = require('./lib/capture.js')
const { openPage } = require('./lib/session.js')
const { enableWrite } = require('./lib/write-mode.js')
let W = null, cleanupB = null
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const FULL = { [AKWA]: 'Marché Soleil Akwa', [BONA]: 'Marché Soleil Bonapriso', [BASTOS]: 'Marché Soleil Bastos' }
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const low = s => String(s || '').toLowerCase()

// shop = null → « Toutes » ; boutique active cachée = Bastos ; offFeature : droit général coupé à Bastos (navigateur)
async function open(path, { shop = null, width = 1366, height = 900, offFeature = null } = {}) {
  const s = await session({ width, height, scale: 1, locale: 'fr' })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.writes = []; s.errors = []; s.dialogs = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('dialog', d => { s.dialogs.push(d.message()); d.dismiss().catch(() => {}) })
  if (offFeature) {
    await s.page.route(/\/rest\/v1\/(shops|shop_members)\?/, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const res = await route.fetch(); let body = await res.text()
      try {
        const patch = x => { if (Array.isArray(x)) return x.map(patch); if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = patch(v); if (o.id === BASTOS && 'role_permissions' in o) o.role_permissions = { ...(o.role_permissions || {}), general: { ...((o.role_permissions || {}).general || {}), [offFeature]: false } }; return o } return x }
        body = JSON.stringify(patch(JSON.parse(body))).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false')
      } catch {}
      return route.fulfill({ response: res, body })
    })
  }
  await s.page.route(/\/api\//, route => {
    const r = route.request(), url = new URL(r.url())
    if (['GET', 'HEAD'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: 'x' } }) })
  })
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const pickerOptions = async page => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); return p.locator('[data-shop-option]').evaluateAll(els => els.map(e => e.getAttribute('data-shop-option'))) }
const pick = async (page, id) => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); await p.locator(`[data-shop-option="${id}"]`).click(); await page.waitForTimeout(1200) }
const lastWrite = (s, path, method) => [...s.writes].reverse().find(w => w.path === path && (!method || w.method === method))
const switchTo = async (page, label) => { await page.getByTestId('header-shop-context').click(); await page.waitForTimeout(300); await page.locator('header button', { hasText: label }).last().click(); await page.waitForTimeout(3500) }
const poRefs = async page => page.locator('[data-po-card]').evaluateAll(els => els.map(e => e.getAttribute('data-po-card')).sort())
// Onglets de page : rôle « tab » (barre commune SegmentedTabs, 30 oct. 2026)
const tab = (page, name) => page.getByRole('tab', { name, exact: false }).first()

;(async () => {
  const sup = (await db.from('suppliers').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).is('deleted_at', null)).data
  const bonaSup = sup.filter(x => x.shop_id === BONA).map(x => x.name).sort()
  // Fournisseur d'Akwa dont le nom n'existe dans aucune autre boutique (« Ferme des Hauts Plateaux » existe à Akwa ET à Bonapriso)
  const akwaSupplier = sup.find(x => x.shop_id === AKWA && !sup.some(y => y.shop_id !== AKWA && y.name === x.name))
  const cats = (await db.from('categories').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS])).data
  const akwaCat = cats.find(c => c.shop_id === AKWA)
  const custs = (await db.from('customers').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).is('deleted_at', null)).data
  const bastosCustomer = custs.find(c => c.shop_id === BASTOS)
  // Bons de commande attendus, lus en base (lecture seule ; hors reprises de dette, comme l'écran) : le compte vitrine
  // évolue (BC-2026-0005 créé le 24 oct. 2026), la liste n'est plus figée dans le test
  const pos = (await db.from('purchase_orders').select('reference, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).eq('is_opening_balance', false)).data
  const POS_ALL = pos.map(p => p.reference).sort(), POS_AKWA = pos.filter(p => p.shop_id === AKWA).length, POS_BASTOS = pos.filter(p => p.shop_id === BASTOS).length
  console.log(`Repères : fournisseurs ${sup.length} (Bonapriso : ${bonaSup.join(', ')}), bons ${POS_ALL.join(', ')} (Akwa ${POS_AKWA}, Bastos ${POS_BASTOS}), client de Bastos « ${bastosCustomer?.name} »`)

  console.log('\n1. Fournisseurs en « Toutes » (boutique active cachée : Bastos)')
  let s = await open('suppliers'); let page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  await tab(page, 'Bons de commande').click(); await page.waitForTimeout(2500)
  let refs = await poRefs(page)
  ok(POS_ALL.length > 0 && refs.join() === POS_ALL.join(), `bons des boutiques du contexte : ${refs.join(', ')} (attendus : ${POS_ALL.join(', ')} ; avant : ceux de la boutique cachée Bastos — aucun)`)
  ok((await page.locator('[data-po-card="BC-2026-0004"] [data-po-shop]').innerText().catch(() => '')).includes('Marché Soleil Akwa'), 'chaque bon rappelle sa boutique en « Toutes » (« Marché Soleil Akwa »)')
  // Action sur un bon existant : boutique DU bon
  const card4 = page.locator('[data-po-card="BC-2026-0004"]')
  await card4.locator('button:visible', { hasText: 'Marquer comme envoyé' }).first().click(); await page.waitForTimeout(1500)
  let w = lastWrite(s, '/api/purchase-orders', 'PATCH')
  ok(w && w.body.shop_id === AKWA && w.body.status === 'sent', `« Marquer comme envoyé » → boutique ${FULL[w?.body.shop_id] || w?.body.shop_id} (interceptée)`)
  // Nouveau bon depuis « Toutes » : boutique choisie, fournisseurs de cette boutique
  await page.getByRole('button', { name: /Nouveau bon de commande/ }).first().click()
  const poOpts = await pickerOptions(page)
  ok(poOpts.length === 3 && await page.getByTestId('po-drawer').count() === 0, `nouveau bon : « Pour quelle boutique ? » (${poOpts.length} boutiques), aucun panneau avant le choix`)
  await pick(page, BONA)
  const drawer = page.getByTestId('po-drawer'); await drawer.waitFor({ timeout: 10000 })
  ok(low(await drawer.innerText()).includes('boutique : marché soleil bonapriso'), 'panneau : « Boutique : Marché Soleil Bonapriso »')
  await page.getByTestId('po-supplier').click(); await page.waitForTimeout(400)
  const supOpts = (await page.getByRole('option').allInnerTexts()).map(x => x.trim()).sort()
  ok(supOpts.join('|') === bonaSup.join('|'), `fournisseurs proposés : ceux de Bonapriso seulement (${supOpts.join(', ')})`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  await s.browser.close()

  console.log('\n2. Fiches fournisseurs : création (boutique choisie), modification (boutique du fournisseur), import')
  s = await open('suppliers'); page = s.page
  await page.getByRole('button', { name: /Ajouter un fournisseur/ }).first().click()
  await pick(page, BASTOS)
  const sd = page.getByTestId('supplier-dialog'); await sd.waitFor({ timeout: 10000 })
  ok(low(await sd.innerText()).includes('boutique : marché soleil bastos'), 'création : « Boutique : Marché Soleil Bastos » dans la fenêtre')
  await sd.locator('input').first().fill('TEST fournisseur lot 2')
  await sd.getByTestId('dialog-submit').click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/suppliers', 'POST')
  ok(w && w.body.shop_id === BASTOS, `création envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (interceptée)`)
  const supCard = page.locator('div.rounded-lg', { hasText: akwaSupplier.name }).filter({ has: page.locator('button[aria-label="Modifier"]') }).last()
  await supCard.locator('button[aria-label="Modifier"]').first().click(); await sd.waitFor({ timeout: 10000 })
  ok(low(await sd.innerText()).includes('boutique : marché soleil akwa'), `modification de « ${akwaSupplier.name} » : « Boutique : Marché Soleil Akwa »`)
  await sd.getByTestId('dialog-submit').click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/suppliers', 'PATCH')
  ok(w && w.body.shop_id === AKWA, `modification envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (boutique du fournisseur, pas la boutique cachée)`)
  await page.getByTestId('suppliers-files').click(); await page.getByTestId('suppliers-import').click()
  await page.getByTestId('import-drawer').waitFor({ timeout: 15000 })
  ok(await page.getByTestId('import-shop-required').isVisible().catch(() => false), 'import en « Toutes » : aucune boutique présélectionnée, choix demandé')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n3. Passage Akwa → Toutes → Bastos (téléphone)')
  // Un panneau ouvert couvre l'en-tête : on ferme, puis on change de contexte — la boutique précédente n'est jamais reprise
  s = await open('suppliers?view=purchase_orders', { shop: AKWA, width: 390, height: 844 }); page = s.page
  const r1 = (await poRefs(page)).length
  await page.getByRole('button', { name: /Nouveau bon de commande/ }).first().click(); await page.waitForTimeout(1200)
  const dAkwa = low(await page.getByTestId('po-drawer').innerText().catch(() => ''))
  ok(await page.getByTestId('shop-picker').count() === 0 && dAkwa.includes('boutique : marché soleil akwa'), 'Akwa : nouveau bon dans Akwa, sans question')
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  await switchTo(page, 'Toutes les boutiques')
  const r2 = (await poRefs(page)).length
  await page.getByRole('button', { name: /Nouveau bon de commande/ }).first().click(); await page.waitForTimeout(800)
  ok(await page.getByTestId('shop-picker').isVisible().catch(() => false) && await page.getByTestId('po-drawer').count() === 0, '→ Toutes : nouveau bon = choix demandé (Akwa n’est pas reprise)')
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(600)
  await switchTo(page, 'Marché Soleil Bastos')
  const r3 = (await poRefs(page)).length
  await page.getByRole('button', { name: /Nouveau bon de commande/ }).first().click(); await page.waitForTimeout(1200)
  ok(await page.getByTestId('shop-picker').count() === 0 && low(await page.getByTestId('po-drawer').innerText().catch(() => '')).includes('boutique : marché soleil bastos'), '→ Bastos : nouveau bon dans Bastos, sans question')
  ok(r1 === POS_AKWA && r2 === POS_ALL.length && r3 === POS_BASTOS, `bons : Akwa ${r1} → Toutes ${r2} → Bastos ${r3} (attendus ${POS_AKWA} / ${POS_ALL.length} / ${POS_BASTOS})`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n4. Catégories')
  s = await open('categories'); page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques » près du compteur')
  await page.locator('[data-tour="add-category"]').click()
  await pick(page, BONA)
  const cd = page.getByTestId('category-dialog'); await cd.waitFor({ timeout: 10000 })
  ok(low(await cd.innerText()).includes('boutique : marché soleil bonapriso'), 'ajout : « Boutique : Marché Soleil Bonapriso »')
  await cd.locator('#cat-name').fill('TEST catégorie lot 2'); await cd.getByRole('button', { name: /^Ajouter/ }).last().click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/categories', 'POST')
  ok(w && w.body.shop_id === BONA, `ajout envoyé vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (intercepté)`)
  // Les 5 catégories existent sous le même nom dans les 3 boutiques : on vise celle du groupe « Marché Soleil Akwa »
  const akwaGroup = page.locator('div.space-y-2').filter({ has: page.locator('span', { hasText: /^Marché Soleil Akwa$/ }) }).last()
  await akwaGroup.getByTestId('category-edit').first().click(); await cd.waitFor({ timeout: 10000 })
  await cd.getByRole('button', { name: /Enregistrer/ }).last().click().catch(() => {}); await page.waitForTimeout(1200)
  w = lastWrite(s, '/api/categories', 'PATCH')
  ok(w && w.body.shop_id === AKWA, `modification d’une catégorie d’Akwa → ${w ? FULL[w.body.shop_id] : '(rien envoyé)'} (boutique de la catégorie, pas la boutique cachée)`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Restaurer/ }).first().click()
  await pick(page, BASTOS)
  const rd = page.getByRole('dialog').last(); await rd.waitFor({ timeout: 8000 })
  ok(low(await rd.innerText()).includes('boutique : marché soleil bastos'), 'restauration : boutique choisie et rappelée (« Boutique : Marché Soleil Bastos »)')
  await rd.getByRole('button', { name: /Restaurer/ }).last().click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/categories', 'PUT')
  ok(w && w.body.shop_id === BASTOS, `restauration envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (interceptée)`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n5. Clients')
  s = await open('customers'); page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  await page.getByTestId('customers-add').click()
  const custOpts = await pickerOptions(page)
  await pick(page, BONA)
  const kd = page.getByTestId('customer-dialog'); await kd.waitFor({ timeout: 10000 })
  ok(custOpts.length === 3 && low(await kd.innerText()).includes('boutique : marché soleil bonapriso'), 'ajout : boutique choisie, rappelée dans la fenêtre')
  await kd.locator('#customer-name').fill('TEST client lot 2'); await kd.getByTestId('dialog-submit').click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/customers', 'POST')
  ok(w && w.body.shop_id === BONA, `ajout envoyé vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (intercepté)`)
  const kc = page.locator('div.rounded-lg', { hasText: bastosCustomer.name }).filter({ has: page.locator('button[aria-label="Modifier"]') }).last()
  await kc.locator('button[aria-label="Modifier"]').first().click(); await kd.waitFor({ timeout: 10000 })
  ok(low(await kd.innerText()).includes('boutique : marché soleil bastos'), `modification de « ${bastosCustomer.name} » : « Boutique : Marché Soleil Bastos »`)
  await kd.locator('#customer-name').fill(bastosCustomer.name + ' '); await kd.getByTestId('dialog-submit').click(); await page.waitForTimeout(1500)
  w = lastWrite(s, '/api/customers', 'PATCH')
  ok(w && w.body.shop_id === BASTOS, `modification envoyée vers ${FULL[w?.body.shop_id] || w?.body.shop_id} (boutique du client)`)
  await page.getByTestId('customers-files').click(); await page.getByTestId('customers-import').click()
  await page.getByTestId('import-drawer').waitFor({ timeout: 15000 })
  ok(await page.getByTestId('import-shop-required').isVisible().catch(() => false), 'import en « Toutes » : choix de boutique demandé')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n6. Navigation et droits par boutique (« Fournisseurs » coupé à Bastos, dans ce navigateur)')
  s = await open('suppliers', { shop: BASTOS, offFeature: 'suppliers' }); page = s.page
  const navB = await page.locator('aside nav').innerText().catch(() => '')
  ok(!/Fournisseurs/.test(navB), 'en-tête Bastos : « Fournisseurs » absent de la navigation')
  await s.browser.close()
  s = await open('suppliers', { offFeature: 'suppliers' }); page = s.page
  const navT = await page.locator('aside nav').innerText().catch(() => '')
  ok(/Fournisseurs/.test(navT), '« Toutes » (boutique cachée : Bastos) : « Fournisseurs » présent — le droit existe à Akwa et Bonapriso')
  await page.getByRole('button', { name: /Ajouter un fournisseur/ }).first().click()
  const opts6 = await pickerOptions(page)
  ok(opts6.length === 2 && !opts6.includes(BASTOS), `création : seulement les boutiques autorisées (${opts6.map(o => FULL[o]).join(', ')})`)
  await s.browser.close()

  console.log('\n7. Compte à une seule boutique (caissier d’Alpha)')
  process.env.CAPTURE_EMAIL = 'stocshopci@gmail.com'
  delete require.cache[require.resolve('./lib/capture.js')]
  const capture2 = require('./lib/capture.js')
  const s7 = await capture2.session({ width: 1366, height: 900, scale: 1, locale: 'fr' })
  await s7.page.goto(`${BASE}/fr/customers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await s7.page.waitForTimeout(6000)
  ok(await s7.page.getByTestId('shop-scope-badge').count() === 0, 'Clients : aucun badge de contexte')
  await s7.page.goto(`${BASE}/fr/suppliers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await s7.page.waitForTimeout(5000)
  ok(await s7.page.getByTestId('shop-scope-badge').count() === 0, 'Fournisseurs : aucun badge de contexte')
  await s7.browser.close()

  console.log('\n8. Serveur — objets rattachés (Boutique Alpha, requêtes conçues pour être refusées)')
  const alphaSup = (await db.from('suppliers').select('id').eq('shop_id', ALPHA).is('deleted_at', null).limit(1).single()).data
  const alphaProd = (await db.from('products').select('id, name').eq('shop_id', ALPHA).limit(1).single()).data
  const foreignProd = (await db.from('products').select('id').eq('shop_id', AKWA).limit(1).single()).data
  const foreignSup = akwaSupplier
  const poCount = async () => (await db.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const priceCount = async () => (await db.from('product_supplier_prices').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const before = { po: await poCount(), price: await priceCount() }
  // Mode écriture : seulement les bons de commande et les prix comparés, vers Alpha
  W = await enableWrite({ test: 'lot2-scope (partie B)', routes: [/\/api\/purchase-orders(\?|$)/, /\/api\/product-supplier-prices(\?|$)/] })
  const RUN = W.RUN
  const NOTE = `TEST lot 2 ${RUN}`
  let testPoId = null
  let cleaned = false
  cleanupB = async () => {
    if (cleaned) return true
    cleaned = true
    const cites = r => { const j = JSON.stringify(r); return j.includes(RUN) || (testPoId && j.includes(testPoId)) }
    return W.finish({
      purchase_orders: cites, purchase_order_items: r => !!testPoId && r.purchase_order_id === testPoId,
      // prix comparé créé à tort par une requête qui devait être refusée (prix 1 sur les produits de l'essai)
      product_supplier_prices: r => Number(r.price) === 1 && [alphaProd.id, foreignProd.id].includes(r.product_id),
      audit_logs: cites, deleted_records_log: cites,
    })
  }
  // Mise à jour (23 oct. 2026) : compte d'Alpha explicite — le caissier de l'étape 7 (CAPTURE_EMAIL) restait actif
  const a = await openPage({ width: 1280, height: 900, skipGoto: true, email: 'admin@northcode.ng', write: W })
  await a.page.goto('http://localhost:3000/fr/offline', { waitUntil: 'domcontentloaded' })
  const api = (method, url, body) => a.page.evaluate(async ({ method, url, body }) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch {} return { status: r.status, json: j } }, { method, url, body })
  const item = p => ({ product_id: p.id, product_name: 'TEST ligne', unit: 'piece', quantity_ordered: 1, unit_price: 1 })
  let r = await api('POST', '/api/purchase-orders', { shop_id: ALPHA, supplier_id: foreignSup.id, items: [item(alphaProd)], notes: NOTE })
  ok(r.status === 400 && /fournisseur n’appartient pas à la boutique de ce bon/.test(r.json.error || ''), `bon d’Alpha + fournisseur d’une autre entreprise → refusé (${r.status} « ${r.json.error} »)`)
  r = await api('POST', '/api/purchase-orders', { shop_id: ALPHA, supplier_id: alphaSup.id, items: [item(foreignProd)], notes: NOTE })
  ok(r.status === 400 && /produits n’appartient pas/.test(r.json.error || ''), `bon d’Alpha + produit d’une autre entreprise → refusé (${r.status})`)
  ok(await poCount() === before.po, `aucun bon créé (${before.po})`)
  r = await api('POST', '/api/purchase-orders', { shop_id: ALPHA, supplier_id: alphaSup.id, items: [item(alphaProd)], notes: `${NOTE} — brouillon d’essai, supprimé aussitôt` })
  const testPo = r.json?.data
  testPoId = testPo?.id || null
  ok(r.status === 200 && testPo?.id, `bon d’essai valide créé (${testPo?.reference}, brouillon)`)
  if (testPo?.id) {
    r = await api('PATCH', '/api/purchase-orders', { id: testPo.id, shop_id: ALPHA, items: [item(foreignProd)] })
    const items = (await db.from('purchase_order_items').select('product_id').eq('purchase_order_id', testPo.id)).data || []
    ok(r.status === 400 && items.length === 1 && items[0].product_id === alphaProd.id, `modification avec un produit d’une autre entreprise → refusée (${r.status}), lignes intactes`)
    await W.checkpoint()
    r = await api('DELETE', `/api/purchase-orders?id=${testPo.id}&shop_id=${ALPHA}`)
    ok(r.status === 200 && await poCount() === before.po, `bon d’essai supprimé par le parcours normal (${r.status}), ${await poCount()} bons comme avant`)
  }
  r = await api('POST', '/api/product-supplier-prices', { shop_id: ALPHA, product_id: foreignProd.id, supplier_id: alphaSup.id, price: 1 })
  ok(r.status === 400 && /Ce produit n’appartient pas/.test(r.json.error || ''), `prix comparé : produit d’une autre entreprise → refusé (${r.status})`)
  r = await api('POST', '/api/product-supplier-prices', { shop_id: ALPHA, product_id: alphaProd.id, supplier_id: foreignSup.id, price: 1 })
  ok(r.status === 400 && /fournisseur n’appartient pas/.test(r.json.error || ''), `prix comparé : fournisseur d’une autre entreprise → refusé (${r.status})`)
  ok(await priceCount() === before.price, `aucun prix comparé créé (${before.price})`)
  r = await api('GET', `/api/purchase-orders?shop_ids=${ALPHA},${AKWA}`)
  const shopsSeen = [...new Set((r.json.data || []).map(x => x.shop_id))]
  ok(r.status === 200 && shopsSeen.length === 1 && shopsSeen[0] === ALPHA, `lecture multi-boutiques : seulement les boutiques dont la personne est membre (${shopsSeen.length} boutique, Akwa ignorée)`)
  r = await api('GET', `/api/purchase-orders?shop_ids=${AKWA}`)
  ok(r.status === 403, `boutique d’une autre entreprise seule → refus (${r.status})`)
  await a.browser.close()
  ok(await cleanupB(), 'mode écriture : rien de préexistant touché, aucune trace restante en base')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(async e => {
  console.error('ERREUR', e.message.slice(0, 400))
  // Arrêt imprévu pendant la partie B : nettoyage quand même (lignes de cette exécution seulement)
  if (cleanupB) { try { await cleanupB() } catch (c) { console.error('NETTOYAGE IMPOSSIBLE', c.message) } }
  console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1)
})
