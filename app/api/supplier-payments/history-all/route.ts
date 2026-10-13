import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { PO_LINES, debtOrder, supplierDebtShops } from '@/lib/api/supplier-access'

// GET /api/supplier-payments/history-all?shop_ids=...&date_from=...&date_to=...
// Mirrors GET /api/payments/history-all (customer side).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Droits « Crédits » et « Fournisseurs » ; les lignes détaillées des bons (prix d'achat) seulement avec le droit de voir les coûts
    const access = await supplierDebtShops(supabase, user.id, shopIds)
    const allowedIds = shopIds.filter(id => access.debts.includes(id))
    if (!allowedIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    let poQuery = admin
      .from('purchase_orders')
      .select(`id, shop_id, reference, created_at, total_amount, amount_paid, balance, payment_status, supplier_id, is_opening_balance, ${PO_LINES}`)
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
    const purchaseOrders: any[] = (poData || []).map((po: any) => debtOrder(po, access.lines.includes(po.shop_id)))
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
