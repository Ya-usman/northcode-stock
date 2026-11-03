// Clients actuels (tarification du 3 nov. 2026, décision A) — RÈGLE UNIQUE, lue par le serveur (abonnement, sièges,
// boutiques, remise en ordre des limites) et par la page Abonnement.
//
// entities.legacy_terms (migration 205), rempli une fois pour les entreprises qui payaient au changement :
//   • limites de l'ancienne formule (ex. ancien Business : 10 boutiques, 30 employés) gardées jusqu'à `limits_until`
//     (fin de la période payée + 3 mois), tant que l'entreprise reste sur la même formule ;
//   • ancien prix mensuel garanti tant qu'elle renouvelle sans interruption (fin de période + délai de grâce), pour la
//     même formule et la même devise, et jamais plus cher que le nouveau prix (le client paie le moins cher des deux).

import { GRACE_PERIOD_DAYS } from './plans'

export type LegacyPlan = 'starter' | 'pro' | 'business'
export interface LegacyTerms {
  plan: LegacyPlan
  shops: number
  team_members: number
  limits_until: string
  currency: string | null
  monthly_price: number | null
  set_at?: string
}

export function parseLegacyTerms(raw: unknown): LegacyTerms | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!['starter', 'pro', 'business'].includes(String(r.plan))) return null
  const shops = Number(r.shops), team = Number(r.team_members)
  if (!Number.isInteger(shops) || !Number.isInteger(team) || typeof r.limits_until !== 'string' || Number.isNaN(Date.parse(r.limits_until))) return null
  const price = r.monthly_price === null || r.monthly_price === undefined ? null : Number(r.monthly_price)
  return {
    plan: r.plan as LegacyPlan, shops, team_members: team, limits_until: r.limits_until,
    currency: typeof r.currency === 'string' ? r.currency : null, monthly_price: price !== null && price > 0 ? price : null,
    set_at: typeof r.set_at === 'string' ? r.set_at : undefined,
  }
}

/** Limite d'une formule, anciennes limites comprises tant qu'elles valent (même formule, avant la date) ; -1 = illimité */
export function planLimitWithLegacy(planLimit: number, planId: string | null | undefined, terms: LegacyTerms | null, kind: 'shops' | 'team_members', now = new Date()): number {
  if (planLimit === -1) return -1
  if (!terms || terms.plan !== planId || now >= new Date(terms.limits_until)) return planLimit
  return Math.max(planLimit, terms[kind])
}

/** L'entreprise renouvelle-t-elle sans interruption ? (formule payée en cours, ou dans le délai de grâce) */
export function renewsWithoutBreak(planExpiresAt: string | null | undefined, now = new Date()): boolean {
  if (!planExpiresAt) return false
  return new Date(planExpiresAt).getTime() + GRACE_PERIOD_DAYS * 86_400_000 >= now.getTime()
}

/** Prix mensuel à facturer : l'ancien prix garanti s'il s'applique et qu'il est moins cher, sinon le prix du tarif */
export function monthlyPriceFor(
  newPrice: number, planId: string, currency: string, terms: LegacyTerms | null,
  account: { plan?: string | null; plan_expires_at?: string | null } | null, now = new Date(),
): { price: number; locked: boolean } {
  const applies = !!terms && terms.monthly_price !== null && terms.plan === planId && terms.currency === currency
    && account?.plan === planId && renewsWithoutBreak(account?.plan_expires_at, now)
  if (applies && (terms!.monthly_price as number) < newPrice) return { price: terms!.monthly_price as number, locked: true }
  return { price: newPrice, locked: false }
}

/** Conditions d'une entreprise ; colonne absente (migration 205 non appliquée) ou vide → aucune */
export async function getLegacyTerms(admin: any, entityId: string | null | undefined): Promise<LegacyTerms | null> {
  if (!entityId) return null
  const { data, error } = await admin.from('entities').select('legacy_terms').eq('id', entityId).maybeSingle()
  if (error) return null
  return parseLegacyTerms(data?.legacy_terms)
}
