import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { PO_LINES, debtOrder, supplierDebtShops } from '@/lib/api/supplier-access'

// GET /api/supplier-payments/history?shop_id=xxx&supplier_id=yyy
// Mirrors GET /api/payments/history (customer side).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    const supplier_id = searchParams.get('supplier_id')
    if (!shop_id || !supplier_id) {
      return NextResponse.json({ error: t('shop_supplier_ids_required') }, { status: 400 })
    }

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Droit « Crédits » ; les lignes détaillées des bons (prix d'achat) seulement avec le droit de voir les coûts
    const access = await supplierDebtShops(supabase, user.id, [shop_id])
    if (!access.debts.includes(shop_id)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const showLines = access.lines.includes(shop_id)

    const admin = await createAdminClient() as any
    const posRes = await admin
      .from('purchase_orders')
      .select(`id, reference, created_at, total_amount, amount_paid, balance, payment_status, status, is_opening_balance, notes${showLines ? ', ' + PO_LINES : ''}`)
      .eq('supplier_id', supplier_id)
      .eq('shop_id', shop_id)
      .in('status', ['received', 'partial'])
      .order('created_at', { ascending: false })

    const purchaseOrders: any[] = (posRes.data || []).map((po: any) => debtOrder(po, showLines))
    if (!purchaseOrders.length) return NextResponse.json({ purchaseOrders: [], payments: [] })

    const poIds = purchaseOrders.map((po: any) => po.id)

    const paymentsRes = await admin
      .from('supplier_payments')
      .select('id, purchase_order_id, amount, method, reference, notes, paid_at, paid_by')
      .in('purchase_order_id', poIds)
      .order('paid_at', { ascending: false })

    const payments: any[] = paymentsRes.data || []
    const paidByIds = Array.from(new Set(payments.map((p: any) => p.paid_by).filter(Boolean))) as string[]
    let profileMap: Record<string, string> = {}
    if (paidByIds.length > 0) {
      const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', paidByIds)
      for (const p of (profiles || [])) profileMap[p.id] = p.full_name
    }

    const enrichedPayments = payments.map((p: any) => ({
      ...p,
      paid_by_name: p.paid_by ? (profileMap[p.paid_by] || null) : null,
    }))

    return NextResponse.json({ purchaseOrders, payments: enrichedPayments })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
