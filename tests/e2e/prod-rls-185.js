// Migration 185 — contrôle EN LIGNE, LECTURE SEULE : ce que la base renvoie réellement à chaque compte (session réelle,
// clé publique, comme le navigateur), boutique par boutique, comparé aux règles validées (25 et 26 oct. 2026) :
// ventes (toutes : direction + observateur avec Historique | Caisse ; les siennes : Vendre | Historique | Caisse),
// paiements (vente lisible + Historique | Caisse), lignes (vente lisible + Historique | Vendre), clients non supprimés
// (Clients | Vendre | Historique | Crédits), réservations (Stock | Vendre). Uniquement des comptages (SELECT).
// Usage : node tests/e2e/prod-rls-185.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ACCOUNTS = ['ghislainx123@gmail.com', 'ghislainx123+jeanpaul@gmail.com', 'cassierstock@gmail.com', 'ghislainx123+mariam@gmail.com',
  'stocshopci+magasinier@gmail.com', 'ghislainx123+fatou@gmail.com', 'stocshopci@gmail.com', 'stocshopci+observateur@gmail.com']
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const n = async q => { const { count, error } = await q; return error ? `erreur ${error.code || error.message}` : count || 0 }
const head = (db, t, cols = 'id') => db.from(t).select(cols, { count: 'exact', head: true })
// Comptages d'une boutique : « all » = toute la boutique, sinon les ventes de `seller`
const counts = async (db, shop, seller) => {
  const s = q => (seller ? q.eq('cashier_id', seller) : q), si = q => (seller ? q.eq('sales.cashier_id', seller) : q)
  return {
    sales: await n(s(head(db, 'sales').eq('shop_id', shop))),
    pay: await n(si(head(db, 'payments', 'id, sales!inner(shop_id, cashier_id)').eq('sales.shop_id', shop))),
    items: await n(si(head(db, 'sale_items', 'id, sales!inner(shop_id, cashier_id)').eq('sales.shop_id', shop))),
  }
}

;(async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'lib/permissions/index.ts')).href)
  const users = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users
  const shops = Object.fromEntries(((await admin.from('shops').select('id, name, role_permissions')).data || []).map(s => [s.id, s]))
  for (const email of ACCOUNTS) {
    const u = users.find(x => x.email === email)
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { error } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) { ok(false, `${email} : connexion impossible (${error.message})`); continue }
    const members = (await admin.from('shop_members').select('shop_id, role').eq('user_id', u.id).eq('is_active', true)).data || []
    console.log(email)
    for (const m of members) {
      const rp = shops[m.shop_id]?.role_permissions ?? null, r = m.role
      const any = fs => r === 'owner' || fs.some(f => P.canView(rp, r, f))
      const scope = ['owner', 'manager', 'shop_manager', 'viewer'].includes(r) && any(['sales_history', 'caisse']) ? 'all'
        : any(['new_sale', 'sales_history', 'caisse']) ? 'own' : 'none'
      const base = scope === 'none' ? { sales: 0, pay: 0, items: 0 } : await counts(admin, m.shop_id, scope === 'own' ? u.id : null)
      const want = { sales: base.sales, pay: any(['sales_history', 'caisse']) ? base.pay : 0, items: any(['sales_history', 'new_sale']) ? base.items : 0,
        custs: any(['customers', 'new_sale', 'sales_history', 'payments']) ? await n(head(admin, 'customers').eq('shop_id', m.shop_id).is('deleted_at', null)) : 0,
        resv: any(['stock', 'new_sale']) ? await n(head(admin, 'stock_reservations').eq('shop_id', m.shop_id)) : 0 }
      const seen = { ...(await counts(db, m.shop_id, null)),
        custs: await n(head(db, 'customers').eq('shop_id', m.shop_id)), resv: await n(head(db, 'stock_reservations').eq('shop_id', m.shop_id)) }
      const same = Object.keys(want).every(k => seen[k] === want[k])
      ok(same, `${(shops[m.shop_id]?.name || m.shop_id).slice(0, 24).padEnd(24)} ${r.padEnd(13)} ventes ${scope.padEnd(4)} · lu ${Object.values(seen).join('/')} · attendu ${Object.values(want).join('/')}  (ventes/paiements/lignes/clients/réservations)`)
    }
    await db.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  ok(await n(head(anon, 'sales')) === 0 && await n(head(anon, 'customers')) === 0, 'anonyme : aucune vente, aucun client')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
