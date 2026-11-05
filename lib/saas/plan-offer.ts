// Offre des formules telle qu'elle est PRÉSENTÉE (page d'accueil et page Abonnement, lot 4B du 5 nov. 2026) : une seule
// liste de lignes par formule et un seul tableau de comparaison, tirés des règles réelles (limites : lib/saas/plans ;
// fonctions réservées : lib/saas/plan-feature-rules). Pur, sans import serveur : lu par des pages publiques.
import { PLANS } from './plans'
import { FEATURE_MIN_PLAN, PLAN_RANK, type PlanFeature } from './plan-feature-rules'

export type OfferPlan = 'starter' | 'pro' | 'business'
export const OFFER_PLANS: OfferPlan[] = ['starter', 'pro', 'business']
export const POPULAR_PLAN: OfferPlan = 'pro'

/** Lignes de chaque carte (namespace plan_offer) */
export const PLAN_LINE_KEYS: Record<OfferPlan, string[]> = {
  starter: ['starter_f1', 'starter_f2', 'starter_f3', 'starter_f4', 'starter_f5', 'starter_f6'],
  pro: ['pro_f1', 'pro_f2', 'pro_f3', 'pro_f4', 'pro_f5', 'pro_f6'],
  business: ['business_f1', 'business_f2', 'business_f3', 'business_f4', 'business_f5', 'business_f6'],
}

export function featureIncluded(plan: OfferPlan, feature: PlanFeature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]]
}

export type CompareCell =
  | { kind: 'count'; value: number }
  | { kind: 'text'; key: 'history_3m' | 'history_1y' | 'history_all' | 'addon_optional' }
  | { kind: 'bool'; value: boolean }

export type CompareRow = 'shops' | 'seats' | 'history' | 'transfers' | 'po_email' | 'exports' | 'support' | 'addons'
export const COMPARE_ROWS: CompareRow[] = ['shops', 'seats', 'history', 'transfers', 'po_email', 'exports', 'support', 'addons']

export function compareCell(row: CompareRow, plan: OfferPlan): CompareCell {
  switch (row) {
    case 'shops': return { kind: 'count', value: PLANS[plan].limits.shops }
    case 'seats': return { kind: 'count', value: PLANS[plan].limits.team_members }
    case 'history': return { kind: 'text', key: featureIncluded(plan, 'unlimited_history') ? 'history_all' : featureIncluded(plan, 'long_reports') ? 'history_1y' : 'history_3m' }
    case 'transfers': return { kind: 'bool', value: featureIncluded(plan, 'transfers') }
    case 'po_email': return { kind: 'bool', value: featureIncluded(plan, 'po_email') }
    case 'exports': return { kind: 'bool', value: featureIncluded(plan, 'exports') }
    case 'support': return { kind: 'bool', value: featureIncluded(plan, 'priority_support') }
    // Options payantes : toutes les formules (boutiques plafonnées à 3 en tout, au-delà = sur mesure)
    case 'addons': return { kind: 'text', key: 'addon_optional' }
  }
}

/** Pays de départ de la section Tarifs : celui transmis par l'hébergeur s'il est connu, sinon celui de la langue.
 *  AFFICHAGE SEULEMENT : le prix payé est calculé par le serveur (lib/saas/pricing-country). */
export function defaultPricingCountry(locale: string, geo: string | null | undefined, known: (code: string) => boolean): string {
  const g = (geo || '').toUpperCase()
  if (/^[A-Z]{2}$/.test(g) && known(g)) return g
  return locale === 'fr' ? 'CM' : 'NG'
}
