'use client'

// Accompagnement « Bien démarrer » (lot A) : état par personne (migration 163)
// et moteur des tours guidés. Jamais bloquant : le voile ne capte aucun clic,
// la personne peut utiliser l'écran normalement ; « Passer » arrête le tour.
// Rendu au-dessus des panneaux et fenêtres (z-index), sans les fermer : un
// clic dans la bulle n'est pas vu comme un « clic à l'extérieur » par Radix.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowRight, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { TOURS, onAppPage, type TourId } from '@/lib/onboarding/tours'
import { onOnboarding } from '@/lib/onboarding/events'
import { appPath } from '@/lib/announcements/use-announcements'

const supabase = createClient() as any
const PAD = 6
const BACK_AFTER_MS = 1500

export interface OnboardingState {
  guideDismissed: boolean
  tours: Record<string, { status?: 'started' | 'completed' | 'skipped'; started_at?: string; ended_at?: string }>
}

interface Ctx {
  state: OnboardingState
  loaded: boolean
  activeTour: TourId | null
  startTour: (id: TourId) => void
  dismissGuide: () => void
  restoreGuide: () => void
}

const OnboardingContext = createContext<Ctx | null>(null)
export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding hors de OnboardingProvider')
  return ctx
}

async function post(body: Record<string, unknown>): Promise<OnboardingState | null> {
  try {
    const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return null
    const { onboarding } = await res.json()
    return { guideDismissed: !!onboarding?.guide_dismissed_at, tours: onboarding?.tours || {} }
  } catch { return null }
}

/** Premier élément VISIBLE parmi les sélecteurs (ordinateur / téléphone, menu ouvert / fermé) */
function firstVisible(selectors: string[] | undefined): HTMLElement | null {
  if (!selectors) return null
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') return el
    }
  }
  return null
}

export function OnboardingProvider({ userId, children }: { userId: string | null | undefined; children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState>({ guideDismissed: false, tours: {} })
  const [loaded, setLoaded] = useState(false)
  const [active, setActive] = useState<{ id: TourId; step: number } | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.from('user_onboarding').select('guide_dismissed_at, tours').eq('user_id', userId).maybeSingle()
      .then(({ data, error }: any) => {
        if (cancelled) return
        // Table absente (migration pas encore appliquée) : état vide, rien n'est bloqué
        if (!error && data) setState({ guideDismissed: !!data.guide_dismissed_at, tours: data.tours || {} })
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [userId])

  const record = useCallback(async (body: Record<string, unknown>) => {
    const next = await post(body)
    if (next) setState(next)
  }, [])

  const startTour = useCallback((id: TourId) => {
    setActive({ id, step: 0 })
    setState(s => ({ ...s, tours: { ...s.tours, [id]: { ...s.tours[id], status: s.tours[id]?.status === 'completed' ? 'completed' : 'started' } } }))
    record({ action: 'tour', tour: id, status: 'started' })
  }, [record])

  const endTour = useCallback((status: 'completed' | 'skipped') => {
    if (!active) return
    const id = active.id
    setActive(null)
    setState(s => ({ ...s, tours: { ...s.tours, [id]: { ...s.tours[id], status } } }))
    // Abandon : l'étape où la personne s'est arrêtée (Admin → Activation)
    record({ action: 'tour', tour: id, status, ...(status === 'skipped' ? { step: TOURS[id][active.step]?.id } : {}) })
  }, [active, record])

  // Lien d'une relance e-mail (?tour=add_product…) : le tour démarre seul, puis
  // le paramètre est retiré de l'adresse (un rechargement ne le relance pas)
  const pathname = usePathname()
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const id = url.searchParams.get('tour') as TourId | null
    if (!id || !(id in TOURS)) return
    url.searchParams.delete('tour')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    // Pas d'annulation au démontage : le paramètre est déjà retiré, un second passage
    // (mode strict de React) ne le relirait pas et le tour ne démarrerait jamais
    setTimeout(() => startTour(id), 600) // laisse la page s'afficher
  }, [userId, pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissGuide = useCallback(() => { setState(s => ({ ...s, guideDismissed: true })); record({ action: 'dismiss_guide' }) }, [record])
  const restoreGuide = useCallback(() => { setState(s => ({ ...s, guideDismissed: false })); record({ action: 'restore_guide' }) }, [record])

  const value = useMemo(() => ({ state, loaded, activeTour: active?.id ?? null, startTour, dismissGuide, restoreGuide }), [state, loaded, active, startTour, dismissGuide, restoreGuide])

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          key={`${active.id}-${active.step}`}
          tour={active.id}
          step={active.step}
          onStep={step => setActive({ id: active.id, step })}
          onEnd={endTour}
          onChain={next => { endTour('completed'); setTimeout(() => startTour(next), 0) }}
        />
      )}
    </OnboardingContext.Provider>
  )
}

function TourOverlay({ tour, step, onStep, onEnd, onChain }: {
  tour: TourId; step: number
  onStep: (n: number) => void
  onEnd: (status: 'completed' | 'skipped') => void
  onChain: (next: TourId) => void
}) {
  const t = useTranslations('onboarding')
  const pathname = usePathname()
  const steps = TOURS[tour]
  const s = steps[step]
  const isLast = step === steps.length - 1
  const [rect, setRect] = useState<DOMRect | null>(null)
  // vh / vtop : partie visible (visualViewport) — plus petite que h quand le clavier est ouvert
  const [vp, setVp] = useState({ w: 1280, h: 800, vh: 800, vtop: 0 })
  const missingSince = useRef<number | null>(null)
  const scrolled = useRef(false)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Le tour ne change JAMAIS de page tout seul : il montre le chemin (menu, onglet)
  // et avance quand la personne y arrive ; déjà sur place → étape de chemin sautée
  const current = appPath(pathname)
  const onPage = !s.page || onAppPage(current, s.page)
  useEffect(() => {
    if (s.waitFor?.path && onAppPage(current, s.waitFor.path)) { onStep(step + 1); return }
    // Page quittée en cours de route : retour à l'étape du chemin (sans la ramener de force)
    if (!onPage && s.leaveTo !== undefined) {
      const timer = setTimeout(() => onStep(s.leaveTo!), 600)
      return () => clearTimeout(timer)
    }
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  // Téléphone : à chaque étape, le curseur quitte le champ (y compris celui placé
  // automatiquement à l'ouverture d'un formulaire) → le clavier ne s'ouvre que
  // si la personne touche elle-même un champ. Un champ quitté sans « relatedTarget »
  // n'est pas repris par les fenêtres Radix.
  useEffect(() => {
    const release = () => {
      if (!window.matchMedia('(pointer: coarse)').matches) return
      const a = document.activeElement as HTMLElement | null
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) a.blur()
    }
    const timers = [50, 400, 900].map(ms => setTimeout(release, ms))
    return () => timers.forEach(clearTimeout)
  }, [step])

  // Suivi de l'élément éclairé (il peut changer : menu ouvert, panier, étape de paiement…)
  // dans la partie VISIBLE de l'écran (le clavier du téléphone la réduit)
  const lastScroll = useRef(0)
  useEffect(() => {
    const tick = () => {
      const vv = window.visualViewport
      setVp({ w: window.innerWidth, h: window.innerHeight, vh: vv?.height ?? window.innerHeight, vtop: vv?.offsetTop ?? 0 })
      const el = firstVisible(s.targets)
      if (el) {
        missingSince.current = null
        const r = el.getBoundingClientRect()
        const visTop = vv?.offsetTop ?? 0, visBottom = visTop + (vv?.height ?? window.innerHeight)
        // Première apparition, ou élément sorti de la partie visible (clavier, défilement) : on le recentre
        if (!scrolled.current || ((r.bottom > visBottom - 8 || r.top < visTop) && Date.now() - lastScroll.current > 700)) {
          el.scrollIntoView({ block: 'center', behavior: scrolled.current ? 'auto' : 'smooth' })
          scrolled.current = true
          lastScroll.current = Date.now()
        }
        setRect(el.getBoundingClientRect())
      } else {
        setRect(null)
        if (s.targets && s.backTo !== undefined && onPage) {
          missingSince.current = missingSince.current ?? Date.now()
          if (Date.now() - missingSince.current > BACK_AFTER_MS) onStep(s.backTo)
        }
      }
      if (s.waitFor?.selector && document.querySelector(s.waitFor.selector)) onStep(step + 1)
    }
    tick()
    const i = setInterval(tick, 250)
    window.addEventListener('resize', tick)
    window.addEventListener('scroll', tick, true)
    window.visualViewport?.addEventListener('resize', tick)
    window.visualViewport?.addEventListener('scroll', tick)
    return () => {
      clearInterval(i); window.removeEventListener('resize', tick); window.removeEventListener('scroll', tick, true)
      window.visualViewport?.removeEventListener('resize', tick); window.visualViewport?.removeEventListener('scroll', tick)
    }
  }, [step, onPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Action réelle (produit enregistré, article ajouté, vente validée) : le tour
  // saute à l'étape qui suit celle qui l'attendait, même si la personne est
  // allée plus vite que les explications (formulaire rempli sans « Suivant »)
  useEffect(() => onOnboarding(e => {
    const j = steps.findIndex((x, i) => i >= step && x.waitFor?.event === e)
    if (j >= 0) onStep(j + 1)
  }), [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Échap = passer, sauf si une fenêtre est ouverte (Échap la ferme d'abord).
  // Phase de capture : on regarde AVANT que la fenêtre ne se ferme (sinon fermer
  // un formulaire au clavier arrêtait aussi le tour)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) onEnd('skipped') }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onEnd])

  // Étapes d'explication sans élément : le focus va au bouton principal
  useEffect(() => {
    if (!s.targets) bubbleRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const mobile = vp.w < 640
  const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null
  // Placement de la bulle : sous l'élément s'il y a la place, sinon au-dessus ; téléphone : bandeau haut ou bas
  let bubbleStyle: React.CSSProperties
  if (mobile) {
    // Bandeau en haut ou en bas de la partie VISIBLE, à l'opposé de l'élément éclairé
    const keyboardOpen = vp.vh < vp.h - 100
    const targetLow = hole ? hole.top + hole.height / 2 > vp.vtop + vp.vh / 2 : false
    bubbleStyle = targetLow
      ? { top: vp.vtop + 12, left: 12, right: 12 }
      : { bottom: keyboardOpen ? vp.h - (vp.vtop + vp.vh) + 12 : 84, left: 12, right: 12 }
  } else if (hole) {
    const width = 340
    const left = Math.min(Math.max(12, hole.left + hole.width / 2 - width / 2), vp.w - width - 12)
    bubbleStyle = hole.top + hole.height + 220 < vp.h
      ? { top: hole.top + hole.height + 12, left, width }
      : { bottom: vp.h - hole.top + 12, left, width }
  } else {
    bubbleStyle = { top: '50%', left: '50%', width: 380, transform: 'translate(-50%, -50%)' }
  }

  const k = `tours.${tour}.${s.id}`
  const nextTour = isLast ? s.next : undefined
  const awaiting = !!s.waitFor && onPage

  return (
    <>
      {/* Voile : ne capte aucun clic (l'écran reste utilisable) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[95]">
        {hole ? (
          <div className="absolute rounded-xl ring-2 ring-stockshop-blue/80 motion-safe:transition-all motion-safe:duration-200 dark:ring-blue-400"
            style={{ ...hole, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)' }} />
        ) : <div className="absolute inset-0 bg-slate-900/55" />}
      </div>

      <div ref={bubbleRef} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-live="polite" data-testid="tour-bubble"
        // Radix : un clic dans la bulle n'est pas un « clic à l'extérieur » d'un panneau ouvert
        // …et toucher la bulle ne déplace pas le curseur (sinon la fenêtre le remet dans un champ → clavier)
        onPointerDown={e => e.stopPropagation()} onMouseDown={e => { e.stopPropagation(); e.preventDefault() }} onFocusCapture={e => e.stopPropagation()}
        className="fixed z-[100] rounded-2xl border bg-card p-4 text-card-foreground shadow-2xl"
        style={{ ...bubbleStyle, pointerEvents: 'auto' }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stockshop-blue dark:text-blue-400">
            {t(`tour_names.${tour}` as any)} · {t('step_of', { current: step + 1, total: steps.length })}
          </p>
          <button type="button" onClick={() => onEnd('skipped')} aria-label={t('skip')} className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="tour-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-base font-semibold">{t(`${k}.title` as any)}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t(`${k}.body` as any)}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {steps.map((_, i) => <span key={i} className={cn('h-1.5 rounded-full', i === step ? 'w-4 bg-stockshop-blue dark:bg-blue-400' : 'w-1.5 bg-muted-foreground/30')} />)}
          </div>
          <div className="flex flex-wrap gap-2">
            {isLast ? (
              <>
                {nextTour && <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => onChain(nextTour)} data-testid="tour-chain">{t('continue_with', { name: t(`tour_names.${nextTour}` as any) })}<ArrowRight className="h-3.5 w-3.5" /></Button>}
                <Button size="sm" variant="stockshop" className="h-9" data-primary onClick={() => onEnd('completed')} data-testid="tour-finish">{t('finish')}</Button>
              </>
            ) : awaiting ? (
              <span className="text-xs font-medium text-stockshop-blue dark:text-blue-400" data-testid="tour-awaiting">{t('do_action')}</span>
            ) : (
              <Button size="sm" variant="stockshop" className="h-9 gap-1" data-primary onClick={() => onStep(step + 1)} data-testid="tour-next">{t('next')}<ArrowRight className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
