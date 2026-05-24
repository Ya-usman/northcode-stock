'use client'

import { useEffect } from 'react'

async function handleOAuthUrl(url: string, locale: string) {
  if (!url.startsWith('stockshop://auth')) return

  try {
    // The native client (used in login page) stores the PKCE verifier in localStorage.
    // The SSR client (createClient) reads from cookies. Bridge the gap by copying
    // the verifier from localStorage into a cookie before calling exchangeCodeForSession.
    const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/\/\/([^.]+)/)?.[1] ?? ''
    const verifierKey = `sb-${projectRef}-auth-token-code-verifier`
    const verifier = localStorage.getItem(verifierKey)
    if (verifier) {
      document.cookie = `${verifierKey}=${encodeURIComponent(verifier)}; path=/; max-age=300; samesite=lax`
    }

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(url)

    if (!error && data.session) {
      localStorage.setItem('auth_remember_me', '1')
      await fetch('/api/auth/set-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})
      const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
      window.location.replace(`/${savedLocale}/dashboard`)
    } else {
      const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
      const msg = error?.message ?? 'no_session'
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(msg)}`)
    }
  } catch (e: any) {
    const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale
    window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(e?.message ?? 'unknown_error')}`)
  }
}

/**
 * Handles deep links on Android/iOS (Capacitor).
 * After Google/Apple OAuth, Chrome redirects to stockshop://auth/callback?code=...
 * Android intercepts it, opens the app, and this component exchanges the PKCE code for a session.
 */
export function CapacitorDeepLinkHandler({ locale }: { locale: string }) {
  useEffect(() => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.()
    if (!isNative) return

    let removeListener: (() => void) | null = null

    import('@capacitor/app').then(({ App }) => {
      App.getLaunchUrl().then((result) => {
        if (result?.url) handleOAuthUrl(result.url, locale)
      })

      const listenerPromise = App.addListener('appUrlOpen', (event) => {
        handleOAuthUrl(event.url, locale)
      })

      removeListener = () => { listenerPromise.then(h => h.remove()) }
    })

    return () => { removeListener?.() }
  }, [locale])

  return null
}
