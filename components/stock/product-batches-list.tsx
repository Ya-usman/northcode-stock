'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, Edit2, Tag, Trash2 } from 'lucide-react'
import type { Product } from '@/lib/types/database'
import { Skeleton } from '@/components/ui/skeleton'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { isPromoActive } from '@/lib/stock/signals'
import { shopToday } from '@/lib/stock/sellable'
import { useAuthContext } from '@/lib/contexts/auth-context'

// Lots d'un produit (quantité, origine, date de réception, péremption, promo
// du lot) et leurs actions. UNE seule implémentation : c'est la section
// « Lots » de la fiche produit, et l'icône « Lots » d'une ligne ouvre la fiche
// à cet endroit. Les actions ouvrent les petites fenêtres de la page.
// Le coût du lot n'est affiché qu'à qui a le droit de voir les prix d'achat : il n'est pas dans le lot lu par
// le navigateur, il arrive à part (`costs`, fourni par le serveur avec la fiche) — absent, rien n'est affiché.

export interface ProductBatchesListProps {
  product: Product
  batches: any[]
  loading: boolean
  canWrite: boolean
  /** Coût par lot, fourni par le serveur à qui a le droit de le voir ; null sinon */
  costs: Record<string, number> | null
  formatPrice: (n: number) => string
  onAdjust: (batch: any) => void
  onPromo: (batch: any) => void
  onDelete: (batch: any) => void
  onEditExpiry: (batch: any) => void
}

export function ProductBatchesList({ product, batches: rawBatches, loading, canWrite, costs, formatPrice, onAdjust, onPromo, onDelete, onEditExpiry }: ProductBatchesListProps) {
  // Le coût connu est reposé sur le lot : les fenêtres d'action (promo « sous le coût ») en ont besoin
  const batches = costs ? rawBatches.map((b: any) => (b.id in costs ? { ...b, buying_price: costs[b.id] } : b)) : rawBatches
  const t = useTranslations()
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const { userShops } = useAuthContext()

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  if (batches.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{t('products.no_batches')}</p>

  // Date métier de la boutique DU produit (shops.timezone, migration 178)
  const today = shopToday(userShops.find(s => s.id === (product as any)?.shop_id) ?? null)
  return (
    <div className="space-y-2" data-testid="batches-list">
      {batches.map((b: any) => {
        // Un lot qui périme aujourd'hui n'est pas encore périmé (même règle que le « Disponible »)
        const isExpired = b.expiry_date && b.expiry_date.slice(0, 10) < today
        const sourceLabel = t(`products.batch_source_${b.source}` as any) || b.source
        const batchPromoActive = isPromoActive(b)
        return (
          <div key={b.id} className="space-y-1 rounded-lg border bg-card px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-sm font-semibold">
                {b.quantity} {unitLabel(product.unit, b.quantity)}
                {canWrite && (
                  <button
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-stockshop-blue dark:hover:text-blue-400"
                    title={t('products.adjust_quantity_action')}
                    onClick={() => onAdjust(b)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{sourceLabel}</span>
                {canWrite && (
                  <button
                    className={`flex h-6 w-6 items-center justify-center rounded ${batchPromoActive ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400'}`}
                    title={t('products.promo_action')}
                    onClick={() => onPromo(b)}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </button>
                )}
                {canWrite && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                    title={t('products.delete_batch_action')}
                    onClick={() => onDelete(b)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              {costs && b.buying_price != null ? <span>{t('products.cost_label')}: {formatPrice(b.buying_price)}</span> : <span />}
              <span>{t('products.received_on')}: {new Date(b.received_at).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {b.expiry_date ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isExpired ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400'}`}>
                  {isExpired ? t('products.expired_badge') : t('products.expiring_badge', { date: new Date(b.expiry_date).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short' }) })}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">{t('products.no_expiry_date')}</span>
              )}
              {canWrite && (
                <button
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-stockshop-blue dark:hover:text-blue-400"
                  title={t('products.edit_expiry_action')}
                  onClick={() => onEditExpiry(b)}
                >
                  <CalendarClock className="h-3 w-3" />
                </button>
              )}
              {batchPromoActive && (
                <span className="rounded-full bg-stockshop-blue-muted px-1.5 py-0.5 text-[10px] font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">
                  {t('products.promo_badge')}: {formatPrice(b.promo_price)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
