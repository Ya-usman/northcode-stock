'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getMsUntilClosing } from '@/lib/saas/shop-hours'

interface ShopHoursCountdownBannerProps {
  hoursEnabled: boolean
  openingTime: string | null
  closingTime: string | null
  manualOverride: 'open' | 'closed' | null
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes}min`
}

// Pas de bouton de fermeture — contrairement à TrialBanner (qui prévient
// d'une échéance dans plusieurs semaines), ce bandeau prévient d'une perte
// d'accès le jour même : même catégorie d'urgence que GracePeriodBanner,
// qui n'est pas non plus dismissible.
export function ShopHoursCountdownBanner({ hoursEnabled, openingTime, closingTime, manualOverride }: ShopHoursCountdownBannerProps) {
  const t = useTranslations('shop_hours')
  const [msLeft, setMsLeft] = useState(() => getMsUntilClosing(hoursEnabled, openingTime, closingTime, manualOverride))

  useEffect(() => {
    const update = () => setMsLeft(getMsUntilClosing(hoursEnabled, openingTime, closingTime, manualOverride))
    update()
    const interval = setInterval(update, 30_000)
    return () => clearInterval(interval)
  }, [hoursEnabled, openingTime, closingTime, manualOverride])

  if (msLeft === null) return null

  return (
    <div className="w-full bg-stockshop-blue text-white px-4 py-2.5 flex items-center gap-2 text-sm font-medium">
      <Clock className="h-4 w-4 flex-shrink-0" />
      <span>{t('countdown', { time: formatDuration(msLeft) })}</span>
    </div>
  )
}
