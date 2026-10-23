// STOCK > MOUVEMENTS — détail d'un mouvement, ligne cliquable, libellés métier, recherche, pastilles, droits.
// LECTURE SEULE : toute écriture du navigateur est bloquée (session de capture) ; la base n'est que lue.
// Comptes : Boutique Alpha (propriétaire, gérant, caissier) et Marché Soleil (vitrine, consultation seulement).
// Usage : CAPTURE_BASE=http://localhost:3000 node movements-ux.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
const { describeMovement } = jiti(ROOT + '/lib/stock/movement-label.ts')
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OWNER = 'admin@northcode.ng', MANAGER = 'cassierstock@gmail.com', CASHIER = 'stocshopci@gmail.com', VITRINE = 'ghislainx123@gmail.com'
const MSG = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8'))
const FR = MSG('fr').movements
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : '→ ' + String(extra).slice(0, 500)) }
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const MINUS = '\u2212'
const signed = d => (d > 0 ? '+' : d < 0 ? MINUS : '') + Math.abs(d)

async function open(locale, width, height, { email = OWNER, shop = ALPHA, only = null, patchPerms = null } = {}) {
  process.env.CAPTURE_EMAIL = email
  const s = await session({ width, height, scale: 1, locale })
  await s.page.context().addInitScript(([id, filter]) => { try { localStorage.setItem('active_shop_id', id); if (filter) localStorage.setItem('dashboard_shop_filter', filter); else localStorage.removeItem('dashboard_shop_filter') } catch {} }, [shop, only])
  // Réglages de rôles modifiés DANS LE NAVIGATEUR seulement (la base n'est pas touchée) : garde d'entrée de l'écran
  if (patchPerms) await s.page.route('**/rest/v1/**', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch(); let body = await res.text()
    try { const walk = x => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.role_permissions && typeof x.role_permissions === 'object') patchPerms(x.role_permissions); Object.values(x).forEach(walk) } }; const j = JSON.parse(body); walk(j); body = JSON.stringify(j).split('"hours_enabled":true').join('"hours_enabled":false') } catch {}
    return route.fulfill({ response: res, body })
  })
  s.bodies = []
  s.page.on('response', async r => { const u = r.url(); if (/\/api\/|\/rest\/v1\//.test(u) && r.request().method() === 'GET') { try { s.bodies.push({ url: u, text: await r.text() }) } catch {} } })
  return s
}
const goto = async (page, path, ms = 6500) => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(ms) }
const get = (page, path) => page.evaluate(async p => { const r = await fetch(p); let j = null; try { j = await r.json() } catch {} return { status: r.status, json: j } }, path)
const settle = async (page, ms = 900) => { await page.waitForTimeout(ms); await page.locator('[data-testid="movements-count"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500) }
const rows = page => page.evaluate(() => [...document.querySelectorAll('main [data-movement-row]')].map(b => { const q = s => b.querySelector(s); return { id: b.dataset.movementRow, product: q('[data-movement-product]') ? q('[data-movement-product]').innerText : null, label: q('[data-movement-label]').innerText, key: q('[data-movement-label]').dataset.movementLabel, detail: q('[data-movement-detail]') ? q('[data-movement-detail]').innerText : null, meta: q('[data-movement-meta]').innerText, shop: q('[data-movement-shop]') ? q('[data-movement-shop]').innerText : null, delta: q('[data-movement-delta]') ? q('[data-movement-delta]').innerText : null } }))
const pressed = page => page.evaluate(() => [...document.querySelectorAll('main button[data-kind]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.kind))
const pill = (page, k) => page.locator(`main button[data-kind="${k}"]`)
const drawer = page => page.locator('[data-testid="movement-detail"]')
const fiche = page => page.locator('[data-testid="product-detail"]')
const dtext = async page => (await drawer(page).innerText()).replace(/\s+/g, ' ')
const field = async (page, id) => { const l = drawer(page).locator(`[data-testid="movement-detail-${id}"] dd`); return (await l.count()) ? (await l.innerText()).trim() : null }
const closeDrawer = async page => { await drawer(page).getByRole('button', { name: /^(Fermer|Close|Rufe)$/ }).first().click(); await drawer(page).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300) }
const KIND_KEYS = { sale: ['label_sale'], in: ['label_restock', 'label_supplier_receipt', 'label_initial', 'label_return', 'label_entry'], adjustment: ['label_loss', 'label_damage', 'label_expiry', 'label_stock_correction', 'label_inventory_adjustment', 'label_adjustment', 'label_exit', 'label_other'], transfer: ['label_transfer_sent', 'label_transfer_received', 'label_transfer_cancelled'] }
// Libellés attendus, écrits ici en toutes lettres (pas relus dans les fichiers de langue)
const LABEL_FR = { label_sale: 'Vente', label_return: 'Retour en stock', label_restock: 'Réapprovisionnement', label_supplier_receipt: 'Réception fournisseur', label_initial: 'Stock initial', label_inventory_adjustment: "Ajustement d'inventaire", label_stock_correction: 'Correction de stock', label_loss: 'Perte', label_damage: 'Produit endommagé', label_expiry: 'Expiration', label_transfer_sent: 'Transfert envoyé', label_transfer_received: 'Transfert reçu', label_transfer_cancelled: 'Transfert annulé' }
const DETAIL_FR = { 'label_sale': /^\S+$|^Vente \S+ modifiée$/, 'label_return': /^Vente \S+ (annulée|modifiée)$/, 'label_supplier_receipt': /^Bon de commande \S+$/, 'label_transfer_sent': /^\S+ · vers .+$/, 'label_transfer_received': /^\S+ · depuis .+$/ }

// Tout ce que la base contient pour un compte : mouvements, produits, membres — la référence des contrôles
async function world(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const userId = link.user.id
  const { data: mem } = await admin.from('shop_members').select('shop_id, shops(name)').eq('user_id', userId).eq('is_active', true)
  const ids = mem.map(m => m.shop_id)
  const shopName = Object.fromEntries(mem.map(m => [m.shop_id, m.shops.name]))
  const page = async (table, cols, f) => { const out = []; for (let o = 0; o < 40000; o += 1000) { const { data, error } = await f(admin.from(table).select(cols)).range(o, o + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break } return out }
  const moves = await page('stock_movements', 'id, shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, created_at, count_session_id', q => q.in('shop_id', ids).order('created_at', { ascending: false }).order('id'))
  const prods = await page('products', 'id, name, sku, unit, shop_id', q => q.in('shop_id', ids).order('id'))
  const product = Object.fromEntries(prods.map(p => [p.id, p]))
  const { data: members } = await admin.from('shop_members').select('user_id').in('shop_id', ids)
  const memberIds = [...new Set(members.map(m => m.user_id))]
  const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', [...new Set([...memberIds, ...moves.map(m => m.performed_by).filter(Boolean)])].slice(0, 300))
  const person = Object.fromEntries(profs.map(p => [p.id, p.full_name]))
  for (const m of moves) { m.view = describeMovement({ type: m.type, reason: m.reason, inventory_count: !!m.count_session_id }); m.delta = m.previous_qty != null && m.new_qty != null ? m.new_qty - m.previous_qty : m.type === 'in' ? Math.abs(m.quantity) : m.type === 'sale' || m.type === 'out' ? -Math.abs(m.quantity) : null }
  const PREFIXES = ['Sale ', 'Annulation vente ', 'Modification vente ', 'Réception ', 'Transfert ', 'Annulation transfert ', 'Restock from ']
  const search = (q, list = moves) => list.filter(m => { const p = product[m.product_id]; const r = m.reason || ''; return (p && (norm(p.name).includes(norm(q)) || norm(p.sku).includes(norm(q)))) || (memberIds.includes(m.performed_by) && norm(person[m.performed_by]).includes(norm(q))) || PREFIXES.some(x => r.startsWith(x) && r.slice(x.length).toLowerCase().includes(q.toLowerCase())) })
  // Le plus récent de chaque forme, parmi les produits qui existent encore
  const shape = (key, extra = () => true) => moves.find(m => m.view.labelKey === key && product[m.product_id] && extra(m))
  return { userId, ids, shopName, moves, product, person, memberIds, search, shape }
}
const sameIds = (got, want) => got.length === want.length && got.every((id, i) => id === want[i])
const top = (list, n = 500) => list.slice(0, n).map(m => m.id)
// Résultat du serveur (500 lignes au plus) comparé à ce que la base contient
const matchTop = (got, want) => {
  if (want.length <= 500) return sameIds(got.map(m => m.id).sort(), want.map(m => m.id).sort())
  const ids = new Set(want.map(m => m.id)), limit = want[499].created_at
  return got.length === 500 && got.every(m => ids.has(m.id) && m.created_at >= limit)
}

// Ouvre le détail d'un mouvement précis : l'écran filtré sur son produit (tous ses mouvements), puis sa ligne
async function openMovement(page, locale, m) {
  await goto(page, `/${locale}/stock/movements?product=${m.product_id}&all=1`, 2500)
  const row = page.locator(`main [data-movement-row="${m.id}"]`)
  await row.waitFor({ timeout: 30000 }).catch(() => {})
  if (!(await row.count())) return false
  await page.waitForTimeout(600)
  const answer = page.waitForResponse(r => r.url().includes(`/api/stock/movements/${m.id}`), { timeout: 30000 }).catch(() => null)
  await row.click()
  await drawer(page).waitFor({ timeout: 15000 })
  await answer
  await page.waitForTimeout(700)
  return true
}

;(async () => {
  console.log('Base :', BASE)
  const W = await world(OWNER)
  const V = await world(VITRINE)
  console.log(`Compte de test : ${W.ids.length} boutiques, ${W.moves.length} mouvements · vitrine : ${V.ids.length} boutiques, ${V.moves.length} mouvements`)

  // ══ 1. Routes ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n1. Routes — liste, recherche, détail (propriétaire)')
  const s = await open('fr', 1440, 900)
  const page = s.page
  await goto(page, '/fr/stock/movements', 7000)
  const api = q => get(page, `/api/stock/movements?shop_ids=${W.ids.join(',')}${q}`)
  const all = await api('')
  check(`sans filtre : les ${Math.min(500, W.moves.length)} plus récents des ${W.ids.length} boutiques ; chaque ligne porte sa boutique`, all.status === 200 && all.json.movements.length === Math.min(500, W.moves.length) && all.json.movements.every(m => W.ids.includes(m.shop_id) && typeof m.inventory_count === 'boolean'), all.status)
  const NT = m => !/^(Transfert|Annulation transfert) /.test(m.reason || '')
  const parts = { transfer: W.moves.filter(m => !NT(m)), sale: W.moves.filter(m => m.type === 'sale' && NT(m)), in: W.moves.filter(m => m.type === 'in' && NT(m)), adjustment: W.moves.filter(m => !['in', 'sale'].includes(m.type) && NT(m)) }
  for (const k of ['in', 'sale', 'adjustment', 'transfer']) { const r = await api('&kind=' + k); check(`kind=${k} : ${Math.min(500, parts[k].length)} mouvements, les bons`, r.status === 200 && sameIds(r.json.movements.map(m => m.id).sort(), top(parts[k]).sort()), r.json?.movements?.length) }
  check(`les quatre catégories se partagent tous les mouvements (${parts.in.length} + ${parts.sale.length} + ${parts.adjustment.length} + ${parts.transfer.length} = ${W.moves.length})`, parts.in.length + parts.sale.length + parts.adjustment.length + parts.transfer.length === W.moves.length)
  check('type inconnu : refusé (400)', (await api('&kind=nimporte')).status === 400)

  // Recherche : chaque cas est comparé à ce que la base contient, calculé ici indépendamment
  const saleM = W.shape('label_sale'), retM = W.shape('label_return'), poM = W.shape('label_supplier_receipt'), trM = W.shape('label_transfer_sent') || W.shape('label_transfer_received')
  const withSku = W.moves.find(m => W.product[m.product_id] && (W.product[m.product_id].sku || '').length >= 3)
  const withPerson = W.moves.find(m => W.memberIds.includes(m.performed_by) && (W.person[m.performed_by] || '').length >= 3)
  const accented = Object.values(W.product).find(p => /[éèêàçôûîï]/i.test(p.name) && W.moves.some(m => m.product_id === p.id))
  const cases = [
    ['numéro de vente', saleM.view.origin.ref],
    ['numéro d’une vente annulée', retM.view.origin.ref],
    ['référence de bon de commande', poM.view.origin.ref],
    ['référence de transfert', trM.view.origin.ref],
    ['nom de produit (majuscules)', W.product[saleM.product_id].name.slice(0, 5).toUpperCase()],
    ...(accented ? [['nom de produit tapé sans accent (« ' + norm(accented.name) + ' » pour « ' + accented.name + ' »)', norm(accented.name)]] : []),
    ...(withSku ? [['code du produit (SKU / code-barres)', W.product[withSku.product_id].sku]] : []),
    ...(withPerson ? [['nom d’employé', W.person[withPerson.performed_by].split(' ')[0].toLowerCase()]] : []),
    ['« sale » : pas toutes les ventes (leur motif commence par « Sale »)', 'sale'],
  ]
  for (const [label, q] of cases) {
    const want = W.search(q.trim())
    const r = await api('&q=' + encodeURIComponent(q))
    check(`recherche par ${label} — « ${q} » : ${Math.min(500, want.length)} mouvement(s)`, r.status === 200 && want.length > 0 === r.json.movements.length > 0 && matchTop(r.json.movements, want), `reçu ${r.json?.movements?.length}, attendu ${want.length}`)
  }
  check(`« sale » ne ramène pas les ${parts.sale.length} ventes`, W.search('sale').length < parts.sale.length / 2, W.search('sale').length)
  const pq = W.product[saleM.product_id].name.slice(0, 4)
  const combo = await api(`&kind=sale&q=${encodeURIComponent(pq)}`)
  check(`recherche + type : « ${pq} » dans « Ventes » — ${W.search(pq, parts.sale).length} mouvement(s), que des ventes`, sameIds(combo.json.movements.map(m => m.id).sort(), top(W.search(pq, parts.sale)).sort()) && combo.json.movements.every(m => m.type === 'sale'), combo.json?.movements?.length)
  const combo2 = await api(`&product_id=${retM.product_id}&q=${encodeURIComponent(retM.view.origin.ref)}`)
  check('recherche + produit filtré : seulement ce produit', combo2.json.movements.length > 0 && combo2.json.movements.every(m => m.product_id === retM.product_id) && sameIds(combo2.json.movements.map(m => m.id).sort(), top(W.search(retM.view.origin.ref, W.moves.filter(m => m.product_id === retM.product_id))).sort()))
  check('une seule lettre : pas de recherche (liste complète)', (await api('&q=a')).json.movements.length === all.json.movements.length)
  check('caractères de filtre dans la recherche : sans effet (pas d’erreur)', [200].includes((await api('&q=' + encodeURIComponent('a,b)or(id.gt.0%'))).status))
  check('recherche sans résultat : liste vide (200)', (await api('&q=zzzqqqxxx')).json.movements.length === 0)

  const det = async id => get(page, `/api/stock/movements/${id}`)
  const d1 = await det(saleM.id)
  const saleRow = (await admin.from('sales').select('id, sale_number, sale_status, created_at').eq('shop_id', saleM.shop_id).eq('sale_number', saleM.view.origin.ref)).data
  check('détail d’une vente : mouvement, produit (nom, code, photo), boutique, employé', d1.status === 200 && d1.json.movement.id === saleM.id && d1.json.movement.product.name === W.product[saleM.product_id].name && d1.json.movement.shop_name === W.shopName[saleM.shop_id] && 'sku' in d1.json.movement.product && 'image_url' in d1.json.movement.product, d1.status)
  check(`… origine retrouvée : vente ${saleM.view.origin.ref}, statut « ${saleRow[0] && saleRow[0].sale_status} », ouvrable`, saleRow.length === 1 && d1.json.origin && d1.json.origin.kind === 'sale' && d1.json.origin.ref === saleRow[0].sale_number && d1.json.origin.status === saleRow[0].sale_status && d1.json.origin.can_open === true, JSON.stringify(d1.json.origin))
  const d2 = await det(poM.id), d3 = await det(trM.id)
  check('détail d’une réception : bon de commande retrouvé, avec son fournisseur', d2.json.origin && d2.json.origin.kind === 'purchase_order' && d2.json.origin.ref === poM.view.origin.ref && typeof d2.json.origin.supplier_name === 'string', JSON.stringify(d2.json.origin))
  check('détail d’un transfert : boutique de départ et d’arrivée', d3.json.origin && d3.json.origin.kind === 'transfer' && d3.json.origin.source_shop && d3.json.origin.destination_shop && d3.json.origin.source_shop !== d3.json.origin.destination_shop, JSON.stringify(d3.json.origin))
  const d4 = await det(W.shape('label_initial').id)
  check('détail d’un stock initial : aucune origine inventée', d4.status === 200 && d4.json.origin === null)
  check('identifiant illisible : 400 ; mouvement inexistant : 404', (await det('xyz')).status === 400 && (await det('00000000-0000-4000-8000-000000000000')).status === 404)
  check('mouvement d’un AUTRE compte (vitrine) : « introuvable » (404), ni en détail ni en liste (403)', (await det(V.moves[0].id)).status === 404 && (await get(page, `/api/stock/movements?shop_ids=${V.ids[0]}`)).status === 403)
  const leak = t => /buying_price|unit_cost|cost_price|"cost"|margin|profit|stock_value/i.test(t)
  check('aucun prix d’achat, coût, marge ni valeur dans les réponses (liste et détails)', ![all, d1, d2, d3, d4].some(r => leak(JSON.stringify(r.json))))

  // ══ 2. Écran, ordinateur ═════════════════════════════════════════════════════════════════════════════════
  console.log('\n2. Écran — propriétaire, ordinateur (toutes les boutiques)')
  await goto(page, '/fr/stock/movements', 6500)
  let list = await rows(page)
  check('structure inchangée : Tous | Entrées | Ventes | Ajustements | Transferts, « Tous » par défaut, recherche, période, compteur, liste', (await page.locator('main button[data-kind]').allInnerTexts()).join(' | ') === 'Tous | Entrées | Ventes | Ajustements | Transferts' && (await pressed(page)).join() === 'all' && (await page.locator('[data-testid="movements-search"]').count()) === 1 && (await page.locator('main input[type="date"]').count()) === 2 && /mouvements/.test(await page.locator('[data-testid="movements-count"]').innerText()) && list.length === Math.min(500, W.moves.length), list.length)
  check('indication de la recherche : « Produit, référence, employé… »', (await page.locator('[data-testid="movements-search"]').getAttribute('placeholder')) === 'Produit, référence, employé…')
  check('aucun nouvel indicateur, graphique ni sous-onglet', (await page.locator('main canvas, main svg.recharts-surface, main [role="tablist"]').count()) === 1 && !/Total restocké|Produits suivis/.test(await page.locator('main').innerText()))
  const byId = Object.fromEntries(W.moves.map(m => [m.id, m]))
  const wrong = list.filter(r => { const m = byId[r.id]; return !m || r.key !== m.view.labelKey || (LABEL_FR[r.key] && r.label !== LABEL_FR[r.key]) || r.product !== (W.product[m.product_id]?.name || '').trim() && r.product !== 'Produit supprimé' || (m.delta !== null ? r.delta !== signed(m.delta) : r.delta !== null) })
  check(`les ${list.length} lignes : produit, libellé métier, quantité signée — conformes à la base`, wrong.length === 0, JSON.stringify(wrong.slice(0, 2)))
  check('plus aucun libellé technique : ni « Entrée · … », ni « Sale … », ni « Restock », ni « Inventaire physique — »', !list.some(r => /^(Entrée|Sortie)$/.test(r.label) || /^Sale |Restock|Annulation vente|Inventaire physique —|·.*·.*·.*·/.test(r.detail || '')), JSON.stringify(list.find(r => /Sale |Restock/.test(r.detail || ''))))
  const badDetail = list.filter(r => DETAIL_FR[r.key] && !DETAIL_FR[r.key].test(r.detail || ''))
  check('seconde ligne = la référence : numéro de vente seul, « Vente … annulée », « Bon de commande … », « TR-… · vers / depuis … »', badDetail.length === 0, JSON.stringify(badDetail.slice(0, 2)))
  const ex = list.find(r => r.key === 'label_return')
  check(`exemple demandé : « ${ex.label} » puis « ${ex.detail} »`, ex.label === 'Retour en stock' && /^Vente \S+ annulée$/.test(ex.detail))
  check('plusieurs boutiques affichées ensemble : chaque ligne nomme la sienne, discrètement', list.every(r => r.shop === W.shopName[byId[r.id].shop_id]), JSON.stringify(list.find(r => r.shop !== W.shopName[byId[r.id].shop_id])))
  const days = await page.locator('main [data-movement-day]').allInnerTexts()
  const dayOf = iso => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
  const nDays = new Set(list.map(r => dayOf(byId[r.id].created_at))).size
  check(`lignes regroupées par jour (${days.length} jours : ${days.slice(0, 3).join(', ')}…) ; la ligne ne garde que l’heure`, days.length === nDays && (dayOf(byId[list[0].id].created_at) === dayOf(new Date().toISOString()) ? /^aujourd/i.test(days[0]) : true) && days.slice(2).every(d => /\d{4}/.test(d)) && list.every(r => /^\d{2}:\d{2}( ·|$)/.test(r.meta)), `${days.length} / ${nDays} · ${list[0].meta}`)
  await page.screenshot({ path: `${__dirname}/out/mov-ux-liste-1440.png` })

  // Toute la ligne ouvre le détail ; rien n'est rechargé ; on retrouve la liste où on l'a laissée
  await pill(page, 'sale').click(); await settle(page)
  await page.locator('[data-testid="movements-search"]').fill(pq); await settle(page, 1200)
  const before = { rows: (await rows(page)).length, url: page.url() }
  const scroller = await page.evaluateHandle(() => { let el = document.querySelector('[data-testid="movement-list"]'); while (el && el !== document.documentElement) { const st = getComputedStyle(el); if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 10) return el; el = el.parentElement } return document.scrollingElement })
  await scroller.evaluate(el => { el.scrollTop = 600 }); await page.waitForTimeout(2000)
  const y0 = await scroller.evaluate(el => el.scrollTop)
  let listCalls = 0
  const drift = []
  const counter = r => { if (/\/api\/stock\/movements\?/.test(r.url())) listCalls++ }
  page.on('request', counter)
  for (const [where, fx] of [['à gauche (pictogramme)', 0.03], ['au milieu', 0.5], ['à droite (quantité)', 0.97]]) {
    const target = await page.evaluate(f => { const b = [...document.querySelectorAll('main [data-movement-row]')].find(x => { const r = x.getBoundingClientRect(); return r.top > 200 && r.bottom < window.innerHeight - 80 }); const r = b.getBoundingClientRect(); return { id: b.dataset.movementRow, x: r.left + r.width * f, y: r.top + r.height / 2, cursor: getComputedStyle(b).cursor, tag: b.tagName } }, fx)
    const yA = await scroller.evaluate(el => [el.scrollTop, el.scrollHeight])
    await page.mouse.move(target.x, target.y); await page.waitForTimeout(150)
    const hover = await page.evaluate(id => getComputedStyle(document.querySelector(`[data-movement-row="${id}"]`)).backgroundColor, target.id)
    await page.mouse.click(target.x, target.y)
    const opened = await drawer(page).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
    await page.waitForTimeout(900)
    const m = byId[target.id]
    check(`clic ${where} de la ligne : le détail de CE mouvement s’ouvre (pas la fiche produit) — curseur main, survol marqué`, opened && (await fiche(page).count()) === 0 && target.tag === 'BUTTON' && target.cursor === 'pointer' && hover !== 'rgba(0, 0, 0, 0)' && (await dtext(page)).includes(W.product[m.product_id].name) && (await dtext(page)).includes(m.view.origin.ref), `${opened} ${target.cursor} ${hover}`)
    if (fx === 0.5) await page.keyboard.press('Escape'); else await closeDrawer(page)
    await page.waitForTimeout(500)
    const yB = await scroller.evaluate(el => [el.scrollTop, el.scrollHeight])
    drift.push(yA.join('/') + ' → ' + yB.join('/'))
    if (yA[0] !== yB[0]) listCalls += 1000
  }
  page.off('request', counter)
  const after = { rows: (await rows(page)).length, url: page.url(), y: await scroller.evaluate(el => el.scrollTop), kind: (await pressed(page)).join(), q: await page.locator('[data-testid="movements-search"]').inputValue() }
  check(`ouvrir puis fermer (bouton ✕ et Échap) : même type (« Ventes »), même recherche (« ${pq} »), même position de défilement à chaque fois (${drift.join(' ; ')}), mêmes ${before.rows} lignes, aucun rechargement de la liste`, after.kind === 'sale' && after.q === pq && y0 > 0 && after.rows === before.rows && after.url === before.url && listCalls === 0, JSON.stringify({ ...after, y0, listCalls }))
  await page.locator('[data-testid="movements-search"]').fill(''); await pill(page, 'all').click(); await settle(page)

  // Chaque forme de mouvement présente dans la base : le panneau dit ce qui s'est passé, et rien d'inventé
  console.log('\n3. Détail de chaque type de mouvement (ordinateur)')
  const verify = async (pg, w, m, name, { shopShown = true, actions = null } = {}) => {
    const t = await dtext(pg)
    const title = (await drawer(pg).locator('p.text-lg').first().innerText()).trim()
    const qty = (await drawer(pg).locator('[data-testid="movement-detail-quantity"] span').first().innerText()).trim()
    const both = m.previous_qty != null && m.new_qty != null
    const [bf, af, by, shop, note, reason] = [await field(pg, 'before'), await field(pg, 'after'), await field(pg, 'by'), await field(pg, 'shop'), await field(pg, 'note'), await field(pg, 'reason')]
    const origin = (await drawer(pg).locator('[data-testid="movement-detail-origin"]').count()) ? await drawer(pg).locator('[data-testid="movement-detail-origin"]').getAttribute('data-origin') : null
    const acts = (await drawer(pg).locator('[data-testid="movement-detail-actions"] button').allInnerTexts()).map(x => x.trim())
    const problems = []
    if (title !== LABEL_FR[m.view.labelKey]) problems.push('titre ' + title)
    if (qty !== (m.delta === null ? String(Math.abs(m.quantity)) : signed(m.delta))) problems.push('quantité ' + qty)
    if (!t.includes(w.product[m.product_id].name)) problems.push('produit absent')
    if (both ? !(bf === String(m.previous_qty) && af === String(m.new_qty)) : !(bf === null && af === null)) problems.push(`avant/après ${bf}/${af} (base ${m.previous_qty}/${m.new_qty})`)
    if ((await field(pg, 'date')) === null || !/^\d{2}:\d{2}$/.test(await field(pg, 'time') || '')) problems.push('date/heure')
    if ((w.person[m.performed_by] || null) !== by) problems.push('employé ' + by)
    if (shopShown ? shop !== w.shopName[m.shop_id] : shop !== null) problems.push('boutique ' + shop)
    if ((m.notes || null) !== note) problems.push('note ' + note)
    if ((m.view.freeReason || null) !== reason) problems.push('motif ' + reason)
    if ((m.view.origin ? m.view.origin.kind : null) !== origin) problems.push('origine ' + origin)
    const fixed = [m.notes, m.view.freeReason].filter(Boolean).reduce((x, own) => x.split(own.replace(/\s+/g, ' ')).join(''), t)
    if (/(^| )(—|N\/A|undefined|null|NaN)( |$)|Non disponible|[{}]|movements\./.test(fixed)) problems.push('texte parasite')
    if (actions && actions.join(' | ') !== acts.join(' | ')) problems.push('actions « ' + acts.join(' | ') + ' »')
    check(`${name} : « ${title} ${qty} » — ${both ? `stock ${m.previous_qty} → ${m.new_qty}` : 'avant / après non enregistrés : rien affiché'}${origin ? ', origine ' + origin : ''}${acts.length ? ' ; ' + acts.join(', ') : ''}`, problems.length === 0, problems.join(' ; ') + ' :: ' + t.slice(0, 260))
  }
  const A = { sale: 'Voir la vente', order: 'Voir la commande', transfer: 'Voir le transfert', product: 'Voir la fiche produit' }
  const shapesW = [
    ['vente', W.shape('label_sale'), [A.sale, A.product]],
    ['vente annulée (retour)', W.shape('label_return', m => m.view.origin.cancelled), [A.sale, A.product]],
    ['réapprovisionnement', W.shape('label_restock', m => !m.view.origin), [A.product]],
    ['réapprovisionnement chez un fournisseur', W.shape('label_restock', m => !!m.view.origin), [A.product]],
    ['réception fournisseur', W.shape('label_supplier_receipt'), [A.order, A.product]],
    ['stock initial', W.shape('label_initial'), [A.product]],
    ['correction de stock', W.shape('label_stock_correction'), [A.product]],
    ['perte', W.shape('label_loss', m => !m.view.origin), [A.product]],
    ['perte constatée à l’inventaire', W.shape('label_loss', m => !!m.view.origin), [A.product]],
    ['produit endommagé', W.shape('label_damage'), [A.product]],
    ['transfert envoyé', W.shape('label_transfer_sent'), [A.transfer, A.product]],
    ['transfert reçu', W.shape('label_transfer_received'), [A.transfer, A.product]],
    ['transfert annulé', W.shape('label_transfer_cancelled'), [A.transfer, A.product]],
    ['lot corrigé à la main', W.shape('label_stock_correction', m => !!m.view.origin && m.view.origin.kind === 'batch'), [A.product]],
  ]
  for (const [name, m, actions] of shapesW) {
    if (!m) { console.log('  (absent de la base de test) ' + name); continue }
    if (!(await openMovement(page, 'fr', m))) { check(name + ' : ligne trouvée', false, m.id); continue }
    await verify(page, W, m, name, { actions })
    if (name === 'vente annulée (retour)') {
      check('… statut « Annulée » à côté du numéro de vente', (await drawer(page).locator('[data-sale-status="cancelled"]').innerText()) === 'Annulée')
      await page.screenshot({ path: `${__dirname}/out/mov-ux-detail-1440.png` })
    }
    if (name === 'transfert annulé') check('… statut « Annulé » à côté de la référence du transfert', (await drawer(page).locator('[data-transfer-status="cancelled"]').innerText()) === 'Annulé')
    if (name === 'transfert envoyé') check('… boutique de départ et d’arrivée nommées', (await dtext(page)).includes('De ' + W.shopName[m.shop_id]) && (await dtext(page)).includes('Vers ' + m.view.origin.otherShop), await dtext(page))
    await closeDrawer(page)
  }
  const noBA = W.moves.filter(m => m.view.labelKey === 'label_sale' && m.previous_qty == null).length
  console.log(`     (ventes sans avant / après en base : ${noBA} sur ${parts.sale.length} — le panneau n’affiche alors aucune ligne « Stock avant / après »)`)

  // Fiche produit par-dessus, puis retour
  console.log('\n4. Actions secondaires')
  await openMovement(page, 'fr', retM)
  await drawer(page).locator('[data-testid="movement-detail-product-action"]').click()
  await fiche(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(2500)
  const ft = (await fiche(page).innerText()).replace(/\s+/g, ' ')
  check('« Voir la fiche produit » : la fiche du produit s’ouvre (même fiche, en consultation : aucune action de modification)', ft.includes(W.product[retM.product_id].name) && /Disponible/.test(ft) && (await fiche(page).locator('[data-testid="product-detail-actions"]').count()) === 0, ft.slice(0, 200))
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)
  check('fermer la fiche : retour au détail du mouvement ; le fermer : retour à la liste', (await fiche(page).count()) === 0 && (await drawer(page).count()) === 1)
  await closeDrawer(page)
  check('… liste toujours filtrée sur le produit', (await drawer(page).count()) === 0 && (await page.locator('[data-testid="movements-product-filter"]').count()) === 1)
  // Pastille produit : ✕ ne retire QUE le produit
  await pill(page, 'in').click(); await settle(page)
  await page.locator('[data-testid="movements-search"]').fill(retM.view.origin.ref); await settle(page, 1200)
  const from = '2026-01-01'
  await page.locator('main input[type="date"]').first().fill(from); await settle(page)
  check('produit filtré + type + recherche + période : la recherche reste visible à côté de la pastille', (await page.locator('[data-testid="movements-search"]').isVisible()) && (await rows(page)).every(r => r.detail && r.detail.includes(retM.view.origin.ref)) && (await rows(page)).length > 0, (await rows(page)).length)
  await page.locator('[data-testid="movements-product-filter"] button').click(); await settle(page, 1500)
  check('✕ de la pastille : seul le filtre produit est retiré — type « Entrées », recherche et période conservés', !/product=/.test(page.url()) && (await page.locator('[data-testid="movements-product-filter"]').count()) === 0 && (await pressed(page)).join() === 'in' && (await page.locator('[data-testid="movements-search"]').inputValue()) === retM.view.origin.ref && (await page.locator('main input[type="date"]').first().inputValue()) === from, page.url())
  await page.locator('[data-testid="movements-search"]').fill(''); await page.locator('main input[type="date"]').first().fill(''); await pill(page, 'all').click(); await settle(page)

  // Écrans d'origine : ils existent déjà, on y arrive avec leur propre recherche posée sur la référence
  for (const [name, m, urlRe, action] of [['vente', saleM, /\/fr\/sales\/history/, A.sale], ['commande', poM, /\/fr\/suppliers\?view=purchase_orders/, A.order], ['transfert', trM, /\/fr\/stock\/transfers/, A.transfer]]) {
    await openMovement(page, 'fr', m)
    await drawer(page).locator('[data-testid="movement-detail-origin-action"]').click()
    await page.waitForURL(urlRe, { timeout: 30000 })
    await page.waitForFunction(ref => (document.querySelector('main') || document.body).innerText.includes(ref), m.view.origin.ref, { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(800)
    const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    check(`« ${action} » : l’écran existant s’ouvre et montre ${m.view.origin.ref}`, main.includes(m.view.origin.ref) && !/Accès non autorisé/.test(main), main.slice(0, 200))
  }
  await s.browser.close()

  // Une boutique précise : son nom n'est pas répété sur les lignes
  const one = await open('fr', 1440, 900, { only: ALPHA })
  await goto(one.page, '/fr/stock/movements', 6500)
  const l1 = await rows(one.page)
  check(`une boutique précise (${W.shopName[ALPHA]}) : ses ${Math.min(500, W.moves.filter(m => m.shop_id === ALPHA).length)} mouvements, sans répéter son nom sur chaque ligne`, l1.length === Math.min(500, W.moves.filter(m => m.shop_id === ALPHA).length) && l1.every(r => r.shop === null && byId[r.id].shop_id === ALPHA), l1.length)
  await one.page.locator(`main [data-movement-row="${l1[0].id}"]`).click(); await drawer(one.page).waitFor(); await one.page.waitForTimeout(1500)
  check('… le détail rappelle la boutique (compte à plusieurs boutiques)', (await field(one.page, 'shop')) === W.shopName[ALPHA])
  await one.browser.close()

  // ══ 5. Vitrine : types absents du compte de test ═════════════════════════════════════════════════════════
  console.log('\n5. Autres types (Marché Soleil, consultation seulement)')
  const v = await open('fr', 1440, 900, { email: VITRINE, shop: V.ids[0] })
  for (const [name, m] of [['ajustement d’inventaire', V.shape('label_inventory_adjustment')], ['expiration', V.shape('label_expiry')], ['transfert reçu', V.shape('label_transfer_received')]]) {
    if (!m) { console.log('  (absent) ' + name); continue }
    if (!(await openMovement(v.page, 'fr', m))) { check(name + ' : ligne trouvée', false, m.id); continue }
    await verify(v.page, V, m, name)
    await closeDrawer(v.page)
  }
  await v.browser.close()

  // ══ 6. Rôles ═════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n6. Rôles')
  const mg = await open('fr', 1280, 900, { email: MANAGER })
  await goto(mg.page, '/fr/stock/movements', 6500)
  check('gérant : écran ouvert, liste chargée', (await rows(mg.page)).length > 0 && (await mg.page.locator('[data-testid="movements-no-access"]').count()) === 0)
  await openMovement(mg.page, 'fr', poM)
  check('gérant : détail d’une réception, avec « Voir la commande » et « Voir la fiche produit »', (await drawer(mg.page).locator('[data-testid="movement-detail-actions"] button').allInnerTexts()).map(x => x.trim()).join(' | ') === `${A.order} | ${A.product}`)
  await mg.browser.close()

  const ca = await open('fr', 1280, 900, { email: CASHIER })
  await goto(ca.page, '/fr/stock/movements', 6500)
  const cl = await rows(ca.page)
  check('caissier (Mouvements en lecture) : écran ouvert, liste chargée', cl.length > 0)
  const cashierId = (await admin.auth.admin.generateLink({ type: 'magiclink', email: CASHIER })).data.user.id
  const others = W.moves.find(m => m.view.labelKey === 'label_sale' && m.shop_id === ALPHA && m.performed_by !== cashierId && W.product[m.product_id])
  const { data: othersSale } = await admin.from('sales').select('id, cashier_id').eq('shop_id', ALPHA).eq('sale_number', others.view.origin.ref)
  await openMovement(ca.page, 'fr', others)
  const cActs = (await drawer(ca.page).locator('[data-testid="movement-detail-actions"] button').allInnerTexts()).map(x => x.trim())
  check(`caissier : vente d’un collègue (${others.view.origin.ref}) — le détail s’affiche, sans « Voir la vente » (l’historique ne lui montre que ses ventes)`, othersSale.length === 1 && othersSale[0].cashier_id !== cashierId ? !cActs.includes(A.sale) && cActs.includes(A.product) : true, cActs.join(' | '))
  await closeDrawer(ca.page)
  await openMovement(ca.page, 'fr', poM)
  const cPo = (await drawer(ca.page).locator('[data-testid="movement-detail-actions"] button').allInnerTexts()).map(x => x.trim())
  check('caissier : réception fournisseur — référence du bon affichée, mais pas de « Voir la commande » (pas d’accès Fournisseurs)', (await dtext(ca.page)).includes(poM.view.origin.ref) && !cPo.includes(A.order), cPo.join(' | '))
  await drawer(ca.page).locator('[data-testid="movement-detail-product-action"]').click()
  await fiche(ca.page).waitFor({ timeout: 15000 }); await ca.page.waitForTimeout(3000)
  check('caissier : fiche produit ouverte depuis le mouvement — sans section Achat', (await fiche(ca.page).locator('[data-testid="product-detail-purchase"]').count()) === 0 && !/Prix d.achat|Valeur du stock/.test(await fiche(ca.page).innerText()))
  await ca.page.keyboard.press('Escape'); await ca.page.waitForTimeout(700); await closeDrawer(ca.page)
  if (W.shape('label_transfer_sent')) {
    await openMovement(ca.page, 'fr', W.shape('label_transfer_sent'))
    check('caissier : transfert — pas de « Voir le transfert » (pas d’accès Transferts)', !(await drawer(ca.page).locator('[data-testid="movement-detail-actions"] button').allInnerTexts()).some(x => x.trim() === A.transfer))
    await closeDrawer(ca.page)
  }
  const leaks = ca.bodies.filter(b => /"buying_price"|"unit_cost"|"stock_value"|"margin"|"profit"/.test(b.text))
  check(`caissier : aucun prix d’achat, coût, marge ni valeur dans les ${ca.bodies.length} réponses reçues par le navigateur pendant ce parcours`, ca.bodies.length > 20 && leaks.length === 0, leaks.map(b => b.url.slice(0, 90)).join(' , '))
  await ca.browser.close()

  // Garde d'entrée : le droit « Mouvements » retiré au caissier DANS LE NAVIGATEUR seulement (base intacte)
  const ng = await open('fr', 1280, 900, { email: CASHIER, patchPerms: rp => { rp.cashier = { ...(rp.cashier || {}), movements: false } } })
  let asked = 0
  ng.page.on('request', r => { if (/\/api\/stock\/movements/.test(r.url())) asked++ })
  await goto(ng.page, '/fr/stock/movements', 6500)
  check('sans le droit « Mouvements », l’adresse tapée à la main : « Accès non autorisé », rien n’est demandé au serveur', (await ng.page.locator('[data-testid="movements-no-access"]').count()) === 1 && (await ng.page.locator('main [data-movement-row]').count()) === 0 && asked === 0, asked)
  await ng.browser.close()

  // ══ 7. Langues ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n7. Langues')
  for (const locale of ['en', 'ha']) {
    const M = MSG(locale).movements
    const o = await open(locale, 1280, 900)
    await goto(o.page, `/${locale}/stock/movements`, 6500)
    const l = await rows(o.page)
    const main = (await o.page.locator('main').innerText())
    check(`${locale} : filtres, indication de recherche (« ${M.search_placeholder} ») et libellés dans la langue`, (await o.page.locator('main button[data-kind]').allInnerTexts()).join('|') === [M.kind_all, M.kind_in, M.kind_sale, M.kind_adjustment, M.kind_transfer].join('|') && (await o.page.locator('[data-testid="movements-search"]').getAttribute('placeholder')) === M.search_placeholder && l.length > 0 && l.every(r => r.label === M[r.key]) && !/[{}]|movements\.|label_|Retour en stock|Réception fournisseur|Vente \S+ annulée/.test(main), l[0] && l[0].label)
    check(`${locale} : compteur accordé (« ${(await o.page.locator('[data-testid="movements-count"]').innerText()).slice(0, 40)} ») et jours (« ${(await o.page.locator('main [data-movement-day]').first().innerText())} »)`, !/[{}]|plural/.test(await o.page.locator('[data-testid="movements-count"]').innerText()) && (await o.page.locator('main [data-movement-day]').count()) > 0)
    await openMovement(o.page, locale, retM)
    const t = await dtext(o.page)
    const expected = [M.label_return, M.detail_category.toUpperCase(), M.detail_section, M.detail_stock_before, M.detail_date, M.detail_time, M.detail_by, M.detail_shop, M.detail_origin, M.origin_sale, M.origin_sale_cancelled, M.view_sale, M.view_product].filter(x => !(x === M.detail_stock_before && retM.previous_qty == null))
    check(`${locale} : détail entièrement dans la langue (« ${M.label_return} », ${M.detail_date}, ${M.detail_time}, ${M.detail_by}, ${M.origin_sale_cancelled}, ${M.view_sale}…)`, expected.every(x => t.toUpperCase().includes(x.toUpperCase())) && !/[{}]|movements\.|Retour en stock|Effectué par|Annulée|Voir la/.test(t), expected.filter(x => !t.toUpperCase().includes(x.toUpperCase())).join(' / ') + ' :: ' + t.slice(0, 200))
    await o.page.screenshot({ path: `${__dirname}/out/mov-ux-detail-${locale}.png` })
    await o.browser.close()
  }

  // ══ 8. Téléphone, tablette ═══════════════════════════════════════════════════════════════════════════════
  console.log('\n8. Téléphone et tablette')
  for (const [wd, hg, kind] of [[360, 740, 'petit téléphone'], [390, 844, 'téléphone'], [820, 1180, 'tablette']]) {
    const o = await open('fr', wd, hg)
    await goto(o.page, '/fr/stock/movements', 6500)
    const geo = () => o.page.evaluate(() => { const c = document.querySelector('[data-testid="movements-kinds"]'); const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { overflow: document.documentElement.scrollWidth - window.innerWidth, scrollable: c.scrollWidth > c.clientWidth + 1, mask: cs.maskImage && cs.maskImage !== 'none' ? cs.maskImage : (cs.webkitMaskImage && cs.webkitMaskImage !== 'none' ? cs.webkitMaskImage : ''), left: r.left, right: r.right, scroll: c.scrollLeft, pills: [...c.querySelectorAll('button')].map(b => { const x = b.getBoundingClientRect(); const cx = x.left + x.width / 2, cy = x.top + x.height / 2; const hit = dy => { const e = document.elementFromPoint(Math.min(Math.max(cx, r.left + 2), r.right - 2), cy + dy); return !!e && e.closest('button[data-kind]') === b }; return { k: b.dataset.kind, l: Math.round(x.left), r: Math.round(x.right), h: x.height, tall: hit(-23) && hit(23), on: b.getAttribute('aria-pressed') === 'true' } }) } })
    let g = await geo()
    check(`${kind} ${wd} px : cinq pastilles sur une ligne (pas de menu déroulant), page sans débordement${g.scrollable ? ', rangée défilante avec bord estompé à droite' : ''}`, g.pills.length === 5 && g.overflow <= 0 && (await o.page.locator('main select').count()) === 0 && (!g.scrollable || /transparent|rgba\(0, 0, 0, 0\)/.test(g.mask)), JSON.stringify({ o: g.overflow, m: g.mask.slice(0, 60) }))
    if (g.scrollable) {
      await o.page.screenshot({ path: `${__dirname}/out/mov-ux-liste-${wd}.png` })
      await pill(o.page, 'transfer').click(); await settle(o.page, 1200)
      g = await geo()
      const tr = g.pills.find(p => p.k === 'transfer')
      check(`${kind} : « Transferts » choisi — pastille entièrement visible (${tr.l}–${tr.r} px dans ${Math.round(g.left)}–${Math.round(g.right)}), nettement marquée, bord estompé passé à gauche`, tr.on && tr.l >= g.left && tr.r <= g.right + 0.5 && g.scroll > 0 && /transparent|rgba\(0, 0, 0, 0\)/.test(g.mask), JSON.stringify(tr) + g.mask.slice(0, 80))
      check(`${kind} : zone tactile des pastilles ≥ 46 px de haut (pastille de ${tr.h} px)`, tr.tall && tr.h >= 40, JSON.stringify(tr))
      await o.page.screenshot({ path: `${__dirname}/out/mov-ux-pastilles-${wd}.png` })
      await pill(o.page, 'all').click(); await settle(o.page, 1200)
      g = await geo()
      check(`${kind} : retour à « Tous » — la rangée revient au début`, g.pills[0].on && g.pills[0].l >= g.left - 0.5 && g.scroll === 0, JSON.stringify(g.pills[0]))
    } else {
      await o.page.screenshot({ path: `${__dirname}/out/mov-ux-liste-${wd}.png` })
    }
    // Toute la carte est la zone tactile
    // Mise à jour (15 oct. 2026) — ancienne hypothèse : la 5e ligne a toujours un produit existant. Réel : des mouvements
    // de produits supprimés (essais) peuvent être les plus récents ; sans produit, le détail n'affiche aucune action
    // (règle : action seulement si l'objet existe). On vise la 1re ligne, à partir de la 5e, dont le produit existe.
    const rowIds = await o.page.locator('main [data-movement-row]').evaluateAll(els => els.map(e => e.dataset.movementRow))
    let rowIdx = rowIds.findIndex((id, i) => i >= 4 && byId[id]?.product_id && W.product[byId[id].product_id])
    if (rowIdx < 0) rowIdx = 4
    await o.page.locator('main [data-movement-row]').nth(rowIdx).evaluate(el => el.scrollIntoView({ block: 'center' })); await o.page.waitForTimeout(2000)
    const first = await o.page.evaluate(i => { const b = document.querySelectorAll('main [data-movement-row]')[i]; const r = b.getBoundingClientRect(); return { id: b.dataset.movementRow, x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, mw: Math.round(document.querySelector('main').getBoundingClientRect().width) } }, rowIdx)
    // Mise à jour (23 oct. 2026) : mesurée par rapport à la zone de contenu (le menu latéral peut occuper la gauche en tablette)
    check(`${kind} : la ligne entière est la zone tactile (${Math.round(first.w)} × ${Math.round(first.h)} px sur ${first.mw} de contenu)`, first.w > first.mw * 0.8 && first.h >= 48, JSON.stringify(first))
    const y0m = await o.page.evaluate(() => window.scrollY + (document.querySelector('main') ? document.querySelector('main').scrollTop : 0))
    await o.page.touchscreen.tap(first.x + first.w * 0.8, first.y + first.h / 2)
    const opened = await drawer(o.page).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
    await o.page.waitForTimeout(1800)
    const box = opened ? await drawer(o.page).boundingBox() : { x: 0, y: 0, width: 0, height: 0 }
    const m = byId[first.id]
    if (wd < 640) check(`${kind} : toucher la ligne ouvre le détail en plein écran (${Math.round(box.width)} × ${Math.round(box.height)} px), pied d’actions visible`, opened && box.width >= wd - 1 && box.height >= hg - 1 && box.x === 0 && (await drawer(o.page).locator('[data-testid="movement-detail-actions"]').isVisible()) && (await dtext(o.page)).includes(W.product[m.product_id].name), JSON.stringify(box))
    else check(`${kind} : toucher la ligne ouvre le panneau à droite (${Math.round(box.width)} px de large, pleine hauteur), la liste reste visible derrière`, opened && Math.round(box.width) === 520 && Math.round(box.x + box.width) === wd && box.height >= hg - 1, JSON.stringify(box))
    const inner = await drawer(o.page).evaluate(el => el.scrollWidth - el.clientWidth)
    check(`${kind} : rien ne déborde dans le panneau`, inner <= 0, inner)
    await o.page.screenshot({ path: `${__dirname}/out/mov-ux-detail-${wd}.png` })
    await closeDrawer(o.page)
    const y1m = await o.page.evaluate(() => window.scrollY + (document.querySelector('main') ? document.querySelector('main').scrollTop : 0))
    check(`${kind} : panneau fermé — même position dans la liste`, (await drawer(o.page).count()) === 0 && y1m === y0m, `${y0m} → ${y1m}`)
    await o.browser.close()
  }

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
