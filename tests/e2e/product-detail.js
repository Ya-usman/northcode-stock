// Étape 6 — fiche détail produit, de bout en bout sur la compilation locale.
// Boutique Alpha (compte d'essai), MODE ÉCRITURE explicite (lib/write-mode.js) : de VRAIES réservations d'essai sont
// créées (référence unique par exécution) puis seules celles de CETTE exécution sont supprimées, une à une, avec les
// entrées de journal qu'elles ont produites ; aucune vente, aucun réassort, aucune modification de produit.
// Mise à jour (23 oct. 2026) — ancienne hypothèse : on pouvait effacer TOUTES les réservations d'Alpha. Réel : jamais
// de suppression large.
// Marché Soleil : LECTURE SEULE (deux lectures de la fiche pour vérifier « en transit » / « en commande »).
// Usage : CAPTURE_BASE=http://localhost:3000 node product-detail.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const { enableWrite } = require('./lib/write-mode.js')
let W = null, RUN = null
const REFS = new Set()   // références créées par l'appareil pendant cette exécution
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const CASHIER = 'stocshopci@gmail.com' // caissier d'Alpha : Stock en consultation, droit de vendre, ni transferts ni fournisseurs
const MSG = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8'))
const V = __dirname + '/out/vitrine/'
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : '→ ' + String(extra).slice(0, 500)) }
// Lignes de réservation d'Alpha NOUVELLES depuis le début de l'exécution (les lignes préexistantes sont ignorées)
const rowsOf = async () => ((await admin.from('stock_reservations').select('id, product_id, quantity, source_ref, label').eq('shop_id', ALPHA)).data || []).filter(r => !W.before.stock_reservations.has(r.id))

async function open(locale, width, height, { email, allowReservations = false, shop = ALPHA } = {}) {
  if (email) process.env.CAPTURE_EMAIL = email; else delete process.env.CAPTURE_EMAIL
  const s = await session({ width, height, scale: 1, locale, write: allowReservations ? W : null })
  // Mise à jour (23 oct. 2026) : depuis 965fbc8, un compte à plusieurs boutiques démarre en « Toutes » (la caisse demande
  // alors la boutique) ; l'en-tête est fixé sur la boutique du test au premier chargement de l'onglet
  await s.page.context().addInitScript(id => { try { if (!sessionStorage.getItem('__pin')) { sessionStorage.setItem('__pin', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, shop)
  await s.page.context().addInitScript(([id]) => { try { localStorage.setItem('active_shop_id', id); localStorage.setItem('stock_table_columns', JSON.stringify(['physical', 'reserved'])) } catch {} }, [shop])
  return s
}
const get = (page, path) => page.evaluate(async p => { const r = await fetch(p); let j = null, text = ''; try { text = await r.text(); j = JSON.parse(text) } catch {} return { status: r.status, json: j, text } }, path)
const api = (page, method, body, query = '') => page.evaluate(async ([m, b, q]) => { const r = await fetch('/api/stock/reservations' + q, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, json: j } }, [method, body, query])
const goto = async (page, path, ms = 7000) => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(ms) }
const drawer = page => page.locator('[data-testid="product-detail"]')
const qty = async (page, key) => (await drawer(page).locator(`[data-qty="${key}"]`).first().innerText()).replace(/\s+/g, ' ').trim()
const findProduct = async (page, locale, name) => { await page.getByLabel(MSG(locale).products.search_placeholder).first().fill(name); await page.waitForTimeout(1200) }
const openFiche = async (page, name) => { await page.locator('[data-product-name]', { hasText: name }).first().click(); await drawer(page).waitFor({ timeout: 15000 }); await drawer(page).locator('[data-testid="product-detail-quantities"]').waitFor({ timeout: 20000 }) }
// Échap ferme d'abord un éventuel message (« Réservation libérée »), puis la fiche
const tableRow = (page, name) => page.evaluate(nm => {
  const table = document.querySelector('main table'); if (!table) return null
  const heads = [...table.querySelectorAll('thead th')].map(th => th.innerText.replace(/\s+/g, ' ').trim())
  const tr = [...table.querySelectorAll('tbody tr')].find(x => [...x.querySelectorAll('[data-product-name]')].some(p => p.innerText.trim() === nm)); if (!tr) return null
  const o = { __restock: !!tr.querySelector('button[title="Réapprovisionner"]') }; [...tr.querySelectorAll('td')].forEach((td, i) => { o[heads[i] || '#' + i] = td.innerText.replace(/\s+/g, ' ').trim() }); return o
}, name)
const closeFiche = async page => { for (let i = 0; i < 4 && (await drawer(page).count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(700) } }

;(async () => {
  W = await enableWrite({ test: 'product-detail', routes: [/\/api\/stock\/reservations(\?|$)/] })
  RUN = W.RUN
  console.log('Base :', BASE)
  if (W.before.stock_reservations.size) console.log(`Réservations déjà présentes sur Alpha : ${W.before.stock_reservations.size} — ignorées et jamais touchées.`)
  const today = new Date().toISOString().slice(0, 10)
  const sales0 = (await admin.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const moves0 = (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const { data: prods } = await admin.from('products').select('id, name, quantity, buying_price, selling_price, unit, supplier_id').eq('shop_id', ALPHA).eq('is_active', true).order('name')
  const stock0 = JSON.stringify(prods.map(p => [p.id, p.quantity, p.buying_price]))
  const { data: expiredLots } = await admin.from('product_batches').select('product_id, quantity').eq('shop_id', ALPHA).gt('quantity', 0).lt('expiry_date', today)
  const expiredOf = id => Math.min(prods.find(p => p.id === id).quantity, (expiredLots || []).filter(b => b.product_id === id).reduce((n, b) => n + Number(b.quantity), 0))
  const names = prods.map(p => p.name)
  const unique = p => names.filter(n => n.includes(p.name)).length === 1
  // P : un produit avec des lots périmés ET du stock ; Q : un produit sain très stocké (couverture « plus d'un an »)
  const P = prods.find(p => unique(p) && expiredOf(p.id) > 0 && p.quantity - expiredOf(p.id) >= 10 && Number(p.buying_price) > 0)
  const Q = prods.find(p => p.name === 'Aspirateur Roweta') || prods.find(p => unique(p) && p.id !== P.id && p.quantity > 300)
  const E = expiredOf(P.id)
  console.log(`Produit P « ${P.name} » : ${P.quantity} en rayon, ${E} périmés, coût ${P.buying_price} · produit Q « ${Q.name} » : ${Q.quantity} en rayon · ${sales0} ventes, ${moves0} mouvements`)
  const detailPath = (shop, id) => `/api/stock/product-detail?shop_id=${shop}&product_id=${id}&today=${today}`

  try {
    // ══ 1. Route de la fiche ═════════════════════════════════════════════════
    console.log('\n1. Route /api/stock/product-detail')
    const anon = await fetch(BASE + detailPath(ALPHA, P.id))
    check('sans connexion : refusé (401)', anon.status === 401, anon.status)

    const s = await open('fr', 1280, 900, { allowReservations: true })
    const page = s.page
    await goto(page, '/fr/stock/products', 7000)
    let r = await get(page, '/api/stock/product-detail?shop_id=abc&product_id=def')
    check('identifiants illisibles : refusé (400)', r.status === 400, r.status)
    const akwa = fs.readFileSync(V + 'akwa-id.txt', 'utf8').trim()
    r = await get(page, detailPath(akwa, P.id))
    check('boutique d’une autre entreprise : refusé (403)', r.status === 403, r.status)
    const { data: other } = await admin.from('products').select('id').neq('shop_id', ALPHA).limit(1)
    r = await get(page, detailPath(ALPHA, other[0].id))
    check('produit d’une autre boutique demandé sous Boutique Alpha : introuvable (404), rien n’est révélé', r.status === 404 && !/quantit|name/.test(r.text), r.status + ' ' + r.text.slice(0, 80))

    // Réservations d'essai : 5 pour « Table 3 », 2 sans nom
    const p1 = await api(page, 'PUT', { shop_id: ALPHA, source_ref: `${RUN}_fiche_1`, label: 'Table 3', items: [{ product_id: P.id, quantity: 5 }, { product_id: Q.id, quantity: 4 }] })
    const p2 = await api(page, 'PUT', { shop_id: ALPHA, source_ref: `${RUN}_fiche_2`, items: [{ product_id: P.id, quantity: 2 }] })
    check('réservations d’essai posées (5 « Table 3 » + 2 sans nom sur P, 4 sur Q)', p1.status === 200 && p2.status === 200 && (await rowsOf()).length === 3)

    r = await get(page, detailPath(ALPHA, P.id))
    const d = r.json || {}
    const expect = { physical: P.quantity, expired: E, reserved: 7, available: P.quantity - E - 7 }
    check(`propriétaire · quantités : physique ${expect.physical}, périmé ${expect.expired}, réservé 7, disponible ${expect.available} (= ${P.quantity} − ${E} − 7, recalculé à part depuis la base)`,
      r.status === 200 && ['physical', 'expired', 'reserved', 'available'].every(k => d.quantities?.[k] === expect[k]), JSON.stringify(d.quantities))
    check('statut calculé par le serveur avec la règle de la liste : « ' + d.status + ' »', d.status === (expect.available === 0 ? 'out' : expect.available <= 10 ? 'low' : 'ok') || d.status === 'dormant', d.status)
    check('le disponible ne contient ni le périmé ni le réservé', d.quantities.available + d.quantities.expired + d.quantities.reserved === d.quantities.physical)
    check('propriétaire · en transit et en commande : un nombre (information visible), jamais « null »', Number.isInteger(d.quantities.inTransit) && Number.isInteger(d.quantities.onOrder), JSON.stringify(d.quantities))
    check('réservations : 2 lignes, nom de la facture, quantité, auteur, échéance', d.reservations?.length === 2 && d.reservations[0].label === 'Table 3' && d.reservations[0].quantity === 5 && d.reservations[1].label === null && d.reservations[1].quantity === 2 && !!d.reservations[0].created_by_name && !!d.reservations[0].expires_at, JSON.stringify(d.reservations))
    check('propriétaire · achat : coût et valeur du stock (physique × coût)', d.permissions?.cost === true && d.purchase?.buying_price === Number(P.buying_price) && d.purchase?.stock_value === P.quantity * Number(P.buying_price), JSON.stringify(d.purchase))
    // Ventes 30 j : comparées à un calcul de référence indépendant
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: refItems } = await admin.from('sale_items').select('quantity, sales!inner(shop_id, sale_status, created_at)').eq('product_id', P.id).eq('sales.shop_id', ALPHA).eq('sales.sale_status', 'active').gte('sales.created_at', since).limit(5000)
    const refSold = (refItems || []).reduce((n, i) => n + Number(i.quantity), 0)
    check(`ventes 30 j : ${refSold} (identique au calcul de référence)`, d.sales?.sold30d === refSold, d.sales?.sold30d)
    const cov = d.sales.coverage, sellable = P.quantity - E
    const covOk = refSold === 0 ? cov.kind === 'no_sales' : Math.round(sellable / (refSold / 30)) > 365 ? cov.kind === 'over_year' : cov.kind === 'days' && cov.days === Math.round(sellable / (refSold / 30))
    check(`couverture cohérente avec ${sellable} vendables et ${refSold} vendus : ${JSON.stringify(cov)}`, covOk)
    const rq = (await get(page, detailPath(ALPHA, Q.id))).json
    check(`produit très stocké (« ${Q.name} », ${rq.sales.sold30d} vendus) : « ${rq.sales.coverage.kind} », aucun chiffre absurde`, ['over_year', 'no_sales'].includes(rq.sales.coverage.kind) || (rq.sales.coverage.kind === 'days' && rq.sales.coverage.days <= 365), JSON.stringify(rq.sales))

    // Caissier : Stock en consultation seulement
    const c = await open('fr', 1280, 900, { email: CASHIER, allowReservations: true })
    await goto(c.page, '/fr/stock/products', 7000)
    const rc = await get(c.page, detailPath(ALPHA, P.id))
    const dc = rc.json || {}
    check('caissier · mêmes quantités que le propriétaire', rc.status === 200 && ['physical', 'expired', 'reserved', 'available'].every(k => dc.quantities?.[k] === expect[k]), JSON.stringify(dc.quantities))
    check('caissier · AUCUN prix d’achat dans la réponse du serveur (ni coût, ni valeur, ni fournisseur, ni prix comparés)', dc.purchase === null && dc.permissions?.cost === false && !/buying_price|stock_value|supplier/.test(rc.text), rc.text.slice(0, 200))
    check('caissier · en transit / en commande : null (non visible avec ce rôle), pas un faux zéro', dc.quantities?.inTransit === null && dc.quantities?.onOrder === null, JSON.stringify(dc.quantities))
    check('caissier · peut libérer (il a le droit de vendre) : règle de la route existante', dc.permissions?.release === true)
    check('caissier · même statut que le propriétaire (' + dc.status + ')', dc.status === d.status, `${dc.status} / ${d.status}`)

    // Mouvements filtrés par produit
    const mv = await get(page, `/api/stock/movements?shop_ids=${ALPHA}&product_id=${P.id}&limit=10`)
    const refMoves = (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA).eq('product_id', P.id)).count
    check(`mouvements : ${Math.min(10, refMoves)} au plus, tous du produit, du plus récent au plus ancien (${refMoves} en base)`, mv.status === 200 && mv.json.movements.length === Math.min(10, refMoves) && mv.json.movements.every(m => m.product_id === P.id) && mv.json.movements.every((m, i, a) => i === 0 || a[i - 1].created_at >= m.created_at), mv.json?.movements?.length)
    check('mouvements : produit illisible → refusé (400)', (await get(page, `/api/stock/movements?shop_ids=${ALPHA}&product_id=xyz`)).status === 400)

    // ── Liste vue par le caissier : avant la correction, « Ventes 30 j » valait 0 et tout était « Ventes lentes » ──
    await findProduct(page, 'fr', P.name); await findProduct(c.page, 'fr', P.name)
    const ownerRow = await tableRow(page, P.name), cashierRow = await tableRow(c.page, P.name)
    check('liste · caissier : « Ventes 30 j » = ' + refSold + ', comme le propriétaire (le serveur lit toutes les ventes de la boutique)', !!cashierRow && cashierRow['Ventes 30 j'] === String(refSold) && ownerRow['Ventes 30 j'] === String(refSold), JSON.stringify([ownerRow && ownerRow['Ventes 30 j'], cashierRow && cashierRow['Ventes 30 j']]))
    check('liste · caissier : même statut que le propriétaire (« ' + (ownerRow && ownerRow['Statut']) + ' »), plus de « Ventes lentes » à tort', !!cashierRow && cashierRow['Statut'] === ownerRow['Statut'] && (refSold === 0 || !/Ventes lentes/.test(cashierRow['Statut'])), JSON.stringify([ownerRow && ownerRow['Statut'], cashierRow && cashierRow['Statut']]))
    check('liste · bouton « Réapprovisionner » : présent pour le propriétaire, absent pour le caissier (Stock en consultation)', ownerRow.__restock === true && cashierRow.__restock === false, JSON.stringify([ownerRow.__restock, cashierRow.__restock]))
    const soldAnon = await fetch(BASE + '/api/stock/sold-30d?shop_ids=' + ALPHA)
    const soldOther = await get(page, '/api/stock/sold-30d?shop_ids=' + akwa)
    check('ventes 30 j · sans connexion : 401 ; boutique d’une autre entreprise : 403', soldAnon.status === 401 && soldOther.status === 403, soldAnon.status + ' / ' + soldOther.status)

    // ══ 2. Écran, propriétaire ═══════════════════════════════════════════════
    console.log('\n2. Fiche à l’écran — propriétaire, ordinateur')
    await findProduct(page, 'fr', P.name)
    await openFiche(page, P.name)
    const txt = async () => (await drawer(page).innerText()).replace(/\s+/g, ' ')
    let t = await txt()
    check('le clic sur le NOM ouvre la fiche, en haut', t.includes('FICHE PRODUIT') || /Fiche produit/i.test(t), t.slice(0, 120))
    check(`quantités affichées = celles du serveur : disponible ${expect.available}, physique ${P.quantity}, périmé ${E}, réservé 7`,
      (await qty(page, 'available')).includes(String(expect.available)) && (await qty(page, 'physical')).endsWith(String(P.quantity)) && (await qty(page, 'expired')).endsWith(String(E)) && (await qty(page, 'reserved')).endsWith('7'),
      [await qty(page, 'available'), await qty(page, 'physical'), await qty(page, 'expired'), await qty(page, 'reserved')].join(' | '))
    check('règle rappelée : « Disponible = Physique − Périmé − Réservé »', t.includes('Disponible = Physique − Périmé − Réservé'))
    check('réservations : « Table 3 » 5 et « Facture sans nom » 2, avec échéance', /Table 3 5 /.test(t) && /Facture sans nom 2 /.test(t) && /jusqu’au/.test(t), (t.match(/Réservations.{0,260}/) || [''])[0])
    check('section Lots présente (composant commun), avec le coût du lot pour le propriétaire', (await drawer(page).locator('[data-testid="batches-list"]').count()) === 1 && /Coût/.test(await drawer(page).locator('[data-testid="batches-list"]').innerText()))
    check('ventes et couverture affichées', /Vendus sur 30 jours/.test(t) && /Couverture/.test(t) && !/NaN|Infinity|undefined/.test(t))
    const moveItems = await drawer(page).locator('[data-testid="movement-list"] li').count()
    check(`derniers mouvements : ${Math.min(10, refMoves)} lignes, lien « Tout voir »`, moveItems === Math.min(10, refMoves) && (await drawer(page).locator('[data-testid="product-detail-all-movements"]').getAttribute('href')) === `/fr/stock/movements?product=${P.id}&all=1`, moveItems)
    const reasonsFr = await drawer(page).locator('[data-testid="movement-list"] li').evaluateAll(els => els.map(li => [li.querySelector('[data-movement-label]'), li.querySelector('[data-movement-detail]')].filter(Boolean).map(e => e.innerText.trim()).join(' ')))
    check('motifs des mouvements en français : « ' + (reasonsFr[0] || '') + ' » (plus de « Sale … »)', reasonsFr.length > 0 && !reasonsFr.some(x => /^Sale |Restock/.test(x)) && reasonsFr.some(x => /^Vente /.test(x)), reasonsFr.join(' | '))
    check('section Achat : coût, valeur du stock, fournisseur principal', (await drawer(page).locator('[data-testid="product-detail-purchase"]').count()) === 1 && /Achat/.test(t) && /Fournisseur principal/.test(t))
    const actions = (await drawer(page).locator('[data-testid="product-detail-actions"]').innerText()).replace(/\s+/g, ' ')
    check('actions du pied (propriétaire) : Réapprovisionner, Modifier, Mettre en promo, Archiver', ['Réapprovisionner', 'Modifier', 'Mettre en promo', 'Archiver'].every(a => actions.includes(a)), actions)
    check('aucune section d’une étape future (valorisation détaillée, variantes, conditionnements, emplacements)', !/Valorisation|Variantes|Conditionnement|Emplacement/i.test(t))
    check('l’ancien panneau « Lots » séparé n’existe plus', (await page.locator('[data-testid="batches-drawer"]').count()) === 0)
    await page.screenshot({ path: `${__dirname}/out/product-detail-fr-1280.png` })

    // Libération : confirmation obligatoire
    console.log('\n3. Libérer une réservation')
    const audit0 = (await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA).eq('action', 'stock.reservation_released')).count
    await drawer(page).locator('[data-testid="product-detail-reservations"] li', { hasText: 'Table 3' }).getByRole('button', { name: 'Libérer' }).click()
    const modal = page.locator('[role="dialog"]').filter({ hasText: 'Libérer cette réservation ?' })
    await modal.waitFor({ timeout: 5000 })
    const mt = (await modal.innerText()).replace(/\s+/g, ' ')
    check('confirmation : quantité (5), produit et facture (« Table 3 ») nommés', mt.includes('5 ') && mt.includes(`« ${P.name} »`) && mt.includes('« Table 3 »'), mt)
    check('confirmation : la facture reste en attente, action inscrite au journal, bouton « Libérer 5 »', /facture reste en attente/.test(mt) && /inscrite au journal/.test(mt) && /Libérer 5/.test(mt), mt)
    check('rien n’est libéré tant que la confirmation n’est pas donnée', (await rowsOf()).length === 3)
    await modal.getByRole('button', { name: /Annuler/ }).click(); await page.waitForTimeout(500)
    check('« Annuler » : la réservation est intacte', (await rowsOf()).length === 3 && /Table 3 5 /.test(await txt()))
    await drawer(page).locator('[data-testid="product-detail-reservations"] li', { hasText: 'Table 3' }).getByRole('button', { name: 'Libérer' }).click()
    const [del] = await Promise.all([
      page.waitForResponse(x => x.url().includes('/api/stock/reservations') && x.request().method() === 'DELETE', { timeout: 15000 }),
      page.locator('[role="dialog"]').filter({ hasText: 'Libérer cette réservation ?' }).getByRole('button', { name: /Libérer 5/ }).click(),
    ])
    await page.waitForTimeout(2500)
    let rows = await rowsOf()
    check('confirmée : seule la ligne « Table 3 » de CE produit est retirée (la ligne de Q dans la même facture reste)', del.status() === 200 && rows.length === 2 && !rows.some(x => x.source_ref === `${RUN}_fiche_1` && x.product_id === P.id) && rows.some(x => x.source_ref === `${RUN}_fiche_1` && x.product_id === Q.id), JSON.stringify(rows.map(x => [x.source_ref, x.quantity])))
    t = await txt()
    check(`la fiche se met à jour : réservé 2, disponible ${P.quantity - E - 2}, « Table 3 » disparue`, (await qty(page, 'reserved')).endsWith('2') && (await qty(page, 'available')).includes(String(P.quantity - E - 2)) && !/Table 3/.test(t), [await qty(page, 'reserved'), await qty(page, 'available')].join(' | '))
    const { data: audits } = await admin.from('audit_logs').select('action, actor_email, target_id, target_type, metadata, created_at').eq('shop_id', ALPHA).eq('action', 'stock.reservation_released').order('created_at', { ascending: false }).limit(1)
    const a = audits?.[0]
    check('journal d’audit : une entrée — qui, quel produit, 5, « Table 3 »', (await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA).eq('action', 'stock.reservation_released')).count === audit0 + 1 && a?.actor_email === 'admin@northcode.ng' && a?.target_id === P.id && a?.metadata?.quantity === 5 && a?.metadata?.label === 'Table 3' && a?.metadata?.product_name === P.name && a?.metadata?.source_ref === `${RUN}_fiche_1`, JSON.stringify(a))
    const again = await api(page, 'DELETE', null, `?shop_id=${ALPHA}&source_ref=${RUN}_fiche_1&product_id=${P.id}`)
    check('libérer une ligne déjà libérée : sans erreur, rien de libéré, aucune nouvelle entrée au journal', again.status === 200 && again.json.released.length === 0 && (await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA).eq('action', 'stock.reservation_released')).count === audit0 + 1)
    await closeFiche(page)
    await page.waitForTimeout(1500)
    const rowText = await page.evaluate(nm => { const b = [...document.querySelectorAll('main table [data-product-name]')].find(x => x.innerText.trim() === nm); return b ? b.closest('tr').innerText.replace(/\s+/g, ' ') : null }, P.name)
    check('fiche fermée : la ligne du tableau a suivi (« 2 réservés »)', !!rowText && rowText.includes('2 réservés') && rowText.includes(String(P.quantity - E - 2)), rowText)

    // Journal d'activité du Stock : l'entrée de la libération y est lisible
    await page.getByLabel(MSG('fr').products.search_placeholder).first().fill(''); await page.waitForTimeout(800)
    await page.locator('main').getByRole('button', { name: 'Plus d’actions' }).first().click()
    await page.getByRole('menuitem', { name: MSG('fr').products.activity_journal }).click()
    // « Toutes les boutiques » : le journal demande d'abord sa boutique (requireOneShop)
    if (await page.getByTestId('shop-picker').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) { await page.getByTestId('shop-picker').locator(`[data-shop-option="${ALPHA}"]`).click(); await page.waitForTimeout(800) }
    const journal = page.locator('[data-testid="journal-drawer"]'); await journal.waitFor({ timeout: 10000 })
    await journal.locator('[data-testid="journal-action"]').click()
    await page.getByRole('option', { name: 'Réservations libérées' }).click(); await page.waitForTimeout(2500)
    const entry = journal.locator('[data-testid="journal-entry"]').first()
    const et = (await entry.innerText().catch(() => '')).replace(/\s+/g, ' ')
    check('journal d’activité (filtre « Réservations libérées ») : « ' + P.name + ' — Réservation libérée : 5 — Table 3 »', et.includes(P.name) && et.includes('Réservation libérée : 5 — Table 3'), et)
    await entry.click(); await page.waitForTimeout(600)
    const jd = (await journal.locator('[data-testid="journal-detail"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    check('… détail : auteur, facture en attente « Table 3 », quantité 5', /Facture en attente Table 3/.test(jd) && /Quantité 5(\D|$)/.test(jd) && /Admin Owner|admin@northcode\.ng/.test(jd), jd)
    await journal.locator('[data-testid="journal-view-product"]').first().click()
    await drawer(page).locator('[data-testid="product-detail-quantities"]').waitFor({ timeout: 20000 })
    check('… « Voir le produit » ouvre la fiche du produit', (await drawer(page).innerText()).includes(P.name))
    for (let i = 0; i < 6 && (await page.locator('[role="dialog"]').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
    await findProduct(page, 'fr', P.name)

    // Icône Lots, photo, réassort, Tout voir
    console.log('\n4. Raccourcis et navigation')
    await page.locator('main table tbody tr', { hasText: P.name }).first().locator('button', { hasText: /périmé/ }).first().click()
    await drawer(page).locator('[data-testid="product-detail-quantities"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200)
    const pos = await page.evaluate(() => { const d = document.querySelector('[data-testid="product-detail"]'); const b = d.querySelector('[data-testid="product-detail-batches"]').getBoundingClientRect(); const body = d.querySelector('.overflow-y-auto'); const r = body.getBoundingClientRect(); return { top: Math.round(b.top - r.top), scroll: Math.round(body.scrollTop), h: Math.round(r.height) } })
    check('raccourci « Lots » (mention « N périmés ») : la fiche s’ouvre SUR la section Lots', pos.scroll > 50 && pos.top >= -5 && pos.top < pos.h / 2, JSON.stringify(pos))
    await closeFiche(page)
    await page.locator('main table tbody tr', { hasText: P.name }).first().locator('button[aria-label^="Ouvrir la fiche"]').first().click()
    await drawer(page).locator('[data-testid="product-detail-quantities"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800)
    check('le clic sur la PHOTO ouvre la fiche en haut', (await page.evaluate(() => document.querySelector('[data-testid="product-detail"] .overflow-y-auto').scrollTop)) === 0)
    await drawer(page).locator('[data-testid="product-detail-actions"]').getByRole('button', { name: 'Réapprovisionner' }).click(); await page.waitForTimeout(800)
    check('« Réapprovisionner » ouvre la fenêtre existante (annulée, aucune écriture)', (await page.locator('[role="dialog"]').filter({ has: page.locator('form') }).count()) >= 1)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    if (!(await drawer(page).count())) { await findProduct(page, 'fr', P.name); await openFiche(page, P.name) }
    await drawer(page).locator('[data-testid="product-detail-all-movements"]').click()
    await page.waitForURL(/\/fr\/stock\/movements\?product=/, { timeout: 20000 }); await page.waitForTimeout(5000)
    const chip = page.locator('[data-testid="movements-product-filter"]')
    const mainText = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    check('« Tout voir » : onglet Mouvements ouvert, filtre « Produit : ' + P.name + ' » visible', page.url().endsWith(`/fr/stock/movements?product=${P.id}`) && (await chip.count()) === 1 && (await chip.innerText()).replace(/\s+/g, ' ').includes(P.name), await chip.innerText().catch(() => ''))
    const listed = await page.locator('main [data-testid="movement-list"] li').count()
    check(`… et la liste ne contient que ce produit : ${Math.min(500, refMoves)} mouvements`, listed === Math.min(500, refMoves) && (await mainText()).includes(`${listed} mouvement`), listed)
    const typesShown = await page.evaluate(() => [...new Set([...document.querySelectorAll('main [data-testid="movement-list"] [data-movement-label]')].map(p => p.innerText.trim()))])
    check('tous les types enregistrés sont montrés (pas seulement les réapprovisionnements) : ' + typesShown.join(', '), typesShown.length >= 1 && typesShown.every(x => ['Vente', 'Retour en stock', 'Réapprovisionnement', 'Réception fournisseur', 'Stock initial', 'Correction de stock', "Ajustement d'inventaire", 'Perte', 'Produit endommagé', 'Expiration', 'Transfert envoyé', 'Transfert reçu'].includes(x)), typesShown.join(', '))
    await page.screenshot({ path: `${__dirname}/out/product-detail-movements-filtre.png` })
    await chip.getByRole('button', { name: 'Retirer le filtre produit' }).click(); await page.waitForTimeout(5000)
    const productsShown = new Set(await page.locator('main [data-movement-product]').allInnerTexts())
    check('filtre retiré d’un toucher : retour à TOUS les mouvements (' + productsShown.size + ' produits), « Tous » sélectionné, adresse sans produit', !/product=/.test(page.url()) && (await chip.count()) === 0 && productsShown.size > 1 && (await page.locator('main button[data-kind="all"]').getAttribute('aria-pressed')) === 'true', page.url() + ' ' + productsShown.size)
    await page.screenshot({ path: `${__dirname}/out/product-detail-movements.png` })

    // ══ 5. Caissier : pas de prix d'achat ════════════════════════════════════
    console.log('\n5. Fiche à l’écran — caissier (Stock en consultation)')
    const net = []
    c.page.on('response', async resp => { if (resp.url().includes('/api/stock/product-detail')) net.push(await resp.text().catch(() => '')) })
    await findProduct(c.page, 'fr', P.name)
    await openFiche(c.page, P.name)
    const ct = (await drawer(c.page).innerText()).replace(/\s+/g, ' ')
    check('caissier · aucune section Achat, aucun « Coût », aucune « Valeur du stock », aucun fournisseur', (await drawer(c.page).locator('[data-testid="product-detail-purchase"]').count()) === 0 && !/Achat|Coût|Valeur du stock|Fournisseur/.test(ct), (ct.match(/.{0,40}(Achat|Coût|Valeur du stock|Fournisseur).{0,40}/) || [''])[0])
    check('caissier · les lots sont visibles SANS leur coût', (await drawer(c.page).locator('[data-testid="batches-list"]').count()) === 1 && !/Coût/.test(await drawer(c.page).locator('[data-testid="batches-list"]').innerText()))
    check('caissier · la réponse reçue par son navigateur ne contient aucun prix d’achat', net.length >= 1 && net.every(b => !/buying_price|stock_value|supplier/.test(b)), net.length)
    check('caissier · en transit / en commande : « — » et mention « non visible avec votre rôle »', (await drawer(c.page).locator('[data-qty="inTransit"]').innerText()).trim() === '—' && (await drawer(c.page).locator('[data-qty="onOrder"]').innerText()).trim() === '—' && /non visible avec votre rôle/.test(ct))
    check('caissier · en-tête : le statut affiché est celui du serveur (« ' + dc.status + ' »), cohérent avec les ventes affichées', (await drawer(c.page).locator('[data-status]').getAttribute('data-status')) === dc.status, await drawer(c.page).locator('[data-status]').getAttribute('data-status'))
    check(`caissier · mêmes quantités : disponible ${P.quantity - E - 2}, réservé 2`, (await qty(c.page, 'available')).includes(String(P.quantity - E - 2)) && (await qty(c.page, 'reserved')).endsWith('2'))
    check('caissier · aucune action de modification dans le pied (ni réassort, ni modification, ni promo, ni archivage)', (await drawer(c.page).locator('[data-testid="product-detail-actions"]').count()) === 0)
    check('caissier · bouton « Libérer » présent (droit de vendre)', (await drawer(c.page).getByRole('button', { name: 'Libérer' }).count()) === 1)
    await c.page.screenshot({ path: `${__dirname}/out/product-detail-cashier.png` })
    await c.browser.close()

    // Sans le droit de vendre (réponse modifiée dans le navigateur seulement) : pas de bouton
    await page.route('**/api/stock/product-detail**', async route => { const res = await route.fetch(); const j = await res.json(); j.permissions.release = false; return route.fulfill({ response: res, body: JSON.stringify(j) }) })
    await goto(page, '/fr/stock/products', 6000); await findProduct(page, 'fr', P.name); await openFiche(page, P.name)
    check('sans le droit de vendre : la réservation est affichée, sans bouton « Libérer »', /Facture sans nom 2 /.test((await drawer(page).innerText()).replace(/\s+/g, ' ')) && (await drawer(page).getByRole('button', { name: 'Libérer' }).count()) === 0)
    // Serveur injoignable : message clair, pas de chiffres inventés
    await page.unroute('**/api/stock/product-detail**')
    await page.route('**/api/stock/product-detail**', route => route.abort('internetdisconnected'))
    await closeFiche(page); await page.locator('[data-product-name]', { hasText: P.name }).first().click(); await drawer(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(2500)
    const offline = (await drawer(page).innerText()).replace(/\s+/g, ' ')
    check('connexion coupée : bandeau « Hors connexion : quantités telles que la liste les connaissait », bouton « Réessayer »', (await drawer(page).locator('[data-testid="product-detail-error"]').count()) === 1 && /Hors connexion : quantités telles que la liste les connaissait/.test(offline) && /Réessayer/.test(offline), offline.slice(0, 200))
    check('… quantités de la liste affichées (disponible ' + (P.quantity - E - 2) + ', réservé 2, périmé ' + E + '), le reste en attente', (await drawer(page).locator('[data-testid="product-detail-quantities"]').count()) === 1 && (await qty(page, 'available')).includes(String(P.quantity - E - 2)) && (await qty(page, 'reserved')).endsWith('2') && (await qty(page, 'expired')).endsWith(String(E)) && (await drawer(page).locator('[data-testid="product-detail-purchase"]').count()) === 0 && (await drawer(page).locator('[data-testid="product-detail-reservations"]').count()) === 0, offline.slice(0, 300))
    await page.unroute('**/api/stock/product-detail**')
    await drawer(page).getByRole('button', { name: 'Réessayer' }).click()
    await drawer(page).locator('[data-testid="product-detail-quantities"]').waitFor({ timeout: 20000 })
    check('« Réessayer » : la fiche se charge', (await qty(page, 'reserved')).endsWith('2'))
    console.log('\n5 bis. Caisse : réservation libérée par un responsable, vue de l’appareil du vendeur')
    await closeFiche(page)
    await goto(page, '/fr/sales/new', 7000)
    const posCard = name => page.locator('[data-tour="pos-grid"] > div[role="button"]').filter({ has: page.getByText(name, { exact: true }) }).first()
    const searchPos = async name => { await page.getByPlaceholder(MSG('fr').sales.search_or_scan).first().fill(name); await page.waitForTimeout(900) }
    const isPut = x => x.url().includes('/api/stock/reservations') && x.request().method() === 'PUT'
    const isDelete = x => x.url().includes('/api/stock/reservations') && x.request().method() === 'DELETE'
    await searchPos(Q.name); await posCard(Q.name).click(); await page.waitForTimeout(400)
    await searchPos(Q.name); await posCard(Q.name).click(); await page.waitForTimeout(400)
    await page.locator('button[title="Mettre en attente"]:visible').first().click()
    const holdInput = page.getByPlaceholder(MSG('fr').sales.hold_label_placeholder); await holdInput.fill('Essai libération')
    const [put1] = await Promise.all([page.waitForResponse(isPut, { timeout: 15000 }), holdInput.press('Enter')])
    const heldRef = put1.request().postDataJSON().source_ref
    REFS.add(heldRef)
    await page.waitForTimeout(3000); await searchPos(Q.name)
    let card = await posCard(Q.name).innerText()
    check('appareil du vendeur : « 6 réservés » sur « ' + Q.name + ' » (4 d’une autre facture + les 2 de la sienne)', put1.status() === 200 && card.includes('6 réservés'), card)
    const rel = await api(page, 'DELETE', null, '?shop_id=' + ALPHA + '&source_ref=' + heldRef + '&product_id=' + Q.id)
    check('un responsable libère cette réservation (même route que la fiche, journalisée)', rel.status === 200 && rel.json.released.length === 1 && rel.json.released[0].quantity === 2, JSON.stringify(rel))
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); await searchPos(Q.name)
    card = await posCard(Q.name).innerText()
    check('… l’appareil du vendeur suit : « 4 réservés » (ses 2 ne comptent plus, alors que sa facture est toujours là)', card.includes('4 réservés') && !card.includes('6 réservés') && (await page.evaluate(() => JSON.parse(localStorage.getItem('nc_sale_drafts') || '[]').length)) === 1, card)
    await page.getByText(/facture\(s\) en attente/).first().click(); await page.waitForTimeout(800)
    const heldText = (await page.locator('[role="dialog"]').last().innerText()).replace(/\s+/g, ' ')
    check('… et sa facture en attente le dit : « Réservation libérée : ces articles ne sont plus gardés… »', (await page.locator('[data-testid="held-released"]').count()) === 1 && /Réservation libérée : ces articles ne sont plus gardés/.test(heldText), heldText.slice(0, 260))
    await page.getByRole('button', { name: /Reprendre/ }).first().click(); await page.waitForTimeout(1000)
    await page.locator('button[title="Mettre en attente"]:visible').first().click()
    const [put2] = await Promise.all([page.waitForResponse(isPut, { timeout: 15000 }), page.getByPlaceholder(MSG('fr').sales.hold_label_placeholder).press('Enter')])
    await page.waitForTimeout(3000); await searchPos(Q.name)
    card = await posCard(Q.name).innerText()
    check('remise en attente par le vendeur : de nouveau réservée (« 6 réservés »), mention disparue', put2.status() === 200 && card.includes('6 réservés') && (await rowsOf()).some(x => x.source_ref === heldRef && x.product_id === Q.id && x.quantity === 2) && (await page.locator('[data-testid="held-released"]').count()) === 0, card)
    await page.getByText(/facture\(s\) en attente/).first().click(); await page.waitForTimeout(600)
    const [del2] = await Promise.all([page.waitForResponse(isDelete, { timeout: 15000 }), page.locator('[role="dialog"] button.border-red-200').first().click()])
    await page.waitForTimeout(800)
    check('facture supprimée par le vendeur : sa réservation est libérée', del2.status() === 200 && !(await rowsOf()).some(x => x.source_ref === heldRef))
    await s.browser.close()

    // ══ 6. Langues et formats ════════════════════════════════════════════════
    console.log('\n6. fr / en / ha × téléphone / tablette / ordinateur')
    for (const [locale, wd, hg, kind] of [['fr', 390, 844, 'téléphone'], ['en', 390, 844, 'téléphone'], ['ha', 390, 844, 'téléphone'], ['fr', 820, 1180, 'tablette'], ['en', 820, 1180, 'tablette'], ['ha', 820, 1180, 'tablette'], ['en', 1440, 900, 'ordinateur'], ['ha', 1440, 900, 'ordinateur']]) {
      const o = await open(locale, wd, hg)
      const m = MSG(locale)
      await goto(o.page, `/${locale}/stock/products`, 8000)
      await findProduct(o.page, locale, P.name)
      await openFiche(o.page, P.name)
      const text = (await drawer(o.page).innerText()).replace(/\s+/g, ' ')
      const titles = [m.product_detail.quantities, m.product_detail.reservations, m.products.batches_title, m.product_detail.sales, m.product_detail.movements, m.product_detail.purchase]
      check(`${locale} · ${kind} ${wd} px : les six sections, dans la langue`, titles.every(x => text.includes(x)) && text.includes(m.product_detail.quantities_rule) && !/[{}]|product_detail\./.test(text), titles.filter(x => !text.includes(x)).join(' / '))
      check(`${locale} · ${kind} : disponible ${P.quantity - E - 2}, réservation « ${m.product_detail.reservation_unnamed} »`, (await qty(o.page, 'available')).includes(String(P.quantity - E - 2)) && text.includes(m.product_detail.reservation_unnamed))
      const reasons = await drawer(o.page).locator('[data-testid="movement-list"] li').evaluateAll(els => els.map(li => [li.querySelector('[data-movement-label]'), li.querySelector('[data-movement-detail]')].filter(Boolean).map(e => e.innerText.trim()).join(' ')))
      const expectSale = { fr: /^Vente /, en: /^Sale /, ha: /^Sayarwa / }[locale]
      check(locale + ' · ' + kind + ' : motifs dans la langue (« ' + (reasons[0] || '') + ' »)', reasons.length > 0 && reasons.some(x => expectSale.test(x)) && !reasons.some(x => /Annulation vente|Modification vente|Restock from|Inventaire physique/.test(x)) && (locale === 'en' || !reasons.some(x => /^Sale /.test(x))), reasons.join(' | '))
      const box = await o.page.evaluate(() => { const d = document.querySelector('[data-testid="product-detail"]'); const r = d.getBoundingClientRect(); const body = d.querySelector('.overflow-y-auto'); const f = d.querySelector('[data-testid="product-detail-actions"]'); const fr = f ? f.getBoundingClientRect() : null; return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, overflow: body.scrollWidth - body.clientWidth, footerBottom: fr ? Math.round(fr.bottom) : null, footerRight: fr ? Math.round(Math.max(...[...f.children].map(b => b.getBoundingClientRect().right))) : null, page: document.documentElement.scrollWidth - window.innerWidth } })
      if (wd < 640) check(`${locale} · téléphone : fiche en PLEIN ÉCRAN (${box.w}×${box.h})`, box.x === 0 && box.w === box.vw && box.h === box.vh, JSON.stringify(box))
      else check(`${locale} · ${kind} : panneau latéral à droite (${box.w} px de large)`, box.w <= 640 && box.x + box.w === box.vw && box.h === box.vh, JSON.stringify(box))
      check(`${locale} · ${kind} : aucun débordement horizontal, actions du pied entièrement visibles`, box.overflow <= 0 && box.page <= 0 && box.footerBottom !== null && box.footerBottom <= box.vh && box.footerRight <= box.vw, JSON.stringify(box))
      await o.page.screenshot({ path: `${__dirname}/out/product-detail-${locale}-${wd}.png` })
      if (locale === 'fr' && wd === 390) {
        await o.page.evaluate(() => { const b = document.querySelector('[data-testid="product-detail"] .overflow-y-auto'); b.scrollTop = b.scrollHeight })
        await o.page.waitForTimeout(400); await o.page.screenshot({ path: `${__dirname}/out/product-detail-fr-390-bas.png` })
      }
      await o.browser.close()
    }

    // ══ 7. Marché Soleil, lecture seule : vrais transferts et vraies commandes ══
    console.log('\n7. En transit / en commande (Marché Soleil, lecture seule)')
    const state = JSON.parse(fs.readFileSync(V + 'state.json', 'utf8'))
    const { data: eau } = await admin.from('products').select('shop_id, name').eq('id', state.products.bastos.eau).single()
    const { data: oeufs } = await admin.from('products').select('shop_id, name').eq('id', state.products.akwa.oeufs).single()
    const v = await open('fr', 1280, 900, { email: 'ghislainx123@gmail.com', shop: oeufs.shop_id })
    await goto(v.page, '/fr/stock/products', 8000)
    const vo = (await get(v.page, detailPath(oeufs.shop_id, state.products.akwa.oeufs))).json
    const ve = (await get(v.page, detailPath(eau.shop_id, state.products.bastos.eau))).json
    const vr = (await get(v.page, detailPath(oeufs.shop_id, state.products.akwa.riz))).json
    check('Akwa · œufs : 20 en commande (bon de commande envoyé, non reçu)', vo?.quantities?.onOrder === 20, JSON.stringify(vo?.quantities))
    check('Bastos · eau : 24 en transit (transfert envoyé, non reçu)', ve?.quantities?.inTransit === 24, JSON.stringify(ve?.quantities))
    check('Akwa · riz : rien d’attendu → 0 réel (information visible), disponible = physique − périmé − réservé', vr?.quantities?.inTransit === 0 && vr?.quantities?.onOrder === 0 && vr.quantities.available === vr.quantities.physical - vr.quantities.expired - vr.quantities.reserved, JSON.stringify(vr?.quantities))
    await findProduct(v.page, 'fr', oeufs.name)
    await openFiche(v.page, oeufs.name)
    check('à l’écran · œufs : « En commande +20 »', (await drawer(v.page).locator('[data-qty="onOrder"]').innerText()).trim() === '+20', await drawer(v.page).locator('[data-qty="incoming"]').innerText())
    await v.page.screenshot({ path: `${__dirname}/out/product-detail-vitrine.png` })
    await v.browser.close()
  } finally {
    // Nettoyage : uniquement les lignes de CETTE exécution (réservations + entrées de journal qu'elles ont produites)
    const mine = ref => (ref || '').startsWith(RUN + '_') || REFS.has(ref)
    const clean = await W.finish({
      stock_reservations: r => mine(r.source_ref),
      audit_logs: r => r.action === 'stock.reservation_released' && (mine(r.metadata?.source_ref) || JSON.stringify(r.metadata || {}).includes(RUN) || [...REFS].some(x => JSON.stringify(r.metadata || {}).includes(x))),
    })
    const sales1 = (await admin.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
    const moves1 = (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
    const { data: prods1 } = await admin.from('products').select('id, quantity, buying_price').eq('shop_id', ALPHA).eq('is_active', true).order('name')
    console.log('\nNettoyage et contrôle')
    check('mode écriture : rien de préexistant touché, aucune trace restante en base', clean)
    check(`aucune vente créée (${sales0} → ${sales1}), aucun mouvement de stock créé (${moves0} → ${moves1})`, sales1 === sales0 && moves1 === moves0)
    check('aucune quantité ni aucun prix d’achat modifié', JSON.stringify(prods1.map(p => [p.id, p.quantity, p.buying_price])) === stock0)
  }
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
