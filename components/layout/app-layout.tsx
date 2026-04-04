'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { Header } from './header'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { Profile, Shop } from '@/lib/types/database'

interface AppLayoutProps {
  children: React.ReactNode
  profile: Profile
  shop: Shop | null
  locale: string
  userEmail: string
}

function getPageTitle(pathname: string, locale: string): string {
  const path = pathname.replace(`/${locale}`, '')
  const titles: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/sales/new': 'Point of Sale',
    '/sales/history': 'Sales History',
    '/stock': 'Stock',
    '/stock/movements': 'Stock Movements',
    '/payments': 'Payments',
    '/customers': 'Customers',
    '/suppliers': 'Suppliers',
    '/reports': 'Reports',
    '/team': 'Team',
    '/settings': 'Settings',
  }
  // Find matching path
  for (const [key, value] of Object.entries(titles)) {
    if (path.startsWith(key)) return value
  }
  return 'NorthCode Stock'
}

export function AppLayout({ children, profile, shop, locale, userEmail }: AppLayoutProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push(`/${locale}/login`)
  }

  const title = getPageTitle(pathname, locale)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <Sidebar
        locale={locale}
        role={profile.role}
        profile={profile}
        shop={shop}
        onSignOut={handleSignOut}
      />

      {/* Main content */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        <Header title={title} shop={shop} locale={locale} />

        <main className="flex-1 p-4 md:p-6 has-bottom-nav md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav locale={locale} role={profile.role} />
    </div>
  )
}
