'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/use-auth'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { Header } from './header'
import { Skeleton } from '@/components/ui/skeleton'

// Singleton — évite les recréations
const supabase = createClient()

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
  for (const [key, value] of Object.entries(titles)) {
    if (path.startsWith(key)) return value
  }
  return 'NorthCode Stock'
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 space-y-4 pt-16">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-52 rounded-lg" />
      </div>
    </div>
  )
}

export function AppLayout({ children, locale }: { children: React.ReactNode; locale: string }) {
  const pathname = usePathname()
  const { user, profile, shop, loading } = useAuth()

  const handleSignOut = async () => {
    document.cookie = 'user_role=; path=/; max-age=0'
    await supabase.auth.signOut()
    window.location.href = `/${locale}/login`
  }

  // Safety net: if auth resolves with no user, redirect to login
  useEffect(() => {
    if (!loading && !user) {
      window.location.href = `/${locale}/login`
    }
  }, [loading, user, locale])

  const title = getPageTitle(pathname, locale)

  // Show skeleton while auth loads or profile not yet available
  if (loading || !profile) {
    return <LoadingSkeleton />
  }

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
        <Header title={title} shop={shop} locale={locale} onSignOut={handleSignOut} />
        <main className="flex-1 p-4 md:p-6 has-bottom-nav md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav locale={locale} role={profile.role} />
    </div>
  )
}
