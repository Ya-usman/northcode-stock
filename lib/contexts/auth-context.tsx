'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile, Shop, UserRole } from '@/lib/types/database'
import { setLocaleCookie, getLocaleCookie } from '@/lib/utils/cookies'
import { isCapacitor } from '@/lib/utils/native-share'

interface AuthState {
  user: User | null
  profile: Profile | null
  userShops: Shop[]
  activeShop: Shop | null
  roleInActiveShop: UserRole | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  shop: Shop | null
  isSuperAdmin: boolean
  signOut: (force?: boolean) => Promise<'ok' | 'blocked' | 'sync_failed'>
  refreshShop: () => Promise<void>
  patchShop: (shopId: string, updates: Partial<Shop>) => void
  switchShop: (shopId: string) => void
  updateLocale: (locale: string) => void
  dashboardShopFilter: string | null
  setDashboardShopFilter: (id: string | null) => void
  effectiveShopIds: string[]
}

const AuthContext = createContext<AuthContextValue | null>(null)
const supabase = createClient()

type MemberRow = { role: UserRole; is_active: boolean; shops: Shop | null }

// Resolve the effective role for a given shop.
// owner / super_admin keep their full role anywhere.
// Other members (cashier, stock_manager, viewer) have full access only in
// their primary shop; in any other shop they are downgraded to 'viewer'.
function resolveRoleInShop(
  memberRole: UserRole | undefined | null,
  profile: Profile | null,
  shopId: string,
): UserRole | null {
  if (!profile) return memberRole ?? null
  if (profile.role === 'super_admin') return 'super_admin'
  if (profile.role === 'owner') return memberRole ?? (profile.shop_id === shopId ? 'owner' : null)
  // Non-owner: full role only in primary shop
  if (profile.shop_id === shopId) return memberRole ?? profile.role
  // In a non-primary shop: read-only if they have any membership
  if (memberRole) return 'viewer'
  return null
}

// ── localStorage cache for profile + shops ──────────────────────────────────
// Lets the app render instantly on reload even when Supabase is slow/unreachable
const CACHE_KEY = 'auth_cache_v1'

interface AuthCache {
  userId: string
  profile: Profile
  userShops: Shop[]
  memberships: MemberRow[]
  savedAt: number
}

function readCache(userId: string): AuthCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c: AuthCache = JSON.parse(raw)
    // Discard if older than 24h or wrong user
    if (c.userId !== userId || Date.now() - c.savedAt > 86400000) return null
    return c
  } catch { return null }
}

// Stale read — relaxed TTL (7 days max). Used to pre-fill UI instantly on
// page reload even when cache is older than 24h. Background refresh always
// follows. The 7-day cap prevents showing a deactivated account or expired
// plan indefinitely when the network is unreachable.
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
function readCacheStale(userId: string): AuthCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) { console.warn('[auth-cache] miss: no key in localStorage'); return null }
    const c: AuthCache = JSON.parse(raw)
    if (c.userId !== userId) { console.warn('[auth-cache] miss: userId mismatch', { cached: c.userId, current: userId }); return null }
    if (Date.now() - c.savedAt > STALE_MAX_MS) { console.warn('[auth-cache] miss: older than 7 days', { ageMs: Date.now() - c.savedAt }); return null }
    console.info('[auth-cache] hit', { ageMs: Date.now() - c.savedAt })
    return c
  } catch (e) { console.warn('[auth-cache] miss: read/parse error', e); return null }
}

function writeCache(userId: string, profile: Profile, userShops: Shop[], memberships: MemberRow[]) {
  try {
    const c: AuthCache = { userId, profile, userShops, memberships, savedAt: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
    console.info('[auth-cache] write ok')
  } catch (e) { console.warn('[auth-cache] write FAILED (storage full or serialization error)', e) }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
}

// Wipe read-only caches (localStorage). Safe to call anytime — no write data at risk.
function clearReadCaches(): void {
  try {
    const keys = Object.keys(localStorage).filter(k =>
      k.startsWith('pc_') || k === 'dashboard_cache_v1'
    )
    keys.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

// Full wipe of IndexedDB. Only safe AFTER all pending writes have been synced.
async function deleteOfflineDb(): Promise<void> {
  try {
    await indexedDB.deleteDatabase('stockshop-offline')
  } catch { /* ignore */ }
}

// ── Fetch from Supabase ─────────────────────────────────────────────────────
async function fetchUserData(userId: string): Promise<{
  profile: Profile | null
  userShops: Shop[]
  memberships: MemberRow[]
}> {
  const [{ data: profileData }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('shop_members').select('role, is_active, shops(*)').eq('user_id', userId).eq('is_active', true),
  ])

  const profile = profileData as Profile | null

  if (profile && !profile.is_active) {
    const savedLocale = getLocaleCookie() || (typeof localStorage !== 'undefined' && localStorage.getItem('NEXT_LOCALE')) || profile.locale || 'en'
    fetch('/api/auth/set-role', { method: 'DELETE' }).catch(() => {})
    clearCache()
    await supabase.auth.signOut()
    window.location.href = `/${savedLocale}/login?error=inactive`
    return { profile: null, userShops: [], memberships: [] }
  }

  const rows = (memberships ?? []) as MemberRow[]
  const userShops = rows.map(m => m.shops).filter(Boolean) as Shop[]

  if (userShops.length === 0 && profile?.shop_id) {
    const { data: shop } = await supabase.from('shops').select('*').eq('id', profile.shop_id).single()
    if (shop) return { profile, userShops: [shop as Shop], memberships: rows }
  }

  // Always fetch role_permissions directly — the join may return a stale schema-cache
  // version of JSONB columns; this separate query guarantees up-to-date permissions.
  if (userShops.length > 0) {
    const { data: permsData } = await (supabase as any)
      .from('shops')
      .select('id, role_permissions')
      .in('id', userShops.map(s => s.id))
    if (permsData) {
      permsData.forEach((p: any) => {
        const shop = userShops.find(s => s.id === p.id)
        if (shop) (shop as any).role_permissions = p.role_permissions
      })
    }
  }

  return { profile, userShops, memberships: rows }
}

// ── Provider ────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    userShops: [],
    activeShop: null,
    roleInActiveShop: null,
    loading: true,
  })
  const [memberships, setMemberships] = useState<MemberRow[]>([])
  const [activeShopId, setActiveShopId] = useState<string | null>(null)
  const [dashboardShopFilter, setDashboardShopFilterState] = useState<string | null>(null)

  const activeShopIdRef = useRef(activeShopId)
  useEffect(() => { activeShopIdRef.current = activeShopId }, [activeShopId])

  // Read persisted values from localStorage after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    const savedShop = localStorage.getItem('active_shop_id')
    if (savedShop) setActiveShopId(savedShop)
    const savedFilter = localStorage.getItem('dashboard_shop_filter')
    if (savedFilter) setDashboardShopFilterState(savedFilter)
  }, [])

  const applyUserData = useCallback((
    user: User,
    profile: Profile | null,
    userShops: Shop[],
    rows: MemberRow[],
    currentActiveId: string | null,
    skipCache = false
  ) => {
    setMemberships(rows)
    const resolvedId = currentActiveId && userShops.find(s => s.id === currentActiveId)
      ? currentActiveId
      : userShops[0]?.id ?? null

    if (resolvedId && resolvedId !== currentActiveId) {
      setActiveShopId(resolvedId)
      localStorage.setItem('active_shop_id', resolvedId)
    }

    const activeShop = userShops.find(s => s.id === (resolvedId ?? userShops[0]?.id)) ?? userShops[0] ?? null
    const memberRole = rows.find(m => m.shops?.id === activeShop?.id)?.role
    const roleInActiveShop = resolveRoleInShop(memberRole, profile, activeShop?.id ?? '')

    // Persist to cache so next reload is instant
    if (profile && !skipCache) writeCache(user.id, profile, userShops, rows)

    // Sync locale from DB → browser only on fresh data (not cache).
    // Skipping on cache prevents overwriting a locale the user just changed
    // via the navbar before the background refresh completes.
    if (profile?.locale && !skipCache) {
      localStorage.setItem('NEXT_LOCALE', profile.locale)
      setLocaleCookie(profile.locale)
    }

    // Refresh role + plan_ok_until cookies silently on fresh data load.
    // Ensures old sessions (before plan_ok_until was introduced) get the cookie
    // without requiring a manual logout, preventing the blank dashboard issue.
    if (profile && !skipCache) {
      fetch('/api/auth/set-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})
    }

    setState({ user, profile, userShops, activeShop, roleInActiveShop, loading: false })
  }, [])

  useEffect(() => {
    let cancelled = false
    let bgRetryInterval: ReturnType<typeof setInterval> | null = null
    let bgRetryStop: ReturnType<typeof setTimeout> | null = null

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return

      if (!session?.user) {
        setState(s => ({ ...s, loading: false }))
        return
      }

      // ── Remember Me check ──────────────────────────────────────────────
      // sessionStorage est vidé à la fermeture du navigateur/onglet.
      // Si session_alive est absent = nouvelle ouverture du navigateur.
      // Dans ce cas, on déconnecte sauf si l'utilisateur a coché "Remember Me"
      // ou s'il est connecté via OAuth (Google/Apple).
      const remember = localStorage.getItem('auth_remember_me') === '1'
      const sessionAlive = sessionStorage.getItem('session_alive') === '1'
      const provider = session.user.app_metadata?.provider
      const isOAuth = Boolean(provider && provider !== 'email')
      // Ne pas déconnecter sur la page reset-password (recovery flow via callback PKCE)
      const isResetFlow = window.location.pathname.includes('/reset-password')

      const isNativeApp = isCapacitor()
      // PWA installée (standalone) = équivalent app native — ne pas déconnecter
      // à l'ouverture même si sessionStorage est vide (comportement attendu d'une app).
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as any).standalone === true

      if (!remember && !isOAuth && !sessionAlive && !isResetFlow && !isNativeApp && !isStandalone) {
        // Marquer cancelled AVANT le signOut fire-and-forget : sans ça, l'événement
        // SIGNED_OUT arrive dans onAuthStateChange et efface le cache avant que la
        // page se démonte, causant un skeleton de 12s au prochain refresh.
        cancelled = true
        supabase.auth.signOut().catch(() => {})
        clearCache()
        setState(s => ({ ...s, loading: false }))
        const locale = getLocaleCookie() || localStorage.getItem('NEXT_LOCALE') || 'fr'
        window.location.replace(`/${locale}/login`)
        return
      }
      sessionStorage.setItem('session_alive', '1')

      // Marquer immédiatement l'utilisateur comme authentifié dans le state.
      // Sans ça, si le profil met >12s à charger (cold start Supabase free tier),
      // le timer de sécurité fire avec user:null → AppLayout redirige vers login,
      // même si la session est parfaitement valide.
      // Le profil est chargé juste après — le skeleton s'affiche jusqu'à là.
      if (!cancelled) setState(s => ({ ...s, user: session.user }))
      // ──────────────────────────────────────────────────────────────────

      // ── Step 1: serve from cache immediately (zero latency) ────────────
      // Use stale read (ignores 24h TTL) so even a day-old cache avoids the
      // skeleton on page load. Fresh data always loads in background.
      const cached = readCacheStale(session.user.id)
      if (cached) {
        // Render instantly with cached data, then always refresh in background
        applyUserData(session.user, cached.profile, cached.userShops, cached.memberships, activeShopIdRef.current, true)
        fetchUserData(session.user.id).then(({ profile, userShops, memberships: rows }) => {
          if (!cancelled && profile) {
            applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
          }
        }).catch(() => { /* keep cached */ })
        return
      }

      // ── Step 2: no cache at all — fetch with exponential backoff ──────
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 8; attempt++) {
        if (cancelled) return
        try {
          const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
          if (cancelled) return
          // Only stop retrying when profile is found — profile:null means data not ready yet
          if (profile) {
            applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
            return
          }
        } catch (e) {
          lastErr = e
        }
        if (attempt < 7) {
          const delay = Math.min(400 * Math.pow(2, attempt), 5000) + Math.random() * 300
          await new Promise(r => setTimeout(r, delay))
        }
      }

      // All retries failed — unblock render, keep retrying in background
      console.error('fetchUserData failed after 5 attempts', lastErr)
      if (!cancelled) setState(s => ({ ...s, user: session.user, loading: false }))

      if (!cancelled) {
        bgRetryInterval = setInterval(async () => {
          if (cancelled) { clearInterval(bgRetryInterval!); return }
          try {
            const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
            if (cancelled) { clearInterval(bgRetryInterval!); return }
            if (profile) {
              applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
              clearInterval(bgRetryInterval!)
              bgRetryInterval = null
            }
          } catch { /* keep retrying */ }
        }, 5000 + Math.random() * 2000) // 5–7s with jitter
        bgRetryStop = setTimeout(() => {
          if (bgRetryInterval) { clearInterval(bgRetryInterval); bgRetryInterval = null }
        }, 120000)
      }
    }).catch(() => {
      if (!cancelled) setState(s => ({ ...s, loading: false }))
    })

    // Safety: never stay on skeleton beyond 12s
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setState(s => s.loading ? { ...s, loading: false } : s)
    }, 12000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      if (event === 'INITIAL_SESSION') return

      if (event === 'SIGNED_OUT') {
        // Guard against spurious SIGNED_OUT from concurrent refreshSession() calls.
        // If the cookie is still valid, this is a false sign-out — re-read the session
        // instead of clearing state, which would trigger a redirect loop.
        const { data: { session: stillValid } } = await supabase.auth.getSession()
        if (stillValid?.user) {
          // Cookie is still alive — treat as TOKEN_REFRESHED, not a real sign-out
          setState(prev => ({ ...prev, user: stillValid.user, loading: false }))
          return
        }
        // The access token may have simply expired while the tab/PWA sat in the
        // background (the 45-min proactive refresh setInterval doesn't run while
        // suspended) — try one explicit refresh before treating this as a real
        // sign-out, so a stale token self-heals instead of wiping the whole auth
        // state and stranding the UI on the skeleton until a manual reload.
        const { data: { session: refreshed } } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }))
        if (refreshed?.user) {
          setState(prev => ({ ...prev, user: refreshed.user, loading: false }))
          return
        }
        // Being offline makes BOTH recovery attempts above fail unconditionally
        // (they need the network), which would otherwise be misread as proof of
        // a real sign-out. Wiping profile/shops/read-caches here would erase
        // everything the offline-first UI depends on to keep working while
        // disconnected — exactly the opposite of the behavior built all across
        // this app. Leave state and caches untouched; the next SIGNED_OUT check
        // (or the app's own reconnect handling) re-evaluates once back online.
        if (!navigator.onLine) return
        clearCache()
        clearReadCaches() // read-only caches only — pending sales/movements are NEVER wiped here
        setState({ user: null, profile: null, userShops: [], activeShop: null, roleInActiveShop: null, loading: false })
        return
      }

      // TOKEN_REFRESHED: only the JWT changed — profile/shops are unchanged.
      // Just update user reference in state; avoid 3-4 unnecessary Supabase queries.
      if (event === 'TOKEN_REFRESHED' && session?.user) {
        setState(prev => prev.profile ? { ...prev, user: session.user } : prev)
        return
      }

      if (session?.user && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        // Retry loop: profile may not exist yet if SIGNED_IN fires before /api/register completes
        let fetched = false
        for (let attempt = 0; attempt < 6; attempt++) {
          if (cancelled) return
          try {
            const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
            if (cancelled) return
            if (profile) {
              applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
              fetched = true
              break
            }
          } catch { /* keep retrying */ }
          // Wait before next attempt: 500ms, 1s, 2s, 3s, 4s
          await new Promise(r => setTimeout(r, Math.min(500 * Math.pow(2, attempt), 4000)))
        }
        if (!fetched && !cancelled) setState(s => s.profile ? s : { ...s, user: session.user, loading: false })
      }
    })

    return () => {
      cancelled = true
      clearTimeout(safetyTimer)
      if (bgRetryInterval) clearInterval(bgRetryInterval)
      if (bgRetryStop) clearTimeout(bgRetryStop)
      subscription.unsubscribe()
    }
  }, [applyUserData])

  // Proactive JWT refresh every 45 min — the access token expires after 60 min.
  // Refreshing before expiry means reconnection sync never races against an expired token.
  useEffect(() => {
    if (!state.user?.id) return
    const interval = setInterval(() => {
      if (!navigator.onLine) return
      supabase.auth.refreshSession().catch(() => {})
    }, 45 * 60 * 1000)
    return () => clearInterval(interval)
  }, [state.user?.id])

  const setDashboardShopFilter = useCallback((id: string | null) => {
    setDashboardShopFilterState(id)
    if (id === null) localStorage.removeItem('dashboard_shop_filter')
    else localStorage.setItem('dashboard_shop_filter', id)
  }, [])

  const switchShop = useCallback((shopId: string) => {
    setActiveShopId(shopId)
    localStorage.setItem('active_shop_id', shopId)
    // Update HttpOnly role cookie via server endpoint
    fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shopId }),
    }).catch(() => {})
    setState(prev => {
      const activeShop = prev.userShops.find(s => s.id === shopId) ?? prev.activeShop
      const memberRole = memberships.find(m => m.shops?.id === shopId)?.role
      const roleInActiveShop = resolveRoleInShop(memberRole, prev.profile, shopId)
      return { ...prev, activeShop, roleInActiveShop }
    })
  }, [memberships])

  const refreshShop = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    try {
      const { profile, userShops, memberships: rows } = await fetchUserData(user.id)
      if (profile) applyUserData(user, profile, userShops, rows, activeShopIdRef.current)
    } catch { /* keep */ }
  }, [applyUserData])

  // Directly patch a shop in state without a DB round-trip.
  // Use this after a successful write to avoid stale-read issues on replicas.
  const patchShop = useCallback((shopId: string, updates: Partial<Shop>) => {
    setState(prev => ({
      ...prev,
      userShops: prev.userShops.map(s => s.id === shopId ? { ...s, ...updates } : s),
      activeShop: prev.activeShop?.id === shopId ? { ...prev.activeShop, ...updates } : prev.activeShop,
    }))
  }, [])

  // Real-time: sync shop data when owner updates role_permissions
  useEffect(() => {
    const shopId = state.activeShop?.id
    if (!shopId) return

    const channel = supabase
      .channel(`shop-perms-${shopId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'shops',
        filter: `id=eq.${shopId}`,
      }, (payload) => {
        const raw = payload.new as any
        const id: string | undefined = raw?.id
        if (!id) return
        // Supabase Realtime may omit JSONB columns — only update role_permissions if present
        const patch: Partial<Shop> = {}
        if (raw.role_permissions !== undefined) (patch as any).role_permissions = raw.role_permissions
        if (raw.name !== undefined) patch.name = raw.name
        if (Object.keys(patch).length === 0) return
        setState(prev => ({
          ...prev,
          userShops: prev.userShops.map(s => s.id === id ? { ...s, ...patch } : s),
          activeShop: prev.activeShop?.id === id ? { ...prev.activeShop, ...patch } : prev.activeShop,
        }))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [state.activeShop?.id])

  // Update last_seen every 3 minutes while the user is active
  useEffect(() => {
    if (!state.user?.id) return
    const userId = state.user.id
    const updateLastSeen = () => {
      // Fire-and-forget — use user id from closure, no network round-trip for session
      ;(supabase as any).from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', userId).then(() => {})
    }
    updateLastSeen()
    const interval = setInterval(updateLastSeen, 3 * 60 * 1000)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      updateLastSeen()
      // Rafraîchir le JWT silencieusement (expire après 1h en arrière-plan).
      // .catch() : si hors-ligne, ça échoue silencieusement sans bloquer quoi que ce soit.
      supabase.auth.refreshSession().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state.user?.id])

  const updateLocale = useCallback((locale: string) => {
    localStorage.setItem('NEXT_LOCALE', locale)
    setLocaleCookie(locale)
    // Update in-memory profile + cache so the next cache read has the correct locale
    setState(prev => {
      if (!prev.profile || !prev.user) return prev
      const updated = { ...prev.profile, locale }
      writeCache(prev.user.id, updated, prev.userShops, memberships)
      return { ...prev, profile: updated }
    })
    // Persist to DB (best-effort — cache is already updated)
    ;(supabase as any).from('profiles').update({ locale }).eq('id', state.user?.id ?? '').then(() => {})
  }, [state.user?.id, memberships])

  const signOut = useCallback(async (force = false): Promise<'ok' | 'blocked' | 'sync_failed'> => {
    const savedLocale = getLocaleCookie() || localStorage.getItem('NEXT_LOCALE') || 'en'
    const shopId = state.activeShop?.id
    console.info('[sign-out] start', { force, online: navigator.onLine })

    if (!force) {
      const { getTotalPendingCount } = await import('@/lib/offline/db')
      // Race with a generous timeout — if IDB never resolves, treat as pending=1
      // (fail-safe: don't risk silently discarding unsynced data). 8s (not 3s)
      // gives IndexedDB room to respond right after a tab/app resumes from the
      // background, where browsers throttle these subsystems and a slow-but-
      // legitimate read was being misread as "there's pending data" every time.
      const pendingTotal = await Promise.race([
        getTotalPendingCount().catch(() => 1),
        new Promise<number>(resolve => setTimeout(() => resolve(1), 8_000)),
      ])
      console.info('[sign-out] pendingTotal', pendingTotal)

      if (pendingTotal > 0) {
        if (!navigator.onLine) { console.info('[sign-out] blocked: offline with pending ops'); return 'blocked' }

        // Sync with a generous timeout so it never hangs forever on a slow network,
        // but 20s (not 10s) gives refreshSession() + the sequential per-item inserts
        // enough room right after a background resume, where the network/session
        // refresh is often slower than during normal active use.
        try {
          // syncAllPending() is a process-wide shared lock — using it here too
          // (instead of calling syncPendingSales/etc. directly) means this sign-out
          // sync joins any sync already in flight from useOffline() elsewhere
          // instead of racing it and inserting the same pending sale twice.
          const { syncAllPending } = await import('@/lib/offline/sync')
          if (shopId) {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('sync_timeout')), 20_000)
            )
            const result = await Promise.race([syncAllPending(shopId), timeout])
            console.info('[sign-out] sync results', result)
            if (result.failed > 0) return 'sync_failed'
          }
        } catch (e) {
          console.info('[sign-out] sync threw', e)
          return 'sync_failed'
        }
      }
    }

    localStorage.removeItem('active_shop_id')
    clearCache()
    clearReadCaches()
    // Await the set-role DELETE (fast — no Supabase network call inside) so the
    // sb-*-auth-token cookie is cleared before the browser navigates.
    // Without this, the middleware still sees a valid cookie and loops: /login → /dashboard.
    const deleteResult = await fetch('/api/auth/set-role', { method: 'DELETE', signal: AbortSignal.timeout(5_000) })
      .then(r => ({ ok: r.ok, status: r.status }))
      .catch(e => ({ ok: false, status: 0, error: String(e) }))
    console.info('[sign-out] set-role DELETE result', deleteResult)
    // Fire-and-forget: these make Supabase API calls that can hang on slow networks.
    supabase.auth.signOut().catch(() => {})
    deleteOfflineDb().catch(() => {})
    console.info('[sign-out] navigating to login', `/${savedLocale}/login`)
    window.location.href = `/${savedLocale}/login`
    return 'ok'
  }, [state.activeShop?.id])

  const effectiveShopIds = useMemo<string[]>(() => {
    if (dashboardShopFilter === null) return state.userShops.map(s => s.id)
    return [dashboardShopFilter]
  }, [dashboardShopFilter, state.userShops])

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    shop: state.activeShop,
    isSuperAdmin: state.profile?.role === 'super_admin',
    signOut,
    refreshShop,
    patchShop,
    switchShop,
    updateLocale,
    dashboardShopFilter,
    setDashboardShopFilter,
    effectiveShopIds,
  }), [state, signOut, refreshShop, patchShop, switchShop, updateLocale, dashboardShopFilter, setDashboardShopFilter, effectiveShopIds])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside AuthProvider')
  return ctx
}
