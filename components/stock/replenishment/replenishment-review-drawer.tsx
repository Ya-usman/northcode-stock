'use client'

// Panneau « Vérifier les commandes » du réapprovisionnement (validé le 30 oct. 2026) : récapitulatif EXACT de ce qui
// sera créé (par fournisseur : produits, quantités, livraison prévue, total si le coût est visible), création des
// brouillons avec un état par fournisseur, puis le résultat (références BC-…, échec réessayable). Rien n'est envoyé
// au fournisseur : les bons sont des brouillons, relus et envoyés depuis Fournisseurs.

import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Truck } from 'lucide-react'
import { AppDrawer } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils/currency'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'

export interface ReviewOrder {
  key: string
  shopId: string
  shopName: string | null
  supplierId: string
  supplierName: string
  currency: string
  canViewCost: boolean
  expected: string | null
  lines: { productId: string; name: string; unit: string | null; qty: number; price: number | null }[]
  status: 'pending' | 'creating' | 'done' | 'error'
  reference?: string | null
  error?: string | null
}

export function reviewPhase(orders: ReviewOrder[]): 'review' | 'creating' | 'done' {
  if (orders.some(o => o.status === 'creating')) return 'creating'
  if (orders.length && orders.every(o => o.status === 'done' || o.status === 'error') && orders.some(o => o.status !== 'pending')) return 'done'
  return 'review'
}

export function ReplenishmentReviewDrawer({ orders, onCreate, onClose, onSeeOrders }: {
  orders: ReviewOrder[] | null
  onCreate: () => void
  onClose: () => void
  onSeeOrders: () => void
}) {
  const t = useTranslations('replenishment')
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const list = orders || []
  const phase = reviewPhase(list)
  const done = list.filter(o => o.status === 'done').length
  const failed = list.filter(o => o.status === 'error').length
  const toCreate = list.filter(o => o.status === 'pending' || o.status === 'error').length

  const footer = phase === 'done'
    ? (
      <div className="flex w-full flex-col-reverse gap-2 sm:flex-row">
        {failed > 0
          ? <Button variant="outline" className="h-11 flex-1" onClick={onCreate} data-testid="replenishment-review-retry">{t('review_retry', { count: failed })}</Button>
          : <Button variant="outline" className="h-11 flex-1" onClick={onClose} data-testid="replenishment-review-finish">{t('review_finish')}</Button>}
        {done > 0 && <Button variant="stockshop" className="h-11 flex-[2]" onClick={onSeeOrders} data-testid="replenishment-review-see">{t('see_orders')}</Button>}
      </div>
    )
    : (
      <div className="flex w-full gap-2">
        <Button variant="outline" className="h-11 flex-1" disabled={phase === 'creating'} onClick={onClose}>{t('review_back')}</Button>
        <Button variant="stockshop" className="h-11 flex-[2]" loading={phase === 'creating'} disabled={!toCreate} onClick={onCreate} data-testid="replenishment-review-create">
          {t('review_create', { count: toCreate })}
        </Button>
      </div>
    )

  return (
    <AppDrawer
      open={!!orders}
      onOpenChange={o => { if (!o && phase !== 'creating') onClose() }}
      title={phase === 'done' ? t('review_done_title', { count: done }) : t('review_title')}
      icon={phase === 'done' && !failed ? <CheckCircle2 className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
      width="md"
      footer={footer}
      testId="replenishment-review"
    >
      <div className="space-y-3">
        {list.map(o => {
          const total = o.canViewCost ? o.lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0) : 0
          return (
            <section key={o.key} className={cn('rounded-xl border bg-card p-3 shadow-sm transition-colors',
              o.status === 'done' && 'border-green-200 dark:border-green-900', o.status === 'error' && 'border-red-200 dark:border-red-900')}
              data-testid="replenishment-review-order" data-status={o.status}>
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{o.supplierName}</span></p>
                  {o.shopName && <p className="text-xs text-muted-foreground">{o.shopName}</p>}
                </div>
                <StatusMark status={o.status} />
              </header>
              {o.status === 'done' && o.reference && (
                <p className="mt-2 rounded-md bg-green-50 px-2.5 py-1.5 text-sm font-medium text-green-800 animate-in fade-in-0 dark:bg-green-950/40 dark:text-green-300" data-testid="replenishment-review-ref">
                  {t('review_done_ref', { ref: o.reference })}
                </p>
              )}
              {o.status === 'error' && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-sm text-red-700 animate-in fade-in-0 dark:bg-red-950/40 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{o.error || t('review_error')}
                </p>
              )}
              <ul className="mt-2 divide-y text-sm">
                {o.lines.map(l => (
                  <li key={l.productId} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{l.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{l.qty}{l.unit ? ` ${unitLabel(l.unit, l.qty)}` : ''}</span>
                  </li>
                ))}
              </ul>
              {(o.expected || total > 0) && (
                <dl className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                  {o.expected && <div className="flex justify-between gap-3"><dt>{t('review_expected')}</dt><dd className="font-medium text-foreground">{formatLocaleDate(`${o.expected}T12:00:00`, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}</dd></div>}
                  {total > 0 && <div className="flex justify-between gap-3"><dt>{t('review_total')}</dt><dd className="font-medium tabular-nums text-foreground">{formatCurrency(total, o.currency)}</dd></div>}
                </dl>
              )}
            </section>
          )
        })}
        {phase !== 'done' && <p className="text-xs text-muted-foreground">{t('review_note')}</p>}
      </div>
    </AppDrawer>
  )
}

function StatusMark({ status }: { status: ReviewOrder['status'] }) {
  if (status === 'creating') return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-stockshop-blue dark:text-blue-400" aria-hidden />
  if (status === 'done') return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 animate-in zoom-in-50 fade-in-0 duration-300" aria-hidden />
  if (status === 'error') return <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
  return null
}
