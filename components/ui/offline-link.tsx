'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'

type OfflineLinkProps = ComponentProps<typeof Link>

async function isCachedOrFallback(url: string): Promise<string> {
  try {
    if (!('caches' in window)) return url
    const match = await caches.match(url, { ignoreSearch: false })
    return match ? url : '/offline'
  } catch {
    return '/offline'
  }
}

/**
 * Drop-in replacement for Next.js Link.
 * When offline: checks the SW cache first. If the target page is cached,
 * hard-navigates there (bypassing RSC). If not, redirects to /offline.
 * Prevents Android WebView from showing "Web page not available".
 */
export function OfflineLink({ href, onClick, children, ...props }: OfflineLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (!navigator.onLine) {
      e.preventDefault()
      const url = href.toString()
      isCachedOrFallback(url).then(dest => { window.location.href = dest })
    }
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  )
}
