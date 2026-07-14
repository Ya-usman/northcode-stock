import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

// POST /api/supplier-payments — record FIFO payment across a supplier's
// unpaid purchase orders. Mirrors POST /api/payments (customer side) —
// same idempotency + FIFO-in-JS + batch-insert pattern, the
// after_supplier_payment_insert trigger cascades the rest.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited

  try {
    const supabase = await createClient() as any
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { purchase_order_ids, amount, method, reference, notes, shop_id, client_request_id } = await request.json()

    if (!purchase_order_ids?.length || !amount || !method || !shop_id) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }
    if (Number(amount) <= 0 || !isFinite(Number(amount))) {
      return NextResponse.json({ error: 'Le montant doit être supérieur à 0' }, { status: 400 })
    }

    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const callerRole = memberRow?.role
    if (!callerRole || !['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    // Idempotency check — same reasoning as /api/payments: a retried
    // attempt returns what was already applied instead of double-paying.
    if (client_request_id) {
      const { data: existingPayments } = await admin
        .from('supplier_payments')
        .select('purchase_order_id, amount, purchase_orders(reference)')
        .like('client_request_id', `${client_request_id}:%`)
      if (existingPayments && existingPayments.length > 0) {
        const applied = existingPayments.map((p: any) => ({
          purchase_order_id: p.purchase_order_id,
          reference: p.purchase_orders?.reference,
          amount: Number(p.amount),
        }))
        const appliedTotal = applied.reduce((s: number, a: any) => s + a.amount, 0)
        return NextResponse.json({ success: true, applied, remaining: Math.max(0, Number(amount) - appliedTotal) })
      }
    }

    // Fetch unpaid POs sorted oldest first (FIFO)
    const { data: posRaw, error: posErr } = await admin
      .from('purchase_orders')
      .select('id, reference, total_amount, amount_paid, balance, payment_status, status, shop_id')
      .in('id', purchase_order_ids)
      .eq('shop_id', shop_id)
      .order('created_at', { ascending: true })

    if (posErr) throw posErr
    const pos = (posRaw || []) as Array<{
      id: string; reference: string; total_amount: number; amount_paid: number; balance: number
      payment_status: string; status: string; shop_id: string
    }>

    let remaining = Number(amount)
    const appliedTo: { purchase_order_id: string; reference: string; amount: number }[] = []

    for (const po of pos) {
      if (remaining <= 0) break
      if (po.status === 'cancelled') continue
      const poBalance = Number(po.balance)
      if (poBalance <= 0) continue
      const toApply = Math.min(remaining, poBalance)
      appliedTo.push({ purchase_order_id: po.id, reference: po.reference, amount: toApply })
      remaining -= toApply
    }

    // Batch insert — atomic, all rows roll back together on failure.
    if (appliedTo.length > 0) {
      const { error: batchErr } = await admin.from('supplier_payments').insert(
        appliedTo.map(p => ({
          purchase_order_id: p.purchase_order_id,
          amount: p.amount,
          method,
          reference: reference || null,
          notes: notes || null,
          paid_by: user.id,
          client_request_id: client_request_id ? `${client_request_id}:${p.purchase_order_id}` : null,
        }))
      )
      if (batchErr) throw batchErr
    }

    return NextResponse.json({ success: true, applied: appliedTo, remaining })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
