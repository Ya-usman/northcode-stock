// Migration 196 — emplacement d'un produit, test RÉEL (délégation de l'utilisateur, « Applique 196 », 1er nov. 2026)
// sur Boutique Alpha, par la route normale du serveur LOCAL, compte propriétaire :
//   emplacement « Rayon 2, étagère A » posé sur « Aspirateur Roweta » (espaces resserrés) → 61 caractères refusés
//   (valeur inchangée) → journal « update_product » avec le champ location → liste d'inventaire avec l'emplacement.
// Reste en exemple : l'emplacement du produit et la ligne de journal. Aucun stock modifié.
// Usage : CAPTURE_BASE=http://localhost:3000 RT196_GO=oui node tests/e2e/rt-196-product-location.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT196_GO !== 'oui') { console.error('Écriture réelle : RT196_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const NAME = 'Aspirateur Roweta'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const W = await enableWrite({ test: 'emplacement d’un produit après la 196', routes: [/\/api\/products$/] })
  const db = W.db
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: 'admin@northcode.ng' })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  const call = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))

  const { data: P } = await db.from('products').select('id, name, location, quantity').eq('shop_id', ALPHA).eq('name', NAME).single()
  if (P.location) { console.log(`Arrêt : ${NAME} a déjà un emplacement (« ${P.location} »), rien écrit.`); process.exit(1) }
  const stockBefore = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data
  // Horloge locale et horloge de la base peuvent différer de quelques secondes : marge de 2 minutes
  const t0 = new Date(Date.now() - 120000).toISOString()

  console.log('\n1. Emplacement')
  const set = await call('PATCH', '/api/products', { id: P.id, shop_id: ALPHA, location: '  Rayon 2,   étagère A ' })
  const after1 = (await db.from('products').select('location').eq('id', P.id).single()).data
  ok(set.status === 200 && after1.location === 'Rayon 2, étagère A', `enregistré, espaces resserrés : « ${after1.location} » (${set.status})`, set.body)
  const long = await call('PATCH', '/api/products', { id: P.id, shop_id: ALPHA, location: 'x'.repeat(61) })
  const after2 = (await db.from('products').select('location').eq('id', P.id).single()).data
  ok(long.status === 400 && /60 caractères/.test(long.body.error || '') && after2.location === 'Rayon 2, étagère A', `61 caractères refusés : « ${long.body.error} », valeur inchangée`)

  console.log('\n2. Journal et inventaire')
  const { data: logs } = await db.from('audit_logs').select('action, metadata').eq('shop_id', ALPHA).eq('target_id', P.id).eq('action', 'update_product').gte('created_at', t0)
  const ch = logs?.[0]?.metadata?.changes?.location
  ok(logs?.length === 1 && ch && ch.from === null && ch.to === 'Rayon 2, étagère A', 'journal : location de (vide) à « Rayon 2, étagère A »', logs)
  const inv = await call('GET', `/api/stock/inventory-sessions?shop_id=${ALPHA}`)
  const row = (inv.body.products || []).find(p => p.id === P.id)
  ok(inv.status === 200 && row?.location === 'Rayon 2, étagère A', 'liste d’inventaire : emplacement fourni', row)

  const stockAfter = (await db.from('products').select('id, quantity').eq('shop_id', ALPHA).order('id')).data
  ok(JSON.stringify(stockAfter) === JSON.stringify(stockBefore), 'aucun stock modifié')
  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`  lignes modifiées : ${vf.modified.join(' | ')}`)
  console.log(`  traces gardées :\n    ${vf.remaining.join('\n    ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
