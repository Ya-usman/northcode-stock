'use client'

// Carte d'un transfert (Stock › Transferts V1, maquette validée le 30 oct. 2026) : entièrement cliquable (ouvre le
// détail), référence + statut, trajet avec icônes boutique, « 2 produits · 18 unités », date selon le statut,
// bandeau « En attente de réception · En transit depuis N jours » (orange à partir de 2 jours), action principale
// (« Réceptionner » pour la boutique d'ARRIVÉE seulement, sinon « Voir le détail ») et menu « … » (actions secondaires).
import { forwardRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, CalendarDays, CheckCircle2, ChevronRight, Clock, Eye, FileEdit, MoreHorizontal, Package, QrCode, Store, Truck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { isLateTransit, transferTotals, transitDays, type TransferRow } from '@/lib/stock/transfers-view'

export const TRANSFER_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  received: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  cancelled: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
}
const STATUS_ICON: Record<string, typeof Truck> = { draft: FileEdit, sent: Truck, received: CheckCircle2, cancelled: XCircle }

export interface TransferListRow extends TransferRow {
  sent_by_name?: string | null
  received_by_name?: string | null
  cancelled_at?: string | null
  has_discrepancy?: boolean
  units_missing?: number
  can_receive?: boolean
  can_manage_source?: boolean
}

export function TransferStatusBadge({ status }: { status: string }) {
  const t = useTranslations('transfers')
  const Icon = STATUS_ICON[status] || Truck
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', TRANSFER_STATUS_STYLE[status])} data-testid="transfer-status">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{t(`status_${status}` as any)}
    </span>
  )
}

export function TransferCard({ tr, onOpen, onReceive, menu }: {
  tr: TransferListRow
  onOpen: () => void
  onReceive: () => void
  /** Menu « … » (rendu par la page : il dépend des droits et des actions disponibles) */
  menu: React.ReactNode
}) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  const fmtDate = (iso: string) => formatLocaleDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtTime = (iso: string) => formatLocaleTime(iso, locale)
  const { products, units } = transferTotals(tr)
  const days = transitDays(tr)
  const late = isLateTransit(days)

  const dateLine = tr.status === 'received' && tr.received_at
    ? t('received_on', { date: fmtDate(tr.received_at), time: fmtTime(tr.received_at) })
    : tr.status === 'cancelled' && tr.cancelled_at
      ? t('cancelled_on', { date: fmtDate(tr.cancelled_at) })
      : tr.status === 'draft'
        ? (tr.created_by_name ? t('created_on_by', { date: fmtDate(tr.created_at), name: tr.created_by_name }) : t('created_on', { date: fmtDate(tr.created_at) }))
        : (tr.sent_by_name ? t('sent_on_by', { date: fmtDate(tr.sent_at || tr.created_at), name: tr.sent_by_name }) : t('sent_on', { date: fmtDate(tr.sent_at || tr.created_at) }))

  return (
    <div className="rounded-xl border bg-card shadow-sm transition-colors hover:border-stockshop-blue/30" data-testid="transfer-card">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        className="block w-full cursor-pointer rounded-t-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${tr.reference}, ${t(`status_${tr.status}` as any)}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-base font-bold tabular-nums text-foreground">{tr.reference}</p>
            <TransferStatusBadge status={tr.status} />
            {tr.has_discrepancy && tr.status === 'received' && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                {t('missing_units', { count: tr.units_missing ?? 0 })}
              </span>
            )}
          </div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{tr.source_shop_name}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="→" />
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{tr.destination_shop_name}</span>
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Package className="h-4 w-4 shrink-0" aria-hidden="true" />{t('card_totals', { products, units })}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />{dateLine}
        </p>

        {tr.status === 'sent' && (
          <p className={cn('mt-3 flex flex-wrap items-center gap-x-1.5 rounded-lg px-3 py-2 text-sm',
            late ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400' : 'bg-muted/60 text-muted-foreground')}
            data-testid="transfer-waiting">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('waiting_reception')}</span>
            {late && <><span aria-hidden="true">·</span><span>{t('in_transit_since', { count: days ?? 0 })}</span></>}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        {tr.status === 'sent' && tr.can_receive ? (
          <Button variant="stockshop" className="h-11 flex-1 gap-2 sm:flex-none" onClick={onReceive} data-testid="transfer-receive">
            <QrCode className="h-4 w-4" aria-hidden="true" />{t('receive_cta')}
          </Button>
        ) : (
          <Button variant="outline" className="h-11 flex-1 gap-2 sm:flex-none" onClick={onOpen} data-testid="transfer-view">
            <Eye className="h-4 w-4" aria-hidden="true" />{t('view_detail')}
          </Button>
        )}
        {menu}
      </div>
    </div>
  )
}

/** Bouton « … » (déclencheur du menu secondaire ; transmet sa référence pour le menu déroulant) */
export const MoreButton = forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(function MoreButton(props, ref) {
  const t = useTranslations('transfers')
  return (
    <Button ref={ref} variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={t('more_actions')} data-testid="transfer-more" {...props}>
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </Button>
  )
})
