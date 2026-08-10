'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { OfflineLink as Link } from '@/components/ui/offline-link'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard, ShoppingCart, Package, BarChart2, Settings,
  MoreHorizontal, History, CreditCard, Users, Truck, Zap,
  X, LogOut, Store, Tag, Receipt, ShieldCheck, NotebookPen, BookOpen, MessageCircle, Loader2, ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { UserRole } from '@/lib/types/database'
import { isBetaPeriod } from '@/lib/saas/plans'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { useOfflineRoutes } from '@/lib/offline/use-offline-routes'
import { useOffline } from '@/lib/offline/use-offline'

const SUPER_ADMIN_EMAILS = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

interface BottomNavProps {
  locale: string
  role: UserRole
  onSignOut?: () => void
  signingOut?: boolean
  userEmail?: string
  hasUnreadAnnouncement?: boolean
  crispUnread?: number
  onOpenChat?: () => void
}

const ALL_NON_OWNER = ['super_admin', 'owner', 'manager', 'shop_manager', 'cashier', 'viewer', 'stock_manager']

export function BottomNav({ locale, role, onSignOut, signingOut = false, userEmail = '', hasUnreadAnnouncement = false, crispUnread = 0, onOpenChat }: BottomNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const { canAccess } = useRolePermissions()
  const { isOnline } = useOffline()
  const { isOffline, isAvailable } = useOfflineRoutes(isOnline)

  const allItems = [
    { href: `/${locale}/dashboard`,       icon: LayoutDashboard, label: t('dashboard'),    roles: ['super_admin', 'owner', 'manager', 'shop_manager', 'viewer', 'cashier', 'stock_manager'], primary: true },
    { href: `/${locale}/sales/new`,       icon: ShoppingCart,    label: t('new_sale'),      roles: ALL_NON_OWNER, feature: 'new_sale' as PermFeature,       primary: true },
    { href: `/${locale}/stock`,           icon: Package,         label: t('stock'),         roles: ALL_NON_OWNER, feature: 'stock' as PermFeature,           primary: true },
    { href: `/${locale}/reports`,         icon: BarChart2,       label: t('reports'),       roles: ALL_NON_OWNER, feature: 'reports' as PermFeature,         primary: true },
    { href: `/${locale}/sales/history`,   icon: History,         label: t('sales_history'), roles: ALL_NON_OWNER, feature: 'sales_history' as PermFeature,   primary: false },
    { href: `/${locale}/payments`,        icon: CreditCard,      label: t('payments'),      roles: ALL_NON_OWNER, feature: 'payments' as PermFeature,        primary: false },
    { href: `/${locale}/customers`,       icon: Users,           label: t('customers'),     roles: ALL_NON_OWNER, feature: 'customers' as PermFeature,       primary: false },
    { href: `/${locale}/categories`,      icon: Tag,             label: t('categories'),    roles: ALL_NON_OWNER, feature: 'categories' as PermFeature,      primary: false },
    { href: `/${locale}/suppliers`,       icon: Truck,           label: t('suppliers'),     roles: ALL_NON_OWNER, feature: 'suppliers' as PermFeature,       primary: false },
    { href: `/${locale}/caisse`,   icon: ClipboardList, label: t('caisse'), roles: ['super_admin', 'owner', 'manager', 'shop_manager'], feature: 'caisse' as PermFeature, primary: false },
    { href: `/${locale}/notes`,    icon: NotebookPen, label: t('notes'),    roles: ALL_NON_OWNER, feature: 'notes' as PermFeature,    primary: false },
    { href: `/${locale}/expenses`, icon: Receipt,     label: t('expenses'), roles: ALL_NON_OWNER, feature: 'expenses' as PermFeature, primary: false },
    { href: `/${locale}/team`,            icon: Users,           label: t('team'),          roles: ['owner', 'manager', 'shop_manager'],                  primary: false },
    { href: `/${locale}/shops`,           icon: Store,           label: t('shops'),         roles: ['owner'],                                                primary: false },
    { href: `/${locale}/billing`,         icon: Zap,             label: t('billing'),       roles: ['owner'],                                                primary: false },
    { href: `/${locale}/settings`,        icon: Settings,        label: t('settings'),      roles: ['owner', 'manager'],                                     primary: false },
    { href: `/${locale}/help`,            icon: BookOpen,        label: t('help'),          roles: ALL_NON_OWNER,                                                primary: false },
  ].filter(item => item.roles.includes(role) && (!item.feature || canAccess(item.feature)))

  const primaryItems = allItems.filter(i => i.primary)
  const moreItems = allItems.filter(i => !i.primary)

  return (
    <>
      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card safe-bottom sm:hidden">
        <div className="flex h-16 items-stretch">
          {primaryItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const available = isAvailable(item.href)
            return (
              <Link
                key={item.href}
                href={available ? item.href : '#'}
                prefetch={true}
                isOnline={isOnline}
                onClick={(e) => { if (!available) e.preventDefault(); else setMoreOpen(false) }}
                aria-disabled={!available}
                title={!available && isOffline ? 'Non disponible hors ligne' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                  isActive ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground hover:text-foreground',
                  !available && 'opacity-35 pointer-events-none'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-stockshop-blue dark:text-blue-400')} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                {isActive && <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-blue-600 dark:bg-blue-400" />}
              </Link>
            )
          })}

          {/* More button */}
          {moreItems.length > 0 && (
            <button
              onClick={() => setMoreOpen(o => !o)}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                moreOpen ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground'
              )}
            >
              {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
              <span className="text-[10px] font-medium leading-none">{t('more')}</span>
            </button>
          )}
        </div>
      </nav>

      {/* More drawer — slides up from bottom */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/40 sm:hidden"
            onClick={() => setMoreOpen(false)}
          />

          {/* Panel */}
          <div className="fixed bottom-16 left-0 right-0 z-40 bg-card rounded-t-2xl shadow-2xl border-t sm:hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="px-4 pt-4 pb-2">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />

              <div className="grid grid-cols-4 gap-1">
                {moreItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                  const available = isAvailable(item.href)
                  const isHelp = item.href.endsWith('/help')
                  const showBadge = isHelp && hasUnreadAnnouncement
                  return (
                    <Link
                      key={item.href}
                      href={available ? item.href : '#'}
                      prefetch={true}
                      isOnline={isOnline}
                      onClick={(e) => { if (!available) e.preventDefault(); else setMoreOpen(false) }}
                      aria-disabled={!available}
                      title={!available && isOffline ? 'Non disponible hors ligne' : undefined}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl p-3 transition-colors',
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950 text-stockshop-blue dark:text-blue-400'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        !available && 'opacity-35 pointer-events-none'
                      )}
                    >
                      <div className="relative">
                        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                        {showBadge && (
                          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-1 ring-card" />
                        )}
                      </div>
                      <span className="text-[10px] font-medium leading-none text-center">{item.label}</span>
                    </Link>
                  )
                })}

                {/* Chat support */}
                {onOpenChat && (
                  <button
                    onClick={() => { setMoreOpen(false); onOpenChat() }}
                    className="relative flex flex-col items-center gap-1.5 rounded-xl p-3 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <div className="relative">
                      <MessageCircle className="h-5 w-5" />
                      {crispUnread > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                          {crispUnread > 9 ? '9+' : crispUnread}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-medium leading-none text-center">Support</span>
                  </button>
                )}

                {/* Admin Panel — super_admin uniquement */}
                {/* Use <a> (hard nav) to avoid client/server auth race condition */}
                {SUPER_ADMIN_EMAILS.includes(userEmail) && (
                  <a
                    href={`/${locale}/admin`}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-1.5 rounded-xl p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
                  >
                    <ShieldCheck className="h-5 w-5" />
                    <span className="text-[10px] font-medium leading-none text-center">Admin</span>
                  </a>
                )}

                {/* Logout */}
                {onSignOut && (
                  <button
                    onClick={() => { setMoreOpen(false); onSignOut() }}
                    disabled={signingOut}
                    className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {signingOut
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : <LogOut className="h-5 w-5" />
                    }
                    <span className="text-[10px] font-medium leading-none">{signingOut ? '…' : t('logout')}</span>
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
