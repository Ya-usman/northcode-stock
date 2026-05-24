'use client'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

// Dedicated client for Capacitor Android/iOS OAuth flow.
// Uses localStorage (persisted to disk) instead of session cookies so the
// PKCE code verifier survives WebView backgrounding between signInWithOAuth
// and exchangeCodeForSession (which run in separate Chrome/WebView contexts).
let _client: ReturnType<typeof createClient<Database>> | null = null

export function createNativeClient() {
  if (!_client) {
    _client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
        },
      }
    )
  }
  return _client
}
