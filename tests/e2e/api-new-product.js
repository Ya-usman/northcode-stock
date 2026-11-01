// Lot A des ajouts (1er nov. 2026) : POST /api/products refuse ce qui enfreint les règles communes, côté serveur.
// Serveur LOCAL, Boutique Alpha, compte propriétaire. Toutes les requêtes doivent être REFUSÉES (400 / 409) : aucune
// écriture attendue ; le nombre de produits de la boutique est comparé avant / après (arrêt et signalement sinon).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/api-new-product.js
const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (!/localhost|127\.0\.0\.1/.test(BASE)) { console.error('Serveur local seulement'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: 'admin@northcode.ng' })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw error
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
  const post = body => fetch(`${BASE}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const count = async () => (await db.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA)).count
  const { data: existing } = await db.from('products').select('name').eq('shop_id', ALPHA).eq('is_active', true).limit(1).single()
  const before = await count()
  const base = { shop_id: ALPHA, name: 'TEST lotA refus', selling_price: 500, buying_price: 300, quantity: 0, unit: 'piece' }

  const cases = [
    ['nom fait d’espaces', { name: '    ' }, 400, 'name', /nom du produit est obligatoire/],
    ['prix de vente 0', { selling_price: 0 }, 400, 'selling_price', /supérieur à 0/],
    ['prix de vente négatif', { selling_price: -100 }, 400, 'selling_price', /supérieur à 0/],
    ['prix d’achat négatif', { buying_price: -1 }, 400, 'buying_price', /prix d’achat/],
    ['quantité 2,5', { quantity: 2.5 }, 400, 'quantity', /nombre entier/],
    ['unité inconnue', { unit: 'tonneau' }, 400, 'unit', /Unité inconnue/],
    ['code-barres de 65 caractères', { sku: 'A'.repeat(65) }, 400, 'sku', /64 caractères/],
    ['code-barres GTIN faux', { sku: '5901234123458' }, 400, 'sku', /code-barres n’est pas valide/],
    ['date de péremption impossible', { quantity: 3, expiry_date: '2026-02-30' }, 400, 'expiry_date', /Date invalide/],
    [`même nom qu’un produit actif (« ${existing.name.trim()} », en majuscules)`, { name: existing.name.toUpperCase() }, 409, 'name', /existe déjà/],
  ]
  for (const [label, patch, status, field, re] of cases) {
    const r = await post({ ...base, ...patch, track_serials: true, is_kit: true })
    ok(r.status === status && r.body.field === field && re.test(r.body.error || ''), `${label} : ${r.status} « ${r.body.error} »`, r.body)
  }
  const after = await count()
  ok(after === before, `aucun produit créé (${before} → ${after})`)
  if (after !== before) console.log('ATTENTION : écriture inattendue sur Boutique Alpha, à signaler')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
