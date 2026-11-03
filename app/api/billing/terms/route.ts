import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getAccountForShop } from '@/lib/saas/entity'
import { getCountry, getBillingCurrency } from '@/lib/saas/countries'
import { getLegacyTerms, monthlyPriceFor } from '@/lib/saas/legacy-terms'
import { getPricingCountry } from '@/lib/saas/pricing-country'

// Conditions des clients actuels pour la page Abonnement (tarification du 3 nov. 2026) : prix garanti par formule
// (le même calcul que /api/billing/subscribe, lib/saas/legacy-terms) et anciennes limites tant qu'elles valent.
// Propriétaire de la boutique seulement.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const shopId = new URL(request.url).searchParams.get('shop_id')
  if (!shopId) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  const role = await checkShopRole(userClient, user.id, shopId)
  if (!(account?.ownerId === user.id || role === 'owner')) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

  // Pays de tarification (migration 208), même règle que le paiement
  const p = account ? await getPricingCountry(admin, account) : null
  const pricing = p ? { country: p.country, reason: p.reason, declared: p.declared, activity_share: Math.round(p.activityShare * 100) } : null
  const terms = await getLegacyTerms(admin, account?.entityId)
  if (!terms) return NextResponse.json({ locked: {}, limits: null, pricing })
  const country = getCountry(pricing?.country ?? account?.billing_country)
  const currency = getBillingCurrency(country)
  const locked: Record<string, number> = {}
  for (const plan of ['starter', 'pro', 'business'] as const) {
    const r = monthlyPriceFor(country.prices[plan], plan, currency, terms, account)
    if (r.locked) locked[plan] = r.price
  }
  const limitsValid = new Date(terms.limits_until) > new Date() && account?.plan === terms.plan
  return NextResponse.json({
    locked,
    limits: limitsValid ? { plan: terms.plan, shops: terms.shops, team_members: terms.team_members, until: terms.limits_until } : null,
    pricing,
  })
}
