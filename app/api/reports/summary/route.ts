import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, parseShopIds } from '@/lib/api/shop-access'
import { reportSections, type ReportSections } from '@/lib/api/report-sections'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// GET /api/reports/summary?shop_ids=a,b&start=ISO&end=ISO  (pure lecture)
// Données de la page Rapports, calculées par le SERVEUR (avant : lues directement par le navigateur, la base ne
// contrôlant que l'appartenance à la boutique). Pour chaque boutique demandée :
//   • membre active obligatoire (sinon 403) ; droit « Rapports » obligatoire (boutiques sans ce droit ignorées ;
//     aucune → 403) ;
//   • chaque section n'est calculée que sur les boutiques où son widget est autorisé ;
//   • un caissier sans « chiffre d'affaires de la boutique » ne reçoit que SES ventes et SA ligne vendeur ;
//   • aucun coût, prix d'achat ni marge ici : réservés à /api/reports/margin (Rapports + canViewCost).
// Les montants restent ceux de chaque boutique ; leur consolidation entre devises relève de la décision D1.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const shopIds = parseShopIds(sp.get('shop_ids'))
    const start = sp.get('start') || ''
    const end = sp.get('end') || ''
    if (!shopIds || !start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }

    const access = await loadShopAccess(supabase, user.id, shopIds)
    if (access.length !== shopIds.length) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })
    const sections: Record<string, ReportSections> = {}
    for (const a of access) { const s = reportSections(a); if (s) sections[a.shopId] = s }
    const reportShops = Object.keys(sections)
    if (!reportShops.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const where = (k: keyof ReportSections) => reportShops.filter(id => sections[id][k])

    const admin = await createAdminClient() as any
    const startDay = start.slice(0, 10), endDay = end.slice(0, 10)

    // Ventes actives de la période (boutiques des Rapports), filtrées par vendeur là où la personne est limitée à ses ventes
    const salesAll = await fetchAllRows<any>(() => admin
      .from('sales').select('id, total, amount_paid, payment_method, created_at, cashier_id, shop_id')
      .in('shop_id', reportShops).eq('sale_status', 'active')
      .gte('created_at', start).lte('created_at', end)
      .order('created_at', { ascending: true }).order('id', { ascending: true }))
    const sales = salesAll.filter((s: any) => !sections[s.shop_id]?.ownSalesOnly || s.cashier_id === user.id)
    const inSection = (k: keyof ReportSections) => { const ok = new Set(where(k)); return sales.filter((s: any) => ok.has(s.shop_id)) }

    // Encaissé (somme des ventes de la période) et nombre de transactions, par boutique
    const byShop: Record<string, { revenue: number; sales: number }> = {}
    for (const s of inSection('encaisse')) { (byShop[s.shop_id] ||= { revenue: 0, sales: 0 }).revenue += Number(s.total) }
    for (const s of inSection('transactions')) { (byShop[s.shop_id] ||= { revenue: 0, sales: 0 }).sales += 1 }
    const totals = {
      revenue: Object.values(byShop).reduce((n, x) => n + x.revenue, 0),
      sales: Object.values(byShop).reduce((n, x) => n + x.sales, 0),
    }

    // Répartition par mode de paiement (identifiants ; libellés traduits par l'interface)
    const byMethod: Record<string, number> = {}
    for (const s of inSection('paymentChart')) byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + Number(s.total)

    // Articles vendus : top produits (widget) et quantités vendues de l'inventaire
    const itemSales = sales.filter((s: any) => sections[s.shop_id]?.topProducts || sections[s.shop_id]?.inventory)
    const items: any[] = []
    for (let i = 0; i < itemSales.length; i += 200) {
      const chunk = itemSales.slice(i, i + 200).map((s: any) => s.id)
      const { data, error } = await admin.from('sale_items').select('product_name, quantity, subtotal, product_id, sale_id').in('sale_id', chunk)
      if (error) throw error
      items.push(...(data || []))
    }
    const shopOfSale = new Map(sales.map((s: any) => [s.id, s.shop_id]))
    const prodTotals: Record<string, { name: string; qty: number; revenue: number; shopId: string }> = {}
    for (const it of items) {
      const shopId = shopOfSale.get(it.sale_id) as string
      const key = it.product_id ?? `${shopId}:${it.product_name}`
      const row = (prodTotals[key] ||= { name: it.product_name, qty: 0, revenue: 0, shopId })
      row.qty += Number(it.quantity); row.revenue += Number(it.subtotal)
    }
    const topShops = new Set(where('topProducts'))
    const topProducts = Object.values(prodTotals).filter(p => topShops.has(p.shopId))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 10)
      .map(({ name, qty, revenue }) => ({ name, qty, revenue }))

    // Inventaire (prix de vente seulement — aucun coût) et valeur de vente du stock
    const invShops = where('inventory')
    const products = invShops.length ? await fetchAllRows<any>(() => admin
      .from('products').select('id, name, quantity, selling_price, shop_id')
      .in('shop_id', invShops).eq('is_active', true).order('name').order('id')) : []
    const allInventory = products.map((p: any) => ({
      id: p.id, name: p.name, shop_id: p.shop_id,
      quantity: Number(p.quantity), selling_price: Number(p.selling_price),
      soldQty: prodTotals[p.id]?.qty || 0, soldRevenue: prodTotals[p.id]?.revenue || 0,
    })).sort((a: any, b: any) => (b.soldRevenue - a.soldRevenue) || a.name.localeCompare(b.name))
    const sellingValue = products.reduce((n: number, p: any) => n + Number(p.quantity) * Number(p.selling_price), 0)

    // Dépenses réelles de la période (les modèles récurrents ne sont pas des dépenses)
    const expShops = where('depenses')
    const expenses = expShops.length ? await fetchAllRows<any>(() => admin
      .from('expenses').select('id, amount, description, date, shop_id')
      .in('shop_id', expShops).eq('is_recurring', false)
      .gte('date', startDay).lte('date', endDay)
      .order('date', { ascending: false }).order('id')) : []
    const totalExpenses = expenses.reduce((n: number, e: any) => n + Number(e.amount), 0)

    // Crédits encore dus
    const creditShops = where('credits')
    const debtors = creditShops.length ? await fetchAllRows<any>(() => admin
      .from('customers').select('id, total_debt, shop_id').in('shop_id', creditShops).gt('total_debt', 0).order('id')) : []
    const outstandingDebt = debtors.reduce((n: number, c: any) => n + Number(c.total_debt), 0)

    // Performance des vendeurs : ventes de la période (vendeur de la vente) et argent réellement encaissé (paiements)
    const perfShops = where('cashierPerf')
    let cashierPerf: any[] = []
    if (perfShops.length) {
      const perfSet = new Set(perfShops)
      const payments = await fetchAllRows<any>(() => admin
        .from('payments').select('amount, received_by, sales!inner(shop_id, sale_status)')
        .in('sales.shop_id', perfShops).neq('sales.sale_status', 'cancelled')
        .eq('is_cancelled', false).eq('is_write_off', false).not('received_by', 'is', null)
        .gte('paid_at', start).lte('paid_at', end)
        .order('paid_at').order('id'))
      const { data: members } = await admin.from('shop_members').select('user_id, shop_id').in('shop_id', perfShops).eq('is_active', true)
      // Une ligne par vendeur ET par boutique : jamais de mélange de boutiques (ni de devises) sur une même ligne
      const rows = new Map<string, { id: string; shopId: string; sales: number; revenue: number }>()
      const row = (uid: string, shopId: string) => { const k = `${uid}:${shopId}`; if (!rows.has(k)) rows.set(k, { id: uid, shopId, sales: 0, revenue: 0 }); return rows.get(k)! }
      for (const m of (members || [])) row(m.user_id, m.shop_id)
      for (const s of sales) if (s.cashier_id && perfSet.has(s.shop_id)) row(s.cashier_id, s.shop_id).sales += 1
      for (const p of payments) row(p.received_by, p.sales.shop_id).revenue += Number(p.amount)
      // Vendeur limité à ses ventes : uniquement SA ligne
      const visible = Array.from(rows.values()).filter(r => !sections[r.shopId]?.ownSalesOnly || r.id === user.id)
      const ids = Array.from(new Set(visible.map(r => r.id)))
      const { data: profiles } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
      const nameOf = new Map((profiles || []).map((p: any) => [p.id, p.full_name]))
      cashierPerf = visible.map(r => ({ ...r, name: nameOf.get(r.id) || '—' })).sort((a, b) => b.revenue - a.revenue)
    }

    return NextResponse.json({
      shops: reportShops,
      sections,
      totals,
      by_shop: byShop,
      revenue_by_method: byMethod,
      top_products: topProducts,
      stock_valuation: { sellingValue },
      outstanding_debt: outstandingDebt,
      all_inventory: allInventory,
      expenses: expenses.map((e: any) => ({ id: e.id, amount: Number(e.amount), description: e.description, date: e.date, shop_id: e.shop_id })),
      total_expenses: totalExpenses,
      cashier_perf: cashierPerf,
      // Identifiants des ventes de la période : la marge (coût des ventes) est demandée à /api/reports/margin
      sale_ids: sales.map((s: any) => s.id),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
