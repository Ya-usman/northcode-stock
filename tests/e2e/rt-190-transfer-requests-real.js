// Migration 190 : demandes de transfert RÉELLES entre « yahaya & zainab 2 » (demande) et Boutique Alpha (a le stock),
// même entreprise (accord de l'utilisateur le 30 oct. 2026 : « Fais le test », boutiques Alpha, yahaya & zainab et
// boutiques de test). Par les routes normales du serveur LOCAL (même code qu'en ligne, vraie base), compte propriétaire
// des deux boutiques :
//   A. « Disponible ailleurs » vu de yahaya & zainab 2 ; garde-fous de la demande (même boutique, autre entreprise,
//      quantité au-delà du disponible, doublon en attente) ; liste reçue / envoyée ;
//   B. refus avec motif (puis 409 sur une seconde décision) ;
//   C. annulation par le demandeur ;
//   D. acceptation : écran réel (panneau des demandes → « Nouveau transfert » prérempli, RIEN envoyé depuis le
//      navigateur), puis création du transfert avec request_id (mauvaise destination refusée), demande rattachée,
//      seconde acceptation refusée ; le transfert d'essai est ensuite ANNULÉ (lots d'Alpha rendus à l'identique) ;
//   E. écrans après coup côté demandeur (lecture).
// Aucune suppression : demandes (refusée, annulée, acceptée), transfert annulé et journal restent ; bilan à la fin.
// Usage : CAPTURE_BASE=http://localhost:3000 RT190_GO=oui node tests/e2e/rt-190-transfer-requests-real.js [dossier]
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT190_GO !== 'oui') { console.error('Écriture réelle : RT190_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
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
const OTHER_ENTITY_SHOP = 'e665d4a0-da40-4436-a3b2-1b377760a47b' // Marché Soleil Bonapriso (autre entreprise, jamais écrite)
const BANANE = 'Banane'

;(async () => {
  const W = await enableWrite({ test: 'demandes de transfert réelles après la 190', routes: [/\/api\/stock-transfers/] })
  const db = W.db
  const NOTE = `TEST demande 190 ${W.RUN}`

  const { data: shops } = await db.from('shops').select('id, name, entity_id').in('id', [ALPHA, YZ, OTHER_ENTITY_SHOP])
  const A = shops.find(s => s.id === ALPHA), Y = shops.find(s => s.id === YZ), O = shops.find(s => s.id === OTHER_ENTITY_SHOP)
  if (!A || !Y || !O || Y.name !== 'yahaya & zainab 2' || A.entity_id !== Y.entity_id || O.entity_id === A.entity_id) { console.log('Arrêt : boutiques inattendues, rien écrit.', shops); process.exit(1) }
  console.log(`${Y.name} demande à ${A.name} (même entreprise) · référence d'exécution ${W.RUN}`)

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

  const prod = async (shop, name) => (await db.from('products').select('id, name, quantity').eq('shop_id', shop).eq('name', name)).data || []
  const lots = async pid => (await db.from('product_batches').select('id, quantity').eq('product_id', pid)).data || []
  const reqRow = async id => (await db.from('stock_transfer_requests').select('*').eq('id', id).single()).data
  const audit = async id => ((await db.from('audit_logs').select('action').eq('target_id', id).order('created_at')).data || []).map(l => l.action)
  const [aBan] = await prod(ALPHA, BANANE), [yBan] = await prod(YZ, BANANE)
  if (!aBan || !yBan) { console.log('Arrêt : Banane absente d’une des boutiques, rien écrit.'); process.exit(1) }
  const pending0 = (await db.from('stock_transfer_requests').select('id').eq('status', 'pending')).data || []
  if (pending0.length) { console.log('Arrêt : des demandes sont déjà en attente, rien écrit.', pending0); process.exit(1) }
  const lotsA0 = await lots(aBan.id)
  console.log(`Départ : Alpha Banane ${aBan.quantity}, ${Y.name} Banane ${yBan.quantity}`)
  const ask = (quantity, extra = {}) => api('POST', '/api/stock-transfers/requests', { shop_id: YZ, product_id: yBan.id, source_shop_id: ALPHA, quantity, note: NOTE, ...extra })

  // ── A. Disponible ailleurs, garde-fous, listes ───────────────────────────────────────────────────────────────
  console.log('\nA. Disponible ailleurs et garde-fous')
  const el = await api('GET', `/api/stock/elsewhere?shop_id=${YZ}&product_ids=${yBan.id}`)
  const offer = el.body.items?.[yBan.id]?.shops?.find(s => s.shop_id === ALPHA)
  ok(el.status === 200 && el.body.enabled && el.body.can_request && offer && offer.available > 0 && offer.pending === 0, `${Y.name} voit ${A.name} : ${offer?.available} bananes disponibles, demande possible`, el.body)
  const avail = offer?.available ?? 0
  const same = await api('POST', '/api/stock-transfers/requests', { shop_id: YZ, product_id: yBan.id, source_shop_id: YZ, quantity: 1, note: NOTE })
  ok(same.status === 400, `demande à soi-même : refusée (${same.status})`, same)
  const other = await ask(1, { source_shop_id: OTHER_ENTITY_SHOP })
  ok(other.status === 400 && /entreprise/i.test(other.body.error || ''), `boutique d’une autre entreprise : refusée « ${other.body.error} »`, other)
  const many = await ask(avail + 1)
  ok(many.status === 400 && many.body.max === avail, `plus que le disponible : refusée « ${many.body.error} » (max ${many.body.max})`, many)
  const zero = await ask(0)
  ok(zero.status === 400, `quantité 0 : refusée (${zero.status})`)
  ok(((await db.from('stock_transfer_requests').select('id').eq('note', NOTE)).data || []).length === 0, 'aucune demande créée par les refus')

  const r1 = await ask(3)
  const R1 = r1.body.data?.id && await reqRow(r1.body.data.id)
  ok(r1.status === 200 && R1 && R1.status === 'pending' && R1.quantity === 3 && R1.source_product_id === aBan.id && R1.destination_product_id === yBan.id && R1.requested_by === ownerId && R1.product_name === BANANE,
    `demande créée : 3 bananes, produit d’Alpha rattaché par le serveur, en attente`, r1)
  if (!R1) { console.log('Arrêt : demande absente.'); process.exit(1) }
  const dup = await ask(2)
  ok(dup.status === 409 && dup.body.code === 'already_pending', `seconde demande du même produit à la même boutique : 409 « ${dup.body.error} »`, dup)
  const el2 = await api('GET', `/api/stock/elsewhere?shop_id=${YZ}&product_ids=${yBan.id}`)
  ok(el2.body.items?.[yBan.id]?.shops?.find(s => s.shop_id === ALPHA)?.pending === 3, '« 3 déjà demandés à cette boutique » signalé dans Disponible ailleurs')
  const list = await api('GET', `/api/stock-transfers/requests?shop_ids=${ALPHA},${YZ}`)
  const inc = (list.body.incoming || []).find(r => r.id === R1.id), out = (list.body.outgoing || []).find(r => r.id === R1.id)
  ok(list.status === 200 && inc?.can_decide && inc.requesting_shop_name === Y.name && inc.unit !== undefined, `reçue par ${A.name} : décision possible, demandeur nommé`, inc)
  ok(out?.can_cancel && out.source_shop_name === A.name, `envoyée par ${Y.name} : annulation possible`, out)
  ok((await audit(R1.id)).includes('stock_transfer.request'), 'journal : stock_transfer.request')
  ok((await prod(ALPHA, BANANE))[0].quantity === aBan.quantity, 'une demande ne touche pas au stock')

  // ── B. Refus ─────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nB. Refus avec motif')
  const dec = await api('PATCH', `/api/stock-transfers/requests/${R1.id}`, { action: 'decline', reason: `TEST motif ${W.RUN}` })
  const R1b = await reqRow(R1.id)
  ok(dec.status === 200 && R1b.status === 'declined' && R1b.decline_reason === `TEST motif ${W.RUN}` && R1b.decided_by === ownerId && R1b.decided_at, `refusée (${dec.status}) avec le motif, décideur et date`, dec)
  const dec2 = await api('PATCH', `/api/stock-transfers/requests/${R1.id}`, { action: 'decline' })
  ok(dec2.status === 409 && dec2.body.code === 'not_pending', `seconde décision : 409 « ${dec2.body.error} »`, dec2)
  const cx1 = await api('PATCH', `/api/stock-transfers/requests/${R1.id}`, { action: 'cancel' })
  ok(cx1.status === 409, `annulation d’une demande refusée : 409`)
  const acc1 = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE, items: [{ product_id: aBan.id, quantity: 3 }], send: true, request_id: R1.id })
  ok(acc1.status === 409 && ((await db.from('stock_transfers').select('id').eq('notes', NOTE)).data || []).length === 0, `accepter une demande refusée : 409, aucun transfert créé`, acc1)
  ok((await audit(R1.id)).includes('stock_transfer.request_decline'), 'journal : stock_transfer.request_decline')

  // ── C. Annulation par le demandeur ───────────────────────────────────────────────────────────────────────────
  console.log('\nC. Annulation par le demandeur')
  const r2 = await ask(2)
  ok(r2.status === 200, `nouvelle demande possible après le refus (${r2.status})`, r2)
  const bad = await api('PATCH', `/api/stock-transfers/requests/${r2.body.data?.id}`, { action: 'approve' })
  ok(bad.status === 400, `action inconnue : refusée (${bad.status})`)
  const cx = await api('PATCH', `/api/stock-transfers/requests/${r2.body.data?.id}`, { action: 'cancel' })
  const R2 = await reqRow(r2.body.data.id)
  ok(cx.status === 200 && R2.status === 'cancelled' && R2.decided_by === ownerId, `annulée (${cx.status})`, cx)
  ok((await audit(R2.id)).includes('stock_transfer.request_cancel'), 'journal : stock_transfer.request_cancel')

  // ── D. Acceptation ───────────────────────────────────────────────────────────────────────────────────────────
  console.log('\nD. Acceptation')
  const r3 = await ask(4)
  const R3 = await reqRow(r3.body.data.id)
  ok(r3.status === 200 && R3.status === 'pending', `demande de 4 bananes en attente (${r3.status})`)

  // Écran réel côté Alpha : panneau des demandes → « Nouveau transfert » prérempli ; aucun envoi depuis le navigateur
  for (const [dev, w, h] of [['tel', 390, 844], ['pc', 1366, 900]]) {
    process.env.CAPTURE_EMAIL = OWNER; process.env.PIN_SHOP = ALPHA
    const s = await session({ width: w, height: h, locale: 'fr' })
    const posts = []
    await s.page.route(/\/api\/stock-transfers(\/|\?|$)/, route => {
      if (route.request().method() === 'GET') return route.continue()
      posts.push(route.request().url()); return route.fulfill({ status: 204, body: '' })
    })
    await s.page.goto(`${BASE}/fr/stock/transfers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000)
    const card = s.page.getByTestId('transfer-request-in').filter({ hasText: BANANE }).first()
    const txt = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(txt.includes(Y.name) && /4/.test(txt), `${dev} : demande reçue affichée (${txt.slice(0, 110)})`)
    await s.page.screenshot({ path: path.join(OUT, `rt190-${dev}-1-demande-recue.png`) })
    await card.getByTestId('transfer-request-accept').click(); await wait(2500)
    const drawer = s.page.getByTestId('transfer-drawer')
    const dtxt = (await drawer.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const lines = await drawer.getByTestId('transfer-line-edit').allInnerTexts().catch(() => [])
    ok(await drawer.isVisible() && dtxt.includes(Y.name) && lines.length === 1 && lines[0].includes(BANANE), `${dev} : « Nouveau transfert » prérempli (destination ${Y.name}, 1 ligne Banane)`, dtxt.slice(0, 200))
    const qty = await drawer.getByTestId('transfer-line-edit').first().locator('input').first().inputValue().catch(() => '')
    ok(qty === '4', `${dev} : quantité préremplie 4 (${qty})`)
    await s.page.screenshot({ path: path.join(OUT, `rt190-${dev}-2-transfert-prerempli.png`) })
    ok(posts.length === 0, `${dev} : rien envoyé depuis le navigateur`)
    await s.browser.close().catch(() => {})
  }
  ok((await reqRow(R3.id)).status === 'pending', 'après l’écran : la demande est toujours en attente')

  const wrongDest = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: OTHER_ENTITY_SHOP, notes: NOTE, items: [{ product_id: aBan.id, quantity: 4 }], send: true, request_id: R3.id })
  ok(wrongDest.status === 400 && ((await db.from('stock_transfers').select('id').eq('notes', NOTE)).data || []).length === 0 && (await reqRow(R3.id)).status === 'pending', `transfert vers une autre destination que le demandeur : refusé « ${wrongDest.body.error} », rien créé`, wrongDest)
  const acc = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE, items: [{ product_id: aBan.id, quantity: 4 }], send: true, request_id: R3.id })
  const T = (await db.from('stock_transfers').select('*').eq('notes', NOTE).maybeSingle()).data
  const R3b = await reqRow(R3.id)
  ok(acc.status === 200 && T && T.status === 'sent', `transfert créé et envoyé (${acc.status}, ${T?.reference})`, acc)
  ok(R3b.status === 'accepted' && R3b.transfer_id === T?.id && R3b.decided_by === ownerId, `demande acceptée et rattachée au transfert ${T?.reference}`, R3b)
  ok((await prod(ALPHA, BANANE))[0].quantity === aBan.quantity - 4, `stock Alpha décompté par l’envoi : ${aBan.quantity} → ${aBan.quantity - 4}`)
  ok((await audit(R3.id)).includes('stock_transfer.request_accept'), 'journal : stock_transfer.request_accept')
  const acc2 = await api('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: NOTE + ' bis', items: [{ product_id: aBan.id, quantity: 4 }], send: true, request_id: R3.id })
  ok(acc2.status === 409 && ((await db.from('stock_transfers').select('id').eq('notes', NOTE + ' bis')).data || []).length === 0, `seconde acceptation : 409, aucun second transfert`, acc2)
  const list2 = await api('GET', `/api/stock-transfers/requests?shop_ids=${ALPHA},${YZ}`)
  const out3 = (list2.body.outgoing || []).find(r => r.id === R3.id)
  ok(!(list2.body.incoming || []).some(r => r.id === R3.id) && out3?.status === 'accepted' && out3.transfer_reference === T.reference, `plus dans les demandes reçues ; côté demandeur « acceptée » avec ${out3?.transfer_reference}`)

  // Le transfert d'essai est annulé : lots d'Alpha rendus à l'identique
  const cxT = await api('POST', '/api/stock-transfers/cancel', { transfer_id: T.id })
  const lotsA1 = await lots(aBan.id)
  const sameLots = lotsA0.every(l => lotsA1.find(x => x.id === l.id)?.quantity === l.quantity) && lotsA1.filter(l => !lotsA0.some(b => b.id === l.id)).length === 0
  ok(cxT.status === 200 && (await db.from('stock_transfers').select('status').eq('id', T.id).single()).data.status === 'cancelled' && (await prod(ALPHA, BANANE))[0].quantity === aBan.quantity && sameLots,
    `transfert d’essai ${T.reference} annulé : stock Alpha ${aBan.quantity} rendu, lots à l’identique`, cxT)
  ok((await prod(YZ, BANANE))[0].quantity === yBan.quantity, `${Y.name} Banane inchangée (${yBan.quantity})`)

  // ── E. Écrans côté demandeur (lecture) ───────────────────────────────────────────────────────────────────────
  for (const [dev, w, h] of [['tel', 390, 844], ['pc', 1366, 900]]) {
    process.env.CAPTURE_EMAIL = OWNER; process.env.PIN_SHOP = YZ
    const s = await session({ width: w, height: h, locale: 'fr' })
    await s.page.goto(`${BASE}/fr/stock/transfers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000)
    const outs = (await s.page.getByTestId('transfer-request-out').allInnerTexts().catch(() => [])).map(t => t.replace(/\s+/g, ' '))
    const st = outs.join(' | ')
    ok(/Refusée/i.test(st) && /Annulée/i.test(st) && /Acceptée/i.test(st) && st.includes(`TEST motif ${W.RUN}`) && st.includes(T.reference), `${dev} : demandes envoyées (refusée avec motif, annulée, acceptée avec ${T.reference})`, st.slice(0, 400))
    await s.page.getByTestId('transfer-requests').scrollIntoViewIfNeeded().catch(() => {})
    await s.page.screenshot({ path: path.join(OUT, `rt190-${dev}-3-demandes-envoyees.png`) })
    await s.browser.close().catch(() => {})
  }

  await c.auth.signOut({ scope: 'local' }).catch(() => {})
  console.log(`\nTraces laissées (aucune suppression) : 3 demandes « ${NOTE} » (refusée, annulée, acceptée), transfert ${T.reference} annulé, journal.`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
