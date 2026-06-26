'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'

// Tracks online state at module level — updated by browser events.
// navigator.onLine is unreliable on Capacitor Android WebView,
// so we use the real HEAD-request check from useOffline() as the source
// of truth for sync decisions. Here we only use this for navigation guards.
let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { _isOnline = true  })
  window.addEventListener('offline', () => { _isOnline = false })
}

type OfflineLinkProps = ComponentProps<typeof Link>

/**
 * Drop-in replacement for Next.js Link.
 *
 * Navigation strategy:
 * - ALWAYS uses Next.js client-side RSC navigation (never window.location.href).
 * - RSC fetches are subresource requests (not top-level navigations), so
 *   they CANNOT trigger the Android WebView "Web page not available" native
 *   error screen — they fail gracefully through React's error boundary instead.
 * - The SW's StaleWhileRevalidate strategy serves RSC payloads from cache
 *   instantly, even offline, for any page that has been prefetched.
 *
 * Why we removed window.location.href when offline:
 *   Hard navigation (window.location.href) is a top-level WebView navigation.
 *   When the SW has no cache entry for the URL AND the network is offline,
 *   Android WebView shows its native error page — bypassing both the SW
 *   fallback (/offline) and React's error boundary entirely.
 */
export function OfflineLink({ href, onClick, children, ...props }: OfflineLinkProps) {
  return (
    <Link href={href} onClick={onClick} {...props}>
      {children}
    </Link>
  )
}

// Export the online tracker so other modules can read it without subscribing
// to events (useful for quick synchronous checks in event handlers).
export { _isOnline as isOnlineFast }
