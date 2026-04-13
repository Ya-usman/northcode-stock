import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/payments/debts?shop_id=xxx
// Returns all customers with debt + their unpaid sales (bypasses RLS)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    // Auth check
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Verify caller has access to this shop
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    let callerRole = memberRow?.role
    if (!callerRole) {
      const { data: profile } = await supabase.from('profiles').select('role, shop_id').eq('id', user.id).single()
      if ((profile as any)?.shop_id === shop_id) callerRole = (profile as any)?.role
    }
    if (!callerRole) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = await createAdminClient() as any

    // Customers with debt in this shop
    const { data: customers, error: custErr } = await admin
      .from('customers')
      .select('*')
      .eq('shop_id', shop_id)
      .gt('total_debt', 0)
      .order('total_debt', { ascending: false })

    if (custErr) throw custErr
    if (!customers?.length) return NextResponse.json({ debtors: [] })

    // Fetch unpaid sales for all customers in one query
    // Filter by balance > 0 (not by payment_status) to catch credit sales that were
    // incorrectly recorded as 'paid' but have amount_paid = 0 (legacy bug)
    const customerIds = customers.map((c: any) => c.id)
    const { data: allSales, error: salesErr } = await admin
      .from('sales')
      .select('id, sale_number, created_at, total, balance, amount_paid, payment_status, customer_id, cashier_id, sale_items(product_name, quantity, subtotal)')
      .eq('shop_id', shop_id)
      .in('customer_id', customerIds)
      .gt('balance', 0)
      .eq('sale_status', 'active')
      .order('created_at', { ascending: true })

    if (salesErr) throw salesErr

    // Fetch cashier names for all sales
    const cashierIds = Array.from(new Set((allSales || []).map((s: any) => s.cashier_id).filter(Boolean)))
    let cashierMap: Record<string, string> = {}
    if (cashierIds.length > 0) {
      const { data: cashierProfiles } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', cashierIds)
      for (const p of (cashierProfiles || [])) cashierMap[p.id] = p.full_name
    }

    // Group sales by customer_id
    const salesByCustomer: Record<string, any[]> = {}
    for (const sale of (allSales || [])) {
      if (!salesByCustomer[sale.customer_id]) salesByCustomer[sale.customer_id] = []
      salesByCustomer[sale.customer_id].push({
        ...sale,
        cashier_name: sale.cashier_id ? (cashierMap[sale.cashier_id] || null) : null,
      })
    }

    const debtors = customers.map((customer: any) => ({
      customer,
      unpaidSales: salesByCustomer[customer.id] || [],
      totalDebt: Number(customer.total_debt),
    }))

    return NextResponse.json({ debtors })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
