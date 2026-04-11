'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile, Shop, UserRole } from '@/lib/types/database'

interface AuthState {
  user: User | null
  profile: Profile | null
  // Multi-boutique
  userShops: Shop[]
  activeShop: Shop | null
  roleInActiveShop: UserRole | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  // Compat — pointe sur activeShop
  shop: Shop | null
  isSuperAdmin: boolean
  signOut: () => Promise<void>
  refreshShop: () => Promise<void>
  switchShop: (shopId: string) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const supabase = createClient()

type MemberRow = { role: UserRole; is_active: boolean; shops: Shop | null }

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
    await supabase.auth.signOut()
    window.location.href = '/en/login?error=inactive'
    return { profile: null, userShops: [], memberships: [] }
  }

  const rows = (memberships ?? []) as MemberRow[]
  const userShops = rows.map(m => m.shops).filter(Boolean) as Shop[]

  // Fallback : si pas encore de shop_members (ancien compte), lire via profiles
  if (userShops.length === 0 && profile?.shop_id) {
    const { data: shop } = await supabase.from('shops').select('*').eq('id', profile.shop_id).single()
    if (shop) return { profile, userShops: [shop as Shop], memberships: rows }
  }

  return { profile, userShops, memberships: rows }
}

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

  const initialized = useRef(false)

  const applyUserData = useCallback((
    user: User,
    profile: Profile | null,
    userShops: Shop[],
    rows: MemberRow[],
    currentActiveId: string | null
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

    setState({ user, profile, userShops, activeShop, roleInActiveShop, loading: false })
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // 1. Bootstrap immédiat via getSession() — lit les cookies sans réseau
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
          applyUserData(session.user, profile, userShops, rows, activeShopId)
        } catch {
          setState(s => ({ ...s, user: session.user, loading: false }))
        }
      } else {
        setState(s => ({ ...s, loading: false }))
      }
    }).catch(() => setState(s => ({ ...s, loading: false })))

    // 2. Écouter les changements d'état (sign-in depuis une autre instance, token refresh, sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') return // déjà géré par getSession() ci-dessus

      if (event === 'SIGNED_OUT') {
        setState({ user: null, profile: null, userShops: [], activeShop: null, roleInActiveShop: null, loading: false })
        return
      }

      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
        try {
          const { profile, userShops, memberships: rows } = await fetchUserData(session.user.id)
          applyUserData(session.user, profile, userShops, rows, activeShopId)
        } catch {
          setState(s => ({ ...s, user: session.user, loading: false }))
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const switchShop = useCallback((shopId: string) => {
    setActiveShopId(shopId)
    localStorage.setItem('active_shop_id', shopId)

    setState(prev => {
      const activeShop = prev.userShops.find(s => s.id === shopId) ?? prev.activeShop
      const roleInActiveShop = (memberships.find(m => m.shops?.id === shopId)?.role
        ?? prev.profile?.role
        ?? null) as UserRole | null
      // Update role cookie for middleware
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
      if (profile) applyUserData(user, profile, userShops, rows, activeShopId)
    } catch {/* keep */}
  }, [activeShopId, applyUserData])

  const signOut = useCallback(async () => {
    document.cookie = 'user_role=; path=/; max-age=0'
    localStorage.removeItem('active_shop_id')
    await supabase.auth.signOut()
    window.location.href = '/en/login'
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    shop: state.activeShop, // compat alias
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
