import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, ownSalesScope, parseShopIds, type ShopAccess } from '@/lib/api/shop-access'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import type { PermFeature } from '@/lib/permissions'

// GET /api/dashboard/live?shop_ids=a,b&day_start&day_end&week_start
// Ventes du jour (cartes « encaissé » et « nombre de ventes », fil des ventes), ventes des 7 derniers jours avec leurs
// lignes (graphique de la semaine, meilleurs produits) et dette clients : lues jusqu'ici DIRECTEMENT par le navigateur
// (lot 2B, 26 oct. 2026 — préalable à la migration 185 qui réserve ces tables selon le droit du rôle).
// Le SERVEUR décide, boutique par boutique :
//   • chaque bloc seulement là où l'un de ses widgets est autorisé (sinon null : rien n'est envoyé) ;
//   • ventes : caissier et magasinier → seulement les leurs, autres rôles → toute la boutique (ownSalesScope : MÊMES
//     chiffres qu'avant, quand la base filtrait elle-même) ;
//   • dette : fiches clients non supprimées, comme la règle de lecture de la base.
const TODAY_WIDGETS: PermFeature[] = ['widget_today_revenue', 'widget_sales_count', 'widget_recent_sales']
const WEEK_WIDGETS: PermFeature[] = ['widget_dashboard_revenue_chart', 'widget_top_products_chart']
const TODAY_COLUMNS = 'id, sale_number, total, amount_paid, balance, payment_method, payment_status, sale_status, created_at, customers(name), cashier_id, shop_id'
const WEEK_COLUMNS = 'id, shop_id, total, amount_paid, created_at, sale_items(product_id, product_name, quantity, subtotal)'

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const shopIds = parseShopIds(sp.get('shop_ids'))
    const bounds = ['day_start', 'day_end', 'week_start'].map(k => sp.get(k) || '')
    if (!shopIds || bounds.some(b => !b || Number.isNaN(Date.parse(b)))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const [dayStart, dayEnd, weekStart] = bounds

    const access = await loadShopAccess(supabase, user.id, shopIds)
    if (access.length !== shopIds.length) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const allowed = (features: PermFeature[]) => access.filter(a => features.some(f => a.view(f)))

    // Ventes actives d'une période : une lecture pour les boutiques « toute la boutique », une autre (filtrée sur le
    // vendeur) pour celles où la personne ne voit que les siennes — jamais de lecture plus large que nécessaire.
    const salesOf = async (shops: ShopAccess[], columns: string, from: string, newestFirst: boolean) => {
      if (!shops.length) return null
      const all = shops.filter(a => !ownSalesScope(a, user.id)).map(a => a.shopId)
      const own = shops.filter(a => ownSalesScope(a, user.id)).map(a => a.shopId)
      const read = (ids: string[], seller: string | null) => fetchAllRows<any>(() => {
        let q = admin.from('sales').select(columns).in('shop_id', ids).eq('sale_status', 'active')
          .gte('created_at', from).lte('created_at', dayEnd)
        if (seller) q = q.eq('cashier_id', seller)
        return q.order('created_at', { ascending: !newestFirst }).order('id')
      })
      const parts = await Promise.all([all.length ? read(all, null) : [], own.length ? read(own, user.id) : []])
      return parts.flat().sort((a, b) => (newestFirst ? -1 : 1) * (Date.parse(a.created_at) - Date.parse(b.created_at)))
    }

    const debtShops = allowed(['widget_outstanding_debt']).map(a => a.shopId)
    const [todaySales, weekSales, debtRows] = await Promise.all([
      salesOf(allowed(TODAY_WIDGETS), TODAY_COLUMNS, dayStart, true),
      salesOf(allowed(WEEK_WIDGETS), WEEK_COLUMNS, weekStart, false),
      debtShops.length ? fetchAllRows<any>(() => admin
        .from('customers').select('total_debt').in('shop_id', debtShops).is('deleted_at', null)
        .order('id')) : Promise.resolve(null),
    ])

    return NextResponse.json({
      today_sales: todaySales,
      week_sales: weekSales,
      outstanding_debt: debtRows === null ? null : debtRows.reduce((n, c) => n + Number(c.total_debt || 0), 0),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
