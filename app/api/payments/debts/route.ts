import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { shopsWithView } from '@/lib/api/role-permissions'

// GET /api/payments/debts?shop_ids=id1,id2  (or legacy ?shop_id=xxx) [&customer_id=…]
// Returns customers with debt + their unpaid sales (bypasses RLS)
// Droits évalués boutique par boutique : « Crédits » en consultation. Exception de la caisse : avec customer_id,
// le droit de vendre suffit, pour la dette de CE client seulement (remboursement pendant une vente).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    // getUser() verifies the JWT with Supabase auth server — unlike getSession()
    // which only parses the cookie without server-side validation.
    const supabase = await createClient() as any
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Avant : l'appartenance à la boutique suffisait, sans le droit « Crédits »
    const customerId = searchParams.get('customer_id')
    const credit = await shopsWithView(supabase, user.id, shopIds, ['payments'])
    const pos = customerId ? await shopsWithView(supabase, user.id, shopIds, ['new_sale']) : { ids: [] as string[] }
    const allowedIds = shopIds.filter(id => credit.ids.includes(id) || pos.ids.includes(id))
    if (!allowedIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    // All roles: fetch all customers with outstanding debt in their shop(s)
    let custQuery = admin
      .from('customers')
      .select('*')
      .in('shop_id', allowedIds)
      .gt('total_debt', 0)
    if (customerId) custQuery = custQuery.eq('id', customerId)
    const { data: shopCustomers, error: custErr } = await custQuery.order('total_debt', { ascending: false })

    if (custErr) throw custErr
    const customers = shopCustomers || []
    if (!customers.length) return NextResponse.json({ debtors: [] })

    const customerIds = customers.map((c: any) => c.id)
    const { data: shopSales, error: salesErr } = await admin
      .from('sales')
      .select('id, sale_number, created_at, total, balance, amount_paid, payment_status, due_date, customer_id, cashier_id, sale_status, notes, sale_items(product_name, quantity, subtotal)')
      .in('shop_id', allowedIds)
      .in('customer_id', customerIds)
      .gt('balance', 0)
// Dettes : ventes à crédit ET reprises de dette (migration 168)
      .in('sale_status', ['active', 'opening'])
      .order('created_at', { ascending: true })

    if (salesErr) throw salesErr
    const allSales = shopSales || []

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

    const debtors = customers
      .map((customer: any) => {
        const unpaidSales = salesByCustomer[customer.id] || []
        const totalDebt = Number(customer.total_debt)
        return { customer, unpaidSales, totalDebt }
      })
      .filter((d: any) => d.totalDebt > 0 || d.unpaidSales.length > 0)
      .sort((a: any, b: any) => b.totalDebt - a.totalDebt)

    return NextResponse.json({ debtors })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
