// Construction des séries mensuelles pour les graphiques admin (Command
// Center, Analytics) — module séparé (pas dans les page.tsx) pour rester
// testable directement (les fichiers page.tsx de l'App Router n'autorisent
// pas d'exports nommés arbitraires).
//
// Chaque point garde ses montants PAR DEVISE d'origine (`byCurrency`) —
// jamais pré-additionnés entre devises. La conversion vers la devise de
// reporting choisie par l'admin se fait côté CLIENT, au rendu
// (RevenueChart / GrowthChart, via convertChartSeries), avec les mêmes
// taux que les KPI consolidés (ConsolidatedMoneyTile). Voir la politique de
// devise StockShop : XAF + NGN + EUR ne sont jamais additionnés avant
// conversion individuelle.

export interface RevenueMonthPoint {
  month: string
  byCurrency: Record<string, number>
  count: number
}

export interface GrowthMonthPoint {
  month: string
  newShops: number
  newPayments: number
  byCurrency: Record<string, number>
}

/** Revenu des 6 derniers mois (Command Center), ventilé par devise de
 *  facturation réelle de chaque boutique. */
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
    const byCurrency: Record<string, number> = {}
    for (const s of matching) {
      const code = shopCurrencyMap[s.shop_id] || 'NGN'
      byCurrency[code] = (byCurrency[code] || 0) + Number(s.amount)
    }
    months.push({ month: label, byCurrency, count: matching.length })
  }
  return months
}

/** Croissance 12 mois (Analytics) : nouvelles boutiques, paiements, revenu
 *  ventilé par devise de facturation réelle de chaque boutique. */
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

    const byCurrency: Record<string, number> = {}
    for (const s of monthSubs) {
      const code = shopCurrencyMap[s.shop_id] || 'NGN'
      byCurrency[code] = (byCurrency[code] || 0) + Number(s.amount)
    }

    months.push({ month: label, newShops, newPayments: monthSubs.length, byCurrency })
  }
  return months
}
