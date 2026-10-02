// Construction des séries mensuelles pour les graphiques admin (Command
// Center, Analytics) — module séparé (pas dans les page.tsx) pour rester
// testable directement (les fichiers page.tsx de l'App Router n'autorisent
// pas d'exports nommés arbitraires).
//
// Chaque point garde une liste de TRANSACTIONS individuelles (montant +
// devise + SA PROPRE date) — jamais pré-additionnées, ni même pré-groupées
// par devise. La conversion vers la devise de reporting choisie par l'admin
// se fait côté CLIENT, au rendu (RevenueChart / GrowthChart), en résolvant
// le taux de CHAQUE transaction à SA date via un HistoricalRateIndex
// (convertChartSeriesHistorical) — c'est ce qui permet à un point de
// janvier et un point d'août d'utiliser des taux réellement différents.
// Voir la politique de devise StockShop : XAF + NGN + EUR ne sont jamais
// additionnés avant conversion individuelle, et jamais convertis avec le
// taux d'aujourd'hui pour un mois passé.

import type { DatedAmount } from './exchange'

export interface RevenueMonthPoint {
  month: string
  transactions: DatedAmount[]
  count: number
}

export interface GrowthMonthPoint {
  month: string
  newShops: number
  newPayments: number
  transactions: DatedAmount[]
}

/** Revenu des 6 derniers mois (Command Center), ventilé par devise de
 *  facturation réelle de chaque boutique — une transaction par abonnement,
 *  avec sa date réelle (created_at) pour une conversion historique fidèle. */
export function buildRevenueChart(
  subs: Array<{ shop_id: string; amount: number; status: string; created_at: string }>,
  shopCurrencyMap: Record<string, string>,
): RevenueMonthPoint[] {
  const months: RevenueMonthPoint[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
    const matching = subs.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end && s.status === 'active'
    })
    const transactions: DatedAmount[] = matching.map(s => ({
      date: s.created_at.slice(0, 10),
      currency: shopCurrencyMap[s.shop_id] || 'NGN',
      amount: Number(s.amount),
    }))
    months.push({ month: label, transactions, count: matching.length })
  }
  return months
}

/** Croissance 12 mois (Analytics) : nouvelles boutiques, paiements, revenu
 *  ventilé par devise de facturation réelle de chaque boutique — une
 *  transaction par abonnement, avec sa date réelle. */
export function buildMonthlyGrowth(
  shops: Array<{ created_at: string }>,
  subs: Array<{ shop_id: string; amount: number; status: string; created_at: string }>,
  shopCurrencyMap: Record<string, string>,
): GrowthMonthPoint[] {
  const months: GrowthMonthPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)

    const newShops = shops.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end
    }).length

    const monthSubs = subs.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end && s.status === 'active'
    })

    const transactions: DatedAmount[] = monthSubs.map(s => ({
      date: s.created_at.slice(0, 10),
      currency: shopCurrencyMap[s.shop_id] || 'NGN',
      amount: Number(s.amount),
    }))

    months.push({ month: label, newShops, newPayments: monthSubs.length, transactions })
  }
  return months
}
