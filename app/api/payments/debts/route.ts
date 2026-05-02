import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/payments/debts?shop_ids=id1,id2  (or legacy ?shop_id=xxx)
// Returns all customers with debt + their unpaid sales (bypasses RLS)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })

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

    // Verify caller has access to all requested shops
    const { data: memberRows } = await supabase
      .from('shop_members')
      .select('shop_id, role')
      .in('shop_id', shopIds)
      .eq('user_id', user.id)
      .eq('is_active', true)

    const accessibleShopIds = (memberRows || []).map((m: any) => m.shop_id)

    // Fallback: profile primary shop
    if (accessibleShopIds.length < shopIds.length) {
      const { data: profile } = await supabase.from('profiles').select('role, shop_id').eq('id', user.id).single()
      for (const sid of shopIds) {
        if (!accessibleShopIds.includes(sid) && (profile as any)?.shop_id === sid) {
          accessibleShopIds.push(sid)
        }
      }
    }

    const allowedIds = shopIds.filter(id => accessibleShopIds.includes(id))
    if (!allowedIds.length) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = await createAdminClient() as any

    // Customers with debt across all allowed shops
    const { data: customers, error: custErr } = await admin
      .from('customers')
      .select('*')
      .in('shop_id', allowedIds)
      .gt('total_debt', 0)
      .order('total_debt', { ascending: false })

    if (custErr) throw custErr
    if (!customers?.length) return NextResponse.json({ debtors: [] })

    const customerIds = customers.map((c: any) => c.id)
    const { data: allSales, error: salesErr } = await admin
      .from('sales')
      .select('id, sale_number, created_at, total, balance, amount_paid, payment_status, customer_id, cashier_id, sale_items(product_name, quantity, subtotal)')
      .in('shop_id', allowedIds)
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
