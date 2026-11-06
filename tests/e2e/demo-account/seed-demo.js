// Compte de DÉMONSTRATION (stocshopci+demo@gmail.com) : copie du contenu de la vitrine Marché Soleil sur 90 jours,
// carte blanche de l'utilisateur le 6 nov. 2026. Marché Soleil lui-même n'est JAMAIS modifié (photos lues seulement).
// Sans argument : SIMULATION (aucune écriture, aucune session ouverte).
// --execute [--stage=compte|boutiques|equipe|catalogue|ventes|operations] : écriture réelle, par les routes de
// l'application (session du propriétaire) ; les ventes passent par la fonction de vente de l'application avec leur
// heure réelle. Toute écriture directe est limitée à cette entreprise. Aucun secret affiché.
const fs = require('fs')
const ROOT = 'C:/Users/ghisl/Desktop/Stock Manager'
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.SEED_BASE || 'http://localhost:3000'
const D = require('./data-demo.js')
const { buildPlan, initialStock, summary } = require('./plan.js')

// VITRINE_LANG=en : copie interne aux libellés anglais, pour les captures en anglais (demandée le 13 oct. 2026).
// Compte propriétaire distinct, créé directement et déjà confirmé : AUCUN e-mail n'est envoyé (ni inscription, ni invitation).
const EN = true   // ici : création directe sans e-mail (libellés français)
const OWNER_EMAIL = 'stocshopci+demo@gmail.com'
// Clés d'idempotence : la fonction de vente les reconnaît sur TOUTE la plateforme — chaque copie a donc son préfixe
const KEY = 'demo'
const MEMBER_EMAIL = alias => `stocshopci+demo.${alias}@gmail.com`
const ADMIN_EMAIL = 'admin@northcode.ng'
const SOURCE_AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'   // Marché Soleil Akwa : LECTURE SEULE (photos)
const EXECUTE = process.argv.includes('--execute')
const STAGE = (process.argv.find(a => a.startsWith('--stage=')) || '').slice(8) || null
const STATE_FILE = __dirname + '/state-demo.json'
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { done: {} }
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
const stop = msg => { console.log('ARRÊT :', msg); process.exit(2) }
const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const must = (res, what) => { if (res.error) throw new Error(what + ' : ' + res.error.message); return res.data }

async function sessionCookie(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error('lien de session : ' + error.message)
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (e2) throw new Error('session : ' + e2.message)
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  return parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ') + '; NEXT_LOCALE=fr'
}
async function api(cookie, method, path, body, form) {
  const res = await fetch(BASE + path, { method, headers: form ? { Cookie: cookie } : { Cookie: cookie, 'Content-Type': 'application/json' }, body: form || (body ? JSON.stringify(body) : undefined) })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
  return json
}
async function pool(items, size, fn) { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } })) }

async function resolveAccount() {
  const users = []
  for (let page = 1; page < 30; page++) { const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw error; users.push(...data.users); if (data.users.length < 1000) break }
  const owner = users.find(u => (u.email || '').toLowerCase() === OWNER_EMAIL)
  if (!owner) { if (EN) return null; stop('compte propriétaire introuvable') }
  const ents = must(await admin.from('entities').select('*').eq('owner_user_id', owner.id), 'entreprise')
  if (ents.length !== 1 || ents[0].name !== 'Marché Soleil') stop('entreprise inattendue : ' + JSON.stringify(ents.map(e => e.name)))
  if (owner.email.toLowerCase() !== 'stocshopci+demo@gmail.com') stop('propriétaire inattendu')
  const shops = must(await admin.from('shops').select('*').eq('entity_id', ents[0].id).is('deleted_at', null).order('created_at'), 'boutiques')
  const profile = must(await admin.from('profiles').select('*').eq('id', owner.id).single(), 'profil')
  return { owner, entity: ents[0], shops, profile, users }
}
const shopIds = acc => acc.shops.map(s => s.id)
async function otherTotals(acc) {
  const ids = shopIds(acc), out = {}
  for (const t of ['sales', 'products', 'customers', 'expenses', 'suppliers']) {
    const { count } = await admin.from(t).select('*', { count: 'exact', head: true }).not('shop_id', 'in', `(${ids.join(',')})`); out[t] = count
  }
  for (const t of ['shops', 'entities', 'profiles']) { const { count } = await admin.from(t).select('*', { count: 'exact', head: true }); out[t + ' (tous)'] = count }
  return out
}
const shopByKey = (acc, key) => { const def = D.SHOPS.find(s => s.key === key); return acc.shops.find(s => s.name.trim() === def.name) || (key === 'akwa' ? acc.shops[0] : null) }

// ───────────────────────── Simulation ─────────────────────────
async function simulate(acc) {
  const sales = buildPlan(), stock = initialStock(sales)
  console.log('COMPTE ACTUEL :', JSON.stringify({ proprietaire: acc.profile.full_name, pays_profil: acc.profile.country, entreprise: acc.entity.name, formule: acc.entity.plan, pays: acc.entity.country, facturation: acc.entity.billing_country, interne: acc.entity.is_internal }))
  for (const s of acc.shops) console.log('  boutique :', JSON.stringify({ nom: s.name, ville: s.city, pays: s.country, devise: s.currency, interne: s.is_internal }))
  console.log('\nCE QUI SERAIT CRÉÉ')
  console.log('  boutiques :', D.SHOPS.map(s => s.name + ' (' + s.city + ')').join(' · '))
  console.log('  équipe    :', D.OWNER_NAME + ' (propriétaire) · ' + D.MEMBERS.map(m => `${m.full_name} (${m.role}, ${m.shop})`).join(' · '))
  for (const shop of D.SHOPS) {
    const st = stock[shop.key], keys = Object.keys(st)
    const low = keys.filter(k => st[k].remainder > 0 && st[k].remainder <= 10), out = keys.filter(k => st[k].remainder === 0)
    console.log(`  ${shop.name} : ${keys.length} produits · ${D.CUSTOMERS[shop.key].length} clients · ${D.SUPPLIERS[shop.key].length} fournisseurs · stock de départ ${fmt(keys.reduce((n, k) => n + st[k].initial, 0))} unités · stock bas : ${low.join(', ') || '—'} · rupture : ${out.join(', ') || '—'}`)
  }
  console.log('\nVENTES (' + sales.length + ' au total, du ' + sales.map(s => s.at.slice(0, 10)).sort()[0] + ' au ' + D.D0 + ')')
  for (const l of summary(sales)) console.log('  ' + l)
  const top = {}; for (const s of sales) for (const i of s.items) top[i.name] = (top[i.name] || 0) + i.qty
  console.log('  produits les plus vendus :', Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, q]) => `${n} (${q})`).join(' · '))
  console.log('\nAUTRES OPÉRATIONS :', `${D.EXPENSES.length} dépenses (${fmt(D.EXPENSES.reduce((n, e) => n + e[3], 0))} F CFA) · ${Object.keys(D.BUDGETS.akwa).length} budgets · ${D.PURCHASES.length} commandes fournisseur · ${D.RESTOCKS.length} réassorts datés · ${D.TRANSFERS.length} transferts · 1 inventaire (${D.INVENTORY.length} écarts) · ${D.OPENINGS.length} reprises de dette · 2 remboursements clients`)
  // Sondes de schéma (noms de colonnes seulement)
  for (const t of ['categories', 'purchase_order_items', 'stock_transfer_items']) {
    const { data, error } = await admin.from(t).select('*').limit(1)
    console.log(`  colonnes ${t} :`, error ? 'ERREUR ' + error.message : data[0] ? Object.keys(data[0]).join(', ') : '(table vide)')
  }
  console.log('\nTOTAUX DES AUTRES COMPTES (doivent rester identiques) :', JSON.stringify(await otherTotals(acc)))
  console.log('\nSIMULATION — rien écrit.')
}

// ───────────────────────── Étapes ─────────────────────────
const stages = {
  async compte(acc, ctx) {
    const akwa = acc.shops[0]
    await api(ctx.owner, 'PATCH', '/api/shops/settings', { shop_id: akwa.id, name: D.SHOPS[0].name, city: D.SHOPS[0].city, country: 'CM' })
    must(await admin.from('entities').update({ country: 'CM', billing_country: 'CM' }).eq('id', acc.entity.id), 'pays entreprise')
    must(await admin.from('shops').update({ billing_country: 'CM' }).eq('entity_id', acc.entity.id), 'pays de facturation')
    must(await admin.from('profiles').update({ full_name: D.OWNER_NAME, country: 'CM', locale: 'fr' }).eq('id', acc.owner.id), 'profil')
    await api(ctx.admin, 'POST', '/api/admin/shop-action', { action: 'set_internal', shop_id: akwa.id, internal: true })
    await api(ctx.admin, 'POST', '/api/admin/shop-action', { action: 'grant_plan', shop_id: akwa.id, days: 'business' })
    await api(ctx.admin, 'POST', '/api/admin/shop-action', { action: 'extend', shop_id: akwa.id, days: 365 })
  },
  async notifications(acc) {
    must(await admin.from('shops').update({ notify_whatsapp_low_stock: false, notify_whatsapp_daily: false, notify_whatsapp_each_sale: false, notify_email_low_stock: false, notify_email_daily: false, notify_push_low_stock: false, notify_push_new_sale: false, notify_push_new_expense: false, notify_email_expiry: false, notify_push_expiry: false, hours_enabled: false, is_internal: true, timezone: 'Africa/Douala' }).eq('entity_id', acc.entity.id), 'notifications coupées')
  },
  async boutiques(acc, ctx) {
    for (const def of D.SHOPS.slice(1)) {
      if (acc.shops.some(s => s.name.trim() === def.name)) continue
      await api(ctx.owner, 'POST', '/api/shops', { name: def.name, city: def.city, country: 'CM' })
    }
    await api(ctx.admin, 'POST', '/api/admin/shop-action', { action: 'set_internal', shop_id: acc.shops[0].id, internal: true })
  },
  async notifications2(acc) { return stages.notifications(acc) },
  async equipe(acc, ctx) {
    state.members = state.members || {}
    for (const m of D.MEMBERS) {
      if (state.members[m.key]) continue
      const shop = shopByKey(acc, m.shop)
      const email = MEMBER_EMAIL(m.alias)
      if (EN) {
        // Copie anglaise : membre fictif créé directement, déjà confirmé — aucun e-mail d'invitation.
        // Mêmes écritures que la route d'invitation (profil + affectation à la boutique).
        const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: m.full_name } })
        if (error) throw new Error('création ' + m.full_name + ' : ' + error.message)
        must(await admin.from('profiles').upsert({ id: created.user.id, full_name: m.full_name, role: m.role, shop_id: shop.id, is_active: true }), 'profil ' + m.full_name)
        must(await admin.from('shop_members').upsert({ shop_id: shop.id, user_id: created.user.id, role: m.role, is_active: true, can_delete_sales: false, invited_by: acc.owner.id }, { onConflict: 'shop_id,user_id' }), 'affectation ' + m.full_name)
        state.members[m.key] = created.user.id; save()
        continue
      }
      await api(ctx.owner, 'POST', '/api/team/invite', { email, full_name: m.full_name, role: m.role, shop_id: shop.id })
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const u = data.users.find(x => (x.email || '').toLowerCase() === email)
      if (!u) throw new Error('membre introuvable après invitation : ' + m.full_name)
      // Compte fictif : e-mail marqué confirmé pour ne pas rester « invitation en attente »
      const { error } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true })
      if (error) throw new Error('confirmation ' + m.full_name + ' : ' + error.message)
      state.members[m.key] = u.id; save()
    }
  },
  async catalogue(acc, ctx) {
    const plan = buildPlan(), stock = initialStock(plan)
    for (const k of ['categories', 'suppliers', 'customers', 'products']) state[k] = state[k] || {}
    state.images = state.images || {}
    const akwa = shopByKey(acc, 'akwa')
    const SOURCE_PHOTOS = {}
    for (const r of must(await admin.from('products').select('name, image_url').eq('shop_id', SOURCE_AKWA).not('image_url', 'is', null), 'photos source')) SOURCE_PHOTOS[r.name] = r.image_url
    for (const p of D.PRODUCTS) {
      if (state.images[p.key]) continue
      const form = new FormData()
      const src = SOURCE_PHOTOS[p.name]
      if (!src) throw new Error('photo source introuvable : ' + p.name)
      const img = await fetch(src); if (!img.ok) throw new Error('téléchargement photo ' + p.name + ' : ' + img.status)
      form.append('file', new Blob([Buffer.from(await img.arrayBuffer())], { type: 'image/jpeg' }), p.key + '.jpg')
      form.append('shop_id', akwa.id)
      state.images[p.key] = (await api(ctx.owner, 'POST', '/api/products/upload-image', null, form)).url; save()
    }
    for (const def of D.SHOPS) {
      const shop = shopByKey(acc, def.key), k = def.key
      for (const g of ['categories', 'suppliers', 'customers', 'products']) state[g][k] = state[g][k] || {}
      for (const [ck, name, color] of D.CATEGORIES) {
        if (state.categories[k][ck]) continue
        state.categories[k][ck] = (await api(ctx.owner, 'POST', '/api/categories', { shop_id: shop.id, name, color })).data.id; save()
      }
      for (const s of D.SUPPLIERS[k]) {
        if (state.suppliers[k][s.key]) continue
        state.suppliers[k][s.key] = (await api(ctx.owner, 'POST', '/api/suppliers', { shop_id: shop.id, name: s.name, phone: s.phone, city: s.city })).data.id; save()
      }
      for (const c of D.CUSTOMERS[k]) {
        if (state.customers[k][c.key]) continue
        state.customers[k][c.key] = (await api(ctx.owner, 'POST', '/api/customers', { shop_id: shop.id, name: c.name, phone: c.phone, city: c.city, ...(c.credit ? { credit_limit: 150000 } : {}) })).customer.id; save()
      }
      for (const p of D.PRODUCTS) {
        if (D.NOT_IN[k].includes(p.key) || state.products[k][p.key]) continue
        const supplier = state.suppliers[k][D.SUPPLIER_OF[p.cat]] || Object.values(state.suppliers[k])[0]
        const row = await api(ctx.owner, 'POST', '/api/products', {
          shop_id: shop.id, name: p.name, category_id: state.categories[k][p.cat], supplier_id: supplier, buying_price: p.buy, selling_price: p.sell,
          quantity: stock[k][p.key].initial, unit: p.unit, low_stock_threshold: null, sku: p.coded ? D.ean13(p.idx) : null, image_url: state.images[p.key],
          is_active: true, is_favorite: k === 'akwa' && D.FAVORITES.includes(p.key), created_at: '2026-09-10T07:00:00.000Z',
        })
        state.products[k][p.key] = row.data.id; save()
      }
    }
    // Le mouvement « Stock initial » est daté de l'instant : on le remet à la date de création des produits
    must(await admin.from('stock_movements').update({ created_at: '2026-09-10T07:00:00.000Z' }).in('shop_id', shopIds(acc)).eq('reason', 'Stock initial'), 'date du stock initial')
  },
  async ventes(acc) {
    const plan = buildPlan()
    state.creditSales = state.creditSales || {}
    state.salesDone = state.salesDone || {}
    await Promise.all(D.SHOPS.map(async def => {
      const shop = shopByKey(acc, def.key), k = def.key
      const list = plan.filter(s => s.shop === k)
      for (let i = state.salesDone[k] || 0; i < list.length; i++) {
        const s = list[i]
        const cashier = s.cashier === 'owner' ? acc.owner.id : state.members[s.cashier]
        const { data, error } = await admin.rpc('complete_sale', {
          p_shop_id: shop.id, p_cashier_id: cashier, p_customer_id: s.customer ? state.customers[k][s.customer] : null, p_customer_name: null, p_customer_phone: null,
          p_subtotal: s.subtotal, p_discount: s.discount, p_tax: 0, p_total: s.total, p_payment_method: s.method, p_notes: null, p_paystack_reference: null,
          p_client_request_id: `${KEY}-${k}-${String(i).padStart(4, '0')}`,
          p_items: s.items.map(it => ({ product_id: state.products[k][it.key], product_name: it.name, quantity: it.qty, unit_price: it.price, buying_price: it.cost })),
          p_payments: s.payments.map(p => ({ amount: p.amount, method: p.method, reference: null })), p_due_date: s.due_date, p_created_at: s.at,
        })
        if (error) throw new Error(`vente ${k} #${i} : ${error.message}`)
        if (data.already_existed || data.sale.shop_id !== shop.id) throw new Error(`vente ${k} #${i} : non créée dans cette boutique (clé déjà utilisée ailleurs)`)
        if (s.method === 'credit') { state.creditSales[k] = state.creditSales[k] || {}; (state.creditSales[k][s.customer] = state.creditSales[k][s.customer] || []).push(data.sale.id) }
        state.salesDone[k] = i + 1
        if (i % 25 === 0) save()
      }
      save()
      console.log('  ventes enregistrées :', def.name, list.length)
    }))
    // Les mouvements de stock des ventes sont datés de l'instant : on leur redonne l'heure de leur vente
    for (const id of shopIds(acc)) {
      const sales = must(await admin.from('sales').select('sale_number, created_at').eq('shop_id', id).eq('sale_status', 'active').limit(5000), 'ventes')
      await pool(sales, 10, async s => { must(await admin.from('stock_movements').update({ created_at: s.created_at }).eq('shop_id', id).eq('reason', 'Sale ' + s.sale_number), 'date du mouvement') })
    }
  },
  async operations(acc, ctx) {
    const { dayOf, iso } = require('./plan.js')
    const sid = k => shopByKey(acc, k).id
    state.ops = state.ops || {}
    // Dépenses et budgets
    for (let i = 0; i < D.EXPENSES.length; i++) {
      const [k, category, description, amount, before, payment_method] = D.EXPENSES[i]
      await api(ctx.owner, 'POST', '/api/expenses', { shop_id: sid(k), amount, description, date: iso(dayOf(before)), category, payment_method, client_request_id: KEY + '-exp-' + i })
    }
    for (const [k, budgets] of Object.entries(D.BUDGETS)) for (const [category, amount] of Object.entries(budgets)) await api(ctx.owner, 'PUT', '/api/expenses/budgets', { shop_id: sid(k), category, amount })
    // Reprises de dette
    for (let i = 0; i < D.OPENINGS.length; i++) {
      const o = D.OPENINGS[i]
      const party_id = o.kind === 'customer' ? state.customers[o.shop][o.party] : state.suppliers[o.shop][o.party]
      const opened = await api(ctx.owner, 'POST', '/api/opening-balances', { shop_id: sid(o.shop), kind: o.kind, party_id, amount: o.amount, debt_date: o.debt_date, ...(o.due_date ? { due_date: o.due_date } : {}), note: o.note, client_request_id: KEY + '-open-' + i })
      if (!opened || !opened.id) throw new Error('reprise de dette non créée : ' + o.party)
    }
    // Commandes fournisseur (Akwa)
    for (let i = 0; i < D.PURCHASES.length; i++) {
      if (state.ops['po' + i]) continue
      const po = D.PURCHASES[i]
      const items = po.lines.map(([key, ordered]) => { const p = D.PRODUCTS.find(x => x.key === key); return { product_id: state.products.akwa[key], product_name: p.name, unit: p.unit, quantity_ordered: ordered, unit_price: p.buy } })
      const created = (await api(ctx.owner, 'POST', '/api/purchase-orders', { shop_id: sid('akwa'), supplier_id: state.suppliers.akwa[po.supplier], items })).data
      state.ops['po' + i] = created.id; save()
      if (po.state === 'draft') continue
      await api(ctx.owner, 'PATCH', '/api/purchase-orders', { id: created.id, shop_id: sid('akwa'), status: 'sent' })
      if (po.state === 'sent') continue
      const rows = must(await admin.from('purchase_order_items').select('id, product_id').eq('purchase_order_id', created.id), 'lignes de commande')
      let total = 0
      const received = po.lines.map(([key, , qty, days]) => {
        const p = D.PRODUCTS.find(x => x.key === key), row = rows.find(r => r.product_id === state.products.akwa[key])
        total += qty * p.buy
        return { item_id: row.id, product_id: row.product_id, quantity_received: qty, unit_price: p.buy, expiry_date: iso(dayOf(-days)) }
      })
      await api(ctx.owner, 'POST', '/api/purchase-orders/receive', { shop_id: sid('akwa'), purchase_order_id: created.id, items: received, ...(po.pay ? { payment_amount: Math.round(total * po.pay / 1000) * 1000, payment_method: 'cash' } : {}) })
    }
    // Réassorts avec date de péremption (Akwa)
    for (let i = 0; i < D.RESTOCKS.length; i++) {
      if (state.ops['restock' + i]) continue
      const [key, qty, days] = D.RESTOCKS[i], p = D.PRODUCTS.find(x => x.key === key)
      await api(ctx.owner, 'PUT', '/api/products', { product_id: state.products.akwa[key], shop_id: sid('akwa'), quantity_to_add: qty, buying_price: p.buy, supplier_id: state.suppliers.akwa[D.SUPPLIER_OF[p.cat]], expiry_date: iso(dayOf(-days)), performed_by: acc.owner.id })
      state.ops['restock' + i] = true; save()
    }
    // Transferts depuis Akwa
    for (let i = 0; i < D.TRANSFERS.length; i++) {
      const t = D.TRANSFERS[i]
      if (!state.ops['transfer' + i]) {
        const created = (await api(ctx.owner, 'POST', '/api/stock-transfers', { source_shop_id: sid('akwa'), destination_shop_id: sid(t.to), items: t.lines.map(([key, quantity]) => ({ product_id: state.products.akwa[key], quantity })) })).data
        state.ops['transfer' + i] = created.id; save()
      }
      if (!t.receive || state.ops['transferRecv' + i]) continue
      const created = { id: state.ops['transfer' + i] }
      const rows = must(await admin.from('stock_transfer_items').select('*').eq('stock_transfer_id', created.id), 'lignes de transfert')
      // Réception depuis la boutique d'arrivée (règle de l'application)
      await api(ctx.owner, 'POST', '/api/stock-transfers/receive', { transfer_id: created.id, acting_shop_id: sid(t.to), receipt_key: require('crypto').randomUUID(), destination_shop_id: sid(t.to), items: rows.map(r => { const key = t.lines.find(([k]) => state.products.akwa[k] === r.source_product_id)[0]; return { transfer_item_id: r.id, destination_product_id: state.products[t.to][key], quantity_received: r.quantity_sent } }) })
      state.ops['transferRecv' + i] = true; save()
    }
    // Inventaire à Bastos
    if (!state.ops.inventory) {
      // Inventaire complet par sessions (chemin actuel de l'application) : tout compté au stock réel, sauf les écarts prévus
      const bastos = sid('bastos')
      const started = await api(ctx.owner, 'POST', '/api/stock/inventory-sessions', { shop_id: bastos })
      const sessionId = started?.data?.session_id || started?.data?.id || started?.data?.session?.id
      if (!sessionId) throw new Error("session d'inventaire : réponse inattendue " + JSON.stringify(started).slice(0, 200))
      const current = must(await admin.from('products').select('id, quantity').eq('shop_id', bastos).eq('is_active', true), 'stock Bastos')
      for (const pr of current) {
        const delta = (D.INVENTORY.find(([key]) => state.products.bastos[key] === pr.id) || [])[1] || 0
        await api(ctx.owner, 'POST', `/api/stock/inventory-sessions/${sessionId}/count`, { shop_id: bastos, product_id: pr.id, counted_qty: Math.max(0, pr.quantity + delta), expected_count_id: null })
      }
      // Motif de chaque écart (exigé par le serveur avant la validation)
      for (const [key, delta, reason] of D.INVENTORY) {
        const line = must(await admin.from('inventory_counts').select('id').eq('session_id', sessionId).eq('product_id', state.products.bastos[key]).maybeSingle(), 'ligne de comptage')
        if (!line) throw new Error('ligne de comptage absente : ' + key)
        await api(ctx.owner, 'POST', `/api/stock/inventory-sessions/${sessionId}/details`, { shop_id: bastos, count_id: line.id, reason: reason || 'correction', surplus_expiry_date: null })
      }
      const fin = await api(ctx.owner, 'POST', `/api/stock/inventory-sessions/${sessionId}/finalize`, { shop_id: bastos })
      if (!fin || JSON.stringify(fin).indexOf('completed') < 0) throw new Error('inventaire non appliqué : ' + JSON.stringify(fin).slice(0, 200))
      state.ops.inventory = true; save()
    }
    // Remboursements clients du jour (Akwa)
    const repay = [['baobab', 20000, 'orange_money'], ['emmanuel', 5000, 'cash']]
    for (const [key, amount, method] of repay) {
      const ids = (state.creditSales.akwa || {})[key] || []
      if (!ids.length || state.ops['repay-' + key]) continue
      const open = must(await admin.from('sales').select('id, total, amount_paid').in('id', ids), 'crédits').filter(s => Number(s.total) - Number(s.amount_paid) > 0)
      const owed = open.reduce((n, s) => n + Number(s.total) - Number(s.amount_paid), 0)
      if (!owed) continue
      const paid = await api(ctx.owner, 'POST', '/api/payments', { unpaid_sale_ids: open.map(s => s.id), amount: Math.min(amount, owed), method, shop_id: sid('akwa'), client_request_id: KEY + '-repay-' + key })
      if (!paid || !(paid.applied || []).length) throw new Error('remboursement non appliqué : ' + key)
      state.ops['repay-' + key] = true; save()
    }
  },
}

// Copie anglaise : création du compte propriétaire sans e-mail. Mêmes écritures que la route d'inscription
// (boutique → entreprise créée par la base, profil, affectation propriétaire, essai de 30 jours), sauf l'envoi du message.
async function createEnglishAccount() {
  const crypto = require('crypto')
  const { data: created, error } = await admin.auth.admin.createUser({ email: OWNER_EMAIL, password: crypto.randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: D.OWNER_NAME } })
  if (error) throw new Error('création du compte : ' + error.message)
  const uid = created.user.id
  const shop = must(await admin.from('shops').insert({ name: 'Marché Soleil', owner_id: uid, city: 'Douala', state: 'Douala', currency: 'XAF', country: 'CM', billing_country: 'CM', timezone: 'Africa/Douala' }).select('id, entity_id').single(), 'boutique')
  must(await admin.from('profiles').upsert({ id: uid, shop_id: shop.id, full_name: D.OWNER_NAME, role: 'owner', is_active: true, country: 'CM', locale: 'fr' }), 'profil')
  must(await admin.from('shop_members').insert({ shop_id: shop.id, user_id: uid, role: 'owner', is_active: true }), 'affectation propriétaire')
  const fresh = must(await admin.from('shops').select('entity_id').eq('id', shop.id).single(), 'entreprise')
  if (!fresh.entity_id) throw new Error('la base n\'a pas créé l\'entreprise de la boutique')
  must(await admin.from('entities').update({ plan: 'trial', trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), plan_expires_at: null }).eq('id', fresh.entity_id), 'essai')
  console.log('compte de démonstration créé (aucun e-mail envoyé)')
}

;(async () => {
  let acc = await resolveAccount()
  if (!acc && !EXECUTE) { console.log('COMPTE DE DÉMONSTRATION : le compte', OWNER_EMAIL, 'n\'existe pas encore — il serait créé directement, sans e-mail.'); const s = buildPlan(); for (const l of summary(s)) console.log('  ' + l); console.log('  exemple de libellés :', D.PRODUCTS.slice(0, 5).map(p => p.name).join(' · '), '|', D.CATEGORIES.map(c => c[1]).join(' · ')); console.log('SIMULATION — rien écrit.'); return }
  if (!acc) { await createEnglishAccount(); acc = await resolveAccount() }
  if (!EXECUTE) return simulate(acc)
  const before = await otherTotals(acc)
  const ctx = { owner: await sessionCookie(OWNER_EMAIL), admin: await sessionCookie(ADMIN_EMAIL) }
  for (const name of Object.keys(stages)) {
    if (STAGE && STAGE !== name) continue
    if (state.done[name]) { console.log('étape', name, ': déjà faite'); continue }
    console.log('étape', name, '…')
    await stages[name](acc, ctx)
    state.done[name] = new Date().toISOString(); save()
    acc = await resolveAccount()
    console.log('étape', name, ': terminée')
  }
  const after = await otherTotals(acc)
  console.log('Autres comptes avant :', JSON.stringify(before))
  console.log('Autres comptes après :', JSON.stringify(after))
  console.log('Écarts               :', JSON.stringify(Object.fromEntries(Object.keys(before).map(k => [k, after[k] - before[k]]))))
})().catch(e => { save(); console.error('ERREUR', e.message); process.exit(1) })
