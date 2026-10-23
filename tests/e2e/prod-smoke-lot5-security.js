// Contrôle EN LIGNE de pure lecture après push de 3a9d007 (sécurité tableau de bord + Rapports).
// Requêtes GET seulement, avec les sessions réelles de l'équipe vitrine Marché Soleil — aucune écriture possible.
// Usage : node tests/e2e/prod-smoke-lot5-security.js
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
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function login(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  // GET uniquement : ce contrôle ne peut rien écrire
  const get = async url => { const r = await fetch(BASE + url, { headers: { cookie, 'accept-language': 'fr' } }); let json = {}; try { json = await r.json() } catch {} return { status: r.status, json } }
  return { id: data.user.id, get }
}
async function paymentsSum(shopId, from, to, sellerId) {
  const { data } = await admin.from('payments').select('amount, is_cancelled, is_write_off, sales!inner(shop_id, sale_status, cashier_id)').eq('sales.shop_id', shopId).gte('paid_at', from).lte('paid_at', to).limit(5000)
  return (data || []).filter(p => p.sales.sale_status !== 'cancelled' && !p.is_cancelled && !p.is_write_off && (!sellerId || p.sales.cashier_id === sellerId)).reduce((n, p) => n + Number(p.amount), 0)
}

;(async () => {
  const now = new Date(), end = now.toISOString(), from = new Date(now.getTime() - 90 * 86400000).toISOString()
  const q = `shop_ids=${AKWA}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}&week_start=${encodeURIComponent(from)}`
  const mariam = await login('ghislainx123+mariam@gmail.com')
  let live = false
  for (let i = 0; i < 30 && !live; i++) {
    const r = await mariam.get(`/api/reports/summary?shop_ids=${BASTOS}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
    live = r.status === 403
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvelle version :', live ? 'en ligne' : `pas encore (${r.status})`)
    if (!live) await new Promise(res => setTimeout(res, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }
  ok(true, 'gestionnaire de stock : Rapports refusés (403) malgré canViewCost')
  ok((await mariam.get(`/api/dashboard/top-products?period=month&shop_ids=${BASTOS}`)).status === 403, 'gestionnaire de stock : top produits refusé')

  const fatou = await login('ghislainx123+fatou@gmail.com')
  const own = await paymentsSum(AKWA, from, end, fatou.id)
  let r = await fatou.get(`/api/dashboard/payments-today?${q}`)
  const total = (r.json.weekPayments || []).reduce((n, d) => n + Number(d.amount), 0)
  ok(r.status === 200 && Math.abs(total - own) < 0.005, `caissière, filtre vendeur retiré : ses seules ventes (${total} = ${own})`)
  r = await fatou.get(`/api/dashboard/expense-revenue?shop_ids=${AKWA}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(end)}`)
  ok(r.status === 403, 'caissière : chiffre d’affaires de la boutique sur 6 mois refusé')
  r = await fatou.get(`/api/reports/summary?shop_ids=${AKWA}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 403, 'caissière : Rapports refusés')

  const owner = await login('ghislainx123@gmail.com')
  r = await owner.get(`/api/reports/summary?shop_ids=${AKWA}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(end)}`)
  ok(r.status === 200 && r.json.totals && !/buying_price|cogs|stock_buying_value|product_costs/.test(JSON.stringify(r.json)), 'propriétaire : Rapports d’Akwa, aucun coût dans la réponse (marge par sa route dédiée)')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
