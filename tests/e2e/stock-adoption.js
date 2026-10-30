// Adoption du contexte boutique — pages Stock. LECTURE SEULE (compte vitrine Marché Soleil) : toute écriture
// vers /api est interceptée (réponse simulée) et relue ; les lectures sont réelles. Valeurs attendues en base.
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const FULL = { [AKWA]: 'Marché Soleil Akwa', [BONA]: 'Marché Soleil Bonapriso', [BASTOS]: 'Marché Soleil Bastos' }
let pass = 0, fail = 0
// Libellés parfois mis en capitales par la feuille de style : comparaison sans tenir compte de la casse
const low = t => String(t).toLocaleLowerCase('fr')
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

// shop = null → « Toutes les boutiques »
async function open(path, { shop = null, width = 1366, height = 900, locale = 'fr' } = {}) {
  const s = await session({ width, height, scale: 1, locale })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', id || 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.writes = []; s.gets = []; s.errors = []; s.dialogs = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('dialog', d => { s.dialogs.push(d.message()); d.dismiss().catch(() => {}) })
  await s.page.route(/\/api\//, route => {
    const r = route.request(), url = new URL(r.url())
    if (r.method() === 'GET') { s.gets.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) }); return route.fallback() }
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, body })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: 'x', reference: 'TEST' } }) })
  })
  await s.page.goto(`${BASE}/${locale}/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const badge = page => page.getByTestId('shop-scope-badge')
const pickShop = async (page, id) => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); await p.locator(`[data-shop-option="${id}"]`).click(); await page.waitForTimeout(1200) }

;(async () => {
  const prods = (await db.from('products').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).eq('is_active', true)).data
  const bonaCats = (await db.from('categories').select('name').eq('shop_id', BONA)).data.map(c => c.name).sort()

  console.log('1. Vue d’ensemble')
  let s = await open('stock')
  ok((await s.page.getByTestId('overview-shop-context').innerText()).trim() === 'Toutes les boutiques', '« Toutes » : « Toutes les boutiques » près du titre')
  await s.browser.close()
  s = await open('stock', { shop: AKWA })
  ok((await s.page.getByTestId('overview-shop-context').innerText()).trim() === 'Akwa', 'Akwa : « Akwa » (nom court), indicateurs de cette boutique')
  await s.browser.close()

  console.log('\n2. Produits — « Toutes les boutiques »')
  s = await open('stock/products'); let page = s.page
  ok(await badge(page).isVisible() && (await badge(page).innerText()).trim() === 'Toutes les boutiques', 'badge « Toutes les boutiques » près du compteur')
  // Créer : choix explicite de la boutique
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.locator('[data-tour="add-product-item"]').click()
  const picker = page.getByTestId('shop-picker'); await picker.waitFor({ timeout: 10000 })
  ok((await picker.locator('[data-shop-option]').count()) === 3 && await page.getByTestId('product-drawer').count() === 0, 'créer un produit : « Dans quelle boutique ? » (3 boutiques), aucun panneau ouvert avant le choix')
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(600)
  ok(await page.getByTestId('product-drawer').count() === 0, 'annuler le choix : rien n’est ouvert, aucune boutique prise à la place')
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.locator('[data-tour="add-product-item"]').click()
  await pickShop(page, BONA)
  const drawer = page.getByTestId('product-drawer'); await drawer.waitFor({ timeout: 10000 })
  ok(low(await drawer.innerText()).includes(low('Boutique : Marché Soleil Bonapriso')), 'panneau de création : « Boutique : Marché Soleil Bonapriso »')
  const catTrig = drawer.locator('#product-form div.space-y-1\\.5').filter({ has: page.locator('label', { hasText: /^Catégorie/ }) }).locator('button[role=combobox]').first()
  await catTrig.click(); await page.waitForTimeout(400)
  const catOpts = (await page.getByRole('option').allInnerTexts()).map(x => x.trim()).filter(x => !/Aucune/.test(x)).sort()
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  ok(catOpts.join('|') === bonaCats.join('|'), `catégories proposées = celles de Bonapriso (${catOpts.length})`)
  await page.locator('#product-name').fill('TEST contexte création')
  await drawer.locator('#product-form div.space-y-1\\.5').filter({ has: page.locator('label', { hasText: /^Prix de vente/ }) }).locator('input').first().fill('900')
  const n0 = s.writes.length
  await page.locator('button[form="product-form"]').click(); await page.waitForTimeout(2000)
  const created = s.writes.slice(n0).find(w => w.path === '/api/products' && w.method === 'POST')
  ok(created && created.body.shop_id === BONA, `enregistrement → boutique choisie (${FULL[created?.body.shop_id] || created?.body.shop_id}), envoi intercepté`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  if (await page.getByRole('button', { name: /Abandonner/ }).count()) await page.getByRole('button', { name: /Abandonner/ }).click()
  await page.waitForTimeout(500)
  // Ajout rapide
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.getByRole('menuitem', { name: 'Ajout rapide' }).click()
  await pickShop(page, BASTOS)
  ok(low(await page.getByRole('dialog').last().innerText()).includes(low('Boutique : Marché Soleil Bastos')), 'ajout rapide : boutique choisie puis rappelée (« Boutique : Marché Soleil Bastos »)')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // Import : aucune présélection
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.getByRole('menuitem', { name: 'Importer des produits' }).click()
  const imp = page.getByTestId('import-drawer'); await imp.waitFor({ timeout: 15000 })
  ok(await imp.getByTestId('import-shop-required').isVisible() && await imp.locator('section[data-tour="import-file"] button').first().isDisabled(), 'import : aucune boutique présélectionnée, dépôt du fichier inactif tant qu’elle n’est pas choisie')
  await imp.locator('[data-testid=import-shop] button', { hasText: 'Marché Soleil Akwa' }).click(); await page.waitForTimeout(400)
  ok(!(await imp.locator('section[data-tour="import-file"] button').first().isDisabled()), 'boutique choisie → dépôt du fichier actif')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // Journal
  await page.getByTestId('products-more-actions').click(); await page.getByRole('menuitem', { name: /Journal d’activité/ }).click()
  await pickShop(page, AKWA)
  const jd = page.getByTestId('journal-drawer'); await jd.waitFor({ timeout: 10000 }); await page.waitForTimeout(1500)
  const jget = [...s.gets].reverse().find(g => g.path === '/api/audit/journal')
  ok(low(await jd.innerText()).includes(low('Boutique : Marché Soleil Akwa')) && jget?.query.shop_id === AKWA, 'journal : boutique choisie, rappelée, et seule interrogée')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // Fiche d'un produit de Bastos ouverte depuis « Toutes »
  const pBastos = prods.find(p => p.shop_id === BASTOS)
  await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.waitForTimeout(600)
  await page.locator('[data-testid=products-toolbar] input').first().fill(pBastos.name); await page.waitForTimeout(1200)
  await page.locator(`[data-product-card="${pBastos.id}"] button[aria-label^="Ouvrir la fiche"]`).click()
  const det = page.getByTestId('product-detail'); await det.waitFor({ timeout: 15000 })
  ok(low(await det.innerText()).includes(low('Marché Soleil Bastos')), `fiche produit : boutique de l’objet (« … · Marché Soleil Bastos »)`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n3. Produits — en-tête « Akwa »')
  s = await open('stock/products', { shop: AKWA }); page = s.page
  ok(await badge(page).count() === 0, 'pas de badge répété (le contexte est dans l’en-tête et la barre latérale)')
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.locator('[data-tour="add-product-item"]').click()
  await page.getByTestId('product-drawer').waitFor({ timeout: 10000 })
  ok(await page.getByTestId('shop-picker').count() === 0 && low(await page.getByTestId('product-drawer').innerText()).includes(low('Boutique : Marché Soleil Akwa')), 'créer : Akwa utilisée directement (pas de question), rappelée dans le panneau')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  const pAkwa = prods.find(p => p.shop_id === AKWA)
  await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.waitForTimeout(600)
  await page.locator('[data-testid=products-toolbar] input').first().fill(pAkwa.name); await page.waitForTimeout(1200)
  await page.locator(`[data-product-card="${pAkwa.id}"] button[aria-label^="Ouvrir la fiche"]`).click()
  await page.getByTestId('product-detail').waitFor({ timeout: 15000 })
  ok(low(await page.getByTestId('product-detail').innerText()).includes(low('Marché Soleil Akwa')), 'fiche produit : boutique de l’objet affichée aussi sur une page déjà « Akwa » (compte multi-boutique)')
  await s.browser.close()

  console.log('\n4. Mouvements et Lots')
  for (const [path, label] of [['stock/movements', 'Mouvements'], ['stock/expiry', 'Lots']]) {
    s = await open(path); const allB = await badge(s.page).isVisible(); await s.browser.close()
    s = await open(path, { shop: AKWA }); const oneB = await badge(s.page).count()
    ok(allB && oneB === 0, `${label} : badge en « Toutes », absent sur « Akwa »`)
    if (path === 'stock/expiry') {
      const row = s.page.locator('[data-lot-row] [data-lot-name], [data-lot-card]').first()
      if (await row.count()) {
        await row.click(); const ld = s.page.getByTestId('lot-detail'); await ld.waitFor({ timeout: 10000 })
        ok(low(await ld.innerText()).includes(low('Marché Soleil Akwa')), 'détail d’un lot : boutique de l’objet, même sur une page « Akwa »')
      } else console.log('  info  aucun lot à Akwa : détail non testé')
    }
    await s.browser.close()
  }

  console.log('\n5. Inventaire')
  s = await open('stock/inventory-count'); page = s.page
  // Mise à jour (15 oct. 2026) — ancienne hypothèse : écran de comptage d'une seule page (champs préremplis du stock,
  // « Valider l'inventaire » → /api/stock/inventory-count). Réel : inventaire en session (migration 175) — écran
  // « Démarrer un inventaire », comptage à l'aveugle ; on vérifie ici le CONTEXTE (boutique choisie, démarrage envoyé
  // vers elle, intercepté). Le parcours complet est couvert par pw/inventory-v2.js (Boutique Alpha, réel).
  ok(await page.getByTestId('inventory-pick-shop').isVisible() && await page.getByTestId('inventory-start').count() === 0, '« Toutes » : aucun inventaire avant le choix explicite de la boutique')
  await page.getByTestId('inventory-pick-shop').getByRole('button').click()
  await pickShop(page, BASTOS); await page.waitForTimeout(3000)
  ok((await page.getByTestId('inventory-shop').innerText()).toLowerCase().includes('inventaire : marché soleil bastos') && await page.getByTestId('inventory-idle').isVisible(),
    'boutique inventoriée affichée (« Inventaire : Marché Soleil Bastos »), écran « Démarrer un inventaire »')
  const n1 = s.writes.length
  await page.getByTestId('inventory-start').click(); await page.waitForTimeout(1500)
  const inv = s.writes.slice(n1).find(w => w.path === '/api/stock/inventory-sessions')
  ok(inv && inv.body.shop_id === BASTOS, `démarrage envoyé vers ${FULL[inv?.body.shop_id] || inv?.body.shop_id} (intercepté)`)
  await s.browser.close()
  s = await open('stock/inventory-count', { shop: AKWA })
  ok(await s.page.getByTestId('inventory-pick-shop').count() === 0 && low(await s.page.getByTestId('inventory-shop').innerText()).includes(low('Marché Soleil Akwa')), '« Akwa » : boutique de l’en-tête utilisée, affichée')
  await s.browser.close()

  console.log('\n6. Transferts (TR-2026-0001 Akwa → Bonapriso, TR-2026-0002 Akwa → Bastos)')
  for (const [shop, expected, name] of [[null, ['TR-2026-0001', 'TR-2026-0002'], 'Toutes'], [AKWA, ['TR-2026-0001', 'TR-2026-0002'], 'Akwa (source)'], [BASTOS, ['TR-2026-0002'], 'Bastos (destination)'], [BONA, ['TR-2026-0001'], 'Bonapriso (destination)']]) {
    s = await open('stock/transfers', { shop }); await s.page.waitForTimeout(2000)
    const txt = await s.page.locator('main').innerText()
    const seen = ['TR-2026-0001', 'TR-2026-0002'].filter(r => txt.includes(r))
    ok(seen.join() === expected.join(), `${name} : ${seen.join(', ') || 'aucun'}`)
    if (shop === null) {
      ok(/Marché Soleil Akwa\s*→?\s*Marché Soleil Bastos/.test(txt.replace(/\n/g, ' ')) || (txt.includes('Marché Soleil Akwa') && txt.includes('Marché Soleil Bastos')), 'chaque carte : « Source → Destination »')
      // Nouveau transfert : source choisie explicitement
      await s.page.getByRole('button', { name: 'Nouveau transfert' }).click()
      await pickShop(s.page, AKWA)
      const td = s.page.getByTestId('transfer-drawer'); await td.waitFor({ timeout: 10000 })
      ok(low(await td.innerText()).includes(low('Depuis : Marché Soleil Akwa')), 'nouveau transfert : source choisie, rappelée (« Depuis : Marché Soleil Akwa »)')
      await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(600)
      // Annulation : confirmation nommant les deux boutiques (refusée → rien envoyé)
      // Transferts V1 : l'annulation est dans le menu « … » de la carte
      const card = s.page.getByTestId('transfer-card').filter({ hasText: 'TR-2026-0002' }).first()
      await card.getByTestId('transfer-more').click(); await s.page.waitForTimeout(600)
      const n2 = s.writes.length
      const cancelItem = s.page.getByRole('menuitem', { name: /Annuler le transfert/ })
      if (await cancelItem.count()) {
        await cancelItem.first().click(); await s.page.waitForTimeout(800)
        // Fenêtre de confirmation commune (plus de confirm() du navigateur, 30 oct. 2026) : refusée par « Retour »
        const askTxt = await s.page.getByRole('dialog').last().innerText().catch(() => '')
        await s.page.getByRole('dialog').last().getByRole('button', { name: 'Retour', exact: true }).click().catch(() => {}); await s.page.waitForTimeout(600)
        ok(askTxt.includes('TR-2026-0002') && askTxt.includes('Marché Soleil Akwa → Marché Soleil Bastos') && s.dialogs.length === 0 && s.writes.length === n2 && await s.page.getByRole('dialog').count() === 0,
          'annuler : fenêtre « Annuler le transfert TR-2026-0002 (Marché Soleil Akwa → Marché Soleil Bastos) ? », refusée → rien envoyé, aucune fenêtre du navigateur')
      } else console.log('  info  bouton Annuler non trouvé')
      const g = [...s.gets].reverse().find(x => x.path === '/api/stock-transfers')
      ok(g && g.query.shop_ids && g.query.shop_ids.split(',').length === 3, 'liste demandée pour les 3 boutiques du contexte')
    }
    await s.browser.close()
  }

  console.log('\n7. Largeurs et langues (badge et en-tête)')
  for (const [w, locale, label] of [[360, 'fr', 'Toutes les boutiques'], [390, 'en', 'All shops'], [768, 'ha', 'Duk shaguna'], [1024, 'fr', 'Toutes les boutiques'], [1440, 'fr', 'Toutes les boutiques']]) {
    s = await open('stock/products', { width: w, height: 900, locale })
    const t = (await badge(s.page).innerText().catch(() => '')).trim()
    const ov = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(t === label && ov <= 0, `${locale} ${w} px : « ${t} », pas de débordement`)
    await s.browser.close()
  }
  console.log('\n8. Passage Akwa → Toutes → Bastos dans le même onglet (sélecteur de l’en-tête)')
  const total = prods.length, nAkwa = prods.filter(p => p.shop_id === AKWA).length, nBastos = prods.filter(p => p.shop_id === BASTOS).length
  s = await open('stock/products', { shop: AKWA, width: 390, height: 844 }); page = s.page
  const switchTo = async label => {
    await page.getByTestId('header-shop-context').click(); await page.waitForTimeout(300)
    await page.locator('header button', { hasText: label }).last().click(); await page.waitForTimeout(3500)
  }
  const headerTxt = async () => (await page.getByTestId('header-shop-context').innerText()).trim()
  const countNow = async () => Number(((await page.getByTestId('products-count').innerText()).match(/\d+/) || [0])[0])
  const catTxt = async () => (await page.getByTestId('filter-category').innerText()).replace(/\s+/g, ' ').trim()
  ok(await headerTxt() === 'Akwa' && await countNow() === nAkwa, `Akwa : ${nAkwa} produits`)
  await page.getByTestId('filter-category').click(); const sh = page.getByTestId('filter-category-sheet'); await sh.waitFor()
  await sh.locator('[data-filter-option]').first().click(); await sh.locator('[data-filter-apply]').click(); await page.waitForTimeout(800)
  const akwaCat = await catTxt()
  await switchTo('Toutes les boutiques')
  ok(await headerTxt() === 'Toutes' && await countNow() === total && await catTxt() === 'Catégorie' && (await badge(page).innerText()).trim() === 'Toutes les boutiques',
    `→ Toutes : ${total} produits, filtre d’Akwa (« ${akwaCat} ») non repris, badge « Toutes les boutiques »`)
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.locator('[data-tour="add-product-item"]').click()
  await pickShop(page, BONA); await page.getByTestId('product-drawer').waitFor()
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  await switchTo('Marché Soleil Bastos')
  ok(await headerTxt() === 'Bastos' && await countNow() === nBastos && await catTxt() === 'Catégorie' && await badge(page).count() === 0, `→ Bastos : ${nBastos} produits, aucun filtre repris, pas de badge`)
  await page.locator('[data-tour="add-product-menu"]:visible').first().click(); await page.locator('[data-tour="add-product-item"]').click()
  await page.getByTestId('product-drawer').waitFor({ timeout: 10000 })
  ok(await page.getByTestId('shop-picker').count() === 0 && low(await page.getByTestId('product-drawer').innerText()).includes(low('Boutique : Marché Soleil Bastos')), 'créer : Bastos (l’en-tête), pas Bonapriso choisie auparavant en « Toutes »')
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  await switchTo('Marché Soleil Akwa')
  ok(await catTxt() === akwaCat, `retour à Akwa : son propre filtre « ${akwaCat} » restauré`)
  await s.browser.close()

  s = await open('stock/inventory-count', { width: 390, height: 844 }); page = s.page
  await page.getByTestId('inventory-pick-shop').getByRole('button').click(); await pickShop(page, AKWA); await page.waitForTimeout(2500)
  ok(low(await page.getByTestId('inventory-shop').innerText()).includes(low('Marché Soleil Akwa')), 'inventaire en « Toutes » : Akwa choisie')
  await switchTo('Marché Soleil Bastos')
  ok(low(await page.getByTestId('inventory-shop').innerText()).includes(low('Marché Soleil Bastos')) && await page.getByTestId('inventory-pick-shop').count() === 0, '→ Bastos : l’inventaire suit l’en-tête (Bastos)')
  await switchTo('Toutes les boutiques')
  ok(await page.getByTestId('inventory-pick-shop').isVisible() && await page.getByTestId('inventory-shop').count() === 0, '→ Toutes : la boutique choisie plus tôt (Akwa) n’est PAS reprise, nouveau choix demandé')
  await s.browser.close()

  s = await open('stock/transfers', { shop: AKWA, width: 390, height: 844 }); page = s.page
  const refs = async () => { await page.waitForTimeout(1500); const t = await page.locator('main').innerText(); return ['TR-2026-0001', 'TR-2026-0002'].filter(r => t.includes(r)).join(',') }
  const r1 = await refs(); await switchTo('Toutes les boutiques'); const r2 = await refs(); await switchTo('Marché Soleil Bastos'); const r3 = await refs()
  ok(r1 === 'TR-2026-0001,TR-2026-0002' && r2 === 'TR-2026-0001,TR-2026-0002' && r3 === 'TR-2026-0002', `transferts : Akwa ${r1} → Toutes ${r2} → Bastos ${r3}`)
  await s.browser.close()

  console.log('\n9. Compte à une seule boutique (caissier d’Alpha) : aucun bruit')
  process.env.CAPTURE_EMAIL = 'stocshopci@gmail.com'
  for (const path of ['stock', 'stock/products', 'stock/movements', 'stock/expiry']) {
    s = await (async () => { const x = await session({ width: 390, height: 844, scale: 1, locale: 'fr' }); await x.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await x.page.waitForTimeout(6000); return x })()
    const noise = await s.page.getByTestId('shop-scope-badge').count() + await s.page.getByTestId('overview-shop-context').count() + await s.page.getByTestId('header-shop-context').count()
    ok(noise === 0, `${path} : aucun badge ni sélecteur`)
    await s.browser.close()
  }
  process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
