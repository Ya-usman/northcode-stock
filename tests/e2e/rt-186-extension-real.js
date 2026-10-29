// Migration 186 — demande de prolongation RÉELLE sur Boutique Alpha, après sa fermeture du jour (accord de
// l'utilisateur le 29 oct. 2026). Par les routes normales du serveur LOCAL (même code qu'en ligne, vraie base) :
//   0. boutique réellement fermée (après la fermeture du jour, aucune prolongation en cours, pas fermée à la main) ;
//   1. lot A : la caissière tente un encaissement → refusé « boutique fermée » (403), RIEN d'écrit (produit inexistant :
//      même si la boutique était ouverte, la vente serait refusée par la validation) ;
//   2. écran de la caissière (navigateur, horaires RÉELS) : « Boutique fermée » + « Demander une prolongation » ;
//   3. la caissière demande 30 min (message TEST) → le propriétaire est prévenu (notification téléphone réelle) ;
//   4. écran de la caissière : « Demande envoyée » ; propriétaire : carte « Accepter jusqu'à HH:MM » + cloche ;
//   5. le propriétaire accepte → prolongation À PARTIR DE MAINTENANT (186), demande « acceptée », journal ;
//   6. écran de la caissière : débloqué tout seul, sans recharger.
// Aucune suppression : la demande, la prolongation (elle expire seule) et le journal restent ; bilan affiché à la fin.
// Usage : CAPTURE_BASE=http://localhost:3000 RT186_GO=oui node tests/e2e/rt-186-extension-real.js [dossier_captures]
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT186_GO !== 'oui') { console.error('Écriture réelle : RT186_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
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
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const CASHIER = 'stocshopci@gmail.com', OWNER = 'admin@northcode.ng'
const hm = (iso, tz) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

// Navigateur avec les horaires RÉELS : l'outil de capture les neutralise pour les autres tests ; ici une route
// prioritaire renvoie la réponse de la base telle quelle. Aucune écriture depuis ce navigateur (bloquées par l'outil).
async function screen(email, dev) {
  process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = ALPHA
  const [w, h] = dev === 'pc' ? [1366, 900] : [390, 844]
  const s = await session({ width: w, height: h, locale: 'fr' })
  await s.page.route(/\/rest\/v1\/(shops|shop_members)\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch().catch(() => null); if (!res) return route.abort()
    return route.fulfill({ response: res, body: await res.text() })
  })
  await s.page.goto(`${BASE}/fr/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(10000)
  return s
}
const text = async (s, id) => (await s.page.getByTestId(id).first().innerText({ timeout: 2000 }).catch(() => '')).replace(/\s+/g, ' ')
const shot = (s, name) => s.page.screenshot({ path: path.join(OUT, `rt186-${name}.png`) })

;(async () => {
  const W = await enableWrite({ test: 'demande de prolongation réelle après la 186', routes: [/\/api\/shops\/extension-requests(\/decide)?$/] })
  const admin = W.db
  const login = async email => {
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) throw new Error(`${email} : ${error.message}`)
    const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
    const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
    return { email, c, id: data.user.id, cookie: parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') }
  }
  const api = (who, method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fr', Cookie: who.cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const cashier = await login(CASHIER), owner = await login(OWNER)

  // 0. Boutique réellement fermée, après la fermeture du jour
  const shop0 = (await admin.from('shops').select('hours_enabled, opening_time, closing_time, hours_manual_override, hours_extension_until, hours_extension_count, hours_extension_count_date, timezone').eq('id', ALPHA).single()).data
  const state0 = await api(cashier, 'GET', `/api/shops/extension-requests?shop_id=${ALPHA}`)
  console.log(`Alpha : ${shop0.opening_time}–${shop0.closing_time} (${shop0.timezone}), prolongation ${shop0.hours_extension_until || 'aucune'}, compteur ${shop0.hours_extension_count} (${shop0.hours_extension_count_date || '-'})`)
  ok(state0.status === 200 && state0.body.available === true && state0.body.phase === 'after_close', `caissière : boutique fermée APRÈS la fermeture du jour (phase ${state0.body.phase}, demandes ${state0.body.available ? 'disponibles' : 'indisponibles'})`)
  if (state0.body.phase !== 'after_close' || !state0.body.available) { console.log('Arrêt : la boutique n’est pas dans l’état attendu, rien n’a été écrit.'); process.exit(1) }
  ok(state0.body.can_extend === false && !state0.body.mine, 'caissière : ne peut pas prolonger elle-même, aucune demande récente')

  // 1. Lot A : encaissement refusé, rien d'écrit
  const refused = await api(cashier, 'POST', '/api/sales/checkout', {
    shop_id: ALPHA, customer_id: null, subtotal: 1, discount: 0, tax: 0, total: 1, payment_method: 'cash', notes: `TEST refus 186 ${W.RUN}`,
    client_request_id: `rt186-refus-${W.RUN}`, items: [{ product_id: '00000000-0000-4000-8000-000000000186', product_name: 'TEST', quantity: 1, unit_price: 1, original_price: 1 }],
    payments: [{ method: 'cash', amount: 1, reference: null }],
  })
  const ghost = (await admin.from('sales').select('id').eq('client_request_id', `rt186-refus-${W.RUN}`)).data || []
  ok(refused.status === 403 && refused.body.code === 'shop_closed' && ghost.length === 0, `lot A : encaissement refusé « ${refused.body.error} » (${refused.status}, ${refused.body.code}), aucune vente créée`)

  // 2. Écran de la caissière
  const cs = await screen(CASHIER, 'tel')
  const wall0 = await text(cs, 'shop-closed-wall')
  ok(/Boutique fermée/.test(wall0) && /Demander une prolongation/.test(wall0), `écran caissière : « Boutique fermée » + « Demander une prolongation » (${wall0.slice(0, 110)}…)`)
  await shot(cs, '1-caissiere-fermee')

  // 3. Demande réelle : 30 min
  const message = `TEST prolongation 186 ${W.RUN}`
  const req = await api(cashier, 'POST', '/api/shops/extension-requests', { shop_id: ALPHA, minutes: 30, message })
  const reqId = req.body?.request?.id
  ok(req.status === 200 && reqId, `caissière : demande de 30 min envoyée (${req.status}${reqId ? '' : ' ' + JSON.stringify(req.body)})`)
  if (!reqId) throw new Error('demande absente : arrêt')
  const dup = await api(cashier, 'POST', '/api/shops/extension-requests', { shop_id: ALPHA, minutes: 60 })
  ok(dup.status === 409, `deuxième demande pendant l'attente : refusée (${dup.status})`)

  // 4. Attente côté caissière, carte côté propriétaire
  await wait(17000)
  const wall1 = await text(cs, 'shop-closed-wall')
  ok(/Demande envoyée/.test(wall1), `écran caissière : « Demande envoyée… » sans recharger (${wall1.slice(0, 90)}…)`)
  await shot(cs, '2-caissiere-attente')
  const inbox = await api(owner, 'GET', '/api/shops/extension-requests?scope=approver')
  const mine = (inbox.body.requests || []).find(r => r.id === reqId)
  ok(!!mine && inbox.body.shops?.[ALPHA]?.name === 'Boutique Alpha', 'propriétaire : la demande figure dans « toutes mes boutiques », avec Alpha')
  const os = await screen(OWNER, 'tel')
  const card = await text(os, 'extension-request')
  const expectedUntil = hm(new Date(Date.now() + 30 * 60_000).toISOString(), shop0.timezone)
  ok(/ghislain|demande une prolongation pour Boutique Alpha/i.test(card) && /Accepter jusqu'à/.test(card), `propriétaire : carte affichée (${card.slice(0, 160)}…)`)
  ok((await text(os, 'notification-bell-count')) !== '', `propriétaire : compteur de la cloche (${await text(os, 'notification-bell-count')})`)
  await shot(os, '3-proprietaire-carte')
  const ops = await screen(OWNER, 'pc'); await shot(ops, '4-proprietaire-carte-pc'); await ops.browser.close().catch(() => {})
  await os.browser.close().catch(() => {})

  // 5. Acceptation réelle par le propriétaire
  const before = Date.now()
  const dec = await api(owner, 'POST', '/api/shops/extension-requests/decide', { id: reqId, approve: true })
  ok(dec.status === 200, `propriétaire : acceptation (${dec.status}${dec.status === 200 ? '' : ' ' + JSON.stringify(dec.body)})`)
  const r1 = (await admin.from('hours_extension_requests').select('status, decided_by, decided_at, granted_until, minutes').eq('id', reqId).single()).data
  const shop1 = (await admin.from('shops').select('hours_extension_until, hours_extension_count, hours_extension_count_date').eq('id', ALPHA).single()).data
  const until = new Date(shop1.hours_extension_until).getTime()
  ok(r1.status === 'approved' && r1.decided_by === owner.id && r1.granted_until === shop1.hours_extension_until, `demande « acceptée » par le propriétaire, prolongation enregistrée (jusqu'à ${hm(shop1.hours_extension_until, shop0.timezone)})`)
  ok(until >= before + 29 * 60_000 && until <= Date.now() + 31 * 60_000, `prolongation À PARTIR DE MAINTENANT : ${Math.round((until - before) / 60000)} min (attendu ≈ 30, pas à partir de ${String(shop0.closing_time).slice(0, 5)})`)
  ok(shop1.hours_extension_count === (shop0.hours_extension_count_date === shop1.hours_extension_count_date ? shop0.hours_extension_count : 0) + 1, `compteur du jour : ${shop1.hours_extension_count} (${shop1.hours_extension_count_date})`)
  void expectedUntil

  // 6. Écran de la caissière débloqué tout seul
  let unlocked = false
  for (let i = 0; i < 12 && !unlocked; i++) { await wait(5000); unlocked = (await cs.page.getByTestId('shop-closed-wall').count()) === 0 }
  ok(unlocked, 'écran caissière : débloqué tout seul, sans recharger')
  await shot(cs, '5-caissiere-debloquee')
  await cs.browser.close().catch(() => {})

  // Journal
  const { data: logs } = await admin.from('audit_logs').select('action, actor_email, created_at').eq('shop_id', ALPHA).eq('target_id', reqId).order('created_at')
  const acts = (logs || []).map(l => `${l.action} (${l.actor_email})`)
  ok(acts.some(a => a.startsWith('shop.extension_requested')) && acts.some(a => a.startsWith('shop.extension_request_approved')), `journal : ${acts.join(', ')}`)

  for (const L of [cashier, owner]) await L.c.auth.signOut({ scope: 'local' }).catch(() => {})
  // Bilan des traces (aucune suppression : décision de l'utilisateur ensuite)
  const v = await W.verify()
  console.log(`\nBilan base (Alpha) : ${v.removed.length} ligne(s) préexistante(s) supprimée(s), ${v.modified.length} modifiée(s), ${v.remaining.length} nouvelle(s)`)
  for (const x of v.removed) console.log(`  supprimée : ${x}`)
  for (const x of v.modified) console.log(`  modifiée : ${x}`)
  for (const x of v.remaining) console.log(`  nouvelle : ${x}`)
  console.log(`  hors photo : demande ${reqId} (approuvée) ; boutique : prolongation jusqu'à ${hm(shop1.hours_extension_until, shop0.timezone)}, compteur ${shop1.hours_extension_count}`)
  ok(v.removed.length === 0, 'aucune ligne préexistante supprimée')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
