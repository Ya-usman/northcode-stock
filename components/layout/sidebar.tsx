'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard, ShoppingCart, Package, BarChart2, Settings,
  Users, Truck, CreditCard, History, LogOut, ChevronRight, Zap,
  Store, ChevronDown, Tag, Check, Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useState } from 'react'
import type { UserRole, Profile, Shop } from '@/lib/types/database'
import { isBetaPeriod } from '@/lib/saas/plans'

interface SidebarProps {
  locale: string
  role: UserRole
  profile: Profile
  shop: Shop | null
  onSignOut: () => void
}

export function Sidebar({ locale, role, profile, shop, onSignOut }: SidebarProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { userShops, switchShop, dashboardShopFilter, setDashboardShopFilter } = useAuthContext()
  const [shopPickerOpen, setShopPickerOpen] = useState(false)

  const navItems = [
    {
      section: null,
      items: [
        { href: `/${locale}/dashboard`, icon: LayoutDashboard, label: t('dashboard'), roles: ['super_admin', 'owner', 'viewer', 'cashier', 'stock_manager'] },
      ],
    },
    {
      section: t('section_sales'),
      items: [
        { href: `/${locale}/sales/new`, icon: ShoppingCart, label: t('new_sale'), roles: ['owner', 'cashier'] },
        { href: `/${locale}/sales/history`, icon: History, label: t('sales_history'), roles: ['owner', 'cashier'] },
        { href: `/${locale}/payments`, icon: CreditCard, label: t('payments'), roles: ['owner'] },
        { href: `/${locale}/customers`, icon: Users, label: t('customers'), roles: ['owner', 'cashier'] },
      ],
    },
    {
      section: t('section_inventory'),
      items: [
        { href: `/${locale}/stock`, icon: Package, label: t('stock'), roles: ['owner', 'stock_manager'] },
        { href: `/${locale}/categories`, icon: Tag, label: t('categories'), roles: ['owner', 'stock_manager'] },
        { href: `/${locale}/suppliers`, icon: Truck, label: t('suppliers'), roles: ['owner', 'stock_manager'] },
      ],
    },
    {
      section: t('section_management'),
      items: [
        { href: `/${locale}/reports`, icon: BarChart2, label: t('reports'), roles: ['owner'] },
        { href: `/${locale}/team`, icon: Users, label: t('team'), roles: ['owner'] },
        { href: `/${locale}/shops`, icon: Store, label: t('shops'), roles: ['owner'] },
        { href: `/${locale}/settings`, icon: Settings, label: t('settings'), roles: ['owner'] },
        ...(!isBetaPeriod() ? [{ href: `/${locale}/billing`, icon: Zap, label: t('billing'), roles: ['owner'] }] : []),
      ],
    },
  ]

  const initials = profile.full_name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <aside className="hidden sm:flex sm:w-64 sm:flex-col sm:fixed sm:inset-y-0 border-r bg-card z-30">
      {/* Logo header — premium gradient */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/5" />
        <div className="absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/5" />

        {/* Logo */}
        <div className="relative px-4 pt-4 pb-3">
          <img
            src="/logo-full-t.png"
            alt="StockShop"
            className="h-14 w-auto object-contain brightness-0 invert"
          />
        </div>

        {/* Shop name row */}
        <button
          onClick={() => userShops.length > 1 && setShopPickerOpen(o => !o)}
          className={cn(
            'relative w-full flex items-center gap-2 px-4 pb-3 transition-colors text-left',
            userShops.length > 1 ? 'hover:bg-white/10 cursor-pointer' : 'cursor-default'
          )}
        >
          <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            {dashboardShopFilter === null && userShops.length > 1
              ? <Layers className="h-3 w-3 text-white" />
              : <Store className="h-3 w-3 text-white" />
            }
          </div>
          <div className="min-w-0 flex-1">
            {dashboardShopFilter === null && userShops.length > 1 ? (
              <p className="text-xs font-semibold text-blue-200 italic truncate leading-none">Toutes les boutiques</p>
            ) : (
              <>
                <p className="text-xs font-semibold text-white truncate leading-none">{shop?.name}</p>
                <p className="text-[10px] text-blue-200 truncate mt-0.5">{shop?.city}</p>
              </>
            )}
          </div>
          {userShops.length > 1 && (
            <ChevronDown className={cn('h-3.5 w-3.5 text-blue-200 flex-shrink-0 transition-transform', shopPickerOpen && 'rotate-180')} />
          )}
        </button>

        {shopPickerOpen && userShops.length > 1 && (
          <div className="px-3 pb-3 space-y-1 border-t border-white/10 pt-2">
            {/* All shops option */}
            <button
              onClick={() => { setDashboardShopFilter(null); setShopPickerOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                dashboardShopFilter === null
                  ? 'bg-white/20 text-white font-medium'
                  : 'hover:bg-white/10 text-blue-200 hover:text-white'
              )}
            >
              <Layers className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate italic">Toutes les boutiques</span>
              {dashboardShopFilter === null && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
            </button>
            {userShops.map(s => (
              <button
                key={s.id}
                onClick={() => { setDashboardShopFilter(s.id); switchShop(s.id); setShopPickerOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  s.id === dashboardShopFilter
                    ? 'bg-white/20 text-white font-medium'
                    : 'hover:bg-white/10 text-blue-200 hover:text-white'
                )}
              >
                <Store className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{s.name}</span>
                {s.id === dashboardShopFilter && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((section) => {
          const visibleItems = section.items.filter(item => item.roles.includes(role))
          if (visibleItems.length === 0) return null

          return (
            <div key={section.section || 'main'}>
              {section.section && (
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.section}
                </p>
              )}
              {visibleItems.map(item => {
                const Icon = item.icon
                const isActive = pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors tap-target',
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950 text-northcode-blue dark:text-blue-400'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {item.label}
                    {isActive && <ChevronRight className="ml-auto h-3 w-3" />}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-northcode-blue text-white text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{profile.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{profile.role.replace('_', ' ')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSignOut}
            title="Log out"
            className="h-8 w-8 flex-shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}
