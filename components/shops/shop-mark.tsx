'use client'

import { cn } from '@/lib/utils/cn'
import { SHOP_COLOR_CLASSES, shopColorOf, shopInitials } from '@/lib/shops/colors'
import { shopShortLabel } from '@/lib/shops/short-name'

type ShopLike = { id?: string | null; name?: string | null; short_name?: string | null; entity_name?: string | null; color?: string | null }

// Repère visuel d'une boutique (31 oct. 2026, migration 191) : carré arrondi aux initiales dans la couleur de la
// boutique (« AK » sur sarcelle), ou simple point. Décoratif : le nom de la boutique est toujours écrit à côté.
export function ShopMark({ shop, size = 'sm', className }: { shop: ShopLike | null | undefined; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const color = SHOP_COLOR_CLASSES[shopColorOf(shop)]
  const dims = size === 'xs' ? 'h-4 w-4 text-[8px] rounded' : size === 'md' ? 'h-9 w-9 text-xs rounded-lg' : 'h-6 w-6 text-[10px] rounded-md'
  return (
    <span aria-hidden="true" data-shop-mark={shopColorOf(shop)}
      className={cn('inline-flex shrink-0 select-none items-center justify-center font-bold leading-none tracking-tight', dims, color.solid, className)}>
      {shopInitials(shopShortLabel(shop))}
    </span>
  )
}

export function ShopDot({ shop, className }: { shop: ShopLike | null | undefined; className?: string }) {
  return <span aria-hidden="true" data-shop-dot={shopColorOf(shop)} className={cn('inline-block h-2 w-2 shrink-0 rounded-full', SHOP_COLOR_CLASSES[shopColorOf(shop)].dot, className)} />
}
