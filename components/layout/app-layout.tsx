'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

function usePageTitle(pathname: string, locale: string) {
  const t = useTranslations()
  const path = pathname.replace(`/${locale}`, '')
  const map: Record<string, string> = {
    '/dashboard': t('dashboard.title'),
    '/sales/new': t('sales.new_title'),
    '/sales/history': t('sales.history_title'),
    '/stock/movements': t('movements.title'),
    '/stock': t('products.title'),
    '/payments': t('nav.payments'),
    '/customers': t('customers.title'),
    '/categories': t('categories.title'),
    '/suppliers': t('suppliers.title'),
    '/reports': t('reports.title'),
    '/team': t('team.title'),
    '/settings': t('settings.title'),
    '/billing': t('nav.billing'),
    '/shops': t('shops.title'),
  }
  for (const [key, value] of Object.entries(map)) {
    if (path.startsWith(key)) return value
  }
  return t('app.name')
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
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
  const title = usePageTitle(pathname, locale)
  const [productCount, setProductCount] = useState(0)
  const [teamCount, setTeamCount] = useState(0)

  const handleSignOut = () => signOut()

  // Redirect handled in render below (avoids double redirect race)

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

  // Not authenticated — redirect to login
  if (!user) {
    if (typeof window !== 'undefined') {
      window.location.href = `/${locale}/login`
    }
    return <LoadingSkeleton />
  }

  // Auth user exists but profile missing — registration was incomplete
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-foreground">Configuration incomplète</h2>
          <p className="text-sm text-muted-foreground">
            Votre profil n&apos;a pas pu être chargé. Veuillez vous déconnecter et recréer votre compte.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Réessayer
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = `/${locale}/login`
              }}
              className="w-full rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 transition-colors"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    )
  }

  const beta = isBetaPeriod()
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at ?? null)
  const subscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  // Don't show upgrade wall if shop hasn't loaded yet
  const accessAllowed = !shop || isAccessAllowed(shop.plan ?? null, shop.trial_ends_at ?? null, shop.plan_expires_at ?? null)
  const showTrialBanner = !beta && !subscribed && accessAllowed && trialDaysLeft <= 7 && profile.role === 'owner'
  const isBillingPage = pathname.includes('/billing')

  return (
    <div className="min-h-screen bg-background">
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
