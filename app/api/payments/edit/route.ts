import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/payments/edit — correct a recorded repayment's method/reference/
// notes. The amount is never editable here: it was already applied FIFO
// across the customer's unpaid sales at recording time, so changing it
// would require re-deriving that allocation — cancel + re-record instead.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { payment_id, shop_id, method, reference, notes } = await request.json()
    if (!payment_id || !shop_id || !method) {
      return NextResponse.json({ error: t('missing_fields') }, { status: 400 })
    }

    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const callerRole = memberRow?.role
    if (!callerRole || !(await hasRolePermission(supabase, callerRole, shop_id, 'payments'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    const { data: payment, error: payErr } = await admin
      .from('payments')
      .select('id, method, is_cancelled, sales!inner(shop_id)')
      .eq('id', payment_id)
      .single()

    if (payErr || !payment) return NextResponse.json({ error: t('payment_not_found') }, { status: 404 })
    if (payment.sales?.shop_id !== shop_id) return NextResponse.json({ error: t('payment_not_found') }, { status: 404 })
    if (payment.is_cancelled) return NextResponse.json({ error: t('payment_already_cancelled') }, { status: 400 })

    const { error: updateErr } = await admin
      .from('payments')
      .update({
        method,
        reference: reference || null,
        notes: notes || null,
        edited_at: new Date().toISOString(),
        edited_by: user.id,
      })
      .eq('id', payment_id)

    if (updateErr) throw updateErr

    await writeAuditLog({
      action: 'payment.edit',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: payment_id,
      target_type: 'payment',
      metadata: { old_method: payment.method, new_method: method },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
