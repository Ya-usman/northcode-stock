// Admin → Activation (onboarding lot C2) — calculs PURS, testables hors base :
// entonnoir par semaine d'inscription, délais jusqu'au premier produit / à la
// première vente, usage des tours guidés (et étape d'abandon), effet des
// relances e-mail, comptes récents à aider.
//
// Un « compte » = un propriétaire et ses boutiques ; son âge = la date de sa
// plus ancienne boutique (entities.created_at n'est pas fiable : la migration
// 153 a créé toutes les entreprises le 5 oct. 2026).

import { TOUR_IDS, TOURS, type TourId } from '@/lib/onboarding/tours'

export const DAY = 86_400_000
export const COHORT_WEEKS = 8
export const HELP_DAYS = 14
/** Une relance « a marché » si l'action attendue suit dans ce délai */
export const NUDGE_EFFECT_DAYS = 3

export interface ActivationAccount {
  ownerId: string
  ownerName: string | null
  email: string | null
  phone: string | null
  shopId: string
  shopName: string
  shopCount: number
  createdAt: number
  firstProductAt: number | null
  firstSaleAt: number | null
  products: number
  sales: number
  hasCategory: boolean
  hasMember: boolean
  hasReceipt: boolean
  /** Dernier message du support (migration 167) */
  lastContact?: { at: string; channel: 'email' | 'whatsapp'; by: string | null } | null
}

export type FunnelStep = 'product' | 'sale' | 'category' | 'member' | 'receipt'
export const FUNNEL_STEPS: FunnelStep[] = ['product', 'sale', 'category', 'member', 'receipt']
const reached = (a: ActivationAccount, s: FunnelStep) =>
  s === 'product' ? a.firstProductAt !== null : s === 'sale' ? a.firstSaleAt !== null
    : s === 'category' ? a.hasCategory : s === 'member' ? a.hasMember : a.hasReceipt

/** Lundi 00:00 UTC de la semaine d'une date */
export function weekStart(t: number): number {
  const d = new Date(t)
  const day = (d.getUTCDay() + 6) % 7 // lundi = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
}

export interface Cohort { week: number; accounts: number; reached: Record<FunnelStep, number> }

/** Semaines d'inscription, de la plus récente à la plus ancienne (semaines vides comprises) */
export function cohorts(accounts: ActivationAccount[], now: number, weeks = COHORT_WEEKS): Cohort[] {
  const current = weekStart(now)
  return Array.from({ length: weeks }, (_, i) => {
    const week = current - i * 7 * DAY
    const inWeek = accounts.filter(a => weekStart(a.createdAt) === week)
    const r = Object.fromEntries(FUNNEL_STEPS.map(s => [s, inWeek.filter(a => reached(a, s)).length])) as Record<FunnelStep, number>
    return { week, accounts: inWeek.length, reached: r }
  })
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const v = [...values].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Totaux de la période + délais médians (en heures) jusqu'au 1er produit / à la 1re vente */
export function funnelSummary(accounts: ActivationAccount[]) {
  const total = accounts.length
  const reachedCount = Object.fromEntries(FUNNEL_STEPS.map(s => [s, accounts.filter(a => reached(a, s)).length])) as Record<FunnelStep, number>
  const hours = (t: number | null, a: ActivationAccount) => (t === null ? null : Math.max(0, (t - a.createdAt) / 3_600_000))
  return {
    total,
    reached: reachedCount,
    medianHoursToProduct: median(accounts.map(a => hours(a.firstProductAt, a)).filter((h): h is number => h !== null)),
    medianHoursToSale: median(accounts.map(a => hours(a.firstSaleAt, a)).filter((h): h is number => h !== null)),
  }
}

export interface TourStat { tour: TourId; started: number; completed: number; skipped: number; inProgress: number; skippedSteps: { step: string; count: number }[] }

/** Une personne compte une fois par tour, selon son dernier état connu */
export function tourStats(rows: { tours: Record<string, any> | null }[]): TourStat[] {
  return TOUR_IDS.map(tour => {
    const entries = rows.map(r => r.tours?.[tour]).filter(e => e && e.status)
    const steps = new Map<string, number>()
    for (const e of entries) if (e.status === 'skipped' && e.skipped_step) steps.set(e.skipped_step, (steps.get(e.skipped_step) ?? 0) + 1)
    const order = TOURS[tour].map(s => s.id)
    return {
      tour,
      started: entries.length,
      completed: entries.filter(e => e.status === 'completed').length,
      skipped: entries.filter(e => e.status === 'skipped').length,
      inProgress: entries.filter(e => e.status === 'started').length,
      skippedSteps: Array.from(steps.entries()).map(([step, count]) => ({ step, count })).sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step)),
    }
  })
}

export interface NudgeRow { user_id: string; nudge: 'd1' | 'd3' | 'd7'; variant: 'product' | 'sale' | 'help'; sent_at: string }
export interface NudgeStat { nudge: 'd1' | 'd3' | 'd7'; sent: number; acted: number }

/** Envois par relance et « suivis d'effet » : l'action attendue dans les 3 jours */
export function nudgeStats(nudges: NudgeRow[], byOwner: Map<string, ActivationAccount>): NudgeStat[] {
  return (['d1', 'd3', 'd7'] as const).map(nudge => {
    const rows = nudges.filter(n => n.nudge === nudge)
    const acted = rows.filter(n => {
      const a = byOwner.get(n.user_id)
      if (!a) return false
      const from = new Date(n.sent_at).getTime(), to = from + NUDGE_EFFECT_DAYS * DAY
      const inWindow = (t: number | null) => t !== null && t >= from && t <= to
      return n.variant === 'product' ? inWindow(a.firstProductAt) : inWindow(a.firstSaleAt) || inWindow(a.firstProductAt)
    }).length
    return { nudge, sent: rows.length, acted }
  })
}

export type HelpStep = 'product' | 'sale'
export interface HelpRow { account: ActivationAccount; ageDays: number; missing: HelpStep }

/** Comptes de moins de 14 jours sans produit ou sans vente — les plus anciens d'abord (le plus urgent) */
export function accountsToHelp(accounts: ActivationAccount[], now: number): HelpRow[] {
  return accounts
    .filter(a => now - a.createdAt < HELP_DAYS * DAY && (a.firstProductAt === null || a.firstSaleAt === null))
    .map(a => ({ account: a, ageDays: Math.floor((now - a.createdAt) / DAY), missing: (a.firstProductAt === null ? 'product' : 'sale') as HelpStep }))
    .sort((x, y) => y.ageDays - x.ageDays)
}
