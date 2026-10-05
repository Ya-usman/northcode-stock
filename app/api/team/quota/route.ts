import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isTeamManager } from '@/lib/team/roles'
import { resolveAccount, countTeamSeats, getShopLimit } from '@/lib/saas/team-quota'

// GET /api/team/quota?shop_id=… — sièges d'équipe du compte auquel appartient
// la boutique : { used, limit, offered, plan, planName, shops_limit,
// shops_offered }. Limites effectives (formule + gestes commerciaux). Même
// fonction que l'invitation, l'affectation et le contrôle après paiement.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopId = new URL(request.url).searchParams.get('shop_id')
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!isTeamManager(role)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = createAdminClient() as any
    const account = await resolveAccount(admin, shopId)
    if (!account) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })

    const [seats, shops] = await Promise.all([countTeamSeats(admin, account), getShopLimit(admin, account)])
    return NextResponse.json({
      used: seats.used, limit: seats.limit, offered: seats.offered, plan: seats.plan, planName: seats.planName,
      shops_limit: shops.limit, shops_offered: shops.offered,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
