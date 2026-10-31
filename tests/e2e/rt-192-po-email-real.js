// Migration 192 — envoi RÉEL d'un bon de commande par e-mail (accord de l'utilisateur le 31 oct. 2026 : « Oui »).
// Serveur LOCAL, vraie base, Boutique Alpha, compte propriétaire (admin@northcode.ng), par les routes normales :
//   A. fixture : fournisseur « TEST Fournisseur e-mail <exécution> » (e-mail = RT192_TO) + bon brouillon (1 ligne) ;
//   B. refus avant envoi : bon d'une autre boutique (404) ;
//   C. ENVOI RÉEL (un seul e-mail, sans copie) → 200, brouillon → « Envoyé », historique « sent » + identifiant
//      Resend, trace d'audit purchase_order.email, historique lisible par GET ;
//   D. e-mail retiré de la fiche du fournisseur TEST ; rien de préexistant modifié ni supprimé.
// Les lignes TEST (fournisseur, bon, historique, audit) sont GARDÉES : leur sort est décidé par l'utilisateur.
// Usage : CAPTURE_BASE=http://localhost:3000 RT192_GO=oui RT192_TO=adresse node tests/e2e/rt-192-po-email-real.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT192_GO !== 'oui') { console.error('Écriture réelle : RT192_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const TO = process.env.RT192_TO
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TO || '')) { console.error('RT192_TO : adresse de réception obligatoire'); process.exit(2) }
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
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : ''}`) }
const OWNER = 'admin@northcode.ng'
const BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'

;(async () => {
  const W = await enableWrite({ test: 'envoi réel d’un bon par e-mail après la 192', routes: [/\/api\/purchase-orders/] })
  const db = W.db
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error: le } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (le) throw new Error('connexion : ' + le.message)
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  const call = (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))

  console.log('\nA. Fixture')
  const supplierName = `TEST Fournisseur e-mail ${W.RUN}`
  const supplierId = await W.insert('suppliers', { shop_id: ALPHA, name: supplierName, email: TO, city: 'Douala' })
  const { data: prod } = await db.from('products').select('id, name, unit, buying_price').eq('shop_id', ALPHA).eq('is_active', true).order('name').limit(1).single()
  const created = await call('POST', '/api/purchase-orders', {
    shop_id: ALPHA, supplier_id: supplierId, notes: `TEST ${W.RUN}`,
    items: [{ product_id: prod.id, product_name: prod.name, unit: prod.unit, quantity_ordered: 3, unit_price: prod.buying_price }],
  })
  const po = created.body.data
  ok(created.status === 200 && po?.status === 'draft', `bon TEST créé en brouillon (${po?.reference})`, created)
  if (!po) throw new Error('bon non créé')

  console.log('\nB. Refus avant envoi')
  const wrong = await call('POST', '/api/purchase-orders/email', { id: po.id, shop_id: BASTOS, locale: 'fr', copy: false })
  ok(wrong.status === 404 || wrong.status === 403, `bon présenté avec une autre boutique : refusé (${wrong.status})`, wrong)

  console.log('\nC. Envoi réel')
  const sent = await call('POST', '/api/purchase-orders/email', { id: po.id, shop_id: ALPHA, locale: 'fr', copy: false })
  ok(sent.status === 200 && sent.body.recipient === TO, `envoyé à ${sent.body.recipient}`, sent)
  ok(sent.body.status_changed === true, 'brouillon passé à « Envoyé » (décision B)', sent.body)
  const { data: poAfter } = await db.from('purchase_orders').select('status, sent_at, sent_by').eq('id', po.id).single()
  ok(poAfter.status === 'sent' && !!poAfter.sent_at && !!poAfter.sent_by, `en base : statut ${poAfter.status}, date et expéditeur d'envoi`, poAfter)
  const { data: rows } = await db.from('purchase_order_emails').select('*').eq('purchase_order_id', po.id)
  const r = rows?.[0] || {}
  ok(rows?.length === 1 && r.status === 'sent' && r.recipient === TO && !!r.provider_id && r.copy_to === null && r.locale === 'fr' && r.shop_id === ALPHA,
    `historique : 1 ligne « sent », identifiant Resend ${r.provider_id}, sans copie`, r)
  ok(r.reply_to === OWNER, `réponse adressée à ${r.reply_to} (boutique sans e-mail : expéditeur, décision A)`, r.reply_to)
  const { data: audit } = await db.from('audit_logs').select('action, metadata').eq('shop_id', ALPHA).eq('target_id', po.id).eq('action', 'purchase_order.email')
  ok(audit?.length === 1 && audit[0].metadata?.recipient === TO && audit[0].metadata?.status_changed === true, 'journal d’audit : purchase_order.email', audit)
  const hist = await call('GET', `/api/purchase-orders/email?id=${po.id}&shop_id=${ALPHA}`)
  ok(hist.status === 200 && hist.body.data?.length === 1 && hist.body.data[0].status === 'sent' && !!hist.body.data[0].sent_by_name, `historique lu par le journal du bon (${hist.body.data?.[0]?.sent_by_name})`, hist)

  console.log('\nD. Fin')
  await db.from('suppliers').update({ email: null }).eq('id', supplierId).eq('shop_id', ALPHA)
  const { data: sup } = await db.from('suppliers').select('email').eq('id', supplierId).single()
  ok(sup.email === null, 'e-mail retiré de la fiche du fournisseur TEST')
  const vf = await W.verify()
  ok(!vf.removed.length && !vf.modified.length, `rien de préexistant supprimé ni modifié (${vf.removed.length} / ${vf.modified.length})`, vf)
  console.log(`  lignes TEST gardées (décision de l'utilisateur) :\n    ${vf.remaining.join('\n    ')}`)
  console.log(`\nRéférence du bon TEST : ${po.reference} · fournisseur ${supplierName} · exécution ${W.RUN}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
