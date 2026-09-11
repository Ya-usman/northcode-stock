'use client'

import { CURRENCY_LIST } from '@/lib/saas/currencies'
import { cn } from '@/lib/utils/cn'

/**
 * Sélecteur de devise de reporting admin — XAF par défaut (StockShop est
 * piloté depuis le Cameroun), modifiable temporairement par l'admin,
 * préférence retenue par navigateur (voir lib/hooks/use-reporting-currency).
 * Ne touche JAMAIS aux montants réels — affichage consolidé uniquement.
 */
export function ReportingCurrencySelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (code: string) => void
  className?: string
}) {
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span className="hidden sm:inline">Devise de reporting</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-stockshop-blue/40"
      >
        {CURRENCY_LIST.map((c) => (
          <option key={c.code} value={c.code}>{c.code} — {c.label}</option>
        ))}
      </select>
    </label>
  )
}
