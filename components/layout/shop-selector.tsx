'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, Layers, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { shopShortLabel } from '@/lib/shops/short-name'
import { ShopMark } from '@/components/shops/shop-mark'

interface ShopSelectorProps {
  /** 'sidebar' = dark gradient block (desktop sidebar). 'compact' = light button + dropdown (header, inline in pages). */
  variant: 'sidebar' | 'compact'
  /** Whether an "all shops" entry is offered. Off for flows that need one concrete shop (a sale, team management). */
  allowAllShops?: boolean
  className?: string
  /** Fired after switching to a concrete shop (not on "all shops") — e.g. to clear a shop-scoped cart. */
  onShopChange?: (shopId: string) => void
  /** Compact variant only — optional prefix shown before the shop name, e.g. "Selling at". */
  label?: string
  /** Compact variant only — short trigger for the mobile header: icon + SHORT context text
   *  (« Akwa ▾ » / « Toutes ▾ »), always readable — never an icon alone. The list shows full names. */
  iconOnly?: boolean
}

// Single source of truth for the shop switcher UI. State comes entirely from
// auth-context (dashboardShopFilter + switchShop) — no page keeps its own
// copy, so switching shop anywhere stays in sync everywhere.
export function ShopSelector({ variant, allowAllShops = true, className, onShopChange, label, iconOnly = false }: ShopSelectorProps) {
  const t = useTranslations('dashboard')
  const tScope = useTranslations('scope')
  const { userShops, shop, dashboardShopFilter, setDashboardShopFilter, switchShop } = useAuthContext()
  const [open, setOpen] = useState(false)

  const showingAll = allowAllShops && dashboardShopFilter === null && userShops.length > 1

  const selectShop = (id: string) => {
    setDashboardShopFilter(id)
    switchShop(id)
    setOpen(false)
    onShopChange?.(id)
  }

  const selectAll = () => {
    setDashboardShopFilter(null)
    setOpen(false)
  }

  if (variant === 'sidebar') {
    return (
      <div className={className}>
        <button
          onClick={() => userShops.length > 1 && setOpen(o => !o)}
          className={cn(
            'relative w-full flex items-center gap-2 px-4 pb-3 transition-colors text-left',
            userShops.length > 1 ? 'hover:bg-white/10 cursor-pointer' : 'cursor-default'
          )}
        >
          {/* Boutique : repère à ses couleurs et initiales (migration 191) ; « Toutes » : icône */}
          {showingAll
            ? <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0"><Layers className="h-3 w-3 text-white" /></div>
            : <ShopMark shop={shop} size="xs" className="h-5 w-5 ring-1 ring-white/40" />}
          <div className="min-w-0 flex-1">
            {showingAll ? (
              <p className="text-xs font-semibold text-blue-200 italic truncate leading-none">{t('all_shops')}</p>
            ) : (
              <>
                <p className="text-xs font-semibold text-white truncate leading-none">{shop?.name}</p>
                <p className="text-[10px] text-blue-200 truncate mt-0.5">{shop?.city}</p>
              </>
            )}
          </div>
          {userShops.length > 1 && (
            <ChevronDown className={cn('h-3.5 w-3.5 text-blue-200 flex-shrink-0 transition-transform', open && 'rotate-180')} />
          )}
        </button>

        {open && userShops.length > 1 && (
          <div className="px-3 pb-3 space-y-1 border-t border-white/10 pt-2">
            {allowAllShops && (
              <button
                onClick={selectAll}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  showingAll ? 'bg-white/20 text-white font-medium' : 'hover:bg-white/10 text-blue-200 hover:text-white'
                )}
              >
                <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate italic">{t('all_shops')}</span>
                {showingAll && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            )}
            {userShops.map(s => (
              <button
                key={s.id}
                onClick={() => selectShop(s.id)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  !showingAll && s.id === shop?.id
                    ? 'bg-white/20 text-white font-medium'
                    : 'hover:bg-white/10 text-blue-200 hover:text-white'
                )}
              >
                <ShopMark shop={s} size="xs" />
                <span className="truncate">{s.name}</span>
                {!showingAll && s.id === shop?.id && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── compact variant: light button + dropdown, for the mobile header and inline in pages ──
  if (userShops.length <= 1) return null

  const currentLabel = showingAll ? t('all_shops') : shop?.name

  // Menu déroulant commun (Radix) : se ferme avec retour Android, Échap ou un clic à côté ; navigation au clavier
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
    <div className={cn('relative', className)}>
      <DropdownMenuTrigger asChild>
      {iconOnly ? (
        // En-tête du téléphone : le contexte reste LISIBLE pendant le défilement (l'en-tête est collant) —
        // « Akwa ▾ » ou « Toutes ▾ », nom complet en info-bulle, pour les lecteurs d'écran et dans la liste
        <button
          aria-label={tScope('aria_context', { name: currentLabel ?? '' })}
          title={currentLabel}
          data-testid="header-shop-context"
          // Sans icône (31 oct. 2026, option B) : la marque StockShop est à gauche, la place va au nom de la boutique
          className="tap-target flex min-w-0 max-w-[10rem] items-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <span className="min-w-0 truncate">{showingAll ? tScope('all_short') : shopShortLabel(shop)}</span>
          <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      ) : (
        <button
          className="w-full flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
        >
          {showingAll
            ? <Layers className="h-4 w-4 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
            : <ShopMark shop={shop} size="xs" />
          }
          <span className="truncate">
            {label && <span className="font-normal text-muted-foreground">{label}: </span>}
            {currentLabel}
          </span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform ml-auto', open && 'rotate-180')} />
        </button>
      )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px] rounded-xl p-1.5" data-testid="header-shop-menu">
        {allowAllShops && (
          <DropdownMenuItem
            onSelect={selectAll}
            data-testid="header-shop-option"
            className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm',
              showingAll ? 'bg-stockshop-blue-muted font-medium text-stockshop-blue focus:bg-stockshop-blue-muted dark:bg-blue-950/40 dark:text-blue-400' : 'text-foreground/80')}
          >
            <Layers className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate italic">{t('all_shops')}</span>
            {showingAll && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
          </DropdownMenuItem>
        )}
        {userShops.map(s => {
          const current = !showingAll && s.id === shop?.id
          return (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => selectShop(s.id)}
              data-testid="header-shop-option"
              className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm',
                current ? 'bg-stockshop-blue-muted font-medium text-stockshop-blue focus:bg-stockshop-blue-muted dark:bg-blue-950/40 dark:text-blue-400' : 'text-foreground/80')}
            >
              <ShopMark shop={s} />
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                {s.city && <p className="truncate text-xs text-muted-foreground">{s.city}</p>}
              </div>
              {current && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </div>
    </DropdownMenu>
  )

}
