'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Edit2, History, MoreHorizontal, ShoppingCart, Tag } from 'lucide-react'
import type { Product } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { cn } from '@/lib/utils/cn'

// Vue en tableau de la liste des produits (page Stock). Mêmes données et
// mêmes actions que les cartes, aux mêmes conditions de rôle ; tri par
// en-tête, sélection par case à cocher (case d'en-tête = toutes les lignes
// de ce tableau). Sur téléphone : défilement horizontal, colonnes case +
// produit figées à gauche, SKU replié sous le nom.
//
// Colonnes par défaut : Produit, SKU / code-barres, Prix de vente,
// Disponible, Ventes 30 j, Statut, Actions. Colonnes optionnelles (bouton
// « Colonnes » de la page) : catégorie, coût, valeur du stock, stock
// physique, couverture en jours, fournisseur principal. Le coût n'est plus
// glissé en petit sous le prix : c'est une colonne à part entière, lisible.

export type ProductSortKey =
  | 'name' | 'sku' | 'price' | 'quantity' | 'sold' | 'status'
  | 'category' | 'cost' | 'stockValue' | 'coverage' | 'supplier'
export interface ProductSort { key: ProductSortKey; dir: 'asc' | 'desc' }
export type ProductStatus = 'out' | 'low' | 'dormant' | 'ok'

/** Colonnes optionnelles, dans l'ordre d'affichage (après les colonnes fixes) */
export type ProductColumnKey = 'category' | 'supplier' | 'cost' | 'stockValue' | 'physical' | 'coverage'
export const OPTIONAL_COLUMNS: { key: ProductColumnKey; labelKey: string; ownerOnly?: boolean }[] = [
  { key: 'category', labelKey: 'products.col_category' },
  { key: 'supplier', labelKey: 'products.col_supplier' },
  { key: 'cost', labelKey: 'products.col_cost', ownerOnly: true },
  { key: 'stockValue', labelKey: 'products.col_stock_value', ownerOnly: true },
  { key: 'physical', labelKey: 'products.col_physical' },
  { key: 'coverage', labelKey: 'products.col_coverage' },
]
/** Colonnes annoncées mais sans donnée tant que le suivi réservé / en transit / en commande n'existe pas (étape suivante) */
export const PENDING_COLUMNS: { key: string; labelKey: string }[] = [
  { key: 'reserved', labelKey: 'products.col_reserved' },
  { key: 'inTransit', labelKey: 'products.col_in_transit' },
  { key: 'onOrder', labelKey: 'products.col_on_order' },
]

export interface ProductTableProps {
  products: Product[]
  thresholdFor: (p: Product) => number
  statusFor: (p: Product) => ProductStatus
  /** Quantité vendue sur 30 jours ; null tant que le chiffre n'est pas chargé */
  soldQty: (p: Product) => number | null
  expiryFor: (p: Product) => { date: string; expired: boolean; soon: boolean } | null
  isPromoActive: (p: Product) => boolean
  promoStale: (p: Product) => boolean
  /** Raison d'une promo suggérée (péremption proche, vente lente), sinon null */
  promoSuggestion: (p: Product) => string | null
  formatPrice: (n: number) => string
  isOwner: boolean
  canWriteStock: boolean
  canOrderStock: boolean
  busy: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectMany: (ids: string[], select: boolean) => void
  sort: ProductSort
  onSortChange: (sort: ProductSort) => void
  /** Colonnes optionnelles visibles (déjà filtrées selon le rôle) */
  columns: ProductColumnKey[]
  onOrder: (p: Product) => void
  onRestock: (p: Product) => void
  onEdit: (p: Product) => void
  onPromo: (p: Product) => void
  onBatches: (p: Product) => void
  onArchive: (p: Product) => void
}

// Tri « problèmes d'abord » en ordre croissant
const STATUS_RANK: Record<ProductStatus, number> = { out: 0, low: 1, dormant: 2, ok: 3 }

// Boutons d'action compacts : le `tap-target` global (48 px minimum, pensé
// pour les écrans tactiles) est volontairement levé dans ce tableau dense,
// sinon la colonne Actions ferait déborder la page sur un portable.
const ICON_BTN = 'h-8 w-8 !min-h-0 !min-w-0 p-0'

const STATUS_CHIP: Record<ProductStatus, string> = {
  out: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  low: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  dormant: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400',
  ok: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
}

const CELL = 'px-2.5 py-2 align-middle'
const CELL_NUM = cn(CELL, 'whitespace-nowrap text-right tabular-nums')

/**
 * Couverture en jours au rythme des ventes des 30 derniers jours.
 * null : ventes pas encore chargées ; undefined : aucune vente (pas de
 * prévision trompeuse) ; sinon un nombre de jours arrondi.
 */
export function coverageDays(quantity: number, sold30d: number | null): number | null | undefined {
  if (sold30d === null) return null
  if (sold30d <= 0) return undefined
  return Math.round(quantity / (sold30d / 30))
}

export function ProductTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="h-10 bg-muted" />
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t px-3 py-2.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function ProductTable({
  products, thresholdFor, statusFor, soldQty, expiryFor, isPromoActive, promoStale, promoSuggestion,
  formatPrice, isOwner, canWriteStock, canOrderStock, busy, selectedIds, onToggleSelect, onToggleSelectMany,
  sort, onSortChange, columns, onOrder, onRestock, onEdit, onPromo, onBatches, onArchive,
}: ProductTableProps) {
  const t = useTranslations()
  const show = (key: ProductColumnKey) => columns.includes(key)

  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const effectivePrice = (p: Product) => (isPromoActive(p) && p.promo_price ? p.promo_price : p.selling_price)
    const value = (p: Product): string | number => {
      switch (sort.key) {
        case 'name': return p.name
        case 'sku': return p.sku || ''
        case 'price': return effectivePrice(p)
        case 'quantity': return p.quantity
        case 'sold': return soldQty(p) ?? -1
        case 'status': return STATUS_RANK[statusFor(p)]
        case 'category': return p.categories?.name || ''
        case 'supplier': return p.suppliers?.name || ''
        case 'cost': return Number(p.buying_price || 0)
        case 'stockValue': return Number(p.quantity) * Number(p.buying_price || 0)
        case 'coverage': { const c = coverageDays(p.quantity, soldQty(p)); return c == null ? Number.MAX_SAFE_INTEGER : c }
      }
    }
    return [...products].sort((a, b) => {
      const va = value(a), vb = value(b)
      const cmp = typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb, undefined, { sensitivity: 'base', numeric: true })
        : (va as number) - (vb as number)
      // Égalité : nom, pour un ordre stable et lisible
      return (cmp || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })) * (cmp ? dir : 1)
    })
  }, [products, sort, isPromoActive, soldQty, statusFor])

  const ids = rows.map(p => p.id)
  const selectedHere = ids.filter(id => selectedIds.has(id)).length
  const allSelected = ids.length > 0 && selectedHere === ids.length
  const headerCheckbox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = selectedHere > 0 && !allSelected
  }, [selectedHere, allSelected])

  const toggleSort = (key: ProductSortKey) => {
    const textual = key === 'name' || key === 'sku' || key === 'category' || key === 'supplier'
    if (sort.key === key) onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else onSortChange({ key, dir: textual ? 'asc' : 'desc' })
  }

  // Fonction de rendu (pas un composant défini dans le rendu : il serait
  // recréé à chaque rendu et le bouton de tri perdrait le focus clavier)
  const renderHeader = ({ sortKey, label, align = 'left', className, title }: { sortKey?: ProductSortKey; label: string; align?: 'left' | 'right'; className?: string; title?: string }) => {
    const active = sortKey && sort.key === sortKey
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        title={title}
        className={cn('whitespace-nowrap px-2.5 py-2.5 text-left font-medium', align === 'right' && 'text-right', className)}
      >
        {sortKey ? (
          <button
            type="button"
            onClick={() => toggleSort(sortKey)}
            className={cn('inline-flex items-center gap-1 rounded hover:text-foreground', active && 'text-foreground')}
          >
            {label}
            <Icon className={cn('h-3 w-3', !active && 'opacity-50')} />
          </button>
        ) : label}
      </th>
    )
  }

  const statusLabel: Record<ProductStatus, string> = {
    out: t('status.out_of_stock'),
    low: t('status.low_stock'),
    dormant: t('products.card_dormant'),
    ok: t('status.in_stock'),
  }
  const dash = <span className="text-muted-foreground/50">—</span>

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-9 bg-muted px-2.5 py-2.5">
              <input
                ref={headerCheckbox}
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-border accent-stockshop-blue"
                checked={allSelected}
                onChange={() => onToggleSelectMany(ids, !allSelected)}
                aria-label={allSelected ? t('products.deselect_all') : t('products.select_all')}
              />
            </th>
            {renderHeader({ sortKey: 'name', label: t('products.col_product'), className: 'sticky left-9 z-10 bg-muted' })}
            {renderHeader({ sortKey: 'sku', label: t('products.col_sku'), className: 'hidden sm:table-cell' })}
            {show('category') && renderHeader({ sortKey: 'category', label: t('products.col_category') })}
            {show('supplier') && renderHeader({ sortKey: 'supplier', label: t('products.col_supplier') })}
            {renderHeader({ sortKey: 'price', label: t('products.col_price'), align: 'right' })}
            {show('cost') && renderHeader({ sortKey: 'cost', label: t('products.col_cost'), align: 'right' })}
            {renderHeader({ sortKey: 'quantity', label: t('products.col_available'), align: 'right' })}
            {show('physical') && renderHeader({ label: t('products.col_physical'), align: 'right' })}
            {show('stockValue') && renderHeader({ sortKey: 'stockValue', label: t('products.col_stock_value'), align: 'right' })}
            {renderHeader({ sortKey: 'sold', label: t('products.col_sales_30d'), align: 'right' })}
            {show('coverage') && renderHeader({ sortKey: 'coverage', label: t('products.col_coverage'), align: 'right', title: t('products.coverage_hint') })}
            {renderHeader({ sortKey: 'status', label: t('products.col_status') })}
            <th scope="col" className="px-2.5 py-2.5 text-right font-medium">{t('products.col_actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(product => {
            const selected = selectedIds.has(product.id)
            const threshold = thresholdFor(product)
            const status = statusFor(product)
            const promoActive = isPromoActive(product)
            const stale = promoActive && promoStale(product)
            const suggestion = !promoActive ? promoSuggestion(product) : null
            const expiry = expiryFor(product)
            const sold = soldQty(product)
            const coverage = coverageDays(product.quantity, sold)
            const stickyBg = selected ? 'bg-stockshop-blue-muted dark:bg-blue-950/60' : 'bg-card'
            const qtyTone = product.quantity === 0 ? 'text-red-500' : product.quantity <= threshold ? 'text-amber-500' : ''
            return (
              <tr
                key={product.id}
                className={cn('group border-t transition-colors', selected ? 'bg-stockshop-blue-muted/60 dark:bg-blue-950/25' : 'hover:bg-muted/40')}
              >
                <td className={cn('sticky left-0 z-10 w-9', CELL, stickyBg)}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded border-border accent-stockshop-blue"
                    checked={selected}
                    onChange={() => onToggleSelect(product.id)}
                    aria-label={product.name}
                  />
                </td>
                <td className={cn('sticky left-9 z-10 max-w-[220px] max-sm:border-r', CELL, stickyBg)}>
                  <div className="flex items-center gap-2.5">
                    <ProductThumbnail src={product.image_url} alt={product.name} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {product.categories?.color && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: product.categories.color }} aria-hidden="true" />
                        )}
                        <p className="truncate font-medium">{product.name}</p>
                      </div>
                      {product.sku && <p className="truncate font-mono text-[10px] text-muted-foreground sm:hidden">{product.sku}</p>}
                      {(promoActive || expiry?.expired || expiry?.soon) && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {promoActive && (
                            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', stale ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400')}>
                              {stale ? t('products.promo_stale_badge') : t('products.promo_badge')}
                            </span>
                          )}
                          {expiry?.expired && (
                            <button type="button" onClick={() => onBatches(product)} className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:opacity-80 dark:bg-red-950/40 dark:text-red-400">
                              {t('products.expired_badge')}
                            </button>
                          )}
                          {expiry?.soon && (
                            <button type="button" onClick={() => onBatches(product)} className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 hover:opacity-80 dark:bg-orange-950/40 dark:text-orange-400">
                              {t('products.expiring_badge', { date: new Date(expiry.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn('hidden whitespace-nowrap font-mono text-xs text-muted-foreground sm:table-cell', CELL)}>
                  {product.sku || dash}
                </td>
                {show('category') && (
                  <td className={cn('whitespace-nowrap', CELL)}>
                    {product.categories?.name ? (
                      <span className="inline-flex items-center gap-1.5">
                        {product.categories.color && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: product.categories.color }} aria-hidden="true" />}
                        {product.categories.name}
                      </span>
                    ) : dash}
                  </td>
                )}
                {show('supplier') && (
                  <td className={cn('max-w-[180px] truncate', CELL)}>{product.suppliers?.name || dash}</td>
                )}
                <td className={CELL_NUM}>
                  {promoActive && product.promo_price ? (
                    <div className="flex flex-col items-end leading-tight">
                      <span className="font-semibold text-stockshop-blue dark:text-blue-400">{formatPrice(product.promo_price)}</span>
                      <span className="text-xs text-muted-foreground line-through">{formatPrice(product.selling_price)}</span>
                    </div>
                  ) : (
                    <span className="font-semibold">{formatPrice(product.selling_price)}</span>
                  )}
                </td>
                {show('cost') && (
                  <td className={cn(CELL_NUM, 'text-muted-foreground')}>{formatPrice(product.buying_price)}</td>
                )}
                <td className={CELL_NUM}>
                  <span className={cn('font-semibold', qtyTone)}>{product.quantity}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{product.unit}</span>
                </td>
                {show('physical') && (
                  // Pas encore de stock réservé : physique = disponible (étape suivante)
                  <td className={cn(CELL_NUM, 'text-muted-foreground')}>{product.quantity}</td>
                )}
                {show('stockValue') && (
                  <td className={CELL_NUM}>{formatPrice(Number(product.quantity) * Number(product.buying_price || 0))}</td>
                )}
                <td className={CELL_NUM}>
                  {sold === null ? dash : <span className={cn(sold === 0 && product.quantity > 0 && 'text-muted-foreground')}>{sold}</span>}
                </td>
                {show('coverage') && (
                  <td className={CELL_NUM} title={coverage === undefined ? t('products.coverage_none') : t('products.coverage_hint')}>
                    {coverage == null ? dash : <span className={cn(coverage <= 7 && 'font-semibold text-amber-600 dark:text-amber-400')}>{coverage} j</span>}
                  </td>
                )}
                <td className={cn('whitespace-nowrap', CELL)}>
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CHIP[status])}>
                    {statusLabel[status]}
                  </span>
                </td>
                <td className={cn('whitespace-nowrap text-right', CELL)}>
                  <div className="inline-flex items-center gap-0.5">
                    <Button variant="outline" size="sm" className={ICON_BTN} disabled={busy} title={t('actions.restock')} onClick={() => onRestock(product)}>
                      <ArrowDown className="h-3 w-3" />
                      <span className="sr-only">{t('actions.restock')}</span>
                    </Button>
                    {canWriteStock && (
                      <Button variant="outline" size="sm" className={ICON_BTN} disabled={busy} title={t('products.edit_title')} onClick={() => onEdit(product)}>
                        <Edit2 className="h-3 w-3" />
                        <span className="sr-only">{t('products.edit_title')}</span>
                      </Button>
                    )}
                    {canWriteStock && (
                      <Button
                        variant="outline" size="sm"
                        className={cn(ICON_BTN, stale ? 'border-red-300 text-red-600 dark:border-red-700 dark:text-red-400' : promoActive ? 'border-stockshop-blue/20 text-stockshop-blue dark:border-blue-800 dark:text-blue-400' : suggestion ? 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400' : '')}
                        disabled={busy}
                        title={stale ? t('products.promo_stale_hint') : suggestion ?? t('products.promo_action')}
                        onClick={() => onPromo(product)}
                      >
                        <Tag className="h-3 w-3" />
                        <span className="sr-only">{t('products.promo_action')}</span>
                      </Button>
                    )}
                    {/* Actions secondaires dans un menu : la colonne reste étroite */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className={cn(ICON_BTN, 'text-muted-foreground')} disabled={busy} title={t('products.more_actions')}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">{t('products.more_actions')}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[180px]">
                        {canOrderStock && product.quantity <= threshold && (
                          <DropdownMenuItem onClick={() => onOrder(product)}>
                            <ShoppingCart className="mr-2 h-3.5 w-3.5" /> {t('actions.order')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => onBatches(product)}>
                          <History className="mr-2 h-3.5 w-3.5" /> {t('products.view_batches')}
                        </DropdownMenuItem>
                        {isOwner && (
                          <DropdownMenuItem onClick={() => onArchive(product)} className="text-amber-700 focus:text-amber-700 dark:text-amber-400 dark:focus:text-amber-400">
                            <Archive className="mr-2 h-3.5 w-3.5" /> {t('products.archive_label')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
