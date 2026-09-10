import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import { currencySymbol } from '@/lib/saas/currencies'

type Amounts = Record<string, number> | null | undefined

function entries(amounts: Amounts): Array<[string, number]> {
  return Object.entries(amounts ?? {})
    .map(([code, v]) => [code, Number(v) || 0] as [string, number])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1])
}

/**
 * Affiche un ou plusieurs montants regroupés PAR DEVISE — jamais de somme
 * entre devises différentes, jamais de conversion (module Parrainage, V1).
 *   0 devise  → « — »
 *   1 devise  → un seul montant
 *   2+ devises → une ligne par devise (code ISO -> symbole d'affichage)
 */
export function MoneyByCurrency({
  amounts,
  className,
  emptyLabel = '—',
  size = 'lg',
}: {
  amounts: Amounts
  className?: string
  emptyLabel?: string
  size?: 'sm' | 'lg'
}) {
  const rows = entries(amounts)
  const textSize = size === 'lg' ? 'text-2xl' : 'text-sm'

  if (rows.length === 0) {
    return <p className={cn(textSize, 'font-bold text-foreground', className)}>{emptyLabel}</p>
  }
  if (rows.length === 1) {
    const [code, v] = rows[0]
    return <p className={cn(textSize, 'font-bold text-foreground tabular-nums', className)}>{formatCurrency(v, currencySymbol(code))}</p>
  }
  return (
    <div className={cn('space-y-0.5', className)}>
      {rows.map(([code, v]) => (
        <p key={code} className={cn(size === 'lg' ? 'text-base' : 'text-sm', 'font-bold text-foreground tabular-nums')}>
          {formatCurrency(v, currencySymbol(code))}
        </p>
      ))}
    </div>
  )
}

const TONE_STYLES: Record<'default' | 'success' | 'warning' | 'danger', string> = {
  default: 'text-foreground bg-muted/40',
  success: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  danger:  'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
}

/**
 * Carte statistique financière — même habillage que KpiTile mais le corps
 * ventile par devise (MoneyByCurrency). KpiTile (partagé) n'est pas touché.
 */
export function MoneyTile({
  label,
  amounts,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string
  amounts: Amounts
  icon?: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn('rounded-lg p-1.5 flex-shrink-0', TONE_STYLES[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-1.5">
        <MoneyByCurrency amounts={amounts} />
      </div>
    </div>
  )
}
