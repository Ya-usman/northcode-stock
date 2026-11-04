// Offre sur mesure (tarification du 3-4 nov. 2026, étape 3) — RÈGLE UNIQUE, lue par le serveur (demande, devis,
// paiement, limites) et par les écrans (page Abonnement, page du devis, administration).
//
//   • à partir de 4 boutiques (ou au-delà de 20 employés en plus sur Business) ;
//   • prix conseillé = Business + boutiques au-delà de 3 + employés au-delà de 8, aux prix des options du pays ;
//   • devis valable 15 jours (prolongeable par l'administration) ; une seule demande ouverte à la fois ;
//   • premier paiement : devis envoyé et encore valable ; ensuite, même prix garanti 1 an (renouvellement depuis la page
//     Abonnement), puis nouveau devis ;
//   • payé : formule Business avec les limites du devis (entities.custom_shops / custom_seats, migration 211).

import { getPeriodPrice, type BillingPeriod } from './countries'
import { PLANS } from './plans'
import type { AddonPrices } from './addons'

export const QUOTE_VALID_DAYS = 15
export const PRICE_GUARANTEE_DAYS = 365
export const CUSTOM_MIN_SHOPS = 4
const DAY = 86_400_000
const BUSINESS = PLANS.business.limits

export type QuoteStatus = 'requested' | 'quoted' | 'paid' | 'declined' | 'expired' | 'cancelled'
export interface QuoteRow {
  id: string; entity_id: string; status: QuoteStatus
  req_shops: number; req_seats: number; req_period: BillingPeriod
  monthly_price: number | null; billing_period: BillingPeriod | null; period_total: number | null; currency: string | null
  limit_shops: number | null; limit_seats: number | null; valid_until: string | null; price_until: string | null; token: string | null
}

/** L'offre sur mesure s'adresse-t-elle à ce besoin ? (sinon formules et options suffisent) */
export function needsCustom(shops: number, seats: number): boolean {
  return shops >= CUSTOM_MIN_SHOPS || seats > BUSINESS.team_members + 20
}

/** Prix mensuel conseillé dans la devise du pays */
export function suggestedMonthly(businessPrice: number, prices: AddonPrices, shops: number, seats: number): number {
  return businessPrice + Math.max(0, shops - BUSINESS.shops) * prices.shop + Math.max(0, seats - BUSINESS.team_members) * prices.seat
}

/** Total d'un devis pour sa durée (même remise que les formules : 6 mois = 5,5 mois payés, 1 an = 10 mois payés) */
export function quoteTotal(monthly: number, period: BillingPeriod): number {
  return getPeriodPrice(monthly, period)
}

/** État affiché : un devis envoyé dont la validité est passée est « expiré » même avant le passage de la tâche du matin */
export function quoteState(q: Pick<QuoteRow, 'status' | 'valid_until'>, now = new Date()): QuoteStatus {
  if (q.status === 'quoted' && q.valid_until && new Date(q.valid_until).getTime() <= now.getTime()) return 'expired'
  return q.status
}

/**
 * Ce devis peut-il être payé maintenant ? Premier paiement : envoyé et valable. Renouvellement : déjà payé, prix encore
 * garanti, et c'est bien l'offre en cours de l'entreprise.
 */
export function quotePayable(q: QuoteRow, entityCustomQuoteId: string | null | undefined, now = new Date()): 'first' | 'renewal' | null {
  if (!q.monthly_price || !q.period_total || !q.billing_period || !q.currency || !q.limit_shops) return null
  if (quoteState(q, now) === 'quoted') return 'first'
  if (q.status === 'paid' && q.price_until && new Date(q.price_until).getTime() > now.getTime() && entityCustomQuoteId === q.id) return 'renewal'
  return null
}

/** Limite d'une formule avec l'offre sur mesure de l'entreprise (Business seulement) ; -1 = illimité */
export function customLimit(planLimit: number, plan: string | null | undefined, custom: { shops: number | null; seats: number | null } | null, kind: 'shops' | 'team_members'): number {
  if (planLimit === -1 || plan !== 'business' || !custom) return planLimit
  const v = kind === 'shops' ? custom.shops : custom.seats
  return v === null || v === undefined ? planLimit : Math.max(planLimit, v)
}

/** Limites sur mesure d'une entreprise (client admin) ; colonnes absentes (211 non appliquée) : aucune */
export async function getEntityCustom(admin: any, entityId: string | null | undefined): Promise<{ shops: number | null; seats: number | null; quoteId: string | null } | null> {
  if (!entityId) return null
  const { data, error } = await admin.from('entities').select('custom_shops, custom_seats, custom_quote_id').eq('id', entityId).maybeSingle()
  if (error || !data || (data.custom_shops == null && data.custom_seats == null)) return null
  return { shops: data.custom_shops ?? null, seats: data.custom_seats ?? null, quoteId: data.custom_quote_id ?? null }
}

export function addDays(d: Date, days: number): Date { return new Date(d.getTime() + days * DAY) }

/** Rappel au client : devis envoyé qui expire dans 3 jours ou moins (une fois, clé « expiry ») */
export function quoteExpiryReminderDue(q: Pick<QuoteRow, 'id' | 'status' | 'valid_until'>, sentKeys: Set<string>, now = new Date()): string | null {
  if (q.status !== 'quoted' || !q.valid_until) return null
  const end = new Date(q.valid_until).getTime()
  if (!(end > now.getTime() && end <= now.getTime() + 3 * DAY)) return null
  const key = `${q.id}:expiry`
  return sentKeys.has(key) ? null : key
}

/** Alerte à l'équipe : prix garanti qui prend fin dans 30 jours ou moins (une fois, clé « review ») */
export function priceReviewDue(q: Pick<QuoteRow, 'id' | 'status' | 'price_until'>, sentKeys: Set<string>, now = new Date()): string | null {
  if (q.status !== 'paid' || !q.price_until) return null
  const end = new Date(q.price_until).getTime()
  if (!(end > now.getTime() && end <= now.getTime() + 30 * DAY)) return null
  const key = `${q.id}:review`
  return sentKeys.has(key) ? null : key
}
