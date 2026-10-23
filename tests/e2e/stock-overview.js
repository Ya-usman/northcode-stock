// Étape 2 — Vue d'ensemble, sur le build de production, lecture seule :
// six KPI principaux (Promo n'en fait plus partie), valeur immobilisée du
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
  const labels = ['Valeur du stock', 'Produits', 'Ruptures', 'Stock bas', 'Péremptions proches', 'Stock dormant']
  const kpiText = (await kpiSection.innerText()).replace(/\s+/g, ' ')
  ok(labels.every(l => kpiText.includes(l)), `six KPI : ${labels.join(' · ')}`)
  ok(!/Promo/.test(kpiText), 'Promo n’est plus un KPI principal')
  ok((await kpiSection.locator('button, div.rounded-xl').count()) >= 6, 'six cartes rendues')
  // Le stock dormant arrive avec les ventes 30 j : on attend le chiffre final
  let dormant = { value: 0, txt: '' }
  for (let i = 0; i < 100; i++) { dormant = await kpiValue(page, 'Stock dormant'); if (dormant.value > 0) break; await page.waitForTimeout(100) }
  ok(dormant.value > 0 && /immobilisés/.test(dormant.txt), `KPI Stock dormant : ${dormant.value}, avec valeur immobilisée (« ${dormant.txt.slice(0, 70)} »)`)
  // Ruptures et stock bas tiennent compte des lots périmés et des réservations, chargés à part : chiffres stables
  let out = -1, low = -1
  for (let i = 0; i < 60; i++) { const o2 = (await kpiValue(page, 'Ruptures')).value, l2 = (await kpiValue(page, 'Stock bas')).value; const same = o2 === out && l2 === low; out = o2; low = l2; if (same && i >= 8) break; await page.waitForTimeout(250) }
  const expiring = (await kpiValue(page, 'Péremptions proches')).value
  const total = (await kpiValue(page, 'Produits')).value
  ok(total > 0 && out >= 0 && low >= 0 && expiring >= 0, `KPI : produits ${total}, ruptures ${out}, stock bas ${low}, péremptions ${expiring}`)
  // Ordinateur : le montant tient sur une ligne, sans déborder ; deux rangées (2 larges + 4)
  const dk = await kpiSection.locator(':scope > *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const p = e.querySelector('p'); return { top: Math.round(r.top), w: Math.round(r.width), overflow: e.scrollWidth > e.clientWidth + 1, valueH: p ? Math.round(p.getBoundingClientRect().height) : 0 } }))
  ok(!dk[0].overflow && dk[0].valueH <= 32, `ordinateur : montant de la valeur sur une ligne (hauteur ${dk[0].valueH} px, largeur de carte ${dk[0].w} px)`)
  ok(dk[0].top === dk[1].top && dk[2].top === dk[5].top && dk[1].top !== dk[2].top, `ordinateur : deux rangées (Valeur + Produits, puis quatre alertes)`)

  // ── Opportunités ─────────────────────────────────────────────────────────
  const opp = page.locator('section[aria-label="Priorités stock"]')
  await opp.waitFor({ timeout: 10000 })
  const oppText = (await opp.innerText()).replace(/\s+/g, ' ')
  ok(/Actions recommandées/.test(oppText), 'zone « Priorités stock » affichée')
  const reorderRow = oppText.match(/(\d+) produits? à réapprovisionner/)
  ok(!!reorderRow && num(reorderRow[1]) === out + low, `opportunité réapprovisionnement = ruptures + stock bas (${reorderRow?.[1]} = ${out} + ${low})`)
  const dormantRow = oppText.match(/(\d+) produits? sans vente/)
  ok(!!dormantRow && num(dormantRow[1]) === dormant.value, `opportunité ventes lentes = KPI (${dormantRow?.[1]})`)
  const expRow = oppText.match(/(\d+) produits? avec un lot/)
  ok(expiring === 0 ? !expRow : !!expRow && num(expRow[1]) === expiring, `opportunité péremption = KPI (${expRow?.[1] ?? 'absente'})`)
  ok(!/Rien à signaler/.test(oppText), 'pas d’état vide alors que des opportunités existent')
  await page.screenshot({ path: SCR + '/stock-overview-v2-desktop.png', fullPage: true })

  // ── Lien profond vers Lots & péremptions ─────────────────────────────────
  if (expRow) {
    await opp.locator('[data-priority=expiring]').click()
    await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 15000 })
    await page.waitForFunction(() => !location.search, null, { timeout: 10000 }).catch(() => {})
    const trig = page.locator('button[role="combobox"]').filter({ hasText: /^À traiter$/ })
    await trig.waitFor({ timeout: 10000 }).catch(() => {})
    ok(await trig.count() === 1 && !new URL(page.url()).search, 'Lots & péremptions ouvert avec le filtre « À traiter » (périmés + expire bientôt), URL nettoyée')
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await kpiSection.waitFor({ timeout: 20000 })
  }

  // ── KPI Péremptions proches → Produits filtrés ──────────────────────────
  await page.locator('section[aria-label="Chiffres clés"] button').filter({ hasText: 'Péremptions proches' }).click()
  await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 15000 })
  const trigP = page.locator('button[role="combobox"]').filter({ hasText: /^À traiter$/ })
  await trigP.waitFor({ timeout: 10000 }).catch(() => {})
  ok(await trigP.count() === 1, 'KPI Péremptions proches → Lots & péremptions avec le filtre « À traiter »')
  await browser.close()

  // ── Téléphone ────────────────────────────────────────────────────────────
  const m = await openPage({ width: 390, height: 844, blockServiceWorkers: true })
  await m.page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded' })
  const mk = m.page.locator('section[aria-label="Chiffres clés"]')
  await mk.waitFor({ timeout: 20000 })
  const geo = await mk.locator(':scope > *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) } }))
  const vw = await m.page.evaluate(() => window.innerWidth)
  // Valeur et Produits sur toute la largeur (montant long lisible), alertes par deux
  ok(geo.length >= 6 && geo[0].w > vw * 0.8 && geo[1].w > vw * 0.8 && geo[2].top === geo[3].top && geo[4].top === geo[5].top,
    `téléphone : Valeur et Produits pleine largeur (${geo[0].w}, ${geo[1].w} px sur ${vw}), alertes par deux`)
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
