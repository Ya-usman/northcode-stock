'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { OfflineLink as Link } from '@/components/ui/offline-link'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, Package, ArrowRightLeft, ArrowLeftRight, ClipboardCheck, CalendarClock } from 'lucide-react'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useOffline } from '@/lib/offline/use-offline'
import { cn } from '@/lib/utils/cn'

// Barre d'onglets partagée par les pages qui forment le module Stock. Chaque
// onglet reste une route à part (code simple, URL stables et partageables) ;
// la barre latérale et la barre du bas n'ont qu'une entrée « Stock », qui
// mène à la Vue d'ensemble. Chaque onglet garde la permission de sa page.
// Une seule ligne, à défilement horizontal sur petit écran, l'onglet actif
// ramené en vue : huit onglets ne tiendront jamais sur un téléphone en
// s'enroulant.
export function StockTabs({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { canAccess } = useRolePermissions()
  const { userShops } = useAuth()
  const { isOnline } = useOffline()
  const listRef = useRef<HTMLDivElement>(null)

  const tabs = [
    { href: `/${locale}/stock`, label: t('overview'), icon: LayoutDashboard, show: canAccess('stock' as PermFeature) },
    { href: `/${locale}/stock/products`, label: t('products'), icon: Package, show: canAccess('stock' as PermFeature) },
    { href: `/${locale}/stock/movements`, label: t('movements'), icon: ArrowLeftRight, show: canAccess('movements' as PermFeature) },
    { href: `/${locale}/stock/expiry`, label: t('expiry'), icon: CalendarClock, show: canAccess('expiry_list' as PermFeature) },
    { href: `/${locale}/stock/inventory-count`, label: t('inventory_count'), icon: ClipboardCheck, show: canAccess('inventory_count' as PermFeature) },
    {
      // Sans intérêt pour un compte à une seule boutique — rien à transférer.
      href: `/${locale}/stock/transfers`,
      label: t('transfers'),
      icon: ArrowRightLeft,
      show: canAccess('transfers' as PermFeature) && userShops.length > 1,
    },
  ].filter(tab => tab.show)

  // Onglet actif visible, sans faire défiler la page elle-même
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !active) return
    const left = active.offsetLeft - 12
    const right = active.offsetLeft + active.offsetWidth + 12
    if (left < list.scrollLeft) list.scrollTo({ left, behavior: 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: 'smooth' })
  }, [pathname])

  if (tabs.length <= 1) return null

  return (
    <div
      ref={listRef}
      role="tablist"
      className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            // Repère des tours guidés : stock-tab-products, stock-tab-expiry…
            data-tour={`stock-tab-${tab.href.split('/').slice(3).join('-') || 'overview'}`}
            isOnline={isOnline}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
