'use client'

// Inscription (lot D du 7 nov. 2026) : « Vous avez choisi : Pro, 1 an » (formule vue sur la page Tarifs) et ce que
// contient l'essai (lignes de la formule Pro, mêmes règles que la page Tarifs : lib/saas/plan-offer). Ordinateur :
// panneau à côté du formulaire ; téléphone : bandeau au-dessus, détail replié.
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { PLAN_LINE_KEYS } from '@/lib/saas/plan-offer'
import { planName, type ChosenOffer } from '@/lib/site/chosen-offer'

export function TrialPanel({ locale, chosen, variant }: { locale: string; chosen: ChosenOffer | null; variant: 'side' | 'top' }) {
  const t = useTranslations('register')
  const tOffer = useTranslations('plan_offer')
  const chosenText = chosen ? t('offer_chosen', { plan: planName(chosen.plan), period: tOffer(`period_${chosen.period}` as any) }) : null
  const lines = (
    <>
      <p className="text-sm text-[#44526A] dark:text-[#9fb3d1]">{t('offer_free')}</p>
      <ul className="mt-3 space-y-2 text-sm text-[#0A1628] dark:text-[#d8e8ff]">
        {PLAN_LINE_KEYS.pro.map(k => (
          <li key={k} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden />{tOffer(k as any)}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-[#5570a0] dark:text-[#6f87ad]">
        {chosen ? t('offer_end_chosen', { plan: planName(chosen.plan), period: tOffer(`period_${chosen.period}` as any) }) : t('offer_end')}
      </p>
    </>
  )
  const banner = chosen && (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#073e8a]/20 bg-white px-4 py-3 text-sm dark:border-[#1b2e48] dark:bg-[#0b1525]" data-testid="register-chosen-offer">
      <span className="font-semibold text-[#073e8a] dark:text-[#7EB0FF]">{chosenText}</span>
      <Link href={`/${locale}/tarifs`} className="shrink-0 text-[#073e8a] underline-offset-2 hover:underline dark:text-[#7EB0FF]">{t('offer_change')}</Link>
    </div>
  )

  if (variant === 'top') {
    return (
      <div className="mb-4 space-y-2 lg:hidden" data-testid="register-trial-top">
        {banner}
        <details className="rounded-xl border border-[#dce7ff] bg-white px-4 py-3 dark:border-[#152034] dark:bg-[#0b1525]">
          <summary className="cursor-pointer text-sm font-semibold">{t('offer_title')}</summary>
          <div className="mt-3">{lines}</div>
        </details>
      </div>
    )
  }
  return (
    <aside className="hidden lg:block" data-testid="register-trial-side">
      {banner}
      <div className="mt-4 rounded-2xl border border-[#dce7ff] bg-white/80 p-6 dark:border-[#152034] dark:bg-[#0b1525]/80">
        <h2 className="font-brand text-xl font-bold tracking-[-0.02em]">{t('offer_title')}</h2>
        <div className="mt-3">{lines}</div>
        <Link href={`/${locale}/tarifs`} className="mt-4 inline-block text-sm font-semibold text-[#073e8a] hover:underline dark:text-[#7EB0FF]">{t('offer_see')}</Link>
      </div>
    </aside>
  )
}
