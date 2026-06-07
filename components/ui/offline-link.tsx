'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'

// Module-level tracker updated by events — more reliable than reading
// navigator.onLine at click time, which can be stale on Android.
let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { _isOnline = true  })
  window.addEventListener('offline', () => { _isOnline = false })
}

type OfflineLinkProps = ComponentProps<typeof Link>

/**
 * Drop-in replacement for Next.js Link.
 * When offline: bypasses the RSC client-side navigation entirely and does a
 * hard navigation via window.location.href. The SW intercepts it, serves
 * from next-pages cache or returns the /offline fallback.
 * Prevents Android WebView from showing "Web page not available".
 */
export function OfflineLink({ href, onClick, children, ...props }: OfflineLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (!_isOnline) {
      e.preventDefault()
      // Hard navigate: SW handles it (cache hit → page, miss → /offline).
      // Never trust async caches.match() here — the SW already has the logic.
      window.location.href = href.toString()
    }
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  )
}
