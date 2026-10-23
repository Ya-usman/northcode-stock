// Contrôle EN LIGNE de pure lecture après push de 1a6cc57 (devise de consolidation, réglage Entreprise).
// Requêtes GET seulement — aucune écriture possible.
// Usage : node tests/e2e/prod-smoke-d1-commit1.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const BASE = 'https://stockshop.tech'
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function login(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  return async url => { const r = await fetch(BASE + url, { headers: { cookie, 'accept-language': 'fr' } }); let json = {}; try { json = await r.json() } catch {} return { status: r.status, json } }
}
;(async () => {
  const soleil = await login('ghislainx123@gmail.com')
  let r, live = false
  for (let i = 0; i < 40 && !live; i++) {
    r = await soleil(`/api/entity?shop_id=${AKWA}`)
    live = r.status === 200 && 'consolidation_currency' in (r.json.entity || {})
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvelle version :', live ? 'en ligne' : `pas encore (${r.status})`)
    if (!live) await new Promise(res => setTimeout(res, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  ok(r.json.entity.consolidation_currency === 'XAF' && r.json.entity.shop_currencies.join() === 'XAF', 'Marché Soleil : XAF, boutiques XAF')
  const alpha = await (await login('admin@northcode.ng'))(`/api/entity?shop_id=${ALPHA}`)
  ok(alpha.status === 200 && alpha.json.entity.consolidation_currency === 'NGN' && alpha.json.entity.shop_currencies.join() === 'NGN,XAF', 'Alpha : NGN, boutiques NGN + XAF')
  ok((await (await login('ghislainx123+fatou@gmail.com'))(`/api/entity?shop_id=${AKWA}`)).status === 403, 'caissière : 403')
  const page = await fetch(`${BASE}/fr/settings/company`)
  ok(page.status < 500, `page Entreprise servie (${page.status})`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
