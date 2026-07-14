'use client'

import { useEffect } from 'react'
import { withTimeout } from '@/lib/utils/with-timeout'

// Prevent double-handling when both getLaunchUrl and appUrlOpen fire for the same URL
let handledCode: string | null = null

async function handleOAuthUrl(url: string, locale: string) {
  if (!url.startsWith('stockshop://auth')) return

  const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale

  try {
    const code = new URLSearchParams(url.split('?')[1] ?? '').get('code')
    if (!code) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent('no_code_in_url')}`)
      return
    }

    // Prevent double-handling (getLaunchUrl + appUrlOpen can both fire)
    if (handledCode === code) return
    handledCode = code

    const codeVerifier = localStorage.getItem('__oauth_pkce_verifier')
    if (!codeVerifier) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent('verifier_not_found')}`)
      return
    }
    localStorage.removeItem('__oauth_pkce_verifier')

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    // Exchange code + verifier directly with Supabase — bypasses client storage entirely.
    // Bounded: without a timeout, a hung request here leaves the user stuck on the
    // native splash screen with no error and no way in except force-quitting the app.
    const res = await withTimeout(fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': supabaseAnonKey },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    }), 15_000)

    const tokenData = await res.json()

    if (!res.ok || !tokenData.access_token) {
      const msg = tokenData.error_description ?? tokenData.msg ?? tokenData.error ?? 'token_exchange_failed'
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(msg)}`)
      return
    }

    // Set session on the SSR client so cookies are written for middleware
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    })

    if (sessionError) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(sessionError.message)}`)
      return
    }

    // Verify session was persisted before redirecting
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent('session_not_persisted')}`)
      return
    }

    localStorage.setItem('auth_remember_me', '1')
    // Fire-and-forget: its own error is already ignored, so it must not be
    // awaited either — otherwise a hung request here would still block the
    // redirect below despite the .catch() suggesting it shouldn't.
    fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})

    window.location.replace(`/${savedLocale}/dashboard`)
  } catch (e: any) {
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
