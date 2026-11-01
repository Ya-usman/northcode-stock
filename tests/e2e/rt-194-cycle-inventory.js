// Migration 194 — inventaire tournant, test RÉEL (délégation de l'utilisateur, « Applique 194 », 1er nov. 2026) sur
// Boutique Alpha, par les routes normales du serveur LOCAL, compte propriétaire :
//   aperçu (10 produits, ni stock ni prix renvoyés) → démarrage tournant (périmètre = l'aperçu) → liste à compter =
//   10 produits → comptage d'un produit du périmètre (sans écart, rien d'appliqué) → produit hors périmètre refusé →
//   ABANDON de la session (aucun stock modifié). Restent : la session abandonnée, son comptage et le journal (comme
//   tout inventaire abandonné).
// Arrêt sans rien écrire si un inventaire est déjà en cours sur Alpha.
// Usage : CAPTURE_BASE=http://localhost:3000 RT194_GO=oui node tests/e2e/rt-194-cycle-inventory.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT194_GO !== 'oui') { console.error('Écriture réelle : RT194_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const W = await enableWrite({ test: 'inventaire tournant après la 194', routes: [/\/api\/stock\/inventory-sessions/] })
  const db = W.db
  const { data: running } = await db.from('inventory_sessions').select('id, reference').eq('shop_id', ALPHA).eq('status', 'in_progress').maybeSingle()
  if (running) { console.log(`Arrêt : inventaire ${running.reference} déjà en cours sur Alpha, rien écrit.`); process.exit(1) }

  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: 'admin@northcode.ng' })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  const call = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const stockBefore = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data

  console.log('\n1. Aperçu')
  const prev = await call('GET', `/api/stock/inventory-sessions/cycle-suggestion?shop_id=${ALPHA}&size=10`)
  const ids = (prev.body.products || []).map(p => p.id)
  ok(prev.status === 200 && ids.length === 10, `aperçu : 10 produits (${prev.status})`, prev.body)
  ok(!JSON.stringify(prev.body).match(/quantity|buying_price|value|cost/), 'aperçu : ni stock ni prix d’achat renvoyés')

  console.log('\n2. Démarrage tournant')
  const st = await call('POST', '/api/stock/inventory-sessions', { shop_id: ALPHA, scope: 'cycle', size: 10 })
  ok(st.status === 200 && st.body.data?.scope === 'cycle' && st.body.data?.resumed === false, `session tournante ${st.body.data?.reference}`, st.body)
  const sid = st.body.data?.id
  if (!sid) throw new Error('session absente')
  const { data: row } = await db.from('inventory_sessions').select('scope, products_total, scope_product_ids').eq('id', sid).single()
  ok(row.scope === 'cycle' && row.products_total === 10 && JSON.stringify(row.scope_product_ids) === JSON.stringify(ids), 'périmètre en base = l’aperçu (10 produits, même ordre)', row)
  const state = await call('GET', `/api/stock/inventory-sessions?shop_id=${ALPHA}`)
  ok(state.body.session?.scope === 'cycle' && state.body.products?.length === 10 && state.body.products.every(p => ids.includes(p.id)), 'liste à compter = les 10 produits du périmètre')
  ok(!('scope_product_ids' in (state.body.session || {})), 'liste interne du périmètre non renvoyée à l’écran')

  console.log('\n3. Comptages')
  const target = (await db.from('products').select('id, quantity').eq('id', ids[0]).single()).data
  const cnt = await call('POST', `/api/stock/inventory-sessions/${sid}/count`, { shop_id: ALPHA, product_id: target.id, counted_qty: Math.max(0, target.quantity), expected_count_id: null })
  ok(cnt.status === 200 && cnt.body.data?.conflict === false && cnt.body.data?.delta === 0, `produit du périmètre compté, sans écart (${cnt.status})`, cnt.body)
  const outside = (await db.from('products').select('id').eq('shop_id', ALPHA).eq('is_active', true).not('id', 'in', `(${ids.join(',')})`).limit(1).single()).data
  const bad = await call('POST', `/api/stock/inventory-sessions/${sid}/count`, { shop_id: ALPHA, product_id: outside.id, counted_qty: 1, expected_count_id: null })
  ok(bad.status >= 400 && /inventaire tournant/.test(bad.body.error || ''), `produit hors périmètre refusé : ${bad.status} « ${bad.body.error} »`, bad.body)
  const { count: outsideRows } = await db.from('inventory_counts').select('id', { count: 'exact', head: true }).eq('session_id', sid).eq('product_id', outside.id)
  ok(outsideRows === 0, 'rien écrit pour le produit hors périmètre')

  console.log('\n4. Abandon')
  const cancel = await call('POST', `/api/stock/inventory-sessions/${sid}/cancel`, { shop_id: ALPHA })
  const { data: after } = await db.from('inventory_sessions').select('status').eq('id', sid).single()
  ok(cancel.status === 200 && after.status === 'cancelled', `session abandonnée (${cancel.status})`)
  const stockAfter = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data
  ok(JSON.stringify(stockAfter) === JSON.stringify(stockBefore), 'aucun stock modifié')

  const vf = await W.verify()
  ok(!vf.removed.length && vf.modified.every(x => /^products .* \(updated_at\)$/.test(x) === false), `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`  traces gardées :\n    ${vf.remaining.join('\n    ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
