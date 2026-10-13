import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { PO_LINES, debtOrder, supplierDebtShops } from '@/lib/api/supplier-access'

// GET /api/supplier-payments/debts?shop_ids=id1,id2
// Suppliers with total_owed + their unpaid purchase orders. Mirrors
// GET /api/payments/debts (customer side).
// Droit : « Crédits » dans la boutique (il suffit pour consulter une dette fournisseur). Les lignes détaillées
// d'un bon (produit × quantité × prix unitaire) donnent le prix d'achat : elles ne sont envoyées qu'avec le droit
// de voir les coûts (lib/api/supplier-access).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids') || searchParams.get('shop_id')
    if (!shopIdsParam) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const access = await supplierDebtShops(supabase, user.id, shopIds)
    const allowedIds = shopIds.filter(id => access.debts.includes(id))
    if (!allowedIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    const { data: shopSuppliers, error: supErr } = await admin
      .from('suppliers')
      .select('*')
      .in('shop_id', allowedIds)
      .gt('total_owed', 0)
      .order('total_owed', { ascending: false })

    if (supErr) throw supErr
    const suppliers = shopSuppliers || []
    if (!suppliers.length) return NextResponse.json({ debtors: [] })

    const supplierIds = suppliers.map((s: any) => s.id)
    const { data: shopPOs, error: poErr } = await admin
      .from('purchase_orders')
      .select(`id, shop_id, reference, created_at, total_amount, balance, amount_paid, payment_status, status, supplier_id, is_opening_balance, notes, ${PO_LINES}`)
      .in('shop_id', allowedIds)
      .in('supplier_id', supplierIds)
      .gt('balance', 0)
      .in('status', ['received', 'partial'])
      .order('created_at', { ascending: true })

    if (poErr) throw poErr
    const allPOs = (shopPOs || []).map((po: any) => debtOrder(po, access.lines.includes(po.shop_id)))

    const posBySupplier: Record<string, any[]> = {}
    for (const po of allPOs) {
      if (!posBySupplier[po.supplier_id]) posBySupplier[po.supplier_id] = []
      posBySupplier[po.supplier_id].push(po)
    }

    const debtors = suppliers
      .map((supplier: any) => {
        const unpaidPOs = posBySupplier[supplier.id] || []
        const totalOwed = Number(supplier.total_owed)
        return { supplier, unpaidPOs, totalOwed }
      })
      .filter((d: any) => d.totalOwed > 0 || d.unpaidPOs.length > 0)
      .sort((a: any, b: any) => b.totalOwed - a.totalOwed)

    return NextResponse.json({ debtors })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
