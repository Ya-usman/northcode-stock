import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/stock-transfers/cancel — annule un transfert pas encore reçu,
// depuis la boutique source uniquement ; restaure son stock (cancel_stock_transfer).
// body: { transfer_id, source_shop_id }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { transfer_id, source_shop_id } = await request.json()
    if (!transfer_id || !source_shop_id)
      return NextResponse.json({ error: 'transfer_id et source_shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, source_shop_id)
    if (!role || !(await hasRolePermission(supabase, role, source_shop_id, 'transfers')))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { error } = await (admin as any).rpc('cancel_stock_transfer', {
      p_transfer_id: transfer_id,
      p_source_shop_id: source_shop_id,
      p_performed_by: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'stock_transfer.cancel',
      shop_id: source_shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: transfer_id,
      target_type: 'stock_transfer',
      ip: getClientIp(request),
      metadata: { actor_name: actorProfile?.full_name || user.email },
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
