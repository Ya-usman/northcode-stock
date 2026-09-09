import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { requireAdmin } from '@/lib/api/require-admin'

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const { user } = auth

    const { action, product_id, customer_id, shop_id } = await request.json()
    const admin = await createAdminClient() as any

    if (action === 'reactivate_product') {
      if (!product_id) return NextResponse.json({ error: 'product_id requis' }, { status: 400 })
      const { error } = await admin.from('products').update({ is_active: true }).eq('id', product_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await writeAuditLog({ action: 'admin.restore_product', shop_id, actor_id: user.id, actor_email: user.email, target_id: product_id, target_type: 'product', ip: getClientIp(request) })
      return NextResponse.json({ success: true })
    }

    if (action === 'restore_customer') {
      if (!customer_id) return NextResponse.json({ error: 'customer_id requis' }, { status: 400 })
      const { error } = await admin.from('customers').update({ deleted_at: null }).eq('id', customer_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await writeAuditLog({ action: 'admin.restore_customer', shop_id, actor_id: user.id, actor_email: user.email, target_id: customer_id, target_type: 'customer', ip: getClientIp(request) })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
