// Repères du compte vitrine Marché Soleil, relus en base (LECTURE SEULE) et écrits dans tests/e2e/out/vitrine/ :
//   akwa-id.txt          boutique Akwa du compte français (ghislainx123@gmail.com)
//   akwa-english-id.txt  boutique Akwa de la copie anglaise (autre compte : sert aux contrôles « boutique étrangère »)
//   state.json           { shops: {akwa, bastos, bonapriso}, products: { akwa: {clé: id}, bastos: {…}, bonapriso: {…} } }
// Remplace les fichiers produits autrefois par le script de remplissage de la vitrine. Lancé par run-local.sh.
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../..')
const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
// Clés utilisées par les tests → nom français du produit dans la vitrine
const PRODUCTS = {
  oeufs: 'Œufs (plateau de 30)', tomates: 'Tomates 1 kg', bananes: 'Bananes 1 kg', pain: 'Pain de campagne',
  riz: 'Riz parfumé 5 kg', eau: 'Eau minérale 1,5 L', savon: 'Savon de ménage',
}
const SHOPS = { akwa: 'Marché Soleil Akwa', bastos: 'Marché Soleil Bastos', bonapriso: 'Marché Soleil Bonapriso' }

;(async () => {
  const { data: akwa, error } = await db.from('shops').select('id, owner_id').eq('id', AKWA).single()
  if (error) throw new Error('boutique Akwa introuvable : ' + error.message)
  const { data: own } = await db.from('shops').select('id, name').eq('owner_id', akwa.owner_id)
  const shops = {}
  for (const [k, name] of Object.entries(SHOPS)) {
    const s = own.find(x => x.name === name)
    if (!s) throw new Error('boutique introuvable : ' + name)
    shops[k] = s.id
  }
  const { data: same } = await db.from('shops').select('id, owner_id').eq('name', SHOPS.akwa).neq('owner_id', akwa.owner_id)
  if (!same?.length) throw new Error('copie anglaise d’Akwa introuvable')
  const products = {}
  for (const [k, shopId] of Object.entries(shops)) {
    const { data: rows } = await db.from('products').select('id, name').eq('shop_id', shopId).in('name', Object.values(PRODUCTS))
    products[k] = {}
    for (const [key, name] of Object.entries(PRODUCTS)) { const p = rows.find(r => r.name === name); if (p) products[k][key] = p.id }
  }
  const out = path.join(__dirname, '..', 'out', 'vitrine'); fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'akwa-id.txt'), AKWA)
  fs.writeFileSync(path.join(out, 'akwa-english-id.txt'), same[0].id)
  fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify({ shops, products }, null, 1))
  console.log('repères vitrine :', Object.keys(products).map(k => `${k} ${Object.keys(products[k]).length}`).join(', '))
})().catch(e => { console.error('ERREUR repères vitrine :', e.message); process.exit(1) })
