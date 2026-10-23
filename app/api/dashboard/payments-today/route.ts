import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { dashboardGuard } from '@/lib/api/shop-access'
import { fetchShopPayments } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/payments-today?shop_ids=x,y&start=...&end=...&week_start=...
// Returns actual cash received today (new sales + debt repayments) for the given shops.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const weekStart = searchParams.get('week_start')
    const requestedSeller = searchParams.get('cashier_id')

    if (!shopIdsParam || !start || !end) {
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
    // Paiements de la fenêtre (semaine ou jour) des SEULES boutiques autorisées, hors ventes annulées
    const queryStart = weekStart || start
    const payments = await fetchShopPayments(admin, shopIds, queryStart, end, seller)

    // Today total
    const todayTotal = payments
      .filter((p: any) => p.paid_at >= start)
      .reduce((s: number, p: any) => s + Number(p.amount), 0)

    // 7-day breakdown grouped by date (YYYY-MM-DD).
    // repaymentsCount: number of debt-repayment events that day (is_repayment
    // = true) — separate from amount, so the dashboard's "transactions" count
    // can include repayment activity without double-counting the payment
    // already made at sale creation.
    const byDate: Record<string, { amount: number; repaymentsCount: number }> = {}
    payments.forEach((p: any) => {
      const date = (p.paid_at as string).substring(0, 10)
      if (!byDate[date]) byDate[date] = { amount: 0, repaymentsCount: 0 }
      byDate[date].amount += Number(p.amount)
      if (p.is_repayment) byDate[date].repaymentsCount += 1
    })
    const weekPayments = Object.entries(byDate).map(([date, v]) => ({
      date, amount: v.amount, repaymentsCount: v.repaymentsCount,
    }))

    return NextResponse.json({ todayTotal, weekPayments })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
