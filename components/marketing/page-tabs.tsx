'use client'

// Onglets des pages publiques Plateforme et Santé (7 nov. 2026, demande de l'utilisateur) : une partie affichée à la
// fois au lieu d'une longue page. Tout le contenu reste dans le HTML (moteurs de recherche, page générée à l'avance) ; les autres parties
// sont seulement cachées. Chaque onglet a son adresse (#vente, #stock…) : lien partageable, bouton Retour, liens de
// l'accueil et du pied de page qui ouvrent le bon onglet. Vrais onglets au clavier (flèches, Début, Fin).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { IconArrow } from './icons'

// Ramène le haut des onglets sous l'en-tête si le visiteur était descendu dans une partie (sinon rien ne bouge)
function scrollToTabs(anchor: HTMLElement | null) {
  if (!anchor) return
  const header = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0
  const target = anchor.getBoundingClientRect().top + window.scrollY - header
  if (window.scrollY > target) window.scrollTo({ top: target })
}

export interface PageTab { id: string; label: string; next?: string; content: ReactNode }

export function PageTabs({ label, tabs, testid }: { label: string; tabs: PageTab[]; testid: string }) {
  const [active, setActive] = useState(tabs[0].id)
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const isTab = useCallback((id: string) => tabs.some(t => t.id === id), [tabs])

  // Onglet demandé par l'adresse : à l'arrivée, avec Retour / Suivant du navigateur, ou par un lien de la page
  useEffect(() => {
    const hashId = () => decodeURIComponent(window.location.hash.slice(1))
    const first = hashId()
    setActive(isTab(first) ? first : tabs[0].id)
    // Adresse d'un onglet (ou plus d'adresse : retour au début) ; une autre ancre de la page (#liste…) ne change pas
    // l'onglet ouvert et laisse le navigateur y descendre
    const onHash = () => {
      const id = hashId()
      if (id && !isTab(id)) return
      setActive(id ? id : tabs[0].id)
      scrollToTabs(anchorRef.current)
    }
    // Liens Next.js vers un onglet de cette page (pied de page) : l'adresse change sans événement hashchange
    const onLink = (e: globalThis.MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null
      if (!a || a.closest('[role="tablist"], [role="tabpanel"]')) return
      const url = new URL(a.href)
      const id = decodeURIComponent(url.hash.slice(1))
      if (url.pathname !== window.location.pathname || !isTab(id)) return
      setActive(id)
      requestAnimationFrame(() => scrollToTabs(anchorRef.current))
    }
    window.addEventListener('popstate', onHash)
    window.addEventListener('hashchange', onHash)
    document.addEventListener('click', onLink)
    return () => {
      window.removeEventListener('popstate', onHash); window.removeEventListener('hashchange', onHash)
      document.removeEventListener('click', onLink)
    }
  }, [isTab, tabs])

  // Onglet actif toujours visible dans la rangée qui défile sur téléphone
  useEffect(() => {
    const row = listRef.current, tab = row?.querySelector<HTMLElement>(`[aria-selected="true"]`)
    if (row && tab && (tab.offsetLeft < row.scrollLeft || tab.offsetLeft + tab.offsetWidth > row.scrollLeft + row.clientWidth)) {
      row.scrollTo({ left: tab.offsetLeft - 16, behavior: 'smooth' })
    }
  }, [active])

  const select = (id: string, focus = false) => {
    if (id !== active) {
      setActive(id)
      window.history.pushState(null, '', `#${id}`)
    }
    scrollToTabs(anchorRef.current)
    if (focus) document.getElementById(`tab-${id}`)?.focus()
  }
  const onClick = (id: string) => (e: MouseEvent) => { e.preventDefault(); select(id) }
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex(t => t.id === active)
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    select(tabs[to].id, true)
  }

  return (
    <>
      <div ref={anchorRef} />
      <nav className="subnav" aria-label={label} data-testid={`${testid}-nav`}>
        <div className="wrap" ref={listRef} role="tablist" aria-label={label} onKeyDown={onKey}>
          {tabs.map(t => (
            <a key={t.id} id={`tab-${t.id}`} href={`#${t.id}`} role="tab" aria-selected={active === t.id} aria-controls={t.id}
              tabIndex={active === t.id ? 0 : -1} onClick={onClick(t.id)}>{t.label}</a>
          ))}
        </div>
      </nav>
      {tabs.map((t, i) => (
        <div key={t.id} id={t.id} className="tabpanel" role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} data-testid={`${testid}-panel-${t.id}`}>
          {t.content}
          {t.next && tabs[i + 1] && (
            <div className="tab-next">
              <a href={`#${tabs[i + 1].id}`} onClick={onClick(tabs[i + 1].id)} data-testid={`${testid}-next`}>{t.next} <IconArrow /></a>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
