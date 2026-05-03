import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/dashboard/payments-today?shop_ids=x,y&start=...&end=...&week_start=...
// Returns actual cash received today (new sales + debt repayments) for the given shops.
export async function GET(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const weekStart = searchParams.get('week_start')

    if (!shopIdsParam || !start || !end) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
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
      return NextResponse.json({ error: 'Accès refusé à certains magasins' }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    // Fetch all payments in the full window (week or today)
    const queryStart = weekStart || start
    const { data: paymentsRaw } = await admin
      .from('payments')
      .select('amount, paid_at, sales!inner(shop_id)')
      .gte('paid_at', queryStart)
      .lte('paid_at', end)

    const payments = (paymentsRaw || []).filter((p: any) => shopIds.includes(p.sales?.shop_id))

    // Today total
    const todayTotal = payments
      .filter((p: any) => p.paid_at >= start)
      .reduce((s: number, p: any) => s + Number(p.amount), 0)

    // 7-day breakdown grouped by date (YYYY-MM-DD)
    const byDate: Record<string, number> = {}
    payments.forEach((p: any) => {
      const date = (p.paid_at as string).substring(0, 10)
      byDate[date] = (byDate[date] || 0) + Number(p.amount)
    })
    const weekPayments = Object.entries(byDate).map(([date, amount]) => ({ date, amount }))

    return NextResponse.json({ todayTotal, weekPayments })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
