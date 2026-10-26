// Stock › Lots & péremptions — nouvel écran. LECTURE SEULE.
// Les statuts à tester (aujourd'hui, demain, bientôt, périmé, sans date, sain, avec promo, deux lots du
// même produit) sont obtenus en modifiant la réponse « lots » DANS CE NAVIGATEUR seulement ; les appels
// d'écriture sont interceptés et relus, jamais transmis à la base.
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OTHER_FALLBACK = 'b0000000-0000-4000-8000-000000000002'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const info = m => console.log('  info  ' + m)
const pad = n => String(n).padStart(2, '0')
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/
const MONEY = /F CFA|FCFA|₦|€/
const visibleText = loc => loc.evaluate(el => { const c = el.cloneNode(true); c.querySelectorAll('.sr-only').forEach(n => n.remove()); return c.innerText.replace(/\s+/g, ' ').trim() })

// ── Simulation ───────────────────────────────────────────────────────────────────────────────────
let sim = {}, raw = []
function simulate(list) {
  raw = list
  const L = list.map(b => ({ ...b, products: b.products ? { ...b.products, categories: b.products.categories ? { ...b.products.categories, expiry_alert_days: null } : null } : b.products }))
  if (L.length < 9) return L
  const other = L.find(b => b.shop_id !== L[0].shop_id)?.shop_id || OTHER_FALLBACK
  const fake = i => `00000000-0000-4000-8000-0000000000${pad(i)}`
  const set = (i, exp, extra = {}) => Object.assign(L[i], { expiry_date: exp, promo_price: null, promo_until: null, promo_start: null, ...(i ? { product_id: fake(i) } : {}) }, extra)
  sim = {
    today: set(0, day(0)), tomorrow: set(1, day(1)), soon: set(2, day(4)), expired: set(3, day(-3)), none: set(4, null),
    healthy: set(5, day(200), { shop_id: other }),
    promo: set(6, day(5), { promo_price: 1, promo_until: new Date(Date.now() + 5 * 864e5).toISOString() }),
  }
  sim.second = set(7, day(40), { product_id: sim.soon.product_id, shop_id: sim.soon.shop_id })
  sim.other = other
  return L
}
const allHealthy = list => list.map(b => ({ ...b, expiry_date: day(200) }))

async function open({ width = 1280, height = 900, locale = 'fr', shop = null, email = null, tweak = simulate, path = 'stock/expiry', conflictOnDelete = false } = {}) {
  if (email) process.env.CAPTURE_EMAIL = email; else delete process.env.CAPTURE_EMAIL
  const s = await session({ width, height, scale: 1, locale })
  s.calls = []; s.reads = 0; s.responses = []
  if (shop) await s.page.addInitScript(id => { try { localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } catch {} }, shop)
  await s.page.route(/\/rest\/v1\/product_batches\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    s.reads++
    // Navigateur fermé pendant une lecture en cours (fin de section) : rien à faire
    const res = await route.fetch().catch(() => null)
    if (!res) return
    let body = await res.text().catch(() => '')
    s.responses.push(body)
    if (tweak) { try { const j = JSON.parse(body); if (Array.isArray(j) && j.length && 'initial_quantity' in j[0]) body = JSON.stringify(tweak(j)) } catch {} }
    return route.fulfill({ response: res, body }).catch(() => {})
  })
  // Écritures : relues, jamais transmises
  await s.page.route(/\/api\/(product-batches|stock\/batch-treatments)/, async route => {
    const r = route.request()
    if (r.method() === 'GET') return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.calls.push({ method: r.method(), path: new URL(r.url()).pathname, body })
    if (conflictOnDelete && r.method() === 'DELETE') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Lot déjà vendu' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  })
  s.costCalls = 0
  s.page.on('request', r => { if (/\/api\/costs/.test(r.url())) s.costCalls++ })
  await s.page.goto(`${BASE}/${locale}/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('main [data-lot], [data-testid=lots-empty]').first().waitFor({ timeout: 45000 }).catch(() => {})
  await s.page.waitForTimeout(2500)
  return s
}
const lot = (page, b) => page.locator(`main [data-lot="${b.id}"]`)
const rowsInfo = page => page.locator('main [data-lot]').evaluateAll(els => els.map(e => ({
  id: e.getAttribute('data-lot'), status: e.getAttribute('data-status'),
  countdown: e.querySelector('[data-lot-countdown]')?.innerText.trim() || '', date: e.querySelector('[data-lot-date]')?.innerText.trim() || '',
  name: e.querySelector('[data-lot-name]')?.innerText.trim() || '', label: e.querySelector('[data-lot-label]')?.innerText.trim() || '',
  badge: e.querySelector('[data-lot-status]')?.innerText.trim() || '',
})))
const RANK = { expired: 0, expiring: 1, ok: 2, none: 3 }
const pickStatus = async (page, name) => { await page.locator('[data-testid=lots-status]').click(); await page.getByRole('option', { name, exact: true }).click(); await page.waitForTimeout(500) }
const openLot = async (page, b) => {
  const el = lot(page, b)
  // Au milieu de l'écran : jamais sous l'en-tête fixe ni sous la barre du bas
  await el.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForTimeout(300)
  await el.locator('[data-lot-label]').click()
  await page.locator('[data-testid=lot-detail]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
}
// Après une action enregistrée depuis le détail, la première touche Échap est absorbée (le focus est revenu sur la page) : on insiste
const closeDetail = async page => {
  for (let i = 0; i < 3 && await page.locator('[data-testid=lot-detail]').count(); i++) {
    await page.keyboard.press('Escape')
    await page.locator('[data-testid=lot-detail]').waitFor({ state: 'detached', timeout: 2500 }).catch(() => {})
  }
  await page.waitForTimeout(300)
}
const has = (page, testId) => page.locator(`[data-testid=${testId}]`).count().then(n => n > 0)

;(async () => {
  // ── 1. Ordinateur, propriétaire, toutes les boutiques ────────────────────────────────────────
  console.log('\n1. Ordinateur (1280 px), fr, propriétaire, toutes les boutiques')
  let s = await open({})
  let page = s.page
  const main = page.locator('main')
  ok(Object.keys(sim).length >= 8, `lots simulés dans le navigateur : ${raw.length} lots réels lus, 8 mis en scène`)
  let mainText = await visibleText(main)
  ok((mainText.match(/Lots & péremptions/g) || []).length === 1 && await page.locator('main h1.sr-only').count() === 1, 'le titre n’est plus répété dans le contenu (il reste dans l’en-tête et l’onglet)')
  ok(mainText.includes('Suivez vos lots et anticipez les péremptions.'), 'description : « Suivez vos lots et anticipez les péremptions. »')
  ok(await page.locator('[data-testid=lots-search]').getAttribute('placeholder') === 'Rechercher un produit ou un lot…', 'un seul champ : « Rechercher un produit ou un lot… »')
  const combos = await main.locator('button[role=combobox]').evaluateAll(els => els.map(e => e.innerText.trim()))
  ok(combos.length === 2 && combos[0] === 'Catégorie' && combos[1] === 'Statut', `filtres : ${combos.join(' · ')} — aucun filtre Boutique`)
  await page.locator('[data-testid=lots-more-actions]').click()
  const exportItems = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  await page.keyboard.press('Escape')
  ok(exportItems.join(' / ') === 'Exporter en Excel / Exporter en CSV / Exporter en PDF', `menu « … » : ${exportItems.join(' / ')}`)
  ok(await page.locator('[data-testid=lots-more-actions]').getAttribute('aria-label') === 'Plus d’actions' && await page.locator('[data-testid=lots-more-actions]').getAttribute('title') === 'Plus d’actions', 'bouton « … » : nom accessible et info-bulle « Plus d’actions »')
  const heads = (await page.locator('main table thead th').allInnerTexts()).map(x => x.trim()).filter(Boolean)
  ok(heads.join(' | ') === 'Produit | Lot | Péremption | Quantité restante | Statut | Plus d’actions', `colonnes : ${heads.join(' | ')}`)
  ok(!MONEY.test(await page.locator('[data-testid=lots-table]').innerText()), 'tableau : ni valeur ni catégorie en colonne, aucun montant')
  let rows = await rowsInfo(page)
  const ranks = rows.map(r => RANK[r.status])
  ok(ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), `ordre : périmés (${ranks.filter(r => r === 0).length}) › expire bientôt (${ranks.filter(r => r === 1).length}) › sains (${ranks.filter(r => r === 2).length}) › sans date (${ranks.filter(r => r === 3).length})`)
  const soonRows = rows.filter(r => r.status === 'expiring')
  ok(soonRows.findIndex(r => r.id === sim.today.id) < soonRows.findIndex(r => r.id === sim.tomorrow.id) && soonRows.findIndex(r => r.id === sim.tomorrow.id) < soonRows.findIndex(r => r.id === sim.soon.id), '« expire bientôt » du plus urgent au moins urgent : aujourd’hui › demain › dans 4 jours')
  const by = id => rows.find(r => r.id === id)
  ok(by(sim.today.id).countdown === 'Expire aujourd’hui' && by(sim.today.id).status === 'expiring', '« Expire aujourd’hui » — pas encore périmé')
  ok(by(sim.tomorrow.id).countdown === 'Expire demain', '« Expire demain »')
  ok(by(sim.soon.id).countdown === 'Expire dans 4 jours' && by(sim.soon.id).badge === 'Expire bientôt', '« Expire dans 4 jours » · statut « Expire bientôt »')
  ok(by(sim.expired.id).countdown === 'Périmé depuis 3 jours' && by(sim.expired.id).badge === 'Périmé', '« Périmé depuis 3 jours » · statut « Périmé »')
  ok(by(sim.healthy.id).countdown === 'Expire dans environ 7 mois' && by(sim.healthy.id).badge === 'Sain', '« Expire dans environ 7 mois » · statut « Sain »')
  ok(by(sim.none.id).countdown === '' && by(sim.none.id).date === '' && by(sim.none.id).badge === 'Sans date', 'lot sans date : aucun calcul, statut « Sans date »')
  const dated = rows.filter(r => r.date)
  ok(dated.length > 0 && dated.every(r => /\d{4}$/.test(r.date) && !EN_MONTH.test(r.date)), `date exacte en second, en français (« ${by(sim.soon.id).date} »), jamais de mois en anglais`)
  ok(rows.every(r => /^Lot du \d/.test(r.label) && !EN_MONTH.test(r.label)), `chaque lot désigné par sa date d’entrée (« ${rows[0].label} »)`)
  ok(new Set(rows.map(r => r.badge)).size <= 4 && rows.every(r => ['Périmé', 'Expire bientôt', 'Sain', 'Sans date'].includes(r.badge)), `statuts : ${[...new Set(rows.map(r => r.badge))].join(' · ')}`)
  ok((await page.locator('[data-testid=lots-count]').innerText()).trim() === `${rows.length} lots`, `compteur : « ${rows.length} lots »`)
  ok(await page.locator('main [data-lot-shop]').count() === rows.length, 'toutes les boutiques : la boutique de chaque lot est indiquée')
  ok(await has(page, 'expiry-total-at-risk'), 'propriétaire : « Valeur totale à risque » en bas, discrète')

  // Filtre Statut
  await page.locator('[data-testid=lots-status]').click()
  const options = (await page.getByRole('option').allInnerTexts()).map(x => x.trim())
  await page.keyboard.press('Escape')
  ok(options.join(' / ') === 'Tous / À traiter / Périmé / Expire bientôt / Sain / Sans date', `choix du filtre Statut : ${options.join(' / ')}`)
  await pickStatus(page, 'À traiter')
  let f = await rowsInfo(page)
  ok(f.length > 0 && f.every(r => r.status === 'expired' || r.status === 'expiring') && f.length === rows.filter(r => r.status === 'expired' || r.status === 'expiring').length, `« À traiter » : ${f.length} lots, périmés et « expire bientôt » seulement`)
  await pickStatus(page, 'Périmé')
  f = await rowsInfo(page)
  ok(f.length > 0 && f.every(r => r.status === 'expired'), `« Périmé » : ${f.length} lots`)
  await pickStatus(page, 'Sans date')
  f = await rowsInfo(page)
  ok(f.length > 0 && f.every(r => r.status === 'none') && (await page.locator('[data-testid=lots-count]').innerText()).trim() === `${f.length} lots`, `« Sans date » : ${f.length} lots, compteur accordé`)
  await page.locator('[data-testid=lots-reset]').click(); await page.waitForTimeout(400)
  ok((await rowsInfo(page)).length === rows.length, '« Réinitialiser » : tous les lots reviennent')

  // Recherche
  const search = page.locator('[data-testid=lots-search]')
  const type = async v => { await search.fill(v); await page.waitForTimeout(500); return rowsInfo(page) }
  const word = by(sim.today.id).name.split(/\s+/)[0]
  f = await type(word.toUpperCase())
  ok(f.length > 0 && f.every(r => r.name.toLowerCase().includes(word.toLowerCase())), `recherche par produit « ${word.toUpperCase()} » : ${f.length} lot(s), sans tenir compte de la casse`)
  const withSku = raw.find(b => b.products?.sku)
  if (withSku) { f = await type(withSku.products.sku); ok(f.some(r => r.id === withSku.id), `recherche par SKU / code-barres « ${withSku.products.sku} » : lot retrouvé`) } else info('aucun lot avec SKU dans ces données')
  const withSupplier = raw.find(b => b.suppliers?.name)
  if (withSupplier) { f = await type(withSupplier.suppliers.name); ok(f.some(r => r.id === withSupplier.id), `recherche par fournisseur « ${withSupplier.suppliers.name} » : lot retrouvé (${f.length})`) } else info('aucun lot avec fournisseur dans ces données')
  const dateWord = rows[0].label.replace(/^Lot du /, '').replace(/ \d{4}$/, '')
  f = await type(dateWord)
  ok(f.length > 0 && f.every(r => fold(r.label).includes(fold(dateWord)) || fold(r.name).includes(fold(dateWord))), `recherche par lot « ${dateWord} » : ${f.length} lot(s)`)
  f = await type('zzzqqq-introuvable')
  ok(f.length === 0 && /Aucun lot ne correspond à votre recherche\./.test(await page.locator('[data-testid=lots-empty]').innerText()), 'recherche sans résultat : « Aucun lot ne correspond à votre recherche. »')
  await type('')

  // Détail du lot
  await openLot(page, sim.soon)
  const d = page.locator('[data-testid=lot-detail]')
  let dt = (await d.innerText()).replace(/\s+/g, ' ')
  ok(/Lot du \d/.test(dt) && dt.includes(by(sim.soon.id).name) && dt.includes('Expire bientôt') && dt.includes('Expire dans 4 jours'), 'clic sur une zone neutre de la ligne → détail du lot : désignation, produit, statut, délai')
  const facts = ['lot-detail-quantity', 'lot-detail-remaining', 'lot-detail-initial', 'lot-detail-received', 'lot-detail-expiry', 'lot-detail-shop', 'lot-detail-origin']
  const present = []; for (const k of facts) present.push(await has(page, k))
  ok(present.every(Boolean), 'détail : quantité restante, quantité initiale, entrée, péremption, boutique, origine')
  ok(await has(page, 'lot-detail-value') && /prix d’achat/.test(dt), 'propriétaire : « Valeur du lot » dans le détail')
  ok(await d.locator('[data-hint=promo]').count() === 1 && /une promotion peut aider/.test(dt), 'lot qui expire bientôt, sans promo : suggestion discrète de promotion')
  ok(await has(page, 'lot-detail-fefo') && /sort en premier à la caisse/.test(dt), 'produit à deux lots : « Ce lot sort en premier à la caisse. »')
  ok(!/Voir (la réception|le bon de commande)/.test(dt), 'aucun bouton vers une réception ou un bon de commande (destination inexistante)')
  const btns = (await page.locator('[data-testid=lot-detail-actions] button').evaluateAll(els => els.map(e => e.innerText.trim() || e.getAttribute('aria-label'))))
  ok(btns.join(' / ') === 'Corriger la quantité / Voir le produit / Plus d’actions', `actions visibles : ${btns.join(' / ')}`)
  await page.locator('[data-testid=lot-detail-more]').click()
  const more = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  ok(more.join(' / ') === 'Modifier la date de péremption / Mettre en promo / Retirer du stock', `menu « … » du lot : ${more.join(' / ')}`)
  await closeDetail(page)

  await openLot(page, sim.second)
  ok(!(await has(page, 'lot-detail-fefo')), 'deuxième lot du même produit : pas de mention « sort en premier »')
  await closeDetail(page)
  await openLot(page, sim.expired)
  dt = (await d.innerText()).replace(/\s+/g, ' ')
  ok(await d.locator('[data-hint=expired]').count() === 1 && /ne compte plus dans le stock disponible/.test(dt) && await d.locator('[data-hint=promo]').count() === 0, 'lot périmé : « il ne compte plus dans le stock disponible » + « Retirer du stock »')
  await closeDetail(page)
  await openLot(page, sim.none)
  dt = (await d.innerText()).replace(/\s+/g, ' ')
  ok((dt.match(/Sans date de péremption/g) || []).length >= 1 && !/Expire dans|Périmé depuis|NaN|Invalid/.test(dt), 'lot sans date : « Sans date de péremption », aucun calcul')
  await closeDetail(page)
  await openLot(page, sim.promo)
  dt = (await d.innerText()).replace(/\s+/g, ' ')
  ok(await has(page, 'lot-detail-promo') && /Promotion en cours/.test(dt) && /jusqu’au \d/.test(dt) && await d.locator('[data-hint=promo]').count() === 0, 'lot en promo : « Promotion en cours … jusqu’au … », pas de suggestion en double')
  await closeDetail(page)
  ok(await lot(page, sim.promo).locator('button', { hasText: /promo/i }).count() === 0 && !/Promo/.test(await lot(page, sim.promo).innerText()), 'liste : aucun bouton ni badge Promo sur les lignes')

  // Contexte conservé
  await pickStatus(page, 'Sans date')
  const undated = await rowsInfo(page)
  const far = { id: undated[Math.min(undated.length - 1, 14)].id }
  await lot(page, far).evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(500)
  const before = { y: await page.evaluate(() => Math.round(window.scrollY)), reads: s.reads, n: undated.length }
  await openLot(page, far); await closeDetail(page)
  const after = { y: await page.evaluate(() => Math.round(window.scrollY)), reads: s.reads, n: (await rowsInfo(page)).length, status: (await page.locator('[data-testid=lots-status]').innerText()).trim() }
  ok(after.status === 'Sans date' && after.n === before.n && before.y > 100 && Math.abs(after.y - before.y) <= 2 && after.reads === before.reads, `fermeture du détail : filtre « ${after.status} », ${after.n} lots, défilement ${before.y} → ${after.y} px, aucun rechargement (${after.reads - before.reads} lecture)`)
  await page.locator('[data-testid=lots-reset]').click(); await page.waitForTimeout(400)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))

  // Menu de ligne : n'ouvre pas le détail
  await lot(page, sim.today).locator('[data-lot-menu]').click(); await page.waitForTimeout(400)
  const rowMenu = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  ok(rowMenu.join(' / ') === 'Corriger la quantité / Modifier la date de péremption / Mettre en promo / Retirer du stock' && !(await has(page, 'lot-detail')), `menu « … » de la ligne : ${rowMenu.join(' / ')} — sans ouvrir le détail`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // Actions : la boutique envoyée est celle DU LOT
  await openLot(page, sim.healthy)
  await page.locator('[data-testid=lot-detail-adjust]').click()
  await page.locator('#batch-adjust-qty').fill('7')
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1200)
  let c = s.calls.at(-1)
  ok(c && c.method === 'PATCH' && c.path === '/api/product-batches/adjust' && c.body.id === sim.healthy.id && c.body.shop_id === sim.other && c.body.new_quantity === 7 && c.body.reason_code === 'counting_error', `corriger la quantité → ${c?.method} ${c?.path} · boutique du lot (${c?.body.shop_id === sim.other ? 'autre boutique que l’Alpha' : c?.body.shop_id}) · 7 · motif « erreur de comptage » (défaut depuis la 179)`)
  if (!(await has(page, 'lot-detail'))) await openLot(page, sim.healthy)
  await page.locator('[data-testid=lot-detail-more]').click()
  await page.getByRole('menuitem', { name: 'Modifier la date de péremption' }).click()
  await page.locator('#batch-expiry-date').fill(day(30))
  // Depuis la 179 (appliquée), toute date modifiée garde sa raison : champ obligatoire quand il est affiché
  if (await page.locator('#batch-expiry-note').count()) await page.locator('#batch-expiry-note').fill('Test lots-ux — date corrigée (interceptée)')
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1200)
  c = s.calls.at(-1)
  ok(c && c.path === '/api/product-batches/expiry' && c.body.shop_id === sim.other && c.body.expiry_date === day(30), `modifier la date → ${c?.path} · boutique du lot · ${c?.body.expiry_date}`)
  if (!(await has(page, 'lot-detail'))) await openLot(page, sim.healthy)
  await page.locator('[data-testid=lot-detail-more]').click()
  await page.getByRole('menuitem', { name: 'Mettre en promo' }).click()
  await page.locator('[data-testid=batch-promo-dialog]').waitFor({ timeout: 10000 })
  await page.locator('#batch-promo-price').fill('50')
  await page.locator('#batch-promo-until').fill(day(6))
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1200)
  c = s.calls.at(-1)
  ok(c && c.path === '/api/product-batches/promo' && c.body.shop_id === sim.other && c.body.promo_price === 50 && !!c.body.promo_until, `mettre en promo → ${c?.path} · boutique du lot · prix 50 · fin ${String(c?.body.promo_until).slice(0, 10)}`)
  if (await has(page, 'lot-detail')) await closeDetail(page)

  // Voir le produit
  await openLot(page, sim.today)
  await page.locator('[data-testid=lot-detail-product-action]').click()
  const sheet = await page.locator('[data-testid=product-detail]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  ok(sheet, '« Voir le produit » → fiche produit (panneau existant)')
  await s.browser.close()

  // Lot PÉRIMÉ : depuis la 179 (appliquée), il se « traite » (destruction, retour fournisseur…) — l'ancien parcours
  // « Retirer du stock » (suppression, ou quantité ramenée à zéro) ne s'applique plus à lui. Envoi intercepté.
  s = await open({}); page = s.page
  await openLot(page, sim.expired)
  await page.locator('[data-testid=lot-detail] [data-hint=expired] button').click()
  const tr = page.getByTestId('batch-treatment-drawer'); await tr.waitFor({ timeout: 10000 })
  const firstAction = await tr.locator('input[name=batch-treatment-action]:checked').getAttribute('value').catch(() => null)
  const qtyShown = await tr.locator('#batch-treatment-qty').inputValue().catch(() => '')
  await tr.getByTestId('drawer-submit').click(); await page.waitForTimeout(1500)
  const tc = s.calls.filter(x => x.path === '/api/stock/batch-treatments').at(-1)
  ok(firstAction === 'dispose' && Number(qtyShown) === sim.expired.quantity,
    `lot périmé : « Traiter » ouvre le traitement, destruction proposée d'abord (${firstAction}), toute la quantité (${qtyShown})`)
  ok(tc && tc.method === 'POST' && tc.body.batch_id === sim.expired.id && tc.body.action === 'dispose' && tc.body.quantity === sim.expired.quantity && !!tc.body.request_id,
    `envoi : ${tc?.method} ${tc?.path} · lot ${tc?.body.batch_id === sim.expired.id ? 'du détail' : tc?.body.batch_id} · dispose · ${tc?.body.quantity} (intercepté)`)
  await s.browser.close()

  // ── 2. Téléphone ─────────────────────────────────────────────────────────────────────────────
  console.log('\n2. Téléphone')
  for (const [width, height] of [[360, 740], [390, 844]]) {
    s = await open({ width, height }); page = s.page
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('main [data-lot-card]')]
      const tb = n => document.querySelector(`[data-testid=${n}]`)?.getBoundingClientRect()
      return {
        table: document.querySelectorAll('main table').length, cards: cards.length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        clipped: cards.filter(c => c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll('[data-lot-countdown],[data-lot-date],[data-lot-qty],[data-lot-status]')].some(e => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1)).length,
        hMax: Math.max(...cards.map(c => Math.round(c.getBoundingClientRect().height))), hMin: Math.min(...cards.map(c => Math.round(c.getBoundingClientRect().height))),
        w: Math.round(cards[0].getBoundingClientRect().width), top: Math.round(cards[0].getBoundingClientRect().top + window.scrollY),
        toolbarTop: Math.round(tb('lots-toolbar').top + window.scrollY),
        touch: ['lots-search', 'lots-category', 'lots-status', 'lots-more-actions'].map(n => Math.round(tb(n).height)),
      }
    })
    ok(m.table === 0 && m.cards > 0 && m.overflow <= 0 && m.clipped === 0, `${width} px : ${m.cards} cartes, aucun tableau, pas de défilement horizontal, rien de coupé`)
    ok(m.hMax <= 150 && m.touch.every(h => h >= 48), `${width} px : cartes de ${m.hMin} à ${m.hMax} px ; recherche, filtres et « … » ≥ 48 px (${m.touch.join(', ')})`)
    info(`${width} px : la liste commence ${m.top - m.toolbarTop} px sous le haut de la barre (premier lot à ${m.top} px du haut de page)`)
    if (width === 390) {
      const card = (await lot(page, sim.soon).innerText()).replace(/\s+/g, ' ')
      ok(/Lot du \d/.test(card) && /Expire dans 4 jours/.test(card) && /\d{4}/.test(card) && /Expire bientôt/.test(card) && !MONEY.test(card), `carte : « ${card} »`)
      const cat = sim.soon.products?.categories?.name, sup = raw.find(b => b.suppliers?.name)?.suppliers.name
      const allCards = (await page.locator('[data-testid=lots-cards]').innerText())
      ok((!cat || !allCards.includes(cat) || rows.some(r => r.name.includes(cat))) && (!sup || !allCards.includes(sup)) && !MONEY.test(allCards), 'cartes : ni catégorie, ni fournisseur, ni valeur')
      const tr = await page.locator('main button[role=combobox]').evaluateAll(els => els.map(e => e.innerText.trim()))
      ok(tr.join(' · ') === 'Catégorie · Statut', `filtres au repos : ${tr.join(' · ')}`)
      await lot(page, sim.soon).click()
      await page.locator('[data-testid=lot-detail]').waitFor({ timeout: 15000 }); await page.waitForTimeout(600)
      const box = await page.locator('[data-testid=lot-detail]').boundingBox()
      ok(box.width >= 388 && await has(page, 'lot-detail-quantity'), `toucher la carte → détail plein écran (${Math.round(box.width)} px)`)
      await page.screenshot({ path: __dirname + '/out/shots-lots/apres-detail-390.png' })
      await closeDetail(page)
    }
    await s.browser.close()
  }
  s = await open({ width: 390, height: 844, shop: ALPHA }); page = s.page
  ok(await page.locator('main [data-lot]').count() > 0 && await page.locator('main [data-lot-shop]').count() === 0, 'boutique précise dans l’en-tête : uniquement ses lots, sans nom de boutique répété')
  await s.browser.close()

  // ── 3. Tablette ──────────────────────────────────────────────────────────────────────────────
  console.log('\n3. Tablette')
  for (const [width, height, cols] of [[768, 1024, 1], [1024, 768, 2]]) {
    s = await open({ width, height }); page = s.page
    const m = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('main [data-lot-card]')].slice(0, 12)
      return {
        table: document.querySelectorAll('main table').length, cols: new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size,
        w: Math.round(cards[0].getBoundingClientRect().width), overflow: document.documentElement.scrollWidth - window.innerWidth,
        search: Math.round(document.querySelector('[data-testid=lots-search]').getBoundingClientRect().width),
        clipped: cards.filter(c => [...c.querySelectorAll('[data-lot-countdown],[data-lot-date],[data-lot-qty],[data-lot-status]')].some(e => e.getBoundingClientRect().right > c.getBoundingClientRect().right + 1)).length,
        hMax: Math.max(...cards.map(c => Math.round(c.getBoundingClientRect().height))),
      }
    })
    ok(m.table === 0 && m.cols === cols && m.w >= 300 && m.overflow <= 0 && m.clipped === 0, `${width} px : cartes sur ${m.cols} colonne(s) de ${m.w} px, pas de tableau écrasé, rien de coupé`)
    // 768 px : recherche sur sa propre ligne ; 1024 px : sur la ligne des filtres, avec assez de place pour son texte
    ok(m.search >= (cols === 1 ? 400 : 260) && m.hMax <= 150, `${width} px : recherche de ${m.search} px, cartes ≤ ${m.hMax} px`)
    await s.browser.close()
  }

  // ── 4. Rôles ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n4. Rôles')
  s = await open({ email: 'cassierstock@gmail.com' }); page = s.page
  if (await page.locator('main [data-lot]').count()) {
    await openLot(page, sim.soon)
    ok(await has(page, 'lot-detail-adjust') && await has(page, 'lot-detail-more'), 'gérant (Stock en modification) : actions du lot proposées')
    info(`gérant : valeur du lot ${await has(page, 'lot-detail-value') ? 'affichée' : 'absente'} (règle canViewCost)`)
  } else info('gérant : aucun lot affiché')
  await s.browser.close()
  s = await open({ email: 'stocshopci@gmail.com' }); page = s.page
  const cashierLots = await page.locator('main [data-lot]').count()
  if (cashierLots) {
    ok(await page.locator('main [data-lot-menu]').count() === 0 && !(await has(page, 'expiry-total-at-risk')) && !MONEY.test(await main_(page)), 'caissier (Stock en lecture, sans prix d’achat) : pas de menu d’action, pas de total à risque, aucun montant')
    await openLot(page, sim.soon)
    const ct = (await page.locator('[data-testid=lot-detail]').innerText()).replace(/\s+/g, ' ')
    ok(!(await has(page, 'lot-detail-value')) && !(await has(page, 'lot-detail-adjust')) && !(await has(page, 'lot-detail-more')) && await page.locator('[data-testid=lot-detail] [data-hint=promo]').count() === 0 && !MONEY.test(ct), 'caissier : détail sans valeur, sans action de modification, sans suggestion de promo')
    ok(await has(page, 'lot-detail-remaining') && await has(page, 'lot-detail-expiry'), 'caissier : le détail reste consultable (quantité, péremption)')
  } else info('caissier : écran sans lot pour ce compte')
  ok(s.costCalls === 0 && s.responses.every(b => !/buying_price/.test(b)), `caissier : aucun prix d’achat demandé ni reçu (${s.responses.length} lecture(s) de lots, 0 appel aux coûts)`)
  await s.browser.close()

  // ── 5. Anglais et haoussa ────────────────────────────────────────────────────────────────────
  console.log('\n5. Anglais et haoussa')
  for (const [locale, W] of [
    ['en', { ph: 'Search for a product or batch…', sub: 'Track your batches and stay ahead of expiry dates.', today: 'Expires today', tomorrow: 'Expires tomorrow', soon: 'Expires in 4 days', expired: 'Expired 3 days ago', badges: ['Expired', 'Expiring soon', 'Good', 'No date'], lot: /^Batch of /, count: /^\d+ batches$/, attention: 'Needs attention' }],
    ['ha', { ph: 'Nemi kaya ko lodi…', sub: 'Bi lodin kayanka, ka riga ranar ƙarewarsu.', today: 'Zai ƙare yau', tomorrow: 'Zai ƙare gobe', soon: 'Zai ƙare cikin kwana 4', expired: 'Ya ƙare tun kwana 3', badges: ['Ya ƙare', 'Zai ƙare nan kusa', 'Lafiya', 'Babu kwanan wata'], lot: /^Lodin /, count: /^Lodi \d+$/, attention: 'Na bukatar kulawa' }],
  ]) {
    s = await open({ locale, width: 390, height: 844 }); page = s.page
    const r = await rowsInfo(page)
    const g = id => r.find(x => x.id === id)
    const txt = await visibleText(page.locator('main'))
    ok(await page.locator('[data-testid=lots-search]').getAttribute('placeholder') === W.ph && txt.includes(W.sub), `${locale} : « ${W.ph} » · « ${W.sub} »`)
    ok(g(sim.today.id).countdown === W.today && g(sim.tomorrow.id).countdown === W.tomorrow && g(sim.soon.id).countdown === W.soon && g(sim.expired.id).countdown === W.expired, `${locale} : ${W.today} · ${W.tomorrow} · ${W.soon} · ${W.expired}`)
    ok(r.every(x => W.badges.includes(x.badge)) && r.every(x => W.lot.test(x.label)) && W.count.test((await page.locator('[data-testid=lots-count]').innerText()).trim()), `${locale} : statuts ${[...new Set(r.map(x => x.badge))].join(' · ')} ; « ${r[0].label} » ; « ${(await page.locator('[data-testid=lots-count]').innerText()).trim()} »`)
    const cardsText = await page.locator('[data-testid=lots-cards]').innerText()
    ok(!/\(s\)/.test(txt) && !/Périmé|Expire |Lot du|Rechercher|Sans date/.test(txt) && (locale === 'en' || !EN_MONTH.test(cardsText.replace(/Sept?\b/g, ''))), `${locale} : aucun « (s) », aucun texte français${locale === 'ha' ? ', dates sans mois anglais ni français (« ' + g(sim.soon.id).date + ' »)' : ''}`)
    await page.locator('[data-testid=lots-status]').click()
    const opts = (await page.getByRole('option').allInnerTexts()).map(x => x.trim())
    await page.keyboard.press('Escape')
    ok(opts[1] === W.attention && opts.length === 6, `${locale} : filtre Statut — ${opts.join(' / ')}`)
    await lot(page, sim.soon).click()
    await page.locator('[data-testid=lot-detail]').waitFor({ timeout: 15000 }); await page.waitForTimeout(500)
    const dtx = (await page.locator('[data-testid=lot-detail]').innerText()).replace(/\s+/g, ' ')
    // (« Boutique Alpha » est un nom de boutique, pas un texte de l'écran)
    ok(!/Quantité|Péremption|Origine|Corriger|Voir le produit|Entré le|Ce lot|undefined|expiry\.|products\./.test(dtx) && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale} : détail du lot traduit, pas de défilement horizontal (« ${dtx.slice(0, 90)}… »)`)
    await s.browser.close()
  }

  // ── 6. Liens profonds et états vides ─────────────────────────────────────────────────────────
  console.log('\n6. Liens et états vides')
  s = await open({ path: 'stock/expiry?status=expired' }); page = s.page
  ok((await page.locator('[data-testid=lots-status]').innerText()).trim() === 'Périmé' && !new URL(page.url()).search && (await rowsInfo(page)).every(r => r.status === 'expired'), 'adresse ?status=expired : filtre « Périmé » posé, adresse nettoyée')
  await s.browser.close()
  s = await open({ path: 'stock/expiry?status=attention', tweak: allHealthy }); page = s.page
  const e1 = page.locator('[data-testid=lots-empty]')
  ok(await e1.count() === 1 && await e1.getAttribute('data-good') === 'true' && /Tout va bien : aucun lot périmé ni proche de la péremption\./.test(await e1.innerText()), 'aucun problème de péremption : « Tout va bien : aucun lot périmé ni proche de la péremption. » (message positif)')
  await pickStatus(page, 'Périmé')
  ok(/Bonne nouvelle : aucun lot périmé\./.test(await page.locator('[data-testid=lots-empty]').innerText()), '« Bonne nouvelle : aucun lot périmé. »')
  await pickStatus(page, 'Expire bientôt')
  ok(/Bonne nouvelle : aucun lot proche de la péremption\./.test(await page.locator('[data-testid=lots-empty]').innerText()), '« Bonne nouvelle : aucun lot proche de la péremption. »')
  await s.browser.close()
  s = await open({ tweak: () => [] }); page = s.page
  ok(/Aucun lot en stock\./.test(await page.locator('[data-testid=lots-empty]').innerText().catch(() => '')) && !(await has(page, 'lots-more-actions')) && !(await has(page, 'lots-count')), 'aucun lot : « Aucun lot en stock. », sans compteur ni menu d’export')
  await s.browser.close()

  // ── 7. Échap, focus et couches ───────────────────────────────────────────────────────────────
  console.log('\n7. Échap, focus et couches')
  s = await open({}); page = s.page
  const layers = () => page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role=dialog]').length,
    overlays: [...document.querySelectorAll('div.fixed.inset-0')].filter(e => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
    bodyLocked: document.body.style.pointerEvents === 'none',
    toasts: document.querySelectorAll('li[data-state=open]').length,
    focusInDetail: !!document.activeElement?.closest('[data-testid=lot-detail]'),
  }))
  await openLot(page, sim.soon)
  await page.locator('[data-testid=lot-detail-adjust]').click()
  await page.locator('#batch-adjust-qty').fill('3')
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(900)
  let L = await layers()
  ok(L.toasts >= 1 && L.focusInDetail, `après une action enregistrée : message affiché, focus revenu dans le détail (${L.toasts} message)`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)
  L = await layers()
  ok(!(await has(page, 'lot-detail')) && L.dialogs === 0 && L.overlays === 0 && !L.bodyLocked, `UN seul Échap ferme le détail (message affiché ou non) : aucun panneau ni voile restant, page cliquable`)
  await lot(page, sim.today).locator('[data-lot-label]').click()
  ok(await page.locator('[data-testid=lot-detail]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'la page reste utilisable : un autre lot s’ouvre aussitôt')
  // Fenêtre ouverte par le menu « … » du détail, puis annulée
  await page.locator('[data-testid=lot-detail-more]').click()
  await page.getByRole('menuitem', { name: 'Modifier la date de péremption' }).click()
  await page.locator('#batch-expiry-date').waitFor({ timeout: 10000 })
  await page.keyboard.press('Escape'); await page.waitForTimeout(700)
  L = await layers()
  ok(await has(page, 'lot-detail') && L.dialogs === 1 && L.focusInDetail, 'Échap dans la fenêtre « Modifier la date » : seule la fenêtre se ferme, focus revenu dans le détail')
  // Menu ouvert dans le détail
  await page.locator('[data-testid=lot-detail-more]').click(); await page.waitForTimeout(300)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  ok(await has(page, 'lot-detail') && await page.getByRole('menu').count() === 0, 'Échap avec le menu « … » ouvert : seul le menu se ferme')
  // Panneau ouvert depuis le détail (fiche produit)
  await page.locator('[data-testid=lot-detail-product-action]').click()
  await page.locator('[data-testid=product-detail]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800)
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)
  L = await layers()
  ok(!(await has(page, 'product-detail')) && await has(page, 'lot-detail') && L.focusInDetail, 'fiche produit ouverte depuis le lot : Échap ne ferme qu’elle, le détail du lot reste avec le focus')
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)
  L = await layers()
  ok(!(await has(page, 'lot-detail')) && L.dialogs === 0 && L.overlays === 0 && !L.bodyLocked, 'Échap suivant : le détail se ferme, plus aucune couche')
  await s.browser.close()

  // ── 8. Terme haoussa ─────────────────────────────────────────────────────────────────────────
  console.log('\n8. Terme haoussa « lodi »')
  s = await open({ locale: 'ha', width: 1280, height: 900 }); page = s.page
  const tab = (await page.locator('main [role=tablist], main nav').first().innerText()).replace(/\s+/g, ' ')
  const header = (await page.locator('header h1').first().innerText()).trim()
  const all = await visibleText(page.locator('main'))
  ok(/Lodi & ƙarewa/.test(tab) && header === 'Lodi & ƙarewa' && !/Rukuni & ƙarewa/.test(all + header), `onglet et en-tête : « ${header} » (plus « Rukuni & ƙarewa »)`)
  const headsHa = (await page.locator('main table thead th').allInnerTexts()).map(x => x.trim()).filter(Boolean)
  ok(headsHa.includes('Lodi') && (await rowsInfo(page)).every(r => /^Lodin /.test(r.label)), `colonne « Lodi », lots désignés « ${(await rowsInfo(page))[0].label} »`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })

function fold(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }
function main_(page) { return page.locator('main').innerText() }
