'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard, ShoppingCart, Package, BarChart2, Settings,
  Users, Truck, CreditCard, History, LogOut, ChevronRight, Zap,
  Store, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useState } from 'react'
import type { UserRole, Profile, Shop } from '@/lib/types/database'

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
  const { userShops, switchShop } = useAuthContext()
  const [shopPickerOpen, setShopPickerOpen] = useState(false)

  const navItems = [
    {
      section: null,
      items: [
        { href: `/${locale}/dashboard`, icon: LayoutDashboard, label: t('dashboard'), roles: ['owner', 'viewer', 'cashier', 'stock_manager'] },
      ],
    },
    {
      section: 'Sales',
      items: [
        { href: `/${locale}/sales/new`, icon: ShoppingCart, label: t('new_sale'), roles: ['owner', 'cashier'] },
        { href: `/${locale}/sales/history`, icon: History, label: t('sales_history'), roles: ['owner', 'cashier'] },
        { href: `/${locale}/payments`, icon: CreditCard, label: t('payments'), roles: ['owner'] },
        { href: `/${locale}/customers`, icon: Users, label: t('customers'), roles: ['owner', 'cashier'] },
      ],
    },
    {
      section: 'Inventory',
      items: [
        { href: `/${locale}/stock`, icon: Package, label: t('stock'), roles: ['owner', 'stock_manager'] },
        { href: `/${locale}/suppliers`, icon: Truck, label: t('suppliers'), roles: ['owner', 'stock_manager'] },
      ],
    },
    {
      section: 'Management',
      items: [
        { href: `/${locale}/reports`, icon: BarChart2, label: t('reports'), roles: ['owner'] },
        { href: `/${locale}/team`, icon: Users, label: t('team'), roles: ['owner'] },
        { href: `/${locale}/shops`, icon: Store, label: 'Boutiques', roles: ['owner'] },
        { href: `/${locale}/settings`, icon: Settings, label: t('settings'), roles: ['owner'] },
        { href: `/${locale}/billing`, icon: Zap, label: 'Abonnement', roles: ['owner'] },
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
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-white z-30">
      {/* Logo + Shop switcher */}
      <div className="border-b">
        <div className="flex h-16 items-center gap-3 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-northcode-blue text-white font-bold text-sm flex-shrink-0">
            NC
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-northcode-blue truncate">
              {shop?.name || 'NorthCode Stock'}
            </p>
            <p className="text-xs text-muted-foreground truncate">{shop?.city}</p>
          </div>
          {userShops.length > 1 && (
            <button
              onClick={() => setShopPickerOpen(o => !o)}
              className="flex-shrink-0 p-1 rounded hover:bg-gray-100 transition-colors"
              title="Changer de boutique"
            >
              <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
            </button>
          )}
        </div>
        {shopPickerOpen && userShops.length > 1 && (
          <div className="px-3 pb-3 space-y-1">
            {userShops.map(s => (
              <button
                key={s.id}
                onClick={() => { switchShop(s.id); setShopPickerOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  s.id === shop?.id
                    ? 'bg-northcode-blue-muted text-northcode-blue font-medium'
                    : 'hover:bg-gray-50 text-gray-700'
                )}
              >
                <Store className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{s.name}</span>
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
                        ? 'bg-northcode-blue-muted text-northcode-blue'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
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
