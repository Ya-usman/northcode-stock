import { getTrialDaysLeft, hasActiveSubscription } from './plans'

// Score de santé 0-100 d'une boutique — activité récente du propriétaire +
// statut de facturation. Extrait de admin/analytics/page.tsx pour être
// réutilisé tel quel par le panneau "Alertes" du Command Center (même
// source de vérité pour "boutiques à risque", pas une seconde formule qui
// pourrait diverger).
export function computeHealthScore(
  shop: { plan: string | null; plan_expires_at: string | null; trial_ends_at: string | null },
  owner: { last_seen?: string | null } | null | undefined
): number {
  const lastSeen = owner?.last_seen ? new Date(owner.last_seen) : null
  const daysSince = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 86400000) : 999
  let score = 0
  if (daysSince <= 7) score += 30
  else if (daysSince <= 14) score += 15
  if (hasActiveSubscription(shop.plan, shop.plan_expires_at)) score += 40
  else if (getTrialDaysLeft(shop.trial_ends_at) >= 0) score += 10
  if (daysSince <= 30) score += 20
  else if (daysSince <= 60) score += 10
  return Math.min(100, score)
}
