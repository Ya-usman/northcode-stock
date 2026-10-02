'use client'

import { useMemo } from 'react'
import { DollarSign, TrendingUp, TrendingDown, ShoppingBag, UserCheck } from 'lucide-react'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { ReportingCurrencySelect } from '@/components/admin/reporting-currency-select'
import { ConsolidatedMoneyTile } from '@/components/admin/consolidated-money-tile'
import { useHistoricalExchangeRates } from '@/lib/hooks/use-historical-exchange-rates'
import { convertTransactionsAt, type DatedAmount } from '@/lib/saas/exchange'
import { formatCurrency } from '@/lib/utils/currency'
import { KpiTile } from '@/components/admin/ui/kpi-tile'

/**
 * Bloc financier du Command Center : comparatif mensuel + KPI de revenu.
 * Les montants d'abonnement restent stockés et transmis PAR TRANSACTION,
 * chacune avec SA propre date (voir app/[locale]/(admin)/admin/page.tsx) —
 * ce composant les convertit uniquement pour l'AFFICHAGE consolidé, vers la
 * devise de reporting choisie (XAF par défaut), avec le taux HISTORIQUE de
 * la date de CHAQUE transaction (comparaison N vs N-1 : chaque mois garde
 * SES propres taux, jamais celui d'aujourd'hui appliqué rétroactivement).
 * Jamais de somme brute entre devises.
 */
export function CommandCenterFinancePanel({
  totalTransactions, thisMonthTransactions, lastMonthTransactions,
  shopsCount, conversionRate,
  thisMonthSubsCount, lastMonthSubsCount,
  newShopsThisMonth, newShopsLastMonth,
}: {
  totalTransactions: DatedAmount[]
  thisMonthTransactions: DatedAmount[]
  lastMonthTransactions: DatedAmount[]
  shopsCount: number
  conversionRate: number
  thisMonthSubsCount: number
  lastMonthSubsCount: number
  newShopsThisMonth: number
  newShopsLastMonth: number
}) {
  const { currency, setCurrency } = useReportingCurrencyContext()

  // Fenêtre bornée aux vraies dates de transactions (jamais une plage
  // arbitraire plus large) — du plus ancien paiement connu à aujourd'hui.
  const { from, to } = useMemo(() => {
    const dates = totalTransactions.map((t) => t.date).sort()
    const today = new Date().toISOString().slice(0, 10)
    return { from: dates[0] ?? today, to: today }
  }, [totalTransactions])
  const { index, loading } = useHistoricalExchangeRates(from, to)

  const pctPayments = lastMonthSubsCount > 0
    ? Math.round(((thisMonthSubsCount - lastMonthSubsCount) / lastMonthSubsCount) * 100)
    : thisMonthSubsCount > 0 ? 100 : 0
  const pctShops = newShopsLastMonth > 0
    ? Math.round(((newShopsThisMonth - newShopsLastMonth) / newShopsLastMonth) * 100)
    : newShopsThisMonth > 0 ? 100 : 0

  const thisMonthConv = index ? convertTransactionsAt(thisMonthTransactions, currency, index) : null
  const lastMonthConv = index ? convertTransactionsAt(lastMonthTransactions, currency, index) : null
  // Croissance calculée à partir des MÊMES valeurs converties affichées
  // juste à côté (jamais une somme brute séparée qui pourrait diverger) —
  // chaque mois garde le taux historique de SES propres transactions.
  const revenueGrowth = lastMonthConv && lastMonthConv.value > 0
    ? Math.round(((thisMonthConv!.value - lastMonthConv.value) / lastMonthConv.value) * 100)
    : (thisMonthConv?.value ?? 0) > 0 ? 100 : 0

  const rows: Array<{ label: string; current: string; prev: string; pct: number }> = [
    {
      label: 'Revenue',
      current: loading ? '…' : `≈ ${formatCurrency(thisMonthConv?.value ?? 0, currency)}`,
      prev: loading ? '…' : `≈ ${formatCurrency(lastMonthConv?.value ?? 0, currency)}`,
      pct: revenueGrowth,
    },
    { label: 'Paiements reçus', current: `${thisMonthSubsCount}`, prev: `${lastMonthSubsCount}`, pct: pctPayments },
    { label: 'Nouvelles boutiques', current: `${newShopsThisMonth}`, prev: `${newShopsLastMonth}`, pct: pctShops },
  ]

  const anyFallback = (thisMonthConv?.usedFallback || lastMonthConv?.usedFallback) ?? false

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
        {anyFallback && (
          <p className="px-5 pb-3 text-[11px] text-amber-600 dark:text-amber-400">
            ↺ Comparatif calculé avec un taux de repli pour au moins une transaction (dernier taux connu avant sa date).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ConsolidatedMoneyTile
          label="Revenue total" icon={DollarSign} tone="success"
          transactions={totalTransactions} historicalIndex={index} reportingCurrency={currency}
        />
        <ConsolidatedMoneyTile
          label="Ce mois-ci" icon={TrendingUp} tone="default"
          transactions={thisMonthTransactions} historicalIndex={index} reportingCurrency={currency}
          showBreakdown={false}
        />
        <KpiTile icon={ShoppingBag} tone="default" label="Total boutiques" value={shopsCount} />
        <KpiTile icon={UserCheck} tone="default" label="Taux de conversion" value={`${conversionRate}%`} />
      </div>
    </>
  )
}
