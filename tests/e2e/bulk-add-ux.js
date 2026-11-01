// Lot B des ajouts (1er nov. 2026) : ajout rapide vérifié ligne par ligne. Serveur LOCAL, Boutique Alpha, propriétaire.
// AUCUNE écriture : seule la vérification sans écriture (dry_run: true) atteint le serveur ; l'enregistrement réel est
// intercepté et simulé à partir de la réponse de vérification (identifiants factices).
//  - explication en tête, champs facultatifs repliés puis affichés (« Plus de champs ») ;
//  - vérification : déjà en stock, doublon dans la saisie (bloquant), achat > vente (remarque), saisie « Coca Cola
//    50cl 200/150/100 » acceptée (jamais prise pour une ligne d'exemple) ;
//  - ligne en double retirée → confirmation → bilan : ajoutés (« Compléter la fiche ») et non ajoutés avec raison ;
//  - « Reprendre les lignes non ajoutées » ; haoussa : textes traduits ; téléphone et ordinateur.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/bulk-add-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const EXISTING = 'Banane' // produit actif de Boutique Alpha
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  for (const [locale, width, height] of [['fr', 1366, 900], ['fr', 390, 844], ['ha', 390, 844]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const b = m.bulk_add
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const passed = [], blocked = []
    // Écritures de produits seulement (l'application envoie aussi des requêtes de fond : profil, rôle)
    const productWrites = () => blocked.filter(x => /product|batch|stock/.test(x.path))
    // Filet : toute écriture bloquée, sauf la vérification sans écriture de l'import
    await page.route(/\/(api|rest\/v1)\//, async route => {
      const r = route.request()
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
      let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
      const path = new URL(r.url()).pathname
      // continue() : directement au serveur (le filet de capture.js répondrait « 204 » à tout envoi)
      if (path === '/api/products/import' && body.dry_run === true) { passed.push(body); return route.continue() }
      blocked.push({ path, body })
      if (path === '/api/products/import') {
        // Enregistrement simulé : la réponse de vérification, avec des identifiants factices pour les lignes nouvelles
        const res = await route.fetch({ postData: JSON.stringify({ ...body, dry_run: true }) })
        const j = await res.json()
        let n = 0
        const rows = (j.rows || []).map(x => x.status === 'new' ? { ...x, product_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` } : x)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inserted: n, summary: { ...j.summary, inserted: n }, rows }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
    await page.locator('[data-tour="add-product-menu"]:visible').first().click()
    await page.getByRole('menuitem', { name: m.products.add_quick }).click()
    const d = page.getByTestId('bulk-add-drawer'); await d.waitFor({ timeout: 15000 })
    ok((await d.getByTestId('bulk-add-intro').innerText()).trim() === b.intro, 'explication en tête')
    ok(await d.getByTestId('bulk-add-sku').count() === 0, 'champs facultatifs repliés au départ')
    await d.getByTestId('bulk-add-more').click(); await wait(300)
    ok(await d.getByTestId('bulk-add-sku').count() === 1 && await d.getByTestId('bulk-add-category').count() === 1, '« Plus de champs » : code-barres, catégorie générale')
    ok(await d.getByTestId('bulk-add-expiry-hint').count() === 1, 'péremption sans quantité : explication visible')

    // 5 lignes : nouvelle (avec stock + date), déjà en stock, achat > vente, doublon de la 1re, « Coca Cola 50cl »
    const stamp = Date.now().toString(36)
    const A = `TEST Ajout rapide ${stamp}`
    const lines = [
      [A, '500', '300', '2'], [EXISTING, '400', '', '0'], [`TEST Achat cher ${stamp}`, '100', '150', '0'], [A, '600', '', '0'], ['Coca Cola 50cl', '200', '150', '100'],
    ]
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) { await d.getByTestId('bulk-add-row-add').click(); await wait(150) }
      const row = d.getByTestId('bulk-add-row').nth(i)
      await row.getByTestId('bulk-add-name').fill(lines[i][0])
      await row.getByTestId('bulk-add-price').fill(lines[i][1])
      if (lines[i][2]) await row.getByTestId('bulk-add-buying').fill(lines[i][2])
      await row.getByTestId('bulk-add-qty').fill(lines[i][3])
    }
    await d.getByTestId('bulk-add-row').nth(0).getByTestId('bulk-add-expiry').fill('2027-06-30')
    await page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'Vérifier 5 produits' : 'Duba kaya 5') }).click()
    await d.getByTestId('bulk-add-result').first().waitFor({ timeout: 30000 }).catch(() => {})
    await wait(500)
    const statuses = await d.getByTestId('bulk-add-row').evaluateAll(els => els.map(e => e.getAttribute('data-status')))
    ok(statuses.join() === 'new,exists,new,error,new', `vérification : ${statuses.join(', ')} (attendu : nouvelle, déjà en stock, nouvelle, à corriger, nouvelle)`)
    if (statuses.join() !== 'new,exists,new,error,new') {
      await page.screenshot({ path: `${OUT}/bulk-add-${locale}-${width}-diagnostic.png` })
      console.log('    diagnostic :', (await d.innerText().catch(() => '(panneau absent)')).replace(/\s+/g, ' ').slice(0, 700), '| envoyés :', passed.length, 'bloqués :', blocked.map(x => x.path).join(', '))
    }
    const rowText = async i => (await d.getByTestId('bulk-add-row').nth(i).innerText()).replace(/\s+/g, ' ')
    ok((await rowText(3)).includes(m.import.issue.duplicate_in_file.replace('{line}', '1')), 'doublon : « même produit qu’à la ligne 1 »')
    ok((await rowText(2)).includes(m.import.warning.buying_above_selling), 'remarque : prix d’achat supérieur au prix de vente')
    ok((await rowText(4)).includes(b.status_ready), '« Coca Cola 50cl » 200/150/100 tapé à la main : prêt, jamais écarté comme exemple')
    ok(await d.getByTestId('bulk-add-notice').count() === 1, 'pied : lignes à corriger signalées')
    ok(productWrites().length === 0 && passed.length === 1, `vérification seule envoyée (${passed.length}), aucune écriture de produit (${productWrites().length})`)
    await d.screenshot({ path: `${OUT}/bulk-add-${locale}-${width}-verif.png` })

    // Retirer le doublon → vérifier → confirmation (déjà en stock + remarque)
    const rm = d.getByTestId('bulk-add-row').nth(3).getByRole('button', { name: new RegExp(b.remove_row.replace('{index}', '4')) })
    await rm.locator('visible=true').first().click(); await wait(300)
    await page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'Vérifier 4 produits' : 'Duba kaya 4') }).click()
    await page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'Enregistrer 3 produits' : 'Ajiye kaya 3') }).waitFor({ timeout: 30000 }).catch(() => {})
    ok(await page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'Enregistrer 3 produits' : 'Ajiye kaya 3') }).count() === 1, 'confirmation : « Enregistrer 3 produits » (la ligne déjà en stock n’est pas comptée)')
    ok(productWrites().length === 0, 'toujours aucune écriture de produit avant la confirmation')
    await page.getByRole('button', { name: new RegExp(locale === 'fr' ? 'Enregistrer 3 produits' : 'Ajiye kaya 3') }).click()
    await d.getByTestId('bulk-add-done').waitFor({ timeout: 30000 }).catch(() => {})
    const created = await d.getByTestId('bulk-add-created').locator('li').allInnerTexts()
    const notAdded = await d.getByTestId('bulk-add-not-added').locator('li').allInnerTexts()
    ok(created.length === 3 && created.every(x => x.includes(b.complete)), `bilan : 3 ajoutés avec « ${b.complete} »`, created)
    ok(notAdded.length === 1 && notAdded[0].includes(EXISTING), `bilan : 1 non ajouté avec sa raison (« ${notAdded[0]?.replace(/\s+/g, ' ')} »)`)
    const sent = blocked.find(x => x.path === '/api/products/import')
    ok(productWrites().length === 1 && sent && sent.body.source === 'quick_add' && sent.body.rows[0].values.expiry_date === '2027-06-30', 'enregistrement intercepté : source « quick_add », date du lot transmise')
    await d.screenshot({ path: `${OUT}/bulk-add-${locale}-${width}-bilan.png` })
    await d.getByTestId('bulk-add-fix').click(); await wait(300)
    const back = await d.getByTestId('bulk-add-name').evaluateAll(els => els.map(e => e.value))
    ok(back.length === 1 && back[0] === EXISTING, 'reprendre : seule la ligne non ajoutée revient')
    if (locale === 'ha') ok(!/Vérifier|Plus de champs|Compléter la fiche|Déjà en stock/.test(await d.innerText()), 'haoussa : aucun texte français')
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
