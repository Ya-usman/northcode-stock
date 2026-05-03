import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
// supabase user client used for shop membership check (respects RLS)

export async function POST(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { sale_id, reason } = await request.json()
    if (!sale_id) return NextResponse.json({ error: 'Missing sale_id' }, { status: 400 })

    const admin = await createAdminClient() as any

    // Fetch the sale + its items
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: 'Vente déjà annulée' }, { status: 400 })

    // Verify caller has access to the sale's shop
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!memberRow) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const isOwner = memberRow.role === 'owner' || memberRow.role === 'super_admin'
    const isCashierOwn = memberRow.role === 'cashier' && sale.cashier_id === user.id

    if (!isOwner && !isCashierOwn) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Cashiers can only cancel today's sales
    if (!isOwner) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (new Date(sale.created_at) < today) {
        return NextResponse.json({ error: 'Vous ne pouvez annuler que les ventes du jour' }, { status: 403 })
      }
    }

    // Atomic: restore stock + mark cancelled in a single DB transaction
    const { error: rpcErr } = await admin.rpc('cancel_sale', {
      p_sale_id: sale_id,
      p_cancelled_by: user.id,
      p_reason: reason || null,
    })

    if (rpcErr) throw rpcErr

    return NextResponse.json({ success: true, message: `Vente #${sale.sale_number} annulée` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
