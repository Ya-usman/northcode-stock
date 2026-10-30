'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { OfflineLink as Link } from '@/components/ui/offline-link'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, Package, PackagePlus, ArrowRightLeft, ArrowLeftRight, ClipboardCheck, CalendarClock } from 'lucide-react'
import { useRolePermissions, type PermFeature } from '@/lib/hooks/use-role-permissions'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useOffline } from '@/lib/offline/use-offline'
import { cn } from '@/lib/utils/cn'

// Barre d'onglets du module Stock. Chaque onglet reste une route à part (code simple, URL stables et partageables) ;
// la barre latérale et la barre du bas n'ont qu'une entrée « Stock », qui mène à la Vue d'ensemble. Chaque onglet
// garde la permission de sa page.
//
// Posée UNE FOIS par la mise en page du module (app/[locale]/(app)/stock/layout.tsx) : elle reste en place d'un
// onglet à l'autre (validé le 30 oct. 2026) — pas de saut, pas de défilement qui repart à zéro. Le fond de l'onglet
// actif glisse vers l'onglet touché (0,2 s, aucun mouvement si l'appareil demande moins d'animations) ; l'onglet
// touché devient actif TOUT DE SUITE, sans attendre la page. Une ligne à défilement horizontal sur petit écran, bords
// estompés du côté où il reste des onglets (jamais de texte coupé net), onglet actif ramené en vue.
// Masquée hors des pages d'onglet (ex. réception d'un transfert).
export function StockTabs({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { canAccess } = useRolePermissions()
  const { userShops } = useAuth()
  const { isOnline } = useOffline()
  const listRef = useRef<HTMLDivElement>(null)

  const tabs = [
    { href: `/${locale}/stock`, label: t('overview'), icon: LayoutDashboard, show: canAccess('stock' as PermFeature) },
    { href: `/${locale}/stock/products`, label: t('products'), icon: Package, show: canAccess('stock' as PermFeature) },
    { href: `/${locale}/stock/movements`, label: t('movements'), icon: ArrowLeftRight, show: canAccess('movements' as PermFeature) },
    { href: `/${locale}/stock/expiry`, label: t('expiry'), icon: CalendarClock, show: canAccess('expiry_list' as PermFeature) },
    { href: `/${locale}/stock/inventory-count`, label: t('inventory_count'), icon: ClipboardCheck, show: canAccess('inventory_count' as PermFeature) },
    {
      // Sans intérêt pour un compte à une seule boutique — rien à transférer.
      href: `/${locale}/stock/transfers`,
      label: t('transfers'),
      icon: ArrowRightLeft,
      show: canAccess('transfers' as PermFeature) && userShops.length > 1,
    },
    // Produits à commander, regroupés par fournisseur (étape 12) : mêmes droits que le Stock pour consulter
    { href: `/${locale}/stock/replenishment`, label: t('replenishment'), icon: PackagePlus, show: canAccess('stock' as PermFeature) },
  ].filter(tab => tab.show)

  // Onglet touché : actif tout de suite ; la page confirme en changeant d'adresse
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => { setPending(null) }, [pathname])
  const activeHref = pending ?? pathname
  const onTabPage = tabs.some(tab => tab.href === pathname)

  // Fond glissant : position et taille de l'onglet actif ; transitions seulement après la première mesure
  const [indicator, setIndicator] = useState<{ left: number; width: number; top: number; height: number } | null>(null)
  const [animate, setAnimate] = useState(false)
  const measure = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-href="${activeHref}"]`)
    if (!el) { setIndicator(null); return }
    const next = { left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight }
    setIndicator(prev => (prev && prev.left === next.left && prev.width === next.width && prev.top === next.top && prev.height === next.height ? prev : next))
  }, [activeHref])
  useLayoutEffect(() => { measure() }, [measure, tabs.length, onTabPage])
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
    // Largeurs qui changent (police chargée, langue, rotation) : position du fond et bords recalculés
    const ro = new ResizeObserver(() => { measure(); updateFade() })
    ro.observe(el)
    Array.from(el.children).forEach(c => ro.observe(c))
    return () => ro.disconnect()
  }, [measure, updateFade, tabs.length, onTabPage])

  // Onglet actif ramené en vue (marge pour le bord estompé), sans faire défiler la page elle-même
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>(`[data-tab-href="${activeHref}"]`)
    if (!list || !active) return
    const left = active.offsetLeft - 32
    const right = active.offsetLeft + active.offsetWidth + 32
    if (left < list.scrollLeft) list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: 'smooth' })
  }, [activeHref])

  if (tabs.length <= 1 || !onTabPage) return null

  const mask = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent 0, #000 28px' : '#000 0'}, ${fade.right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`
    : undefined

  return (
    <div className="w-fit max-w-full rounded-lg border bg-muted/30 p-1" data-testid="stock-tabs">
      <div
        ref={listRef}
        role="tablist"
        onScroll={updateFade}
        className="relative flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        {indicator && (
          <span
            aria-hidden
            data-testid="stock-tabs-indicator"
            className={cn('pointer-events-none absolute left-0 rounded-md bg-background shadow-sm',
              animate && 'transition-[transform,width] duration-200 ease-out motion-reduce:transition-none')}
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width, top: indicator.top, height: indicator.height }}
          />
        )}
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = activeHref === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // Repère des tours guidés : stock-tab-products, stock-tab-expiry…
              data-tour={`stock-tab-${tab.href.split('/').slice(3).join('-') || 'overview'}`}
              data-tab-href={tab.href}
              isOnline={isOnline}
              onClick={() => { if (tab.href !== pathname) setPending(tab.href) }}
              role="tab"
              aria-selected={isActive}
              className={cn(
                'relative z-10 flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors duration-200 sm:h-9',
                // Sans fond glissant mesuré (tout premier rendu), l'onglet actif garde son propre fond
                isActive ? cn('text-foreground', !indicator && 'bg-background shadow-sm') : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
