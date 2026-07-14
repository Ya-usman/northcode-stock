import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// GET /api/supplier-payments/history?shop_id=xxx&supplier_id=yyy
// Mirrors GET /api/payments/history (customer side).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    const supplier_id = searchParams.get('supplier_id')
    if (!shop_id || !supplier_id) {
      return NextResponse.json({ error: 'shop_id et supplier_id requis' }, { status: 400 })
    }

    const supabase = await createClient() as any
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = await createAdminClient() as any

    const [memberRes, posRes] = await Promise.all([
      supabase
        .from('shop_members').select('role')
        .eq('shop_id', shop_id).eq('user_id', user.id).eq('is_active', true).single(),
      admin
        .from('purchase_orders')
        .select('id, reference, created_at, total_amount, amount_paid, balance, payment_status, status, purchase_order_items(product_name, quantity_ordered, quantity_received, unit_price)')
        .eq('supplier_id', supplier_id)
        .eq('shop_id', shop_id)
        .in('status', ['received', 'partial'])
        .order('created_at', { ascending: false }),
    ])

    let callerRole = memberRes.data?.role
    if (!callerRole) {
      const { data: profile } = await supabase
        .from('profiles').select('role, shop_id').eq('id', user.id).single()
      if ((profile as any)?.shop_id === shop_id) callerRole = (profile as any)?.role
    }
    if (!callerRole) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const purchaseOrders: any[] = posRes.data || []
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
