'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// ════════════════════════════════════════════════════════════════════════
// BARRE DE NAVIGATION — StockShop
// ════════════════════════════════════════════════════════════════════════
// Démarre seulement sur une VRAIE intention de navigation :
//   • clic gauche sur un lien interne vers une adresse différente (pas de
//     Ctrl / Cmd / Maj / Alt, pas de nouvel onglet, pas de téléchargement) ;
//   • navigation lancée par le code via startNavigationProgress(href).
// Elle n'intercepte plus history.pushState / replaceState : Next.js et
// plusieurs pages réécrivent l'adresse SANS changer de page (onglet déjà
// actif, filtres retirés de l'URL, langue), ce qui laissait la barre figée à
// 80 % pendant 4 s.
// Fin : dès que l'adresse (chemin OU paramètres) diffère de celle du départ,
// ou au retour arrière du navigateur. Progression continue qui ralentit en
// approchant de 90 % ; affichage différé de 150 ms (aucun clignotement sur
// une navigation instantanée) ; sécurité à 12 s.

const EVENT = 'stockshop:navigation-start'
const SHOW_DELAY = 150
const SAFETY_MS = 12_000

const currentUrl = () => window.location.pathname + window.location.search

/** Adresse interne différente de l'adresse actuelle ? (sinon : pas de barre) */
function isRealNavigation(href: string): boolean {
  try {
    const u = new URL(href, window.location.href)
    if (u.origin !== window.location.origin) return false
    return u.pathname + u.search !== currentUrl()
  } catch {
    return false
  }
}

/** À appeler juste avant router.push / router.replace vers une autre page. */
export function startNavigationProgress(href?: string) {
  if (typeof window === 'undefined') return
  if (href && !isRealNavigation(href)) return
  window.dispatchEvent(new Event(EVENT))
}

export function NavigationProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const running = useRef(false)
  const startUrl = useRef('')
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; trickle?: ReturnType<typeof setInterval>; watch?: ReturnType<typeof setInterval>; safety?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({})

  const clearAll = () => {
    const t = timers.current
    if (t.show) clearTimeout(t.show)
    if (t.trickle) clearInterval(t.trickle)
    if (t.watch) clearInterval(t.watch)
    if (t.safety) clearTimeout(t.safety)
    if (t.hide) clearTimeout(t.hide)
    timers.current = {}
  }

  const finish = () => {
    if (!running.current) return
    running.current = false
    clearAll()
    // Affichée : on la complète puis on l'efface ; jamais affichée : rien
    setVisible(v => {
      if (v) {
        setWidth(100)
        timers.current.hide = setTimeout(() => { setVisible(false); setWidth(0) }, 300)
      }
      return v
    })
  }

  const start = () => {
    if (running.current) return
    running.current = true
    startUrl.current = currentUrl()
    clearAll()
    setWidth(0)
    timers.current.show = setTimeout(() => {
      if (!running.current) return
      setVisible(true)
      setWidth(12)
      // Avance toujours, de moins en moins vite, sans jamais atteindre 90 %
      timers.current.trickle = setInterval(() => {
        setWidth(w => (w >= 90 ? w : w + Math.max(0.4, (90 - w) * 0.08)))
      }, 200)
    }, SHOW_DELAY)
    // L'adresse change à la fin de la navigation (chemin ou paramètres)
    timers.current.watch = setInterval(() => { if (currentUrl() !== startUrl.current) finish() }, 100)
    timers.current.safety = setTimeout(finish, SAFETY_MS)
  }

  // Clic sur un lien interne vers une autre adresse
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      const link = (e.target as HTMLElement | null)?.closest?.('a')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('blob:') || href.startsWith('data:')) return
      if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return
      if (!isRealNavigation(href)) return
      start()
    }
    const onStart = () => start()
    const onPop = () => finish()
    document.addEventListener('click', onClick, true)
    window.addEventListener(EVENT, onStart)
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener(EVENT, onStart)
      window.removeEventListener('popstate', onPop)
      clearAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nouvelle page affichée
  useEffect(() => { finish() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible && width === 0) return null

  return (
    <div
      aria-hidden="true"
      data-testid="navigation-progress"
      className="fixed left-0 top-0 z-[9999] h-[3px] bg-stockshop-blue shadow-sm shadow-blue-400/50 transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none dark:bg-blue-500"
      style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
    />
  )
}
