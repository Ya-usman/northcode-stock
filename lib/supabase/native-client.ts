'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database'

// Mobile OAuth client: redirects cookie storage to localStorage.
// localStorage is persisted to disk on Android WebView — it survives
// when the renderer process is killed while Chrome is in foreground.
// Session cookies are memory-only and are lost in that scenario.
export function createNativeClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
