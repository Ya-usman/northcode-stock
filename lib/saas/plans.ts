export type PlanId = 'trial' | 'starter' | 'pro' | 'business'

export interface PlanLimits {
  products: number       // -1 = unlimited
  team_members: number   // -1 = unlimited
  history_days: number   // -1 = unlimited
}

export interface Plan {
  id: PlanId
  name: string
  price_monthly: number  // in Naira, 0 = free
  limits: PlanLimits
  features: {
    reports: boolean
    export_csv: boolean
    export_pdf: boolean
    whatsapp_receipts: boolean
    multi_cashier: boolean
    stock_management: boolean
    priority_support: boolean
  }
  paystack_plan_code?: string
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    price_monthly: 0,
    limits: { products: 50, team_members: 2, history_days: 30 },
    features: {
      reports: true,
      export_csv: false,
      export_pdf: false,
      whatsapp_receipts: false,
      multi_cashier: true,
      stock_management: true,
      priority_support: false,
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price_monthly: 4999,
    limits: { products: 200, team_members: 3, history_days: 90 },
    features: {
      reports: true,
      export_csv: true,
      export_pdf: true,
      whatsapp_receipts: false,
      multi_cashier: true,
      stock_management: true,
      priority_support: false,
    },
    paystack_plan_code: process.env.PAYSTACK_PLAN_STARTER,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_monthly: 9999,
    limits: { products: -1, team_members: 10, history_days: 365 },
    features: {
      reports: true,
      export_csv: true,
      export_pdf: true,
      whatsapp_receipts: true,
      multi_cashier: true,
      stock_management: true,
      priority_support: false,
    },
    paystack_plan_code: process.env.PAYSTACK_PLAN_PRO,
  },
  business: {
    id: 'business',
    name: 'Business',
    price_monthly: 19999,
    limits: { products: -1, team_members: -1, history_days: -1 },
    features: {
      reports: true,
      export_csv: true,
      export_pdf: true,
      whatsapp_receipts: true,
      multi_cashier: true,
      stock_management: true,
      priority_support: true,
    },
    paystack_plan_code: process.env.PAYSTACK_PLAN_BUSINESS,
  },
}

// ---------------------------------------------------------------
// Période d'accès gratuit : 13 avril → 13 juillet 2026
// Durant cette période, tout le monde a accès complet sans abonnement.
// Après, le mur d'abonnement s'active normalement.
// ---------------------------------------------------------------
const BETA_START = new Date('2026-04-13T00:00:00Z')
const BETA_END   = new Date('2026-07-13T00:00:00Z')

/** True si on est actuellement dans la période d'accès gratuit bêta */
export function isBetaPeriod(): boolean {
  const now = new Date()
  return now >= BETA_START && now < BETA_END
}

/** Nombre de jours restants dans la période bêta (0 si terminée) */
export function betaDaysLeft(): number {
  if (!isBetaPeriod()) return 0
  return Math.ceil((BETA_END.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export function getPlan(planId: string | null | undefined): Plan {
  return PLANS[(planId as PlanId) ?? 'trial'] ?? PLANS.trial
}

/** Returns trial days remaining (negative = expired) */
export function getTrialDaysLeft(trialEndsAt: string | null | undefined): number {
  if (!trialEndsAt) return -1
  const diff = new Date(trialEndsAt).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** Returns true if the shop has an active paid subscription */
export function hasActiveSubscription(planId: string | null, planExpiresAt: string | null): boolean {
  if (!planId || planId === 'trial' || planId === 'free') return false
  if (!planExpiresAt) return false
  return new Date(planExpiresAt) > new Date()
}

/** Returns true if shop can still use the app */
export function isAccessAllowed(
  planId: string | null,
  trialEndsAt: string | null,
  planExpiresAt: string | null,
): boolean {
  // Accès gratuit universel pendant la période bêta
  if (isBetaPeriod()) return true
  if (hasActiveSubscription(planId, planExpiresAt)) return true
  return getTrialDaysLeft(trialEndsAt) >= 0
}

export function formatPrice(naira: number): string {
  return `₦${naira.toLocaleString('en-NG')}/mo`
}
