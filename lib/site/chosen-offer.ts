// Formule choisie sur la page Tarifs, transmise à l'inscription puis proposée en premier à la fin de l'essai (lot D du
// 7 nov. 2026). Simple PRÉFÉRENCE d'affichage : aucun prix ni droit n'en dépend (le paiement est calculé par le
// serveur). Gardée dans le compte (user_metadata.chosen_offer, écrit par /api/register) et sur l'appareil (inscription
// avec Google, où le formulaire n'est pas envoyé).
import { OFFERED_PERIODS, type BillingPeriod } from '@/lib/saas/countries'
import { OFFER_PLANS, type OfferPlan } from '@/lib/saas/plan-offer'

export interface ChosenOffer { plan: OfferPlan; period: BillingPeriod }

export const CHOSEN_OFFER_KEY = 'stockshop_chosen_offer'

/** Formule et durée valides seulement (formules proposées, durées proposées) ; durée absente = mensuel. */
export function parseChosenOffer(plan: unknown, period?: unknown): ChosenOffer | null {
  if (typeof plan !== 'string' || !(OFFER_PLANS as string[]).includes(plan)) return null
  const p = typeof period === 'string' && (OFFERED_PERIODS as string[]).includes(period) ? period as BillingPeriod : 'monthly'
  return { plan: plan as OfferPlan, period: p }
}

export function readStoredOffer(): ChosenOffer | null {
  try { const v = JSON.parse(localStorage.getItem(CHOSEN_OFFER_KEY) || 'null'); return v ? parseChosenOffer(v.plan, v.period) : null } catch { return null }
}

export function storeOffer(o: ChosenOffer) {
  try { localStorage.setItem(CHOSEN_OFFER_KEY, JSON.stringify(o)) } catch { /* stockage indisponible : le compte garde le choix */ }
}

export const planName = (p: OfferPlan) => p.charAt(0).toUpperCase() + p.slice(1)
