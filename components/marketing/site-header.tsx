'use client'

// En-tête des pages publiques. Ordinateur : vraies pages, langue en menu déroulant, thème, Se connecter, Essai gratuit
// (jaune). Téléphone : menu ☰ plein écran (pages, « Langue : Français › » qui ouvre la liste, thème, boutons).
// Textes passés par le serveur (aucun catalogue de traductions envoyé au navigateur pour l'en-tête).
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLogo } from '@/components/brand/brand-logo'
import { useTheme } from '@/lib/hooks/use-theme'
import { SITE_LANGUAGES, languageName, livePages, pathInLocale, rememberLocale, type SitePageKey } from '@/lib/site/pages'
import { IconArrow, IconBack, IconCheck, IconChevron, IconChevronDown, IconClose, IconLanguage, IconMenu, IconMoon, IconSun } from './icons'

export interface SiteHeaderLabels {
  home: string; login: string; trial: string; trial_long: string
  menu_open: string; menu_close: string; theme_dark: string; theme_light: string; theme: string
  language: string; language_choose: string; back: string
  pages: Record<SitePageKey, { label: string; sub: string }>
}

export function SiteHeader({ locale, labels }: { locale: string; labels: SiteHeaderLabels }) {
  const pathname = usePathname() || `/${locale}`
  const { isDark, toggle } = useTheme()
  const [menu, setMenu] = useState<'closed' | 'main' | 'languages'>('closed')
  const [langOpen, setLangOpen] = useState(false)
  const langRef = useRef<HTMLDivElement>(null)
  const pages = livePages()
  const here = (path: string) => pathname === `/${locale}${path}` || pathname.startsWith(`/${locale}${path}/`)

  // Menu du téléphone : page figée derrière, Échap pour fermer ; fermé à chaque changement de page
  useEffect(() => { setMenu('closed') }, [pathname])
  useEffect(() => {
    if (menu === 'closed') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu('closed') }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [menu])
  // Menu des langues (ordinateur) : fermé par un clic à côté ou Échap
  useEffect(() => {
    if (!langOpen) return
    const onDown = (e: MouseEvent) => { if (!langRef.current?.contains(e.target as Node)) setLangOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangOpen(false) }
    document.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [langOpen])

  const langHref = (code: string) => pathInLocale(pathname, locale, code)
  const setTheme = (dark: boolean) => { if (dark !== isDark) toggle() }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link href={`/${locale}`} aria-label={labels.home} className="brand-link" data-testid="site-home">
            <BrandLogo tone="auto" className="text-xl" />
          </Link>
          <nav className="site-nav" aria-label={labels.home}>
            {pages.map(p => (
              <Link key={p.key} href={`/${locale}${p.path}`} aria-current={here(p.path) ? 'page' : undefined} data-testid={`site-nav-${p.key}`}>{labels.pages[p.key].label}</Link>
            ))}
          </nav>
          <div className="hdr-right">
            <div className="lang-menu" ref={langRef}>
              <button type="button" className="lang-btn" aria-haspopup="true" aria-expanded={langOpen} aria-label={`${labels.language} : ${languageName(locale)}`} onClick={() => setLangOpen(o => !o)} data-testid="site-lang">
                <IconLanguage />{languageName(locale)}<IconChevronDown />
              </button>
              {langOpen && (
                <ul className="lang-list" data-testid="site-lang-list">
                  {SITE_LANGUAGES.map(l => (
                    <li key={l.code}>
                      <a href={langHref(l.code)} lang={l.code} aria-current={l.code === locale ? 'true' : undefined} onClick={() => rememberLocale(l.code)}>
                        {l.name}{l.code === locale && <IconCheck />}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className="icon-btn" onClick={toggle} aria-label={isDark ? labels.theme_light : labels.theme_dark} title={isDark ? labels.theme_light : labels.theme_dark} data-testid="site-theme">
              {isDark ? <IconSun /> : <IconMoon />}
            </button>
            <Link href={`/${locale}/login`} className="btn btn-ghost btn-sm" data-testid="site-login">{labels.login}</Link>
            <Link href={`/${locale}/register`} className="btn btn-cta btn-sm" data-testid="site-trial">{labels.trial}</Link>
            <button type="button" className="burger" aria-expanded={menu !== 'closed'} aria-controls="site-mmenu" aria-label={menu !== 'closed' ? labels.menu_close : labels.menu_open} onClick={() => setMenu(m => (m === 'closed' ? 'main' : 'closed'))} data-testid="site-menu-toggle">
              {menu !== 'closed' ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>
      </header>

      {menu === 'main' && (
        <div className="mmenu" id="site-mmenu" data-testid="site-mmenu">
          {pages.map(p => (
            <Link key={p.key} className="l" href={`/${locale}${p.path}`} aria-current={here(p.path) ? 'page' : undefined}>
              <span>{labels.pages[p.key].label}<small>{labels.pages[p.key].sub}</small></span><IconArrow />
            </Link>
          ))}
          <button type="button" className="l" onClick={() => setMenu('languages')} data-testid="site-mmenu-lang">
            <span>{labels.language}</span><span className="val">{languageName(locale)}<IconChevron /></span>
          </button>
          <div className="seg" role="group" aria-label={labels.theme}>
            <button type="button" aria-pressed={!isDark} onClick={() => setTheme(false)}>{labels.theme_light}</button>
            <button type="button" aria-pressed={isDark} onClick={() => setTheme(true)} data-testid="site-mmenu-dark">{labels.theme_dark}</button>
          </div>
          <div className="btns">
            <Link href={`/${locale}/register`} className="btn btn-cta">{labels.trial_long}</Link>
            <Link href={`/${locale}/login`} className="btn btn-ghost">{labels.login}</Link>
          </div>
        </div>
      )}
      {menu === 'languages' && (
        <div className="mmenu" id="site-mmenu" data-testid="site-mmenu-languages">
          <button type="button" className="l" onClick={() => setMenu('main')}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><IconBack />{labels.language_choose}</span></button>
          {SITE_LANGUAGES.map(l => (
            <a key={l.code} className="lang-opt" href={langHref(l.code)} lang={l.code} aria-current={l.code === locale ? 'true' : undefined} onClick={() => rememberLocale(l.code)}>
              {l.name}{l.code === locale && <IconCheck />}
            </a>
          ))}
        </div>
      )}
    </>
  )
}
