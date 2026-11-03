// Migration 204 — préparation des paiements, test RÉEL (accord de l'utilisateur du 3 nov. 2026) sur Boutique Alpha,
// serveur LOCAL, sans aucun débit : aucune clé de passerelle n'est configurée en local, la demande s'arrête après la
// préparation, qui doit alors être marquée « abandonnée ». Une ligne payment_intents « failed » reste, comme convenu.
//   1. sans connexion : 401 ; un gérant d'Alpha : 403 ; rien n'est préparé ;
//   2. propriétaire : préparation enregistrée par le serveur (montant du catalogue, devise de facturation), puis
//      « abandonnée » (passerelle non configurée) ;
//   3. rien de préexistant modifié.
// Usage : CAPTURE_BASE=http://localhost:3000 RT204_GO=oui node tests/e2e/rt-204-payment-prep.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT204_GO !== 'oui') { console.error('Écriture réelle : RT204_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
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
  const W = await enableWrite({ test: 'préparation des paiements (204)', routes: [/\/api\/billing\/subscribe/] })
  const db = W.db
  const cookieFor = async email => {
    const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email })
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) throw error
    const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
    const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
    return parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  }
  const subscribe = (cookie, body) => fetch(`${BASE}/api/billing/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const intents = async () => (await db.from('payment_intents').select('*').eq('shop_id', ALPHA).order('created_at', { ascending: false })).data || []
  const before = (await intents()).length
  const body = { plan_id: 'pro', shop_id: ALPHA, email: 'admin@northcode.ng', locale: 'fr', billing_period: 'monthly', payment_method: '' }

  console.log('\n1. Appelants refusés')
  const anon = await subscribe(null, body)
  ok(anon.status === 401, `sans connexion : refusé (${anon.status} « ${anon.body.error} »)`)
  const mgr = await subscribe(await cookieFor('cassierstock@gmail.com'), body)
  ok(mgr.status === 403, `gérant d'Alpha : refusé (${mgr.status} « ${mgr.body.error} »)`)
  ok((await intents()).length === before, 'aucune préparation créée par ces appels')

  console.log('\n2. Propriétaire')
  const own = await subscribe(await cookieFor('admin@northcode.ng'), body)
  const after = await intents()
  const it = after[0]
  console.log(`    réponse : ${own.status} « ${own.body.error || 'ok'} »`)
  ok(after.length === before + 1 && it?.plan === 'pro' && it?.billing_period === 'monthly', 'préparation enregistrée par le serveur (Pro, mensuel)', it)
  ok(it && it.currency === 'NGN' && Number(it.amount) === 9999 && Number(it.amount_due) === 9999, `montant du catalogue calculé par le serveur : ${it?.amount} ${it?.currency}`)
  ok(it && /^SS-a0000000-/.test(it.reference) && it.gateway === 'paystack' && it.owner_id, `notre référence ${it?.reference}, passerelle ${it?.gateway}`)
  ok(own.status === 500 && it?.status === 'failed' && it?.review_reason === 'paystack_not_configured', `passerelle non configurée en local : « abandonnée » (${it?.status}, ${it?.review_reason})`)

  const vf = await W.verify()
  ok(!vf.removed.length && !vf.modified.length, `rien de préexistant supprimé ni modifié (${vf.removed.length} / ${vf.modified.length})`, vf.modified)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
