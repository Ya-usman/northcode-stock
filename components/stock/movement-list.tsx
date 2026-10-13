'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp, ChevronRight, ClipboardCheck, RotateCcw, ShoppingCart, type LucideIcon } from 'lucide-react'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { describeMovement, movementDelta, movementText, type MovementView } from '@/lib/stock/movement-label'
import { cn } from '@/lib/utils/cn'

// Liste chronologique de mouvements de stock, tels que la base les a
// enregistrés. Utilisée par l'onglet Mouvements (toute la ligne ouvre le détail
// du mouvement, lignes regroupées par jour) et par la fiche produit (les dix
// derniers, en consultation). Chaque ligne : produit, libellé métier,
// référence ou origine, heure et employé, quantité signée à droite.

export { movementDelta }

export interface MovementLike {
  id: string
  type: string
  quantity: number
  previous_qty: number | null
  new_qty: number | null
  reason: string | null
  created_at: string
  performed_by_name: string | null
  product_id?: string | null
  product_name?: string | null
  shop_id?: string | null
  inventory_count?: boolean | null
}

const GREEN = 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400'
const BLUE = 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400'
const AMBER = 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
const PURPLE = 'bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400'

/** Pictogramme et teinte d'un mouvement, d'après son libellé métier. */
export function movementVisual(view: MovementView): { icon: LucideIcon; tone: string } {
  switch (view.labelKey) {
    case 'label_sale': return { icon: ShoppingCart, tone: BLUE }
    case 'label_return': return { icon: RotateCcw, tone: GREEN }
    case 'label_restock': case 'label_supplier_receipt': case 'label_initial': case 'label_entry': return { icon: ArrowDown, tone: GREEN }
    case 'label_transfer_sent': return { icon: ArrowLeftRight, tone: AMBER }
    case 'label_transfer_received': case 'label_transfer_cancelled': return { icon: ArrowLeftRight, tone: GREEN }
    case 'label_loss': case 'label_damage': case 'label_expiry': case 'label_exit': return { icon: ArrowUp, tone: AMBER }
    case 'label_stock_correction': case 'label_inventory_adjustment': case 'label_adjustment': return { icon: ClipboardCheck, tone: PURPLE }
    default: return { icon: ArrowRight, tone: 'bg-muted text-muted-foreground' }
  }
}

export function signedQuantity(delta: number): string {
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`
}

export function deltaTone(delta: number): string {
  return delta > 0 ? 'text-green-600 dark:text-green-400' : delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export function MovementList<M extends MovementLike>({ movements, className, showProduct = false, groupByDay = false, onOpen, shopName }: {
  movements: M[]
  className?: string
  /** Le nom du produit ouvre chaque ligne (onglet Mouvements) ; inutile dans la fiche d'un produit */
  showProduct?: boolean
  /** Lignes regroupées sous « Aujourd'hui », « Hier », puis la date ; la ligne ne porte alors que l'heure */
  groupByDay?: boolean
  /** Présent : toute la ligne est un bouton qui ouvre le détail du mouvement */
  onOpen?: (movement: M) => void
  /** Plusieurs boutiques affichées ensemble : nom de la boutique de chaque mouvement */
  shopName?: (shopId: string) => string | null | undefined
}) {
  const t = useTranslations('movements')
  const locale = useLocale()

  const groups = useMemo(() => {
    if (!groupByDay) return [{ key: 'all', label: null as string | null, rows: movements }]
    const now = new Date()
    const today = dayKey(now)
    const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    const out: { key: string; label: string | null; rows: M[] }[] = []
    for (const m of movements) {
      const d = new Date(m.created_at)
      const key = dayKey(d)
      const last = out[out.length - 1]
      if (last && last.key === key) { last.rows.push(m); continue }
      const label = key === today ? t('day_today') : key === yesterday ? t('day_yesterday') : formatLocaleDate(d, locale, { day: 'numeric', month: 'long', year: 'numeric' })
      out.push({ key, label, rows: [m] })
    }
    return out
  }, [movements, groupByDay, locale, t])

  const when = (iso: string) => {
    const time = formatLocaleTime(iso, locale)
    return groupByDay ? time : `${formatLocaleDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' })} · ${time}`
  }

  const row = (m: M) => {
    const view = describeMovement(m)
    const { icon: Icon, tone } = movementVisual(view)
    const delta = movementDelta(m)
    const label = t(view.labelKey as any)
    const detail = movementText(view.detail, t as any)
    const shop = shopName && m.shop_id ? shopName(m.shop_id) : null
    const body = (
      <>
        <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone)} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="block min-w-0 flex-1">
          {showProduct && <span className="block truncate text-sm font-semibold text-foreground" data-movement-product>{m.product_name || t('product_removed')}</span>}
          <span className={cn('block truncate', showProduct ? 'text-xs font-medium text-foreground/80' : 'text-sm font-semibold text-foreground')} data-movement-label={view.labelKey}>{label}</span>
          {detail && <span className="block truncate text-xs text-muted-foreground" title={detail} data-movement-detail>{detail}</span>}
          <span className="mt-0.5 block truncate text-xs text-muted-foreground" data-movement-meta>
            {when(m.created_at)}
            {m.performed_by_name && <> · <span className="font-medium text-foreground/70">{m.performed_by_name}</span></>}
            {shop && <> · <span data-movement-shop>{shop}</span></>}
          </span>
        </span>
        <span className="block shrink-0 text-right">
          {delta !== null && <span className={cn('block text-sm font-bold tabular-nums', deltaTone(delta))} data-movement-delta>{signedQuantity(delta)}</span>}
          {m.previous_qty != null && m.new_qty != null && (
            <span className="flex items-center justify-end gap-1 text-[11px] tabular-nums text-muted-foreground">
              {m.previous_qty}<ArrowRight className="h-3 w-3" aria-hidden="true" />{m.new_qty}
            </span>
          )}
        </span>
        {onOpen && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/50" aria-hidden="true" />}
      </>
    )
    return (
      <li key={m.id}>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(m)}
            data-movement-row={m.id}
            className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
          >
            {body}
          </button>
        ) : (
          <div className="flex items-start gap-3 py-2.5 [li:first-child>&]:pt-0 [li:last-child>&]:pb-0" data-movement-row={m.id}>{body}</div>
        )}
      </li>
    )
  }

  return (
    <div className={className} data-testid="movement-list">
      {groups.map(g => (
        <section key={g.key} className={cn(g.label && 'pt-3 first:pt-0')}>
          {g.label && <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-movement-day>{g.label}</h3>}
          <ul className="divide-y divide-border">{g.rows.map(row)}</ul>
        </section>
      ))}
    </div>
  )
}
