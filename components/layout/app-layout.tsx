'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'
import { Header } from './header'
import { NavigationProgress } from './navigation-progress'
import { OfflineBanner } from '@/components/offline/offline-banner'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TrialBanner } from '@/components/saas/trial-banner'
import { UpgradeWall } from '@/components/saas/upgrade-wall'
import { PlanLimitAlert } from '@/components/saas/plan-limit-alert'
import { GracePeriodBanner } from '@/components/saas/grace-period-banner'
import { WhatsNewModal, type Announcement } from '@/components/saas/whats-new-modal'
import { getTrialDaysLeft, hasActiveSubscription, isAccessAllowed, getGraceDaysLeft, isBetaPeriod } from '@/lib/saas/plans'
import { useToast } from '@/components/ui/use-toast'
import { triggerSaleFeedback, unlockAudio } from '@/lib/utils/sale-feedback'
import { useOfflinePreload } from '@/lib/offline/use-offline-preload'
import { useOffline } from '@/lib/offline/use-offline'
import { useOfflineRoutes } from '@/lib/offline/use-offline-routes'
import { CacheBanner } from './cache-banner'
import Script from 'next/script'

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
    '/help': t('nav.help'),
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
  const { user, profile, shop, roleInActiveShop, loading, signOut, refreshShop } = useAuthContext()
  const title = usePageTitle(pathname, locale)
  const [productCount, setProductCount] = useState(0)
  const [teamCount, setTeamCount] = useState(0)
  const [authRecovering, setAuthRecovering] = useState(true)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [crispUnread, setCrispUnread] = useState(0)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { toast } = useToast()

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

  // ── ANNOUNCEMENTS: fetch & show modal if unread ──────────────────────────
  useEffect(() => {
    if (!profile?.id) return
    supabase
      .from('announcements' as any)
      .select('*')
      .eq('is_active', true)
      .order('published_at', { ascending: false })
      .limit(10)
      .then(({ data }: { data: any }) => {
        if (!data?.length) return
        setAnnouncements(data as Announcement[])
        const lastSeen = profile.last_seen_announcement_at
          ? new Date(profile.last_seen_announcement_at)
          : null
        const latestAt = new Date((data[0] as Announcement).published_at)
        if (!lastSeen || latestAt > lastSeen) {
          setWhatsNewOpen(true)
          setHasUnread(true)
        }
      })
  }, [profile?.id])

  const handleCloseWhatsNew = async () => {
    setWhatsNewOpen(false)
    setHasUnread(false)
    if (!profile?.id) return
    await (supabase
      .from('profiles') as any)
      .update({ last_seen_announcement_at: new Date().toISOString() })
      .eq('id', profile.id)
  }

  // ── CRISP: cacher le widget — observer ciblé pour ne pas bloquer le scroll
  useEffect(() => {
    const getCrispEl = () =>
      (document.getElementById('crisp-chatbox') ||
      document.querySelector('.crisp-client')) as HTMLElement | null

    const forceHide = () => {
      if (document.body.classList.contains('crisp-open')) return
      const el = getCrispEl()
      if (el) el.style.setProperty('display', 'none', 'important')
    }

    // Observer 1 : surveille uniquement les enfants directs de body
    // (là où Crisp injecte son conteneur) — pas subtree
    const bodyObserver = new MutationObserver(forceHide)
    bodyObserver.observe(document.body, { childList: true })

    // Observer 2 : surveille uniquement l'attribut style de l'élément Crisp
    // (quand Crisp essaie de se rendre visible lui-même)
    let elObserver: MutationObserver | null = null
    const watchTimer = setInterval(() => {
      const el = getCrispEl()
      if (el) {
        forceHide()
        elObserver = new MutationObserver(forceHide)
        elObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class'] })
        clearInterval(watchTimer)
      }
    }, 300)

    forceHide()
    return () => {
      bodyObserver.disconnect()
      elObserver?.disconnect()
      clearInterval(watchTimer)
    }
  }, [])

  // ── CRISP: event listeners (attendre que Crisp soit pleinement initialisé)
  useEffect(() => {
    let attempts = 0
    const register = () => {
      const $crisp = (window as any).$crisp
      if (!$crisp || typeof $crisp.get !== 'function') return false
      $crisp.push(['on', 'message:received', () => {
        const count = $crisp.get('chat:unread:count')
        setCrispUnread(typeof count === 'number' ? count : (n: number) => n + 1)
      }])
      $crisp.push(['on', 'chat:opened', () => setCrispUnread(0)])
      $crisp.push(['on', 'chat:closed', () => {
        document.body.classList.remove('crisp-open')
        const el = document.getElementById('crisp-chatbox') || document.querySelector('.crisp-client')
        if (el) (el as HTMLElement).style.setProperty('display', 'none', 'important')
      }])
      return true
    }
    if (!register()) {
      const timer = setInterval(() => {
        attempts++
        if (register() || attempts >= 20) clearInterval(timer)
      }, 500)
      return () => clearInterval(timer)
    }
  }, [])

  // ── CRISP: identify user once profile is loaded ──────────────────────────
  useEffect(() => {
    if (!user?.email || !profile) return
    const $crisp = (window as any).$crisp
    if (!$crisp) return
    $crisp.push(['set', 'user:email', [user.email]])
    $crisp.push(['set', 'user:nickname', [profile.full_name]])
    if (shop) {
      $crisp.push(['set', 'session:data', [[
        ['boutique', shop.name],
        ['plan', shop.plan ?? 'trial'],
        ['pays', shop.country ?? ''],
        ['role', profile.role],
      ]]])
    }
  }, [user?.email, profile?.id, shop?.id])

  const handleOpenChat = () => {
    const $crisp = (window as any).$crisp
    if (!$crisp) return
    // Retirer le style inline posé par le MutationObserver avant d'ouvrir
    const el = document.getElementById('crisp-chatbox') || document.querySelector('.crisp-client')
    if (el) (el as HTMLElement).style.removeProperty('display')
    document.body.classList.add('crisp-open')
    $crisp.push(['do', 'chat:show'])
    $crisp.push(['do', 'chat:open'])
    setCrispUnread(0)
  }

  // ── OFFLINE: preload data + auto-sync pending sales ───────────────────────
  useOfflinePreload()
  const { pendingCount } = useOffline()
  const { isOffline, cacheAgeMs } = useOfflineRoutes()

  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)
  const [signOutReason, setSignOutReason] = useState<'blocked' | 'sync_failed' | null>(null)
  const [forcingSignOut, setForcingSignOut] = useState(false)
  const [retryingSync, setRetryingSync] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      const result = await signOut()
      if (result === 'blocked' || result === 'sync_failed') {
        setSignOutReason(result)
        setSignOutDialogOpen(true)
      }
    } catch {
      // Unexpected error — show sync_failed dialog so user isn't stuck
      setSignOutReason('sync_failed')
      setSignOutDialogOpen(true)
    } finally {
      setSigningOut(false)
    }
  }, [signOut, signingOut])

  const handleForceSignOut = async () => {
    setForcingSignOut(true)
    await signOut(true)
  }

  const handleRetrySync = async () => {
    setRetryingSync(true)
    setSignOutDialogOpen(false)
    const result = await signOut()
    if (result === 'ok') return
    setSignOutReason(result)
    setSignOutDialogOpen(true)
    setRetryingSync(false)
  }

  // visibilitychange refresh is handled exclusively in auth-context.tsx
  // to avoid dual refreshSession() calls that can emit a spurious SIGNED_OUT.

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

  // Show skeleton only while auth is unresolved AND user is not yet available.
  // Redirect to login when definitely unauthenticated — inside useEffect to avoid
  // calling router.replace during render, which creates an infinite loop with the middleware.
  useEffect(() => {
    if (!loading && !authRecovering && !user) {
      router.replace(`/${locale}/login`)
    }
  }, [loading, authRecovering, user, locale])

  if (!user && (loading || authRecovering)) return <LoadingSkeleton />
  if (!user) return <LoadingSkeleton />

  // Auth user exists but profile missing — registration was incomplete
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-bold text-foreground">Configuration incomplète</h2>
          <p className="text-sm text-muted-foreground">
            Votre profil n&apos;a pas pu être chargé. Vérifiez votre connexion et réessayez.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => refreshShop().catch(() => window.location.reload())}
              className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Réessayer
            </button>
            <button
              onClick={async () => {
                try { localStorage.removeItem('auth_cache_v1') } catch {}
                try { await fetch('/api/auth/set-role', { method: 'DELETE', signal: AbortSignal.timeout(4000) }) } catch {}
                try { await supabase.auth.signOut() } catch {}
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

  const hasUnreadAnnouncement = hasUnread

  const trialDaysLeft  = getTrialDaysLeft(shop?.trial_ends_at ?? null)
  const graceDaysLeft  = getGraceDaysLeft(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const subscribed     = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const accessAllowed  = !shop || isAccessAllowed(shop.plan ?? null, shop.trial_ends_at ?? null, shop.plan_expires_at ?? null)
  const inGracePeriod  = graceDaysLeft > 0
  const showTrialBanner   = !subscribed && !inGracePeriod && accessAllowed && trialDaysLeft <= 7 && profile.role === 'owner'
  const showGraceBanner   = inGracePeriod && profile.role === 'owner'
  const isBillingPage  = pathname.includes('/billing')

  return (
    <div className="min-h-screen bg-background">
      <OfflineBanner />
      <NavigationProgress />
      {!accessAllowed && !isBillingPage && (
        <UpgradeWall locale={locale} shopName={shop?.name} />
      )}

      <Sidebar locale={locale} role={roleInActiveShop ?? profile.role} profile={profile} shop={shop} onSignOut={handleSignOut} signingOut={signingOut} userEmail={user.email ?? ''} hasUnreadAnnouncement={hasUnreadAnnouncement} onOpenWhatsNew={() => setWhatsNewOpen(true)} />

      <div className="sm:pl-64 flex flex-col min-h-screen">
        {showTrialBanner && <TrialBanner daysLeft={trialDaysLeft} locale={locale} />}
        {showGraceBanner && !isBillingPage && <GracePeriodBanner daysLeft={graceDaysLeft} locale={locale} />}

        <Header title={title} shop={shop} locale={locale} onSignOut={handleSignOut} crispUnread={crispUnread} onOpenChat={handleOpenChat} />

        {profile.role === 'owner' && accessAllowed && !isBillingPage && (
          <PlanLimitAlert
            currentPlan={shop?.plan ?? null}
            productCount={productCount}
            teamMemberCount={teamCount}
            locale={locale}
          />
        )}

        <main className="flex-1 p-4 sm:p-6 pb-24 sm:pb-6 overflow-x-hidden">
          <CacheBanner ageMs={cacheAgeMs} isOnline={!isOffline} />
          {children}
        </main>
      </div>

      <BottomNav locale={locale} role={roleInActiveShop ?? profile.role} onSignOut={handleSignOut} signingOut={signingOut} userEmail={user.email ?? ''} hasUnreadAnnouncement={hasUnreadAnnouncement} crispUnread={crispUnread} onOpenChat={handleOpenChat} />

      {/* Sign-out protection dialog */}
      <Dialog open={signOutDialogOpen} onOpenChange={open => { if (!open && !forcingSignOut) setSignOutDialogOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              {signOutReason === 'blocked' ? 'Hors connexion' : 'Échec de synchronisation'}
            </DialogTitle>
            <DialogDescription className="pt-1 space-y-2">
              <span className="block">
                {signOutReason === 'blocked'
                  ? `Vous avez ${pendingCount} opération${pendingCount > 1 ? 's' : ''} hors-ligne non synchronisée${pendingCount > 1 ? 's' : ''}. Connectez-vous à internet avant de vous déconnecter.`
                  : `La synchronisation a échoué. ${pendingCount} opération${pendingCount > 1 ? 's' : ''} risque${pendingCount > 1 ? 'nt' : ''} d'être perdue${pendingCount > 1 ? 's' : ''} définitivement si vous vous déconnectez maintenant.`
                }
              </span>
              <span className="block text-xs text-destructive font-medium">
                Se déconnecter maintenant effacera définitivement les données non envoyées.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {signOutReason === 'sync_failed' && (
              <Button onClick={handleRetrySync} disabled={retryingSync} className="w-full bg-stockshop-blue hover:bg-stockshop-blue-light">
                {retryingSync ? 'Synchronisation…' : '🔄 Réessayer la synchronisation'}
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={handleForceSignOut}
              disabled={forcingSignOut}
              className="w-full"
            >
              {forcingSignOut ? 'Déconnexion…' : 'Se déconnecter quand même'}
            </Button>
            <Button variant="ghost" onClick={() => setSignOutDialogOpen(false)} disabled={forcingSignOut} className="w-full">
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {whatsNewOpen && announcements.length > 0 && (
        <WhatsNewModal announcements={announcements} onClose={handleCloseWhatsNew} />
      )}

      <Script
        id="crisp-widget"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.$crisp=[];window.CRISP_WEBSITE_ID="42340430-3821-4a5b-b5ab-7953bd0edf95";window.CRISP_READY_TRIGGER=function(){var el=document.getElementById("crisp-chatbox")||document.querySelector(".crisp-client");if(el)el.style.setProperty("display","none","important");$crisp.push(["do","chat:hide"]);};(function(){var d=document,s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`,
        }}
      />
    </div>
  )
}
