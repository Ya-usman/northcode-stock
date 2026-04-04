'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, ShoppingCart, Package, BarChart2, Settings } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { UserRole } from '@/lib/types/database'

interface BottomNavProps {
  locale: string
  role: UserRole
}

export function BottomNav({ locale, role }: BottomNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()

  const items = [
    {
      href: `/${locale}/dashboard`,
      icon: LayoutDashboard,
      label: t('dashboard'),
      roles: ['owner', 'viewer', 'cashier', 'stock_manager'],
    },
    {
      href: `/${locale}/sales/new`,
      icon: ShoppingCart,
      label: t('new_sale'),
      roles: ['owner', 'cashier'],
    },
    {
      href: `/${locale}/stock`,
      icon: Package,
      label: t('stock'),
      roles: ['owner', 'stock_manager'],
    },
    {
      href: `/${locale}/reports`,
      icon: BarChart2,
      label: t('reports'),
      roles: ['owner'],
    },
    {
      href: `/${locale}/settings`,
      icon: Settings,
      label: t('settings'),
      roles: ['owner'],
    },
  ].filter(item => item.roles.includes(role))

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white safe-bottom md:hidden">
      <div className="flex h-16 items-stretch">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors tap-target',
                isActive
                  ? 'text-northcode-blue'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn('h-5 w-5', isActive && 'text-northcode-blue')}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-northcode-blue" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
