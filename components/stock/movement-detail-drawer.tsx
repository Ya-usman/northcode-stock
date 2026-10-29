'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { ChevronRight, Package } from 'lucide-react'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { movementVisual, signedQuantity, deltaTone, type MovementLike } from '@/components/stock/movement-list'
import { describeMovement, movementDelta } from '@/lib/stock/movement-label'
import { presetPersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useFilterScope } from '@/lib/filters/use-filter-scope'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { withTimeout } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'

// Détail d'UN mouvement de stock : « qu'est-ce qui s'est passé exactement ? ».
// Panneau commun (DetailDrawer) : à droite sur ordinateur et tablette, plein
// écran sur téléphone. La ligne touchée s'affiche tout de suite ; le serveur
// (/api/stock/movements/<id>) complète avec le produit, la boutique et
// l'origine quand elle existe vraiment. Une information absente n'est pas
// affichée — ni tiret, ni « non disponible ». Le stock avant / après n'est
// montré que si la base l'a noté au moment du mouvement : il n'est jamais
// recalculé à partir du stock d'aujourd'hui.

export interface MovementRow extends MovementLike {
  notes?: string | null
  product_unit?: string | null
}

type ServerOrigin =
  | { kind: 'sale'; id: string; ref: string; status: string | null; created_at: string; can_open: boolean }
  | { kind: 'purchase_order'; ref: string; supplier_name: string | null; can_open: boolean }
  | { kind: 'transfer'; ref: string; source_shop: string | null; destination_shop: string | null; can_open: boolean }

interface ServerDetail {
  movement: MovementRow & {
    shop_name: string | null
    product: { id: string; name: string; sku: string | null; unit: string | null; image_url: string | null } | null
  }
  origin: ServerOrigin | null
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0" data-testid={testId}>
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-foreground">{children}</dd>
    </div>
  )
}

export function MovementDetailDrawer({ movement, onClose, showShop, onViewProduct }: {
  /** Ligne de la liste (affichée immédiatement) ; null = panneau fermé */
  movement: MovementRow | null
  onClose: () => void
  /** Le compte a plusieurs boutiques : la boutique du mouvement est rappelée */
  showShop: boolean
  /** Présent : action « Voir la fiche produit » */
  onViewProduct?: (productId: string) => void
}) {
  const t = useTranslations('movements')
  const locale = useLocale()
  const router = useRouter()
  const unitLabel = useUnitLabel()
  const { shop, userShops } = useAuth()
  // Transferts : mémoire des filtres par contexte réel de l'en-tête (comme l'écran Transferts)
  const filterScope = useFilterScope()

  const [detail, setDetail] = useState<ServerDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const requestRef = useRef(0)
  const id = movement?.id

  const load = useCallback(async () => {
    if (!id) return
    const request = ++requestRef.current
    setFailed(false)
    try {
      const res = await withTimeout(fetch(`/api/stock/movements/${id}`), 20_000)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      if (request === requestRef.current) setDetail(json)
    } catch {
      if (request === requestRef.current) setFailed(true)
    }
  }, [id])

  // Autre mouvement : jamais les compléments du précédent
  useEffect(() => { setDetail(null); setFailed(false); if (id) load() }, [id, load])

  // Le serveur fait foi dès qu'il a répondu ; d'ici là, la ligne de la liste
  const m: MovementRow | null = detail && detail.movement.id === id ? detail.movement : movement
  const server = detail && detail.movement.id === id ? detail : null
  const view = m ? describeMovement(m) : null
  const visual = view ? movementVisual(view) : null
  const Icon = visual?.icon ?? Package
  const delta = m ? movementDelta(m) : null
  const unit = server?.movement.product?.unit || m?.product_unit || null
  const quantity = m ? Math.abs(Number(m.quantity) || 0) : 0
  const when = m ? new Date(m.created_at) : null
  const product = server?.movement.product ?? null
  const productName = product?.name || m?.product_name || null
  const productId = product?.id || m?.product_id || null
  const shopName = server?.movement.shop_name || (m?.shop_id ? userShops.find(s => s.id === m.shop_id)?.name : null) || null
  const origin = view?.origin ?? null
  const found = server?.origin ?? null

  // Écran d'origine : il existe déjà, on y arrive avec sa propre recherche posée sur la référence
  const openOrigin = () => {
    if (!found?.can_open) return
    if (found.kind === 'sale') {
      // Lien ciblé par l'identifiant de la vente : l'Historique la retrouve quelle que soit sa date, dans le
      // contexte de l'en-tête, sans écraser les filtres mémorisés de l'utilisateur (avant : préréglage écrit sous
      // la boutique ACTIVE alors que l'Historique lit sous son contexte → « Aujourd'hui » masquait la vente)
      router.push(`/${locale}/sales/history?sale_id=${encodeURIComponent(found.id)}`)
    } else if (found.kind === 'purchase_order') {
      presetPersistedFilters('purchase_orders', shop?.id, { search: found.ref, status: '', dateFrom: '', dateTo: '' })
      router.push(`/${locale}/suppliers?view=purchase_orders`)
    } else {
      presetPersistedFilters('transfers_v1', filterScope, { search: found.ref, statuses: [], sources: [], destinations: [], products: [], creators: [], period: 'all' })
      router.push(`/${locale}/stock/transfers`)
    }
  }
  // L'onglet Transferts n'existe que pour un compte à plusieurs boutiques
  const canOpenOrigin = !!found?.can_open && (found.kind !== 'transfer' || userShops.length > 1)
  const originAction = found?.kind === 'sale' ? t('view_sale') : found?.kind === 'purchase_order' ? t('view_order') : t('view_transfer')
  const canViewProduct = !!onViewProduct && !!productId && !!product

  const footer = canOpenOrigin || canViewProduct ? (
    <div className="flex flex-wrap gap-2" data-testid="movement-detail-actions">
      {canOpenOrigin && (
        <Button variant="outline" size="sm" className="h-10 gap-1" onClick={openOrigin} data-testid="movement-detail-origin-action">
          {originAction}<ChevronRight className="h-4 w-4" />
        </Button>
      )}
      {canViewProduct && (
        <Button variant="outline" size="sm" className="h-10 gap-1" onClick={() => onViewProduct!(productId!)} data-testid="movement-detail-product-action">
          {t('view_product')}<ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  ) : undefined

  // Transfert : boutique de départ et d'arrivée — celles du transfert retrouvé, sinon celles que dit le motif
  const transfer = origin?.kind === 'transfer' ? {
    ref: origin.ref,
    from: (found?.kind === 'transfer' && found.source_shop) || (origin.direction === 'out' ? shopName : origin.otherShop),
    to: (found?.kind === 'transfer' && found.destination_shop) || (origin.direction === 'out' ? origin.otherShop : shopName),
  } : null
  const saleCancelled = origin?.kind === 'sale' && (origin.cancelled || (found?.kind === 'sale' && found.status === 'cancelled'))

  return (
    <DetailDrawer
      open={!!movement}
      onOpenChange={open => { if (!open) onClose() }}
      category={t('detail_category')}
      title={view ? t(view.labelKey as any) : ''}
      icon={<Icon className="h-4 w-4" />}
      width="md"
      testId="movement-detail"
      actions={footer}
      meta={m && (
        <div className="space-y-3">
          <p className="flex items-baseline gap-2" data-testid="movement-detail-quantity">
            <span className={cn('text-3xl font-bold tabular-nums', delta === null ? 'text-foreground' : deltaTone(delta))}>{delta === null ? quantity : signedQuantity(delta)}</span>
            {unit && <span className="text-sm text-muted-foreground">{unitLabel(unit, delta === null ? quantity : Math.abs(delta))}</span>}
          </p>
          {productName && (
            <div className="flex items-center gap-3" data-testid="movement-detail-product">
              <ProductThumbnail src={product?.image_url} alt={productName} className="h-12 w-12 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{productName}</p>
                {product?.sku && <p className="truncate font-mono text-xs text-muted-foreground">{product.sku}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    >
      {m && when && (
        <div className="space-y-4">
          <DrawerSection title={t('detail_section')}>
            <dl className="divide-y divide-border" data-testid="movement-detail-facts">
              {m.previous_qty != null && m.new_qty != null && (
                <>
                  <Row label={t('detail_stock_before')} testId="movement-detail-before"><span className="tabular-nums">{m.previous_qty}</span></Row>
                  <Row label={t('detail_stock_after')} testId="movement-detail-after"><span className="tabular-nums">{m.new_qty}</span></Row>
                </>
              )}
              <Row label={t('detail_date')} testId="movement-detail-date">{formatLocaleDate(when, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Row>
              <Row label={t('detail_time')} testId="movement-detail-time">{formatLocaleTime(when, locale)}</Row>
              {m.performed_by_name && <Row label={t('detail_by')} testId="movement-detail-by">{m.performed_by_name}</Row>}
              {showShop && shopName && <Row label={t('detail_shop')} testId="movement-detail-shop">{shopName}</Row>}
              {view?.freeReason && <Row label={t('detail_reason')} testId="movement-detail-reason">{view.freeReason}</Row>}
              {m.notes && <Row label={t('detail_note')} testId="movement-detail-note">{m.notes}</Row>}
            </dl>
          </DrawerSection>

          {origin && (
            <DrawerSection title={t('detail_origin')}>
              <dl className="divide-y divide-border" data-testid="movement-detail-origin" data-origin={origin.kind}>
                {origin.kind === 'sale' && (
                  <Row label={t('origin_sale')}>
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <span className="font-mono">{origin.ref}</span>
                      {saleCancelled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400" data-sale-status="cancelled">{t('origin_sale_cancelled')}</span>}
                      {origin.edited && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground" data-sale-status="edited">{t('origin_sale_edited')}</span>}
                    </span>
                  </Row>
                )}
                {origin.kind === 'purchase_order' && (
                  <>
                    <Row label={t('origin_order')}><span className="font-mono">{origin.ref}</span></Row>
                    {found?.kind === 'purchase_order' && found.supplier_name && <Row label={t('origin_supplier')}>{found.supplier_name}</Row>}
                  </>
                )}
                {transfer && (
                  <>
                    <Row label={t('origin_transfer')}>
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <span className="font-mono">{transfer.ref}</span>
                        {origin.kind === 'transfer' && origin.cancelled && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400" data-transfer-status="cancelled">{t('origin_transfer_cancelled')}</span>}
                      </span>
                    </Row>
                    {transfer.from && <Row label={t('origin_from_shop')}>{transfer.from}</Row>}
                    {transfer.to && <Row label={t('origin_to_shop')}>{transfer.to}</Row>}
                  </>
                )}
                {origin.kind === 'supplier' && <Row label={t('origin_supplier')}>{origin.name}</Row>}
                {origin.kind === 'inventory' && <Row label={t('origin_source')}>{t('ref_inventory')}</Row>}
                {origin.kind === 'batch' && <Row label={t('origin_source')}>{t(origin.action === 'deleted' ? 'ref_batch_deleted' : 'ref_batch_corrected')}</Row>}
              </dl>
            </DrawerSection>
          )}

          {failed && !server && (
            <p className="text-xs text-muted-foreground" data-testid="movement-detail-partial">
              {t('detail_partial')}{' '}
              <button type="button" onClick={load} className="font-semibold text-stockshop-blue hover:underline dark:text-blue-400">{t('detail_retry')}</button>
            </p>
          )}
        </div>
      )}
    </DetailDrawer>
  )
}
