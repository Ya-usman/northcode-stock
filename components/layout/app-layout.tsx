'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { Header } from './header'
import { Skeleton } from '@/components/ui/skeleton'
import { TrialBanner } from '@/components/saas/trial-banner'
import { UpgradeWall } from '@/components/saas/upgrade-wall'
import { PlanLimitAlert } from '@/components/saas/plan-limit-alert'
import { getTrialDaysLeft, hasActiveSubscription, isAccessAllowed, isBetaPeriod } from '@/lib/saas/plans'

const supabase = createClient()

function getPageTitle(pathname: string, locale: string): string {
  const path = pathname.replace(`/${locale}`, '')
  const titles: Record<string, string> = {
    '/dashboard': 'Dashboard',
    '/sales/new': 'Point of Sale',
    '/sales/history': 'Sales History',
    '/stock': 'Stock',
    '/stock/movements': 'Stock Movements',
    '/payments': 'Dettes',
    '/customers': 'Customers',
    '/suppliers': 'Suppliers',
    '/reports': 'Reports',
    '/team': 'Team',
    '/settings': 'Settings',
    '/billing': 'Billing',
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
  const { user, profile, shop, loading, signOut } = useAuthContext()
  const [productCount, setProductCount] = useState(0)
  const [teamCount, setTeamCount] = useState(0)

  const handleSignOut = () => signOut()

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = `/${locale}/login`
    }
  }, [loading, user, locale])

  // Fetch counts for plan limit checks (owner only)
  useEffect(() => {
    if (!shop?.id || profile?.role !== 'owner') return
    Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true),
    ]).then(([{ count: pCount }, { count: tCount }]) => {
      setProductCount(pCount || 0)
      setTeamCount(tCount || 0)
    })
  }, [shop?.id, profile?.role])

  if (loading) return <LoadingSkeleton />

  // Profile not found after loading — redirect to login
  if (!profile) {
    if (typeof window !== 'undefined') {
      window.location.href = `/${locale}/login`
    }
    return <LoadingSkeleton />
  }

  const beta = isBetaPeriod()
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at ?? null)
  const subscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  // Don't show upgrade wall if shop hasn't loaded yet
  const accessAllowed = !shop || isAccessAllowed(shop.plan ?? null, shop.trial_ends_at ?? null, shop.plan_expires_at ?? null)
  const showTrialBanner = !beta && !subscribed && accessAllowed && trialDaysLeft <= 7 && profile.role === 'owner'
  const isBillingPage = pathname.includes('/billing')
  const title = getPageTitle(pathname, locale)

  return (
    <div className="min-h-screen bg-gray-50">
      {!beta && !accessAllowed && !isBillingPage && (
        <UpgradeWall locale={locale} shopName={shop?.name} />
      )}

      <Sidebar locale={locale} role={profile.role} profile={profile} shop={shop} onSignOut={handleSignOut} />

      <div className="md:pl-64 flex flex-col min-h-screen">
        {showTrialBanner && <TrialBanner daysLeft={trialDaysLeft} locale={locale} />}

        <Header title={title} shop={shop} locale={locale} onSignOut={handleSignOut} />

        {/* Plan limit alert — masqué pendant la période bêta */}
        {!beta && profile.role === 'owner' && accessAllowed && !isBillingPage && (
          <PlanLimitAlert
            currentPlan={shop?.plan ?? null}
            productCount={productCount}
            teamMemberCount={teamCount}
            locale={locale}
          />
        )}

        <main className="flex-1 p-4 md:p-6 has-bottom-nav md:pb-6">
          {children}
        </main>
      </div>

      <BottomNav locale={locale} role={profile.role} onSignOut={handleSignOut} />
    </div>
  )
}
