'use client'

import { useMemo } from 'react'
import { getPlan, hasActiveSubscription, getTrialDaysLeft } from '@/lib/saas/plans'
import { Users, Store, History, Package, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface PlanUsageCardProps {
  plan: string | null
  planExpiresAt: string | null
  trialEndsAt: string | null
  productCount: number
  teamCount: number    // active non-owner members
  shopCount: number    // active shops owned
  locale: string
}

interface UsageStat {
  icon: React.ReactNode
  label: string
  used: number
  limit: number   // -1 = unlimited
  unit?: string
}

function StatusIcon({ pct }: { pct: number | null }) {
  if (pct === null) return <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
  if (pct >= 1)    return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
  if (pct >= 0.8)  return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
  return               <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
}

function UsageRow({ stat }: { stat: UsageStat }) {
  const isUnlimited = stat.limit === -1
  const pct = isUnlimited ? null : Math.min(1, stat.used / stat.limit)
  const barColor = pct === null
    ? 'bg-green-500'
    : pct >= 1    ? 'bg-red-500'
    : pct >= 0.8  ? 'bg-amber-500'
    : 'bg-green-500'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{stat.icon}</span>
          <span className="text-foreground">{stat.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('text-xs font-semibold tabular-nums', pct !== null && pct >= 1 ? 'text-red-500' : 'text-foreground')}>
            {stat.used}
          </span>
          <span className="text-xs text-muted-foreground">
            / {isUnlimited ? '∞' : `${stat.limit}${stat.unit ? ` ${stat.unit}` : ''}`}
          </span>
          <StatusIcon pct={pct} />
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: isUnlimited ? '20%' : `${Math.min(100, (stat.used / stat.limit) * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function PlanUsageCard({
  plan, planExpiresAt, trialEndsAt,
  productCount, teamCount, shopCount,
}: PlanUsageCardProps) {
  const planData = getPlan(plan)
  const isSubscribed = hasActiveSubscription(plan, planExpiresAt)
  const trialDaysLeft = getTrialDaysLeft(trialEndsAt)
  const isTrialActive = !isSubscribed && trialDaysLeft >= 0

  const stats: UsageStat[] = useMemo(() => [
    {
      icon: <Store className="h-4 w-4" />,
      label: 'Boutiques',
      used: shopCount,
      limit: planData.limits.shops,
    },
    {
      icon: <Users className="h-4 w-4" />,
      label: 'Employés',
      used: teamCount,
      limit: planData.limits.team_members,
    },
    {
      icon: <Package className="h-4 w-4" />,
      label: 'Produits',
      used: productCount,
      limit: planData.limits.products,
    },
    {
      icon: <History className="h-4 w-4" />,
      label: 'Historique',
      used: planData.limits.history_days === -1 ? 0 : planData.limits.history_days,
      limit: planData.limits.history_days,
      unit: 'jours',
    },
  ], [planData, shopCount, teamCount, productCount])

  // Expiry countdown
  const daysLeft = isSubscribed && planExpiresAt
    ? Math.ceil((new Date(planExpiresAt).getTime() - Date.now()) / 86400000)
    : isTrialActive ? trialDaysLeft : null

  const expiryBarPct = daysLeft !== null ? Math.min(1, daysLeft / 30) : null
  const expiryBarColor = daysLeft === null ? '' : daysLeft <= 5 ? 'bg-red-500' : daysLeft <= 14 ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Utilisation du forfait</h3>
        <span className={cn(
          'text-xs font-semibold px-2 py-0.5 rounded-full',
          isSubscribed ? 'bg-green-500/10 text-green-600' : isTrialActive ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'
        )}>
          {planData.name}
        </span>
      </div>

      <div className="space-y-3">
        {stats.map(s => <UsageRow key={s.label} stat={s} />)}
      </div>

      {/* Expiry bar */}
      {daysLeft !== null && (
        <div className="pt-1 border-t border-border space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{isSubscribed ? 'Renouvellement dans' : 'Essai — expire dans'}</span>
            <span className={cn('font-semibold', daysLeft <= 5 ? 'text-red-500' : daysLeft <= 14 ? 'text-amber-600' : 'text-foreground')}>
              {daysLeft === 0 ? "Aujourd'hui" : `${daysLeft}j`}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', expiryBarColor)}
              style={{ width: `${Math.min(100, (expiryBarPct ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
