// Trame temps réel BRUTE après la 182 — écriture réelle autorisée (25 oct. 2026) sur Boutique Alpha : le favori d'UN
// produit est coché puis décoché (clé serveur), pendant qu'un CAISSIER (sans droit au coût) a la caisse ouverte en
// ligne. On lit les trames WebSocket telles que reçues par le navigateur, avant tout traitement par l'écran.
// État remis à l'identique, sauf updated_at (déclencheur de la base) ; aucune autre table touchée.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001', PRODUCT = 'c94693b3-fb67-4ccd-a3fa-3a41036122ff'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const read = async () => (await db.from('products').select('*').eq('id', PRODUCT).eq('shop_id', ALPHA).single()).data
  const before = await read()
  if (!before || before.is_favorite !== false) throw new Error('produit introuvable ou déjà favori — arrêt, rien écrit')
  console.log(`Produit : ${before.name} (Alpha), favori = ${before.is_favorite}, updated_at = ${before.updated_at}`)

  process.env.CAPTURE_EMAIL = 'stocshopci@gmail.com'; process.env.PIN_SHOP = ALPHA
  const s = await session({ width: 1280, height: 860, locale: 'fr' })
  const frames = []
  s.page.on('websocket', ws => { if (/realtime/.test(ws.url())) ws.on('framereceived', f => { if (typeof f.payload === 'string') frames.push(f.payload) }) })
  await s.page.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await wait(12000)
  const subscribed = frames.some(f => f.includes('phx_reply') && f.includes('"status":"ok"') && f.includes('postgres_changes'))
  ok(subscribed, 'caissier : caisse ouverte, abonnement temps réel aux changements accepté')

  let restored = false
  try {
    const up1 = await db.from('products').update({ is_favorite: true }).eq('id', PRODUCT).eq('shop_id', ALPHA).select('id')
    ok(!up1.error && up1.data?.length === 1, 'écriture 1 : favori coché (1 ligne)')
    await wait(6000)
  } finally {
    const up2 = await db.from('products').update({ is_favorite: false }).eq('id', PRODUCT).eq('shop_id', ALPHA).select('id')
    restored = !up2.error && up2.data?.length === 1
    ok(restored, 'écriture 2 : favori décoché (état d\'origine)')
  }
  await wait(6000)
  await s.browser.close()

  const events = frames.filter(f => f.includes('postgres_changes') && f.includes(PRODUCT))
  console.log(`  … ${frames.length} trame(s) reçue(s), dont ${events.length} sur ce produit`)
  ok(events.length >= 2, `trames brutes : les 2 modifications reçues par le caissier (${events.length})`)
  ok(events.every(f => !f.includes('buying_price')), 'trames brutes : buying_price ABSENT (ni record ni old_record)')
  ok(events.some(f => /"is_favorite":\s*true/.test(f)) && events.every(f => f.includes('"name"') && f.includes('"selling_price"')), 'trames brutes : le reste de la ligne arrive (nom, prix de vente, favori)')
  ok(frames.every(f => !f.includes('buying_price')), 'aucune trame de la session ne contient buying_price')
  if (events[0]) console.log('  extrait :', events[0].replace(/"(id|shop_id|category_id|supplier_id)":"[^"]+"/g, '"$1":"…"').slice(0, 420))

  const after = await read()
  const changed = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  ok(restored && changed.every(k => k === 'updated_at'), `produit remis à l'identique (seul updated_at a changé : ${changed.join(', ') || 'rien'})`)
  console.log(`  updated_at : ${before.updated_at} → ${after.updated_at}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
