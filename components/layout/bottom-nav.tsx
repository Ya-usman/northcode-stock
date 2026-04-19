'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard, ShoppingCart, Package, BarChart2, Settings,
  MoreHorizontal, History, CreditCard, Users, Truck, Zap,
  X, LogOut, Store, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { UserRole } from '@/lib/types/database'
import { isBetaPeriod } from '@/lib/saas/plans'

interface BottomNavProps {
  locale: string
  role: UserRole
  onSignOut?: () => void
}

export function BottomNav({ locale, role, onSignOut }: BottomNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const allItems = [
    { href: `/${locale}/dashboard`,        icon: LayoutDashboard, label: t('dashboard'),     roles: ['super_admin', 'owner', 'viewer', 'cashier', 'stock_manager'], primary: true },
    { href: `/${locale}/sales/new`,        icon: ShoppingCart,    label: t('new_sale'),       roles: ['owner', 'cashier'],                            primary: true },
    { href: `/${locale}/stock`,            icon: Package,         label: t('stock'),          roles: ['owner', 'stock_manager'],                      primary: true },
    { href: `/${locale}/reports`,          icon: BarChart2,       label: t('reports'),        roles: ['owner'],                                       primary: true },
    { href: `/${locale}/sales/history`,    icon: History,         label: t('sales_history'),  roles: ['owner', 'cashier'],                            primary: false },
    { href: `/${locale}/payments`,         icon: CreditCard,      label: t('payments'),       roles: ['owner'],                                       primary: false },
    { href: `/${locale}/customers`,        icon: Users,           label: t('customers'),      roles: ['owner', 'cashier'],                            primary: false },
    { href: `/${locale}/categories`,        icon: Tag,             label: t('categories'),     roles: ['owner', 'stock_manager'],                      primary: false },
    { href: `/${locale}/suppliers`,        icon: Truck,           label: t('suppliers'),      roles: ['owner', 'stock_manager'],                      primary: false },
    { href: `/${locale}/team`,              icon: Users,           label: t('team'),           roles: ['owner'],                                       primary: false },
    { href: `/${locale}/shops`,            icon: Store,           label: t('shops'),          roles: ['owner'],                                       primary: false },
    ...(!isBetaPeriod() ? [{ href: `/${locale}/billing`, icon: Zap, label: t('billing'), roles: ['owner'], primary: false }] : []),
    { href: `/${locale}/settings`,         icon: Settings,        label: t('settings'),       roles: ['owner'],                                       primary: false },
  ].filter(item => item.roles.includes(role))

  const primaryItems = allItems.filter(i => i.primary)
  const moreItems = allItems.filter(i => !i.primary)

  return (
    <>
      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card safe-bottom md:hidden">
        <div className="flex h-16 items-stretch">
          {primaryItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                  isActive ? 'text-northcode-blue' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-northcode-blue')} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                {isActive && <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-northcode-blue" />}
              </Link>
            )
          })}

          {/* More button */}
          {moreItems.length > 0 && (
            <button
              onClick={() => setMoreOpen(o => !o)}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                moreOpen ? 'text-northcode-blue' : 'text-muted-foreground'
              )}
            >
              {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
              <span className="text-[10px] font-medium leading-none">Plus</span>
            </button>
          )}
        </div>
      </nav>

      {/* More drawer — slides up from bottom */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMoreOpen(false)}
          />

          {/* Panel */}
          <div className="fixed bottom-16 left-0 right-0 z-40 bg-card rounded-t-2xl shadow-2xl border-t md:hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="px-4 pt-4 pb-2">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

              <div className="grid grid-cols-4 gap-1">
                {moreItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl p-3 transition-colors',
                        isActive
                          ? 'bg-northcode-blue-muted text-northcode-blue dark:bg-blue-950 dark:text-blue-400'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                      <span className="text-[10px] font-medium leading-none text-center">{item.label}</span>
                    </Link>
                  )
                })}

                {/* Logout */}
                {onSignOut && (
                  <button
                    onClick={() => { setMoreOpen(false); onSignOut() }}
                    className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-5 w-5" />
                    <span className="text-[10px] font-medium leading-none">Déconnexion</span>
                  </button>
                )}
              </div>
            </div>
            {/* Safe area padding */}
            <div className="h-2" />
          </div>
        </>
      )}
    </>
  )
}
