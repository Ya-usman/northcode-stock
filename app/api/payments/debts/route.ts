import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/payments/debts?shop_ids=id1,id2  (or legacy ?shop_id=xxx)
// Returns customers with debt + their unpaid sales (bypasses RLS)
// Cashiers only see debtors whose unpaid sales they created (cashier_id = user.id)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })

    // Auth check — use getSession() to avoid network round-trip failures on expired tokens.
    // The JWT is still Supabase-signed; membership check below ensures proper authorization.
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
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

    // Determine caller role (for cashier-specific filtering)
    const callerMemberRow = (memberRows || []).find((m: any) => allowedIds.includes(m.shop_id))
    let callerRole: string | null = callerMemberRow?.role || null
    if (!callerRole) {
      const { data: profile } = await supabase.from('profiles').select('role, shop_id').eq('id', user.id).single()
      if (profile && allowedIds.includes((profile as any).shop_id)) {
        callerRole = (profile as any).role
      }
    }

    const isCashier = callerRole === 'cashier'
    const admin = await createAdminClient() as any

    let allSales: any[] = []
    let customers: any[] = []

    if (isCashier) {
      // Cashier: fetch only their own unpaid sales, then derive the customers
      const { data: cashierSales, error: salesErr } = await admin
        .from('sales')
        .select('id, sale_number, created_at, total, balance, amount_paid, payment_status, customer_id, cashier_id, sale_items(product_name, quantity, subtotal)')
        .in('shop_id', allowedIds)
        .eq('cashier_id', user.id)
        .gt('balance', 0)
        .eq('sale_status', 'active')
        .order('created_at', { ascending: true })

      if (salesErr) throw salesErr
      allSales = cashierSales || []
      if (!allSales.length) return NextResponse.json({ debtors: [] })

      const cashierCustomerIds = Array.from(new Set(allSales.map((s: any) => s.customer_id).filter(Boolean)))
      const { data: cashierCustomers, error: custErr } = await admin
        .from('customers')
        .select('*')
        .in('id', cashierCustomerIds)

      if (custErr) throw custErr
      customers = cashierCustomers || []
    } else {
      // Owner/manager: all customers with outstanding debt
      const { data: ownerCustomers, error: custErr } = await admin
        .from('customers')
        .select('*')
        .in('shop_id', allowedIds)
        .gt('total_debt', 0)
        .order('total_debt', { ascending: false })

      if (custErr) throw custErr
      customers = ownerCustomers || []
      if (!customers.length) return NextResponse.json({ debtors: [] })

      const customerIds = customers.map((c: any) => c.id)
      const { data: ownerSales, error: salesErr } = await admin
        .from('sales')
        .select('id, sale_number, created_at, total, balance, amount_paid, payment_status, customer_id, cashier_id, sale_items(product_name, quantity, subtotal)')
        .in('shop_id', allowedIds)
        .in('customer_id', customerIds)
        .gt('balance', 0)
        .eq('sale_status', 'active')
        .order('created_at', { ascending: true })

      if (salesErr) throw salesErr
      allSales = ownerSales || []
    }

    // Fetch cashier names for all sales
    const cashierIds = Array.from(new Set(allSales.map((s: any) => s.cashier_id).filter(Boolean)))
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
    for (const sale of allSales) {
      if (!salesByCustomer[sale.customer_id]) salesByCustomer[sale.customer_id] = []
      salesByCustomer[sale.customer_id].push({
        ...sale,
        cashier_name: sale.cashier_id ? (cashierMap[sale.cashier_id] || null) : null,
      })
    }

    // For cashiers: totalDebt = sum of their own unpaid sales balances (not customer.total_debt)
    const debtors = customers
      .map((customer: any) => {
        const unpaidSales = salesByCustomer[customer.id] || []
        const totalDebt = isCashier
          ? unpaidSales.reduce((s: number, sale: any) => s + Number(sale.balance), 0)
          : Number(customer.total_debt)
        return { customer, unpaidSales, totalDebt }
      })
      .filter(d => d.totalDebt > 0 || d.unpaidSales.length > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt)

    return NextResponse.json({ debtors })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
