'use client'

import { Wallet } from 'lucide-react'
import { useReportingCurrencyContext } from '@/components/admin/reporting-currency-context'
import { ReportingCurrencySelect } from '@/components/admin/reporting-currency-select'
import { ConsolidatedMoneyTile } from '@/components/admin/consolidated-money-tile'
import { convertByCurrency } from '@/lib/saas/exchange'
import { formatCurrency } from '@/lib/utils/currency'

/** KPI « Revenus collectés » de Facturation — converti vers la devise de
 *  reporting choisie (XAF par défaut), partagée avec GatewayRevenueAmount
 *  ci-dessous via ReportingCurrencyProvider. */
export function PaymentsRevenuePanel({ revenueByCurrency }: { revenueByCurrency: Record<string, number> }) {
  const { currency, setCurrency, rates } = useReportingCurrencyContext()

  return (
    <div className="space-y-1.5">
      <ReportingCurrencySelect value={currency} onChange={setCurrency} className="justify-end w-full" />
      <ConsolidatedMoneyTile
        label="Revenus collectés" icon={Wallet} tone="success"
        amounts={revenueByCurrency} reportingCurrency={currency} rates={rates}
      />
    </div>
  )
}

/** Montant d'une ligne « Répartition par fournisseur » — même devise de
 *  reporting que le KPI ci-dessus (contexte partagé, pas de hook isolé :
 *  sinon changer la devise ne mettrait à jour que le composant qui possède
 *  le sélecteur). */
export function GatewayRevenueAmount({ byCurrency }: { byCurrency: Record<string, number> }) {
  const { currency, rates } = useReportingCurrencyContext()
  const codes = Object.keys(byCurrency).filter((c) => byCurrency[c])

  if (codes.length === 0) return <span className="text-sm font-bold text-green-400">—</span>
  if (codes.length === 1 && codes[0] === currency) {
    return <span className="text-sm font-bold text-green-400">{formatCurrency(byCurrency[codes[0]], currency)}</span>
  }
  const { value } = convertByCurrency(byCurrency, currency, rates)
  return <span className="text-sm font-bold text-green-400">≈ {formatCurrency(value, currency)}</span>
}
