import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { sale_id } = await request.json()
    if (!sale_id) return NextResponse.json({ error: 'Missing sale_id' }, { status: 400 })

    const admin = await createAdminClient() as any

    // Get caller membership to check delete permission
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 })

    // Check permission: owner/super_admin in THIS shop, or member with can_delete_sales
    const { data: member } = await supabase
      .from('shop_members')
      .select('role, can_delete_sales')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const isOwnerOrAdmin = member.role === 'owner' || member.role === 'super_admin'
    if (!isOwnerOrAdmin && !member.can_delete_sales) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Restore stock only if sale was NOT already cancelled (cancelled already restored stock)
    if (sale.sale_status === 'active') {
      for (const item of (sale.sale_items || [])) {
        if (!item.product_id) continue
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
        if (product) {
          await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id)
        }
      }
    }

    // Delete sale_items then sale
    await admin.from('sale_items').delete().eq('sale_id', sale_id)
    await admin.from('payments').delete().eq('sale_id', sale_id)
    const { error: delErr } = await admin.from('sales').delete().eq('id', sale_id)

    if (delErr) throw delErr

    return NextResponse.json({ success: true, message: `Vente #${sale.sale_number} supprimée définitivement` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
