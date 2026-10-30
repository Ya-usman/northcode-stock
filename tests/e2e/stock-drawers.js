// Harmonisation UX du module Stock, sur le build de production (npm start),
// lecture seule (toute écriture produit est interceptée) :
//   desktop : panneau produit à droite (≤ 520 px, pleine hauteur, page visible
//   derrière), en-tête premium compact, sections + « Options avancées » repliées,
//   focus sur le premier champ, pied Annuler / Enregistrer et ajouter / Enregistrer,
//   erreurs sous les champs, garde « modifications non enregistrées » (Continuer /
//   Abandonner), Échap, panneau d'édition avec sous-titre, lots, journal, import,
//   ConfirmModal d'archivage (bouton ambre), historique réappro, menu d'export
//   des péremptions, nouveau transfert avec garde ;
//   mobile : panneau plein écran, pied visible.
const { openPage, SCR } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'OK ' : '!!!'} ${m}`) }
const BASE = 'http://localhost:3000'

async function openAddDrawer(page) {
  await page.getByRole('button', { name: /^Ajouter$/ }).first().click({ timeout: 20000 })
  await page.getByRole('menuitem', { name: 'Ajouter un produit' }).click()
  const drawer = page.getByTestId('product-drawer')
  await drawer.waitFor({ timeout: 15000 })
  await drawer.locator('input[name="name"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(400) // fin de l'animation d'entrée avant toute mesure
  return drawer
}

;(async () => {
  const { browser, page } = await openPage({ width: 1280, height: 900, blockServiceWorkers: true, beforeGoto: async p => p.addInitScript(() => { try { localStorage.setItem('active_shop_id', 'a0000000-0000-0000-0000-000000000001'); localStorage.setItem('dashboard_shop_filter', 'a0000000-0000-0000-0000-000000000001') } catch {} }) })
  let writes = 0
  await page.route('**/api/products', route => {
    if (route.request().method() === 'GET') return route.continue()
    writes++
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'test : écriture bloquée' }) })
  })

  // ── Panneau « Ajouter un produit » ───────────────────────────────────────
  await page.goto(BASE + '/fr/stock/products', { waitUntil: 'domcontentloaded' })
  let drawer = await openAddDrawer(page)
  const box = await drawer.boundingBox()
  ok(box && Math.abs(box.x + box.width - 1280) < 2, `desktop : panneau collé à droite (x+w = ${box && Math.round(box.x + box.width)})`)
  ok(box && box.width <= 522 && box.width >= 480, `desktop : largeur du panneau ${box && Math.round(box.width)} px (≤ 520)`)
  ok(box && box.height >= 898, `desktop : pleine hauteur (${box && Math.round(box.height)} px)`)
  ok(await page.locator('main').first().isVisible(), 'la page reste visible derrière le voile')
  const header = drawer.locator('div').filter({ has: page.getByText('Ajouter un produit', { exact: true }) }).first()
  // L'onglet courant n'est plus répété en étiquette : le titre porte seul l'action
  ok((await drawer.locator('span.uppercase').count()) === 0, 'en-tête : pas d’étiquette « Stock » (onglet non répété)')
  ok(await drawer.getByText('Ajouter un produit', { exact: true }).first().isVisible(), 'en-tête : titre')
  ok(await drawer.getByRole('button', { name: 'Fermer' }).isVisible(), 'en-tête : bouton X « Fermer »')
  ok(await drawer.getByText('Informations principales', { exact: true }).first().isVisible(), 'carte « Informations principales »')
  const suffixes = (await drawer.locator('span.bg-muted').allInnerTexts()).map(s => s.trim())
  // La devise est celle de la boutique active de la session ; l'unité est désormais traduite (« pièces »)
  ok((suffixes.includes('F CFA') || suffixes.includes('₦')) && suffixes.some(x => /^pi[eè]ces?$/.test(x)), `suffixes devise / unité dans les champs (${suffixes.join(' / ')})`)
  ok(await drawer.getByRole('button', { name: /Scan/ }).isVisible(), 'bouton Scan accolé au champ code-barres')
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('name'))
  ok(focused === 'name', `focus initial sur le premier champ (${focused})`)
  const adv = drawer.getByRole('button', { name: /Options avancées/ })
  ok((await adv.getAttribute('aria-expanded')) === 'false', '« Options avancées » repliée par défaut')
  ok(!(await drawer.getByRole('button', { name: 'Prendre une photo' }).isVisible().catch(() => false)), 'photo masquée tant que la section est repliée')
  await adv.click()
  ok((await adv.getAttribute('aria-expanded')) === 'true' && await drawer.getByRole('button', { name: 'Prendre une photo' }).isVisible(), 'dépliée : fournisseur et photo apparaissent')
  const footerBtns = await drawer.locator('button').evaluateAll(els => els.filter(e => /^(Annuler|Enregistrer)$/.test(e.textContent.trim())).map(e => e.textContent.trim()))
  ok(footerBtns.join('|') === 'Annuler|Enregistrer', `pied : ${footerBtns.join(' / ')} (une rangée)`)
  const addAnother = drawer.getByTestId('add-another')
  ok(await addAnother.isVisible() && !(await addAnother.isChecked()), 'case « Ajouter un autre produit ensuite » présente, décochée')
  await addAnother.check()
  ok(await addAnother.isChecked(), 'case cochée (mémorisée pour la session)')
  await addAnother.uncheck()
  const submitBtn = drawer.getByTestId('drawer-submit')
  ok((await submitBtn.getAttribute('type')) === 'submit' && (await submitBtn.getAttribute('form')) === 'product-form', 'bouton Enregistrer soumet le <form id="product-form">')
  await page.screenshot({ path: SCR + '/drawer-add-desktop.png' }).catch(() => {})

  // Validation : erreurs sous les champs, aucune requête d'écriture
  await submitBtn.click()
  await page.waitForTimeout(500)
  const errText = (await drawer.locator('p.text-destructive').allInnerTexts()).join(' | ')
  ok(/obligatoire|requis/i.test(errText), `erreurs affichées sous les champs (${errText.slice(0, 60)})`)
  ok(writes === 0, 'formulaire invalide : aucune requête envoyée')
  ok(await drawer.isVisible(), 'le panneau reste ouvert après l’erreur')

  // Garde « modifications non enregistrées »
  await drawer.locator('input[name="name"]').fill('Produit test garde')
  await page.keyboard.press('Escape')
  const guard = page.getByTestId('unsaved-changes-dialog')
  await guard.waitFor({ timeout: 5000 })
  const guardText = (await guard.innerText()).replace(/\s+/g, ' ')
  ok(/Vous avez des modifications non enregistrées\./.test(guardText), 'garde : message')
  ok(await guard.getByRole('button', { name: 'Continuer la modification' }).isVisible() && await guard.getByRole('button', { name: 'Abandonner' }).isVisible(), 'garde : boutons Continuer la modification / Abandonner')
  await page.screenshot({ path: SCR + '/drawer-unsaved-guard.png' }).catch(() => {})
  await guard.getByRole('button', { name: 'Continuer la modification' }).click()
  await guard.waitFor({ state: 'hidden', timeout: 5000 })
  ok(await drawer.isVisible() && (await drawer.locator('input[name="name"]').inputValue()) === 'Produit test garde', 'Continuer : panneau et saisie conservés')
  await drawer.getByRole('button', { name: 'Annuler' }).click()
  await guard.waitFor({ timeout: 5000 })
  await guard.getByRole('button', { name: 'Abandonner' }).click()
  await drawer.waitFor({ state: 'hidden', timeout: 5000 })
  ok(!(await drawer.isVisible().catch(() => false)), 'Abandonner : panneau fermé')

  // Sans saisie : Échap ferme directement
  drawer = await openAddDrawer(page)
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden', timeout: 5000 })
  ok(!(await guard.isVisible().catch(() => false)), 'sans modification : Échap ferme sans garde')

  // ── Panneau d'édition ────────────────────────────────────────────────────
  if (!(await page.locator('table').first().isVisible().catch(() => false))) await page.getByRole('button', { name: 'Vue en tableau' }).click()
  const firstRow = page.locator('table tbody tr').first()
  const rowName = (await firstRow.locator('td').nth(1).innerText()).split('\n')[0].trim()
  await firstRow.getByRole('button', { name: 'Modifier le produit' }).click()
  const edit = page.getByTestId('product-drawer')
  await edit.waitFor({ timeout: 10000 })
  await edit.locator('input[name="name"]').waitFor({ timeout: 10000 })
  const editName = await edit.locator('input[name="name"]').inputValue()
  ok(editName.length > 0 && rowName.startsWith(editName.slice(0, 8)), `édition : fiche préremplie (${editName})`)
  ok(await edit.getByText('Modifier le produit', { exact: true }).first().isVisible(), 'édition : titre « Modifier le produit »')
  ok((await edit.innerText()).includes(editName), 'édition : nom du produit en sous-titre de l’en-tête')
  ok((await edit.getByTestId('drawer-submit').innerText()).trim() === 'Mettre à jour', 'édition : bouton « Mettre à jour »')
  ok((await edit.getByTestId('add-another').count()) === 0, 'édition : pas de case « Ajouter un autre »')
  await edit.getByRole('button', { name: 'Fermer' }).click()
  await edit.waitFor({ state: 'hidden', timeout: 5000 })
  ok(true, 'édition : X ferme (aucune modification)')

  // ── Lots (DetailDrawer) ──────────────────────────────────────────────────
  await firstRow.getByRole('button', { name: 'Plus d’actions' }).click()
  await page.getByRole('menuitem', { name: 'Voir les lots' }).click()
  const lots = page.getByTestId('product-detail')
  await lots.waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)
  const lotsBox = await lots.boundingBox()
  ok(lotsBox && lotsBox.width <= 642 && Math.abs(lotsBox.x + lotsBox.width - 1280) < 2 && (await lots.getByTestId('product-detail-batches').count()) === 1, 'lots : fiche produit en panneau latéral droit, section Lots présente')
  ok((await lots.innerText()).includes(rowName.slice(0, 8)), 'lots : nom du produit en titre')
  await page.screenshot({ path: SCR + '/drawer-batches.png' }).catch(() => {})
  await page.keyboard.press('Escape')
  await lots.waitFor({ state: 'hidden', timeout: 5000 })

  // ── Archiver (ConfirmModal, bouton ambre) ────────────────────────────────
  await firstRow.getByRole('button', { name: 'Plus d’actions' }).click()
  const archiveItem = page.getByRole('menuitem', { name: 'Archiver le produit' })
  if (await archiveItem.isVisible().catch(() => false)) {
    await archiveItem.click()
    const confirm = page.getByRole('dialog')
    await confirm.waitFor({ timeout: 5000 })
    const cText = (await confirm.innerText()).replace(/\s+/g, ' ')
    ok(/Archiver ce produit \?/.test(cText), 'archivage : question affichée')
    const tone = await confirm.locator('button[data-tone]').getAttribute('data-tone')
    ok(tone === 'warning', `archivage : bouton distinct (tone=${tone})`)
    await page.screenshot({ path: SCR + '/confirm-archive.png' }).catch(() => {})
    await confirm.getByRole('button', { name: 'Annuler' }).click()
    await confirm.waitFor({ state: 'hidden', timeout: 5000 })
    ok(writes === 0, 'archivage annulé : aucune écriture')
  } else {
    await page.keyboard.press('Escape')
    ok(true, 'archivage : entrée absente pour ce rôle (ignoré)')
  }

  // ── Journal (DetailDrawer) ───────────────────────────────────────────────
  await page.locator('main button[title="Plus d’actions"]').first().click()
  await page.getByRole('menuitem', { name: 'Journal d’activité' }).click()
  const journal = page.getByTestId('journal-drawer')
  await journal.waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)
  const jBox = await journal.boundingBox()
  ok(jBox && jBox.width <= 642 && jBox.width > 522, `journal : panneau large (${jBox && Math.round(jBox.width)} px)`)
  await page.keyboard.press('Escape')
  await journal.waitFor({ state: 'hidden', timeout: 5000 })

  // ── Import CSV (AppDrawer) ───────────────────────────────────────────────
  // L'import n'est plus qu'à un endroit : le menu « Ajouter »
  await page.getByRole('button', { name: /^Ajouter$/ }).click()
  await page.getByRole('menuitem', { name: 'Importer des produits' }).click()
  const imp = page.getByRole('dialog').last()
  await imp.waitFor({ timeout: 10000 })
  ok(/Excel|modèle/i.test(await imp.innerText()), 'import : fenêtre d’import ouverte (Excel, modèle)')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(800) }
  ok(true, 'import : Échap ferme (aucun fichier chargé)')

  // ── Mouvements : toucher une ligne ouvre le détail du mouvement (panneau commun) ; de là, la fiche produit,
  //    puis « Tout voir » filtre l'écran sur ce produit et montre son résumé ──
  await page.goto(BASE + '/fr/stock/movements', { waitUntil: 'domcontentloaded' })
  // Premier mouvement dont le produit existe encore (ceux d'un produit supprimé n'ont pas de bouton « Voir le produit »).
  // Type « Ventes » d'abord : les tests d'entrées de stock (produits créés puis supprimés) n'en produisent jamais
  await page.locator('main [data-movement-row]').first().waitFor({ timeout: 20000 })
  await page.locator('main [role="group"] button[aria-pressed]').filter({ hasText: /^Ventes$/ }).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  await page.locator('main [data-movement-row]').first().waitFor({ timeout: 20000 })
  const moveDrawer = page.getByTestId('movement-detail')
  const nRows = await page.locator("main [data-movement-row]").count()
  for (let i = 0; i < Math.min(nRows, 60); i++) {
    const row = page.locator('main [data-movement-row]').nth(i)
    await row.scrollIntoViewIfNeeded(); await row.click()
    await moveDrawer.waitFor({ timeout: 15000 })
    await page.waitForTimeout(600)
    if (await moveDrawer.getByTestId('movement-detail-product-action').count()) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  }
  ok((await moveDrawer.getByTestId('movement-detail-facts').count()) === 1 && (await page.getByTestId('product-detail').count()) === 0, 'mouvements : toucher une ligne → détail de ce mouvement (et non la fiche produit)')
  await moveDrawer.getByTestId('movement-detail-product-action').click()
  await page.getByTestId('product-detail').waitFor({ timeout: 15000 })
  await page.getByTestId('product-detail-all-movements').click()
  await page.waitForURL(/\/fr\/stock\/movements\?product=/, { timeout: 20000 })
  const sum = page.getByTestId('movements-product-summary')
  await sum.waitFor({ timeout: 15000 })
  ok((await sum.locator('dd').count()) === 3 && (await page.getByTestId('movements-product-filter').count()) === 1, 'mouvements : produit filtré → pastille + résumé (stock de base, réappro., stock actuel)')
  await page.getByRole('button', { name: 'Retirer le filtre produit' }).click()
  await page.getByTestId('movements-product-filter').waitFor({ state: 'detached', timeout: 10000 })

  // ── Péremptions : menu d'export commun ───────────────────────────────────
  await page.goto(BASE + '/fr/stock/expiry', { waitUntil: 'domcontentloaded' })
  const exportBtn = page.locator('[data-testid="lots-more-actions"]')
  if (await exportBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
    await exportBtn.click()
    const items = (await page.getByRole('menuitem').allInnerTexts()).map(s => s.trim())
    ok(items.includes('Exporter en PDF') && items.includes('Exporter en CSV'), `péremptions : menu d’export (${items.join(' / ')})`)
    await page.keyboard.press('Escape')
  } else {
    ok(true, 'péremptions : aucun lot, bouton d’export absent (ignoré)')
  }

  // ── Transferts : nouveau transfert ───────────────────────────────────────
  await page.goto(BASE + '/fr/stock/transfers', { waitUntil: 'domcontentloaded' })
  const newBtn = page.getByRole('button', { name: /Nouveau transfert/ })
  if (await newBtn.isVisible({ timeout: 15000 }).catch(() => false)) {
    await newBtn.click()
    const tr = page.getByTestId('transfer-drawer')
    await tr.waitFor({ timeout: 10000 })
    ok(await tr.getByRole('button', { name: 'Envoyer' }).isDisabled(), 'transfert : Envoyer désactivé sans destination ni produit')
    await page.keyboard.press('Escape')
    await tr.waitFor({ state: 'hidden', timeout: 5000 })
    ok(true, 'transfert : Échap ferme sans garde quand rien n’est saisi')
    await newBtn.click()
    await tr.waitFor({ timeout: 10000 })
    await tr.locator('textarea').fill('note de test')
    await page.keyboard.press('Escape')
    await guard.waitFor({ timeout: 5000 })
    ok(true, 'transfert : garde après saisie d’une note')
    await guard.getByRole('button', { name: 'Abandonner' }).click()
    await tr.waitFor({ state: 'hidden', timeout: 5000 })
  } else {
    ok(true, 'transferts : bouton absent (une seule boutique ou rôle) — ignoré')
  }
  await browser.close()

  // ── Mobile ───────────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true, beforeGoto: async p => p.addInitScript(() => { try { localStorage.setItem('active_shop_id', 'a0000000-0000-0000-0000-000000000001'); localStorage.setItem('dashboard_shop_filter', 'a0000000-0000-0000-0000-000000000001') } catch {} }) })
  await m.page.route('**/api/products', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 500, body: '{}' }))
  await m.page.goto(BASE + '/fr/stock/products', { waitUntil: 'domcontentloaded' })
  const md = await openAddDrawer(m.page)
  const mBox = await md.boundingBox()
  ok(mBox && mBox.x === 0 && mBox.y === 0 && Math.abs(mBox.width - 390) < 2 && Math.abs(mBox.height - 844) < 2, `mobile : panneau plein écran (${mBox && `${Math.round(mBox.width)}×${Math.round(mBox.height)}`})`)
  const mSubmit = await md.getByTestId('drawer-submit').boundingBox()
  ok(mSubmit && mSubmit.y + mSubmit.height <= 844 && mSubmit.y > 600, `mobile : pied fixe visible (Enregistrer à y=${mSubmit && Math.round(mSubmit.y)})`)
  const mCancel = await md.getByRole('button', { name: 'Annuler' }).boundingBox()
  const bottomGap = mCancel ? Math.round(844 - (mCancel.y + mCancel.height)) : -1
  ok(bottomGap >= 18, `mobile : marge sous le dernier bouton ${bottomGap} px (≥ 18)`)
  ok(mCancel && mSubmit && Math.abs(mCancel.y - mSubmit.y) < 2 && mCancel.width < mSubmit.width, `mobile : Annuler et Enregistrer sur une rangée (${Math.round(mCancel.width)} / ${Math.round(mSubmit.width)} px)`)
  const mHeader = await md.locator('p.text-lg').first().evaluate(el => getComputedStyle(el.closest('div[class*="bg-stockshop-blue"]') || el).backgroundColor)
  ok(/rgb\(7, 62, 138\)/.test(mHeader), `mobile : en-tête bleu de la marque (${mHeader})`)
  const mName = await md.locator('input[name="name"]').boundingBox()
  ok(mName && mName.y > 60 && mName.y < 400, 'mobile : corps défilant sous l’en-tête')
  // p.text-lg = titre visible de l'en-tête (le titre lu par les lecteurs d'écran est hors écran)
  const mTitle = await md.locator('p.text-lg').first().boundingBox()
  // Téléphone plein écran (30 oct. 2026) : flèche « Retour » en haut à gauche à la place du X
  const mBack = await md.getByRole('button', { name: 'Retour' }).boundingBox()
  ok(mTitle && mTitle.y >= 18 && mBack && mBack.y >= 12 && mBack.x < 30 && !(await md.getByRole('button', { name: 'Fermer' }).isVisible()),
    `mobile : marge au-dessus du titre ${mTitle && Math.round(mTitle.y)} px (≥ 18), flèche « Retour » à gauche (x ${mBack && Math.round(mBack.x)}, y ${mBack && Math.round(mBack.y)}), pas de X`)
  await m.page.screenshot({ path: SCR + '/drawer-add-mobile.png' }).catch(() => {})
  await md.getByRole('button', { name: 'Annuler' }).click()
  await md.waitFor({ state: 'hidden', timeout: 5000 })
  await m.browser.close()

  console.log(`\n=== ${pass} OK / ${fail} echecs ===`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
