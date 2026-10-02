'use client'

import { useMemo } from 'react'
import { Wallet } from 'lucide-react'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { ReportingCurrencySelect } from '@/components/admin/reporting-currency-select'
import { ConsolidatedMoneyTile } from '@/components/admin/consolidated-money-tile'
import { useHistoricalExchangeRates } from '@/lib/hooks/use-historical-exchange-rates'
import type { DatedAmount } from '@/lib/saas/exchange'

/**
 * KPI « Revenue total » d'Analytics — converti vers la devise de reporting
 * choisie (XAF par défaut), taux HISTORIQUE de la date de CHAQUE transaction
 * (même méthode que le « Revenue total » du Command Center — cohérence
 * entre les deux pages sur les mêmes données). Voir consolidated-money-tile.tsx.
 */
export function AnalyticsRevenuePanel({ transactions }: { transactions: DatedAmount[] }) {
  const { currency, setCurrency } = useReportingCurrencyContext()

  const { from, to } = useMemo(() => {
    const dates = transactions.map((t) => t.date).sort()
    const today = new Date().toISOString().slice(0, 10)
    return { from: dates[0] ?? today, to: today }
  }, [transactions])
  const { index } = useHistoricalExchangeRates(from, to)

  return (
    <div className="space-y-1.5">
      <ReportingCurrencySelect value={currency} onChange={setCurrency} className="justify-end w-full" />
      <ConsolidatedMoneyTile
        label="Revenue total" icon={Wallet} tone="success"
        transactions={transactions} historicalIndex={index} reportingCurrency={currency}
      />
    </div>
  )
}
