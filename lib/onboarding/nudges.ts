// Relances « Bien démarrer » par e-mail — RÈGLES (fonctions pures, testées).
//
// Séquence : J+1, J+3, J+7 après la création du compte, puis plus rien.
//  - compte récent seulement (moins de 14 jours) : les anciens comptes
//    inactifs ne reçoivent rien ;
//  - s'arrête dès que l'étape est faite (produit puis vente) ;
//  - au plus une relance tous les 2 jours ; jamais deux fois la même ;
//  - aucune relance quand l'essai ou l'abonnement se termine dans les 2
//    jours (les e-mails de facturation partent à ce moment-là) ;
//  - jamais après une désinscription, jamais pour un compte interne.

import { createHmac, timingSafeEqual } from 'crypto'

export type NudgeId = 'd1' | 'd3' | 'd7'
export type NudgeVariant = 'product' | 'sale' | 'help'

const DAY = 86_400_000
export const NUDGE_WINDOW_DAYS = 14
const MIN_GAP_MS = 2 * DAY - 2 * 3_600_000 // « 2 jours » à l'heure près (la tâche tourne chaque jour vers la même heure)
const BILLING_QUIET_MS = 2 * DAY

export interface NudgeInput {
  now: Date
  accountCreatedAt: Date
  hasProduct: boolean
  hasSale: boolean
  sent: Partial<Record<NudgeId, Date>>
  unsubscribed: boolean
  internal: boolean
  /** Fin d'essai ou d'abonnement la plus proche (null si inconnue) */
  billingEndsAt: Date | null
  /** Dernier message personnel du support (Admin → Activation) : la relance attend 2 jours */
  lastSupportContactAt?: Date | null
}

export type NudgeDecision = { nudge: NudgeId; variant: NudgeVariant } | { skip: string }

export function decideNudge(x: NudgeInput): NudgeDecision {
  if (x.internal) return { skip: 'internal' }
  if (x.unsubscribed) return { skip: 'unsubscribed' }
  const age = x.now.getTime() - x.accountCreatedAt.getTime()
  if (age >= NUDGE_WINDOW_DAYS * DAY) return { skip: 'account_too_old' }
  if (x.hasProduct && x.hasSale) return { skip: 'activated' }
  const last = Object.values(x.sent).reduce<number>((m, d) => Math.max(m, d ? d.getTime() : 0), 0)
  if (last && x.now.getTime() - last < MIN_GAP_MS) return { skip: 'too_soon' }
  if (x.lastSupportContactAt && x.now.getTime() - x.lastSupportContactAt.getTime() < MIN_GAP_MS) return { skip: 'recent_support_contact' }
  if (x.billingEndsAt) {
    const left = x.billingEndsAt.getTime() - x.now.getTime()
    if (left > -DAY && left < BILLING_QUIET_MS) return { skip: 'billing_quiet' }
  }
  const variant: NudgeVariant = x.hasProduct ? 'sale' : 'product'
  // La plus avancée des relances dues et pas encore envoyées (un compte relancé tard ne reçoit pas J+1 puis J+3 d'affilée)
  if (age >= 7 * DAY && !x.sent.d7) return { nudge: 'd7', variant: 'help' }
  if (age >= 3 * DAY && !x.sent.d3 && !x.sent.d7) return { nudge: 'd3', variant }
  if (age >= 1 * DAY && !x.sent.d1 && !x.sent.d3 && !x.sent.d7 && !x.hasProduct) return { nudge: 'd1', variant: 'product' }
  return { skip: 'nothing_due' }
}

// ── Lien de désinscription signé ────────────────────────────────────────────

function secret(): string {
  const s = process.env.ONBOARDING_UNSUB_SECRET || process.env.CRON_SECRET
  if (!s) throw new Error('Secret de désinscription manquant (ONBOARDING_UNSUB_SECRET ou CRON_SECRET)')
  return s
}

export function unsubscribeToken(userId: string): string {
  return createHmac('sha256', secret()).update(`onboarding-nudges:${userId}`).digest('base64url')
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof token !== 'string' || !token) return false
  const expected = Buffer.from(unsubscribeToken(userId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
