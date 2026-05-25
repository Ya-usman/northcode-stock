'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, ShoppingBag, CreditCard, Package, Users,
  TrendingUp, LogOut, ChevronRight, ShieldCheck, Sun, Moon, UserCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useTheme } from '@/lib/hooks/use-theme'

interface AdminSidebarProps {
  locale: string
  userEmail: string
}

const navSections = (locale: string) => [
  {
    section: null,
    items: [
      { href: `/${locale}/admin`,           label: 'Command Center', icon: LayoutDashboard },
    ],
  },
  {
    section: 'Analytique',
    items: [
      { href: `/${locale}/admin/analytics`, label: 'Analytics',      icon: TrendingUp },
    ],
  },
  {
    section: 'Gestion',
    items: [
      { href: `/${locale}/admin/shops`,     label: 'Boutiques',      icon: ShoppingBag },
      { href: `/${locale}/admin/managers`,  label: 'Responsables',   icon: Users },
      { href: `/${locale}/admin/stock`,     label: 'Stock',          icon: Package },
      { href: `/${locale}/admin/payments`,  label: 'Paiements',      icon: CreditCard },
      { href: `/${locale}/admin/agents`,    label: 'Agents terrain', icon: UserCheck },
    ],
  },
]

export function AdminSidebar({ locale, userEmail }: AdminSidebarProps) {
  const pathname = usePathname()
  const { isDark, toggle } = useTheme()

  const isActive = (href: string) =>
    href === `/${locale}/admin`
      ? pathname === href
      : pathname.startsWith(href)

  const initials = (userEmail.split('@')[0] ?? 'A').slice(0, 2).toUpperCase()

  return (
    <aside className="hidden md:flex w-56 flex-col fixed inset-y-0 border-r bg-card z-30">
      {/* Gradient header */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/5" />
        <div className="absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/5" />

        {/* Logo row */}
        <div className="relative px-4 pt-5 pb-1 flex items-center gap-3">
          <img
            src="/logo-icon-t.png"
            alt="StockShop"
            className="h-10 w-10 object-contain brightness-0 invert flex-shrink-0"
          />
          <div className="flex flex-col leading-none">
            <span className="font-extrabold text-base text-white tracking-wide">StockShop</span>
            <span className="text-[9px] font-semibold text-white/60 tracking-widest uppercase">Platform</span>
          </div>
        </div>

        {/* Admin badge row */}
        <div className="relative flex items-center justify-between px-4 pb-4 pt-2">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="h-3 w-3 text-white" />
            </div>
            <p className="text-xs font-bold text-stockshop-gold tracking-wide">ADMIN PANEL</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Live status */}
            <div className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400" />
              </span>
              <span className="text-[8px] font-bold text-green-400 tracking-widest">LIVE</span>
            </div>
            {/* Theme toggle */}
            <button
              onClick={toggle}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
              title={isDark ? 'Mode clair' : 'Mode sombre'}
            >
              {isDark ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navSections(locale).map(({ section, items }) => (
          <div key={section || 'main'}>
            {section && (
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section}
              </p>
            )}
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-50 dark:bg-blue-950 text-stockshop-blue dark:text-blue-400'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                  {active && <ChevronRight className="ml-auto h-3 w-3" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-stockshop-gold/40"
            style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
          >
            <span className="text-white text-xs font-bold">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground font-medium truncate">{userEmail}</p>
            <span className="inline-flex items-center gap-1 mt-0.5">
              <ShieldCheck className="h-2.5 w-2.5 text-stockshop-gold" />
              <span className="text-[9px] font-bold text-stockshop-gold tracking-wide">SUPER ADMIN</span>
            </span>
          </div>
          <Link
            href={`/${locale}/dashboard`}
            title="Back to App"
            className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </aside>
  )
}
