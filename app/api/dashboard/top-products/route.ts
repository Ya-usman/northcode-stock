import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { getApiTranslator } from '@/lib/api/i18n'
import { computeTopProducts } from '@/lib/dashboard/top-products'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/top-products?period=month|year&shop_ids=x,y&cashier_id=
// Top 5 best-selling products by revenue for the "Mois"/"Année" views of the
// dashboard top-products chart. "Semaine" (last 7 days) is already computed
// client-side from the main dashboard fetch — this only covers the two wider
// periods that aren't already loaded. "Année" uses a rolling 12-month window,
// same definition as /api/dashboard/revenue-yearly, so switching between the
// revenue and top-products charts' "Année" tab stays consistent.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period')
    const shopIdsParam = searchParams.get('shop_ids')
    const cashierId = searchParams.get('cashier_id')

    if (!shopIdsParam || (period !== 'month' && period !== 'year')) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const shopIds = shopIdsParam.split(',').filter(Boolean)

    // Verify user has access to ALL requested shops
    const { data: memberRows } = await supabase
      .from('shop_members')
      .select('shop_id')
      .in('shop_id', shopIds)
      .eq('user_id', user.id)
      .eq('is_active', true)

    const accessibleShopIds = (memberRows || []).map((r: any) => r.shop_id)
    const unauthorizedShops = shopIds.filter(id => !accessibleShopIds.includes(id))
    if (unauthorizedShops.length > 0) {
      return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    const today = new Date()
    const start = period === 'month' ? startOfMonth(today) : startOfMonth(subMonths(today, 11))
    const end = endOfMonth(today)

    // Toutes les ventes de la période (page par page au-delà de 1000) — voir lib/dashboard/fetch-rows
    const sales = await fetchAllRows(() => {
      let q = admin
        .from('sales')
        .select('id, shop_id, sale_items(product_id, product_name, quantity, subtotal)')
        .in('shop_id', shopIds)
        .eq('sale_status', 'active')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
      if (cashierId) q = q.eq('cashier_id', cashierId)
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    })

    // Même règle que la vue « Semaine » : une ligne par produit, y compris
    // quand plusieurs boutiques vendent le même (lib/dashboard/top-products).
    const data = computeTopProducts(sales)

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
