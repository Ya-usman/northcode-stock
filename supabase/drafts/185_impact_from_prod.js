// Préparation de la 185 (lot 2B, B2) — LECTURE SEULE : pour chaque adhésion active réelle, ce que la personne peut
// lire DIRECTEMENT aujourd'hui (règles RLS actuelles) et ce qu'elle pourrait lire après la 185 (règles validées le
// 25 oct. 2026), table par table : ventes, paiements, lignes de vente, clients, réservations de stock.
// Aucune écriture ; seuls des comptages (clé de service). Les noms ne sortent pas du terminal.
// Usage : node supabase/drafts/185_impact_from_prod.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const count = async q => { const { count: n, error } = await q; if (error) throw new Error(error.message); return n || 0 }
const head = (t, cols = 'id') => db.from(t).select(cols, { count: 'exact', head: true })

;(async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'lib/permissions/index.ts')).href)
  const view = (rp, role, f) => role === 'owner' || P.canView(rp, role, f)
  const any = (rp, role, fs) => fs.some(f => view(rp, role, f))
  const { data: members } = await db.from('shop_members').select('shop_id, user_id, role').eq('is_active', true)
  const { data: shops } = await db.from('shops').select('id, name, role_permissions')
  const shop = Object.fromEntries(shops.map(s => [s.id, s]))
  const cache = {}
  const memo = (k, f) => (cache[k] ??= f())
  // Volumes par boutique, et par vendeur
  const salesAll = id => memo('s' + id, () => count(head('sales').eq('shop_id', id)))
  const salesOwn = (id, u) => memo(`s${id}${u}`, () => count(head('sales').eq('shop_id', id).eq('cashier_id', u)))
  const payAll = id => memo('p' + id, () => count(head('payments', 'id, sales!inner(shop_id)').eq('sales.shop_id', id)))
  const payOwn = (id, u) => memo(`p${id}${u}`, () => count(head('payments', 'id, sales!inner(shop_id, cashier_id)').eq('sales.shop_id', id).eq('sales.cashier_id', u)))
  const itemsAll = id => memo('i' + id, () => count(head('sale_items', 'id, sales!inner(shop_id)').eq('sales.shop_id', id)))
  const itemsOwn = (id, u) => memo(`i${id}${u}`, () => count(head('sale_items', 'id, sales!inner(shop_id, cashier_id)').eq('sales.shop_id', id).eq('sales.cashier_id', u)))
  const custs = id => memo('c' + id, () => count(head('customers').eq('shop_id', id).is('deleted_at', null)))
  const resv = id => memo('r' + id, () => count(head('stock_reservations').eq('shop_id', id)))

  const rows = []
  for (const m of members) {
    const rp = shop[m.shop_id]?.role_permissions ?? null, r = m.role
    const ownOnlyNow = r === 'cashier' || r === 'stock_manager'
    // AVANT (RLS actuelle) : ventes = les siennes (caissier, magasinier) ou toutes ; paiements / lignes = ceux des
    // ventes visibles ; clients non supprimés ; réservations : membre
    const before = ownOnlyNow
      ? { sales: await salesOwn(m.shop_id, m.user_id), pay: await payOwn(m.shop_id, m.user_id), items: await itemsOwn(m.shop_id, m.user_id) }
      : { sales: await salesAll(m.shop_id), pay: await payAll(m.shop_id), items: await itemsAll(m.shop_id) }
    Object.assign(before, { custs: await custs(m.shop_id), resv: await resv(m.shop_id) })
    // APRÈS (185) : toutes les ventes = direction + observateur ET (Historique | Contrôle de caisse) ; sinon ses ventes
    // avec (Vendre | Historique | Contrôle de caisse) ; caissier et magasinier : jamais plus que les leurs
    const allSales = ['owner', 'manager', 'shop_manager', 'viewer'].includes(r) && any(rp, r, ['sales_history', 'caisse'])
    const ownSales = any(rp, r, ['new_sale', 'sales_history', 'caisse'])
    const scope = allSales ? 'all' : ownSales ? 'own' : 'none'
    const S = scope === 'all' ? await salesAll(m.shop_id) : scope === 'own' ? await salesOwn(m.shop_id, m.user_id) : 0
    const PAY = !any(rp, r, ['sales_history', 'caisse']) ? 0 : scope === 'all' ? await payAll(m.shop_id) : scope === 'own' ? await payOwn(m.shop_id, m.user_id) : 0
    const IT = !any(rp, r, ['sales_history', 'new_sale']) ? 0 : scope === 'all' ? await itemsAll(m.shop_id) : scope === 'own' ? await itemsOwn(m.shop_id, m.user_id) : 0
    const after = { sales: S, pay: PAY, items: IT,
      custs: any(rp, r, ['customers', 'new_sale', 'sales_history', 'payments']) ? await custs(m.shop_id) : 0,
      resv: any(rp, r, ['stock', 'new_sale']) ? await resv(m.shop_id) : 0 }
    rows.push({ shop: shop[m.shop_id]?.name || m.shop_id, role: r, before, after, scope })
  }

  const lost = rows.filter(x => Object.keys(x.before).some(k => x.after[k] < x.before[k]))
  const gained = rows.filter(x => Object.keys(x.before).some(k => x.after[k] > x.before[k]))
  console.log(`${rows.length} adhésions actives · ${lost.length} perdent une lecture directe · ${gained.length} en gagnent (doit être 0)`)
  const byRole = {}
  for (const x of rows) { const k = `${x.role}`; byRole[k] = byRole[k] || { n: 0, lose: 0 }; byRole[k].n++; if (lost.includes(x)) byRole[k].lose++ }
  console.log('par rôle :', JSON.stringify(byRole))
  for (const x of lost) {
    const d = Object.keys(x.before).filter(k => x.after[k] < x.before[k]).map(k => `${k} ${x.before[k]}→${x.after[k]}`).join(', ')
    console.log(`  ${x.shop.slice(0, 26).padEnd(26)} ${x.role.padEnd(13)} ventes : ${x.scope.padEnd(4)} · ${d}`)
  }
  for (const x of gained) console.log(`  GAGNE ?! ${x.shop} ${x.role} ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
