'use client'

import Link from 'next/link'
import { Crown, Clock, Zap, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { isBetaPeriod, betaDaysLeft, getTrialDaysLeft, hasActiveSubscription, getPlan } from '@/lib/saas/plans'

interface PlanStatusBannerProps {
  plan: string | null
  trialEndsAt: string | null
  planExpiresAt: string | null
}

export function PlanStatusBanner({ plan, trialEndsAt, planExpiresAt }: PlanStatusBannerProps) {
  const t = useTranslations('dashboard_banner')
  const locale = useLocale()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const beta = isBetaPeriod()
  const betaLeft = betaDaysLeft()
  const subscribed = hasActiveSubscription(plan, planExpiresAt)
  const trialDays = getTrialDaysLeft(trialEndsAt)
  const planInfo = getPlan(plan)

  // ── Beta period ─────────────────────────────────────────────────
  if (beta) {
    return (
      <Banner
        color="blue"
        icon={<Zap className="h-3.5 w-3.5 flex-shrink-0" />}
        text={t('beta_active', { days: betaLeft })}
        locale={locale}
        onDismiss={() => setDismissed(true)}
      />
    )
  }

  // ── Active subscription ──────────────────────────────────────────
  if (subscribed && planExpiresAt) {
    const expiresDate = new Date(planExpiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    const daysLeft = Math.ceil((new Date(planExpiresAt).getTime() - Date.now()) / 86400000)
    const isExpiringSoon = daysLeft <= 7
    return (
      <Banner
        color={isExpiringSoon ? 'amber' : 'green'}
        icon={isExpiringSoon
          ? <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          : <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />}
        text={isExpiringSoon
          ? t('plan_expiring_soon', { plan: planInfo.name, days: daysLeft })
          : t('plan_active', { plan: planInfo.name, date: expiresDate })}
        locale={locale}
        onDismiss={() => setDismissed(true)}
        linkLabel={isExpiringSoon ? t('renew') : undefined}
      />
    )
  }

  // ── Trial active ─────────────────────────────────────────────────
  if (trialDays >= 0) {
    const isUrgent = trialDays <= 3
    const isSoon = trialDays <= 10
    const trialDate = trialEndsAt
      ? new Date(trialEndsAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
      : ''
    const text = trialDays === 0
      ? t('trial_expires_today')
      : trialDays === 1
      ? t('trial_last_day')
      : t('trial_days_left', { days: trialDays, date: trialDate })
    return (
      <Banner
        color={isUrgent ? 'red' : isSoon ? 'amber' : 'blue'}
        icon={isUrgent
          ? <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          : <Clock className="h-3.5 w-3.5 flex-shrink-0" />}
        text={text}
        locale={locale}
        onDismiss={() => setDismissed(true)}
        linkLabel={t('upgrade')}
      />
    )
  }

  // ── Expired ──────────────────────────────────────────────────────
  return (
    <Banner
      color="red"
      icon={<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />}
      text={t('expired')}
      locale={locale}
      onDismiss={() => setDismissed(true)}
      linkLabel={t('subscribe')}
    />
  )
}

// ── Internal Banner UI ───────────────────────────────────────────────────────
const COLORS = {
  blue:  'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300',
  green: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300',
  amber: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300',
  red:   'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300',
}
const LINK_COLORS = {
  blue:  'text-blue-700 dark:text-blue-400',
  green: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red:   'text-red-700 dark:text-red-400',
}

function Banner({
  color, icon, text, locale, onDismiss, linkLabel,
}: {
  color: keyof typeof COLORS
  icon: React.ReactNode
  text: string
  locale: string
  onDismiss: () => void
  linkLabel?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium', COLORS[color])}>
      {icon}
      <span className="flex-1">
        {text}
        {linkLabel && (
          <>
            {' '}
            <Link
              href={`/${locale}/billing`}
              className={cn('underline font-semibold hover:no-underline', LINK_COLORS[color])}
            >
              {linkLabel} →
            </Link>
          </>
        )}
      </span>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
