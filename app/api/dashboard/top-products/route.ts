import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { getApiTranslator } from '@/lib/api/i18n'
import { dashboardGuard } from '@/lib/api/shop-access'
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
    const requestedSeller = searchParams.get('cashier_id')

    if (!shopIdsParam || (period !== 'month' && period !== 'year')) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    // Périmètre décidé par le SERVEUR (lib/api/shop-access) : membre active de chaque boutique, widget autorisé dans
    // la boutique, et vendeur limité à SES ventes selon son rôle et les réglages de CETTE boutique. Le filtre vendeur
    // envoyé par le navigateur ne peut que restreindre : l'omettre n'élargit jamais les résultats. Avant : simple
    // contrôle d'appartenance, puis lecture complète avec le filtre (facultatif) fourni par le navigateur.
    const g = await dashboardGuard(supabase, user.id, shopIdsParam, ['widget_top_products_chart'], requestedSeller)
    if ('error' in g) return NextResponse.json({ error: t(g.error.key as any) }, { status: g.error.status })
    const { shopIds, seller } = g
    const keep = (s: any) => !seller[s.shop_id] || s.cashier_id === seller[s.shop_id]

    const admin = await createAdminClient() as any

    const today = new Date()
    const start = period === 'month' ? startOfMonth(today) : startOfMonth(subMonths(today, 11))
    const end = endOfMonth(today)

    // Toutes les ventes de la période (page par page au-delà de 1000) — voir lib/dashboard/fetch-rows
    const sales = await fetchAllRows(() => {
      let q = admin
        .from('sales')
        .select('id, shop_id, cashier_id, sale_items(product_id, product_name, quantity, subtotal)')
        .in('shop_id', shopIds)
        .eq('sale_status', 'active')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    })

    // Même règle que la vue « Semaine » : une ligne par produit, y compris
    // quand plusieurs boutiques vendent le même (lib/dashboard/top-products).
    const data = computeTopProducts(sales.filter(keep))

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
