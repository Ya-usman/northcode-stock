import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns'
import { getApiTranslator } from '@/lib/api/i18n'

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
    const cashierId = searchParams.get('cashier_id')

    if (!shopIdsParam) {
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
    const monthStart = startOfMonth(today)
    const monthEnd = endOfMonth(today)
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

    let salesQuery = admin
      .from('sales')
      .select('id, created_at')
      .in('shop_id', shopIds)
      .eq('sale_status', 'active')
      .gte('created_at', monthStart.toISOString())
      .lte('created_at', monthEnd.toISOString())
    if (cashierId) salesQuery = salesQuery.eq('cashier_id', cashierId)

    let paymentsQuery = admin
      .from('payments')
      .select('amount, paid_at, is_repayment, sales!inner(shop_id, sale_status, cashier_id)')
      .gte('paid_at', monthStart.toISOString())
      .lte('paid_at', monthEnd.toISOString())

    const [{ data: salesRaw }, { data: paymentsRaw }] = await Promise.all([salesQuery, paymentsQuery])

    const payments = (paymentsRaw || []).filter((p: any) =>
      shopIds.includes(p.sales?.shop_id) &&
      p.sales?.sale_status !== 'cancelled' &&
      (!cashierId || p.sales?.cashier_id === cashierId)
    )

    const dayMap: Record<string, { revenue: number; sales: number; repayments: number }> = {}
    days.forEach(d => { dayMap[format(d, 'yyyy-MM-dd')] = { revenue: 0, sales: 0, repayments: 0 } })

    ;(salesRaw || []).forEach((sale: any) => {
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
