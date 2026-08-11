import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

const ALLOWED_MINUTES = [15, 30, 45, 60] as const

// POST /api/shops/extend-hours — prolonge la fermeture du jour même, par
// incréments fixes, plafonné à 2 fois/jour. Le calcul (fuseau de la
// boutique, quota atomique) vit dans grant_hours_extension (migration 108)
// — pas ici, pour éviter la course entre lecture et écriture d'un compteur.
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, minutes } = await request.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    if (!ALLOWED_MINUTES.includes(minutes)) {
      return NextResponse.json({ error: 'Durée de prolongation invalide' }, { status: 400 })
    }

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'extend_hours'))) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('grant_hours_extension', { p_shop_id: shop_id, p_minutes: minutes })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await writeAuditLog({
      action: 'shop.extend_hours',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: shop_id,
      target_type: 'shop',
      metadata: { minutes, ...data },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, ...data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
