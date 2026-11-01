// Séparation des rôles à la réception d'un transfert, test RÉEL de bout en bout (accord de l'utilisateur du 1er nov. 2026 :
// magasinier de test ajouté à « yahaya & zainab 2 » et gardé). Serveur LOCAL, entreprise Alpha :
//   1. le MAGASINIER (stock_manager, droit Transferts sur les deux boutiques) envoie 1 unité d'Alpha vers
//      « yahaya & zainab 2 » ;
//   2. sa liste : « Réceptionner » refusé (can_receive faux, receive_by_other vrai) ;
//   3. sa réception, depuis la boutique d'arrivée, est REFUSÉE par le serveur (403 transfer_receive_own_send) — lignes
//      invalides EXPRÈS : même si le contrôle manquait, rien ne pourrait être réceptionné ;
//   4. le PROPRIÉTAIRE (exempté) voit « Réceptionner » ;
//   5. le propriétaire ANNULE le transfert : l'unité revient dans les lots d'Alpha (stock et lots identiques à avant).
// Restent : le transfert annulé, ses mouvements et le journal. Boutique Alpha fermée aux employés hors 8 h - 20 h
// (heure de Douala) : arrêt sans rien écrire.
// Usage : CAPTURE_BASE=http://localhost:3000 RTOWN_GO=oui node tests/e2e/rt-transfer-own-send.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RTOWN_GO !== 'oui') { console.error('Écriture réelle : RTOWN_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

async function as(db, email) {
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  return (method, url, body) => fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

;(async () => {
  // Heure de Douala : Alpha ouverte de 8 h à 20 h
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Douala' }).format(new Date()))
  if (hour < 8 || hour >= 20) { console.log(`Arrêt : Boutique Alpha fermée aux employés (${hour} h à Douala), rien écrit.`); process.exit(1) }

  const W = await enableWrite({ test: 'séparation des rôles à la réception d’un transfert', routes: [/\/api\/stock-transfers/] })
  const db = W.db
  const mag = await as(db, 'stocshopci+magasinier@gmail.com')
  const owner = await as(db, 'admin@northcode.ng')
  const { data: magUser } = await db.from('shop_members').select('user_id, role').eq('shop_id', YZ).eq('role', 'stock_manager').eq('is_active', true)
  ok((magUser || []).length >= 1, 'magasinier de test membre actif de « yahaya & zainab 2 »')
  const { data: prod } = await db.from('products').select('id, name, quantity').eq('shop_id', ALPHA).eq('is_active', true).gte('quantity', 5).order('name').limit(1).single()
  const before = {
    qty: (await db.from('products').select('quantity').eq('id', prod.id).single()).data.quantity,
    lots: JSON.stringify((await db.from('product_batches').select('id, quantity').eq('product_id', prod.id).order('id')).data),
  }
  console.log(`Produit : ${prod.name} (${before.qty})`)

  console.log('\n1. Envoi par le magasinier')
  const sent = await mag('POST', '/api/stock-transfers', { source_shop_id: ALPHA, destination_shop_id: YZ, notes: 'TEST séparation des rôles (rt-transfer-own-send)', items: [{ product_id: prod.id, quantity: 1 }], send: true })
  const tr = sent.body.data
  ok(sent.status === 200 && tr?.id && tr.status === 'sent', `transfert envoyé ${tr?.reference} (${sent.status})`, sent.body)
  if (!tr?.id) throw new Error('transfert non créé')

  console.log('\n2. Liste du magasinier')
  const list = await mag('GET', `/api/stock-transfers?shop_ids=${YZ}`)
  const row = (list.body.data || []).find(x => x.id === tr.id)
  ok(row && row.can_receive === false && row.receive_by_other === true, 'pas de « Réceptionner » : une autre personne de l’arrivée réceptionne', row && { can_receive: row.can_receive, receive_by_other: row.receive_by_other })

  console.log('\n3. Réception tentée par le magasinier (lignes invalides EXPRÈS)')
  const rec = await mag('POST', '/api/stock-transfers/receive', { transfer_id: tr.id, acting_shop_id: YZ, items: [{ transfer_item_id: 'pas-un-id', quantity_received: -1 }] })
  ok(rec.status === 403 && rec.body.code === 'transfer_receive_own_send', `refusée : ${rec.status} « ${rec.body.error} »`, rec.body)
  const still = (await db.from('stock_transfers').select('status, received_at').eq('id', tr.id).single()).data
  ok(still.status === 'sent' && !still.received_at, 'transfert toujours en transit')

  console.log('\n4. Le propriétaire (exempté)')
  const own = await owner('GET', `/api/stock-transfers/${tr.id}`)
  ok(own.status === 200 && own.body.data?.can_receive === true && !own.body.data?.receive_by_other, 'propriétaire : « Réceptionner » permis')

  console.log('\n5. Annulation par le propriétaire')
  const cancel = await owner('POST', '/api/stock-transfers/cancel', { transfer_id: tr.id })
  const after = {
    status: (await db.from('stock_transfers').select('status').eq('id', tr.id).single()).data.status,
    qty: (await db.from('products').select('quantity').eq('id', prod.id).single()).data.quantity,
    lots: JSON.stringify((await db.from('product_batches').select('id, quantity').eq('product_id', prod.id).order('id')).data),
  }
  ok(cancel.status === 200 && after.status === 'cancelled', `transfert annulé (${cancel.status})`, cancel.body)
  ok(after.qty === before.qty && after.lots === before.lots, `stock et lots d’Alpha revenus à l’identique (${after.qty})`)

  const vf = await W.verify()
  ok(!vf.removed.length, `rien de préexistant supprimé (${vf.removed.length}), modifié : ${vf.modified.length}`, vf.modified)
  console.log(`  lignes modifiées : ${vf.modified.join(' | ')}`)
  console.log(`  traces gardées :\n    ${vf.remaining.join('\n    ')}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
