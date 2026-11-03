// Options payantes (tarification du 3 nov. 2026, étape 2) — RÈGLE UNIQUE, lue par le serveur (limites, achat,
// renouvellement, confirmation du paiement) et par la page Abonnement.
//
//   • employé en plus et boutique en plus, prix par pays (lib/saas/countries, `addons`) ;
//   • alignées sur l'abonnement : même date de fin, même durée ; au renouvellement, formule + options avec la même remise
//     (6 mois : 2 semaines offertes ; 1 an : 2 mois offerts) ;
//   • achat en cours de période : seulement les jours restants (prorata), au tarif de la durée en cours ; pas d'achat à
//     moins de 3 jours du renouvellement (ajouter l'option au renouvellement) ;
//   • au plus 3 boutiques en tout avec les options (au-delà : offre sur mesure), au plus 20 employés en plus ;
//   • retrait : au prochain renouvellement, sans remboursement (entities.addon_*_renew) ;
//   • pendant l'essai : pas d'options (l'essai a déjà les limites de Pro).
// Colonnes : entities.addon_seats / addon_shops / addon_seats_renew / addon_shops_renew (migration 210).

import { BILLING_PERIODS, getPeriodPrice, type BillingPeriod } from './countries'
import { getCurrency } from './currencies'
import { PLANS, type PlanId } from './plans'

export const MAX_ADDON_SEATS = 20
export const MAX_SHOPS_WITH_ADDONS = 3
export const MIN_PRORATA_DAYS = 3
const DAY = 86_400_000
const PAID_PLANS = ['starter', 'pro', 'business'] as const
type PaidPlan = (typeof PAID_PLANS)[number]

export interface AddonPrices { seat: number; shop: number }
export interface EntityAddons { seats: number; shops: number; seatsRenew: number | null; shopsRenew: number | null }
export const NO_ADDONS: EntityAddons = { seats: 0, shops: 0, seatsRenew: null, shopsRenew: null }

export function isPaidPlan(plan: string | null | undefined): plan is PaidPlan {
  return (PAID_PLANS as readonly string[]).includes(String(plan))
}

/** Boutiques en plus possibles pour une formule : jusqu'à 3 boutiques en tout */
export function maxShopAddons(plan: string | null | undefined): number {
  if (!isPaidPlan(plan)) return 0
  return Math.max(0, Math.min(2, MAX_SHOPS_WITH_ADDONS - PLANS[plan as PlanId].limits.shops))
}

export function parseAddons(row: any): EntityAddons {
  const int = (v: unknown, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0 }
  const opt = (v: unknown, max: number) => (v === null || v === undefined ? null : int(v, max))
  return { seats: int(row?.addon_seats, MAX_ADDON_SEATS), shops: int(row?.addon_shops, 2), seatsRenew: opt(row?.addon_seats_renew, MAX_ADDON_SEATS), shopsRenew: opt(row?.addon_shops_renew, 2) }
}

/** Options qui comptent dans les limites : formule payée seulement (essai, formule inconnue : aucune) */
export function activeAddons(plan: string | null | undefined, a: EntityAddons): { seats: number; shops: number } {
  if (!isPaidPlan(plan)) return { seats: 0, shops: 0 }
  return { seats: a.seats, shops: Math.min(a.shops, maxShopAddons(plan)) }
}

/** Quantités reconduites au renouvellement vers `plan` (retrait programmé appliqué, plafonds de la nouvelle formule) */
export function renewalAddons(a: EntityAddons, plan: string): { seats: number; shops: number } {
  if (!isPaidPlan(plan)) return { seats: 0, shops: 0 }
  const seats = Math.min(MAX_ADDON_SEATS, a.seatsRenew ?? a.seats)
  const shops = Math.min(maxShopAddons(plan), a.shopsRenew ?? a.shops)
  return { seats: Math.max(0, seats), shops: Math.max(0, shops) }
}

/** Prix mensuel des options */
export function addonsMonthly(prices: AddonPrices, seats: number, shops: number): number {
  return seats * prices.seat + shops * prices.shop
}

/** Arrondi à l'unité de la devise, toujours vers le haut (jamais moins que le prorata exact) */
export function roundUpCurrency(amount: number, currency: string): number {
  const d = getCurrency(currency).decimals ?? 2
  const f = 10 ** d
  return Math.ceil(Math.round(amount * f * 1000) / 1000) / f
}

export interface ProrataQuote { days: number; amount: number; until: string }

/**
 * Achat en cours de période : jours restants jusqu'à la fin de l'abonnement, au tarif mensuel de la durée en cours
 * (remise de la durée comprise : un abonné annuel paie 10/12 du prix mensuel). null = achat impossible maintenant
 * (abonnement terminé, ou moins de 3 jours avant le renouvellement).
 */
export function prorataQuote(opts: {
  prices: AddonPrices; seats: number; shops: number; planExpiresAt: string | null | undefined; billingPeriod: BillingPeriod; currency: string; now?: Date
}): ProrataQuote | null {
  const now = opts.now ?? new Date()
  const end = opts.planExpiresAt ? new Date(opts.planExpiresAt).getTime() : NaN
  if (!Number.isFinite(end)) return null
  const days = Math.ceil((end - now.getTime()) / DAY)
  if (days < MIN_PRORATA_DAYS) return null
  const cfg = BILLING_PERIODS[opts.billingPeriod] ?? BILLING_PERIODS.monthly
  const monthlyRate = addonsMonthly(opts.prices, opts.seats, opts.shops) * cfg.paidMonths / cfg.months
  const amount = roundUpCurrency(monthlyRate * days / 30, opts.currency)
  return amount > 0 ? { days, amount, until: new Date(end).toISOString() } : null
}

/** Prix d'une durée, formule + options (même remise de durée) */
export function periodPriceWithAddons(planMonthly: number, prices: AddonPrices, seats: number, shops: number, period: BillingPeriod): number {
  return getPeriodPrice(planMonthly + addonsMonthly(prices, seats, shops), period)
}

/**
 * Conseil : la formule du dessus donne au moins autant (boutiques et employés) pour un prix mensuel proche (au plus
 * 30 % de plus que formule + options). null = rien à conseiller.
 */
export function upgradeAdvice(plan: string, planPrices: Record<PaidPlan, number>, prices: AddonPrices, seats: number, shops: number): { plan: PaidPlan; extraMonthly: number } | null {
  if (!isPaidPlan(plan) || (seats === 0 && shops === 0)) return null
  const next: PaidPlan | null = plan === 'starter' ? 'pro' : plan === 'pro' ? 'business' : null
  if (!next) return null
  const cur = PLANS[plan as PlanId].limits, up = PLANS[next as PlanId].limits
  const covers = up.shops >= cur.shops + shops && up.team_members >= cur.team_members + seats
  const total = planPrices[plan] + addonsMonthly(prices, seats, shops)
  if (!covers || planPrices[next] > total * 1.3) return null
  return { plan: next, extraMonthly: Math.max(0, planPrices[next] - total) }
}

/** Options d'une entreprise (client admin) ; colonnes absentes (210 non appliquée) : aucune */
export async function getEntityAddons(admin: any, entityId: string | null | undefined): Promise<EntityAddons> {
  if (!entityId) return NO_ADDONS
  const { data, error } = await admin.from('entities').select('addon_seats, addon_shops, addon_seats_renew, addon_shops_renew').eq('id', entityId).maybeSingle()
  if (error || !data) return NO_ADDONS
  return parseAddons(data)
}

/** Durée de l'abonnement en cours (dernier abonnement actif d'une boutique de l'entreprise) ; mensuel par défaut */
export async function currentBillingPeriod(admin: any, shopIds: string[]): Promise<BillingPeriod> {
  if (!shopIds.length) return 'monthly'
  const { data } = await admin.from('subscriptions').select('billing_period').in('shop_id', shopIds).eq('status', 'active')
    .order('starts_at', { ascending: false }).limit(1)
  const p = data?.[0]?.billing_period
  return p && p in BILLING_PERIODS ? p as BillingPeriod : 'monthly'
}

/** Renouvellement payé : options de la nouvelle période = celles préparées au paiement ; retrait programmé consommé */
export async function applyRenewalAddons(admin: any, entityId: string, seats: number, shops: number): Promise<void> {
  const { error } = await admin.from('entities').update({
    addon_seats: Math.max(0, Math.min(MAX_ADDON_SEATS, seats)), addon_shops: Math.max(0, Math.min(2, shops)),
    addon_seats_renew: null, addon_shops_renew: null,
  }).eq('id', entityId)
  if (error) console.error('[addons] options du renouvellement non enregistrées', entityId, error.message)
}

/**
 * Achat en cours de période payé : quantités AJOUTÉES (plafonds de la formule), aussi au renouvellement s'il y avait un
 * retrait programmé. Écriture conditionnée aux valeurs lues (deux confirmations simultanées ne s'écrasent pas).
 * Renvoie ce qui a été ajouté (moins que demandé si un plafond est atteint).
 */
export async function addPurchasedAddons(admin: any, entityId: string, plan: string, seats: number, shops: number): Promise<{ seats: number; shops: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row } = await admin.from('entities').select('addon_seats, addon_shops, addon_seats_renew, addon_shops_renew').eq('id', entityId).maybeSingle()
    if (!row) return null
    const cur = parseAddons(row)
    const nextSeats = Math.min(MAX_ADDON_SEATS, cur.seats + seats)
    const nextShops = Math.min(maxShopAddons(plan), cur.shops + shops)
    const added = { seats: nextSeats - cur.seats, shops: Math.max(0, nextShops - cur.shops) }
    const { data: done } = await admin.from('entities').update({
      addon_seats: nextSeats, addon_shops: Math.max(cur.shops, nextShops),
      addon_seats_renew: cur.seatsRenew === null ? null : Math.min(MAX_ADDON_SEATS, cur.seatsRenew + added.seats),
      addon_shops_renew: cur.shopsRenew === null ? null : Math.min(2, cur.shopsRenew + added.shops),
    }).eq('id', entityId).eq('addon_seats', cur.seats).eq('addon_shops', cur.shops).select('id')
    if (done?.length) return added
  }
  return null
}
