// Vue en tableau de la page Stock, sur le build de production, lecture seule.
// Le compte de test voit plusieurs boutiques : un tableau par boutique.
//   A) ordinateur, premier passage → tableau par défaut, colonnes, total des
//      lignes = compteur « N produit(s) », pastilles de statut, actions ;
//   B) tri par Stock (décroissant puis croissant) dans chaque tableau,
//      mémorisé après rechargement ;
//   C) sélection : une ligne → barre groupée ; case d'en-tête → toutes les
//      lignes de ce tableau ; « Tout sélectionner » de la barre → toutes
//      boutiques ; plus rien de coché → barre disparue ;
//   D) bascule cartes ↔ tableau, choix mémorisé après rechargement ;
//   E) téléphone : cartes par défaut, tableau à la demande avec défilement
//      horizontal, colonne Produit figée, SKU repliée.
const { openPage, SCR } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'OK ' : '!!!'} ${m}`) }
const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10)
const isSorted = (arr, dir) => arr.every((v, i) => i === 0 || (dir === 'asc' ? arr[i - 1] <= v : arr[i - 1] >= v))

async function stockColumns(page) {
  // Une liste de valeurs par tableau
  return page.locator('table').evaluateAll(tables => tables.map(tbl =>
    // Le disponible est le premier nombre de la cellule (une mention « N périmés » peut suivre, depuis le 13 oct.)
    [...tbl.querySelectorAll('tbody tr td:nth-child(5)')].map(td => parseInt((td.querySelector('span') || td).textContent.replace(/[^\d]/g, ''), 10))
  ))
}

;(async () => {
  // ── A) ordinateur ─────────────────────────────────────────────────────────
  const { browser, page } = await openPage({ width: 1280, height: 900, blockServiceWorkers: true })
  await page.goto('http://localhost:3000/fr/stock/products', { waitUntil: 'domcontentloaded' })
  const tables = page.locator('table')
  await tables.first().waitFor({ timeout: 20000 })
  const nTables = await tables.count()
  ok(nTables >= 1, `A) tableau par défaut sur ordinateur (premier passage) : ${nTables} tableau(x), un par boutique`)
  const headers = (await tables.first().locator('thead th').allInnerTexts()).map(h => h.trim()).filter(Boolean)
  const expected = ['Produit', 'SKU', 'Prix', 'Disponible', 'Ventes 30 j', 'Statut', 'Actions']
  ok(expected.every(h => headers.some(x => x.toLowerCase().includes(h.toLowerCase()))), `A) colonnes : ${headers.join(' | ')}`)
  const countText = await page.getByTestId('products-count').innerText()
  const rows = await page.locator('table tbody tr').count()
  ok(rows === num(countText) && rows > 0, `A) ${rows} lignes au total = « ${countText.trim()} »`)
  const chips = await page.locator('table tbody tr td:nth-child(7) span').allInnerTexts()
  ok(chips.every(c => /En stock|Stock faible|Rupture|Ventes lentes/.test(c)), `A) pastilles de statut (${[...new Set(chips)].join(', ')})`)
  const sales = await page.locator('table tbody tr td:nth-child(6)').allInnerTexts()
  ok(sales.every(s => /^\s*(\d+|—)\s*$/.test(s)), 'A) colonne Ventes 30 j renseignée (chiffre, ou tiret tant que non chargé)')
  const firstRowActions = await page.locator('table tbody tr').first().locator('td:last-child button').count()
  ok(firstRowActions >= 3, `A) ${firstRowActions} boutons d’action en ligne sur la première ligne (réappro, modifier, promo, ⋯)`)
  const fit = await tables.first().evaluate(tbl => ({ sw: tbl.parentElement.scrollWidth, cw: tbl.parentElement.clientWidth }))
  ok(fit.sw <= fit.cw, `A) le tableau tient sans défilement horizontal à 1280 px (${fit.sw} ≤ ${fit.cw})`)
  await page.locator('table tbody tr').first().getByRole('button', { name: 'Plus d’actions' }).click()
  const menu = page.getByRole('menu')
  await menu.waitFor({ timeout: 5000 })
  const menuItems = await menu.getByRole('menuitem').allInnerTexts()
  ok(menuItems.some(x => /Voir les lots/.test(x)) && menuItems.some(x => /Archiver le produit/.test(x)), `A) menu ⋯ : ${menuItems.map(x => x.trim()).join(' / ')}`)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await page.screenshot({ path: SCR + '/stock-table-desktop.png' })

  // ── B) tri ────────────────────────────────────────────────────────────────
  const stockHeader = tables.first().locator('thead th button', { hasText: 'Disponible' })
  await stockHeader.click()
  let cols = await stockColumns(page)
  ok(cols.every(c => isSorted(c, 'desc')), `B) premier clic sur Stock : décroissant dans chaque tableau (${cols.map(c => c[0] + '…' + c[c.length - 1]).join(' ; ')})`)
  await stockHeader.click()
  cols = await stockColumns(page)
  ok(cols.every(c => isSorted(c, 'asc')), `B) second clic : croissant (${cols.map(c => c[0] + '…' + c[c.length - 1]).join(' ; ')})`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await tables.first().waitFor({ timeout: 20000 })
  const ariaSort = await tables.first().locator('thead th', { hasText: 'Disponible' }).getAttribute('aria-sort')
  ok(ariaSort === 'ascending', `B) tri mémorisé après rechargement (aria-sort=${ariaSort})`)

  // ── C) sélection ──────────────────────────────────────────────────────────
  const firstTableRows = await tables.first().locator('tbody tr').count()
  await tables.first().locator('tbody tr').first().locator('input[type=checkbox]').check()
  const selectAllBtn = page.getByRole('button', { name: /^Tout sélectionner/i })
  ok(await selectAllBtn.isVisible().catch(() => false), 'C) une ligne cochée → barre d’actions groupées visible')
  await tables.first().locator('thead input[type=checkbox]').check()
  let checked = await page.locator('table tbody input[type=checkbox]:checked').count()
  ok(checked === firstTableRows, `C) case d’en-tête du premier tableau : ${checked}/${firstTableRows} lignes de ce tableau cochées`)
  if (nTables > 1) {
    await selectAllBtn.click()
    checked = await page.locator('table tbody input[type=checkbox]:checked').count()
    ok(checked === rows, `C) « Tout sélectionner » de la barre : ${checked}/${rows} toutes boutiques`)
  }
  const deselectAllBtn = page.getByRole('button', { name: /^Tout désélectionner/i })
  ok(await deselectAllBtn.isVisible().catch(() => false), 'C) barre : « Tout désélectionner »')
  await deselectAllBtn.click()
  await page.waitForTimeout(300)
  checked = await page.locator('table tbody input[type=checkbox]:checked').count()
  const barGone = !(await page.getByRole('button', { name: /^Tout (dé)?sélectionner/i }).isVisible().catch(() => false))
  ok(checked === 0 && barGone, 'C) plus rien de coché → barre disparue')

  // ── D) bascule et mémorisation ────────────────────────────────────────────
  await page.getByRole('button', { name: 'Vue en cartes' }).click()
  ok(await tables.count() === 0 && (await page.locator('.grid .rounded-lg.border.bg-card').count()) > 0, 'D) vue cartes : grille de cartes, plus de tableau')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.grid .rounded-lg.border.bg-card').first().waitFor({ timeout: 20000 })
  ok(await tables.count() === 0, 'D) choix « cartes » mémorisé après rechargement')
  await page.getByRole('button', { name: 'Vue en tableau' }).click()
  await tables.first().waitFor({ timeout: 10000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await tables.first().waitFor({ timeout: 20000 })
  ok(await tables.count() === nTables, 'D) choix « tableau » mémorisé après rechargement')
  await browser.close()

  // ── E) téléphone ──────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true })
  await m.page.goto('http://localhost:3000/fr/stock/products', { waitUntil: 'domcontentloaded' })
  await m.page.locator('.grid .rounded-lg.border.bg-card').first().waitFor({ timeout: 20000 })
  ok(await m.page.locator('table').count() === 0, 'E) téléphone : cartes par défaut')
  await m.page.getByRole('button', { name: 'Vue en tableau' }).click()
  await m.page.locator('table').first().waitFor({ timeout: 10000 })
  const scroll = await m.page.locator('table').first().evaluate(tbl => { const c = tbl.parentElement; return { sw: c.scrollWidth, cw: c.clientWidth } })
  ok(scroll.sw > scroll.cw, `E) téléphone : défilement horizontal (${scroll.sw} > ${scroll.cw})`)
  const sticky = await m.page.locator('table tbody tr').first().locator('td:nth-child(2)').evaluate(td => getComputedStyle(td).position)
  ok(sticky === 'sticky', `E) téléphone : colonne Produit figée (position: ${sticky})`)
  const skuHidden = await m.page.locator('table').first().locator('thead th', { hasText: 'SKU' }).evaluate(th => getComputedStyle(th).display === 'none')
  ok(skuHidden, 'E) téléphone : colonne SKU repliée sous le nom')
  await m.page.locator('table').first().scrollIntoViewIfNeeded()
  await m.page.waitForTimeout(300)
  await m.page.screenshot({ path: SCR + '/stock-table-phone.png' })
  await m.browser.close()

  console.log(`\n=== ${pass} OK / ${fail} echecs ===`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
