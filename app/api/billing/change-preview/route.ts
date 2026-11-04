import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { OFFERED_PERIODS, type BillingPeriod } from '@/lib/saas/countries'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { computePlanCharge } from '@/lib/billing/plan-charge'
import { prepareChange } from '@/lib/saas/plan-change-server'
import { isDowngrade } from '@/lib/saas/plan-change'
import { PLANS, type PlanId } from '@/lib/saas/plans'
import { getGrantBonus } from '@/lib/saas/grants'
import { countTeamSeats } from '@/lib/saas/team-quota'

// GET /api/billing/change-preview?shop_id=…&plan=…&period=…  (pure lecture, propriétaire)
// Aperçu d'un paiement de formule, MÊME calcul que /api/billing/subscribe (lib/billing/plan-charge + lib/saas/plan-change) :
// montant, crédit d'une montée, à payer, début et fin de la période, refus éventuel ; pour une descente, ce qui sera
// mis en pause à la bascule (boutiques et employés au-delà des limites de la nouvelle formule).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const sp = new URL(request.url).searchParams
  const shopId = sp.get('shop_id') || '', plan = sp.get('plan') || '', period = sp.get('period') as BillingPeriod
  if (!/^[0-9a-f-]{36}$/i.test(shopId) || !['starter', 'pro', 'business'].includes(plan) || !OFFERED_PERIODS.includes(period))
    return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  const role = await checkShopRole(userClient, user.id, shopId)
  if (!account || !(account.ownerId === user.id || role === 'owner')) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

  const charge = await computePlanCharge(admin, account, plan as 'starter' | 'pro' | 'business', period)
  if (!charge) return NextResponse.json({ error: t('invalid_plan_for_country') }, { status: 400 })
  const change = await prepareChange(admin, account, plan, period, charge.amount, charge.currency)

  // Descente : ce qui dépassera les limites de la nouvelle formule (formule + gestes + options reconduites)
  let paused = { shops: 0, seats: 0 }
  if (change.schedule === 'next' && isDowngrade(account.plan, plan)) {
    const limits = PLANS[plan as PlanId].limits
    const [shopIds, seats, bonus] = await Promise.all([getEntityShopIds(admin, account, { includeSuspended: true }), countTeamSeats(admin, account), getGrantBonus(admin, account.entityId)])
    paused = {
      shops: Math.max(0, shopIds.length - (limits.shops + bonus.shops + charge.renew.shops)),
      seats: Math.max(0, seats.used - (limits.team_members + bonus.team_seats + charge.renew.seats)),
    }
  }
  return NextResponse.json({
    plan, period, current_plan: account.plan, schedule: change.schedule, currency: charge.currency,
    amount: charge.amount, credit: change.credit, amount_due: Math.max(0, Math.round((charge.amount - change.credit) * 100) / 100),
    starts_at: change.start.toISOString(), ends_at: change.end.toISOString(),
    blocked: change.blocked, pending: change.pending, paused, renew: charge.renew,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
