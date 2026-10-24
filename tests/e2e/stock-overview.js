// Étape 2 — Vue d'ensemble, sur le build de production, lecture seule (mis à jour pour la 179 : cartes
// « Lots périmés » / « Expirent bientôt » en nombre de lots, priorités séparées ruptures / stock bas) :
// KPI principaux (Promo n'en fait plus partie), valeur immobilisée du
// stock dormant, zone « Opportunités » cohérente avec les KPI, liens profonds
// vers Produits (filtre) et Lots & péremptions (filtre), téléphone.
const { openPage, SCR } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'OK ' : '!!!'} ${m}`) }
const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10)
const BASE = 'http://localhost:3000'

async function kpiValue(page, label) {
  // Libellé exact : « Produits » ne doit pas attraper « Voir les produits »
  const card = page.locator('section[aria-label="Chiffres clés"] [data-kpi]').filter({ has: page.getByText(label, { exact: true }) })
  const txt = (await card.innerText()).replace(/\s+/g, ' ')
  return { value: num(txt.split(' ')[0]), txt }
}

;(async () => {
  const { browser, page } = await openPage({ width: 1280, height: 900, blockServiceWorkers: true })
  await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded' })
  const kpiSection = page.locator('section[aria-label="Chiffres clés"]')
  await kpiSection.waitFor({ timeout: 20000 })

  // ── KPI ──────────────────────────────────────────────────────────────────
  // 179 : « Péremptions proches » (produits) remplacée par deux cartes en nombre de LOTS
  const labels = ['Valeur du stock', 'Produits', 'Ruptures', 'Stock bas', 'Lots périmés', 'Expirent bientôt', 'Stock dormant']
  const kpiText = (await kpiSection.innerText()).replace(/\s+/g, ' ')
  ok(labels.every(l => kpiText.includes(l)) && !/Péremptions proches/.test(kpiText), `sept KPI : ${labels.join(' · ')}`)
  ok(!/Promo/.test(kpiText), 'Promo n’est plus un KPI principal')
  ok((await kpiSection.locator('button, div.rounded-xl').count()) >= 7, 'sept cartes rendues')
  // Le stock dormant arrive avec les ventes 30 j : on attend le chiffre final
  let dormant = { value: 0, txt: '' }
  for (let i = 0; i < 100; i++) { dormant = await kpiValue(page, 'Stock dormant'); if (dormant.value > 0) break; await page.waitForTimeout(100) }
  ok(dormant.value > 0 && /immobilisés/.test(dormant.txt), `KPI Stock dormant : ${dormant.value}, avec valeur immobilisée (« ${dormant.txt.slice(0, 70)} »)`)
  // Ruptures et stock bas tiennent compte des lots périmés et des réservations, chargés à part : chiffres stables
  let out = -1, low = -1
  for (let i = 0; i < 60; i++) { const o2 = (await kpiValue(page, 'Ruptures')).value, l2 = (await kpiValue(page, 'Stock bas')).value; const same = o2 === out && l2 === low; out = o2; low = l2; if (same && i >= 8) break; await page.waitForTimeout(250) }
  const expiredLots = (await kpiValue(page, 'Lots périmés')).value
  const expiring = (await kpiValue(page, 'Expirent bientôt')).value
  const total = (await kpiValue(page, 'Produits')).value
  ok(total > 0 && out >= 0 && low >= 0 && expiredLots >= 0 && expiring >= 0, `KPI : produits ${total}, ruptures ${out}, stock bas ${low}, lots périmés ${expiredLots}, lots qui expirent ${expiring}`)
  // Ordinateur : le montant tient sur une ligne ; Valeur + Produits, puis quatre alertes, puis Stock dormant
  const dk = await kpiSection.locator(':scope > *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const p = e.querySelector('p'); return { top: Math.round(r.top), w: Math.round(r.width), overflow: e.scrollWidth > e.clientWidth + 1, valueH: p ? Math.round(p.getBoundingClientRect().height) : 0 } }))
  ok(!dk[0].overflow && dk[0].valueH <= 32, `ordinateur : montant de la valeur sur une ligne (hauteur ${dk[0].valueH} px, largeur de carte ${dk[0].w} px)`)
  ok(dk.length === 7 && dk[0].top === dk[1].top && dk[2].top === dk[5].top && dk[1].top !== dk[2].top && dk[6].top > dk[5].top,
    `ordinateur : Valeur + Produits, puis quatre alertes, puis Stock dormant`)

  // ── Priorités : ordre 179 (lots périmés, ruptures, stock bas, expirent bientôt, dormant), 3 visibles ──
  const opp = page.locator('section[aria-label="Priorités stock"]')
  await opp.waitFor({ timeout: 10000 })
  const oppText = (await opp.innerText()).replace(/\s+/g, ' ')
  ok(/Actions recommandées/.test(oppText), 'zone « Priorités stock » affichée')
  const expected = [['expired_lots', expiredLots], ['out', out], ['low', low], ['expiring', expiring], ['dormant', dormant.value]].filter(([, n]) => n > 0).map(([k]) => k).slice(0, 3)
  const shown = await opp.locator('[data-priority]').evaluateAll(els => els.map(e => e.getAttribute('data-priority')))
  ok(shown.join(',') === expected.join(','), `priorités affichées = ordre attendu (${shown.join(' › ')})`)
  const rowCount = (re, n, label) => { const m = oppText.match(re); return ok(!shown.includes(label) || (!!m && num(m[1]) === n), `priorité « ${label} » = carte (${m?.[1] ?? 'non affichée'})`) }
  rowCount(/(\d+) lots? périmés? à traiter/, expiredLots, 'expired_lots')
  rowCount(/(\d+) produits? en rupture/, out, 'out')
  rowCount(/(\d+) produits? en stock bas/, low, 'low')
  ok(!/à réapprovisionner/.test(oppText), 'plus de priorité groupée « à réapprovisionner » (ruptures et stock bas séparés)')
  ok(!/Rien à signaler/.test(oppText), 'pas d’état vide alors que des opportunités existent')
  await page.screenshot({ path: SCR + '/stock-overview-v2-desktop.png', fullPage: true })

  // ── Cartes de lots → Lots & péremptions, filtre correspondant ───────────
  for (const [label, filter, name] of [['Lots périmés', /^Périmé$/, 'Périmé'], ['Expirent bientôt', /^Expire bientôt$/, 'Expire bientôt']]) {
    await page.locator('section[aria-label="Chiffres clés"] button').filter({ hasText: label }).click()
    await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 15000 })
    // La page Lots consomme le lien profond puis nettoie l'adresse ; le filtre reste appliqué à l'écran
    await page.waitForFunction(() => !location.search, null, { timeout: 10000 }).catch(() => {})
    const trig = page.locator('button[role="combobox"]').filter({ hasText: filter })
    await trig.first().waitFor({ timeout: 10000 }).catch(() => {})
    ok(await trig.count() === 1 && !new URL(page.url()).search, `KPI ${label} → Lots & péremptions, exactement un filtre « ${name} », URL nettoyée`)
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await kpiSection.waitFor({ timeout: 20000 })
  }
  await browser.close()

  // ── Téléphone ────────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true })
  await m.page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded' })
  const mk = m.page.locator('section[aria-label="Chiffres clés"]')
  await mk.waitFor({ timeout: 20000 })
  const geo = await mk.locator(':scope > *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) } }))
  const vw = await m.page.evaluate(() => window.innerWidth)
  // Valeur et Produits sur toute la largeur (montant long lisible), alertes par deux
  ok(geo.length >= 7 && geo[0].w > vw * 0.8 && geo[1].w > vw * 0.8 && geo[2].top === geo[3].top && geo[4].top === geo[5].top && geo[6].w > vw * 0.8,
    `téléphone : Valeur et Produits pleine largeur (${geo[0].w}, ${geo[1].w} px sur ${vw}), alertes par deux, Stock dormant pleine largeur`)
  const valueOverflow = await mk.locator(':scope > *').first().evaluate(el => el.scrollWidth > el.clientWidth + 1)
  ok(!valueOverflow, 'téléphone : le montant de la valeur du stock ne déborde pas de sa carte')
  const mOpp = m.page.locator('section[aria-label="Priorités stock"]')
  await mOpp.waitFor({ timeout: 10000 })
  const btnW = await mOpp.getByRole('button').first().evaluate(b => Math.round(b.getBoundingClientRect().width))
  ok(btnW > 300 && btnW < 390, `téléphone : lignes de priorité sur toute la largeur de la section (${btnW} px)`)
  await mOpp.scrollIntoViewIfNeeded()
  await m.page.screenshot({ path: SCR + '/stock-overview-v2-phone.png' })
  await m.browser.close()

  console.log(`\n=== ${pass} OK / ${fail} echecs ===`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
