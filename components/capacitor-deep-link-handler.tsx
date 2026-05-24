'use client'

import { useEffect } from 'react'

async function handleOAuthUrl(url: string, locale: string) {
  if (!url.startsWith('stockshop://auth')) return
  const { createNativeClient } = await import('@/lib/supabase/native-client')
  const { data, error } = await createNativeClient().auth.exchangeCodeForSession(url)
  if (!error && data.session) {
    localStorage.setItem('auth_remember_me', '1')
    // Set role cookie so middleware recognizes the session
    await fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})
    const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
    window.location.replace(`/${savedLocale}/dashboard`)
  } else {
    // Redirect to login with error so the user knows something failed
    const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
    const msg = error?.message ?? 'no_session'
    window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(msg)}`)
  }
}

/**
 * Handles deep links on Android/iOS (Capacitor).
 * After Google/Apple OAuth, Chrome Custom Tab redirects to stockshop://auth/callback?code=...
 * Android intercepts it, opens the app, and this component exchanges the PKCE code for a session.
 * Handles both: app launched from deep link (getLaunchUrl) and app already open (appUrlOpen).
 */
export function CapacitorDeepLinkHandler({ locale }: { locale: string }) {
  useEffect(() => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    if (!isNative) return

    let removeListener: (() => void) | null = null

    import('@capacitor/app').then(({ App }) => {
      // Case 1: app was closed and launched directly from the deep link
      App.getLaunchUrl().then((result) => {
        if (result?.url) handleOAuthUrl(result.url, locale)
      })

      // Case 2: app was already open in background
      const listenerPromise = App.addListener('appUrlOpen', (event) => {
        handleOAuthUrl(event.url, locale)
      })

      removeListener = () => { listenerPromise.then(h => h.remove()) }
    })

    return () => { removeListener?.() }
  }, [locale])

  return null
}
