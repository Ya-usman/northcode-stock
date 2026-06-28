'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { Header } from './header'
import { NavigationProgress } from './navigation-progress'
import { OfflineBanner } from './offline-banner'
import { Skeleton } from '@/components/ui/skeleton'
import { TrialBanner } from '@/components/saas/trial-banner'
import { UpgradeWall } from '@/components/saas/upgrade-wall'
import { PlanLimitAlert } from '@/components/saas/plan-limit-alert'
import { getTrialDaysLeft, hasActiveSubscription, isAccessAllowed, isBetaPeriod } from '@/lib/saas/plans'
import { useToast } from '@/components/ui/use-toast'
import { triggerSaleFeedback, unlockAudio } from '@/lib/utils/sale-feedback'
import { useOfflinePreload } from '@/lib/offline/use-offline-preload'
import { useOffline } from '@/lib/offline/use-offline'
import { useOfflineRoutes } from '@/lib/offline/use-offline-routes'
import { SyncBanner } from './sync-banner'
import { CacheBanner } from './cache-banner'

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
    '/notes': t('nav.notes'),
    '/expenses': t('nav.expenses'),
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
  const router = useRouter()
  const { user, profile, shop, roleInActiveShop, loading, signOut } = useAuthContext()
  const title = usePageTitle(pathname, locale)
  const [productCount, setProductCount] = useState(0)
  const [teamCount, setTeamCount] = useState(0)
  const [authRecovering, setAuthRecovering] = useState(true)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { toast } = useToast()

  // Masquer le splash screen natif dès que l'auth est résolue.
  // launchAutoHide=false dans capacitor.config.ts : le splash reste visible
  // pendant tout le chargement initial (Vercel cold start + SW + JS bundles),
  // évitant la page blanche entre splash et premier rendu React.
  useEffect(() => {
    if (!loading && !authRecovering && Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})
    }
  }, [loading, authRecovering])

  // ── Auth recovery: quand user devient null après loading, attendre 2s avant
  // de rediriger — la race condition de token refresh peut causer un SIGNED_OUT
  // temporaire que le client Supabase résout en relisant les cookies mis à jour.
  useEffect(() => {
    if (loading) {
      setAuthRecovering(true)
      return
    }
    if (user) {
      setAuthRecovering(false)
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
      return
    }
    // !user && !loading : vérifier si on a un cache avant de rediriger
    const hasCachedAuth = typeof window !== 'undefined' && !!localStorage.getItem('auth_cache_v1')
    if (hasCachedAuth) {
      // Possible race condition — attendre que le client récupère la session
      recoveryTimerRef.current = setTimeout(() => setAuthRecovering(false), 2000)
    } else {
      setAuthRecovering(false)
    }
    return () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
    }
  }, [loading, user])

  // ── OFFLINE: preload data + auto-sync pending sales ───────────────────────
  useOfflinePreload()
  const { pendingCount, syncing, sync } = useOffline()
  const { isOffline, cacheAgeMs } = useOfflineRoutes()

  // Toast une seule fois par session quand les pages sont mises en cache
  useEffect(() => {
    const onReady = () => {
      toast({
        title: 'Mode hors ligne activé',
        description: 'Vos données et pages sont en cache. Vous pouvez utiliser l\'app sans connexion.',
      })
    }
    window.addEventListener('offline-cache-ready', onReady)
    return () => window.removeEventListener('offline-cache-ready', onReady)
  }, [toast])

  const handleSignOut = async () => {
    const result = await signOut()
    if (result === 'blocked') {
      toast({
        title: 'Ventes non synchronisées',
        description: `${pendingCount} vente${pendingCount > 1 ? 's' : ''} en attente. Connectez-vous à internet avant de vous déconnecter.`,
        variant: 'destructive',
      })
    } else if (result === 'sync_failed') {
      toast({
        title: 'Échec de synchronisation',
        description: 'Certaines ventes n\'ont pas pu être envoyées. Réessayez dans quelques secondes.',
        variant: 'destructive',
      })
    }
  }

  // ── REALTIME: notifier l'admin quand un caissier fait une vente ────────────
  useEffect(() => {
    const isAdmin = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'super_admin'
    if (!shop?.id || !user?.id || !isAdmin) return

    // Pré-déverrouiller l'AudioContext au premier geste utilisateur
    const unlock = () => {
      unlockAudio()
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
    }
    document.addEventListener('click', unlock, { passive: true })
    document.addEventListener('touchstart', unlock, { passive: true })

    const channel = supabase
      .channel(`sale-notify-${shop.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sales',
        filter: `shop_id=eq.${shop.id}`,
      }, (payload) => {
        const sale = payload.new as any
        if (sale.cashier_id === user.id) return
        if ((shop as any).notify_push_new_sale === false) return

        triggerSaleFeedback()
        const amount = `${Number(sale.total ?? 0).toLocaleString('fr-FR')} ${shop.currency || ''}`
        toast({
          title: '💰 Nouvelle vente',
          description: `${amount}${sale.sale_number ? ` · #${sale.sale_number}` : ''}`,
          variant: 'success',
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
    }
  }, [shop?.id, user?.id, profile?.role])

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

  if (loading || authRecovering) return <LoadingSkeleton />

  // Not authenticated — redirect via router (never window.location.href to avoid Android native error)
  if (!user) {
    router.replace(`/${locale}/login`)
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

  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at ?? null)
  const subscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  // Don't show upgrade wall if shop hasn't loaded yet
  const accessAllowed = !shop || isAccessAllowed(shop.plan ?? null, shop.trial_ends_at ?? null, shop.plan_expires_at ?? null)
  const showTrialBanner = !subscribed && accessAllowed && trialDaysLeft <= 7 && profile.role === 'owner'
  const isBillingPage = pathname.includes('/billing')

  return (
    <div className="min-h-screen bg-background">
      <OfflineBanner />
      <NavigationProgress />
      {!accessAllowed && !isBillingPage && (
        <UpgradeWall locale={locale} shopName={shop?.name} />
      )}

      <Sidebar locale={locale} role={roleInActiveShop ?? profile.role} profile={profile} shop={shop} onSignOut={handleSignOut} userEmail={user.email ?? ''} />

      <div className="sm:pl-64 flex flex-col min-h-screen">
        {showTrialBanner && <TrialBanner daysLeft={trialDaysLeft} locale={locale} />}

        <Header title={title} shop={shop} locale={locale} onSignOut={handleSignOut} />

        {profile.role === 'owner' && accessAllowed && !isBillingPage && (
          <PlanLimitAlert
            currentPlan={shop?.plan ?? null}
            productCount={productCount}
            teamMemberCount={teamCount}
            locale={locale}
          />
        )}

        <main className="flex-1 p-4 sm:p-6 pb-24 sm:pb-6 overflow-x-hidden">
          <SyncBanner pendingCount={pendingCount} syncing={syncing} onSync={sync} />
          <CacheBanner ageMs={cacheAgeMs} isOnline={!isOffline} />
          {children}
        </main>
      </div>

      <BottomNav locale={locale} role={roleInActiveShop ?? profile.role} onSignOut={handleSignOut} userEmail={user.email ?? ''} />
    </div>
  )
}
