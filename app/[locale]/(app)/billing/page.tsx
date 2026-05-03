'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { getCountry, BILLING_PERIODS, getPeriodPrice, type BillingPeriod } from '@/lib/saas/countries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle2, Zap, Crown, Building2, Clock, CreditCard, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSearchParams, useRouter } from 'next/navigation'
import Script from 'next/script'

export default function BillingPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('billing_page')
  const { shop, user, refreshShop } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const searchParams = useSearchParams()
  const router = useRouter()

  const PLAN_DETAILS = [
    {
      id: 'starter' as const,
      icon: Zap,
      color: 'border-blue-200 hover:border-northcode-blue',
      headerColor: 'bg-blue-50',
      features: [
        t('starter_f1'), t('starter_f2'), t('starter_f3'),
        t('starter_f4'), t('starter_f5'), t('starter_f6'),
      ],
    },
    {
      id: 'pro' as const,
      icon: Crown,
      color: 'border-northcode-blue ring-2 ring-northcode-blue',
      headerColor: 'bg-northcode-blue text-white',
      popular: true,
      features: [
        t('pro_f1'), t('pro_f2'), t('pro_f3'),
        t('pro_f4'), t('pro_f5'), t('pro_f6'),
      ],
    },
    {
      id: 'business' as const,
      icon: Building2,
      color: 'border-border hover:border-gray-400',
      headerColor: 'bg-gray-900 text-white',
      features: [
        t('business_f1'), t('business_f2'), t('business_f3'),
        t('business_f4'), t('business_f5'), t('business_f6'),
      ],
    },
  ]

  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')

    if (success === '1') {
      toast({ title: t('payment_success'), description: t('payment_success_desc'), variant: 'success' })
      router.replace(`/${locale}/billing`)
    } else if (error) {
      const messages: Record<string, string> = {
        payment_failed: t('err_failed'),
        no_reference: t('err_no_ref'),
        invalid_plan: t('err_invalid_plan'),
        server: t('err_server'),
      }
      toast({ title: t('payment_error'), description: messages[error] || t('err_failed'), variant: 'destructive' })
      router.replace(`/${locale}/billing`)
    }
  }, [searchParams])

  const currentPlan = getPlan(shop?.plan)
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at)
  const isSubscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const isTrialActive = !isSubscribed && trialDaysLeft >= 0

  const country = getCountry(shop?.country)
  const isNigeria = country.code === 'NG'
  const isFlutterwave = country.gateway === 'flutterwave'

  const handleSubscribe = useCallback(async (planId: 'starter' | 'pro' | 'business') => {
    if (!shop || !user) return
    setLoading(planId)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, shop_id: shop.id, email: user.email, locale, billing_period: period }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('err_failed'))

      if (country.code === 'NG') {
        const PaystackPop = (window as any).PaystackPop
        if (!PaystackPop) {
          window.location.href = data.authorization_url
          return
        }
        const handler = PaystackPop.setup({
          key: data.public_key,
          email: user.email,
          amount: data.amount_kobo,
          ref: data.reference,
          metadata: { shop_id: shop.id, plan_id: planId, billing_period: period },
          onClose: () => {
            setLoading(null)
            toast({ title: t('payment_cancelled'), variant: 'destructive' })
          },
          callback: (response: { reference: string }) => {
            fetch(`/api/billing/verify?reference=${response.reference}&locale=${locale}`)
              .then(() => refreshShop())
              .then(() => {
                toast({ title: t('payment_success'), description: t('payment_active'), variant: 'success' })
              })
              .catch(() => toast({ title: t('verify_error'), variant: 'destructive' }))
              .finally(() => setLoading(null))
          },
        })
        handler.openIframe()
      } else {
        window.location.href = data.authorization_url
      }
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
      setLoading(null)
    }
  }, [shop, user, country, locale, toast, refreshShop, period, t])

  const periodLabel = period === 'monthly' ? t('per_month') : period === 'quarterly' ? t('per_3months') : t('per_year')

  const faqItems = [
    { q: t('faq_1_q'), a: t('faq_1_a') },
    { q: t('faq_2_q'), a: t('faq_2_a') },
    {
      q: t('faq_3_q'),
      a: isNigeria ? t('faq_3_paystack') : t('faq_3_flutterwave', { country: country.name }),
    },
    { q: t('faq_4_q'), a: t('faq_4_a') },
  ]

  return (
    <>
    <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Current plan status */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="font-bold text-lg">{t('title')}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-xl">{country.flag}</span>
            <span>{country.name} · {country.currencySymbol}</span>
            {isNigeria && (
              <span className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                <CreditCard className="h-3 w-3" /> Paystack
              </span>
            )}
            {isFlutterwave && (
              <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5">
                <Smartphone className="h-3 w-3" /> Flutterwave
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-foreground">{t('current_plan_label')}</p>
              <Badge variant={isSubscribed ? 'success' : isTrialActive ? 'warning' : 'danger'}>
                {isSubscribed ? currentPlan.name : isTrialActive ? t('trial_active') : t('expired')}
              </Badge>
            </div>

            {isTrialActive && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600">
                <Clock className="h-4 w-4" />
                <span>
                  {trialDaysLeft === 0
                    ? t('trial_expires_today')
                    : t('trial_days_left', { days: trialDaysLeft })}
                </span>
              </div>
            )}

            {isSubscribed && shop?.plan_expires_at && (
              <p className="text-sm text-muted-foreground">
                {t('renewal_date', {
                  date: new Date(shop.plan_expires_at).toLocaleDateString(locale, {
                    day: 'numeric', month: 'long', year: 'numeric',
                  }),
                })}
              </p>
            )}

            {!isSubscribed && !isTrialActive && (
              <p className="text-sm text-red-600 font-medium">{t('plan_expired_msg')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div>
        <h2 className="font-semibold text-foreground mb-3">
          {isSubscribed ? t('change_plan') : t('choose_plan')}
        </h2>

        {/* Billing period tabs */}
        <div className="flex gap-2 mb-4 bg-muted rounded-lg p-1 w-fit">
          {(Object.entries(BILLING_PERIODS) as [BillingPeriod, typeof BILLING_PERIODS[BillingPeriod]][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                period === key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground/80'
              )}
            >
              {cfg.label}
              {cfg.badge && (
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5',
                  period === key ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400' : 'bg-muted text-muted-foreground'
                )}>
                  {cfg.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_DETAILS.map(({ id, icon: Icon, color, headerColor, popular, features }) => {
            const monthlyPrice = country.prices[id]
            const price = getPeriodPrice(monthlyPrice, period)
            const isCurrent = shop?.plan === id && isSubscribed

            return (
              <div
                key={id}
                className={cn(
                  'relative rounded-xl border-2 bg-card overflow-hidden transition-all',
                  color
                )}
              >
                {popular && (
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-northcode-blue text-white text-[10px] px-2 py-0.5">
                      {t('popular_badge')}
                    </Badge>
                  </div>
                )}

                <div className={cn('px-5 py-4', headerColor)}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <p className="font-bold text-sm">{id.charAt(0).toUpperCase() + id.slice(1)}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={cn('text-2xl font-extrabold', popular ? 'text-white' : 'text-northcode-blue dark:text-blue-400')}>
                      {country.currencySymbol}{price.toLocaleString(country.currencySymbol === 'FCFA' ? 'fr-FR' : 'en-NG')}
                    </span>
                    <span className={cn('text-xs', popular ? 'text-blue-100' : 'text-muted-foreground')}>
                      {periodLabel}
                    </span>
                  </div>
                  {period !== 'monthly' && (
                    <p className={cn('text-xs mt-0.5', popular ? 'text-blue-100' : 'text-muted-foreground')}>
                      {t('per_month_equiv', { price: Math.floor(price / BILLING_PERIODS[period].months).toLocaleString(country.currencySymbol === 'FCFA' ? 'fr-FR' : 'en-NG') + country.currencySymbol })}
                    </p>
                  )}
                </div>

                <div className="p-4">
                  <ul className="space-y-2 mb-4">
                    {features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-xs text-foreground/80">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button disabled className="w-full h-9 text-sm" variant="outline">
                      {t('current_plan_btn')}
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
                      {isNigeria ? '💳' : '📱'} {isSubscribed ? `${t('upgrade_to')} ` : ''}{id.charAt(0).toUpperCase() + id.slice(1)}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          {isNigeria
            ? t('payment_paystack')
            : t('payment_flutterwave', { country: country.name })}
        </p>
      </div>

      {/* FAQ */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold text-foreground mb-4">{t('faq_title')}</h2>
        <div className="space-y-4 text-sm">
          {faqItems.map(({ q, a }) => (
            <div key={q}>
              <p className="font-medium text-foreground mb-1">{q}</p>
              <p className="text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
