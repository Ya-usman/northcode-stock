// Correctif sécurité du 23 oct. 2026 — /api/products/upload-image et /api/pdf-download.
// Requêtes directes au serveur LOCAL avec les sessions réelles. Refus attendus sans aucune écriture ; deux
// écritures réelles seulement, supprimées ensuite par leur chemin exact : une image dans le dossier
// d'Alpha (product-images) et un PDF temporaire (temp-pdfs).
// Usage : node tests/e2e/security-uploads.js   (serveur local requis)
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('Serveur local uniquement'); process.exit(1) }
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const ALPHA = 'a0000000-0000-0000-0000-000000000001', AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function cookieOf(email) {
  if (!email) return ''
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  return parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
}
// PNG 1×1 valide
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function upload(cookie, shopId, bytes, name, type) {
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type }), name)
  if (shopId !== undefined) fd.append('shop_id', shopId)
  const r = await fetch(`${BASE}/api/products/upload-image`, { method: 'POST', body: fd, headers: cookie ? { cookie } : {} })
  let json = {}; try { json = await r.json() } catch {}
  return { status: r.status, json }
}
async function pdf(cookie, body) {
  const r = await fetch(`${BASE}/api/pdf-download`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  let json = {}; try { json = await r.json() } catch {}
  return { status: r.status, json }
}
const countIn = async (bucket, prefix) => ((await admin.storage.from(bucket).list(prefix, { limit: 1000 })).data || []).length

;(async () => {
  const [owner, fatou, mariam, alphaOwner] = await Promise.all(['ghislainx123@gmail.com', 'ghislainx123+fatou@gmail.com', 'ghislainx123+mariam@gmail.com', 'admin@northcode.ng'].map(cookieOf))
  const before = { akwa: await countIn('product-images', AKWA), bastos: await countIn('product-images', BASTOS) }

  console.log('\n1. /api/products/upload-image — refus AVANT tout envoi')
  ok((await upload('', AKWA, PNG, 'a.png', 'image/png')).status === 401, 'sans connexion : 401')
  ok((await upload(alphaOwner, AKWA, PNG, 'a.png', 'image/png')).status === 403, 'propriétaire d’une AUTRE entreprise (Alpha → Akwa) : 403')
  ok((await upload(mariam, AKWA, PNG, 'a.png', 'image/png')).status === 403, 'gestionnaire de stock de Bastos vers Akwa (non membre) : 403')
  ok((await upload(fatou, AKWA, PNG, 'a.png', 'image/png')).status === 403, 'caissière d’Akwa (sans Stock en modification) : 403')
  ok((await upload(owner, 'pas-un-uuid', PNG, 'a.png', 'image/png')).status === 400, 'identifiant de boutique invalide : 400')
  ok((await upload(owner, undefined, PNG, 'a.png', 'image/png')).status === 400, 'boutique absente : 400')
  const fake = await upload(owner, AKWA, Buffer.from('<html><script>alert(1)</script></html>'), 'photo.jpg', 'image/jpeg')
  ok(fake.status === 400, `faux JPEG (contenu HTML, type annoncé image/jpeg) : refusé (${fake.status})`)
  const big = await upload(owner, AKWA, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png')
  ok(big.status === 400, `plus de 5 Mo : refusé (${big.status})`)
  ok(await countIn('product-images', AKWA) === before.akwa && await countIn('product-images', BASTOS) === before.bastos, 'aucun fichier déposé chez Marché Soleil (Akwa, Bastos)')

  console.log('\n2. /api/products/upload-image — envoi autorisé (Alpha, supprimé ensuite)')
  const good = await upload(alphaOwner, ALPHA, PNG, 'photo.html', 'text/html')
  const objPath = good.json.url && decodeURIComponent(good.json.url.split('/product-images/')[1] || '')
  ok(good.status === 200 && objPath.startsWith(`${ALPHA}/`) && objPath.endsWith('.png'), `propriétaire d’Alpha : accepté, extension tirée du vrai type (.png, malgré « photo.html ») → ${objPath}`)
  if (objPath) {
    const { data: info } = await admin.storage.from('product-images').list(ALPHA, { search: objPath.split('/')[1] })
    ok(info?.[0]?.metadata?.mimetype === 'image/png', `type enregistré : ${info?.[0]?.metadata?.mimetype} (pas text/html)`)
    const { error } = await admin.storage.from('product-images').remove([objPath])
    ok(!error, 'fichier de test supprimé')
  }

  console.log('\n3. /api/pdf-download')
  const pdfData = Buffer.from('%PDF-1.4\n%test\n').toString('base64')
  ok((await pdf('', { data: pdfData, filename: 'x.pdf', contentType: 'application/pdf' })).status === 401, 'sans connexion : 401')
  ok((await pdf(owner, { data: Buffer.from('<html>').toString('base64'), filename: 'x.html', contentType: 'text/html' })).status === 400, 'type HTML : refusé')
  ok((await pdf(owner, { data: pdfData, filename: 'x.bin', contentType: 'application/octet-stream' })).status === 400, 'type quelconque : refusé')
  ok((await pdf(owner, { data: '', filename: 'x.pdf', contentType: 'application/pdf' })).status === 400, 'contenu vide : refusé')
  const okPdf = await pdf(owner, { data: pdfData, filename: 'Rapport "test"/../x', contentType: 'application/pdf' })
  const tmpPath = okPdf.json.url && decodeURIComponent((okPdf.json.url.split('/temp-pdfs/')[1] || '').split('?')[0])
  ok(okPdf.status === 200 && /\.pdf$/.test(tmpPath), `connecté, PDF : lien signé (${tmpPath})`)
  const dl = okPdf.json.url && decodeURIComponent(new URL(okPdf.json.url).searchParams.get('download') || '')
  ok(dl && !/["/\\]/.test(dl) && dl.endsWith('.pdf'), `nom de téléchargement nettoyé : « ${dl} »`)
  const csv = await pdf(owner, { data: Buffer.from('a;b\n1;2').toString('base64'), filename: 'x.csv', contentType: 'text/csv;charset=utf-8' })
  const csvPath = csv.json.url && decodeURIComponent((csv.json.url.split('/temp-pdfs/')[1] || '').split('?')[0])
  ok(csv.status === 200 && /\.csv$/.test(csvPath), 'CSV des exports (avec ;charset=utf-8) : accepté')
  const toRemove = [tmpPath, csvPath].filter(Boolean)
  if (toRemove.length) { const { error } = await admin.storage.from('temp-pdfs').remove(toRemove); ok(!error, `fichiers temporaires de test supprimés (${toRemove.length})`) }

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
