'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface GracePeriodBannerProps {
  daysLeft: number
  locale: string
}

export function GracePeriodBanner({ daysLeft, locale }: GracePeriodBannerProps) {
  const t = useTranslations('saas')

  return (
    <div className="w-full bg-orange-500 text-white px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>
          {t('grace_title')} —{' '}
          {daysLeft === 1
            ? t('grace_days_left_one', { days: daysLeft })
            : t('grace_days_left', { days: daysLeft })}
        </span>
      </div>
      <Link
        href={`/${locale}/billing`}
        className="text-xs font-semibold bg-white text-orange-600 rounded-full px-3 py-1 hover:bg-orange-50 transition-colors flex-shrink-0"
      >
        {t('grace_renew')}
      </Link>
    </div>
  )
}
