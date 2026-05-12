'use client'

import { formatCurrency } from '@/lib/utils/currency'
import { PLANS } from '@/lib/saas/plans'
import { COUNTRIES } from '@/lib/saas/countries'

interface Payment {
  id: string
  shop_id: string
  plan: string
  amount: number
  status: string
  paystack_reference: string | null
  starts_at: string
  created_at: string
}

interface Shop {
  id: string
  name: string
  city?: string
  country?: string
  currency?: string
}

interface Props {
  payments: Payment[]
  shops: Shop[]
}

const PLAN_COLORS: Record<string, string> = {
  starter: 'text-blue-400 bg-blue-400/10',
  pro: 'text-purple-400 bg-purple-400/10',
  business: 'text-amber-400 bg-amber-400/10',
}

export function RecentPayments({ payments, shops }: Props) {
  const shopMap = shops.reduce((acc: Record<string, Shop>, s) => { acc[s.id] = s; return acc }, {})

  if (payments.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
        No payments yet
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/50">
      {payments.map(payment => {
        const shop = shopMap[payment.shop_id]
        const planLabel = PLANS[payment.plan as keyof typeof PLANS]?.name || payment.plan
        const colorClass = PLAN_COLORS[payment.plan] || 'text-muted-foreground bg-muted'
        const currency = shop?.currency || '₦'
        const countryConfig = shop?.country ? COUNTRIES[shop.country as keyof typeof COUNTRIES] : null
        const flag = countryConfig?.flag ?? null

        return (
          <div key={payment.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-accent/30 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 font-bold text-xs flex-shrink-0">
                {shop?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {shop?.name || 'Boutique supprimée'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>
                    {planLabel}
                  </span>
                  {(flag || shop?.city) && (
                    <span className="text-xs text-muted-foreground">{flag}{flag && shop?.city ? ' ' : ''}{shop?.city}</span>
                  )}
                  {payment.paystack_reference && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[100px]">
                      {payment.paystack_reference}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-sm font-bold text-green-400">+{formatCurrency(payment.amount, currency)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(payment.created_at).toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
