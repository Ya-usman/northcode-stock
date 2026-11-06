// Contrôle LECTURE SEULE du compte de démonstration (stocshopci+demo@gmail.com)
const fs = require('fs')
const ROOT = 'C:/Users/ghisl/Desktop/Stock Manager'
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

async function all(q) { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break } return out }

;(async () => {
  const users = []
  for (let page = 1; page < 30; page++) { const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 }); users.push(...data.users); if (data.users.length < 1000) break }
  const owner = users.find(u => u.email === 'stocshopci+demo@gmail.com')
  ok(!!owner, 'propriétaire stocshopci+demo@gmail.com')
  const { data: ents } = await db.from('entities').select('*').eq('owner_user_id', owner.id)
  const e = ents[0]
  ok(ents.length === 1 && e.name === 'Marché Soleil' && e.is_internal && e.plan === 'business', `entreprise interne, Business (${e.plan}, jusqu'au ${String(e.plan_expires_at).slice(0, 10)})`)
  const { data: shops } = await db.from('shops').select('*').eq('entity_id', e.id).is('deleted_at', null).order('created_at')
  ok(shops.length === 3, 'trois boutiques : ' + shops.map(s => s.name).join(', '))
  const notif = shops.flatMap(s => Object.entries(s).filter(([k, v]) => k.startsWith('notify_') && v === true).map(([k]) => s.name + ':' + k))
  ok(notif.length === 0, 'toutes les notifications coupées', notif)
  ok(shops.every(s => s.timezone === 'Africa/Douala' && s.is_internal && s.currency === 'XAF'), 'fuseau Douala, internes, XAF')
  const ids = shops.map(s => s.id)
  const { data: members } = await db.from('shop_members').select('user_id, role, shop_id, is_active').in('shop_id', ids)
  ok(members.filter(m => m.role !== 'owner').length === 4, 'quatre membres fictifs : ' + members.filter(m => m.role !== 'owner').map(m => m.role).join(', '))
  for (const s of shops) {
    const sales = await all(() => db.from('sales').select('created_at, total, amount_paid, review_reason, sale_status, client_request_id').eq('shop_id', s.id).order('created_at'))
    const active = sales.filter(x => x.sale_status === 'active')
    const flagged = active.filter(x => x.review_reason)
    const { count: products } = await db.from('products').select('*', { count: 'exact', head: true }).eq('shop_id', s.id)
    const { count: neg } = await db.from('products').select('*', { count: 'exact', head: true }).eq('shop_id', s.id).lt('quantity', 0)
    const owed = active.reduce((n, x) => n + Number(x.total) - Number(x.amount_paid), 0)
    console.log(`  ${s.name} : ${active.length} ventes du ${active[0]?.created_at.slice(0, 10)} au ${active[active.length - 1]?.created_at.slice(0, 10)} · CA ${fmt(active.reduce((n, x) => n + Number(x.total), 0))} F CFA · ${products} produits · crédits restants ${fmt(owed)}`)
    ok(flagged.length === 0, `${s.name} : aucune vente « à vérifier »`, flagged.slice(0, 3).map(x => x.review_reason))
    ok(neg === 0, `${s.name} : aucun stock négatif`)
  }
  const { count: exp } = await db.from('expenses').select('*', { count: 'exact', head: true }).in('shop_id', ids)
  ok(exp >= 80, `dépenses enregistrées : ${exp}`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
