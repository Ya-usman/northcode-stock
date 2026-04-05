'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile, Shop } from '@/lib/types/database'

interface AuthState {
  user: User | null
  profile: Profile | null
  shop: Shop | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const supabase = createClient()

async function fetchProfileAndShop(userId: string): Promise<{ profile: Profile | null; shop: Shop | null }> {
  const { data } = await supabase
    .from('profiles')
    .select('*, shops(*)')
    .eq('id', userId)
    .single()

  if (!data) return { profile: null, shop: null }

  const profile = data as Profile & { shops: Shop | null }

  if (!profile.is_active) {
    document.cookie = 'user_role=; path=/; max-age=0'
    await supabase.auth.signOut()
    window.location.href = '/en/login?error=inactive'
    return { profile: null, shop: null }
  }

  const shop = profile.shops ?? null
  return { profile, shop }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    shop: null,
    loading: true,
  })

  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { profile, shop } = await fetchProfileAndShop(user.id)
        setState({ user, profile, shop, loading: false })
      } else {
        setState({ user: null, profile: null, shop: null, loading: false })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setState({ user: null, profile: null, shop: null, loading: false })
        return
      }
      if (session?.user) {
        const { profile, shop } = await fetchProfileAndShop(session.user.id)
        setState({ user: session.user, profile, shop, loading: false })
      }
    })

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (user) {
            try {
              const { profile, shop } = await fetchProfileAndShop(user.id)
              // Only update if we got a valid profile — don't blank the UI on transient failures
              if (profile) {
                setState({ user, profile, shop, loading: false })
              }
            } catch {
              // Network glitch — keep existing state
            }
          } else {
            setState({ user: null, profile: null, shop: null, loading: false })
          }
        })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const signOut = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    document.cookie = 'user_role=; path=/; max-age=0'
    await supabase.auth.signOut()
    window.location.href = '/en/login'
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside AuthProvider')
  return ctx
}
