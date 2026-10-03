import { hasActiveSubscription } from '@/lib/saas/plans'

// Mention « Généré par StockShop » sur les reçus et tickets : retirée pour les
// boutiques avec un abonnement Pro ou Business ACTIF (avantage des plans
// supérieurs — essai, Starter et abonnement expiré la gardent).
const WHITE_LABEL_PLANS = ['pro', 'business']

export function hideStockShopBranding(shop: { plan?: string | null; plan_expires_at?: string | null } | null | undefined): boolean {
  if (!shop?.plan || !WHITE_LABEL_PLANS.includes(shop.plan)) return false
  return hasActiveSubscription(shop.plan, shop.plan_expires_at ?? null)
}
