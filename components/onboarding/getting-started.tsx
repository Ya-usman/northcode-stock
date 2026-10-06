'use client'

// Guide « Bien démarrer » (lot A) — carte du tableau de bord pour le
// propriétaire d'un compte qui débute. Étapes cochées d'après les VRAIES
// données (produits, ventes, catégories, équipe, reçu) de ses boutiques.
// Affiché si : propriétaire, guide non masqué, tout n'est pas fait, et compte
// récent (≤ 30 jours) OU ni produit ni vente encore. Retrouvable dans Aide.

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown, Compass, PlayCircle, Rocket, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { isAccountOwner } from '@/lib/team/roles'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { useOnboarding } from '@/components/onboarding/onboarding-provider'
import type { TourId } from '@/lib/onboarding/tours'

const supabase = createClient() as any
const NEW_ACCOUNT_DAYS = 30

type StepId = 'product' | 'sale' | 'category' | 'team' | 'receipt'
const STEPS: { id: StepId; path: string; tour?: TourId }[] = [
  { id: 'product', path: 'stock/products', tour: 'add_product' },
  { id: 'sale', path: 'sales/new', tour: 'first_sale' },
  { id: 'category', path: 'categories' },
  { id: 'team', path: 'team' },
  { id: 'receipt', path: 'settings' },
]

/** État des 5 étapes pour les boutiques du propriétaire (null = en cours de lecture) */
export function useGettingStarted() {
  const { userShops, roleByShop } = useAuthContext()
  const ownerShops = useMemo(() => userShops.filter(s => isAccountOwner(roleByShop[s.id])), [userShops, roleByShop])
  const ids = ownerShops.map(s => s.id)
  const key = ids.join(',')
  const [done, setDone] = useState<Record<StepId, boolean> | null>(null)

  useEffect(() => {
    if (!ids.length) { setDone(null); return }
    let cancelled = false
    const count = (table: string, extra = (q: any) => q) =>
      extra(supabase.from(table).select('id', { count: 'exact', head: true }).in('shop_id', ids)).then((r: any) => (r.error ? null : (r.count ?? 0)))
    Promise.all([
      count('products'), count('sales'), count('categories'),
      count('shop_members', q => q.neq('role', 'owner')),
    ]).then(([p, s, c, m]) => {
      if (cancelled) return
      setDone({
        product: (p ?? 0) > 0, sale: (s ?? 0) > 0, category: (c ?? 0) > 0, team: (m ?? 0) > 0,
        receipt: ownerShops.some((x: any) => x.logo_url || x.receipt_tagline || x.receipt_footer || x.receipt_legal_ids),
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const createdAt = ownerShops.reduce<number | null>((min, s) => { const t = new Date(s.created_at).getTime(); return min === null || t < min ? t : min }, null)
  const isNewAccount = createdAt !== null && Date.now() - createdAt < NEW_ACCOUNT_DAYS * 86_400_000
  return { isOwner: ownerShops.length > 0, done, isNewAccount }
}

export function GettingStarted({ force: forceProp = false }: { force?: boolean }) {
  const t = useTranslations('onboarding')
  const router = useRouter()
  // ?guide=1 (Aide → « Afficher le guide ») : affiché même si tout est fait ou s'il avait été masqué
  const searchParams = useSearchParams()
  const force = forceProp || searchParams.get('guide') === '1'
  const locale = useLocale()
  const { profile } = useAuthContext()
  const { state, loaded, startTour, dismissGuide } = useOnboarding()
  const { isOwner, done, isNewAccount } = useGettingStarted()
  const storeKey = `gs_collapsed_${profile?.id}`
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { try { setCollapsed(localStorage.getItem(storeKey) === '1') } catch { /* stockage indisponible */ } }, [storeKey])
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(storeKey, c ? '0' : '1') } catch { /* idem */ } return !c })

  if (!isOwner || !done || !loaded) return null
  const count = STEPS.filter(s => done[s.id]).length
  const allDone = count === STEPS.length
  if (!force && (state.guideDismissed || allDone || !(isNewAccount || !done.product || !done.sale))) return null

  const go = (path: string) => { const href = `/${locale}/${path}`; startNavigationProgress(href); router.push(href) }
  const nextStep = STEPS.find(s => !done[s.id])

  return (
    <section className="rounded-xl border border-stockshop-blue/20 bg-card shadow-sm dark:border-blue-900/50" data-testid="getting-started" aria-labelledby="gs-title">
      <header className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400"><Rocket className="h-5 w-5" /></span>
        {/* Base de 14rem : sur téléphone, les boutons passent à la ligne au lieu d'écraser le titre */}
        <div className="min-w-0 flex-1 basis-[14rem]">
          <h2 id="gs-title" className="text-base font-semibold">{t('guide_title')}</h2>
          <p className="text-sm text-muted-foreground">{allDone ? t('guide_all_done') : t('guide_subtitle')}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={count} aria-label={t('guide_progress', { done: count, total: STEPS.length })}>
              <div className="h-full rounded-full bg-stockshop-blue motion-safe:transition-all dark:bg-blue-400" style={{ width: `${(count / STEPS.length) * 100}%` }} />
            </div>
            <span className="whitespace-nowrap text-xs font-medium text-muted-foreground" data-testid="gs-progress">{t('guide_progress', { done: count, total: STEPS.length })}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => startTour('quick_tour')} data-testid="gs-quick-tour">
            <Compass className="h-4 w-4" /><span className="hidden sm:inline">{t('quick_tour_cta')}</span><span className="sm:hidden">{t('quick_tour_short')}</span>
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? t('expand') : t('collapse')} data-testid="gs-toggle">
            <ChevronDown className={cn('h-4 w-4 motion-safe:transition-transform', !collapsed && 'rotate-180')} />
          </Button>
          {!force && (
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={dismissGuide} aria-label={t('hide_guide')} title={t('hide_guide')} data-testid="gs-dismiss">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {!collapsed && (
        <ol className="divide-y border-t" data-testid="gs-steps">
          {STEPS.map((s, i) => {
            const isDone = done[s.id]
            const isNext = nextStep?.id === s.id
            return (
              <li key={s.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5', isNext && 'bg-stockshop-blue-muted/40 dark:bg-blue-950/20')} data-testid={`gs-step-${s.id}`} data-done={isDone ? 'true' : 'false'}>
                <span className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isDone ? 'bg-green-600 text-white dark:bg-green-500' : 'border-2 border-muted-foreground/30 text-muted-foreground')}>
                  {isDone ? <Check className="h-4 w-4" aria-label={t('step_done')} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', isDone && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{t(`steps.${s.id}.title` as any)}</p>
                  {!isDone && <p className="text-xs text-muted-foreground">{t(`steps.${s.id}.body` as any)}</p>}
                </div>
                {!isDone && (
                  <div className="flex w-full gap-2 sm:w-auto">
                    {s.tour && (
                      <Button variant={isNext ? 'stockshop' : 'outline'} size="sm" className="h-9 flex-1 gap-1.5 sm:flex-none" onClick={() => startTour(s.tour!)} data-testid={`gs-show-${s.id}`}>
                        <PlayCircle className="h-4 w-4" />{t('show_me')}
                      </Button>
                    )}
                    <Button variant={isNext && !s.tour ? 'stockshop' : 'ghost'} size="sm" className="h-9 flex-1 sm:flex-none" onClick={() => go(s.path)} data-testid={`gs-go-${s.id}`}>{t('go')}</Button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
