// Étape 5B — stock RÉSERVÉ, de bout en bout sur la compilation locale, compte d'essai (Boutique Alpha) UNIQUEMENT.
// De VRAIES réservations sont créées sur Boutique Alpha par la route /api/stock/reservations, puis toutes effacées
// à la fin (même en cas d'échec). Aucune vente validée ; toute autre écriture du navigateur est bloquée.
// Marché Soleil n'est jamais modifié : un de ses vendeurs sert seulement à vérifier qu'il est REFUSÉ sur Alpha.
// Usage : CAPTURE_BASE=http://localhost:3000 node stock-reserved.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
if (!/^http:\/\/localhost/.test(BASE)) { console.error('Ce test écrit des réservations : compilation locale uniquement.'); process.exit(1) }
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const { createTranslator } = require(ROOT + '/node_modules/next-intl')
const MSG = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8'))
const H = 3600000
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : '→ ' + extra) }
const rowsOf = async (filter = q => q) => (await filter(admin.from('stock_reservations').select('product_id, quantity, source_ref, label, created_by, expires_at, shop_id').eq('shop_id', ALPHA))).data || []
const wait = ms => new Promise(r => setTimeout(r, ms))

async function open(locale, width, height, { email, allowReservations = false, columns = ['physical', 'reserved'] } = {}) {
  if (email) process.env.CAPTURE_EMAIL = email; else delete process.env.CAPTURE_EMAIL
  const s = await session({ width, height, scale: 1, locale })
  await s.page.context().addInitScript(([shop, cols]) => { try { if (!localStorage.getItem('active_shop_id')) localStorage.setItem('active_shop_id', shop); localStorage.setItem('stock_table_columns', JSON.stringify(cols)) } catch {} }, [ALPHA, columns])
  // Seule écriture autorisée : la route des réservations (le reste est bloqué par capture.js)
  if (allowReservations) await s.page.route('**/api/stock/reservations**', route => route.continue())
  return s
}
const api = (page, method, body, query = '') => page.evaluate(async ([m, b, q]) => {
  const res = await fetch('/api/stock/reservations' + q, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, json }
}, [method, body, query])
const goto = async (page, path, ms = 7000) => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(ms) }
// Ligne du tableau Produits, par en-tête de colonne
const tableRow = (page, name) => page.evaluate(nm => {
  const table = document.querySelector('main table'); if (!table) return null
  const heads = [...table.querySelectorAll('thead th')].map(th => th.innerText.replace(/\s+/g, ' ').trim())
  const tr = [...table.querySelectorAll('tbody tr')].find(x => [...x.querySelectorAll('[data-product-name]')].some(p => p.innerText.trim() === nm)); if (!tr) return null
  const o = {}; [...tr.querySelectorAll('td')].forEach((td, i) => { o[heads[i] || '#' + i] = td.innerText.replace(/\s+/g, ' ').trim() }); return o
}, name)
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const posCard = (page, name) => page.locator('[data-tour="pos-grid"] > div[role="button"]').filter({ has: page.getByText(name, { exact: true }) }).first()
const searchPos = async (page, locale, name) => { const box = page.getByPlaceholder(MSG(locale).sales.search_or_scan).first(); await box.fill(name); await page.waitForTimeout(900) }

;(async () => {
  console.log('Base :', BASE)
  // ── État de départ (lecture) ──────────────────────────────────────────────
  const left = await rowsOf()
  if (left.length) { console.log(`Reste d'un essai précédent sur Boutique Alpha : ${left.length} ligne(s), effacées avant de commencer.`); await admin.from('stock_reservations').delete().eq('shop_id', ALPHA) }
  const total0 = (await admin.from('stock_reservations').select('id', { count: 'exact', head: true })).count
  const sales0 = (await admin.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const today = new Date().toISOString().slice(0, 10)
  const { data: prods } = await admin.from('products').select('id, name, quantity, low_stock_threshold').eq('shop_id', ALPHA).eq('is_active', true).order('name')
  const { data: expiredBatches } = await admin.from('product_batches').select('product_id').eq('shop_id', ALPHA).gt('quantity', 0).lt('expiry_date', today)
  const withExpired = new Set((expiredBatches || []).map(b => b.product_id))
  const stock0 = JSON.stringify(prods.map(p => [p.id, p.quantity]))
  const names = prods.map(p => p.name)
  const simple = p => !withExpired.has(p.id) && names.filter(n => n.includes(p.name)).length === 1 && /^[\w À-ÿ.'-]+$/.test(p.name)
  const A = prods.find(p => simple(p) && p.quantity >= 30)
  const B = prods.find(p => simple(p) && p.id !== A.id && p.quantity >= 12 && p.quantity <= 400)
  const { data: foreign } = await admin.from('products').select('id, shop_id').neq('shop_id', ALPHA).gt('quantity', 0).limit(1)
  console.log(`Produits d'essai : A « ${A.name} » (${A.quantity} en rayon), B « ${B.name} » (${B.quantity} en rayon) · ${prods.length} produits actifs · ${sales0} ventes · table : ${total0} ligne(s)`)

  try {
    // ══ 1. Route serveur ═════════════════════════════════════════════════════
    console.log('\n1. Route /api/stock/reservations')
    const anon = await fetch(BASE + '/api/stock/reservations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: ALPHA, source_ref: 'test_anon', items: [{ product_id: A.id, quantity: 1 }] }) })
    check('sans connexion : refusé (401)', anon.status === 401, String(anon.status))
    const anonDel = await fetch(BASE + `/api/stock/reservations?shop_id=${ALPHA}&source_ref=test_anon`, { method: 'DELETE' })
    check('sans connexion, libération : refusée (401)', anonDel.status === 401, String(anonDel.status))
    const s = await open('fr', 1280, 900, { allowReservations: true })
    const page = s.page
    await goto(page, '/fr/stock', 7000)
    {
      // Boutique d'une AUTRE entreprise (Marché Soleil), demande VIDE : même acceptée à tort, elle n'écrirait rien
      const other = fs.readFileSync(__dirname + '/out/vitrine/akwa-id.txt', 'utf8').trim()
      const n0 = (await admin.from('stock_reservations').select('id', { count: 'exact', head: true }).eq('shop_id', other)).count
      const r = await api(page, 'PUT', { shop_id: other, source_ref: 'test_outsider', items: [] })
      const d = await api(page, 'DELETE', null, `?shop_id=${other}&source_ref=test_outsider`)
      const n1 = (await admin.from('stock_reservations').select('id', { count: 'exact', head: true }).eq('shop_id', other)).count
      check('boutique d’une autre entreprise : refusé (403), en écriture comme en libération', r.status === 403 && d.status === 403 && n0 === 0 && n1 === 0, `${r.status} / ${d.status} · ${n0} → ${n1}`)
    }
    check('après ces refus : aucune ligne créée', (await rowsOf()).length === 0)
    const overviewText = async () => (await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | ')))
    const out0 = Number(((await overviewText()).match(/\| (\d+) \| Ruptures/) || [])[1])
    check('Vue d’ensemble lue avant toute réservation', Number.isFinite(out0), 'Ruptures introuvable')

    let r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: '', items: [] })
    check('facture sans identifiant : refusée (400)', r.status === 400, String(r.status))
    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'x'.repeat(121), items: [] })
    check('identifiant trop long : refusé (400)', r.status === 400, String(r.status))
    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_bad' })
    check('articles absents : refusé (400)', r.status === 400, String(r.status))

    const t1 = Date.now()
    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_1', label: '  Table 3  ', items: [
      { product_id: A.id, quantity: 2 }, { product_id: A.id, quantity: 1 }, { product_id: B.id, quantity: B.quantity + 500 },
      { product_id: foreign[0].id, quantity: 4 }, { product_id: A.id, quantity: 0 },
    ] })
    let rows = await rowsOf()
    const ra = rows.find(x => x.product_id === A.id), rb = rows.find(x => x.product_id === B.id)
    check('création : 200, 2 lignes', r.status === 200 && r.json?.lines === 2 && rows.length === 2, JSON.stringify(r) + ' ' + rows.length)
    check('même produit deux fois : additionné (2 + 1 = 3)', ra?.quantity === 3, JSON.stringify(ra))
    check(`plus que le rayon demandé : ramené au stock physique (${B.quantity})`, rb?.quantity === B.quantity, JSON.stringify(rb))
    check('produit d’une autre boutique : ignoré', !rows.some(x => x.product_id === foreign[0].id) && (await admin.from('stock_reservations').select('id', { count: 'exact', head: true }).eq('shop_id', foreign[0].shop_id)).count === 0)
    check('nom de la facture nettoyé (« Table 3 »), auteur enregistré', ra?.label === 'Table 3' && !!ra?.created_by, JSON.stringify(ra))
    const exp1 = new Date(ra.expires_at).getTime()
    check('fin de réservation : 24 h après (à la minute près)', Math.abs(exp1 - (t1 + 24 * H)) < 60000, new Date(exp1).toISOString())

    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_1', age_ms: 6 * H, items: [{ product_id: A.id, quantity: 5 }] })
    rows = await rowsOf()
    check('remplacement : A passe à 5, B retiré du panier → sa ligne disparaît', r.status === 200 && rows.length === 1 && rows[0].product_id === A.id && rows[0].quantity === 5, JSON.stringify(rows))
    check('facture en attente depuis 6 h : fin dans 18 h', Math.abs(new Date(rows[0].expires_at).getTime() - (Date.now() + 18 * H)) < 60000, rows[0].expires_at)
    check('nom absent à ce second envoi : effacé', rows[0].label === null, String(rows[0].label))

    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_2', items: [{ product_id: A.id, quantity: 4 }] })
    rows = await rowsOf()
    check('deux factures sur le même produit : deux lignes (5 + 4)', rows.length === 2 && rows.reduce((n, x) => n + x.quantity, 0) === 9, JSON.stringify(rows.map(x => [x.source_ref, x.quantity])))

    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_1', age_ms: 25 * H, items: [{ product_id: A.id, quantity: 5 }] })
    rows = await rowsOf()
    check('facture de plus de 24 h : sa réservation est retirée, l’autre reste', r.status === 200 && r.json?.lines === 0 && rows.length === 1 && rows[0].source_ref === 'test_2', JSON.stringify(rows))

    // Ligne échue (posée directement, compte d'essai) : ignorée à la lecture, effacée au passage suivant
    await admin.from('stock_reservations').insert({ shop_id: ALPHA, product_id: B.id, quantity: 3, source_ref: 'test_echue', expires_at: new Date(Date.now() - H).toISOString() })
    // Accès DIRECT à la base avec la session du membre (depuis Node : le navigateur du test bloque les écritures)
    const memberRead = await (async () => {
      const cookies = await page.context().cookies()
      const raw = cookies.filter(c => /auth-token(\.\d+)?$/.test(c.name)).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true })).map(c => c.value).join('')
      const token = JSON.parse(Buffer.from(decodeURIComponent(raw).replace(/^base64-/, ''), 'base64url').toString()).access_token
      const url = env.NEXT_PUBLIC_SUPABASE_URL, h = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
      const q = `${url}/rest/v1/stock_reservations?shop_id=eq.${ALPHA}`
      const all = await (await fetch(q + '&select=source_ref,quantity', { headers: h })).json()
      const w = await fetch(`${url}/rest/v1/stock_reservations`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: ALPHA, product_id: A.id, quantity: 1, source_ref: 'test_direct', expires_at: new Date(Date.now() + H).toISOString() }) })
      const u = await fetch(q + '&source_ref=eq.test_2', { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: 999 }) })
      const d = await fetch(q + '&source_ref=eq.test_2', { method: 'DELETE', headers: h })
      return { n: Array.isArray(all) ? all.length : JSON.stringify(all), write: w.status, update: u.status, del: d.status }
    })().catch(e => ({ erreur: e.message }))
    console.log('     (accès direct à la base avec la session du membre : ' + JSON.stringify(memberRead) + ')')
    check('membre de la boutique : LIT les réservations (2 lignes, dont l’échue)', memberRead.n === 2, JSON.stringify(memberRead))
    rows = await rowsOf()
    check('… mais ne peut ni créer, ni modifier, ni effacer directement : refus de la base, lignes intactes', memberRead.write >= 400 && memberRead.update >= 400 && memberRead.del >= 400 && rows.length === 2 && !rows.some(x => x.source_ref === 'test_direct' || x.quantity === 999), JSON.stringify(memberRead) + ' ' + JSON.stringify(rows.map(x => [x.source_ref, x.quantity])))
    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_2', items: [{ product_id: A.id, quantity: 4 }] })
    rows = await rowsOf()
    check('ligne échue : effacée au passage suivant', rows.length === 1 && !rows.some(x => x.source_ref === 'test_echue'), JSON.stringify(rows.map(x => x.source_ref)))

    r = await api(page, 'DELETE', null, `?shop_id=${ALPHA}&source_ref=test_2`)
    check('libération : 200, plus aucune ligne', r.status === 200 && (await rowsOf()).length === 0)
    r = await api(page, 'DELETE', null, `?shop_id=${ALPHA}&source_ref=test_inconnue`)
    check('libérer une facture inconnue : sans erreur', r.status === 200, String(r.status))

    // ══ 2. Caisse → Stock, appareil 1 ════════════════════════════════════════
    console.log('\n2. Caisse (appareil 1) : mise en attente → réservation')
    await goto(page, '/fr/sales/new', 7000)
    await searchPos(page, 'fr', A.name)
    await posCard(page, A.name).click(); await page.waitForTimeout(300)
    await posCard(page, A.name).click(); await page.waitForTimeout(300)
    await page.locator('button[title="Mettre en attente"]:visible').first().click()
    const input = page.getByPlaceholder(MSG('fr').sales.hold_label_placeholder)
    await input.fill('Essai réservation')
    const [put] = await Promise.all([
      page.waitForResponse(x => x.url().includes('/api/stock/reservations') && x.request().method() === 'PUT', { timeout: 15000 }),
      input.press('Enter'),
    ])
    const sent = put.request().postDataJSON()
    rows = await rowsOf()
    check('« Mettre en attente » envoie la réservation (200)', put.status() === 200, String(put.status()))
    check('identifiant de facture unique par appareil (suffixe aléatoire)', /^draft_\d+_[a-z0-9]{1,6}$/.test(sent.source_ref), sent.source_ref)
    check('en base : A × 2, « Essai réservation »', rows.length === 1 && rows[0].product_id === A.id && rows[0].quantity === 2 && rows[0].label === 'Essai réservation' && rows[0].source_ref === sent.source_ref, JSON.stringify(rows))
    const draftRef = sent.source_ref
    check('la facture reste sur l’appareil, rien n’attend d’être envoyé', await page.evaluate(() => JSON.parse(localStorage.getItem('nc_sale_drafts') || '[]').length === 1 && Object.keys(JSON.parse(localStorage.getItem('nc_reservation_sync') || '{}')).length === 0))
    await searchPos(page, 'fr', A.name)
    check('appareil 1 : la carte du produit indique « 2 réservés » (sa propre facture en attente)', (await posCard(page, A.name).innerText()).includes('2 réservés'), await posCard(page, A.name).innerText())

    // B entièrement réservé par une AUTRE facture (posée par la route, comme un autre appareil)
    r = await api(page, 'PUT', { shop_id: ALPHA, source_ref: 'test_autre_appareil', label: 'Mme Fatou', items: [{ product_id: B.id, quantity: B.quantity }] })
    check(`B entièrement réservé par une autre facture (${B.quantity})`, r.status === 200 && (await rowsOf()).length === 2)

    console.log('\n3. Stock › Produits et Vue d’ensemble')
    const L = {}
    for (const l of ['fr', 'en', 'ha']) { const m = MSG(l); L[l] = { reserved: m.products.col_reserved, avail: m.products.col_available, phys: m.products.col_physical, status: m.products.col_status, out: m.status.out_of_stock } }
    L.fr.n = c => `${c} réservé${c > 1 ? 's' : ''}`; L.en.n = c => `${c} reserved`; L.ha.n = c => `${c} an ajiye`
    for (const locale of ['fr', 'en', 'ha']) {
      const w = L[locale]
      const o = locale === 'fr' ? { page } : await open(locale, 1280, 900)
      await goto(o.page, `/${locale}/stock/products`, 8000)
      const box = o.page.getByLabel(MSG(locale).products.search_placeholder).first()
      await box.fill(A.name); await o.page.waitForTimeout(1200)
      const a = await tableRow(o.page, A.name)
      check(`${locale} · A : disponible ${A.quantity - 2} (= ${A.quantity} − 2), « ${w.n(2)} », colonne « ${w.reserved} » = 2, physique ${A.quantity}`,
        !!a && new RegExp(`^${A.quantity - 2}\\D`).test(a[w.avail]) && a[w.avail].includes(w.n(2)) && a[w.reserved] === '2' && a[w.phys] === String(A.quantity), JSON.stringify(a))
      await box.fill(B.name); await o.page.waitForTimeout(1200)
      const b = await tableRow(o.page, B.name)
      check(`${locale} · B tout réservé : 0 disponible, « ${w.n(B.quantity)} », statut « ${w.out} », physique ${B.quantity}`,
        !!b && /^0\D/.test(b[w.avail]) && b[w.avail].includes(w.n(B.quantity)) && b[w.reserved] === String(B.quantity) && b[w.status].includes(w.out) && b[w.phys] === String(B.quantity), JSON.stringify(b))
      check(`${locale} · 1280 px, colonnes Physique et Réservé affichées : pas de débordement`, (await overflow(o.page)) <= 0, String(await overflow(o.page)))
      if (locale === 'fr') {
        await o.page.getByRole('button', { name: /^Colonnes/ }).click()
        const pop = o.page.locator('[data-radix-popper-content-wrapper]').first(); await pop.waitFor({ timeout: 5000 })
        check('bouton « Colonnes » : « Réservé » est une vraie case (plus aucune case grisée), explication à jour', (await pop.locator('input[type=checkbox]:disabled').count()) === 0 && await pop.getByLabel('Réservé', { exact: true }).isChecked() && (await pop.innerText()).includes('gardés 24 h au plus'), await pop.innerText())
        await o.page.keyboard.press('Escape')
        await goto(o.page, '/fr/stock/products?status=out', 7000)
        const outNames = await o.page.evaluate(() => [...document.querySelectorAll('main table tbody tr')].map(tr => tr.children[1].innerText.split('\n')[0].trim()))
        check('filtre « Rupture » : B y figure (tout son stock est réservé)', outNames.includes(B.name), outNames.join(' | '))
        await goto(o.page, '/fr/stock', 7000)
        const out1 = Number(((await overviewText()).match(/\| (\d+) \| Ruptures/) || [])[1])
        check(`Vue d’ensemble : une rupture de plus (${out0} → ${out0 + 1})`, out1 === out0 + 1, String(out1))
      } else await o.browser.close()
    }
    for (const [locale, wd, hg, kind] of [['fr', 390, 844, 'téléphone'], ['en', 390, 844, 'téléphone'], ['ha', 390, 844, 'téléphone'], ['fr', 820, 1180, 'tablette']]) {
      const o = await open(locale, wd, hg)
      await goto(o.page, `/${locale}/stock/products`, 8000)
      const box = o.page.getByLabel(MSG(locale).products.search_placeholder).first()
      await box.fill(B.name); await o.page.waitForTimeout(1200)
      const text = await o.page.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' '))
      check(`${locale} · ${kind} ${wd} px : B « ${L[locale].n(B.quantity)} », « ${L[locale].out} », sans débordement`, text.includes(L[locale].n(B.quantity)) && text.includes(L[locale].out) && (await overflow(o.page)) <= 0, `${await overflow(o.page)} · ${text.slice(0, 300)}`)
      await o.page.screenshot({ path: `${__dirname}/out/stock-reserved-${locale}-${wd}.png` })
      await o.browser.close()
    }
    await page.screenshot({ path: `${__dirname}/out/stock-reserved-overview.png` })

    // ══ 4. Caisse, appareil 2 (autre navigateur, même boutique) ══════════════
    console.log('\n4. Caisse (appareil 2) : avertissement, jamais de blocage')
    for (const [locale, wd, hg] of [['fr', 1280, 900], ['en', 390, 844], ['ha', 820, 1180]]) {
      const o = await open(locale, wd, hg)
      await goto(o.page, `/${locale}/sales/new`, 7000)
      await searchPos(o.page, locale, A.name)
      const cardA = await posCard(o.page, A.name).innerText()
      check(`${locale} ${wd} px · carte A : « ${L[locale].n(2)} »`, cardA.includes(L[locale].n(2)), cardA)
      await posCard(o.page, A.name).click(); await o.page.waitForTimeout(700)
      const m = MSG(locale).sales
      check(`${locale} · A (reste ${A.quantity - 2} de libre) : ajouté sans avertissement`, !(await o.page.getByText(m.reserved_warning_title, { exact: true }).count()))
      await searchPos(o.page, locale, B.name)
      const cardB = await posCard(o.page, B.name).innerText()
      check(`${locale} · carte B : « ${L[locale].n(B.quantity)} »`, cardB.includes(L[locale].n(B.quantity)), cardB)
      // Compte les apparitions du message (un message peut disparaître avant la vérification suivante)
      await o.page.evaluate(title => { window.__warn = 0; new MutationObserver(ms => { for (const mu of ms) for (const nd of mu.addedNodes) if (nd.nodeType === 1 && (nd.innerText || '').includes(title)) window.__warn++ }).observe(document.body, { childList: true, subtree: true }) }, m.reserved_warning_title)
      await posCard(o.page, B.name).click(); await o.page.waitForTimeout(900)
      const expected = createTranslator({ locale, messages: MSG(locale), namespace: 'sales' })('reserved_warning_desc', { name: B.name, reserved: B.quantity, free: 0 })
      const body = await o.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      const n1 = await o.page.evaluate(() => window.__warn)
      check(`${locale} · B (tout réservé) : « ${m.reserved_warning_title} » — « ${expected} »`, n1 >= 1 && body.includes(m.reserved_warning_title) && body.includes(expected), body.slice(0, 260))
      await posCard(o.page, B.name).click(); await o.page.waitForTimeout(900)
      check(`${locale} · second ajout de B : message non répété`, (await o.page.evaluate(() => window.__warn)) === n1, `${n1} → ${await o.page.evaluate(() => window.__warn)}`)
      if (wd < 1024) { await o.page.locator('[data-tour="pos-open-cart"]:visible').first().click(); await o.page.waitForTimeout(900) }
      const cartText = await o.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      const count = nm => cartText.split(nm).length - 1
      check(`${locale} · … et B est quand même dans le panier, avec A`, count(B.name) >= 2 && count(A.name) >= 1, `B ×${count(B.name)}, A ×${count(A.name)}`)
      check(`${locale} ${wd} px · caisse sans débordement`, (await overflow(o.page)) <= 0, String(await overflow(o.page)))
      if (locale === 'fr') await o.page.screenshot({ path: `${__dirname}/out/stock-reserved-pos.png` })
      await o.browser.close()
    }
    check('la caisse de l’appareil 2 n’a rien écrit : toujours 2 lignes en base', (await rowsOf()).length === 2)

    // ══ 5. Appareil 1 : reprise puis suppression ═════════════════════════════
    console.log('\n5. Caisse (appareil 1) : reprise, suppression → libération')
    await goto(page, '/fr/sales/new', 7000)
    await page.getByText('1 facture(s) en attente').first().click()
    await page.getByRole('button', { name: /Reprendre/ }).first().click(); await page.waitForTimeout(900)
    await searchPos(page, 'fr', A.name)
    const afterResume = await posCard(page, A.name).innerText()
    check('facture reprise : ses articles ne sont plus comptés « réservés » sur cet appareil', !afterResume.includes('réservé'), afterResume)
    check('… mais la réservation reste en base tant que la facture existe (2 lignes)', (await rowsOf()).length === 2)
    await posCard(page, A.name).click(); await page.waitForTimeout(700)
    check('ajouter le produit de sa propre facture reprise : aucun avertissement', !(await page.getByText('Articles déjà réservés', { exact: true }).count()))
    await page.getByText(/facture\(s\) en attente/).first().click()
    const [del] = await Promise.all([
      page.waitForResponse(x => x.url().includes('/api/stock/reservations') && x.request().method() === 'DELETE', { timeout: 15000 }),
      page.locator('[role="dialog"] button.border-red-200').first().click(),
    ])
    rows = await rowsOf()
    check('suppression de la facture : libération envoyée (200), sa ligne disparaît', del.status() === 200 && del.url().includes(encodeURIComponent(draftRef)) && rows.length === 1 && rows[0].source_ref === 'test_autre_appareil', JSON.stringify(rows.map(x => x.source_ref)))

    // Hors connexion : la mise en attente fonctionne, la réservation part au retour du réseau
    console.log('\n6. Hors connexion puis retour')
    let blocked = true
    await page.keyboard.press('Escape'); await page.waitForTimeout(700) // la fenêtre « Factures en attente » était restée ouverte
    await page.route('**/api/stock/reservations**', route => (blocked ? route.abort('internetdisconnected') : route.continue()))
    await page.locator('button[title="Mettre en attente"]:visible').first().click()
    await page.getByPlaceholder(MSG('fr').sales.hold_label_placeholder).press('Enter'); await page.waitForTimeout(1500)
    const pending = await page.evaluate(() => ({ drafts: JSON.parse(localStorage.getItem('nc_sale_drafts') || '[]').length, sync: Object.keys(JSON.parse(localStorage.getItem('nc_reservation_sync') || '{}')) }))
    check('réseau coupé : la facture est mise en attente quand même, sa réservation reste notée', pending.drafts === 1 && pending.sync.length === 1 && (await rowsOf()).length === 1, JSON.stringify(pending))
    blocked = false
    const [again] = await Promise.all([
      page.waitForResponse(x => x.url().includes('/api/stock/reservations') && x.request().method() === 'PUT', { timeout: 30000 }),
      page.reload({ waitUntil: 'domcontentloaded' }),
    ])
    await page.waitForTimeout(1500)
    rows = await rowsOf()
    const mine = rows.find(x => x.source_ref === pending.sync[0])
    check('retour du réseau (caisse rouverte) : réservation envoyée d’elle-même', again.status() === 200 && !!mine && mine.product_id === A.id && mine.quantity === 3, JSON.stringify(rows.map(x => [x.source_ref, x.quantity])))
    check('… et plus rien n’attend sur l’appareil', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nc_reservation_sync') || '{}')).length === 0))
    await s.browser.close()
  } finally {
    // ── Nettoyage : toutes les réservations de Boutique Alpha (compte d'essai) ──
    await admin.from('stock_reservations').delete().eq('shop_id', ALPHA)
    await wait(500)
    const total1 = (await admin.from('stock_reservations').select('id', { count: 'exact', head: true })).count
    const sales1 = (await admin.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
    const { data: prods1 } = await admin.from('products').select('id, quantity').eq('shop_id', ALPHA).eq('is_active', true).order('name')
    console.log('\nNettoyage et contrôle')
    check(`table des réservations revenue à son état de départ (${total0} → ${total1})`, total1 === total0)
    check(`aucune vente créée (${sales0} → ${sales1})`, sales1 === sales0)
    check('aucune quantité de stock modifiée', JSON.stringify(prods1.map(p => [p.id, p.quantity])) === stock0)
  }
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
