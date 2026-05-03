import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/payments/history?shop_id=xxx&customer_id=yyy
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    const customer_id = searchParams.get('customer_id')
    if (!shop_id || !customer_id) {
      return NextResponse.json({ error: 'shop_id et customer_id requis' }, { status: 400 })
    }

    // Auth — getSession() is a local JWT decode, fast
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = await createAdminClient() as any

    // Parallel: role check + sales query (optimistic — discard sales if role check fails)
    const [memberRes, salesRes] = await Promise.all([
      supabase
        .from('shop_members').select('role')
        .eq('shop_id', shop_id).eq('user_id', user.id).eq('is_active', true).single(),
      admin
        .from('sales')
        .select('id, sale_number, created_at, total, amount_paid, balance, payment_status, payment_method, cashier_id, sale_items(product_name, quantity, unit_price, subtotal)')
        .eq('customer_id', customer_id)
        .eq('shop_id', shop_id)
        .eq('sale_status', 'active')
        .order('created_at', { ascending: false }),
    ])

    // Role check — fall back to profiles table if not a shop_member
    let callerRole = memberRes.data?.role
    if (!callerRole) {
      const { data: profile } = await supabase
        .from('profiles').select('role, shop_id').eq('id', user.id).single()
      if ((profile as any)?.shop_id === shop_id) callerRole = (profile as any)?.role
    }
    if (!callerRole) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const sales: any[] = salesRes.data || []
    if (!sales.length) return NextResponse.json({ sales: [], payments: [] })

    const saleIds = sales.map((s: any) => s.id)
    const cashierIds = Array.from(new Set(sales.map((s: any) => s.cashier_id).filter(Boolean))) as string[]

    // Parallel: payments + profiles for cashiers (likely the same people as received_by)
    const [paymentsRes, cashierProfilesRes] = await Promise.all([
      admin
        .from('payments')
        .select('id, sale_id, amount, method, reference, notes, paid_at, received_by')
        .in('sale_id', saleIds)
        .order('paid_at', { ascending: false }),
      cashierIds.length > 0
        ? admin.from('profiles').select('id, full_name').in('id', cashierIds)
        : Promise.resolve({ data: [] }),
    ])

    const payments: any[] = paymentsRes.data || []
    const profileMap: Record<string, string> = {}
    for (const p of (cashierProfilesRes.data || [])) profileMap[p.id] = p.full_name

    // Fetch any received_by profiles not already loaded (usually same team → often 0 extra fetches)
    const missingIds = Array.from(new Set(
      payments.map((p: any) => p.received_by).filter((id: any) => id && !profileMap[id])
    )) as string[]
    if (missingIds.length > 0) {
      const { data: extra } = await admin.from('profiles').select('id, full_name').in('id', missingIds)
      for (const p of (extra || [])) profileMap[p.id] = p.full_name
    }

    const enrichedSales = sales.map((s: any) => ({
      ...s,
      cashier_name: s.cashier_id ? (profileMap[s.cashier_id] || null) : null,
    }))
    const enrichedPayments = payments.map((p: any) => ({
      ...p,
      received_by_name: p.received_by ? (profileMap[p.received_by] || null) : null,
    }))

    return NextResponse.json({ sales: enrichedSales, payments: enrichedPayments })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
