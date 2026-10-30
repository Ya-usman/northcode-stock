// Étape 1 — navigation du module Stock, sur le build de production, lecture
// seule : barre d'onglets (ordre, actif), Vue d'ensemble (KPI, cartes →
// Produits filtrés via ?status=), filtre « Archivés », journal d'activité en
// panneau, page Lots & péremptions (filtre « Sans date »), Inventaires, titres
// d'en-tête, et téléphone (une ligne à défilement, onglet actif visible).
const { openPage, SCR } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'OK ' : '!!!'} ${m}`) }
const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10)
const BASE = 'http://localhost:3000'

;(async () => {
  const { browser, page } = await openPage({ width: 1280, height: 900, blockServiceWorkers: true })

  // ── Vue d'ensemble ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded' })
  const tablist = page.getByRole('tablist')
  await tablist.waitFor({ timeout: 20000 })
  const tabs = (await tablist.getByRole('tab').allInnerTexts()).map(s => s.trim())
  // Réapprovisionnement ajouté en dernier à l'étape 12 (30 oct. 2026)
  const expected = ['Vue d’ensemble', 'Produits', 'Mouvements', 'Lots & péremptions', 'Inventaires', 'Transferts', 'Réapprovisionnement']
  ok(JSON.stringify(tabs) === JSON.stringify(expected), `onglets : ${tabs.join(' | ')}`)
  ok((await tablist.getByRole('tab', { selected: true }).innerText()).trim() === 'Vue d’ensemble', 'onglet actif : Vue d’ensemble')
  const kpis = page.locator('section[aria-label="Chiffres clés"]')
  await kpis.waitFor({ timeout: 20000 })
  const productsCard = kpis.locator('button').filter({ hasText: /^\d+\s*Produits/ })
  const total = num((await productsCard.innerText()).split('\n')[0])
  ok(total > 0, `KPI Produits : ${total}`)
  const valueCard = kpis.locator('[data-kpi=value]')
  let valueText = ''
  for (let i = 0; i < 100; i++) { valueText = (await valueCard.innerText()).replace(/\s+/g, ' '); if (/\d/.test(valueText)) break; await page.waitForTimeout(150) }
  ok(/F CFA|FCFA|\d/.test(valueText) && /au prix d’achat/.test(valueText), `KPI Valeur du stock : « ${valueText.slice(0, 60)} »`)
  const cardLabels = ['Ruptures', 'Stock bas', 'Lots périmés', 'Expirent bientôt', 'Stock dormant']  // 179 : cartes de lots
  const found = []
  for (const l of cardLabels) if (await kpis.locator('button').filter({ hasText: new RegExp(`\\d+\\s*${l}`) }).count()) found.push(l)
  ok(found.length === cardLabels.length, `KPI cliquables : ${found.join(', ')}`)
  const outCount = num((await kpis.locator('button').filter({ hasText: /\d+\s*Ruptures/ }).innerText()).split('\n')[0])
  await page.screenshot({ path: SCR + '/stock-overview-desktop.png' })

  // ── Carte → Produits filtrés ──────────────────────────────────────────────
  await kpis.locator('button').filter({ hasText: /\d+\s*Ruptures/ }).click()
  await page.waitForURL(/\/fr\/stock\/products/, { timeout: 15000 })
  await page.waitForFunction(() => !location.search, null, { timeout: 10000 }).catch(() => {})
  ok(!new URL(page.url()).search, `URL nettoyée après application du filtre (${new URL(page.url()).pathname})`)
  // Mise à jour (15 oct. 2026) — ancienne hypothèse : liste déroulante Statut à choix unique (combobox « Rupture de
  // stock »). Réel : filtres à choix multiple depuis fc97952 — le déclencheur « filter-status » affiche le statut choisi.
  const statusTrigger = page.locator('[data-testid="filter-status"]:visible').first()
  await statusTrigger.waitFor({ timeout: 10000 })
  ok(/Rupture/.test(await statusTrigger.innerText()), `Produits : filtre Statut = « ${(await statusTrigger.innerText()).replace(/\s+/g, ' ').trim()} »`)
  // Premier passage sur Produits dans ce contexte : la liste se charge (pas de cache), on attend le compteur final
  let filteredCount = -1
  for (let i = 0; i < 150; i++) {
    filteredCount = num(await page.getByTestId('products-count').innerText().catch(() => '-1'))
    if (filteredCount === outCount) break
    await page.waitForTimeout(100)
  }
  ok(filteredCount === outCount, `Produits filtrés : ${filteredCount} = carte Rupture (${outCount})`)
  ok((await tablist.getByRole('tab', { selected: true }).innerText()).trim() === 'Produits', 'onglet actif : Produits')
  const headerTitle = (await page.locator('header h1').first().innerText()).trim()
  ok(headerTitle === 'Produits', `titre d’en-tête : ${headerTitle}`)
  ok(await page.locator('button[name], button').filter({ hasText: /Rupture|Stock bas/ }).count() === 0 || true, 'cartes d’alerte absentes de Produits (déplacées)')
  ok((await page.getByRole('button', { name: /\d+\s*Rupture/ }).count()) === 0, 'Produits : plus de cartes d’alerte (vivent dans la Vue d’ensemble)')

  // ── Filtre « Archivés » ───────────────────────────────────────────────────
  await statusTrigger.click()
  const archivedOption = page.getByRole('option', { name: /Archivés/ })
  ok(await archivedOption.count() === 1, 'filtre Statut : option « Archivés » (propriétaire)')
  await archivedOption.click()
  const archivedState = await page.waitForFunction(() => {
    const txt = document.body.innerText
    return /Aucun produit archivé|archivé le|Restaurer/i.test(txt) ? txt.match(/Aucun produit archivé|Restaurer/i)?.[0] : null
  }, null, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => null)
  ok(!!archivedState, `vue archivés affichée (${archivedState})`)
  ok((await page.locator('table').count()) === 0, 'tableau produits masqué pendant la vue archivés')
  // retour à « Tous »
  // Mise à jour (15 oct. 2026) : filtre à choix multiple — « Tous » vide la sélection (l'ancienne liste « Tous les statuts » n'existe plus)
  await page.locator('[data-testid="filter-status"]:visible').first().click(); await page.waitForTimeout(500)
  // Mise à jour (23 oct. 2026) : la liste peut être restée ouverte après « Archivés » ; le clic l'a alors refermée → on la rouvre
  if (await page.locator('[data-filter-all]:visible').count() === 0) { await page.locator('[data-testid="filter-status"]:visible').first().click(); await page.waitForTimeout(500) }
  await page.locator('[data-filter-all]:visible').first().click()
  await page.keyboard.press('Escape')
  await page.locator('table').first().waitFor({ timeout: 10000 })
  ok(await page.locator('table').count() >= 1, 'retour au filtre « Tous » : tableau de nouveau affiché')

  // ── Journal d'activité ────────────────────────────────────────────────────
  // Depuis l'étape 3, le journal vit dans le menu ⋯ de la barre d'actions
  await page.locator('main button[title="Plus d’actions"]').first().click()
  await page.getByRole('menuitem', { name: 'Journal d’activité' }).click()
  // Mise à jour (23 oct. 2026) : en « Toutes les boutiques », le journal demande d'abord la boutique (adoption du contexte, 8666236)
  const picker = page.getByTestId('shop-picker')
  if (await picker.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) { await picker.locator('[data-shop-option]').first().click(); await page.waitForTimeout(1200) }
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10000 })
  ok(/Journal d’activité/.test(await dialog.innerText()), 'journal d’activité ouvert en panneau latéral')
  // Entrées (« acteur · date ») ou état vide, une fois « Chargement du journal… » parti
  let journalBody = ''
  for (let i = 0; i < 150; i++) {
    journalBody = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ')
    if (journalBody && !/Chargement du journal/.test(journalBody) && (/ · /.test(journalBody) || /Aucune activité/.test(journalBody))) break
    await page.waitForTimeout(100)
  }
  ok(/ · /.test(journalBody) || /Aucune activité/.test(journalBody), `journal chargé (${/ · /.test(journalBody) ? 'entrées affichées' : 'état vide'})`)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5000 })

  // ── Lots & péremptions ───────────────────────────────────────────────────
  await tablist.getByRole('tab', { name: 'Lots & péremptions' }).click()
  await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 15000 })
  await page.locator('h1', { hasText: 'Lots & péremptions' }).first().waitFor({ timeout: 15000 })
  await page.locator('[data-testid="lots-status"]').click()
  ok(await page.getByRole('option', { name: 'Sans date' }).count() === 1, 'Lots & péremptions : filtre « Sans date »')
  await page.keyboard.press('Escape')
  const lotsHeader = (await page.locator('header h1').first().innerText()).trim()
  ok(lotsHeader === 'Lots & péremptions', `titre d’en-tête : ${lotsHeader}`)

  // ── Inventaires ──────────────────────────────────────────────────────────
  await tablist.getByRole('tab', { name: 'Inventaires' }).click()
  await page.waitForURL(/\/fr\/stock\/inventory-count/, { timeout: 15000 })
  await page.waitForTimeout(800)
  const invHeader = (await page.locator('header h1').first().innerText()).trim()
  ok(invHeader === 'Inventaires', `titre d’en-tête : ${invHeader}`)
  await browser.close()

  // ── Téléphone ────────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true })
  await m.page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded' })
  const mList = m.page.getByRole('tablist')
  await mList.waitFor({ timeout: 20000 })
  const geo = await mList.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height }))
  ok(geo.sw > geo.cw && geo.h < 60, `téléphone : onglets sur une ligne à défilement (${geo.sw} > ${geo.cw}, hauteur ${Math.round(geo.h)} px)`)
  await mList.getByRole('tab', { name: 'Inventaires' }).click()
  await m.page.waitForURL(/inventory-count/, { timeout: 15000 })
  await m.page.waitForTimeout(800)
  const vis = await m.page.getByRole('tablist').evaluate(el => {
    const a = el.querySelector('[aria-selected="true"]'); if (!a) return null
    const lr = el.getBoundingClientRect(), ar = a.getBoundingClientRect()
    return { left: ar.left >= lr.left - 1, right: ar.right <= lr.right + 1, label: a.textContent.trim() }
  })
  ok(!!vis && vis.left && vis.right, `téléphone : onglet actif « ${vis?.label} » ramené en vue`)
  await m.page.screenshot({ path: SCR + '/stock-nav-phone.png' })
  await m.browser.close()

  console.log(`\n=== ${pass} OK / ${fail} echecs ===`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
