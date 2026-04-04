'use client'

import Link from 'next/link'
import { AlertTriangle, X, Zap } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface TrialBannerProps {
  daysLeft: number
  locale: string
}

export function TrialBanner({ daysLeft, locale }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const isUrgent = daysLeft <= 3
  const isExpiringSoon = daysLeft <= 7

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 text-sm font-medium',
        isUrgent
          ? 'bg-red-500 text-white'
          : isExpiringSoon
          ? 'bg-amber-500 text-white'
          : 'bg-northcode-blue text-white'
      )}
    >
      {isUrgent ? (
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      ) : (
        <Zap className="h-4 w-4 flex-shrink-0" />
      )}

      <span className="flex-1 text-center text-xs sm:text-sm">
        {daysLeft === 0
          ? 'Your free trial expires today!'
          : daysLeft === 1
          ? 'Last day of your free trial!'
          : `${daysLeft} days left in your free trial.`}
        {' '}
        <Link
          href={`/${locale}/billing`}
          className="underline font-bold hover:no-underline"
        >
          Upgrade now →
        </Link>
      </span>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 opacity-80 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
