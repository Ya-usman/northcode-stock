import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, ownSalesScope, parseShopIds, type ShopAccess } from '@/lib/api/shop-access'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { lowStockThresholdOf } from '@/lib/stock/signals'

const DAY = 86_400_000

// GET /api/shops/stats?shop_ids=a,b&day_start=<début du jour, heure de l'appareil>
// Repères de la liste Boutiques et de la fiche boutique (lib/shops/shop-insights), lus jusqu'ici DIRECTEMENT par le
// navigateur sans aucun droit vérifié (lot 2B, 26 oct. 2026 — décision 1). Le SERVEUR décide, boutique par boutique :
//   • ventes (encaissé du jour, ventes du jour, 30 derniers jours) : avec « Historique des ventes » OU « Contrôle de
//     caisse » ; caissier et magasinier limités à leurs ventes (ownSalesScope : mêmes chiffres qu'avant) ;
//   • stock (produits actifs, ruptures, stock bas) : avec « Stock » ;
//   • valeur du stock au coût d'achat : avec le droit aux coûts (canViewCost) ET « Stock ».
// Bloc non autorisé = null (l'écran affiche « — »). Boutique sans adhésion active : absente de la réponse.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const shopIds = parseShopIds(sp.get('shop_ids'))
    const dayStart = sp.get('day_start') || ''
    if (!shopIds || !dayStart || Number.isNaN(Date.parse(dayStart))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const since30 = new Date(Date.now() - 30 * DAY).toISOString()

    const access = await loadShopAccess(supabase, user.id, shopIds)
    const salesShops = access.filter(a => a.view('sales_history') || a.view('caisse'))
    const stockShops = access.filter(a => a.view('stock'))
    const costShops = new Set(stockShops.filter(a => a.cost).map(a => a.shopId))
    const admin = await createAdminClient() as any

    // Une lecture « toute la boutique », une autre filtrée sur la personne là où elle ne voit que ses ventes
    const split = (shops: ShopAccess[]) => ({
      all: shops.filter(a => !ownSalesScope(a, user.id)).map(a => a.shopId),
      own: shops.filter(a => ownSalesScope(a, user.id)).map(a => a.shopId),
    })
    const { all, own } = split(salesShops)
    const readSales = (ids: string[], seller: string | null) => ids.length ? fetchAllRows<any>(() => {
      let q = admin.from('sales').select('id, shop_id, total, created_at').in('shop_id', ids).eq('sale_status', 'active').gte('created_at', since30)
      if (seller) q = q.eq('cashier_id', seller)
      return q.order('created_at').order('id')
    }) : Promise.resolve([])
    const readPayments = (ids: string[], seller: string | null) => ids.length ? fetchAllRows<any>(() => {
      let q = admin.from('payments').select('id, amount, sales!inner(shop_id, sale_status, cashier_id)')
        .in('sales.shop_id', ids).eq('is_cancelled', false).eq('is_write_off', false).gte('paid_at', dayStart)
      if (seller) q = q.eq('sales.cashier_id', seller)
      return q.order('paid_at').order('id')
    }) : Promise.resolve([])

    const stockIds = stockShops.map(a => a.shopId)
    const [salesAll, salesOwn, payAll, payOwn, products, shops] = await Promise.all([
      readSales(all, null), readSales(own, user.id), readPayments(all, null), readPayments(own, user.id),
      stockIds.length ? fetchAllRows<any>(() => admin.from('products')
        .select('id, shop_id, quantity, low_stock_threshold, buying_price')
        .in('shop_id', stockIds).eq('is_active', true).order('id')) : Promise.resolve([]),
      stockIds.length ? admin.from('shops').select('id, low_stock_threshold').in('id', stockIds).then((r: any) => r.data || []) : Promise.resolve([]),
    ])

    const out: Record<string, any> = {}
    for (const a of access) {
      out[a.shopId] = {
        cashToday: null, salesTodayCount: null, salesToday: null, sales30: null,
        products: null, out: null, low: null, stockValue: null,
      }
    }
    const start = Date.parse(dayStart)
    for (const a of salesShops) Object.assign(out[a.shopId], { cashToday: 0, salesTodayCount: 0, salesToday: 0, sales30: 0 })
    for (const s of [...salesAll, ...salesOwn]) {
      const st = out[s.shop_id]; if (!st) continue
      const total = Number(s.total) || 0
      st.sales30 += total
      if (Date.parse(s.created_at) >= start) { st.salesToday += total; st.salesTodayCount++ }
    }
    for (const p of [...payAll, ...payOwn]) {
      const st = out[p.sales?.shop_id]; if (!st || p.sales?.sale_status === 'cancelled') continue
      st.cashToday += Number(p.amount) || 0
    }
    const threshold: Record<string, number | null> = Object.fromEntries((shops as any[]).map(s => [s.id, s.low_stock_threshold]))
    for (const id of stockIds) Object.assign(out[id], { products: 0, out: 0, low: 0, stockValue: costShops.has(id) ? 0 : null })
    for (const p of products as any[]) {
      const st = out[p.shop_id]; if (!st) continue
      const qty = Number(p.quantity) || 0
      st.products++
      if (qty <= 0) st.out++
      else if (qty <= lowStockThresholdOf(p, threshold[p.shop_id] as any)) st.low++
      if (st.stockValue !== null) st.stockValue += Math.max(qty, 0) * (Number(p.buying_price) || 0)
    }
    return NextResponse.json({ stats: out })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
