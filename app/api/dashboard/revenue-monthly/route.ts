import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns'
import { getApiTranslator } from '@/lib/api/i18n'
import { dashboardGuard } from '@/lib/api/shop-access'
import { fetchAllRows, fetchShopPayments } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/revenue-monthly?shop_ids=x,y&cashier_id=
// Daily revenue for the current calendar month, for the "Mois" view of the
// dashboard revenue chart. Same accounting method as /api/dashboard/revenue-yearly:
// revenue is cash actually RECEIVED (payments table, by paid_at), so a debt
// repayment collected later lands on the day it was paid, not the day the
// sale was created — the three chart periods (semaine/mois/année) must agree
// on this or switching between them would look inconsistent.
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
    const monthStart = startOfMonth(today)
    const monthEnd = endOfMonth(today)
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

    // Ventes et paiements des seules boutiques demandées, lus en entier
    // (page par page au-delà de 1000 lignes) — voir lib/dashboard/fetch-rows.
    const salesQuery = () => {
      let q = admin
        .from('sales')
        .select('id, created_at, shop_id, cashier_id')
        .in('shop_id', shopIds)
        .eq('sale_status', 'active')
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString())
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    }

    const [salesRaw, payments] = await Promise.all([
      fetchAllRows(salesQuery),
      fetchShopPayments(admin, shopIds, monthStart.toISOString(), monthEnd.toISOString(), seller),
    ])

    const dayMap: Record<string, { revenue: number; sales: number; repayments: number }> = {}
    days.forEach(d => { dayMap[format(d, 'yyyy-MM-dd')] = { revenue: 0, sales: 0, repayments: 0 } })

    ;(salesRaw || []).filter(keep).forEach((sale: any) => {
      const key = (sale.created_at as string).slice(0, 10)
      if (dayMap[key]) dayMap[key].sales += 1
    })

    payments.forEach((p: any) => {
      const key = (p.paid_at as string).slice(0, 10)
      if (dayMap[key]) {
        dayMap[key].revenue += Number(p.amount)
        if (p.is_repayment) dayMap[key].repayments += 1
      }
    })

    const data = days.map(d => {
      const key = format(d, 'yyyy-MM-dd')
      return {
        date: format(d, 'd'),
        revenue: dayMap[key].revenue,
        sales: dayMap[key].sales,
        repayments: dayMap[key].repayments,
      }
    })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
