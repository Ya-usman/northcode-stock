import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { subMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { getApiTranslator } from '@/lib/api/i18n'
import { dashboardGuard } from '@/lib/api/shop-access'
import { fetchAllRows, fetchShopPayments } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/revenue-yearly?shop_ids=x,y&cashier_id=
// Monthly revenue for the last 12 months (current month included), for the
// "Année" view of the dashboard revenue chart. Same accounting method as
// /api/dashboard/payments-today: revenue is cash actually RECEIVED (payments
// table, by paid_at) so a debt repayment collected later lands on the month
// it was paid, not the month the sale was created — the two chart periods
// must agree on this or switching between them would look inconsistent.
// `sales` count still comes from the sales table (by created_at), same split
// as the 7-day version.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids')
    const requestedSeller = searchParams.get('cashier_id')

    if (!shopIdsParam) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    // Périmètre décidé par le SERVEUR (lib/api/shop-access) : membre active de chaque boutique, widget autorisé dans
    // la boutique, et vendeur limité à SES ventes selon son rôle et les réglages de CETTE boutique. Le filtre vendeur
    // envoyé par le navigateur ne peut que restreindre : l'omettre n'élargit jamais les résultats. Avant : simple
    // contrôle d'appartenance, puis lecture complète avec le filtre (facultatif) fourni par le navigateur.
    const g = await dashboardGuard(supabase, user.id, shopIdsParam, ['widget_dashboard_revenue_chart'], requestedSeller)
    if ('error' in g) return NextResponse.json({ error: t(g.error.key as any) }, { status: g.error.status })
    const { shopIds, seller } = g
    const keep = (s: any) => !seller[s.shop_id] || s.cashier_id === seller[s.shop_id]

    const admin = await createAdminClient() as any

    const today = new Date()
    const months = Array.from({ length: 12 }, (_, i) => subMonths(today, 11 - i))
    const yearStart = startOfMonth(months[0]).toISOString()
    const yearEnd = endOfMonth(today).toISOString()

    // Ventes et paiements des seules boutiques demandées, lus en entier
    // (page par page au-delà de 1000 lignes) — voir lib/dashboard/fetch-rows.
    const salesQuery = () => {
      let q = admin
        .from('sales')
        .select('id, created_at, shop_id, cashier_id')
        .in('shop_id', shopIds)
        .eq('sale_status', 'active')
        .gte('created_at', yearStart)
        .lte('created_at', yearEnd)
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    }

    const [salesRaw, payments] = await Promise.all([
      fetchAllRows(salesQuery),
      fetchShopPayments(admin, shopIds, yearStart, yearEnd, seller),
    ])

    const monthMap: Record<string, { revenue: number; sales: number; repayments: number }> = {}
    months.forEach(m => { monthMap[format(m, 'yyyy-MM')] = { revenue: 0, sales: 0, repayments: 0 } })

    ;(salesRaw || []).filter(keep).forEach((sale: any) => {
      const key = (sale.created_at as string).slice(0, 7)
      if (monthMap[key]) monthMap[key].sales += 1
    })

    payments.forEach((p: any) => {
      const key = (p.paid_at as string).slice(0, 7)
      if (monthMap[key]) {
        monthMap[key].revenue += Number(p.amount)
        if (p.is_repayment) monthMap[key].repayments += 1
      }
    })

    const data = months.map(m => {
      const key = format(m, 'yyyy-MM')
      return {
        date: format(m, 'MMM'),
        // Clé du mois : le navigateur affiche le libellé dans la langue de l'écran
        month: key,
        revenue: monthMap[key].revenue,
        sales: monthMap[key].sales,
        repayments: monthMap[key].repayments,
      }
    })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
