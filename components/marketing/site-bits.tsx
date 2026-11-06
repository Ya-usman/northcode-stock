'use client'

// Petits morceaux interactifs des pages publiques : bouton d'essai collant (téléphone), langues du pied de page,
// aperçu des tarifs (prix de départ du pays du visiteur, lu dans lib/saas comme la page Tarifs).
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE_LANGUAGES, pathInLocale, rememberLocale } from '@/lib/site/pages'
import { defaultPricingCountry } from '@/lib/saas/plan-offer'

/** « Essai gratuit » collé en bas sur téléphone, seulement une fois le haut de page dépassé ([data-sticky-anchor]). */
export function StickyTrial({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const anchor = document.querySelector('[data-sticky-anchor]')
    if (!anchor || !('IntersectionObserver' in window)) {
      const onScroll = () => setShow(window.scrollY > 480)
      onScroll(); window.addEventListener('scroll', onScroll, { passive: true })
      return () => window.removeEventListener('scroll', onScroll)
    }
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(anchor)
    return () => io.disconnect()
  }, [])
  return (
    <div className={`sticky-cta${show ? ' show' : ''}`} aria-hidden={!show} data-testid="site-sticky-trial">
      <Link href={href} className="btn btn-cta" tabIndex={show ? 0 : -1}>{label}</Link>
    </div>
  )
}

/** Rappel des langues en bas de page (même page dans l'autre langue). */
export function FooterLanguages({ locale, label }: { locale: string; label: string }) {
  const pathname = usePathname() || `/${locale}`
  return (
    <nav className="langs" aria-label={label} data-testid="site-footer-langs">
      {SITE_LANGUAGES.map(l => (
        <a key={l.code} href={pathInLocale(pathname, locale, l.code)} lang={l.code} aria-current={l.code === locale ? 'true' : undefined} onClick={() => rememberLocale(l.code)}>{l.name}</a>
      ))}
    </nav>
  )
}

/** Prix de départ (Starter, mensuel) dans la devise facturée du pays du visiteur : pays de l'hébergeur, sinon langue.
 *  Les prix déjà mis en forme par pays sont préparés par le serveur (lib/saas), le navigateur ne fait que choisir. */
export function StartingPrice({ locale, prices }: { locale: string; prices: Record<string, string> }) {
  const known = (c: string) => c in prices
  const [code, setCode] = useState(() => defaultPricingCountry(locale, null, known))
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    fetch('/api/geo').then(r => (r.ok ? r.json() : null)).then(j => {
      if (alive.current && j?.country) setCode(defaultPricingCountry(locale, j.country, known))
    }).catch(() => {})
    return () => { alive.current = false }
  }, [locale])
  return <span data-testid="site-price-from">{prices[code]}</span>
}
