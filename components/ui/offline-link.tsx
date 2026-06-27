'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'

let _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { _isOnline = true  })
  window.addEventListener('offline', () => { _isOnline = false })
}

type OfflineLinkProps = ComponentProps<typeof Link>

/**
 * Drop-in replacement for Next.js Link.
 *
 * When offline, intercepts the click, cancels the default <a> navigation and
 * uses router.push() instead. This guarantees the navigation stays SPA (RSC fetch)
 * and never falls back to a hard WebView navigation — which would bypass the SW
 * and trigger ERR_INTERNET_DISCONNECTED on Android when the page isn't cached.
 *
 * If the RSC fetch fails offline, React's error boundary (error.tsx) catches it
 * and shows the in-app offline UI instead of the native browser error page.
 */
export function OfflineLink({ href, onClick, children, ...props }: OfflineLinkProps) {
  const router = useRouter()

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return

    if (!_isOnline) {
      // Prevent any <a> default that could fall back to a hard navigate,
      // then push client-side — RSC errors land in error.tsx, not the WebView.
      e.preventDefault()
      const target = typeof href === 'string' ? href : (href as any)?.pathname ?? '/'
      router.push(target)
    }
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  )
}

export { _isOnline as isOnlineFast }
