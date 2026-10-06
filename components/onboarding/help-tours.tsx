'use client'

// Page Aide → « Tours guidés » : relancer un tour à tout moment, et réafficher
// le guide « Bien démarrer » s'il a été masqué (propriétaire).

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { CheckCircle2, Compass, PlayCircle, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/components/onboarding/onboarding-provider'
import { useGettingStarted } from '@/components/onboarding/getting-started'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { TOUR_IDS } from '@/lib/onboarding/tours'

export function HelpTours() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const locale = useLocale()
  const { state, startTour, restoreGuide } = useOnboarding()
  const { isOwner } = useGettingStarted()

  const showGuide = () => {
    restoreGuide()
    const href = `/${locale}/dashboard?guide=1`
    startNavigationProgress(href)
    router.push(href)
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" data-testid="help-tours" aria-labelledby="help-tours-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="help-tours-title" className="flex items-center gap-2 font-semibold"><Compass className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />{t('help_title')}</h2>
          <p className="text-sm text-muted-foreground">{t('help_subtitle')}</p>
        </div>
        {isOwner && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={showGuide} data-testid="help-show-guide">
            <Rocket className="h-4 w-4" />{t('show_guide')}
          </Button>
        )}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {TOUR_IDS.map(id => {
          const done = state.tours[id]?.status === 'completed'
          return (
            <li key={id} className="flex flex-col justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {t(`tour_names.${id}` as any)}
                  {done && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" aria-label={t('step_done')} />}
                </p>
                <p className="text-xs text-muted-foreground">{t(`tour_desc.${id}` as any)}</p>
              </div>
              <Button variant={done ? 'ghost' : 'outline'} size="sm" className="h-9 gap-1.5 self-start" onClick={() => startTour(id)} data-testid={`help-tour-${id}`}>
                <PlayCircle className="h-4 w-4" />{done ? t('replay') : t('start')}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
