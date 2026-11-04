// Changements de formule sans perte (tarification, étape 4A-1, décisions du 4 nov. 2026) — RÈGLE UNIQUE, lue par le
// serveur (paiement préparé, confirmation, renouvellement automatique, bascule programmée) et par la page Abonnement.
//
//   • même formule, abonnement en cours → « stack » : la nouvelle période commence à la fin de l'actuelle ;
//   • formule supérieure, abonnement en cours → « now » : immédiat, avec un crédit pour les jours payés non utilisés ;
//   • formule inférieure, abonnement en cours → « next » : payée maintenant, appliquée à la fin de la période payée ;
//   • sinon (essai, abonnement terminé) → « now », sans crédit.
// Changement programmé : entities.next_plan / next_plan_from / next_plan_until (+ durée, options), migration 212.

import { getCurrency } from './currencies'

export type Schedule = 'now' | 'stack' | 'next'
const RANK: Record<string, number> = { starter: 1, pro: 2, business: 3 }
const DAY = 86_400_000

export interface CurrentPlan { plan: string | null | undefined; plan_expires_at: string | null | undefined }
export interface NextPlan {
  next_plan?: string | null; next_plan_from?: string | null; next_plan_until?: string | null
  next_billing_period?: string | null; next_addon_seats?: number | null; next_addon_shops?: number | null
}

/** Abonnement payé en cours ? */
export function isActivePaid(c: CurrentPlan, now = new Date()): boolean {
  return !!c.plan && c.plan in RANK && !!c.plan_expires_at && new Date(c.plan_expires_at).getTime() > now.getTime()
}

/** Comment appliquer un paiement de formule `target` */
export function classifyChange(c: CurrentPlan, target: string, now = new Date()): Schedule {
  if (!isActivePaid(c, now)) return 'now'
  const a = RANK[String(c.plan)], b = RANK[target]
  if (b === a) return 'stack'
  return b > a ? 'now' : 'next'
}

/** Période d'un paiement : début (maintenant, ou fin de la période en cours) et fin */
export function periodFor(schedule: Schedule, c: CurrentPlan, days: number, now = new Date()): { start: Date; end: Date } {
  const start = schedule !== 'now' && c.plan_expires_at && new Date(c.plan_expires_at).getTime() > now.getTime() ? new Date(c.plan_expires_at) : now
  return { start, end: new Date(start.getTime() + days * DAY) }
}

/**
 * Crédit d'une montée : part non utilisée du dernier paiement de la période en cours (au prorata du temps), arrondie
 * à l'unité de la devise VERS LE BAS (jamais plus que ce qui a été payé). 0 si rien d'exploitable.
 */
export function unusedCredit(sub: { amount: number | string | null; starts_at: string | null; expires_at: string | null } | null, currency: string, now = new Date()): number {
  if (!sub?.starts_at || !sub.expires_at) return 0
  const paid = Number(sub.amount), start = new Date(sub.starts_at).getTime(), end = new Date(sub.expires_at).getTime()
  if (!(paid > 0) || !(end > start) || end <= now.getTime()) return 0
  const ratio = Math.min(1, (end - Math.max(now.getTime(), start)) / (end - start))
  const f = 10 ** (getCurrency(currency).decimals ?? 2)
  return Math.max(0, Math.min(paid, Math.floor(paid * ratio * f) / f))
}

/** Vue de l'abonnement en tenant compte d'un changement programmé arrivé à sa date (avant même son écriture) */
export function effectivePlan<T extends CurrentPlan & NextPlan>(e: T, now = new Date()): T & { switched: boolean } {
  if (e.next_plan && e.next_plan_from && e.next_plan_until && new Date(e.next_plan_from).getTime() <= now.getTime())
    return { ...e, plan: e.next_plan, plan_expires_at: e.next_plan_until, switched: true }
  return { ...e, switched: false }
}

/** Un changement est-il programmé (et pas encore arrivé) ? */
export function pendingChange(e: NextPlan, now = new Date()): { plan: string; from: string } | null {
  if (!e.next_plan || !e.next_plan_from || new Date(e.next_plan_from).getTime() <= now.getTime()) return null
  return { plan: e.next_plan, from: e.next_plan_from }
}

/** Est-ce une descente (formule inférieure) ? */
export function isDowngrade(from: string | null | undefined, to: string | null | undefined): boolean {
  return !!from && !!to && from in RANK && to in RANK && RANK[to] < RANK[from]
}

export const NEXT_COLUMNS = 'next_plan, next_plan_from, next_plan_until, next_billing_period, next_addon_seats, next_addon_shops'
export const CLEAR_NEXT = { next_plan: null, next_plan_from: null, next_plan_until: null, next_billing_period: null, next_addon_seats: null, next_addon_shops: null }
