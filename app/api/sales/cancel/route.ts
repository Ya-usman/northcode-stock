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

    const { sale_id, reason } = await request.json()
    if (!sale_id) return NextResponse.json({ error: t('missing_sale_id') }, { status: 400 })

    const admin = await createAdminClient() as any

    // Fetch the sale + its items
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: t('sale_not_found') }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: t('sale_already_cancelled') }, { status: 400 })

    // Verify caller has access to the sale's shop
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

    const isOwner = memberRow.role === 'owner' || memberRow.role === 'manager' || memberRow.role === 'shop_manager' || memberRow.role === 'super_admin'
    const isCashierOwn = memberRow.role === 'cashier' && sale.cashier_id === user.id

    if (!isOwner && !isCashierOwn) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    // Cashiers can only cancel today's sales
    if (!isOwner) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (new Date(sale.created_at) < today) {
        return NextResponse.json({ error: t('cancel_only_today') }, { status: 403 })
      }
    }

    // Atomic: restore stock + mark cancelled in a single DB transaction
    const { error: rpcErr } = await admin.rpc('cancel_sale', {
      p_sale_id: sale_id,
      p_cancelled_by: user.id,
      p_reason: reason || null,
    })

    if (rpcErr) throw rpcErr

    await writeAuditLog({
      action: 'sale.cancel',
      shop_id: sale.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale_id,
      target_type: 'sale',
      metadata: { sale_number: sale.sale_number, reason: reason || null },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, message: t('sale_cancelled_message', { number: sale.sale_number }) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
