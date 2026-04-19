import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/payments/history?shop_id=xxx&customer_id=yyy
// Returns full payment history for a customer: all sales + all payments on those sales
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    const customer_id = searchParams.get('customer_id')
    if (!shop_id || !customer_id) {
      return NextResponse.json({ error: 'shop_id et customer_id requis' }, { status: 400 })
    }

    // Auth check
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session: _sess } } = await supabase.auth.getSession()
    const user = _sess?.user ?? null
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: memberRow } = await supabase
      .from('shop_members').select('role')
      .eq('shop_id', shop_id).eq('user_id', user.id).eq('is_active', true).single()
    let callerRole = memberRow?.role
    if (!callerRole) {
      const { data: profile } = await supabase.from('profiles').select('role, shop_id').eq('id', user.id).single()
      if ((profile as any)?.shop_id === shop_id) callerRole = (profile as any)?.role
    }
    if (!callerRole) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = await createAdminClient() as any

    // All sales for this customer in this shop
    const { data: sales, error: salesErr } = await admin
      .from('sales')
      .select('id, sale_number, created_at, total, amount_paid, balance, payment_status, payment_method, cashier_id, sale_items(product_name, quantity, unit_price, subtotal)')
      .eq('customer_id', customer_id)
      .eq('shop_id', shop_id)
      .eq('sale_status', 'active')
      .order('created_at', { ascending: false })

    if (salesErr) throw salesErr
    if (!sales?.length) return NextResponse.json({ sales: [], payments: [] })

    const saleIds = sales.map((s: any) => s.id)

    // All payments on those sales
    const { data: payments, error: payErr } = await admin
      .from('payments')
      .select('id, sale_id, amount, method, reference, notes, paid_at, received_by')
      .in('sale_id', saleIds)
      .order('paid_at', { ascending: false })

    if (payErr) throw payErr

    // Fetch all profile names in one query
    const profileIds = Array.from(new Set([
      ...sales.map((s: any) => s.cashier_id),
      ...(payments || []).map((p: any) => p.received_by),
    ].filter(Boolean))) as string[]

    let profileMap: Record<string, string> = {}
    if (profileIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles').select('id, full_name').in('id', profileIds)
      for (const p of (profiles || [])) profileMap[p.id] = p.full_name
    }

    const enrichedSales = sales.map((s: any) => ({
      ...s,
      cashier_name: s.cashier_id ? (profileMap[s.cashier_id] || null) : null,
    }))

    const enrichedPayments = (payments || []).map((p: any) => ({
      ...p,
      received_by_name: p.received_by ? (profileMap[p.received_by] || null) : null,
    }))

    return NextResponse.json({ sales: enrichedSales, payments: enrichedPayments })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
