'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/hooks/use-auth'
import { PLANS, getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle2, Zap, Crown, Building2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatNaira } from '@/lib/utils/currency'

const supabase = createClient()

const PLAN_DETAILS = [
  {
    id: 'starter' as const,
    icon: Zap,
    color: 'border-blue-200 hover:border-northcode-blue',
    headerColor: 'bg-blue-50',
    features: [
      '200 products',
      '3 staff accounts',
      'CSV & PDF export',
      '90 days sales history',
      'Full stock management',
      'Customer credit tracking',
    ],
  },
  {
    id: 'pro' as const,
    icon: Crown,
    color: 'border-northcode-blue ring-2 ring-northcode-blue',
    headerColor: 'bg-northcode-blue text-white',
    popular: true,
    features: [
      'Unlimited products',
      '10 staff accounts',
      'WhatsApp receipts',
      '1 year sales history',
      'Advanced reports',
      'Priority email support',
    ],
  },
  {
    id: 'business' as const,
    icon: Building2,
    color: 'border-gray-200 hover:border-gray-400',
    headerColor: 'bg-gray-900 text-white',
    features: [
      'Unlimited products & staff',
      'Custom onboarding',
      'Dedicated support',
      'Full sales history',
      'API access',
      'SLA guarantee',
    ],
  },
]

export default function BillingPage({ params: { locale } }: { params: { locale: string } }) {
  const { shop, user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)

  const currentPlan = getPlan(shop?.plan)
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at)
  const isSubscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const isTrialActive = !isSubscribed && trialDaysLeft >= 0

  const handleSubscribe = async (planId: 'starter' | 'pro' | 'business') => {
    if (!shop || !user) return
    setLoading(planId)

    try {
      // Initialize Paystack transaction
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          shop_id: shop.id,
          email: user.email,
          locale,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Payment initialization failed')

      // Redirect to Paystack checkout
      window.location.href = data.authorization_url
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Current plan status */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h1 className="font-bold text-lg mb-4">Subscription</h1>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-gray-900">Current plan:</p>
              <Badge variant={isSubscribed ? 'success' : isTrialActive ? 'warning' : 'danger'}>
                {isSubscribed ? currentPlan.name : isTrialActive ? 'Free Trial' : 'Expired'}
              </Badge>
            </div>

            {isTrialActive && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600">
                <Clock className="h-4 w-4" />
                <span>
                  {trialDaysLeft === 0
                    ? 'Trial expires today'
                    : `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} remaining`}
                </span>
              </div>
            )}

            {isSubscribed && shop?.plan_expires_at && (
              <p className="text-sm text-muted-foreground">
                Renews on{' '}
                {new Date(shop.plan_expires_at).toLocaleDateString('en-NG', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </p>
            )}

            {!isSubscribed && !isTrialActive && (
              <p className="text-sm text-red-600 font-medium">
                Your plan has expired. Subscribe to continue.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Plan selection */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-4">
          {isSubscribed ? 'Change Plan' : 'Choose a Plan'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_DETAILS.map(({ id, icon: Icon, color, headerColor, popular, features }) => {
            const plan = PLANS[id]
            const isCurrent = shop?.plan === id && isSubscribed

            return (
              <div
                key={id}
                className={cn(
                  'relative rounded-xl border-2 bg-white overflow-hidden transition-all',
                  color
                )}
              >
                {popular && (
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-northcode-blue text-white text-[10px] px-2 py-0.5">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <div className={cn('px-5 py-4', headerColor)}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <p className="font-bold text-sm">{plan.name}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={cn('text-2xl font-extrabold', popular ? 'text-white' : 'text-northcode-blue')}>
                      ₦{plan.price_monthly.toLocaleString('en-NG')}
                    </span>
                    <span className={cn('text-xs', popular ? 'text-blue-100' : 'text-muted-foreground')}>/month</span>
                  </div>
                </div>

                <div className="p-4">
                  <ul className="space-y-2 mb-4">
                    {features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-700">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button disabled className="w-full h-9 text-sm" variant="outline">
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleSubscribe(id)}
                      loading={loading === id}
                      className={cn(
                        'w-full h-9 text-sm',
                        popular
                          ? 'bg-northcode-blue hover:bg-northcode-blue-light'
                          : 'bg-gray-900 hover:bg-gray-700'
                      )}
                    >
                      {isSubscribed ? 'Switch to ' : 'Subscribe — '}{plan.name}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Powered by Paystack &bull; Secure payment &bull; Cancel anytime
        </p>
      </div>

      {/* FAQ */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4 text-sm">
          {[
            {
              q: 'What happens to my data if my plan expires?',
              a: 'Your data is never deleted. It is safely kept and accessible as soon as you subscribe again.',
            },
            {
              q: 'Can I change my plan later?',
              a: 'Yes. You can upgrade or downgrade at any time. The change takes effect immediately.',
            },
            {
              q: 'How does payment work?',
              a: 'We use Paystack for secure payment. You can pay by card, bank transfer, or USSD.',
            },
            {
              q: 'Do you offer refunds?',
              a: 'Yes. Contact us within 7 days of payment for a full refund, no questions asked.',
            },
          ].map(({ q, a }) => (
            <div key={q}>
              <p className="font-medium text-gray-900 mb-1">{q}</p>
              <p className="text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
