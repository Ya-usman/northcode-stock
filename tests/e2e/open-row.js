// Fiche produit : toute la ligne (ordinateur) et toute la carte (téléphone) l'ouvrent ; les boutons et actions
// internes ne font que leur action. LECTURE SEULE (écritures du navigateur bloquées), Boutique Alpha, propriétaire.
// Usage : CAPTURE_BASE=http://localhost:3000 node open-row.js
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : '→ ' + String(extra).slice(0, 300)) }
async function open(width, height) {
  const s = await session({ width, height, scale: 1, locale: 'fr' })
  await s.page.context().addInitScript(([id]) => { try { localStorage.setItem('active_shop_id', id) } catch {} }, [ALPHA])
  await s.page.goto(BASE + '/fr/stock/products', { waitUntil: 'domcontentloaded', timeout: 120000 }); await s.page.waitForTimeout(7000)
  return s
}
const sheet = page => page.locator('[data-testid="product-detail"]')
const closeAll = async page => { for (let i = 0; i < 5 && (await page.locator('[role="dialog"], [role="menu"]').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) } }

;(async () => {
  console.log('Base :', BASE)
  console.log('\nOrdinateur 1280 px — tableau')
  {
    const { browser, page } = await open(1280, 900)
    const row = page.locator('main table tbody tr[data-product-row]').first()
    const name = (await row.locator('[data-product-name]').innerText()).trim()
    check('la ligne se présente comme ouvrable (curseur « main »)', (await row.evaluate(el => getComputedStyle(el).cursor)) === 'pointer')
    const before = await row.evaluate(el => getComputedStyle(el).backgroundColor)
    await row.locator('td').nth(4).hover(); await page.waitForTimeout(400)
    check('survol : la ligne change discrètement de fond', (await row.evaluate(el => getComputedStyle(el).backgroundColor)) !== before, before)
    // Zone neutre : une cellule de chiffres
    await row.locator('td').nth(4).click({ position: { x: 6, y: 6 } }); await page.waitForTimeout(1200)
    check(`clic sur une zone neutre de la ligne « ${name} » : la fiche s’ouvre, sur ce produit`, (await sheet(page).count()) === 1 && (await sheet(page).innerText()).includes(name))
    await closeAll(page)
    await row.locator('td').last().click({ position: { x: 3, y: 3 } }); await page.waitForTimeout(1000)
    check('clic dans la marge de la colonne Actions (hors bouton) : la fiche s’ouvre aussi', (await sheet(page).count()) === 1)
    await closeAll(page)
    await row.locator('[data-product-name]').click(); await page.waitForTimeout(1000)
    check('clic sur le nom : la fiche s’ouvre (une seule)', (await sheet(page).count()) === 1)
    await closeAll(page)
    await row.locator('button[aria-label^="Ouvrir la fiche"]').click(); await page.waitForTimeout(1000)
    check('clic sur la photo : la fiche s’ouvre', (await sheet(page).count()) === 1)
    await closeAll(page)
    // Case à cocher : coche, n'ouvre pas
    await row.locator('input[type="checkbox"]').click(); await page.waitForTimeout(700)
    check('case à cocher : coche la ligne, n’ouvre PAS la fiche', (await sheet(page).count()) === 0 && await row.locator('input[type="checkbox"]').isChecked())
    await row.locator('td').first().click({ position: { x: 2, y: 2 } }); await page.waitForTimeout(700)
    check('marge de la cellule de la case : n’ouvre PAS la fiche non plus', (await sheet(page).count()) === 0)
    if (await row.locator('input[type="checkbox"]').isChecked()) await row.locator('input[type="checkbox"]').click()
    await page.waitForTimeout(400)
    // Bouton Réapprovisionner : sa fenêtre seulement
    await row.locator('button[title="Réapprovisionner"]').click(); await page.waitForTimeout(1000)
    check('bouton « Réapprovisionner » : ouvre sa fenêtre, PAS la fiche', (await sheet(page).count()) === 0 && (await page.locator('[role="dialog"]').filter({ has: page.locator('form') }).count()) >= 1)
    await closeAll(page)
    // Menu « Plus d'actions » puis « Modifier » : le panneau de modification, pas la fiche
    await row.getByRole('button', { name: 'Plus d’actions' }).click(); await page.waitForTimeout(600)
    check('bouton « Plus d’actions » : ouvre le menu, PAS la fiche', (await sheet(page).count()) === 0 && (await page.getByRole('menuitem').count()) > 0)
    const items = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
    await page.getByRole('menuitem', { name: 'Archiver le produit' }).click(); await page.waitForTimeout(1200)
    check('menu → « Archiver le produit » : sa question de confirmation, PAS la fiche (annulée, aucune écriture)', (await sheet(page).count()) === 0 && /Archiver/.test(await page.locator('[role="dialog"]').last().innerText().catch(() => '')), items.join(' / '))
    await closeAll(page)
    await row.getByRole('button', { name: 'Plus d’actions' }).click(); await page.waitForTimeout(600)
    await page.getByRole('menuitem', { name: 'Voir les lots' }).click(); await page.waitForTimeout(1800)
    check('menu → « Voir les lots » : la fiche, ouverte sur ses lots — une seule fiche', (await sheet(page).count()) === 1 && (await page.evaluate(() => document.querySelector('[data-testid="product-detail"] .overflow-y-auto').scrollTop)) > 50)
    await closeAll(page)
    // Mention « N périmés » (raccourci Lots) : la fiche sur ses lots, une seule fois
    const expiredBtn = page.locator('main table tbody tr[data-product-row] button', { hasText: /périmé/ }).first()
    if (await expiredBtn.count()) {
      await expiredBtn.click(); await page.waitForTimeout(1800)
      const scroll = await page.evaluate(() => { const b = document.querySelector('[data-testid="product-detail"] .overflow-y-auto'); return b ? b.scrollTop : -1 })
      check('raccourci « N périmés » : la fiche s’ouvre sur ses lots (pas en haut)', (await sheet(page).count()) === 1 && scroll > 50, scroll)
      await closeAll(page)
    }
    // Sélection de texte dans la ligne : n'ouvre pas la fiche
    await page.evaluate(() => { const el = document.querySelector('main table tbody tr[data-product-row] td:nth-child(5)'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
    await row.locator('td').nth(4).dispatchEvent('click'); await page.waitForTimeout(700)
    check('texte sélectionné dans la ligne (copie d’un chiffre) : n’ouvre pas la fiche', (await sheet(page).count()) === 0)
    await page.evaluate(() => getSelection().removeAllRanges())
    await browser.close()
  }

  console.log('\nTéléphone 390 px — cartes')
  {
    const { browser, page } = await open(390, 844)
    const card = page.locator('main [data-product-card]').first()
    const name = (await card.locator('[data-product-name]').innerText()).trim()
    const box = await card.boundingBox()
    check(`la carte entière est la zone tactile (${Math.round(box.width)} × ${Math.round(box.height)} px)`, box.width > 300 && box.height > 100)
    // Zone neutre : un point de la carte sous lequel il n'y a ni bouton ni lien (cherché dans la page)
    await card.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500)
    const neutral = await page.evaluate(() => {
      const card = document.querySelector('main [data-product-card]'); const r = card.getBoundingClientRect()
      for (let y = r.top + 60; y < r.bottom - 50; y += 6) for (let x = r.left + 120; x < r.right - 40; x += 12) {
        const el = document.elementFromPoint(x, y)
        if (el && card.contains(el) && !el.closest('button, a, input, label, [role="button"]')) return { x, y, tag: el.tagName }
      }
      return null
    })
    await page.touchscreen.tap(neutral.x, neutral.y)
    await sheet(page).waitFor({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
    check(`toucher une zone neutre de la carte « ${name} » : la fiche s’ouvre en plein écran`, (await sheet(page).count()) === 1 && (await sheet(page).innerText()).includes(name) && (await sheet(page).boundingBox()).width === 390, JSON.stringify(neutral))
    await closeAll(page)
    await card.tap({ position: { x: box.width - 6, y: box.height - 6 } }); await page.waitForTimeout(1200)
    check('toucher le coin de la carte (marge intérieure) : la fiche s’ouvre', (await sheet(page).count()) === 1)
    await closeAll(page)
    const restock = card.getByRole('button', { name: /Réapprovisionner/ })
    await restock.tap(); await page.waitForTimeout(1200)
    check('bouton « Réapprovisionner » de la carte : sa fenêtre seulement, PAS la fiche', (await sheet(page).count()) === 0 && (await page.locator('[role="dialog"]').filter({ has: page.locator('form') }).count()) >= 1)
    await closeAll(page)
    // Mise à jour (23 oct. 2026) — ancienne hypothèse : plusieurs boutons à icône sur la carte (Lots, Modifier…). Réel :
    // depuis la simplification de Produits, la carte n'a que « Réapprovisionner » et « Plus d’actions » (le reste est dans le menu).
    const more = card.getByRole('button', { name: /Plus d’actions/ })
    await more.tap(); await page.waitForTimeout(900)
    const menuOpen = await page.getByRole('menu').count()
    check('bouton « Plus d’actions » de la carte : son menu seulement, PAS la fiche', menuOpen === 1 && (await sheet(page).count()) === 0, `menu ${menuOpen}, fiche ${await sheet(page).count()}`)
    check('pas de débordement horizontal', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0)
    // Mode sélection : toucher la carte coche, n'ouvre pas
    await page.locator('main').getByRole('button', { name: 'Plus d’actions' }).first().tap().catch(() => {})
    await page.waitForTimeout(500)
    const selectItem = page.getByRole('menuitem', { name: /Sélectionner/ }).first()
    if (await selectItem.count()) {
      await selectItem.tap(); await page.waitForTimeout(700)
      await card.tap({ position: { x: box.width / 2, y: 78 } }); await page.waitForTimeout(900)
      check('mode sélection : toucher la carte la coche, sans ouvrir la fiche', (await sheet(page).count()) === 0)
    } else await closeAll(page)
    await browser.close()
  }
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 600)); process.exit(1) })
