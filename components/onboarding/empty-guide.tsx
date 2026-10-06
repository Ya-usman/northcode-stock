'use client'

// Écran vide qui guide (lot B) : quand une liste n'a encore AUCUNE donnée (pas
// « aucun résultat pour cette recherche »), on explique à quoi sert la page et
// comment la remplir, avec le tour guidé correspondant. Les filtres sans
// résultat gardent leur message court habituel.

import type { LucideIcon } from 'lucide-react'
import { PlayCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useOnboarding } from '@/components/onboarding/onboarding-provider'
import type { TourId } from '@/lib/onboarding/tours'

export function EmptyGuide({ icon: Icon, title, body, tour, testId }: {
  icon: LucideIcon
  title: string
  body: string
  /** Tour proposé (« Me montrer ») ; absent si la personne n'a pas le droit d'agir ici */
  tour?: TourId
  testId?: string
}) {
  const t = useTranslations('onboarding')
  const { startTour } = useOnboarding()
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-10 text-center" data-testid={testId ?? 'empty-guide'}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400">
        <Icon className="h-6 w-6" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {tour && (
        <Button variant="outline" size="sm" className="mt-4 h-9 gap-1.5" onClick={() => startTour(tour)} data-testid="empty-guide-tour">
          <PlayCircle className="h-4 w-4" />{t('show_me')}
        </Button>
      )}
    </div>
  )
}
