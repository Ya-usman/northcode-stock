import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { sale_id, amount, method, reference } = await request.json()
    if (!sale_id || !amount || !method) {
      return NextResponse.json({ error: t('missing_fields') }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Verify caller has access to the sale's shop before the atomic RPC
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('shop_id, sale_status, sale_number')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: t('sale_not_found') }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: t('sale_is_cancelled') }, { status: 400 })

    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!memberRow) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    // Atomic: lock sale row, cap amount, insert payment, update payment_method
    const { data: result, error: rpcErr } = await admin.rpc('validate_payment', {
      p_sale_id:   sale_id,
      p_amount:    Number(amount),
      p_method:    method,
      p_reference: reference || null,
      p_user_id:   user.id,
    })
    if (rpcErr) throw rpcErr

    const row = Array.isArray(result) ? result[0] : result
    const newBalance = Number(row?.new_balance ?? 0)

    await writeAuditLog({
      action: 'sale.validate_payment',
      shop_id: sale.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale_id,
      target_type: 'sale',
      metadata: { sale_number: sale.sale_number, amount: Number(amount), method },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, message: newBalance <= 0 ? t('payment_complete') : t('remaining_balance', { balance: newBalance }) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
