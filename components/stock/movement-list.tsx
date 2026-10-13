'use client'

import { useLocale, useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { ArrowDown, ArrowRight, ArrowUp, ClipboardCheck, ShoppingCart } from 'lucide-react'
import { dateFnsLocale, dateTimePattern } from '@/lib/i18n/date-format'
import { movementReasonText } from '@/lib/stock/movement-reason'
import { cn } from '@/lib/utils/cn'

// Liste chronologique des mouvements de stock d'UN produit (entrées, ventes,
// sorties, ajustements), telle que la base les a enregistrés. Utilisée par la
// fiche produit (10 derniers) et par l'onglet Mouvements filtré sur un produit.

export interface MovementLike {
  id: string
  type: string
  quantity: number
  previous_qty: number | null
  new_qty: number | null
  reason: string | null
  created_at: string
  performed_by_name: string | null
}

const KIND: Record<string, { icon: typeof ArrowDown; tone: string; labelKey: string; sign: 1 | -1 | 0 }> = {
  in: { icon: ArrowDown, tone: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400', labelKey: 'type_entry', sign: 1 },
  sale: { icon: ShoppingCart, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400', labelKey: 'type_sale', sign: -1 },
  out: { icon: ArrowUp, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400', labelKey: 'type_out', sign: -1 },
  adjustment: { icon: ClipboardCheck, tone: 'bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400', labelKey: 'type_adjustment', sign: 0 },
}

/** Variation réelle du stock : après − avant quand la base les a notés, sinon le sens du type. null = inconnue. */
export function movementDelta(m: Pick<MovementLike, 'type' | 'quantity' | 'previous_qty' | 'new_qty'>): number | null {
  if (m.previous_qty != null && m.new_qty != null) return Number(m.new_qty) - Number(m.previous_qty)
  const sign = KIND[m.type]?.sign ?? 0
  return sign === 0 ? null : sign * Math.abs(Number(m.quantity) || 0)
}

export function MovementList({ movements, className }: { movements: MovementLike[]; className?: string }) {
  const t = useTranslations('movements')
  const locale = useLocale()
  return (
    <ul className={cn('divide-y divide-border', className)} data-testid="movement-list">
      {movements.map(m => {
        const kind = KIND[m.type]
        const Icon = kind?.icon ?? ArrowRight
        const delta = movementDelta(m)
        const reason = movementReasonText(m.reason, t as any)
        return (
          <li key={m.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', kind?.tone ?? 'bg-muted text-muted-foreground')} aria-hidden="true">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{kind ? t(kind.labelKey as any) : m.type}</p>
              {reason && <p className="truncate text-xs text-muted-foreground" title={reason} data-reason>{reason}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {format(new Date(m.created_at), dateTimePattern(locale), { locale: dateFnsLocale(locale) })}
                {m.performed_by_name && <> · <span className="font-medium text-foreground/70">{m.performed_by_name}</span></>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {delta !== null && (
                <p className={cn('text-sm font-bold tabular-nums', delta > 0 ? 'text-green-600 dark:text-green-400' : delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                  {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta)}
                </p>
              )}
              {m.previous_qty != null && m.new_qty != null && (
                <p className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-muted-foreground">
                  {m.previous_qty}<ArrowRight className="h-3 w-3" aria-hidden="true" />{m.new_qty}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
