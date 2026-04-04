'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile, Shop } from '@/lib/types/database'

interface AuthState {
  user: User | null
  profile: Profile | null
  shop: Shop | null
  session: Session | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    shop: null,
    session: null,
    loading: true,
  })

  const supabase = createClient()

  const loadProfile = useCallback(async (userId: string) => {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    const profile = profileData as Profile | null

    if (profile?.shop_id) {
      const { data: shopData } = await supabase
        .from('shops')
        .select('*')
        .eq('id', profile.shop_id)
        .single()

      return { profile, shop: shopData as Shop | null }
    }

    return { profile, shop: null }
  }, [supabase])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { profile, shop } = await loadProfile(user.id)
        setState({ user, profile, shop, session: null, loading: false })
      } else {
        setState(s => ({ ...s, loading: false }))
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const { profile, shop } = await loadProfile(session.user.id)
          setState({ user: session.user, profile, shop, session, loading: false })
        } else {
          setState({ user: null, profile: null, shop: null, session: null, loading: false })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [loadProfile, supabase])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return { ...state, signOut }
}
