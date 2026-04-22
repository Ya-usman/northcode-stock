'use client'

import { useEffect } from 'react'

/**
 * Forces light mode for the duration this component is mounted.
 * Removes the `dark` class from <html> on mount, restores it on unmount.
 */
export function ForceLight({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement
    const hadDark = html.classList.contains('dark')
    html.classList.remove('dark')
    return () => {
      if (hadDark) html.classList.add('dark')
    }
  }, [])

  return <>{children}</>
}
