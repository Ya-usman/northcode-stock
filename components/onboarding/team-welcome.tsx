'use client'

// Carte d'accueil des employés (lot B) : un membre invité qui arrive voit, sur
// le tableau de bord, LE tour qui correspond à son poste — caissier → faire une
// vente, gestionnaire de stock → ajouter un produit, les autres → visite express.
// Une seule carte, discrète, qui disparaît dès que le tour a été lancé ou que la
// personne la masque. Le propriétaire a son propre guide (« Bien démarrer »).

import { useTranslations } from 'next-intl'
import { PlayCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useOnboarding } from '@/components/onboarding/onboarding-provider'
import { useGettingStarted } from '@/components/onboarding/getting-started'
import { useAvailableTours } from '@/components/onboarding/use-available-tours'
import type { TourId } from '@/lib/onboarding/tours'

const NEW_MEMBER_DAYS = 30
const TOUR_BY_ROLE: Record<string, TourId> = { cashier: 'first_sale', stock_manager: 'add_product' }

export function TeamWelcome() {
  const t = useTranslations('onboarding.welcome')
  const tOnb = useTranslations('onboarding')
  const { profile, roleInActiveShop } = useAuthContext()
  const { state, loaded, startTour, dismissGuide } = useOnboarding()
  const { isOwner } = useGettingStarted()
  const available = useAvailableTours()

  const role = roleInActiveShop ?? profile?.role
  if (!loaded || !profile || isOwner || !role || role === 'owner' || role === 'super_admin') return null
  const joined = profile.created_at ? new Date(profile.created_at).getTime() : 0
  if (!joined || Date.now() - joined > NEW_MEMBER_DAYS * 86_400_000) return null
  const preferred = TOUR_BY_ROLE[role]
  const tour: TourId = preferred && available.includes(preferred) ? preferred : 'quick_tour'
  if (state.guideDismissed || state.tours[tour]?.status) return null

  const kind = tour === 'quick_tour' ? 'other' : role
  const firstName = profile.full_name?.trim().split(/\s+/)[0]

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-stockshop-blue/20 bg-card p-4 shadow-sm sm:p-5 dark:border-blue-900/50" data-testid="team-welcome" data-tour-id={tour} aria-labelledby="tw-title">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400"><Sparkles className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 basis-[14rem]">
        <h2 id="tw-title" className="text-base font-semibold">{firstName ? t('title_name', { name: firstName }) : t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t(`body.${kind}` as any)}</p>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button variant="stockshop" size="sm" className="h-9 flex-1 gap-1.5 sm:flex-none" onClick={() => startTour(tour)} data-testid="tw-start">
          <PlayCircle className="h-4 w-4" />{tOnb('show_me')}
        </Button>
        <Button variant="ghost" size="sm" className="h-9 flex-1 sm:flex-none" onClick={dismissGuide} data-testid="tw-dismiss">{t('later')}</Button>
      </div>
    </section>
  )
}
