'use client'

import { CloudOff } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Props {
  ageMs: number | null
  isOnline: boolean
}

function formatAge(ms: number, t: ReturnType<typeof useTranslations>): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return t('just_now')
  if (minutes < 60) return t('minutes_ago', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hours_ago', { hours })
  return t('days_ago', { days: Math.floor(hours / 24) })
}

export function CacheBanner({ ageMs, isOnline }: Props) {
  const t = useTranslations('banners.cache')
  if (isOnline || ageMs === null) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400">
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span>{t('cached_label', { age: formatAge(ageMs, t) })}</span>
    </div>
  )
}
