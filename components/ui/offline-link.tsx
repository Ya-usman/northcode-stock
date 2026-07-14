'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'

type OfflineLinkProps = ComponentProps<typeof Link> & {
  // Verified via useOffline() (a real request), not navigator.onLine — a
  // required prop rather than calling the hook in here directly, since this
  // component is typically rendered many times in a single .map() (nav
  // lists, tab bars); each instance calling useOffline() itself would mean
  // dozens of redundant connectivity pollers running at once. Callers lift
  // a single useOffline() call and pass isOnline down.
  isOnline: boolean
}

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
export function OfflineLink({ href, onClick, children, isOnline, ...props }: OfflineLinkProps) {
  const router = useRouter()

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return

    if (!isOnline) {
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
