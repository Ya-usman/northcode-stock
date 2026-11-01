'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, Edit2, MoreHorizontal, PackageCheck, Tag, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Product } from '@/lib/types/database'
import { Skeleton } from '@/components/ui/skeleton'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { isPromoActive } from '@/lib/stock/signals'
import { shopToday } from '@/lib/stock/sellable'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { ExhaustedLots } from '@/components/stock/batch-treatment'

// Lots d'un produit (quantité, origine, date de réception, péremption, promo
// du lot) et leurs actions. UNE seule implémentation : c'est la section
// « Lots » de la fiche produit, et l'icône « Lots » d'une ligne ouvre la fiche
// à cet endroit. Les actions ouvrent les petites fenêtres de la page.
// Actions (1er nov. 2026) : un menu « … » aux libellés écrits (avant : 4 icônes de 20 à 24 px expliquées par une
// infobulle, invisible au doigt) ; un lot PÉRIMÉ affiche en plus « Traiter le lot périmé » (sortie tracée : détruit
// ou rendu au fournisseur), avant : seulement depuis l'onglet « Lots & péremptions ».
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
  /** Traitement d'un lot périmé (migration 179) ; absent si indisponible */
  onTreat?: (batch: any) => void
}

export function ProductBatchesList({ product, batches: rawBatches, loading, canWrite, costs, formatPrice, onAdjust, onPromo, onDelete, onEditExpiry, onTreat }: ProductBatchesListProps) {
  // Le coût connu est reposé sur le lot : les fenêtres d'action (promo « sous le coût ») en ont besoin
  const batches = costs ? rawBatches.map((b: any) => (b.id in costs ? { ...b, buying_price: costs[b.id] } : b)) : rawBatches
  const t = useTranslations()
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const { userShops } = useAuthContext()

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
  // Lots épuisés / traités : toujours retrouvables depuis le produit (179), sous la liste de travail
  const exhausted = product?.id ? <ExhaustedLots productId={product.id} unit={n => unitLabel(product.unit, n)} /> : null
  if (batches.length === 0) return <div><p className="py-4 text-center text-sm text-muted-foreground">{t('products.no_batches')}</p>{exhausted}</div>

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
          <div key={b.id} className={`space-y-1 rounded-lg border bg-card px-3 py-2.5 ${isExpired ? 'border-red-200 dark:border-red-900/60' : ''}`} data-batch-row={b.id} data-expired={isExpired ? '1' : undefined}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{b.quantity} {unitLabel(product.unit, b.quantity)}</span>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{sourceLabel}</span>
                {canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label={t('products.batch_actions')} data-testid="batch-actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isExpired && onTreat && (
                        <DropdownMenuItem onClick={() => onTreat(b)} className="gap-2.5 font-medium"><PackageCheck className="h-4 w-4 shrink-0" />{t('batch_treatment.treat_action')}</DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onAdjust(b)} className="gap-2.5"><Edit2 className="h-4 w-4 shrink-0" />{t('products.adjust_quantity_action')}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditExpiry(b)} className="gap-2.5"><CalendarClock className="h-4 w-4 shrink-0" />{t('products.edit_expiry_action')}</DropdownMenuItem>
                      {!isExpired && <DropdownMenuItem onClick={() => onPromo(b)} className="gap-2.5"><Tag className="h-4 w-4 shrink-0" />{t('products.promo_action')}</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onDelete(b)} className="gap-2.5 text-destructive focus:text-destructive"><Trash2 className="h-4 w-4 shrink-0" />{t('products.delete_batch_action')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
              {batchPromoActive && (
                <span className="rounded-full bg-stockshop-blue-muted px-1.5 py-0.5 text-[10px] font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">
                  {t('products.promo_badge')}: {formatPrice(b.promo_price)}
                </span>
              )}
            </div>
            {/* Lot périmé : il ne se vend plus ; l'action est proposée ici, avec ce qu'elle fait */}
            {isExpired && canWrite && onTreat && (
              <div className="flex flex-col gap-2 rounded-md bg-red-50/70 px-2.5 py-2 dark:bg-red-950/30 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-red-800 dark:text-red-300">{t('products.expired_lot_hint')}</p>
                <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 self-start border-red-200 bg-background sm:self-auto dark:border-red-900/60" onClick={() => onTreat(b)} data-testid="batch-treat">
                  <PackageCheck className="h-4 w-4" />{t('batch_treatment.treat_action')}
                </Button>
              </div>
            )}
          </div>
        )
      })}
      {exhausted}
    </div>
  )
}
