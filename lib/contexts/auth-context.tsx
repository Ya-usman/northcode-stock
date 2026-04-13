'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile, Shop, UserRole } from '@/lib/types/database'

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
  signOut: () => Promise<void>
  refreshShop: () => Promise<void>
  switchShop: (shopId: string) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)
const supabase = createClient()

type MemberRow = { role: UserRole; is_active: boolean; shops: Shop | null }

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

function writeCache(userId: string, profile: Profile, userShops: Shop[], memberships: MemberRow[]) {
  try {
    const c: AuthCache = { userId, profile, userShops, memberships, savedAt: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch { /* storage full — ignore */ }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
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
    document.cookie = 'user_role=; path=/; max-age=0'
    clearCache()
    await supabase.auth.signOut()
    window.location.href = '/en/login?error=inactive'
    return { profile: null, userShops: [], memberships: [] }
  }

  const rows = (memberships ?? []) as MemberRow[]
  const userShops = rows.map(m => m.shops).filter(Boolean) as Shop[]

  if (userShops.length === 0 && profile?.shop_id) {
    const { data: shop } = await supabase.from('shops').select('*').eq('id', profile.shop_id).single()
    if (shop) return { profile, userShops: [shop as Shop], memberships: rows }
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
  const [activeShopId, setActiveShopId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('active_shop_id')
    return null
  })

  const activeShopIdRef = useRef(activeShopId)
  useEffect(() => { activeShopIdRef.current = activeShopId }, [activeShopId])

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
    const roleInActiveShop = (rows.find(m => m.shops?.id === activeShop?.id)?.role
      ?? profile?.role
      ?? null) as UserRole | null

    // Persist to cache so next reload is instant
    if (profile && !skipCache) writeCache(user.id, profile, userShops, rows)

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

      // ── Step 1: serve from cache immediately (zero latency) ────────────
      const cached = readCache(session.user.id)
      if (cached) {
        // Render instantly with cached data, then refresh in background
        applyUserData(session.user, cached.profile, cached.userShops, cached.memberships, activeShopIdRef.current, true)
        // Background refresh (no retry needed — cache already shown)
        fetchUserData(session.user.id).then(({ profile, userShops, memberships: rows }) => {
          if (!cancelled && profile) {
            applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
          }
        }).catch(() => { /* keep cached */ })
        return
      }

      // ── Step 2: no cache — fetch with exponential backoff + jitter ─────
      // Jitter: random 0–500ms offset so concurrent tabs don't all hit Supabase at once
      const jitter = Math.random() * 500
      await new Promise(r => setTimeout(r, jitter))

      let lastErr: unknown = null
      for (let attempt = 0; attempt < 5; attempt++) {
        if (cancelled) return
        try {
          const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
          if (cancelled) return
          applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
          return
        } catch (e) {
          lastErr = e
          if (attempt < 4) {
            // Exponential backoff + jitter to avoid thundering herd
            const delay = 400 * Math.pow(2, attempt) + Math.random() * 300
            await new Promise(r => setTimeout(r, delay))
          }
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
        clearCache()
        setState({ user: null, profile: null, userShops: [], activeShop: null, roleInActiveShop: null, loading: false })
        return
      }

      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
        try {
          const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
          if (cancelled) return
          applyUserData(session.user, profile, userShops, rows, activeShopIdRef.current)
        } catch {
          if (!cancelled) setState(s => s.profile ? s : { ...s, user: session.user, loading: false })
        }
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

  const switchShop = useCallback((shopId: string) => {
    setActiveShopId(shopId)
    localStorage.setItem('active_shop_id', shopId)
    setState(prev => {
      const activeShop = prev.userShops.find(s => s.id === shopId) ?? prev.activeShop
      const roleInActiveShop = (memberships.find(m => m.shops?.id === shopId)?.role
        ?? prev.profile?.role
        ?? null) as UserRole | null
      if (roleInActiveShop) {
        document.cookie = `user_role=${roleInActiveShop}; path=/; max-age=1800; samesite=lax`
      }
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

  const signOut = useCallback(async () => {
    document.cookie = 'user_role=; path=/; max-age=0'
    localStorage.removeItem('active_shop_id')
    clearCache()
    await supabase.auth.signOut()
    window.location.href = '/en/login'
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    shop: state.activeShop,
    isSuperAdmin: state.profile?.role === 'super_admin',
    signOut,
    refreshShop,
    switchShop,
  }), [state, signOut, refreshShop, switchShop])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside AuthProvider')
  return ctx
}
