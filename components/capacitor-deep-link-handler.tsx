'use client'

import { useEffect } from 'react'

async function handleOAuthUrl(url: string, locale: string) {
  if (!url.startsWith('stockshop://auth')) return

  const savedLocale = localStorage.getItem('NEXT_LOCALE') || locale

  try {
    // Extract the authorization code from the deep link URL
    const code = new URLSearchParams(url.split('?')[1] ?? '').get('code')
    if (!code) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent('no_code_in_url')}`)
      return
    }

    // Read the PKCE code verifier from our stable backup key (written in login page
    // right after signInWithOAuth, from whatever storage Supabase used).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const projectRef = supabaseUrl.match(/\/\/([^.]+)/)?.[1] ?? ''

    const codeVerifier =
      localStorage.getItem('__oauth_pkce_verifier') ||
      localStorage.getItem(`sb-${projectRef}-auth-token-code-verifier`)

    if (!codeVerifier) {
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent('verifier_not_found')}`)
      return
    }

    // Clean up backup key
    localStorage.removeItem('__oauth_pkce_verifier')

    // Exchange code + verifier directly with Supabase token endpoint — bypasses client storage entirely
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
    })

    const tokenData = await res.json()

    if (!res.ok || !tokenData.access_token) {
      const msg = tokenData.error_description ?? tokenData.msg ?? tokenData.error ?? 'token_exchange_failed'
      window.location.replace(`/${savedLocale}/login?error=${encodeURIComponent(msg)}`)
      return
    }

    // Set session on the SSR client so middleware and the app recognize the user
    const { createClient } = await import('@/lib/supabase/client')
    await createClient().auth.setSession({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    })

    localStorage.setItem('auth_remember_me', '1')
    await fetch('/api/auth/set-role', {
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
