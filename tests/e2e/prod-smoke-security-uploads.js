// Contrôle EN LIGNE après push de 0e07d4f (upload-image / pdf-download). Uniquement des requêtes qui doivent
// être REFUSÉES avant toute écriture — aucun fichier ne peut être déposé.
// Usage : node tests/e2e/prod-smoke-security-uploads.js
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
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
async function cookieOf(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  return parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function upload(cookie, shopId, bytes, type) {
  const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), 'a.png'); fd.append('shop_id', shopId)
  return (await fetch(`${BASE}/api/products/upload-image`, { method: 'POST', body: fd, headers: cookie ? { cookie } : {} })).status
}
const pdf = async (cookie, body) => (await fetch(`${BASE}/api/pdf-download`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })).status
const countAkwa = async () => ((await admin.storage.from('product-images').list(AKWA, { limit: 1000 })).data || []).length

;(async () => {
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    // Sans connexion, type refusé : l'ancienne version aurait déposé le fichier ; la nouvelle répond 401 avant tout
    const s = await pdf('', { data: '', filename: 'x', contentType: 'text/html' })
    live = s === 401
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvelle version :', live ? 'en ligne' : `pas encore (${s})`)
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  const before = await countAkwa()
  const [alphaOwner, fatou, owner] = await Promise.all(['admin@northcode.ng', 'ghislainx123+fatou@gmail.com', 'ghislainx123@gmail.com'].map(cookieOf))
  ok(true, 'pdf-download sans connexion : 401')
  ok(await upload('', AKWA, PNG, 'image/png') === 401, 'upload-image sans connexion : 401')
  ok(await upload(alphaOwner, AKWA, PNG, 'image/png') === 403, 'upload-image depuis une autre entreprise : 403')
  ok(await upload(fatou, AKWA, PNG, 'image/png') === 403, 'upload-image par la caissière (sans Stock en modification) : 403')
  ok(await upload(owner, AKWA, Buffer.from('<html></html>'), 'image/jpeg') === 400, 'faux JPEG refusé : 400')
  ok(await pdf(owner, { data: Buffer.from('<html>').toString('base64'), filename: 'x.html', contentType: 'text/html' }) === 400, 'pdf-download connecté, type HTML : 400')
  ok(await countAkwa() === before, 'aucun fichier déposé chez Akwa')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
