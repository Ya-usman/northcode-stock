// Montant d'un paiement de FORMULE (tarification du 3 nov. 2026) — RÈGLE UNIQUE pour le paiement manuel
// (/api/billing/subscribe) et le renouvellement automatique (/api/cron/renewal-check) :
//   pays de tarification (lib/saas/pricing-country) → prix du pays → ancien prix garanti s'il est moins cher
//   (lib/saas/legacy-terms) → options reconduites (lib/saas/addons, retrait programmé appliqué) → durée (même remise).

import { getCountry, getBillingCurrency, type BillingPeriod, type CountryConfig } from '@/lib/saas/countries'
import { getPricingCountry, resolvePricingCountry, type PricingCountry } from '@/lib/saas/pricing-country'
import { getLegacyTerms, monthlyPriceFor } from '@/lib/saas/legacy-terms'
import { getEntityAddons, periodPriceWithAddons, renewalAddons } from '@/lib/saas/addons'
import type { EntityAccount } from '@/lib/saas/entity'

export interface PlanCharge {
  country: CountryConfig
  currency: string
  pricing: PricingCountry
  monthlyPrice: number
  renew: { seats: number; shops: number }
  amount: number
}

/** null = formule inconnue pour ce pays */
export async function computePlanCharge(
  admin: any, account: EntityAccount | null, plan: 'starter' | 'pro' | 'business', period: BillingPeriod,
  fallbackCountry?: string | null,
): Promise<PlanCharge | null> {
  const pricing = account ? await getPricingCountry(admin, account) : resolvePricingCountry({ declared: fallbackCountry ?? null, activity: [] })
  const country = getCountry(pricing.country)
  // Devise de FACTURATION (jamais country.currency : les pays UE hors zone euro paient en EUR)
  const currency = getBillingCurrency(country)
  const tariff = country.prices[plan]
  if (!tariff) return null
  const monthlyPrice = monthlyPriceFor(tariff, plan, currency, await getLegacyTerms(admin, account?.entityId), account).price
  const renew = renewalAddons(await getEntityAddons(admin, account?.entityId), plan)
  return { country, currency, pricing, monthlyPrice, renew, amount: periodPriceWithAddons(monthlyPrice, country.addons, renew.seats, renew.shops, period) }
}
