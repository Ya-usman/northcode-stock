'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, Package, PackagePlus, ArrowRightLeft, ArrowLeftRight, ClipboardCheck, CalendarClock } from 'lucide-react'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'

// Barre d'onglets du module Stock. Chaque onglet reste une route à part (code simple, URL stables et partageables) ;
// la barre latérale et la barre du bas n'ont qu'une entrée « Stock », qui mène à la Vue d'ensemble. Chaque onglet
// garde la permission de sa page.
//
// Posée UNE FOIS par la mise en page du module (app/[locale]/(app)/stock/layout.tsx) : elle reste en place d'un
// onglet à l'autre (validé le 30 oct. 2026). Comportement (fond qui glisse, actif dès le toucher, bords estompés) :
// composant commun SegmentedTabs. Masquée hors des pages d'onglet (ex. réception d'un transfert).
export function StockTabs({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { canAccess } = useRolePermissions()
  const { userShops } = useAuth()

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
    // Produits à commander, regroupés par fournisseur (étape 12) : mêmes droits que le Stock pour consulter
    { href: `/${locale}/stock/replenishment`, label: t('replenishment'), icon: PackagePlus, show: canAccess('stock' as PermFeature) },
  ].filter(tab => tab.show)

  if (tabs.length <= 1 || !tabs.some(tab => tab.href === pathname)) return null

  return (
    <SegmentedTabs
      testId="stock-tabs"
      value={pathname}
      items={tabs.map(tab => ({
        key: tab.href, href: tab.href, label: tab.label, icon: tab.icon,
        // Repère des tours guidés : stock-tab-products, stock-tab-expiry…
        attrs: { 'data-tour': `stock-tab-${tab.href.split('/').slice(3).join('-') || 'overview'}` },
      }))}
    />
  )
}
