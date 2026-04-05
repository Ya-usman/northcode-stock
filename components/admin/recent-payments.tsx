'use client'

import { formatNaira } from '@/lib/utils/currency'
import { PLANS } from '@/lib/saas/plans'

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
  city: string
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
      <div className="flex items-center justify-center h-24 text-gray-600 text-sm">
        No payments yet
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-800/50">
      {payments.map(payment => {
        const shop = shopMap[payment.shop_id]
        const planLabel = PLANS[payment.plan as keyof typeof PLANS]?.name || payment.plan
        const colorClass = PLAN_COLORS[payment.plan] || 'text-gray-400 bg-gray-400/10'

        return (
          <div key={payment.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/20 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              {/* Avatar */}
              <div className="h-8 w-8 rounded-full bg-northcode-blue/20 flex items-center justify-center text-northcode-blue font-bold text-xs flex-shrink-0">
                {shop?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {shop?.name || 'Unknown shop'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>
                    {planLabel}
                  </span>
                  <span className="text-xs text-gray-500">
                    {shop?.city}
                  </span>
                  {payment.paystack_reference && (
                    <span className="text-[10px] font-mono text-gray-600 truncate max-w-[100px]">
                      {payment.paystack_reference}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-sm font-bold text-green-400">+{formatNaira(payment.amount)}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(payment.created_at).toLocaleDateString('en-NG', {
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
