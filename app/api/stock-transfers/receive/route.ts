import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/stock-transfers/receive — valide les quantités reçues et
// incrémente le stock destination en une transaction (receive_stock_transfer).
// body: { transfer_id, destination_shop_id, items: [{transfer_item_id,
//   destination_product_id?, quantity_received, discrepancy_category?, discrepancy_detail?}] }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { transfer_id, destination_shop_id, items } = await request.json()
    if (!transfer_id || !destination_shop_id)
      return NextResponse.json({ error: 'transfer_id et destination_shop_id requis' }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Au moins une ligne est requise' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, destination_shop_id)
    if (!role || !(await hasRolePermission(supabase, role, destination_shop_id, 'transfers')))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any).rpc('receive_stock_transfer', {
      p_transfer_id: transfer_id,
      p_destination_shop_id: destination_shop_id,
      p_performed_by: user.id,
      p_items: items,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'stock_transfer.receive',
      shop_id: destination_shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: transfer_id,
      target_type: 'stock_transfer',
      ip: getClientIp(request),
      metadata: { actor_name: actorProfile?.full_name || user.email },
    })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
