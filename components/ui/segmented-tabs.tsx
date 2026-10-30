'use client'

// Barre d'onglets commune de l'application (validée le 30 oct. 2026 sur le Stock, puis étendue à toutes les barres
// d'onglets de navigation) : fond de l'onglet actif qui GLISSE vers l'onglet choisi (0,2 s ; aucun mouvement si
// l'appareil demande moins d'animations), onglet actif dès le toucher, une ligne qui défile sur petit écran avec des
// bords ESTOMPÉS du côté où il reste des onglets (jamais de texte coupé net), onglet actif ramené en vue, onglets de
// 40 px sur téléphone, flèches / Début / Fin au clavier.
//
// Deux usages : onglets-BOUTONS (vue de la page : value + onChange) ou onglets-LIENS (pages d'un module : href ;
// l'onglet touché est actif avant que la nouvelle page s'affiche).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { OfflineLink } from '@/components/ui/offline-link'
import { useOffline } from '@/lib/offline/use-offline'
import { cn } from '@/lib/utils/cn'

export interface SegmentedTabItem {
  key: string
  label: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Onglet-lien (navigation entre pages) */
  href?: string
  /** Attributs propres à l'onglet (data-testid, data-tour, id, aria-controls…) */
  attrs?: Record<string, string | undefined>
}

export function SegmentedTabs({
  items, value, onChange, ariaLabel, fill = false, className, testId, onKeyNavigate,
}: {
  items: SegmentedTabItem[]
  /** Onglet actif */
  value: string
  /** Onglets-boutons : choix d'un onglet */
  onChange?: (key: string) => void
  ariaLabel?: string
  /** Téléphone : onglets de largeur égale sur toute la ligne (fiche boutique) */
  fill?: boolean
  className?: string
  testId?: string
  /** Après une navigation au clavier (ex. donner le focus au bon onglet est géré ici ; rien à faire en général) */
  onKeyNavigate?: (key: string) => void
}) {
  const { isOnline } = useOffline()
  const listRef = useRef<HTMLDivElement>(null)

  // Onglet touché : actif tout de suite ; la page confirme ensuite en changeant `value` (adresse, état de la page).
  // Sans confirmation (navigation refusée, hors ligne), l'état « touché » s'efface seul.
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => { setPending(null) }, [value])
  useEffect(() => {
    if (!pending) return
    const id = window.setTimeout(() => setPending(null), 8000)
    return () => window.clearTimeout(id)
  }, [pending])
  const choose = (key: string) => { if (key !== value) setPending(key); onChange?.(key) }
  const active = pending ?? value

  // Fond glissant : position / taille de l'onglet actif ; transitions après la première mesure seulement
  const [indicator, setIndicator] = useState<{ left: number; width: number; top: number; height: number } | null>(null)
  const [animate, setAnimate] = useState(false)
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seg-key="${CSS.escape(active)}"]`)
    if (!el) { setIndicator(null); return }
    const next = { left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight }
    setIndicator(prev => (prev && prev.left === next.left && prev.width === next.width && prev.top === next.top && prev.height === next.height ? prev : next))
  }, [active])
  const keys = items.map(i => i.key).join('|')
  useLayoutEffect(() => { measure() }, [measure, keys])
  useEffect(() => {
    if (!indicator || animate) return
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [indicator, animate])

  // Bords estompés du côté où il reste des onglets
  const [fade, setFade] = useState({ left: false, right: false })
  const updateFade = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setFade(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    updateFade()
    // Largeurs qui changent (police, langue, rotation, compteur dans un onglet) : fond et bords recalculés
    const ro = new ResizeObserver(() => { measure(); updateFade() })
    ro.observe(el)
    Array.from(el.children).forEach(c => ro.observe(c))
    return () => ro.disconnect()
  }, [measure, updateFade, keys])

  // Onglet actif ramené en vue (marge pour le bord estompé), sans faire défiler la page
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-seg-key="${CSS.escape(active)}"]`)
    if (!list || !el) return
    const left = el.offsetLeft - 32, right = el.offsetLeft + el.offsetWidth + 32
    if (left < list.scrollLeft) list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: 'smooth' })
  }, [active])

  const mask = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent 0, #000 28px' : '#000 0'}, ${fade.right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`
    : undefined

  // Clavier (onglets-boutons) : flèches, Début, Fin — l'onglet choisi reçoit le focus
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!onChange) return
    const i = items.findIndex(x => x.key === active)
    const next = e.key === 'ArrowRight' ? (i + 1) % items.length : e.key === 'ArrowLeft' ? (i - 1 + items.length) % items.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const key = items[next].key
    choose(key)
    onKeyNavigate?.(key)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-seg-key="${CSS.escape(key)}"]`)?.focus())
  }

  return (
    <div className={cn('max-w-full rounded-lg border bg-muted/30 p-1', fill ? 'w-full sm:w-fit' : 'w-fit', className)} data-testid={testId}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={updateFade}
        onKeyDown={onKeyDown}
        className="relative flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        {indicator && (
          <span
            aria-hidden
            data-testid="segmented-indicator"
            className={cn('pointer-events-none absolute left-0 rounded-md bg-background shadow-sm',
              animate && 'transition-[transform,width] duration-200 ease-out motion-reduce:transition-none')}
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width, top: indicator.top, height: indicator.height }}
          />
        )}
        {items.map(item => {
          const Icon = item.icon
          const isActive = active === item.key
          const cls = cn(
            'relative z-10 flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors duration-200 sm:h-9',
            fill && 'flex-1 sm:flex-none',
            // Tout premier rendu (fond glissant pas encore mesuré) : l'onglet actif garde son propre fond
            isActive ? cn('text-foreground', !indicator && 'bg-background shadow-sm') : 'text-muted-foreground hover:text-foreground',
          )
          const content = <>{Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}{item.label}</>
          if (item.href) {
            return (
              <OfflineLink key={item.key} href={item.href} isOnline={isOnline} role="tab" aria-selected={isActive} data-seg-key={item.key}
                onClick={() => { if (item.key !== value) setPending(item.key) }} className={cls} {...item.attrs}>
                {content}
              </OfflineLink>
            )
          }
          return (
            <button key={item.key} type="button" role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1} data-seg-key={item.key}
              onClick={() => choose(item.key)} className={cls} {...item.attrs}>
              {content}
            </button>
          )
        })}
      </div>
    </div>
  )
}
