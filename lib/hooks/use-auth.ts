'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import type { Profile, Shop } from '@/lib/types/database'

interface AuthState {
  user: User | null
  profile: Profile | null
  shop: Shop | null
  loading: boolean
}

// Singleton client — évite les recréations
const supabase = createClient()

async function fetchProfileAndShop(userId: string): Promise<{ profile: Profile | null; shop: Shop | null }> {
  const { data } = await supabase
    .from('profiles')
    .select('*, shops(*)')
    .eq('id', userId)
    .single()

  if (!data) return { profile: null, shop: null }

  const profile = data as Profile & { shops: Shop | null }
  const shop = profile.shops ?? null

  return { profile, shop }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    shop: null,
    loading: true,
  })

  // Prevent double-fetch on StrictMode
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    // Initial load
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { profile, shop } = await fetchProfileAndShop(user.id)
        setState({ user, profile, shop, loading: false })
      } else {
        setState({ user: null, profile: null, shop: null, loading: false })
      }
    })

    // Listen for auth changes (login, logout, token refresh)
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

    // On mobile, the browser pauses JS when backgrounded — re-check session on resume
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (user) {
            const { profile, shop } = await fetchProfileAndShop(user.id)
            setState({ user, profile, shop, loading: false })
          } else {
            // Session expired while backgrounded → redirect to login
            setState({ user: null, profile: null, shop: null, loading: false })
            window.location.href = '/en/login'
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

  const signOut = async () => {
    setState(s => ({ ...s, loading: true }))
    // Clear role cookie
    document.cookie = 'user_role=; path=/; max-age=0'
    await supabase.auth.signOut()
    // Force hard redirect — évite les états corrompus
    window.location.href = '/en/login'
  }

  return { ...state, signOut }
}
