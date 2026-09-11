'use client'

import { DollarSign, TrendingUp, TrendingDown, ShoppingBag, UserCheck } from 'lucide-react'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { ReportingCurrencySelect } from '@/components/admin/reporting-currency-select'
import { ConsolidatedMoneyTile } from '@/components/admin/consolidated-money-tile'
import { convertByCurrency } from '@/lib/saas/exchange'
import { formatCurrency } from '@/lib/utils/currency'
import { KpiTile } from '@/components/admin/ui/kpi-tile'

type ByCurrency = Record<string, number>

/**
 * Bloc financier du Command Center : comparatif mensuel + KPI de revenu.
 * Les montants d'abonnement restent stockés et transmis PAR DEVISE
 * d'origine (voir app/[locale]/(admin)/admin/page.tsx) — ce composant les
 * convertit uniquement pour l'AFFICHAGE consolidé, vers la devise de
 * reporting choisie (XAF par défaut, StockShop étant piloté depuis le
 * Cameroun). Jamais de somme brute entre devises.
 */
export function CommandCenterFinancePanel({
  totalByCurrency, thisMonthByCurrency, lastMonthByCurrency, revenueGrowth,
  shopsCount, conversionRate,
  thisMonthSubsCount, lastMonthSubsCount,
  newShopsThisMonth, newShopsLastMonth,
}: {
  totalByCurrency: ByCurrency
  thisMonthByCurrency: ByCurrency
  lastMonthByCurrency: ByCurrency
  revenueGrowth: number
  shopsCount: number
  conversionRate: number
  thisMonthSubsCount: number
  lastMonthSubsCount: number
  newShopsThisMonth: number
  newShopsLastMonth: number
}) {
  const { currency, setCurrency, rates } = useReportingCurrencyContext()

  const pctPayments = lastMonthSubsCount > 0
    ? Math.round(((thisMonthSubsCount - lastMonthSubsCount) / lastMonthSubsCount) * 100)
    : thisMonthSubsCount > 0 ? 100 : 0
  const pctShops = newShopsLastMonth > 0
    ? Math.round(((newShopsThisMonth - newShopsLastMonth) / newShopsLastMonth) * 100)
    : newShopsThisMonth > 0 ? 100 : 0

  const thisMonthConv = convertByCurrency(thisMonthByCurrency, currency, rates)
  const lastMonthConv = convertByCurrency(lastMonthByCurrency, currency, rates)

  const rows: Array<{ label: string; current: string; prev: string; pct: number }> = [
    {
      label: 'Revenue',
      current: `≈ ${formatCurrency(thisMonthConv.value, currency)}`,
      prev: `≈ ${formatCurrency(lastMonthConv.value, currency)}`,
      pct: revenueGrowth,
    },
    { label: 'Paiements reçus', current: `${thisMonthSubsCount}`, prev: `${lastMonthSubsCount}`, pct: pctPayments },
    { label: 'Nouvelles boutiques', current: `${newShopsThisMonth}`, prev: `${newShopsLastMonth}`, pct: pctShops },
  ]

  return (
    <>
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground">Ce mois vs mois précédent</h2>
          <ReportingCurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/50">
          {rows.map(row => {
            const up = row.pct >= 0
            const Icon = up ? TrendingUp : TrendingDown
            return (
              <div key={row.label} className="px-5 py-4">
                <p className="text-xs text-muted-foreground mb-2">{row.label}</p>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xl font-bold text-foreground leading-tight">{row.current}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">vs {row.prev} le mois dernier</p>
                  </div>
                  <div className={`flex items-center gap-1 text-sm font-semibold flex-shrink-0 ${up ? 'text-green-400' : 'text-red-400'}`}>
                    <Icon className="h-4 w-4" />
                    {up ? '+' : ''}{row.pct}%
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ConsolidatedMoneyTile
          label="Revenue total" icon={DollarSign} tone="success"
          amounts={totalByCurrency} reportingCurrency={currency} rates={rates}
        />
        <ConsolidatedMoneyTile
          label="Ce mois-ci" icon={TrendingUp} tone="default"
          amounts={thisMonthByCurrency} reportingCurrency={currency} rates={rates}
          showBreakdown={false}
        />
        <KpiTile icon={ShoppingBag} tone="default" label="Total boutiques" value={shopsCount} />
        <KpiTile icon={UserCheck} tone="default" label="Taux de conversion" value={`${conversionRate}%`} />
      </div>
    </>
  )
}
