import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isTeamManager } from '@/lib/team/roles'
import { resolveAccount, countTeamSeats } from '@/lib/saas/team-quota'

// GET /api/team/quota?shop_id=… — sièges d'équipe du compte auquel appartient
// la boutique : { used, limit, plan, planName }. Même fonction que
// l'invitation, l'affectation et le contrôle après paiement (règle unique).
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

    const seats = await countTeamSeats(admin, account)
    return NextResponse.json({ used: seats.used, limit: seats.limit, plan: seats.plan, planName: seats.planName })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
