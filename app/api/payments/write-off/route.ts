import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/payments/write-off — mark an unpaid sale's remaining balance as
// uncollectible. Modeled as a special payment (is_write_off = true, amount
// = the sale's current balance) rather than a parallel system: the existing
// update_customer_debt_on_payment trigger applies automatically, and the
// row inherits print/cancel/audit for free (migration 115).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { sale_id, shop_id, reason } = await request.json()
    if (!sale_id || !shop_id || !reason) {
      return NextResponse.json({ error: t('missing_fields') }, { status: 400 })
    }

    // Write-offs destroy value — restricted to managerial roles, unlike
    // recording a repayment (which cashiers can also do).
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const isManagerial = memberRow && ['owner', 'manager', 'shop_manager', 'super_admin'].includes(memberRow.role)
    if (!isManagerial) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('id, shop_id, sale_number, balance, sale_status')
      .eq('id', sale_id)
      .eq('shop_id', shop_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: t('sale_not_found') }, { status: 404 })
    if (sale.sale_status !== 'active') return NextResponse.json({ error: t('sale_is_cancelled') }, { status: 400 })
    if (Number(sale.balance) <= 0) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    // method is set to a neutral value only to satisfy the NOT NULL
    // constraint — never displayed as a real payment method when
    // is_write_off is true (see history/receipt rendering).
    const { error: insertErr } = await admin.from('payments').insert({
      sale_id,
      amount: sale.balance,
      method: 'cash',
      is_write_off: true,
      is_repayment: false,
      notes: reason,
      received_by: user.id,
    })

    if (insertErr) throw insertErr

    await writeAuditLog({
      action: 'payment.write_off',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale_id,
      target_type: 'sale',
      metadata: { sale_number: sale.sale_number, amount: sale.balance, reason },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, amount: sale.balance })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
