'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, ChevronDown, Layers, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAuthContext } from '@/lib/contexts/auth-context'

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
  /** Compact variant only — trigger shrinks to a single icon button (no name/chevron), for cramped spots like the mobile header. The full list still opens with names. */
  iconOnly?: boolean
}

// Single source of truth for the shop switcher UI. State comes entirely from
// auth-context (dashboardShopFilter + switchShop) — no page keeps its own
// copy, so switching shop anywhere stays in sync everywhere.
export function ShopSelector({ variant, allowAllShops = true, className, onShopChange, label, iconOnly = false }: ShopSelectorProps) {
  const t = useTranslations('dashboard')
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
          <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            {showingAll ? <Layers className="h-3 w-3 text-white" /> : <Store className="h-3 w-3 text-white" />}
          </div>
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
                <Store className="h-3.5 w-3.5 flex-shrink-0" />
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

  return (
    <div className={cn('relative', className)}>
      {iconOnly ? (
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={currentLabel}
          className="relative h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {showingAll ? <Layers className="h-4 w-4" /> : <Store className="h-4 w-4" />}
          {!showingAll && (
            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-stockshop-blue dark:bg-blue-400 ring-1 ring-card" />
          )}
        </button>
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
        >
          {showingAll
            ? <Layers className="h-4 w-4 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
            : <Store className="h-4 w-4 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
          }
          <span className="truncate">
            {label && <span className="font-normal text-muted-foreground">{label}: </span>}
            {currentLabel}
          </span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform ml-auto', open && 'rotate-180')} />
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-xl border bg-card shadow-lg p-1.5">
            {allowAllShops && (
              <button
                onClick={selectAll}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  showingAll ? 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium' : 'hover:bg-accent text-foreground/80'
                )}
              >
                <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate italic">{t('all_shops')}</span>
              </button>
            )}
            {userShops.map(s => (
              <button
                key={s.id}
                onClick={() => selectShop(s.id)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
                  !showingAll && s.id === shop?.id
                    ? 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium'
                    : 'hover:bg-accent text-foreground/80'
                )}
              >
                <Store className="h-3.5 w-3.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{s.name}</p>
                  {s.city && <p className="text-xs text-muted-foreground truncate">{s.city}</p>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
