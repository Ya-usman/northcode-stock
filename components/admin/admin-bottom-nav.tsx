'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, ShoppingBag, CreditCard, Package, Users,
  TrendingUp, MoreHorizontal, X, LogOut, Sun, Moon, UserCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useTheme } from '@/lib/hooks/use-theme'

interface AdminBottomNavProps {
  locale: string
}

export function AdminBottomNav({ locale }: AdminBottomNavProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const { isDark, toggle } = useTheme()

  const primaryItems = [
    { href: `/${locale}/admin`,           label: 'Command Center', icon: LayoutDashboard },
    { href: `/${locale}/admin/shops`,     label: 'Boutiques',      icon: ShoppingBag },
    { href: `/${locale}/admin/managers`,  label: 'Responsables',   icon: Users },
    { href: `/${locale}/admin/payments`,  label: 'Paiements',      icon: CreditCard },
  ]

  const moreItems = [
    { href: `/${locale}/admin/analytics`, label: 'Analytics',  icon: TrendingUp },
    { href: `/${locale}/admin/stock`,     label: 'Stock',       icon: Package },
    { href: `/${locale}/admin/agents`,    label: 'Agents',      icon: UserCheck },
  ]

  const isActive = (href: string) =>
    href === `/${locale}/admin`
      ? pathname === href
      : pathname.startsWith(href)

  return (
    <>
      {/* Bottom bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card safe-bottom md:hidden">
        <div className="flex h-16 items-stretch">
          {primaryItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                  active ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'text-stockshop-blue dark:text-blue-400')} strokeWidth={active ? 2.5 : 2} />
                <span className="text-[10px] font-medium leading-none text-center">{label}</span>
                {active && <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-blue-600 dark:bg-blue-400" />}
              </Link>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(o => !o)}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
              moreOpen ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground'
            )}
          >
            {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
            <span className="text-[10px] font-medium leading-none">Plus</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed bottom-16 left-0 right-0 z-40 bg-card rounded-t-2xl shadow-2xl border-t md:hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="px-4 pt-4 pb-2">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-3" />
              {/* Mini header */}
              <div className="flex items-center gap-2 mb-4 px-1">
                <img src="/logo-icon-t.png" alt="StockShop" className="h-7 w-7 object-contain dark:brightness-0 dark:invert flex-shrink-0" />
                <div className="flex flex-col leading-none">
                  <span className="text-xs font-bold text-foreground">StockShop</span>
                  <span className="text-[9px] font-semibold text-stockshop-gold tracking-widest uppercase">Admin Panel</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {moreItems.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href)
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl p-3 transition-colors',
                        active
                          ? 'bg-blue-50 dark:bg-blue-950 text-stockshop-blue dark:text-blue-400'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                      <span className="text-[10px] font-medium leading-none text-center">{label}</span>
                    </Link>
                  )
                })}

                <Link
                  href={`/${locale}/dashboard`}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="text-[10px] font-medium leading-none text-center">App</span>
                </Link>

                <button
                  onClick={() => { toggle(); setMoreOpen(false) }}
                  className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  <span className="text-[10px] font-medium leading-none text-center">{isDark ? 'Clair' : 'Sombre'}</span>
                </button>
              </div>
            </div>
            <div className="h-2" />
          </div>
        </>
      )}
    </>
  )
}
