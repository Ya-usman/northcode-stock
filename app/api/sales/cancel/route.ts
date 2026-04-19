import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session: _sess } } = await supabase.auth.getSession()
    const user = _sess?.user ?? null
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

    // Get caller profile to check role
    const { data: profile } = await admin.from('profiles').select('role, shop_id').eq('id', user.id).single()
    const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
    const isCashierOwn = profile?.role === 'cashier' && sale.cashier_id === user.id

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

    // Restore stock for each sale item
    for (const item of (sale.sale_items || [])) {
      if (!item.product_id) continue
      const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
      if (product) {
        await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id)
        await admin.from('stock_movements').insert({
          shop_id: sale.shop_id,
          product_id: item.product_id,
          type: 'in',
          quantity: item.quantity,
          reason: `Annulation vente #${sale.sale_number}`,
          notes: reason || null,
          performed_by: user.id,
        })
      }
    }

    // Mark sale as cancelled
    const { error: updateErr } = await admin.from('sales').update({
      sale_status: 'cancelled',
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || null,
    }).eq('id', sale_id)

    if (updateErr) throw updateErr

    return NextResponse.json({ success: true, message: `Vente #${sale.sale_number} annulée` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
