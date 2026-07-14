'use client'

import { usePathname } from 'next/navigation'
import { OfflineLink as Link } from '@/components/ui/offline-link'
import { useTranslations } from 'next-intl'
import { Package, ArrowLeftRight, ClipboardCheck } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { useOffline } from '@/lib/offline/use-offline'
import { cn } from '@/lib/utils/cn'

const INVENTORY_COUNT_ROLES = ['owner', 'super_admin', 'manager', 'shop_manager', 'stock_manager']

// Shared tab bar for the 3 pages that together make up "Stock" (Produits,
// Mouvements, Inventaire physique) — they stay separate routes (simpler code,
// stable/shareable URLs) but present as one unified section, so the sidebar/
// bottom-nav only need a single "Stock" entry point.
export function StockTabs({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { profile, roleInActiveShop } = useAuth()
  const { canAccess } = useRolePermissions()
  const { isOnline } = useOffline()
  const role = roleInActiveShop ?? profile?.role

  const tabs = [
    { href: `/${locale}/stock`, label: t('stock'), icon: Package, show: canAccess('stock' as PermFeature) },
    { href: `/${locale}/stock/movements`, label: t('movements'), icon: ArrowLeftRight, show: canAccess('movements' as PermFeature) },
    {
      href: `/${locale}/stock/inventory-count`,
      label: t('inventory_count'),
      icon: ClipboardCheck,
      show: INVENTORY_COUNT_ROLES.includes(role || '') && canAccess('inventory_count' as PermFeature),
    },
  ].filter(tab => tab.show)

  if (tabs.length <= 1) return null

  return (
    <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit flex-wrap">
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            isOnline={isOnline}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5',
              isActive ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
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
