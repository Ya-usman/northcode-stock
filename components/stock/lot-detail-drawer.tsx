'use client'

import { useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, ChevronRight, Edit2, MoreHorizontal, PackageCheck, PackageMinus, ShoppingBasket, Tag } from 'lucide-react'
import { BatchTreatmentHistory, UnallocatedBanner, useBatchTreatmentsAvailable, useLotTreatments } from '@/components/stock/batch-treatment'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { expiryCountdown, localDate, type BatchExpiryStatus } from '@/lib/stock/batch-status'
import { isPromoActive } from '@/lib/stock/signals'
import { cn } from '@/lib/utils/cn'

// Détail d'UN lot : « qu'est-ce que ce lot et que dois-je savoir ? ».
// Panneau commun (DetailDrawer) : à droite sur ordinateur et tablette, plein
// écran sur téléphone. Tout vient de la ligne déjà chargée par la liste : rien
// n'est rechargé, et une information absente n'est pas affichée. Un lot n'a ni
// numéro ni réception d'origine enregistrés : il se désigne par sa date
// d'entrée, et aucun bouton ne mène vers une destination qui n'existe pas.

export interface LotRow {
  id: string
  shop_id: string
  product_id: string
  quantity: number
  initial_quantity: number
  /** null : lot sans date de péremption (produit non périssable) */
  expiry_date: string | null
  received_at: string
  source: string
  promo_price: number | null
  promo_until: string | null
  promo_start: string | null
  /** Seulement lu avec le droit de voir les fournisseurs */
  suppliers?: { name: string } | null
  products: {
    name: string
    unit: string | null
    sku: string | null
    image_url: string | null
    selling_price: number
    category_id: string | null
    categories: { name: string; color: string | null; expiry_alert_days: number | null } | null
  } | null
}

const BADGE: Record<BatchExpiryStatus, 'danger' | 'warning' | 'success' | 'secondary'> = { expired: 'danger', expiring: 'warning', ok: 'success', none: 'secondary' }
const COUNTDOWN_TONE: Record<BatchExpiryStatus, string> = {
  expired: 'text-red-600 dark:text-red-400',
  expiring: 'text-amber-700 dark:text-amber-400',
  ok: 'text-foreground',
  none: 'text-muted-foreground',
}

/** Textes d'un lot : désignation, date, délai, statut — les mêmes sur la carte, la ligne et le détail */
export function useLotTexts() {
  const t = useTranslations('expiry')
  const locale = useLocale()
  const day = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => formatLocaleDate(localDate(value), locale, options)
  const moment = (iso: string) => formatLocaleDate(new Date(iso), locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return {
    day,
    /** « Lot du 14 juil. 2026 » : un lot n'a pas de numéro, sa date d'entrée le désigne */
    lotLabel: (receivedAt: string) => t('lot_of', { date: moment(receivedAt) }),
    received: moment,
    status: (s: BatchExpiryStatus) => t(`status_${s}` as any),
    /** « Expire dans 4 jours », « Périmé depuis 3 jours »… ; sans date : « Sans date de péremption » */
    countdown: (expiry: string | null, today: string): string => {
      const c = expiryCountdown(expiry, today)
      if (!c) return t('no_expiry')
      if (c.kind === 'today') return t('expires_today')
      if (c.kind === 'tomorrow') return t('expires_tomorrow')
      if (c.kind === 'days') return t('expires_in_days', { count: c.count })
      if (c.kind === 'months') return t('expires_in_months', { count: c.count })
      return t('expired_since', { count: c.count })
    },
  }
}

export function LotStatusBadge({ status, className }: { status: BatchExpiryStatus; className?: string }) {
  const { status: label } = useLotTexts()
  return <Badge variant={BADGE[status]} data-lot-status={status} className={cn('shrink-0 whitespace-nowrap', className)}>{label(status)}</Badge>
}

export const countdownTone = (status: BatchExpiryStatus) => COUNTDOWN_TONE[status]

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm" data-testid={testId}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{children}</dd>
    </div>
  )
}

export interface LotDetailDrawerProps {
  lot: LotRow | null
  status: BatchExpiryStatus
  /** Jour courant du téléphone, « AAAA-MM-JJ » */
  today: string
  onClose: () => void
  /** Nom de la boutique, seulement quand plusieurs boutiques sont affichées */
  shopName?: string | null
  /** Coût unitaire du lot, fourni par le serveur à qui a le droit de voir les prix d'achat ; null sinon */
  cost?: number | null
  formatPrice: (n: number) => string
  /** Ce lot sort en premier à la caisse (produit à plusieurs lots) */
  fefoFirst?: boolean
  /** Stock en modification : les actions sont proposées */
  canWrite: boolean
  onViewProduct?: (productId: string) => void
  onAdjust: (lot: LotRow) => void
  onEditExpiry: (lot: LotRow) => void
  onPromo: (lot: LotRow) => void
  onRemove: (lot: LotRow) => void
  /** Migration 179 présente : « Traiter le lot périmé » (destruction, retour, corrections tracées) */
  onTreat?: (lot: LotRow) => void
  /** Change après un traitement ou une attribution : l'historique se recharge */
  historyKey?: number
  /** Après l'attribution d'une vente au lot : la liste se recharge */
  onChanged?: () => void
}

export function LotDetailDrawer({ lot, status, today, onClose, shopName, cost, formatPrice, fefoFirst, canWrite, onViewProduct, onAdjust, onEditExpiry, onPromo, onRemove, onTreat, historyKey, onChanged }: LotDetailDrawerProps) {
  const t = useTranslations()
  const texts = useLotTexts()
  const unitLabel = useUnitLabel()
  const p = lot?.products ?? null
  const promoActive = !!lot && isPromoActive(lot)
  const sourceLabel = lot ? t(`products.batch_source_${lot.source}` as any) : ''
  // 179 : historique, ventes à attribuer et « Traiter » — rien n'est demandé au serveur tant qu'elle est absente
  const available = useBatchTreatmentsAvailable()
  const treatments = useLotTreatments(available ? lot?.id : null)
  const { reload } = treatments
  useEffect(() => { if (historyKey) reload() }, [historyKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const canTreat = available && canWrite && !!onTreat && !!lot && status === 'expired' && lot.quantity > 0
  const remove = (l: LotRow) => (canTreat && onTreat ? onTreat(l) : onRemove(l))

  const footer = lot && (onViewProduct || canWrite) ? (
    <div className="flex flex-wrap gap-2" data-testid="lot-detail-actions">
      {canTreat && (
        <Button variant="stockshop" size="sm" className="h-10 gap-1.5 px-3 text-[13px] sm:text-sm" onClick={() => onTreat!(lot)} data-testid="lot-detail-treat">
          <PackageCheck className="hidden h-4 w-4 sm:block" />{t('batch_treatment.treat_action')}
        </Button>
      )}
      {canWrite && !canTreat && (
        // Téléphone : texte seul, pour que les trois boutons tiennent sur une ligne
        <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3 text-[13px] sm:text-sm" onClick={() => onAdjust(lot)} data-testid="lot-detail-adjust">
          <Edit2 className="hidden h-4 w-4 sm:block" />{t('products.adjust_quantity_action')}
        </Button>
      )}
      {onViewProduct && (
        <Button variant="outline" size="sm" className="h-10 gap-1 px-3 text-[13px] sm:text-sm" onClick={() => onViewProduct(lot.product_id)} data-testid="lot-detail-product-action">
          {t('expiry.view_product')}<ChevronRight className="hidden h-4 w-4 sm:block" />
        </Button>
      )}
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 w-10 px-0" aria-label={t('products.more_actions')} title={t('products.more_actions')} data-testid="lot-detail-more">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {canTreat && <DropdownMenuItem onClick={() => onAdjust(lot)} className="gap-2.5 py-2.5"><Edit2 className="h-4 w-4 shrink-0" />{t('products.adjust_quantity_action')}</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => onEditExpiry(lot)} className="gap-2.5 py-2.5"><CalendarClock className="h-4 w-4 shrink-0" />{t('products.edit_expiry_action')}</DropdownMenuItem>
            {/* Jamais de promotion proposée pour un lot déjà périmé (179) */}
            {!(available && status === 'expired') && <DropdownMenuItem onClick={() => onPromo(lot)} className="gap-2.5 py-2.5"><Tag className="h-4 w-4 shrink-0" />{t('products.promo_action')}</DropdownMenuItem>}
            {!canTreat && <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onRemove(lot)} className="gap-2.5 py-2.5 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"><PackageMinus className="h-4 w-4 shrink-0" />{t('expiry.action_remove')}</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  ) : undefined

  return (
    <DetailDrawer
      open={!!lot}
      onOpenChange={open => { if (!open) onClose() }}
      category={t('expiry.col_lot')}
      title={lot ? texts.lotLabel(lot.received_at) : ''}
      icon={<CalendarClock className="h-4 w-4" />}
      width="md"
      testId="lot-detail"
      actions={footer}
      meta={lot && (
        <div className="space-y-3">
          <div className="flex items-center gap-3" data-testid="lot-detail-product">
            <ProductThumbnail src={p?.image_url} alt={p?.name || ''} className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{p?.name || '—'}</p>
              {p?.sku && <p className="truncate font-mono text-xs text-muted-foreground">{p.sku}</p>}
            </div>
            <LotStatusBadge status={status} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-2" data-testid="lot-detail-quantity">
              <span className="text-3xl font-bold tabular-nums text-foreground">{lot.quantity}</span>
              <span className="text-sm text-muted-foreground">{unitLabel(p?.unit, lot.quantity)}</span>
            </p>
            <p className={cn('text-right text-sm font-semibold', countdownTone(status))} data-testid="lot-detail-countdown">{texts.countdown(lot.expiry_date, today)}</p>
          </div>
        </div>
      )}
    >
      {lot && (
        <div className="space-y-4">
          {/* Ce qu'il y a à faire, quand il y a quelque chose à faire */}
          {status === 'expired' && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400" data-testid="lot-detail-hint" data-hint="expired">
              {t('expiry.hint_expired')}
              {canWrite && <>{' '}<button type="button" onClick={() => remove(lot)} className="font-semibold underline underline-offset-2">{canTreat ? t('batch_treatment.treat_action') : t('expiry.action_remove')}</button></>}
            </p>
          )}
          {available && canWrite && treatments.data?.candidates?.length ? (
            <UnallocatedBanner lotId={lot.id} lotQuantity={lot.quantity} candidates={treatments.data.candidates} onResolved={() => { reload(); onChanged?.() }} />
          ) : null}
          {status === 'expiring' && !promoActive && canWrite && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400" data-testid="lot-detail-hint" data-hint="promo">
              {t('expiry.hint_promo')}{' '}
              <button type="button" onClick={() => onPromo(lot)} className="font-semibold underline underline-offset-2">{t('products.promo_action')}</button>
            </p>
          )}

          <DrawerSection title={t('expiry.detail_section')}>
            <dl className="divide-y divide-border" data-testid="lot-detail-facts">
              <Row label={t('expiry.col_remaining')} testId="lot-detail-remaining"><span className="tabular-nums">{lot.quantity} {unitLabel(p?.unit, lot.quantity)}</span></Row>
              <Row label={t('expiry.detail_initial')} testId="lot-detail-initial"><span className="tabular-nums">{lot.initial_quantity} {unitLabel(p?.unit, lot.initial_quantity)}</span></Row>
              <Row label={t('expiry.detail_received')} testId="lot-detail-received">{texts.received(lot.received_at)}</Row>
              <Row label={t('expiry.col_expiry')} testId="lot-detail-expiry">
                {lot.expiry_date ? texts.day(lot.expiry_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : <span className="font-normal text-muted-foreground">{t('expiry.no_expiry')}</span>}
              </Row>
              {shopName && <Row label={t('expiry.detail_shop')} testId="lot-detail-shop">{shopName}</Row>}
              <Row label={t('expiry.detail_origin')} testId="lot-detail-origin">{sourceLabel}</Row>
              {lot.suppliers?.name && <Row label={t('expiry.detail_supplier')} testId="lot-detail-supplier">{lot.suppliers.name}</Row>}
              {promoActive && lot.promo_price != null && lot.promo_until && (
                <Row label={t('expiry.detail_promo')} testId="lot-detail-promo">
                  {t('expiry.detail_promo_value', { price: formatPrice(Number(lot.promo_price)), date: texts.received(lot.promo_until) })}
                </Row>
              )}
              {cost != null && (
                <Row label={t('expiry.detail_value')} testId="lot-detail-value">
                  <span className="tabular-nums">{formatPrice(lot.quantity * cost)}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t('expiry.detail_unit_cost', { price: formatPrice(cost) })}</span>
                </Row>
              )}
            </dl>
          </DrawerSection>

          {fefoFirst && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="lot-detail-fefo">
              <ShoppingBasket className="h-3.5 w-3.5 shrink-0" />{t('expiry.fefo_first')}
            </p>
          )}

          {available && treatments.data?.available && (
            <DrawerSection title={t('batch_treatment.history_title')}>
              <BatchTreatmentHistory events={treatments.data.treatments} unit={n => unitLabel(p?.unit, n)} />
            </DrawerSection>
          )}
        </div>
      )}
    </DetailDrawer>
  )
}
