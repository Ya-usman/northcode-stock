// FIX contexte boutique — LECTURE SEULE (compte vitrine Marché Soleil, gardé intact).
// En « Toutes les boutiques », la boutique active interne est volontairement « Bastos » (boutique CACHÉE) :
// toute action sur un objet d'Akwa ou de Bonapriso doit partir avec la boutique DE L'OBJET. Chaque écriture
// est interceptée (réponse simulée), son contenu relu, jamais transmise. Valeurs attendues lues en base.
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const NAME = { [AKWA]: 'Akwa', [BONA]: 'Bonapriso', [BASTOS]: 'Bastos' }
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const info = m => console.log('  info  ' + m)
const pad = n => String(n).padStart(2, '0')
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

// shop = null → « Toutes les boutiques », boutique active cachée = Bastos
async function open({ path, width = 1366, height = 900, locale = 'fr', shop = null, email = 'ghislainx123@gmail.com' }) {
  process.env.CAPTURE_EMAIL = email
  const s = await session({ width, height, scale: 1, locale })
  await s.page.addInitScript(([id, hidden]) => {
    try {
      if (sessionStorage.getItem('__ctx')) return
      sessionStorage.setItem('__ctx', '1')
      if (id) { localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) }
      else { localStorage.setItem('dashboard_shop_filter', 'all'); localStorage.setItem('active_shop_id', hidden) }
    } catch {}
  }, [shop, BASTOS])
  s.writes = []
  s.errors = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  // Écritures interceptées : relues, jamais transmises ; réponse plausible pour que l'écran poursuive
  await s.page.route(/\/api\//, async route => {
    const r = route.request(), m = r.method(), url = new URL(r.url())
    if (m === 'GET') {
      if (/\/api\/(payments|supplier-payments)\/history/.test(url.pathname)) s.writes.push({ method: m, path: url.pathname, query: Object.fromEntries(url.searchParams) })
      return route.fallback()
    }
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: m, path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    const fake = url.pathname === '/api/products' && m === 'DELETE' ? { ok: true, deleted: (body.ids || []).length }
      : url.pathname === '/api/products' && m === 'PATCH' ? { ok: true, updated: (body.items || body.ids || [1]).length }
      : url.pathname === '/api/payments' ? { ok: true, applied: [] }
      : { ok: true, data: {} }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) })
  })
  await s.page.goto(`${BASE}/${locale}/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const lastWrite = (s, re, method) => [...s.writes].reverse().find(w => re.test(w.path) && (!method || w.method === method))

;(async () => {
  // Références (lecture)
  const prods = (await db.from('products').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).eq('is_active', true)).data
  const names = prods.reduce((m, p) => (m[p.name] = (m[p.name] || 0) + 1, m), {})
  const uniq = sid => prods.filter(p => p.shop_id === sid && names[p.name] === 1)
  const lots = (await db.from('product_batches').select('id, product_id, shop_id').eq('shop_id', AKWA).gt('quantity', 0)).data
  const lotProd = prods.find(p => lots.some(l => l.product_id === p.id) && p.shop_id === AKWA)
  // Sélection par identifiant de carte : un nom partagé entre boutiques ne gêne pas
  const pA = prods.find(p => p.shop_id === AKWA && p.id !== lotProd.id), pB = prods.find(p => p.shop_id === BONA)

  console.log('1. Produits — « Toutes les boutiques », boutique cachée = Bastos')
  let s = await open({ path: 'stock/products' })
  let page = s.page
  await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.waitForTimeout(800)
  ok(await page.getByRole('button', { name: /Supprimer tous les produits/ }).count() === 0, '« Tout supprimer » non proposé en « Toutes les boutiques » (le nombre couvrirait toutes les boutiques)')
  // Date d'un lot d'Akwa depuis la fiche produit
  await page.locator('[data-testid=products-toolbar] input').first().fill(lotProd.name); await page.waitForTimeout(1200)
  await page.locator(`[data-product-card="${lotProd.id}"] button[aria-label^="Ouvrir la fiche"]`).click()
  await page.getByTestId('product-detail-batches').waitFor({ timeout: 20000 })
  await page.getByTestId('product-detail-batches').locator('button[title="Modifier la date de péremption"]').first().click()
  // Fenêtre commune de correction de date (batch-dialogs), reprise par la page Produits depuis la 179
  await page.locator('#batch-expiry-date').fill(day(90))
  // Depuis la 179 (appliquée), toute date modifiée garde sa raison : champ obligatoire quand il est affiché
  if (await page.locator('#batch-expiry-note').count()) await page.locator('#batch-expiry-note').fill('Test fix-context — date corrigée (interceptée)')
  await page.getByRole('dialog').last().getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1500)
  let w = lastWrite(s, /\/api\/product-batches\/expiry/)
  ok(w && w.body.shop_id === AKWA, `date d’un lot d’Akwa → requête vers ${NAME[w?.body.shop_id] || w?.body.shop_id} (boutique du lot, pas la boutique cachée)`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await page.locator('[data-testid=products-toolbar] input').first().fill(''); await page.waitForTimeout(1000)
  // Sélection mêlant Akwa et Bonapriso
  const selectBoth = async () => {
    await page.getByTestId('products-more-actions').click(); await page.getByRole('menuitem', { name: 'Sélectionner' }).click(); await page.waitForTimeout(500)
    for (const p of [pA, pB]) { const c = page.locator(`[data-product-card="${p.id}"]`); await c.scrollIntoViewIfNeeded(); await c.click(); await page.waitForTimeout(250) }
  }
  await selectBoth()
  await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click()
  const del = page.getByRole('dialog').last(); await del.waitFor({ timeout: 8000 })
  const n0 = s.writes.length
  await del.getByRole('button', { name: /Supprimer/ }).last().click(); await page.waitForTimeout(2000)
  const dels = s.writes.slice(n0).filter(x => x.path === '/api/products' && x.method === 'DELETE')
  ok(dels.length === 2 && dels.some(d => d.body.shop_id === AKWA && d.body.ids.join() === pA.id) && dels.some(d => d.body.shop_id === BONA && d.body.ids.join() === pB.id) && !dels.some(d => d.body.shop_id === BASTOS),
    `suppression groupée Akwa + Bonapriso → une requête par boutique (${dels.map(d => NAME[d.body.shop_id]).join(' + ')}), aucune vers Bastos`)
  await selectBoth()
  await page.getByRole('button', { name: 'Promo', exact: true }).click()
  const pd = page.getByRole('dialog').last(); await pd.waitFor({ timeout: 8000 })
  await pd.locator('input[type=number]').fill('10'); await pd.locator('input[type=date]').last().fill(day(10))
  const n1 = s.writes.length
  await pd.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(2000)
  const pr = s.writes.slice(n1).filter(x => x.path === '/api/products' && x.method === 'PATCH')
  ok(pr.length === 2 && pr.every(x => x.body.items.length === 1) && new Set(pr.map(x => x.body.shop_id)).size === 2 && !pr.some(x => x.body.shop_id === BASTOS),
    `promo groupée Akwa + Bonapriso → une requête par boutique (${pr.map(x => NAME[x.body.shop_id]).join(' + ')})`)
  await selectBoth()
  await page.getByRole('button', { name: 'Catégorie', exact: true }).last().click()
  const cd = page.getByRole('dialog').last(); await cd.waitFor({ timeout: 8000 })
  ok(await cd.getByTestId('bulk-category-one-shop').isVisible() && await cd.getByRole('button', { name: 'Enregistrer' }).isDisabled(),
    'catégorie groupée sur deux boutiques → explication, bouton Enregistrer inactif')
  await cd.getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(400)
  // Une seule boutique (Akwa) : catégories d'Akwa, requête vers Akwa
  await page.locator(`[data-product-card="${pB.id}"]`).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Catégorie', exact: true }).last().click()
  const cd2 = page.getByRole('dialog').last(); await cd2.waitFor({ timeout: 8000 })
  const akwaCats = (await db.from('categories').select('name').eq('shop_id', AKWA)).data.map(c => c.name).sort()
  const shown = (await cd2.locator('button').allInnerTexts()).map(x => x.trim()).filter(x => akwaCats.includes(x) || /Sans catégorie|Annuler|Enregistrer|Fermer/.test(x) === false)
  const catBtns = (await cd2.locator('.space-y-1 > button').allInnerTexts()).map(x => x.trim()).filter(x => x && !/Sans catégorie/.test(x)).sort()
  ok(catBtns.join('|') === akwaCats.join('|'), `produit d’Akwa seul : catégories d’Akwa uniquement (${catBtns.length})`)
  await cd2.locator('.space-y-1 > button').nth(1).click()
  const n2 = s.writes.length
  await cd2.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1500)
  w = s.writes.slice(n2).find(x => x.path === '/api/products' && x.method === 'PATCH')
  ok(w && w.body.shop_id === AKWA && w.body.ids.join() === pA.id, `… requête vers ${NAME[w?.body.shop_id]}`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n2. Crédits — débiteur d’Akwa, boutique cachée = Bastos')
  const custs = (await db.from('customers').select('id, name, shop_id').in('shop_id', [AKWA, BONA, BASTOS])).data
  const cn = custs.reduce((m, c) => (m[c.name] = (m[c.name] || 0) + 1, m), {})
  const unpaid = (await db.from('sales').select('customer_id').eq('shop_id', AKWA).gt('balance', 0).neq('sale_status', 'cancelled')).data
  const debtor = custs.find(c => c.shop_id === AKWA && cn[c.name] === 1 && unpaid.some(u => u.customer_id === c.id))
  s = await open({ path: 'payments' }); page = s.page
  const card = page.locator('div.overflow-hidden').filter({ has: page.getByText(debtor.name, { exact: true }) }).filter({ has: page.getByTestId('debtor-repay') }).first()
  await card.scrollIntoViewIfNeeded()
  await card.getByRole('button', { name: /Historique/ }).click(); await page.waitForTimeout(2500)
  w = lastWrite(s, /\/api\/payments\/history/)
  ok(w && w.query.shop_id === AKWA, `historique de « ${debtor.name} » → shop_id ${NAME[w?.query.shop_id] || w?.query.shop_id}`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  await card.getByTestId('debtor-repay').click()
  const rd = page.getByRole('dialog').last(); await rd.waitFor({ timeout: 8000 })
  const methods = (await rd.locator('.grid button').allInnerTexts()).map(x => x.trim()).filter(Boolean)
  const n3 = s.writes.length
  await rd.getByRole('button', { name: /Confirmer/ }).click(); await page.waitForTimeout(2500)
  w = s.writes.slice(n3).find(x => x.path === '/api/payments' && x.method === 'POST')
  ok(w && w.body.shop_id === AKWA, `remboursement → shop_id ${NAME[w?.body.shop_id] || w?.body.shop_id} (boutique du client), modes proposés : ${methods.slice(0, 4).join(', ')}`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  // Report d'échéance et passage en perte : facture dépliée
  await card.locator('button').filter({ has: page.locator('svg.lucide-chevron-down, svg.lucide-chevron-up') }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  const postpone = card.getByRole('button', { name: /Reporter/ }).first()
  if (await postpone.count()) {
    await postpone.click()
    const ppd = page.getByRole('dialog').last(); await ppd.waitFor({ timeout: 8000 })
    await ppd.locator('input[type=date]').fill(day(20))
    const n4 = s.writes.length
    await ppd.getByRole('button', { name: /Enregistrer/ }).click(); await page.waitForTimeout(1500)
    w = s.writes.slice(n4).find(x => /postpone-due-date/.test(x.path))
    ok(w && w.body.shop_id === AKWA, `report d’échéance → shop_id ${NAME[w?.body.shop_id] || w?.body.shop_id}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  } else info('aucune facture dépliable : report non testé')
  const wo = card.getByRole('button', { name: /Passer en perte/ }).first()
  if (await wo.count()) {
    await wo.click()
    const wod = page.getByRole('dialog').last(); await wod.waitFor({ timeout: 8000 })
    await wod.locator('input').last().fill('Test interception')
    const n5 = s.writes.length
    await wod.getByRole('button').last().click(); await page.waitForTimeout(1500)
    w = s.writes.slice(n5).find(x => /write-off/.test(x.path))
    ok(w && w.body.shop_id === AKWA, `passage en perte → shop_id ${NAME[w?.body.shop_id] || w?.body.shop_id}`)
  } else info('passage en perte non proposé : non testé')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n3. Fournisseurs et Dépenses — boutique cachée = Bastos')
  s = await open({ path: 'suppliers' }); page = s.page
  const sup = (await db.from('suppliers').select('id, name, shop_id').eq('shop_id', AKWA).is('deleted_at', null)).data
  const supNames = (await db.from('suppliers').select('name').in('shop_id', [AKWA, BONA, BASTOS]).is('deleted_at', null)).data.map(x => x.name)
  const supA = sup.find(x => supNames.filter(n => n === x.name).length === 1)
  const sc = page.getByTestId('supplier-card').filter({ hasText: supA.name }).first()
  await sc.scrollIntoViewIfNeeded(); await sc.getByRole('button', { name: 'Modifier', exact: true }).click()
  await page.getByTestId('supplier-dialog').waitFor({ timeout: 10000 })
  const n6 = s.writes.length
  await page.locator('button[type=submit][form="supplier-form"], [data-testid=supplier-dialog] button[type=submit]').first().click(); await page.waitForTimeout(1500)
  w = s.writes.slice(n6).find(x => x.path === '/api/suppliers')
  ok(w && w.method === 'PATCH' && w.body.shop_id === AKWA, `modification de « ${supA.name} » (Akwa) → shop_id ${NAME[w?.body.shop_id] || w?.body.shop_id}`)
  await s.browser.close()

  s = await open({ path: 'expenses' }); page = s.page
  const delBtns = page.getByRole('button', { name: 'Supprimer' })
  const nb = await delBtns.count()
  let checked = 0, good = 0
  for (let i = 0; i < Math.min(nb, 6) && checked < 3; i++) {
    const n7 = s.writes.length
    await delBtns.nth(i).scrollIntoViewIfNeeded(); await delBtns.nth(i).click()
    const cm = page.getByRole('dialog').last(); if (!(await cm.waitFor({ timeout: 4000 }).then(() => true).catch(() => false))) continue
    await cm.getByRole('button', { name: /Supprimer/ }).last().click(); await page.waitForTimeout(1500)
    w = s.writes.slice(n7).find(x => x.path === '/api/expenses/delete')
    if (!w) continue
    const real = (await db.from('expenses').select('shop_id').eq('id', w.body.expense_id).maybeSingle()).data
    checked++; if (real && real.shop_id === w.body.shop_id) good++
    info(`dépense ${w.body.expense_id.slice(0, 8)} : boutique réelle ${NAME[real?.shop_id]}, requête ${NAME[w.body.shop_id]}`)
  }
  ok(checked > 0 && good === checked, `suppression de dépenses → boutique de chaque dépense (${good}/${checked})`)
  await s.browser.close()

  console.log('\n4. En-tête du téléphone — contexte en texte, toujours visible')
  for (const [shop, width, locale, expected] of [[AKWA, 390, 'fr', 'Akwa'], [null, 390, 'fr', 'Toutes'], [BONA, 360, 'fr', 'Bonapriso'], [null, 390, 'en', 'All shops'], [AKWA, 390, 'ha', 'Akwa'], [null, 390, 'ha', 'Duk shaguna']]) {
    s = await open({ path: 'stock/products', width, height: 844, locale, shop }); page = s.page
    const h = page.getByTestId('header-shop-context')
    const txt = (await h.innerText()).trim()
    const title = await h.getAttribute('title')
    await page.evaluate(() => window.scrollTo(0, 2500)); await page.waitForTimeout(600)
    const box = await h.boundingBox()
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const fullOk = shop ? title === (shop === AKWA ? 'Marché Soleil Akwa' : 'Marché Soleil Bonapriso') : true
    ok(txt === expected && fullOk && box && box.y >= 0 && box.y < 60 && box.height >= 44 && ov <= 0,
      `${locale} ${width} px, ${shop ? NAME[shop] : 'Toutes'} : « ${txt} ▾ »${shop ? ` (nom complet « ${title} »)` : ''}, visible après défilement (y ${Math.round(box?.y)}), ${Math.round(box?.height)} px, sans débordement`)
    await s.browser.close()
  }
  s = await open({ path: 'stock/products', width: 1366, height: 900 }); page = s.page
  ok(!(await page.getByTestId('header-shop-context').isVisible()), 'ordinateur : pas de doublon dans l’en-tête (sélecteur dans la barre latérale)')
  await s.browser.close()
  // Compte à une seule boutique : rien à choisir, aucun sélecteur
  s = await open({ path: 'dashboard', width: 390, height: 844, email: 'stocshopci@gmail.com', shop: 'a0000000-0000-0000-0000-000000000001' }); page = s.page
  ok(await page.getByTestId('header-shop-context').count() === 0, 'compte à une seule boutique : aucun sélecteur ni indicateur dans l’en-tête')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
