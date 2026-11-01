'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { setLocaleCookie } from '@/lib/utils/cookies'
import { installHausaDates } from '@/lib/i18n/hausa-dates-polyfill'

// Dates haoussa (31 oct. 2026) : branchées dès le chargement de l'application, avant le premier affichage d'un écran
// (ce module est chargé par la mise en page commune de toutes les pages localisées)
installHausaDates()

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
    setLocaleCookie(saved)
    // Seule la langue en tête du chemin change ; paramètres (?tab=, ?view=…) et ancre conservés
    const newPath = pathname.replace(new RegExp(`^/${currentLocale}(?=/|$)`), `/${saved}`)
    router.replace(newPath + window.location.search + window.location.hash)
  }, [])

  return null
}
