// Étape 4 — colonnes du tableau Produits, sur le build de production,
// lecture seule : colonnes par défaut (coût retiré de la cellule prix),
// bouton « Colonnes » (optionnelles, celles en attente désactivées), valeur
// du stock = disponible × coût, couverture, mémorisation après rechargement,
// tri sur une colonne optionnelle, retour aux colonnes par défaut, téléphone.
const { openPage, SCR } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'OK ' : '!!!'} ${m}`) }
const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10)
const BASE = 'http://localhost:3000'
const headersOf = async page => (await page.locator('table').first().locator('thead th').allInnerTexts()).map(h => h.trim()).filter(Boolean)

;(async () => {
  const { browser, page } = await openPage({ width: 1280, height: 900, blockServiceWorkers: true })
  await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded' })
  await page.locator('table').first().waitFor({ timeout: 20000 })

  // ── Colonnes par défaut ──────────────────────────────────────────────────
  let headers = await headersOf(page)
  const expected = ['Produit', 'SKU / Code-barres', 'Prix', 'Disponible', 'Ventes 30 j', 'Statut', 'Actions']
  ok(expected.every(h => headers.some(x => x.includes(h))) && !headers.some(h => /Coût|Valeur du stock|Catégorie/.test(h)),
    `colonnes par défaut : ${headers.join(' | ')}`)
  const priceCells = await page.locator('table tbody tr td:nth-child(4)').allInnerTexts()
  ok(priceCells.length > 0 && !priceCells.some(c => /Coût/.test(c)), 'le coût n’est plus glissé sous le prix de vente')

  // ── Bouton Colonnes ──────────────────────────────────────────────────────
  const colsBtn = page.getByRole('button', { name: /^Colonnes/ })
  await colsBtn.click()
  const pop = page.locator('[data-radix-popper-content-wrapper]').first()
  await pop.waitFor({ timeout: 5000 })
  const labels = (await pop.locator('label').allInnerTexts()).map(s => s.trim())
  ok(['Catégorie', 'Fournisseur principal', 'Coût', 'Valeur du stock', 'Stock physique', 'Couverture (jours)', 'Réservé', 'En transit', 'En commande'].every(l => labels.includes(l)),
    `choix proposés : ${labels.join(' / ')}`)
  const disabled = await pop.locator('input[type=checkbox]:disabled').count()
  // Étape 5B (13 oct.) : « Réservé » est active elle aussi — plus aucune colonne seulement annoncée
  ok(disabled === 0, `toutes les colonnes proposées sont actives, « Réservé » comprise (${disabled} désactivée)`)
  for (const l of ['Coût', 'Valeur du stock', 'Catégorie', 'Couverture (jours)']) await pop.getByLabel(l, { exact: true }).check()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  headers = await headersOf(page)
  ok(['Catégorie', 'Coût', 'Valeur du stock', 'Couverture (jours)'].every(h => headers.includes(h)), `colonnes ajoutées : ${headers.join(' | ')}`)
  ok(/Colonnes\s*4/.test((await colsBtn.innerText()).replace(/\s+/g, ' ')), 'badge « 4 » sur le bouton Colonnes')
  // Valeur du stock = disponible × coût, sur la première ligne
  const idx = { cost: headers.indexOf('Coût') + 1, avail: headers.indexOf('Disponible') + 1, value: headers.indexOf('Valeur du stock') + 1, cov: headers.indexOf('Couverture (jours)') + 1 }
  // +1 pour la colonne case à cocher (en-tête sans texte, filtré) : nth-child = index + 2
  // Plusieurs boutiques = plusieurs tableaux : on lit le premier
  const cell = async (col, row = 1) => (await page.locator('table').first().locator(`tbody tr:nth-child(${row}) td:nth-child(${col + 1})`).innerText()).trim()
  const cost = num(await cell(idx.cost)), avail = num(await cell(idx.avail)), value = num(await cell(idx.value))
  ok(cost > 0 && value === avail * cost, `valeur du stock ligne 1 : ${avail} × ${cost} = ${value}`)
  const cov = await cell(idx.cov)
  // Étape 6 : plus de nombre absurde — au-delà d'un an, « > 365 j »
  ok(/^(—|\d+ j|> 365 j)$/.test(cov) && !(/^\d+ j$/.test(cov) && parseInt(cov, 10) > 365), `couverture ligne 1 : « ${cov} » (jours ≤ 365, « > 365 j », ou tiret si pas de vente)`)
  await page.screenshot({ path: SCR + '/stock-columns-desktop.png' })

  // ── Mémorisation ─────────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('table').first().waitFor({ timeout: 20000 })
  headers = await headersOf(page)
  ok(headers.includes('Coût') && headers.includes('Valeur du stock'), 'colonnes mémorisées après rechargement')

  // ── Tri sur une colonne optionnelle ──────────────────────────────────────
  // Après rechargement, la liste se rafraîchit en arrière-plan : on attend le tri posé, puis un rendu stable
  await page.locator('table').first().locator('thead th button', { hasText: /^Coût/ }).click()
  await page.locator('table').first().locator('thead th[aria-sort="descending"]', { hasText: /^Coût/ }).waitFor({ timeout: 5000 })
  await page.waitForTimeout(800)
  const costs = await page.locator('table').first().locator(`tbody tr td:nth-child(${idx.cost + 1})`).evaluateAll(tds => tds.map(td => { const x = td.textContent; return /₦/.test(x) ? parseFloat(x.replace(/[^\d.]/g, '')) : parseFloat(x.replace(/[^\d,]/g, '').replace(',', '.')) })) // « 9 794,64 F CFA » (virgule décimale) ou « ₦1,800 » (virgule des milliers), selon la boutique active de la session
  const firstBad = costs.findIndex((v, i) => i > 0 && !(costs[i - 1] >= v))
  ok(firstBad === -1, `tri par coût décroissant (${costs[0]} … ${costs[costs.length - 1]}${firstBad > 0 ? `, désordre à ${firstBad}: ${costs[firstBad - 1]} → ${costs[firstBad]}` : ''})`)

  // ── Retour aux colonnes par défaut ───────────────────────────────────────
  await colsBtn.click()
  await page.getByRole('button', { name: 'Colonnes par défaut' }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  headers = await headersOf(page)
  ok(!headers.includes('Coût') && !headers.includes('Catégorie'), 'colonnes par défaut rétablies')
  await browser.close()

  // ── Téléphone ────────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true })
  await m.page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded' })
  await m.page.getByRole('button', { name: 'Vue en tableau' }).click()
  await m.page.locator('table').first().waitFor({ timeout: 20000 })
  await m.page.getByRole('button', { name: /^Colonnes/ }).click()
  await m.page.locator('[data-radix-popper-content-wrapper]').first().getByLabel('Coût', { exact: true }).check()
  await m.page.keyboard.press('Escape')
  await m.page.waitForTimeout(300)
  const mh = (await m.page.locator('table').first().locator('thead th').allInnerTexts()).map(h => h.trim())
  ok(mh.includes('Coût'), 'téléphone : colonne Coût ajoutée (défilement horizontal)')
  await m.browser.close()

  console.log(`\n=== ${pass} OK / ${fail} echecs ===`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
