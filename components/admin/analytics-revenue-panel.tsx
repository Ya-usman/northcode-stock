'use client'

import { Wallet } from 'lucide-react'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { ReportingCurrencySelect } from '@/components/admin/reporting-currency-select'
import { ConsolidatedMoneyTile } from '@/components/admin/consolidated-money-tile'

/**
 * KPI « Revenue total » d'Analytics — converti vers la devise de reporting
 * choisie (XAF par défaut). Voir components/admin/consolidated-money-tile.tsx.
 */
export function AnalyticsRevenuePanel({ revenueByCurrency }: { revenueByCurrency: Record<string, number> }) {
  const { currency, setCurrency, rates } = useReportingCurrencyContext()

  return (
    <div className="space-y-1.5">
      <ReportingCurrencySelect value={currency} onChange={setCurrency} className="justify-end w-full" />
      <ConsolidatedMoneyTile
        label="Revenue total" icon={Wallet} tone="success"
        amounts={revenueByCurrency} reportingCurrency={currency} rates={rates}
      />
    </div>
  )
}
