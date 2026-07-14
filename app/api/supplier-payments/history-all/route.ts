import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// GET /api/supplier-payments/history-all?shop_ids=...&date_from=...&date_to=...
// Mirrors GET /api/payments/history-all (customer side).
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

    let poQuery = admin
      .from('purchase_orders')
      .select('id, reference, created_at, total_amount, amount_paid, balance, payment_status, supplier_id, purchase_order_items(product_name, quantity_ordered, quantity_received, unit_price)')
      .in('shop_id', allowedIds)
      .not('supplier_id', 'is', null)
      .in('status', ['received', 'partial'])
      .order('created_at', { ascending: false })
      .limit(1000)

    if (dateFrom) poQuery = poQuery.gte('created_at', dateFrom)
    if (dateTo) {
      const endOfDay = new Date(dateTo)
      endOfDay.setHours(23, 59, 59, 999)
      poQuery = poQuery.lte('created_at', endOfDay.toISOString())
    }

    const { data: poData, error: poErr } = await poQuery
    if (poErr) throw poErr
    const purchaseOrders: any[] = poData || []
    if (!purchaseOrders.length) return NextResponse.json({ suppliers: [] })

    const supplierIds = Array.from(new Set(purchaseOrders.map((po: any) => po.supplier_id)))

    const { data: suppliersData, error: supErr } = await admin.from('suppliers').select('*').in('id', supplierIds)
    if (supErr) throw supErr
    const suppliers: any[] = suppliersData || []

    const posBySupplier: Record<string, any[]> = {}
    for (const po of purchaseOrders) {
      if (!posBySupplier[po.supplier_id]) posBySupplier[po.supplier_id] = []
      posBySupplier[po.supplier_id].push(po)
    }

    const supplierMap = Object.fromEntries(suppliers.map((s: any) => [s.id, s]))
    const result = (supplierIds as string[])
      .map(supplierId => {
        const supplier = supplierMap[supplierId]
        if (!supplier) return null
        const supplierPOs = posBySupplier[supplierId] || []
        const totalOwed = supplierPOs.reduce((s: number, po: any) => s + Number(po.total_amount || 0), 0)
        const totalPaid = supplierPOs.reduce((s: number, po: any) => s + Number(po.amount_paid), 0)
        const totalRemaining = supplierPOs.reduce((s: number, po: any) => s + Number(po.balance), 0)
        return { supplier, purchaseOrders: supplierPOs, totalOwed, totalPaid, totalRemaining, isSolde: totalRemaining <= 0.01 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.isSolde !== b.isSolde) return a.isSolde ? 1 : -1
        return b.totalRemaining - a.totalRemaining
      })

    return NextResponse.json({ suppliers: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
