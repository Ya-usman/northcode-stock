'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const VALID_LOCALES = ['en', 'fr', 'ha']

/**
 * Reads the saved locale from localStorage and redirects if the current URL
 * locale doesn't match. Fixes PWA on iOS where cookies are cleared after
 * 7 days but localStorage persists — so the user always lands in their language.
 */
export function LocaleSync({ currentLocale }: { currentLocale: string }) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const saved = localStorage.getItem('NEXT_LOCALE')
    if (!saved || !VALID_LOCALES.includes(saved)) return
    if (saved === currentLocale) return

    // Cookie was cleared (iOS PWA 7-day expiry) but localStorage still has it.
    // Re-write the cookie so the middleware enforces it on the next navigation.
    document.cookie = `NEXT_LOCALE=${saved}; path=/; max-age=31536000; SameSite=lax`
    const newPath = pathname.replace(`/${currentLocale}`, `/${saved}`)
    router.replace(newPath)
  }, [])

  return null
}
