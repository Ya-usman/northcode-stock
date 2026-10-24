// Stock › Vue d'ensemble — passe de finition. LECTURE SEULE (écritures bloquées par capture.js).
// Les cas « plus de 3 priorités » et « indicateur à zéro » sont obtenus en modifiant la réponse
// « produits » DANS CE NAVIGATEUR seulement : rien n'est écrit en base.
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const num = s => parseInt(String(s).replace(/[^\d-]/g, ''), 10)

// Texte réellement visible (sans les mentions réservées aux lecteurs d'écran)
const visibleText = loc => loc.evaluate(el => { const c = el.cloneNode(true); c.querySelectorAll('.sr-only').forEach(n => n.remove()); return c.innerText.replace(/\s+/g, ' ').trim() })

async function open({ width = 1280, height = 900, locale = 'fr', shop = null, email = null, tweak = null, expiringLot = false }) {
  if (email) process.env.CAPTURE_EMAIL = email; else delete process.env.CAPTURE_EMAIL
  const s = await session({ width, height, scale: 1, locale })
  if (shop) await s.page.addInitScript(id => { try { localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } catch {} }, shop)
  // Lot qui expire bientôt ajouté DANS CE NAVIGATEUR seulement (réponse des lots datés de la Vue d'ensemble) :
  // les données réelles n'en ont aucun, la priorité « Expirent bientôt » doit pourtant être vérifiée
  if (expiringLot) {
    await s.page.route(/\/rest\/v1\/product_batches\?/, async route => {
      if (route.request().method() !== 'GET' || !decodeURIComponent(route.request().url()).includes('products(category_id)')) return route.fallback()
      const res = await route.fetch()
      let body = await res.text()
      try {
        const j = JSON.parse(body)
        if (Array.isArray(j) && j.length) {
          const d = new Date(Date.now() + 2 * 864e5)
          const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          body = JSON.stringify([...j, { ...j[0], expiry_date: day }])
        }
      } catch {}
      return route.fulfill({ response: res, body })
    })
  }
  if (tweak) {
    await s.page.route(/\/rest\/v1\/products\?/, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const res = await route.fetch()
      let body = await res.text()
      try { const j = JSON.parse(body); if (Array.isArray(j)) body = JSON.stringify(tweak(j)) } catch {}
      return route.fulfill({ response: res, body })
    })
  }
  await s.page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('[data-testid=stock-priorities]').waitFor({ timeout: 40000 })
  // Les signaux (ventes 30 j, lots, réservations) arrivent après les produits : chiffres stables
  let last = ''
  for (let i = 0; i < 40; i++) {
    const now = await s.page.locator('main').innerText()
    if (now === last && i > 6) break
    last = now; await s.page.waitForTimeout(500)
  }
  return s
}
const kpi = async (page, id) => ({
  value: num(await page.locator(`[data-kpi=${id}] [data-kpi-value]`).innerText()),
  tone: await page.locator(`[data-kpi=${id}]`).getAttribute('data-tone'),
  chevron: await page.locator(`[data-kpi=${id}] [data-kpi-chevron]`).count(),
  hint: await page.locator(`[data-kpi=${id}] [data-kpi-hint]`).count() ? await page.locator(`[data-kpi=${id}] [data-kpi-hint]`).innerText() : '',
  tag: await page.locator(`[data-kpi=${id}]`).evaluate(e => e.tagName),
})
const rows = page => page.locator('[data-testid=stock-priorities] [data-priority]').evaluateAll(els => els.map(e => e.getAttribute('data-priority')))

;(async () => {
  // ── 1. Français, ordinateur, toutes les boutiques ────────────────────────────────────────────
  console.log('\n1. Ordinateur, fr, toutes les boutiques')
  let s = await open({})
  let page = s.page
  const main = page.locator('main')
  const prio = page.locator('[data-testid=stock-priorities]')
  const mainText = await visibleText(main)
  ok(/Priorités stock/.test(mainText) && /Actions recommandées selon l’état de votre stock/.test(mainText), 'section « Priorités stock » · « Actions recommandées selon l’état de votre stock »')
  ok(!/Opportunit/i.test(mainText), '« Opportunités » n’apparaît plus')
  ok(!/\(s\)/.test(mainText), `aucun « (s) » à l’écran`)
  const kpiText = await visibleText(page.locator('section[aria-label="Chiffres clés"]'))
  ok(!/Voir les produits/.test(kpiText), `cartes : plus de « Voir les produits » répété (« ${kpiText.slice(0, 90)}… »)`)
  const k = {}
  for (const id of ['value', 'products', 'out', 'low', 'expired_lots', 'expiring', 'dormant']) k[id] = await kpi(page, id)
  ok(['products', 'out', 'low', 'expired_lots', 'expiring', 'dormant'].every(id => k[id].tag === 'BUTTON' && k[id].chevron === 1), 'cartes ouvrables : un chevron discret chacune, carte entière cliquable')
  ok(k.value.tag === 'DIV' && k.value.chevron === 0 && /prix d’achat/.test(k.value.hint), 'Valeur du stock : pas ouvrable, pas de chevron, « au prix d’achat » conservé')
  ok(k.dormant.value > 0 && /immobilisés/.test(k.dormant.hint) && k.dormant.tone === 'blue', `Stock dormant ${k.dormant.value} : montant immobilisé conservé (« ${k.dormant.hint} »)`)
  const toneOf = (v, tone) => (v > 0 ? tone : 'neutral')
  ok(k.out.value > 0 && k.out.tone === 'red' && k.low.value > 0 && k.low.tone === 'amber' && k.expired_lots.tone === toneOf(k.expired_lots.value, 'red') && k.expiring.tone === toneOf(k.expiring.value, 'orange'),
    `alertes en couleur seulement si actives : ruptures ${k.out.value}, stock bas ${k.low.value}, lots périmés ${k.expired_lots.value}, lots qui expirent ${k.expiring.value}`)
  const accName = await page.locator('[data-kpi=out]').evaluate(e => e.innerText.replace(/\s+/g, ' ').trim())
  ok(/Ruptures/.test(accName) && /Voir les produits/.test(accName), `lecteur d’écran : « ${accName} »`)
  // Structure (179) : Valeur + Produits, quatre alertes, puis Stock dormant sur toute la ligne
  const geo = await page.locator('section[aria-label="Chiffres clés"] > *').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
  ok(geo.length === 7 && geo[0] === geo[1] && geo[2] === geo[5] && geo[1] !== geo[2] && geo[6] > geo[5], 'structure : Valeur + Produits, puis quatre alertes, puis Stock dormant')
  const order = await main.locator('section').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  ok(order.join(' → ') === 'Chiffres clés → Stock à venir → Priorités stock', `ordre des zones : ${order.join(' → ')}`)
  // Priorités = chiffres des cartes, ordre 179 : lots périmés, ruptures, stock bas, expirent bientôt, dormant
  const base = [['expired_lots', k.expired_lots.value], ['out', k.out.value], ['low', k.low.value], ['expiring', k.expiring.value], ['dormant', k.dormant.value]].filter(([, n]) => n > 0).map(([id]) => id)
  const prioText = await visibleText(prio)
  let r = await rows(page)
  ok(r.join(',') === base.slice(0, 3).join(','), `priorités affichées, par ordre d’importance : ${r.join(' › ')}`)
  const exp = prioText.match(/(\d+) lots? périmés? à traiter/), outRow = prioText.match(/(\d+) produits? en rupture/), lowRow = prioText.match(/(\d+) produits? en stock bas/)
  ok((!r.includes('expired_lots') || (exp && num(exp[1]) === k.expired_lots.value)) && (!r.includes('out') || (outRow && num(outRow[1]) === k.out.value)) && (!r.includes('low') || (lowRow && num(lowRow[1]) === k.low.value)),
    `« ${exp?.[0]} », « ${outRow?.[0]} », « ${lowRow?.[0]} » = cartes`)
  ok(!/à réapprovisionner/.test(prioText), 'ruptures et stock bas : deux priorités distinctes (plus de « à réapprovisionner »)')
  ok(base.length <= 3 || await page.locator('[data-testid=stock-priorities-toggle]').count() === 1, 'plus de 3 priorités : « Voir toutes les priorités » proposé')
  // Lots périmés : ni promotion ni « vendre / écouler » conseillé
  const expiredPrio = r.includes('expired_lots') ? await visibleText(page.locator('[data-priority=expired_lots]')) : ''
  // Conseil de vente / promotion interdit (« ne sont plus vendables » est l'inverse d'un conseil : accepté)
  ok(r.includes('expired_lots') && !/promo|vendez|mettez[- ]les en vente|à vendre|écoul|solde|remise/i.test(expiredPrio), `priorité « lots périmés » sans promotion ni vente (« ${expiredPrio} »)`)
  ok(!/Voir (les produits|les lots|et commander)/.test(prioText), 'priorités : plus de bouton répété, la ligne entière s’ouvre')
  ok(await prio.locator('[data-priority] svg').count() >= r.length * 2, 'chaque ligne : son icône et un chevron')
  // Contexte de boutique
  const ctx = page.locator('[data-testid=overview-shop-context]')
  ok(await ctx.count() === 1 && (await ctx.innerText()).trim() === 'Toutes les boutiques', `contexte rappelé : « ${(await ctx.innerText()).trim()} »`)
  ok(await main.locator('button[role=combobox], select').count() === 0, 'aucun filtre ni sélecteur de boutique ajouté dans la page')
  ok(await ctx.evaluate(e => !e.closest('button, a') && !e.querySelector('button, a')), 'le rappel est un simple texte, pas un contrôle')
  // Ouverture
  if (r.includes('expired_lots')) {
    await page.locator('[data-priority=expired_lots]').click()
    await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 20000 })
    const trig = page.locator('button[role="combobox"]').filter({ hasText: /^Périm/ })
    await trig.first().waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForFunction(() => !location.search, null, { timeout: 10000 }).catch(() => {})
    ok(await trig.count() === 1 && !new URL(page.url()).search, 'priorité « lots périmés à traiter » → Lots & péremptions, exactement un filtre « Périmé », URL nettoyée')
    await page.goBack({ waitUntil: 'domcontentloaded' })
  }
  await page.locator('[data-priority=out]').waitFor({ timeout: 30000 })
  await page.locator('[data-priority=out]').click()
  await page.waitForURL(/\/fr\/stock\/products/, { timeout: 20000 })
  const trigR = page.getByTestId('filter-status').filter({ hasText: /Rupture/ })
  await trigR.first().waitFor({ timeout: 15000 }).catch(() => {})
  ok(await trigR.count() === 1, 'priorité « ruptures » → Produits, exactement un filtre « Rupture »')
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-kpi=low]').waitFor({ timeout: 30000 })
  await page.locator('[data-kpi=low]').click()
  await page.waitForURL(/\/fr\/stock\/products/, { timeout: 20000 })
  // Dans Produits, ce filtre s'appelle « Stock faible » (libellé existant, non touché ici)
  const trigL = page.getByTestId('filter-status').filter({ hasText: /Stock faible/ })
  await trigL.first().waitFor({ timeout: 15000 }).catch(() => {})
  ok(await trigL.count() === 1, 'carte « Stock bas » → Produits, exactement un filtre « Stock faible »')
  await s.browser.close()

  // ── 2. Plus de trois priorités ──────────────────────────────────────────────────────────────
  console.log('\n2. Toutes les priorités (promotions et un lot qui expire bientôt simulés dans le navigateur)')
  const until = new Date(Date.now() + 5 * 864e5).toISOString()
  s = await open({ tweak: list => list.map((p, i) => (i < 8 ? { ...p, promo_price: Math.max(1, Math.round((p.selling_price || 100) * 0.8)), promo_until: until, promo_start: null, promo_reason: 'expiry' } : p)), expiringLot: true })
  page = s.page
  const k2 = {}
  for (const id of ['out', 'low', 'expired_lots', 'expiring', 'dormant']) k2[id] = await kpi(page, id)
  const base2 = [['expired_lots', k2.expired_lots.value], ['out', k2.out.value], ['low', k2.low.value], ['expiring', k2.expiring.value], ['dormant', k2.dormant.value]].filter(([, n]) => n > 0).map(([id]) => id)
  ok(k2.expiring.value === k.expiring.value + 1 && k2.expiring.tone === 'orange', `lot simulé : carte « Expirent bientôt » ${k.expiring.value} → ${k2.expiring.value}, en couleur`)
  const toggle = page.locator('[data-testid=stock-priorities-toggle]')
  r = await rows(page)
  ok(r.length === 3 && r.join(',') === base2.slice(0, 3).join(','), `Vue d’ensemble : 3 priorités seulement (${r.join(' › ')})`)
  ok(await toggle.count() === 1 && (await toggle.innerText()).trim() === 'Voir toutes les priorités' && await toggle.getAttribute('aria-expanded') === 'false', '« Voir toutes les priorités » proposé')
  const tb = await toggle.boundingBox()
  await toggle.click()
  r = await rows(page)
  // Les promotions viennent APRÈS les cinq priorités de stock (jamais avant un lot périmé à traiter)
  ok(base2.includes('expiring') && base2.includes('dormant') && r.join(',') === [...base2, 'promo_stale', 'promo'].join(','), `dépliées sur place, sans nouvel écran : ${r.join(' › ')}`)
  ok((await toggle.innerText()).trim() === 'Afficher moins' && await toggle.getAttribute('aria-expanded') === 'true' && /\/fr\/stock$/.test(new URL(page.url()).pathname), '« Afficher moins », même page')
  const t2 = await visibleText(page.locator('[data-testid=stock-priorities]'))
  // Textes des priorités non visibles par défaut : nombres EXACTEMENT égaux aux cartes (toutes les lignes existent ici)
  const dormRow = t2.match(/(\d+) produits? sans vente/), expRow2 = t2.match(/(\d+) lots? expire(?:nt)? bientôt/)
  ok(!!dormRow && num(dormRow[1]) === k2.dormant.value, `priorité « Stock dormant » : « ${dormRow?.[0]} » = carte (${k2.dormant.value})`)
  ok(!!expRow2 && num(expRow2[1]) === k2.expiring.value, `priorité « Expirent bientôt » : « ${expRow2?.[0]} » = carte (${k2.expiring.value})`)
  ok(/\d+ promotions? à revoir/.test(t2) && /8 produits en promotion/.test(t2), `textes accordés : « ${t2.match(/\d+ promotions? à revoir/)?.[0]} », « 8 produits en promotion »`)
  await toggle.click()
  ok((await rows(page)).length === 3, 'repliées : retour à 3')
  ok(tb.height >= 48, `« Voir toutes les priorités » : ${Math.round(tb.height)} px de haut`)
  // Depuis la liste dépliée : « Expirent bientôt » → Lots & péremptions, filtre « Expire bientôt »
  await toggle.click()
  await page.locator('[data-priority=expiring]').click()
  await page.waitForURL(/\/fr\/stock\/expiry/, { timeout: 20000 })
  const trigE = page.locator('button[role="combobox"]').filter({ hasText: /^Expire bientôt$/ })
  await trigE.first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForFunction(() => !location.search, null, { timeout: 10000 }).catch(() => {})
  ok(await trigE.count() === 1 && !new URL(page.url()).search, 'priorité « Expirent bientôt » → Lots & péremptions, exactement un filtre « Expire bientôt », URL nettoyée')
  await s.browser.close()

  // ── 3. Indicateurs à zéro ───────────────────────────────────────────────────────────────────
  console.log('\n3. Indicateurs à zéro (stocks pleins simulés dans le navigateur)')
  s = await open({ tweak: list => list.map(p => ({ ...p, quantity: 99999 })) })
  page = s.page
  const z = { out: await kpi(page, 'out'), low: await kpi(page, 'low'), products: await kpi(page, 'products') }
  ok(z.out.value === 0 && z.low.value === 0, `ruptures ${z.out.value}, stock bas ${z.low.value}`)
  ok(z.out.tone === 'neutral' && z.low.tone === 'neutral', 'à zéro : apparence neutre, plus de couleur d’alerte')
  const look = id => page.locator(`[data-kpi=${id}]`).evaluate(e => { const c = getComputedStyle(e), v = getComputedStyle(e.querySelector('[data-kpi-value]')); return [c.borderTopColor, c.backgroundColor, v.color].join(' | ') })
  ok(await look('out') === await look('products') && await look('low') === await look('products'), `mêmes bordure, fond et chiffre que la carte « Produits » (${await look('out')})`)
  ok(z.out.tag === 'BUTTON' && z.out.chevron === 1, 'la carte reste à sa place et reste ouvrable')
  ok(!(await rows(page)).some(x => x === 'out' || x === 'low'), 'plus de priorité « ruptures » ni « stock bas » quand rien n’est à commander')
  await s.browser.close()

  // ── 4. Une seule boutique sélectionnée dans l'en-tête ───────────────────────────────────────
  console.log('\n4. Une boutique précise dans l’en-tête')
  s = await open({ shop: ALPHA, width: 390, height: 844 })
  page = s.page
  const c1 = (await page.locator('[data-testid=overview-shop-context]').innerText()).trim()
  ok(c1 === 'Boutique Alpha', `contexte rappelé : « ${c1} »`)
  await s.browser.close()

  // ── 5. Caissier (une boutique, sans prix d'achat) ───────────────────────────────────────────
  console.log('\n5. Caissier')
  s = await open({ email: 'stocshopci@gmail.com', width: 390, height: 844 })
  page = s.page
  const ct = await visibleText(page.locator('main'))
  ok(await page.locator('[data-kpi=value]').count() === 0 && !/immobilisés|F CFA|₦/.test(ct), 'ni valeur du stock ni montant immobilisé')
  ok(/Priorités stock/.test(ct) && !/\(s\)/.test(ct), 'priorités affichées, textes accordés')
  const nShopCtx = await page.locator('[data-testid=overview-shop-context]').count()
  console.log(`  info  rappel du contexte pour ce compte : ${nShopCtx ? '« ' + (await page.locator('[data-testid=overview-shop-context]').innerText()).trim() + ' »' : 'absent (une seule boutique)'}`)
  await s.browser.close()

  // ── 6. Tailles d'écran ──────────────────────────────────────────────────────────────────────
  console.log('\n6. Tailles d’écran')
  for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1024, 768], [1280, 900]]) {
    s = await open({ width, height })
    page = s.page
    const m = await page.evaluate(() => {
      const q = sel => [...document.querySelectorAll(sel)]
      const h = e => Math.round(e.getBoundingClientRect().height)
      const ctx = document.querySelector('[data-testid=overview-shop-context]')
      const title = ctx?.parentElement
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        cards: Math.min(...q('[data-kpi]').map(h)), rows: Math.min(...q('[data-priority]').map(h)),
        rowMax: Math.max(...q('[data-priority]').map(h)),
        prio: h(document.querySelector('[data-testid=stock-priorities]')),
        ctxFits: !!ctx && !!title && ctx.getBoundingClientRect().right <= title.getBoundingClientRect().right + 1 && h(title) <= 32,
        page: document.documentElement.scrollHeight,
        clipped: q('[data-kpi]').filter(e => e.scrollWidth > e.clientWidth + 1).length,
        // Le chiffre ne passe pas sous l'icône, le libellé ne passe pas sous le chevron
        covered: q('[data-kpi]').filter(e => {
          const v = e.querySelector('[data-kpi-value]'), icon = v.nextElementSibling, c = e.querySelector('[data-kpi-chevron]'), label = c?.previousElementSibling
          const textRight = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right }
          return textRight(v) > icon.getBoundingClientRect().left + 1 || (c && textRight(label) > c.getBoundingClientRect().left + 1)
        }).map(e => e.getAttribute('data-kpi')),
      }
    })
    ok(m.overflow <= 0 && m.clipped === 0, `${width} px : pas de défilement horizontal, aucune carte qui déborde`)
    ok(m.covered.length === 0, `${width} px : aucun chiffre sous une icône, aucun libellé sous un chevron${m.covered.length ? ' — ' + m.covered.join(', ') : ''}`)
    ok(m.cards >= 72 && m.rows >= 56, `${width} px : cartes ≥ ${m.cards} px, lignes de priorité ${m.rows}–${m.rowMax} px (zone de toucher confortable)`)
    ok(m.ctxFits, `${width} px : le rappel de boutique tient sur la ligne du titre`)
    console.log(`  info  ${width} px : section Priorités ${m.prio} px, page ${m.page} px`)
    await s.browser.close()
  }

  // ── 7. Anglais et haoussa ───────────────────────────────────────────────────────────────────
  console.log('\n7. Anglais et haoussa')
  const until2 = until
  for (const [locale, title, sub, all, less, one] of [
    ['en', 'Stock priorities', 'Recommended actions based on the state of your stock', 'View all priorities', 'Show less', /8 products on promotion/],
    ['ha', 'Muhimman ayyukan kaya', 'Shawarwarin ayyuka bisa halin kayanka', 'Duba dukkan muhimman ayyuka', 'Nuna kaɗan', /Kaya 8 a rangwame/],
  ]) {
    s = await open({ locale, width: 390, height: 844, tweak: list => list.map((p, i) => (i < 8 ? { ...p, promo_price: 1, promo_until: until2, promo_start: null, promo_reason: 'expiry' } : p)) })
    page = s.page
    const txt = await visibleText(page.locator('main'))
    ok(txt.includes(title) && txt.includes(sub), `${locale} : « ${title} » · « ${sub} »`)
    ok(!/\(s\)/.test(txt) && !/Opportunit|Priorités|Voir /.test(txt), `${locale} : aucun « (s) », aucun texte français`)
    const tg = page.locator('[data-testid=stock-priorities-toggle]')
    const a = (await tg.innerText()).trim()
    await tg.click()
    const b = (await tg.innerText()).trim()
    const full = await visibleText(page.locator('[data-testid=stock-priorities]'))
    ok(a === all && b === less && one.test(full), `${locale} : « ${a} » → « ${b} » ; « ${full.match(one)?.[0]} »`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale} : pas de défilement horizontal à 390 px`)
    await s.browser.close()
  }

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
