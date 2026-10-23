// Stock › Produits — filtres à choix multiple (Catégorie, Statut, Fournisseur). LECTURE SEULE :
// compte vitrine Marché Soleil (3 boutiques : Akwa, Bastos, Bonapriso), filtres = navigateur uniquement,
// toute écriture reste bloquée par capture.js. Valeurs attendues lues en base (clé de service, lecture).
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
const { filterScopeKey } = jiti(ROOT + '/lib/filters/multi-select.ts')
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

// shop = null → « Toutes les boutiques »
async function open({ width = 1366, height = 900, locale = 'fr', shop = null } = {}) {
  const s = await session({ width, height, scale: 1, locale })
  await s.page.addInitScript(([id, first]) => {
    try {
      if (sessionStorage.getItem('__ctx_set')) return // seulement au premier chargement : ensuite c'est le test qui change de contexte
      sessionStorage.setItem('__ctx_set', '1')
      if (id) { localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) }
      else { localStorage.setItem('dashboard_shop_filter', 'all'); localStorage.setItem('active_shop_id', first) }
    } catch {}
  }, [shop, AKWA])
  s.errors = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('[data-testid=products-toolbar]').waitFor({ timeout: 45000 })
  await waitCount(s.page)
  return s
}
// Contexte de l'en-tête changé comme le fait le sélecteur (localStorage), puis rechargement : sessionStorage
// (mémoire des filtres) est conservé dans l'onglet
async function switchContext(page, shop) {
  await page.evaluate(([id, first]) => {
    if (id) { localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) }
    else { localStorage.setItem('dashboard_shop_filter', 'all'); localStorage.setItem('active_shop_id', first) }
  }, [shop, AKWA])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid=products-toolbar]').waitFor({ timeout: 45000 })
  await waitCount(page)
}
async function waitCount(page) {
  // Boucle de lecture (la politique de sécurité de la page interdit waitForFunction)
  for (let i = 0; i < 120; i++) {
    const t = await page.getByTestId('products-count').innerText().catch(() => '')
    if (/\d|Aucun|No product|Babu/.test(t) && !t.includes('…')) break
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(1500)
}
const count = async page => { await page.waitForTimeout(500); const t = await page.getByTestId('products-count').innerText(); const m = t.match(/\d+/); return m ? Number(m[0]) : 0 }
const trig = (page, id) => page.getByTestId(id)
const trigText = async (page, id) => (await trig(page, id).innerText()).replace(/\s+/g, ' ').trim()
async function openPop(page, id) {
  await trig(page, id).click()
  await page.getByTestId(`${id}-popover`).waitFor({ timeout: 10000 })
  return page.getByTestId(`${id}-popover`)
}
const closePop = async page => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
const optionsIn = async loc => loc.locator('[data-filter-option]').evaluateAll(els => els.map(e => ({ value: e.getAttribute('data-filter-option'), label: e.textContent.trim(), selected: e.getAttribute('aria-selected') === 'true' })))
let AKWA, BASTOS, BONAPRISO

;(async () => {
  // Données de référence (lecture)
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users
  const ms = users.find(u => u.email === 'ghislainx123@gmail.com')
  const mem = (await db.from('shop_members').select('shop_id, shops(name)').eq('user_id', ms.id)).data
  const byName = n => mem.find(m => m.shops.name.includes(n)).shop_id
  AKWA = byName('Akwa'); BASTOS = byName('Bastos'); BONAPRISO = byName('Bonapriso')
  const shopIds = mem.map(m => m.shop_id)
  const cats = (await db.from('categories').select('id, name, shop_id').in('shop_id', shopIds)).data
  const prods = (await db.from('products').select('id, name, shop_id, category_id, supplier_id').in('shop_id', shopIds).eq('is_active', true)).data
  const alim = Object.fromEntries([AKWA, BASTOS, BONAPRISO].map(s => [s, cats.find(c => c.shop_id === s && c.name === 'Alimentation')]))
  const nCat = id => prods.filter(p => p.category_id === id).length
  const sups = (await db.from('suppliers').select('id, name, shop_id').in('shop_id', shopIds).is('deleted_at', null)).data
  const ferme = sups.filter(x => x.name === 'Ferme des Hauts Plateaux')
  const nSup = id => prods.filter(p => p.supplier_id === id).length
  console.log(`Marché Soleil : ${prods.length} produits actifs ; Alimentation Akwa ${nCat(alim[AKWA].id)}, Bastos ${nCat(alim[BASTOS].id)}, Bonapriso ${nCat(alim[BONAPRISO].id)}`)

  console.log('\nOrdinateur · « Toutes les boutiques »')
  let s = await open(); let page = s.page
  const total = await count(page)
  ok(total === prods.length, `toutes les boutiques : ${total} produits`)
  ok(await trigText(page, 'filter-category') === 'Catégorie' && await trigText(page, 'filter-status') === 'Statut', 'déclencheurs au repos : « Catégorie », « Statut »')
  let pop = await openPop(page, 'filter-category')
  const groups = await pop.locator('[data-filter-group]').allInnerTexts()
  const opts = await optionsIn(pop)
  ok(groups.map(x => x.trim().toLowerCase()).join('|') === 'marché soleil akwa|marché soleil bastos|marché soleil bonapriso', `groupes visuels par boutique : ${groups.join(' / ')}`)
  const alimOpts = opts.filter(o => o.label === 'Alimentation')
  ok(alimOpts.length === 3 && new Set(alimOpts.map(o => o.value)).size === 3 && alimOpts.every(o => [alim[AKWA].id, alim[BASTOS].id, alim[BONAPRISO].id].includes(o.value)),
    '« Alimentation » ×3 : trois options, chacune avec le vrai identifiant de sa boutique (aucune fusion)')
  ok(await pop.locator('input[type=search]').count() === 1, `liste longue (${opts.length} options) : recherche présente`)
  await pop.locator(`[data-filter-option="${alim[AKWA].id}"]`).click()
  let n = await count(page)
  ok(n === nCat(alim[AKWA].id), `Akwa › Alimentation seule : ${n} produits (attendu ${nCat(alim[AKWA].id)}) — PAS ceux de Bastos`)
  ok(await trigText(page, 'filter-category') === 'Alimentation', 'libellé : « Alimentation »')
  await pop.locator(`[data-filter-option="${alim[BASTOS].id}"]`).click()
  n = await count(page)
  ok(n === nCat(alim[AKWA].id) + nCat(alim[BASTOS].id), `Akwa › Alimentation + Bastos › Alimentation : ${n} (attendu ${nCat(alim[AKWA].id) + nCat(alim[BASTOS].id)})`)
  ok(await trigText(page, 'filter-category') === 'Catégorie · 2', 'libellé : « Catégorie · 2 »')
  ok(await pop.locator('[data-filter-all]').getAttribute('aria-selected') === 'false', '« Toutes » n’est plus coché dès qu’une valeur l’est')
  await closePop(page)

  // Statuts : OU (niveaux exclusifs entre eux → somme), ordre métier, Archivé exclusif
  pop = await openPop(page, 'filter-category'); await pop.locator('[data-filter-all]').click(); await closePop(page)
  ok(await count(page) === total && await trigText(page, 'filter-category') === 'Catégorie', '« Toutes » vide la sélection')
  pop = await openPop(page, 'filter-status')
  const stLabels = (await optionsIn(pop)).map(o => o.label)
  ok(stLabels.join('|').startsWith('En stock|Stock faible|Rupture de stock') && /Archivé/.test(stLabels[stLabels.length - 1]), `ordre métier : ${stLabels.join(', ')}`)
  ok(await pop.locator('input[type=search]').count() === 0, 'statuts : pas de recherche (liste courte)')
  await pop.locator('[data-filter-option="low"]').click(); const nLow = await count(page)
  await pop.locator('[data-filter-option="low"]').click(); await pop.locator('[data-filter-option="out"]').click(); const nOut = await count(page)
  await pop.locator('[data-filter-option="low"]').click(); const nBoth = await count(page)
  ok(nBoth === nLow + nOut && nBoth > 0, `Stock faible OU Rupture : ${nBoth} = ${nLow} + ${nOut}`)
  ok(await trigText(page, 'filter-status') === 'Statut · 2', 'libellé : « Statut · 2 »')
  await pop.locator('[data-filter-option="archived"]').click()
  ok(await trig(page, 'filter-status').getAttribute('data-selected-count') === '1' && /^Archivés?$/.test(await trigText(page, 'filter-status')), 'Archivé coché : les autres statuts sont décochés (liste à part)')
  await pop.locator('[data-filter-option="low"]').click()
  ok(await trigText(page, 'filter-status') === 'Stock faible', 'un autre statut coché : Archivé décoché')
  await pop.locator('[data-filter-option="out"]').click()
  await closePop(page)
  // ET entre filtres
  pop = await openPop(page, 'filter-category')
  await pop.locator(`[data-filter-option="${alim[AKWA].id}"]`).click(); await pop.locator(`[data-filter-option="${alim[BASTOS].id}"]`).click(); await closePop(page)
  const nAnd = await count(page)
  ok(nAnd <= Math.min(nBoth, nCat(alim[AKWA].id) + nCat(alim[BASTOS].id)), `(Alimentation Akwa OU Bastos) ET (faible OU rupture) : ${nAnd}`)

  // Fournisseur (Plus de filtres) : groupé, deux homonymes = deux options
  await page.getByTestId('products-more-filters').click()
  const sl = page.getByTestId('filter-supplier'); await sl.waitFor({ timeout: 10000 })
  const sOpts = await optionsIn(sl)
  const fermeOpts = sOpts.filter(o => o.label === 'Ferme des Hauts Plateaux')
  ok(fermeOpts.length === ferme.length && ferme.length >= 2, `fournisseur « Ferme des Hauts Plateaux » : ${fermeOpts.length} options (une par boutique)`)
  await closePop(page)
  pop = await openPop(page, 'filter-category'); await pop.locator('[data-filter-all]').click(); await closePop(page)
  pop = await openPop(page, 'filter-status'); await pop.locator('[data-filter-all]').click(); await closePop(page)
  await page.getByTestId('products-more-filters').click()
  await sl.locator(`[data-filter-option="${ferme[0].id}"]`).click(); const nF0 = await count(page)
  await sl.locator(`[data-filter-option="${ferme[1].id}"]`).click(); const nF01 = await count(page)
  ok(nF0 === nSup(ferme[0].id) && nF01 === nSup(ferme[0].id) + nSup(ferme[1].id), `un fournisseur : ${nF0} ; les deux homonymes : ${nF01} (attendu ${nSup(ferme[0].id)} + ${nSup(ferme[1].id)})`)
  ok(/Plus de filtres\s*1/.test(await page.getByTestId('products-more-filters').innerText()), 'badge « Plus de filtres » : 1')
  await closePop(page)

  // Clavier
  await page.getByRole('button', { name: /^Réinitialiser$/ }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await trig(page, 'filter-status').focus(); await page.keyboard.press('Enter')
  pop = page.getByTestId('filter-status-popover'); await pop.waitFor({ timeout: 5000 })
  await pop.locator('[data-filter-all]').focus()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press(' ')
  ok(await trig(page, 'filter-status').getAttribute('data-selected-count') === '1' && await trigText(page, 'filter-status') === 'Stock faible', 'clavier : flèches + Espace cochent « Stock faible »')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  ok(await pop.count() === 0 || !(await pop.isVisible()), 'clavier : Échap ferme la fenêtre')
  const allCatOpts = opts.length

  // Mémoire par contexte réel
  console.log('\nMémoire par contexte')
  pop = await openPop(page, 'filter-category'); await pop.locator(`[data-filter-option="${alim[AKWA].id}"]`).click(); await pop.locator(`[data-filter-option="${alim[BASTOS].id}"]`).click(); await closePop(page)
  const allState = { cat: await trigText(page, 'filter-category'), st: await trigText(page, 'filter-status'), n: await count(page) }
  await switchContext(page, AKWA)
  ok(await trigText(page, 'filter-category') === 'Catégorie' && await trigText(page, 'filter-status') === 'Statut', 'Toutes → Akwa : aucun filtre repris (l’identifiant Akwa n’est pas réinterprété)')
  pop = await openPop(page, 'filter-category')
  ok(await pop.locator('[data-filter-group]').count() === 0 && (await optionsIn(pop)).length < allCatOpts, 'une seule boutique : liste simple, sans titre de boutique')
  const boissons = cats.find(c => c.shop_id === AKWA && c.name === 'Boissons')
  await pop.locator(`[data-filter-option="${boissons.id}"]`).click(); await closePop(page)
  ok(await count(page) === nCat(boissons.id), `Akwa : Boissons → ${await count(page)} produits`)
  await switchContext(page, BASTOS)
  ok(await trigText(page, 'filter-category') === 'Catégorie', 'Akwa → Bastos : le filtre d’Akwa n’apparaît pas')
  await switchContext(page, null)
  ok(await trigText(page, 'filter-category') === allState.cat && await trigText(page, 'filter-status') === allState.st && await count(page) === allState.n, `retour à « Toutes » : état restauré (${allState.cat}, ${allState.st}, ${allState.n})`)
  await switchContext(page, AKWA)
  ok(await trigText(page, 'filter-category') === 'Boissons', 'retour à Akwa : « Boissons » restauré')
  // Ancien format mémorisé (valeur unique) : ignoré sans erreur
  const scope = filterScopeKey(BASTOS, shopIds)
  await page.evaluate(([k]) => sessionStorage.setItem(k, JSON.stringify({ filters: { categoryFilter: 'x', statusFilter: 'low' }, date: new Date().toISOString().slice(0, 10) })), [`filters_session_stock_${scope}`])
  await switchContext(page, BASTOS)
  ok(await trigText(page, 'filter-category') === 'Catégorie' && await trigText(page, 'filter-status') === 'Statut', 'ancienne mémoire (une seule valeur) : ignorée, aucun filtre fantôme')
  // Lien profond ?status=low
  await page.goto(`${BASE}/fr/stock/products?status=low`, { waitUntil: 'domcontentloaded' }); await waitCount(page)
  ok(await trigText(page, 'filter-status') === 'Stock faible', 'lien ?status=low : « Stock faible » coché')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\nTéléphone (390 px) · « Toutes les boutiques »')
  s = await open({ width: 390, height: 844 }); page = s.page
  const t0 = await count(page)
  await trig(page, 'filter-category').click()
  const sheet = page.getByTestId('filter-category-sheet'); await sheet.waitFor({ timeout: 10000 })
  ok(await sheet.locator('[data-filter-group]').count() === 3, 'panneau du bas, groupes par boutique')
  const h = await sheet.locator('[data-filter-option]').first().evaluate(e => e.getBoundingClientRect().height)
  ok(h >= 48, `lignes de ${Math.round(h)} px`)
  await sheet.locator(`[data-filter-option="${alim[AKWA].id}"]`).click(); await sheet.locator(`[data-filter-option="${alim[BONAPRISO].id}"]`).click()
  ok(await count(page) === t0, 'cocher ne recalcule pas la liste derrière (brouillon)')
  await sheet.locator('[data-filter-reset]').click()
  ok((await optionsIn(sheet)).every(o => !o.selected), 'Réinitialiser vide le brouillon')
  await sheet.locator(`[data-filter-option="${alim[AKWA].id}"]`).click(); await sheet.locator(`[data-filter-option="${alim[BONAPRISO].id}"]`).click()
  await sheet.locator('[data-filter-apply]').click(); await page.waitForTimeout(600)
  ok(await count(page) === nCat(alim[AKWA].id) + nCat(alim[BONAPRISO].id) && await trigText(page, 'filter-category') === 'Catégorie · 2', `Appliquer : ${await count(page)} produits, « Catégorie · 2 »`)
  await trig(page, 'filter-category').click(); await sheet.waitFor()
  await sheet.locator(`[data-filter-option="${alim[AKWA].id}"]`).click()
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  ok(await trigText(page, 'filter-category') === 'Catégorie · 2', 'fermer sans Appliquer : rien ne change')
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok(ov <= 0, `pas de défilement horizontal (${ov})`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\nVérifications finales (ordinateur · « Toutes les boutiques »)')
  const fold = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const AC = [alim[AKWA].id, alim[BASTOS].id]
  s = await open(); page = s.page
  await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.waitForTimeout(800)
  pop = await openPop(page, 'filter-category'); for (const id of AC) await pop.locator(`[data-filter-option="${id}"]`).click(); await closePop(page)
  // Recherche + filtres
  const term = prods.find(p => p.category_id === AC[0]).name.split(/\s+/)[0]
  await page.locator('[data-testid=products-toolbar] input').first().fill(term); await page.waitForTimeout(800)
  const expSearch = prods.filter(p => AC.includes(p.category_id) && fold(p.name).includes(fold(term))).length
  const nSearch = await count(page)
  ok(nSearch === expSearch && nSearch > 0, `recherche « ${term} » + Alimentation Akwa OU Bastos : ${nSearch} (attendu ${expSearch})`)
  await page.locator('[data-testid=products-toolbar] input').first().fill(''); await page.waitForTimeout(800)
  // Fournisseur ET catégorie
  const supInAC = [...new Set(prods.filter(p => AC.includes(p.category_id) && p.supplier_id).map(p => p.supplier_id))][0]
  await page.getByTestId('products-more-filters').click()
  await page.getByTestId('filter-supplier').locator(`[data-filter-option="${supInAC}"]`).click()
  const expSupCat = prods.filter(p => AC.includes(p.category_id) && p.supplier_id === supInAC).length
  ok(await count(page) === expSupCat, `fournisseur ET catégorie : ${await count(page)} (attendu ${expSupCat})`)
  await page.getByTestId('more-filters-reset').click(); await page.waitForTimeout(400)
  ok(await count(page) === nCat(AC[0]) + nCat(AC[1]) && !/Plus de filtres\s*\d/.test(await page.getByTestId('products-more-filters').innerText()), '« Réinitialiser » de « Plus de filtres » : fournisseurs vidés, catégories conservées')
  await closePop(page)
  // Fournisseur ET statut (somme impossible à prévoir en base : borne)
  pop = await openPop(page, 'filter-status'); await pop.locator('[data-filter-option="ok"]').click(); await closePop(page)
  const nOkCat = await count(page)
  await page.getByTestId('products-more-filters').click()
  await page.getByTestId('filter-supplier').locator(`[data-filter-option="${supInAC}"]`).click()
  const nOkCatSup = await count(page)
  ok(nOkCatSup <= Math.min(nOkCat, expSupCat), `fournisseur ET statut ET catégorie : ${nOkCatSup} ≤ ${Math.min(nOkCat, expSupCat)}`)
  await page.getByTestId('more-filters-reset').click(); await closePop(page)
  const before = { n: await count(page), cat: await trigText(page, 'filter-category'), st: await trigText(page, 'filter-status') }
  // Fiche produit ouverte puis fermée : filtres et liste intacts
  await page.locator('[data-product-card] button[aria-label^="Ouvrir la fiche"]').first().click()
  const detail = page.getByTestId('product-detail')
  const opened = await detail.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  ok(opened && !(await detail.isVisible().catch(() => false)) && await count(page) === before.n && await trigText(page, 'filter-category') === before.cat && await trigText(page, 'filter-status') === before.st,
    `fiche produit ouverte puis fermée (Échap) : filtres et liste intacts (${before.cat}, ${before.st}, ${before.n})`)
  // Cartes ↔ liste
  await page.locator('[role="group"] button[aria-pressed]').nth(1).click(); await page.locator('table').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(600)
  ok(await count(page) === before.n && await trigText(page, 'filter-category') === before.cat, `liste (tableau) : mêmes filtres, ${await count(page)} produits`)
  await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.locator('[data-product-card]').first().waitFor({ timeout: 15000 })
  ok(await count(page) === before.n, 'retour aux cartes : identique')
  // Réinitialiser (lien de la page) : tout revient
  await page.locator('[data-testid=products-toolbar] input').first().fill(term); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /^Réinitialiser$/ }).first().click(); await page.waitForTimeout(800)
  ok(await count(page) === total && await trigText(page, 'filter-category') === 'Catégorie' && await trigText(page, 'filter-status') === 'Statut' && (await page.locator('[data-testid=products-toolbar] input').first().inputValue()) === '',
    `« Réinitialiser » : recherche, catégories, statuts vidés (${total} produits)`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\nLargeurs')
  for (const [w, h, name] of [[360, 740, 'petit téléphone'], [820, 1180, 'tablette'], [1440, 900, 'ordinateur']]) {
    s = await open({ width: w, height: h }); page = s.page
    const th = await trig(page, 'filter-category').evaluate(e => Math.round(e.getBoundingClientRect().height))
    await trig(page, 'filter-category').click()
    const phone = w < 640
    const box = page.getByTestId(phone ? 'filter-category-sheet' : 'filter-category-popover'); await box.waitFor({ timeout: 10000 })
    await box.locator(`[data-filter-option="${alim[BONAPRISO].id}"]`).click()
    if (phone) await box.locator('[data-filter-apply]').click(); else await closePop(page)
    await page.waitForTimeout(600)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(await count(page) === nCat(alim[BONAPRISO].id) && th >= 44 && ov <= 0, `${name} ${w} px : ${phone ? 'panneau du bas' : 'fenêtre'}, Bonapriso › Alimentation → ${await count(page)}, déclencheur ${th} px, pas de défilement horizontal`)
    await s.browser.close()
  }

  console.log('\nLangues')
  for (const [locale, w, catL, stL, low] of [['en', 1366, 'Category', 'Status', 'Low stock'], ['ha', 390, null, null, null]]) {
    s = await open({ width: w, height: 900, locale }); page = s.page
    const msgs = require(ROOT + `/messages/${locale}.json`)
    const cl = catL || msgs.products.category, sl2 = stL || msgs.products.status_label
    const c1 = await trigText(page, 'filter-category'), s1 = await trigText(page, 'filter-status')
    if (w > 640) {
      pop = await openPop(page, 'filter-status')
      await pop.locator('[data-filter-option="low"]').click(); await pop.locator('[data-filter-option="out"]').click(); await closePop(page)
    } else {
      await trig(page, 'filter-status').click(); const sh = page.getByTestId('filter-status-sheet'); await sh.waitFor()
      await sh.locator('[data-filter-option="low"]').click(); await sh.locator('[data-filter-option="out"]').click()
      ok((await sh.locator('[data-filter-apply]').innerText()).trim() === msgs.filters.apply && (await sh.locator('[data-filter-reset]').innerText()).trim() === msgs.filters.reset, `${locale} : « ${msgs.filters.reset} » / « ${msgs.filters.apply} »`)
      await sh.locator('[data-filter-apply]').click(); await page.waitForTimeout(500)
    }
    const s2 = await trigText(page, 'filter-status')
    ok(c1 === cl && s1 === sl2 && s2 === `${sl2} · 2`, `${locale} ${w} px : « ${c1} », « ${s1} », puis « ${s2} »`)
    await s.browser.close()
  }

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
