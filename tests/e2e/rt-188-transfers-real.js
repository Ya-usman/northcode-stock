// Migration 188 — transferts V1 RÉELS entre Boutique Alpha (XAF) et « yahaya & zainab 2 » (NGN), même entreprise
// (accord de l'utilisateur le 29 oct. 2026 : « Oui sur les boutiques Alpha et yahaya & zainab »). Par les routes
// normales du serveur LOCAL (même code qu'en ligne, vraie base), compte propriétaire des deux boutiques :
//   A. brouillon (aucun stock touché) → modification du brouillon → envoi (FEFO lot par lot, stock source décompté) ;
//      refus « stock transférable insuffisant » (rien créé) ;
//   B. QR : jeton, scan depuis la mauvaise boutique (nommée, même entreprise), scan depuis la bonne ;
//      écran de réception réel (navigateur) avec l'écart saisi, jusqu'à la fenêtre de confirmation (rien envoyé) ;
//   C. réception définitive : Banane 5/5 rattachée au produit existant, Heineken 2/3 (1 manquante, « casse »)
//      → produit créé INACTIF à l'arrivée (devise différente : coût inconnu), lots avec la péremption d'origine,
//      mouvement « manquant à la réception » à la source sans toucher son stock, jeton révoqué, journal ;
//      rejeu même clé = sans effet ; autre clé = 409 « déjà réceptionné » ; annulation refusée ;
//   D. annulation d'un transfert envoyé : lots source rendus à l'identique.
// Aucune suppression : tout reste (transferts TEST, produit inactif créé, lots, mouvements, journal) ; bilan à la fin.
// Usage : CAPTURE_BASE=http://localhost:3000 RT188_GO=oui node tests/e2e/rt-188-transfers-real.js [dossier_captures]
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT188_GO !== 'oui') { console.error('Écriture réelle : RT188_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const { session } = require('./lib/capture.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const OUT = process.argv[2] || path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : ''}`) }
const OWNER = 'admin@northcode.ng'
const YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'
const BANANE = 'Banane', HEINEKEN = 'Heineken'

;(async () => {
  const W = await enableWrite({ test: 'transferts V1 réels après la 188', routes: [/\/api\/stock-transfers/] })
  const db = W.db
  const NOTE = `TEST transfert 188 ${W.RUN}`

  // ── Boutiques : même entreprise, devises, propriétaire ───────────────────────────────────────────────────────
  const { data: shops } = await db.from('shops').select('id, name, entity_id, currency').in('id', [ALPHA, YZ])
  const A = shops.find(s => s.id === ALPHA), Y = shops.find(s => s.id === YZ)
  if (!A || !Y || Y.name !== 'yahaya & zainab 2' || A.entity_id !== Y.entity_id) { console.log('Arrêt : boutiques inattendues, rien écrit.', shops); process.exit(1) }
  console.log(`Alpha (${A.currency}) → ${Y.name} (${Y.currency}), même entreprise · référence d'exécution ${W.RUN}`)

  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error: le } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (le) throw new Error('connexion : ' + le.message)
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  const ownerId = sess.user.id
  const api = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fr', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))

  // ── Photo de départ ──────────────────────────────────────────────────────────────────────────────────────────
  const prod = async (shop, name) => (await db.from('products').select('id, name, sku, quantity, is_active, selling_price, buying_price').eq('shop_id', shop).eq('name', name)).data || []
  const lots = async pid => (await db.from('product_batches').select('id, quantity, initial_quantity, expiry_date, buying_price, source, received_at, origin_transfer_id, origin_batch_id, origin_untracked').eq('product_id', pid).order('received_at')).data || []
  const [aBan] = await prod(ALPHA, BANANE), [aHei] = await prod(ALPHA, HEINEKEN), [yBan] = await prod(YZ, BANANE)
  const yHei0 = await prod(YZ, HEINEKEN)
  if (!aBan || !aHei || !yBan || yHei0.length) { console.log('Arrêt : produits attendus absents (ou Heineken déjà à l’arrivée), rien écrit.'); process.exit(1) }
  const lotsA0 = { ban: await lots(aBan.id), hei: await lots(aHei.id) }, lotsYBan0 = await lots(yBan.id)
  const yzCount0 = (await db.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', YZ)).count
  console.log(`Départ : Alpha Banane ${aBan.quantity} (${lotsA0.ban.filter(l => l.quantity > 0).length} lots), Alpha Heineken ${aHei.quantity} (${lotsA0.hei.filter(l => l.quantity > 0).map(l => `${l.quantity}@${l.expiry_date}`).join(', ')}), ${Y.name} Banane ${yBan.quantity}, ${yzCount0} produits`)

  // ── A. Brouillon, modification, refus, envoi ─────────────────────────────────────────────────────────────────
  console.log('\nA. Brouillon → modification → envoi')
  const big = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE + ' refus', items: [{ product_id: aHei.id, quantity: aHei.quantity + 1000 }], send: true })
  const ghost = (await db.from('stock_transfers').select('id').eq('notes', NOTE + ' refus')).data || []
  ok(big.status === 400 && /transférable|disponible|insuffisant/i.test(big.body.error || '') && ghost.length === 0, `quantité impossible : refusée « ${big.body.error} » (${big.status}), aucun transfert créé`, big)

  const d = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE, items: [{ product_id: aBan.id, quantity: 4 }], send: false })
  const T = (await db.from('stock_transfers').select('*').eq('notes', NOTE).maybeSingle()).data
  ok(d.status === 200 && T && T.status === 'draft', `brouillon créé (${d.status}, ${T?.reference}, statut ${T?.status})`, d)
  if (!T) { console.log('Arrêt : brouillon absent.'); process.exit(1) }
  ok((await prod(ALPHA, BANANE))[0].quantity === aBan.quantity && (await db.from('stock_transfer_tokens').select('transfer_id').eq('transfer_id', T.id)).data.length === 0, 'brouillon : stock Alpha inchangé, aucun jeton')
  const ed = await api('PATCH', `/api/stock-transfers/${T.id}`, { destination_shop_id: YZ, notes: NOTE, items: [{ product_id: aBan.id, quantity: 5 }, { product_id: aHei.id, quantity: 3 }], expected_updated_at: T.updated_at })
  ok(ed.status === 200, `brouillon modifié : Banane 5, Heineken 3 (${ed.status})`, ed)
  const stale = await api('PATCH', `/api/stock-transfers/${T.id}`, { destination_shop_id: YZ, notes: NOTE, items: [{ product_id: aBan.id, quantity: 1 }], expected_updated_at: T.updated_at })
  ok(stale.status === 400 || stale.status === 409, `modification avec une version périmée : refusée « ${stale.body.error} » (${stale.status})`, stale)

  const sent = await api('POST', '/api/stock-transfers/send', { transfer_id: T.id })
  const T1 = (await db.from('stock_transfers').select('*').eq('id', T.id).single()).data
  ok(sent.status === 200 && T1.status === 'sent' && T1.sent_at && T1.sent_by === ownerId, `envoyé (${sent.status}) : statut ${T1.status}, par le propriétaire`, sent)
  const items = (await db.from('stock_transfer_items').select('id, source_product_id, product_name, quantity_sent').eq('stock_transfer_id', T.id)).data
  const itBan = items.find(i => i.source_product_id === aBan.id), itHei = items.find(i => i.source_product_id === aHei.id)
  ok(items.length === 2 && itBan?.quantity_sent === 5 && itHei?.quantity_sent === 3, 'lignes : Banane 5, Heineken 3 (modification prise en compte)', items)
  const al = (await db.from('stock_transfer_allocations').select('*').eq('transfer_id', T.id)).data
  const aBan1 = (await prod(ALPHA, BANANE))[0], aHei1 = (await prod(ALPHA, HEINEKEN))[0]
  ok(aBan1.quantity === aBan.quantity - 5 && aHei1.quantity === aHei.quantity - 3, `stock Alpha décompté : Banane ${aBan.quantity} → ${aBan1.quantity}, Heineken ${aHei.quantity} → ${aHei1.quantity}`)
  const sumBy = id => al.filter(a => a.item_id === id).reduce((s, a) => s + a.quantity_sent, 0)
  ok(sumBy(itBan.id) === 5 && sumBy(itHei.id) === 3, `allocations = quantités envoyées (${al.length} allocation(s) : ${al.map(a => `${a.coverage}:${a.quantity_sent}${a.source_expiry_date ? '@' + a.source_expiry_date : ''}`).join(', ')})`)
  // FEFO : pour Heineken, les lots consommés sont les plus proches de leur péremption (frais seulement)
  const lotsA1 = { hei: await lots(aHei.id), ban: await lots(aBan.id) }
  const consumed = lotsA0.hei.map(l => ({ ...l, taken: l.quantity - (lotsA1.hei.find(x => x.id === l.id)?.quantity ?? l.quantity) })).filter(l => l.taken > 0)
  const heiBatchAl = al.filter(a => a.item_id === itHei.id && a.coverage === 'batch')
  ok(heiBatchAl.every(a => consumed.some(l => l.id === a.source_batch_id && l.taken >= a.quantity_sent)) && consumed.reduce((s, l) => s + l.taken, 0) === heiBatchAl.reduce((s, a) => s + a.quantity_sent, 0), `Heineken : lots source décomptés exactement comme les allocations (${consumed.map(l => `${l.taken} du lot exp. ${l.expiry_date}`).join(', ')})`)
  const today = new Date().toISOString().slice(0, 10)
  const fresh = lotsA0.hei.filter(l => l.quantity > 0 && (!l.expiry_date || l.expiry_date >= today)).sort((x, y) => String(x.expiry_date || '9999').localeCompare(String(y.expiry_date || '9999')))
  ok(!consumed.length || consumed.every(l => fresh.slice(0, consumed.length).some(f => f.id === l.id)), 'Heineken : ordre FEFO respecté (lots frais les plus proches de leur péremption d’abord)')
  ok(heiBatchAl.every(a => a.unit_cost == null || a.unit_cost > 0), 'coût unitaire à la source : connu (> 0) ou inconnu (NULL), jamais 0')
  const mvA = (await db.from('stock_movements').select('type, quantity, reason, product_id, batch_id').eq('transfer_id', T.id)).data
  ok(mvA.length > 0 && mvA.every(m => m.reason && m.reason.includes(T.reference)), `mouvements de sortie à Alpha rattachés au transfert (${mvA.length})`)
  const tok = (await db.from('stock_transfer_tokens').select('token, revoked_at').eq('transfer_id', T.id).single()).data
  ok(tok && /^[0-9a-f]{64}$/.test(tok.token) && !tok.revoked_at, 'jeton du QR créé à l’envoi (64 caractères, actif)')
  const resent = await api('POST', '/api/stock-transfers/send', { transfer_id: T.id })
  ok(resent.status === 200 && resent.body.data?.already_sent === true && (await prod(ALPHA, BANANE))[0].quantity === aBan1.quantity, `nouvel envoi du même transfert : sans effet (déjà envoyé, stock inchangé)`, resent)

  // ── B. QR et scan ────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nB. QR et scan')
  const qr = await api('GET', `/api/stock-transfers/${T.id}/qr?locale=fr`)
  const url = qr.body.data?.url || ''
  ok(qr.status === 200 && url.endsWith(`/fr/stock/transfers/${T.id}/receive?k=${tok.token}`), 'QR : lien de réception avec le jeton')
  const wrong = await api('POST', '/api/stock-transfers/scan', { code: url, active_shop_id: ALPHA })
  ok(wrong.status === 200 && wrong.body.result === 'wrong_shop' && wrong.body.transfer?.destination_shop_name === Y.name, `scan depuis Alpha : « mauvaise boutique », destination nommée (${wrong.body.transfer?.destination_shop_name})`, wrong.body)
  const good = await api('POST', '/api/stock-transfers/scan', { code: url, active_shop_id: YZ })
  ok(good.status === 200 && good.body.result === 'ok', `scan depuis ${Y.name} : accepté (${good.body.result})`, good.body)
  const bad = await api('POST', '/api/stock-transfers/scan', { code: url.replace(/k=[0-9a-f]+/, 'k=' + '0'.repeat(64)), active_shop_id: YZ })
  ok(bad.body.result === 'invalid', `jeton falsifié : refusé (${bad.body.result})`)
  ok((await db.from('stock_transfers').select('status').eq('id', T.id).single()).data.status === 'sent', 'le scan n’a rien réceptionné (toujours en transit)')

  // Écran réel de réception (navigateur) : écart saisi, fenêtre de confirmation, RIEN envoyé (réception faite par la route ensuite)
  for (const [dev, w, h] of [['tel', 390, 844], ['pc', 1366, 900]]) {
    process.env.CAPTURE_EMAIL = OWNER; process.env.PIN_SHOP = YZ
    const s = await session({ width: w, height: h, locale: 'fr' })
    const posts = []
    s.page.on('request', r => { if (r.method() === 'POST' && /\/api\/stock-transfers\/receive/.test(r.url())) posts.push(r.url()) })
    await s.page.route(/\/api\/stock-transfers\/scan$/, route => route.continue()) // lecture seule (vérification du QR)
    await s.page.goto(`${BASE}/fr/stock/transfers/${T.id}/receive?k=${tok.token}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(10000)
    const body = (await s.page.locator('main').innerText()).replace(/\s+/g, ' ')
    ok(body.includes(T.reference) && body.includes(BANANE) && body.includes(HEINEKEN) && /Confirmer la réception/.test(body), `${dev} : écran de réception ouvert par le QR (${T.reference}, 2 articles)`, body.slice(0, 200))
    await s.page.screenshot({ path: path.join(OUT, `rt188-${dev}-1-reception.png`) })
    const heiCard = s.page.locator('[data-testid="receive-line"]').filter({ hasText: HEINEKEN })
    if (await heiCard.count()) { await heiCard.getByTestId('receive-qty').fill('2'); await wait(600) }
    const after = (await s.page.locator('main').innerText()).replace(/\s+/g, ' ')
    ok(/manquant/i.test(after), `${dev} : écart affiché après « − » sur Heineken`, after.slice(-300))
    await heiCard.scrollIntoViewIfNeeded().catch(() => {}); await s.page.screenshot({ path: path.join(OUT, `rt188-${dev}-2-ecart.png`) })
    await s.page.getByTestId('receive-confirm').click().catch(() => {}); await wait(1200)
    const dlg = (await s.page.locator('[role=dialog]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/1 unité.*manquante|manquante/i.test(dlg), `${dev} : fenêtre de confirmation « ${dlg.slice(0, 90)} »`)
    await s.page.screenshot({ path: path.join(OUT, `rt188-${dev}-3-confirmation.png`) })
    ok(posts.length === 0, `${dev} : rien envoyé depuis le navigateur (fenêtre laissée ouverte)`)
    await s.browser.close().catch(() => {})
  }

  // ── C. Réception définitive (même contenu que l'écran) ───────────────────────────────────────────────────────
  console.log('\nC. Réception définitive')
  const key = crypto.randomUUID()
  const payload = { transfer_id: T.id, receipt_key: key, items: [
    { transfer_item_id: itBan.id, quantity_received: 5, destination_product_id: yBan.id, discrepancy_category: null, discrepancy_detail: null },
    { transfer_item_id: itHei.id, quantity_received: 2, destination_product_id: null, discrepancy_category: 'breakage', discrepancy_detail: `TEST ${W.RUN}` },
  ] }
  const partial = await api('POST', '/api/stock-transfers/receive', { ...payload, receipt_key: crypto.randomUUID(), items: payload.items.slice(0, 1) })
  ok(partial.status === 400 && (await db.from('stock_transfers').select('status').eq('id', T.id).single()).data.status === 'sent', `réception d'une seule ligne : refusée « ${partial.body.error} » (toutes les lignes sont exigées)`, partial)
  const over = await api('POST', '/api/stock-transfers/receive', { ...payload, receipt_key: crypto.randomUUID(), items: [payload.items[0], { ...payload.items[1], quantity_received: 4 }] })
  ok(over.status === 400 && (await db.from('stock_transfers').select('status').eq('id', T.id).single()).data.status === 'sent', `reçu > envoyé : refusé « ${over.body.error} »`, over)
  const rec = await api('POST', '/api/stock-transfers/receive', payload)
  const T2 = (await db.from('stock_transfers').select('*').eq('id', T.id).single()).data
  ok(rec.status === 200 && T2.status === 'received' && T2.has_discrepancy === true && T2.received_by === ownerId && T2.receipt_key === key, `réceptionné (${rec.status}) : statut ${T2.status}, écart signalé, clé enregistrée`, rec)
  const yBan2 = (await prod(YZ, BANANE))[0]
  ok(yBan2.quantity === yBan.quantity + 5, `${Y.name} Banane : ${yBan.quantity} → ${yBan2.quantity} (produit existant, +5)`)
  const yHei = await prod(YZ, HEINEKEN)
  ok(yHei.length === 1 && yHei[0].quantity === 2 && yHei[0].is_active === false && Number(yHei[0].selling_price) === 0, `Heineken créé à l’arrivée : quantité ${yHei[0]?.quantity}, INACTIF, prix de vente 0 (devise différente)`, yHei[0])
  const yHeiLots = yHei.length ? await lots(yHei[0].id) : []
  ok(yHeiLots.length >= 1 && yHeiLots.reduce((s, l) => s + l.quantity, 0) === 2 && yHeiLots.every(l => l.source === 'transfer' && l.origin_transfer_id === T.id && l.buying_price == null), `lots Heineken à l’arrivée : ${yHeiLots.map(l => `${l.quantity}@${l.expiry_date || 'sans date'}`).join(', ')}, source « transfer », coût inconnu (NULL)`)
  const heiExp = new Set(heiBatchAl.map(a => a.source_expiry_date))
  ok(yHeiLots.every(l => !l.origin_batch_id || heiExp.has(l.expiry_date)), 'péremption d’origine conservée sur les lots créés')
  const yBanLots = (await lots(yBan.id)).filter(l => !lotsYBan0.some(o => o.id === l.id))
  ok(yBanLots.reduce((s, l) => s + l.quantity, 0) === 5 && yBanLots.every(l => l.origin_transfer_id === T.id && l.buying_price == null), `lots Banane créés à l’arrivée : ${yBanLots.map(l => `${l.quantity}@${l.expiry_date || 'sans date'}`).join(', ')} (coût NULL, devise différente)`)
  const al2 = (await db.from('stock_transfer_allocations').select('*').eq('transfer_id', T.id)).data
  ok(al2.every(a => a.quantity_in_transit === 0) && al2.reduce((s, a) => s + a.quantity_missing, 0) === 1 && al2.reduce((s, a) => s + a.quantity_received, 0) === 7, 'allocations soldées : 7 reçues, 1 manquante, 0 en transit')
  const loss = (await db.from('stock_movements').select('type, quantity, reason, shop_id, product_id').eq('transfer_id', T.id).eq('type', 'transit_loss')).data
  ok(loss.length === 1 && loss[0].shop_id === ALPHA && loss[0].product_id === aHei.id && Math.abs(loss[0].quantity) === 1 && loss[0].reason === `Transfert ${T.reference} : manquant à la réception`, `mouvement à Alpha : « ${loss[0]?.reason} » (${loss[0]?.quantity})`, loss)
  ok((await prod(ALPHA, HEINEKEN))[0].quantity === aHei1.quantity, 'stock Alpha Heineken non touché par le manquant')
  const itHei2 = (await db.from('stock_transfer_items').select('quantity_received, discrepancy_category, discrepancy_detail').eq('id', itHei.id).single()).data
  ok(itHei2.quantity_received === 2 && itHei2.discrepancy_category === 'breakage', `ligne Heineken : reçu 2, cause « ${itHei2.discrepancy_category} »`)
  ok((await db.from('stock_transfer_tokens').select('revoked_at').eq('transfer_id', T.id).single()).data.revoked_at != null, 'jeton révoqué à la réception')

  const replay = await api('POST', '/api/stock-transfers/receive', payload)
  ok(replay.status === 200 && replay.body.data?.replayed === true && (await prod(YZ, BANANE))[0].quantity === yBan2.quantity, 'rejeu avec la même clé : sans effet (replayed, stock inchangé)', replay)
  const again = await api('POST', '/api/stock-transfers/receive', { ...payload, receipt_key: crypto.randomUUID() })
  ok(again.status === 409 && again.body.code === 'transfer_already_received' && again.body.received_by_name, `autre clé : 409 « ${again.body.error} » (par ${again.body.received_by_name})`, again)
  const scan2 = await api('POST', '/api/stock-transfers/scan', { code: url, active_shop_id: YZ })
  ok(scan2.body.result === 'already_received' || scan2.body.result === 'invalid', `nouveau scan du QR : « ${scan2.body.result} »`)
  const cx = await api('POST', '/api/stock-transfers/cancel', { transfer_id: T.id })
  ok(cx.status === 400 && (await db.from('stock_transfers').select('status').eq('id', T.id).single()).data.status === 'received', `annulation après réception : refusée « ${cx.body.error} »`, cx)
  const { data: logs } = await db.from('audit_logs').select('action').eq('target_id', T.id).order('created_at')
  const acts = (logs || []).map(l => l.action)
  ok(acts.includes('stock_transfer.draft') && acts.includes('stock_transfer.send') && acts.includes('stock_transfer.receive'), `journal : ${acts.join(', ')}`)

  // ── D. Annulation d'un transfert envoyé : lots rendus à l'identique ─────────────────────────────────────────
  console.log('\nD. Annulation après envoi')
  const lotsBefore = await lots(aHei.id), qBefore = (await prod(ALPHA, HEINEKEN))[0].quantity
  const NOTE2 = NOTE + ' annulation'
  const s2 = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE2, items: [{ product_id: aHei.id, quantity: 2 }], send: true })
  const T3 = (await db.from('stock_transfers').select('*').eq('notes', NOTE2).maybeSingle()).data
  ok(s2.status === 200 && T3?.status === 'sent' && (await prod(ALPHA, HEINEKEN))[0].quantity === qBefore - 2, `envoi direct (${T3?.reference}) : Heineken ${qBefore} → ${qBefore - 2}`, s2)
  const c2 = await api('POST', '/api/stock-transfers/cancel', { transfer_id: T3.id })
  const T4 = (await db.from('stock_transfers').select('status').eq('id', T3.id).single()).data
  const lotsAfter = await lots(aHei.id)
  const same = lotsBefore.every(l => lotsAfter.find(x => x.id === l.id)?.quantity === l.quantity) && lotsAfter.filter(l => !lotsBefore.some(b => b.id === l.id)).length === 0
  ok(c2.status === 200 && T4.status === 'cancelled' && (await prod(ALPHA, HEINEKEN))[0].quantity === qBefore && same, `annulé (${c2.status}) : stock ${qBefore} rendu, lots rendus à l’identique (aucun nouveau lot)`, c2)
  ok((await db.from('stock_transfer_tokens').select('revoked_at').eq('transfer_id', T3.id).single()).data.revoked_at != null, 'jeton révoqué à l’annulation')
  ok((await prod(YZ, HEINEKEN))[0].quantity === 2, `${Y.name} non touchée par l’annulation`)

  // ── Écrans après coup (lecture) ──────────────────────────────────────────────────────────────────────────────
  for (const [dev, w, h] of [['tel', 390, 844], ['pc', 1366, 900]]) {
    process.env.CAPTURE_EMAIL = OWNER; process.env.PIN_SHOP = ALPHA
    const s = await session({ width: w, height: h, locale: 'fr' })
    await s.page.goto(`${BASE}/fr/stock/transfers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000)
    await s.page.getByTestId('transfers-search').fill(T.reference); await wait(1200)
    const card = (await s.page.getByTestId('transfer-card').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(card.includes('Reçu') && /1 unité manquante/.test(card), `${dev} : carte « Reçu » + « 1 unité manquante » (${card.slice(0, 120)})`)
    await s.page.screenshot({ path: path.join(OUT, `rt188-${dev}-4-liste.png`) })
    await s.page.getByTestId('transfer-card').first().getByText(T.reference).click(); await wait(3500)
    await s.page.screenshot({ path: path.join(OUT, `rt188-${dev}-5-detail.png`) })
    await s.browser.close().catch(() => {})
  }

  await c.auth.signOut({ scope: 'local' }).catch(() => {})
  console.log(`\nTraces laissées (aucune suppression) : transferts ${T.reference} (reçu avec écart) et ${T3.reference} (annulé), produit Heineken INACTIF créé chez ${Y.name}, lots et mouvements liés, journal.`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
