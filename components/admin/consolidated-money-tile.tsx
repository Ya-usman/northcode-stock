'use client'

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { convertByCurrency, type RateMap } from '@/lib/saas/exchange'
import { MoneyByCurrency } from '@/components/admin/money-by-currency'

// ════════════════════════════════════════════════════════════════════════
// KPI CONSOLIDÉ MULTI-DEVISE — Command Center / Analytics / Facturation / Agents
// ════════════════════════════════════════════════════════════════════════
//
// Règle (politique de devise StockShop) : un total qui mélange plusieurs
// devises n'est JAMAIS additionné brut. Chaque montant est converti vers la
// devise de reporting choisie (XAF par défaut) via le moteur FX
// (lib/saas/exchange.ts), puis additionné — précédé de « ≈ » pour signaler
// une conversion de reporting, jamais un montant réel. Le détail par devise
// d'origine reste visible en dessous (aucune donnée perdue).

const TONE_STYLES: Record<'default' | 'success' | 'warning' | 'danger', string> = {
  default: 'text-foreground bg-muted/40',
  success: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  danger:  'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  return `il y a ${days} j`
}

export function ConsolidatedMoneyTile({
  label,
  amounts,
  reportingCurrency,
  rates,
  icon: Icon,
  tone = 'default',
  className,
  showBreakdown = true,
}: {
  label: string
  /** Montants dans leur devise D'ORIGINE — jamais pré-convertis. */
  amounts: Record<string, number> | null | undefined
  reportingCurrency: string
  rates: RateMap
  icon?: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
  /** Ventilation par devise sous le total converti (défaut : oui si 2+ devises). */
  showBreakdown?: boolean
}) {
  const clean: Record<string, number> = {}
  for (const [k, v] of Object.entries(amounts ?? {})) if (Number(v)) clean[k] = Number(v)
  const currencies = Object.keys(clean)

  // Une seule devise d'origine ET c'est déjà la devise de reporting : rien à
  // convertir, on affiche le montant réel tel quel (pas de « ≈ » trompeur).
  if (currencies.length <= 1 && (currencies.length === 0 || currencies[0] === reportingCurrency)) {
    return (
      <div className={cn('rounded-xl border bg-card p-4', className)}>
        <TileHeader label={label} icon={Icon} tone={tone} />
        <div className="mt-1.5">
          <MoneyByCurrency amounts={clean} />
        </div>
      </div>
    )
  }

  const { value, missing, oldest_as_of, worst_freshness } = convertByCurrency(clean, reportingCurrency, rates)
  const uniqueMissing = Array.from(new Set(missing))
  const ago = timeAgo(oldest_as_of)
  const stale = worst_freshness === 'stale' || worst_freshness === 'very_stale'

  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <TileHeader label={label} icon={Icon} tone={tone} />
      <div className="mt-1.5">
        <MoneyByCurrency amounts={{ [reportingCurrency]: value }} approx />
      </div>
      {ago && (
        <p className={cn('text-[11px] mt-1', stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          Taux mis à jour : {ago}
        </p>
      )}
      {uniqueMissing.length > 0 && (
        <p className="text-[11px] mt-1 text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          Non converti (taux manquant) : {uniqueMissing.join(', ')}
        </p>
      )}
      {showBreakdown && currencies.length > 1 && (
        <div className="mt-2 pt-2 border-t border-border/60 space-y-0.5">
          <MoneyByCurrency amounts={clean} size="sm" />
        </div>
      )}
    </div>
  )
}

function TileHeader({ label, icon: Icon, tone }: { label: string; icon?: LucideIcon; tone: 'default' | 'success' | 'warning' | 'danger' }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {Icon && (
        <span className={cn('rounded-lg p-1.5 flex-shrink-0', TONE_STYLES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}
