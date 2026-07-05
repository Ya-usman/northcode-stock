import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

export async function POST(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { sale_id, customer_id, payment_method, notes, items } = await request.json()
    if (!sale_id || !payment_method || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Fetch sale to verify access + get current state for the audit log
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('shop_id, sale_status, sale_number, total, cashier_id')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: 'Vente annulée' }, { status: 400 })

    // Verify caller has access (owner/manager/shop_manager always; cashier only today's own)
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!memberRow) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const isManager = ['owner', 'manager', 'shop_manager', 'super_admin'].includes(memberRow.role)
    const isCashierOwn = memberRow.role === 'cashier' && sale.cashier_id === user.id

    if (!isManager && !isCashierOwn) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Cashiers can only edit today's own sales
    if (!isManager) {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: saleDate } = await admin
        .from('sales')
        .select('created_at')
        .eq('id', sale_id)
        .single()
      if (!saleDate || new Date(saleDate.created_at) < todayStart) {
        return NextResponse.json({ error: 'Vous ne pouvez modifier que les ventes du jour' }, { status: 403 })
      }
    }

    // Atomic edit
    const { data: result, error: rpcErr } = await admin.rpc('edit_sale', {
      p_sale_id:        sale_id,
      p_edited_by:      user.id,
      p_customer_id:    customer_id || null,
      p_payment_method: payment_method,
      p_notes:          notes || null,
      p_items:          items,
    })

    if (rpcErr) throw new Error(rpcErr.message)

    const row = Array.isArray(result) ? result[0] : result

    await writeAuditLog({
      action: 'sale.edit',
      shop_id: sale.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale_id,
      target_type: 'sale',
      metadata: {
        sale_number: sale.sale_number,
        old_total: Number(sale.total),
        new_total: Number(row?.new_total ?? 0),
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({
      success: true,
      message: `Vente #${sale.sale_number} modifiée`,
      ...row,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
