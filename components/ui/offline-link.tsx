'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'

type OfflineLinkProps = ComponentProps<typeof Link>

/**
 * Drop-in replacement for Next.js Link.
 * When the device is offline, bypasses RSC client navigation and
 * uses window.location.href (hard nav) so the SW can serve the
 * cached HTML directly — preventing "web page not available" on Android.
 */
export function OfflineLink({ href, onClick, children, ...props }: OfflineLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (!navigator.onLine) {
      e.preventDefault()
      window.location.href = href.toString()
    }
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  )
}
