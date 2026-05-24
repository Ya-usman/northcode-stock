'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database'

// Dedicated client for Capacitor Android/iOS OAuth flow.
// isSingleton: false prevents sharing the singleton with createClient() which
// uses cookie-based storage. Without this, signInWithOAuth writes the PKCE
// verifier to cookies (not localStorage), so a stale localStorage value is
// read at exchange time causing "code challenge does not match".
// localStorage is persisted to disk and survives WebView backgrounding.
let _client: ReturnType<typeof createBrowserClient<Database>> | null = null

export function createNativeClient() {
  if (!_client) {
    _client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        isSingleton: false,
        cookies: {
          get: (name) => {
            if (typeof window === 'undefined') return undefined
            return window.localStorage.getItem(name) ?? undefined
          },
          set: (name, value) => {
            if (typeof window !== 'undefined') window.localStorage.setItem(name, value)
          },
          remove: (name) => {
            if (typeof window !== 'undefined') window.localStorage.removeItem(name)
          },
        },
      }
    )
  }
  return _client
}
