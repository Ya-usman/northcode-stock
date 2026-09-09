import type { LucideIcon } from 'lucide-react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// Carte statistique standard — remplace les cartes dupliquées de Command
// Center / Analytics / Stock (chacune avait son propre balisage Tailwind
// pour la même idée : un nombre, un libellé, une icône, parfois une
// tendance).
interface KpiTileProps {
  label: string
  value: string | number
  icon?: LucideIcon
  /** Variation en % vs. la période précédente — positif = vert, négatif = rouge */
  trend?: number
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}

const TONE_STYLES: Record<NonNullable<KpiTileProps['tone']>, string> = {
  default: 'text-foreground bg-muted/40',
  success: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30',
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  danger:  'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
}

export function KpiTile({ label, value, icon: Icon, trend, tone = 'default', className }: KpiTileProps) {
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
      <p className="text-2xl font-bold text-foreground mt-1.5">{value}</p>
      {trend !== undefined && (
        <div className={cn(
          'flex items-center gap-1 text-xs font-medium mt-1',
          trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        )}>
          {trend >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  )
}
