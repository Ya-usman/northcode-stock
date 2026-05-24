'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Handles deep links on Android/iOS (Capacitor).
 * After Google/Apple OAuth, Chrome Custom Tab redirects to stockshop://auth/callback?code=...
 * Android intercepts it, opens the app, and this component exchanges the PKCE code for a session.
 */
export function CapacitorDeepLinkHandler({ locale }: { locale: string }) {
  useEffect(() => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    if (!isNative) return

    let removeListener: (() => void) | null = null

    import('@capacitor/app').then(({ App }) => {
      const listenerPromise = App.addListener('appUrlOpen', async (event) => {
        const url = event.url
        if (!url.startsWith('stockshop://auth')) return

        const supabase = createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(url)
        if (!error) {
          localStorage.setItem('auth_remember_me', '1')
          const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
          window.location.href = `/${savedLocale}/dashboard`
        }
      })

      removeListener = () => { listenerPromise.then(h => h.remove()) }
    })

    return () => { removeListener?.() }
  }, [locale])

  return null
}
