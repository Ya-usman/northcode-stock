import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// GET /api/payments/history-all?shop_ids=...&date_from=...&date_to=...
// Returns all customers with credit-related sales, optionally filtered by date range
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })

    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    const supabase = await createClient() as any
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: memberRows } = await supabase
      .from('shop_members')
      .select('shop_id')
      .in('shop_id', shopIds)
      .eq('user_id', user.id)
      .eq('is_active', true)

    const allowedIds = shopIds.filter(id => (memberRows || []).some((m: any) => m.shop_id === id))
    if (!allowedIds.length) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = await createAdminClient() as any

    // Fetch all sales with a customer (credit sales) in date range
    let salesQuery = admin
      .from('sales')
      .select('id, sale_number, created_at, total, amount_paid, balance, payment_status, customer_id, cashier_id, sale_items(product_name, quantity, subtotal)')
      .in('shop_id', allowedIds)
      .not('customer_id', 'is', null)
      .eq('sale_status', 'active')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (dateFrom) salesQuery = salesQuery.gte('created_at', dateFrom)
    if (dateTo) {
      const endOfDay = new Date(dateTo)
      endOfDay.setHours(23, 59, 59, 999)
      salesQuery = salesQuery.lte('created_at', endOfDay.toISOString())
    }

    const { data: salesData, error: salesErr } = await salesQuery
    if (salesErr) throw salesErr
    const sales: any[] = salesData || []
    if (!sales.length) return NextResponse.json({ customers: [] })

    const customerIds = Array.from(new Set(sales.map((s: any) => s.customer_id)))

    const [customersRes, cashierProfilesRes] = await Promise.all([
      admin.from('customers').select('*').in('id', customerIds),
      ((): Promise<{ data: any[] }> => {
        const cashierIds = Array.from(new Set(sales.map((s: any) => s.cashier_id).filter(Boolean)))
        if (!cashierIds.length) return Promise.resolve({ data: [] })
        return admin.from('profiles').select('id, full_name').in('id', cashierIds)
      })(),
    ])

    if (customersRes.error) throw customersRes.error
    const customers: any[] = customersRes.data || []

    const cashierMap: Record<string, string> = {}
    for (const p of (cashierProfilesRes.data || [])) cashierMap[p.id] = p.full_name

    const salesByCustomer: Record<string, any[]> = {}
    for (const sale of sales) {
      if (!salesByCustomer[sale.customer_id]) salesByCustomer[sale.customer_id] = []
      salesByCustomer[sale.customer_id].push({
        ...sale,
        cashier_name: sale.cashier_id ? (cashierMap[sale.cashier_id] || null) : null,
      })
    }

    const customerMap = Object.fromEntries(customers.map((c: any) => [c.id, c]))
    const result = (customerIds as string[])
      .map(customerId => {
        const customer = customerMap[customerId]
        if (!customer) return null
        const customerSales = salesByCustomer[customerId] || []
        const totalOwed = customerSales.reduce((s: number, sale: any) => s + Number(sale.total), 0)
        const totalPaid = customerSales.reduce((s: number, sale: any) => s + Number(sale.amount_paid), 0)
        const totalRemaining = customerSales.reduce((s: number, sale: any) => s + Number(sale.balance), 0)
        return { customer, sales: customerSales, totalOwed, totalPaid, totalRemaining, isSolde: totalRemaining <= 0.01 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.isSolde !== b.isSolde) return a.isSolde ? 1 : -1
        return b.totalRemaining - a.totalRemaining
      })

    return NextResponse.json({ customers: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
