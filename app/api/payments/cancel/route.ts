import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/payments/cancel — soft-cancel a recorded repayment. The row is
// never deleted (kept for traceability in the history view + audit log);
// sales.amount_paid/payment_status and customers.total_debt are recomputed
// atomically by the cancel_payment RPC (see migration 113).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { payment_id, shop_id, reason } = await request.json()
    if (!payment_id || !shop_id) {
      return NextResponse.json({ error: t('missing_fields') }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    const { data: payment, error: payErr } = await admin
      .from('payments')
      .select('id, amount, paid_at, received_by, is_cancelled, sales!inner(shop_id, sale_number)')
      .eq('id', payment_id)
      .single()

    if (payErr || !payment) return NextResponse.json({ error: t('payment_not_found') }, { status: 404 })
    if (payment.sales?.shop_id !== shop_id) return NextResponse.json({ error: t('payment_not_found') }, { status: 404 })
    if (payment.is_cancelled) return NextResponse.json({ error: t('payment_already_cancelled') }, { status: 400 })

    // Same permission model as sale.cancel: owner/manager/shop_manager/super_admin
    // always allowed; a cashier only on a payment THEY collected, same-day.
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!memberRow) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const isManagerial = ['owner', 'manager', 'shop_manager', 'super_admin'].includes(memberRow.role)
    const isCollectorOwn = memberRow.role === 'cashier' && payment.received_by === user.id

    if (!isManagerial && !isCollectorOwn) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    if (!isManagerial) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (new Date(payment.paid_at) < today) {
        return NextResponse.json({ error: t('cancel_only_today_payment') }, { status: 403 })
      }
    }

    const { data: result, error: rpcErr } = await admin.rpc('cancel_payment', {
      p_payment_id: payment_id,
      p_cancelled_by: user.id,
      p_reason: reason || null,
    })

    if (rpcErr) throw rpcErr

    await writeAuditLog({
      action: 'payment.cancel',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: payment_id,
      target_type: 'payment',
      metadata: { sale_number: result?.sale_number, amount: payment.amount, reason: reason || null },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, sale_id: result?.sale_id, amount: payment.amount })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
