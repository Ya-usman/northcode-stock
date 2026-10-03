'use client'

import { memo, type KeyboardEvent, type MouseEvent } from 'react'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import type { Product } from '@/lib/types/database'

export type StockVariant = 'destructive' | 'warning' | 'success'

interface ProductCardProps {
  product: Product
  /** Prix effectif (promo lot ou produit comprise). */
  price: number
  stockVariant: StockVariant
  isExpired: boolean
  currencyCode: string
  favoriteLabel: string
  expiredLabel: string
  onAdd: (product: Product) => void
  onToggleFavorite: (product: Product, e: MouseEvent) => void
  /** Rangée Favoris : tuile compacte à largeur fixe, étoile toujours pleine. */
  compact?: boolean
}

// Carte produit de « Nouvelle vente » — mémoïsée : tant que ses props ne
// changent pas (même objet produit, même prix, mêmes callbacks stables),
// une frappe dans la recherche ou un ajout au panier ne la redessine pas.
// Sur un téléphone d'entrée de gamme, redessiner 50 cartes à chaque lettre
// figeait l'écran ~360 ms (mesuré, CPU ralenti ×6).
function ProductCardImpl({
  product, price, stockVariant, isExpired, currencyCode, favoriteLabel, expiredLabel,
  onAdd, onToggleFavorite, compact = false,
}: ProductCardProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(product) }
  }
  const star = (
    // Zone tactile ~34 px autour d'une pastille visuelle inchangée
    <button
      type="button"
      onClick={e => onToggleFavorite(product, e)}
      className="absolute top-0 right-0 z-10 p-1.5 group"
      aria-label={favoriteLabel}
    >
      <span className="block rounded-full bg-black/45 p-1 group-hover:bg-black/60 transition-colors">
        <Star className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5', product.is_favorite || compact ? 'fill-amber-400 text-amber-400' : 'text-white/80')} />
      </span>
    </button>
  )

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onAdd(product)}
        onKeyDown={onKeyDown}
        className="relative flex-shrink-0 w-24 flex flex-col items-stretch text-left rounded-lg border bg-card overflow-hidden hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors tap-target cursor-pointer"
      >
        {star}
        <ProductThumbnail src={product.image_url} alt={product.name} className="w-full aspect-square rounded-none border-0" iconClassName="h-1/3 w-1/3" />
        <div className="p-1.5">
          <p className="text-[11px] font-medium truncate text-foreground">{product.name}</p>
          <p className="text-xs font-bold text-stockshop-blue dark:text-blue-400">{formatCurrency(price, currencyCode)}</p>
        </div>
      </div>
    )
  }

  const categoryColor = product.categories?.color
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAdd(product)}
      onKeyDown={onKeyDown}
      className="relative flex flex-col items-stretch text-left rounded-lg border bg-card overflow-hidden hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors tap-target cursor-pointer"
      style={categoryColor ? { borderTopColor: categoryColor, borderTopWidth: 3 } : undefined}
    >
      {star}
      <div className="relative">
        <ProductThumbnail src={product.image_url} alt={product.name} className="w-full aspect-square rounded-none border-0" iconClassName="h-1/3 w-1/3" />
        {/* Stock en pastille sur l'image (téléphone) — libère une ligne de texte */}
        <Badge variant={stockVariant} className="md:hidden absolute bottom-1 left-1 text-[10px] px-1.5 py-0 leading-4">
          {product.quantity}
        </Badge>
      </div>
      <div className="flex flex-col p-1.5 md:p-2.5">
        <p className="text-xs leading-tight font-medium line-clamp-2 min-h-[2rem] text-foreground md:text-sm md:leading-normal md:line-clamp-1 md:min-h-0">{product.name}</p>
        {product.sku && <p className="hidden md:block text-[10px] text-muted-foreground font-mono">{product.sku}</p>}
        {isExpired && (
          <span className="mt-0.5 inline-flex w-fit items-center text-[9px] md:text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
            {expiredLabel}
          </span>
        )}
        <div className="flex items-center justify-between w-full mt-1">
          {price !== product.selling_price ? (
            <span className="flex items-center gap-x-1 flex-wrap">
              <span className="text-[13px] md:text-sm font-bold text-stockshop-blue dark:text-blue-400">{formatCurrency(price, currencyCode)}</span>
              <span className="text-[9px] md:text-[10px] text-muted-foreground line-through">{formatCurrency(product.selling_price, currencyCode)}</span>
            </span>
          ) : (
            <span className="text-[13px] md:text-sm font-bold text-stockshop-blue dark:text-blue-400">{formatCurrency(product.selling_price, currencyCode)}</span>
          )}
          <Badge variant={stockVariant} className="hidden md:inline-flex text-[10px] px-1.5">
            {product.quantity} {product.unit}
          </Badge>
        </div>
      </div>
    </div>
  )
}

export const ProductCard = memo(ProductCardImpl)
