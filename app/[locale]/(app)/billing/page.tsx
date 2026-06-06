'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTranslations, useLocale } from 'next-intl'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { getCountry, getPeriodPrice, type BillingPeriod } from '@/lib/saas/countries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { CheckCircle2, Clock, Crown, Sparkles, Building2, ShieldCheck, Mail } from 'lucide-react'
import { PlanUsageCard } from '@/components/saas/plan-usage-card'
import { cn } from '@/lib/utils/cn'
import { useSearchParams, useRouter } from 'next/navigation'
import Script from 'next/script'

type PlanId = 'starter' | 'pro' | 'business'

const PLAN_ICONS: Record<PlanId, React.ReactNode> = {
  starter:  <Sparkles className="h-5 w-5" />,
  pro:      <Crown className="h-5 w-5" />,
  business: <Building2 className="h-5 w-5" />,
}

export default function BillingPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('billing_page')
  const { shop, user, refreshShop } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [usageStats, setUsageStats] = useState({ products: 0, team: 0, shops: 0 })
  const period: BillingPeriod = 'monthly'
  const searchParams = useSearchParams()
  const router = useRouter()

  // Custom checkout modal state
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<string>('')

  const PLAN_DETAILS = [
    {
      id: 'starter' as PlanId,
      popular: false,
      features: [t('starter_f1'), t('starter_f2'), t('starter_f3'), t('starter_f4'), t('starter_f5'), t('starter_f6')],
    },
    {
      id: 'pro' as PlanId,
      popular: true,
      features: [t('pro_f1'), t('pro_f2'), t('pro_f3'), t('pro_f4'), t('pro_f5'), t('pro_f6')],
    },
    {
      id: 'business' as PlanId,
      popular: false,
      features: [t('business_f1'), t('business_f2'), t('business_f3'), t('business_f4'), t('business_f5'), t('business_f6')],
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

  // Fetch usage stats once shop is loaded
  const supabase = useRef(createClient()).current
  useEffect(() => {
    if (!shop?.id || !user?.id) return
    Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true),
      (supabase as any).from('shop_members').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('is_active', true).neq('role', 'owner'),
      (supabase as any).from('shop_members').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('role', 'owner').eq('is_active', true),
    ]).then(([{ count: p }, { count: t }, { count: s }]) => {
      setUsageStats({ products: p ?? 0, team: t ?? 0, shops: s ?? 0 })
    })
  }, [shop?.id, user?.id])

  const currentPlan = getPlan(shop?.plan)
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at)
  const isSubscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const isTrialActive = !isSubscribed && trialDaysLeft >= 0

  const country = getCountry(shop?.country)
  const isNigeria = country.code === 'NG'
  const isStripe = country.gateway === 'stripe'
  const gatewayLabel =
    country.gateway === 'paystack' ? 'Paystack' :
    country.gateway === 'notchpay' ? 'NotchPay' :
    country.gateway === 'stripe'   ? 'Stripe' :
    'Flutterwave'

  // Payment methods available for subscription (no cash, no credit)
  const subscriptionMethods = country.paymentMethods.filter(
    m => m.type !== 'cash' && m.type !== 'credit'
  )

  const openCheckout = (planId: PlanId) => {
    setCheckoutPlan(planId)
    setSelectedMethod(subscriptionMethods[0]?.id || '')
  }

  const closeCheckout = () => {
    setCheckoutPlan(null)
    setSelectedMethod('')
  }

  const handlePay = useCallback(async () => {
    if (!shop || !user || !checkoutPlan) return
    setLoading(true)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: checkoutPlan,
          shop_id: shop.id,
          email: user.email,
          locale,
          billing_period: period,
          payment_method: selectedMethod,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'stripe_coming_soon') {
          toast({ title: 'Stripe bientôt disponible', description: `Contacte-nous pour activer ton abonnement ${checkoutPlan} manuellement.`, variant: 'default' })
          closeCheckout()
          setLoading(false)
          return
        }
        throw new Error(data.error || t('err_failed'))
      }

      closeCheckout()

      if (isNigeria) {
        const PaystackPop = (window as any).PaystackPop
        if (!PaystackPop) { window.location.href = data.authorization_url; return }
        const handler = PaystackPop.setup({
          key: data.public_key,
          email: user.email,
          amount: data.amount_kobo,
          ref: data.reference,
          channels: data.channels,
          metadata: { shop_id: shop.id, plan_id: checkoutPlan, billing_period: period },
          onClose: () => {
            setLoading(false)
            toast({ title: t('payment_cancelled'), variant: 'destructive' })
          },
          callback: (response: { reference: string }) => {
            fetch(`/api/billing/verify?reference=${response.reference}&locale=${locale}&inline=1`)
              .then(async res => {
                const json = await res.json().catch(() => ({}))
                if (!res.ok || !json.ok) throw new Error(json.error || 'payment_failed')
                // Refresh plan cookie so middleware sees the new plan immediately
                await fetch('/api/auth/set-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id }) }).catch(() => {})
                await refreshShop()
                toast({ title: t('payment_success'), description: t('payment_active'), variant: 'success' })
              })
              .catch((err) => {
                const msg = err?.message
                const descriptions: Record<string, string> = {
                  payment_failed: t('err_failed'),
                  invalid_plan: t('err_invalid_plan'),
                  server: t('err_server'),
                }
                toast({ title: t('payment_error'), description: descriptions[msg] || t('err_failed'), variant: 'destructive' })
              })
              .finally(() => setLoading(false))
          },
        })
        handler.openIframe()
      } else {
        window.location.href = data.authorization_url
      }
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
      setLoading(false)
    }
  }, [shop, user, checkoutPlan, selectedMethod, country, locale, toast, refreshShop, period, t, isNigeria])

  const faqItems = [
    { q: t('faq_1_q'), a: t('faq_1_a') },
    { q: t('faq_2_q'), a: t('faq_2_a') },
    { q: t('faq_3_q'), a: isNigeria ? t('faq_3_paystack') : t('faq_3_flutterwave', { country: country.name }) },
    { q: t('faq_4_q'), a: t('faq_4_a') },
  ]

  const formatPrice = (planId: PlanId) => {
    const price = getPeriodPrice(country.prices[planId], period)
    if (country.currency === 'NGN') return `₦${price.toLocaleString('en-NG')}`
    if (country.currency === 'EUR') return `${price.toLocaleString('fr-FR')} €`
    if (country.currency === 'USD') return `$${price}`
    if (country.currency === 'CAD') return `CA$${price}`
    return `${price.toLocaleString('fr-FR')} ${country.currencySymbol}`
  }

  const checkoutPlanDetails = checkoutPlan ? PLAN_DETAILS.find(p => p.id === checkoutPlan) : null

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
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold">{t('current_plan_label')}</p>
              <Badge variant={isSubscribed ? 'success' : isTrialActive ? 'warning' : 'danger'}>
                {isSubscribed ? currentPlan.name : isTrialActive ? t('trial_active') : t('expired')}
              </Badge>
            </div>
            {isTrialActive && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600">
                <Clock className="h-4 w-4" />
                <span>{trialDaysLeft === 0 ? t('trial_expires_today') : t('trial_days_left', { days: trialDaysLeft })}</span>
              </div>
            )}
            {isSubscribed && shop?.plan_expires_at && (
              <p className="text-sm text-muted-foreground">
                {t('renewal_date', { date: new Date(shop.plan_expires_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}
              </p>
            )}
            {!isSubscribed && !isTrialActive && (
              <p className="text-sm text-red-600 font-medium">{t('plan_expired_msg')}</p>
            )}
          </div>
        </div>

        {/* Plan usage stats */}
        {shop && (
          <PlanUsageCard
            plan={shop.plan ?? null}
            planExpiresAt={(shop as any).plan_expires_at ?? null}
            trialEndsAt={(shop as any).trial_ends_at ?? null}
            productCount={usageStats.products}
            teamCount={usageStats.team}
            shopCount={usageStats.shops}
            locale={locale}
          />
        )}

        {/* Plans */}
        <div>
          <h2 className="font-semibold mb-4">{isSubscribed ? t('change_plan') : t('choose_plan')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLAN_DETAILS.map(({ id, popular, features }) => {
              const isCurrent = shop?.plan === id && isSubscribed
              const planName = id.charAt(0).toUpperCase() + id.slice(1)

              return (
                <div
                  key={id}
                  className={cn(
                    'relative rounded-2xl border-2 bg-card p-6 shadow-sm transition-all',
                    popular
                      ? 'border-stockshop-blue shadow-xl ring-2 ring-stockshop-blue mt-4 md:mt-0'
                      : 'border-gray-200 dark:border-gray-700 hover:border-stockshop-blue/40'
                  )}
                >
                  {popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <Badge className="bg-stockshop-blue text-white px-3 py-1 text-xs font-semibold whitespace-nowrap">
                        {t('popular_badge')}
                      </Badge>
                    </div>
                  )}

                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn('p-1.5 rounded-lg', popular ? 'bg-stockshop-blue/10 text-stockshop-blue' : 'bg-muted text-muted-foreground')}>
                        {PLAN_ICONS[id]}
                      </span>
                      <p className="font-bold text-lg">{planName}</p>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-stockshop-blue dark:text-blue-400">
                        {formatPrice(id)}
                      </span>
                      <span className="text-muted-foreground text-sm">{t('per_month')}</span>
                    </div>
                  </div>

                  <ul className="space-y-2.5 mb-6">
                    {features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm text-foreground/80">
                        <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button disabled className="w-full" variant="outline">
                      {t('current_plan_btn')}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => openCheckout(id)}
                      loading={loading && checkoutPlan === null}
                      className={cn(
                        'w-full font-semibold',
                        popular
                          ? 'bg-stockshop-blue hover:bg-stockshop-blue-light text-white'
                          : 'border border-blue-600 dark:border-blue-400 text-stockshop-blue dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 bg-transparent'
                      )}
                    >
                      {isSubscribed ? `${t('upgrade_to')} ${planName}` : `${t('choose_plan_btn')} ${planName}`}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* FAQ */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold mb-4">{t('faq_title')}</h2>
          <div className="space-y-4 text-sm">
            {faqItems.map(({ q, a }) => (
              <div key={q}>
                <p className="font-medium mb-1">{q}</p>
                <p className="text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Custom Checkout Modal ── */}
      <PremiumDialog
        open={!!checkoutPlan}
        onOpenChange={open => { if (!open) closeCheckout() }}
        category="Abonnement"
        title={checkoutPlan ? `Plan ${checkoutPlan.charAt(0).toUpperCase() + checkoutPlan.slice(1)}` : ''}
        icon={checkoutPlan ? PLAN_ICONS[checkoutPlan] : undefined}
      >
        {checkoutPlan && checkoutPlanDetails && (
          <>
            <PremiumDialogBody>
              {/* Price banner */}
              <div className="flex items-center justify-between rounded-xl bg-stockshop-blue/8 dark:bg-blue-950/30 border border-stockshop-blue/20 px-4 py-3">
                <span className="text-sm font-medium text-muted-foreground">Total mensuel</span>
                <span className="text-2xl font-extrabold text-stockshop-blue dark:text-blue-400">
                  {formatPrice(checkoutPlan)}
                </span>
              </div>

              {/* Key features (top 3) */}
              <div className="grid grid-cols-1 gap-1.5">
                {checkoutPlanDetails.features.slice(0, 3).map(f => (
                  <div key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    <span className="text-muted-foreground">{f}</span>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t" />

              {isStripe ? (
                /* ── Stripe countries : paiement en ligne à venir ── */
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-dashed border-stockshop-blue/30 bg-blue-50/50 dark:bg-blue-950/20 p-5 text-center space-y-3">
                    <div className="flex justify-center">
                      <div className="h-12 w-12 rounded-full bg-stockshop-blue/10 flex items-center justify-center">
                        <ShieldCheck className="h-6 w-6 text-stockshop-blue" />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Paiement en ligne bientôt disponible</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Le paiement Stripe par carte bancaire sera activé prochainement pour {country.name}.
                      </p>
                    </div>
                    <div className="rounded-xl bg-card border p-3 text-left space-y-1">
                      <p className="text-xs font-semibold text-foreground">En attendant, contacte-nous :</p>
                      <p className="text-xs text-muted-foreground">
                        Envoie-nous un email avec le plan choisi ({checkoutPlan} · {formatPrice(checkoutPlan)}/mois)
                        et nous activerons ton abonnement manuellement.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                    <span>Paiement sécurisé · Stripe (bientôt)</span>
                  </div>
                </div>
              ) : (
                /* ── Autres pays : sélection de méthode de paiement ── */
                <div>
                  <p className="text-sm font-semibold mb-3">Mode de paiement</p>
                  <div className="space-y-2">
                    {subscriptionMethods.map(method => (
                      <button
                        key={method.id}
                        onClick={() => setSelectedMethod(method.id)}
                        className={cn(
                          'relative w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border-2 transition-all duration-200 text-left active:scale-[0.98]',
                          selectedMethod === method.id
                            ? 'border-stockshop-blue bg-gradient-to-r from-blue-50 to-blue-100/50 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/50 dark:shadow-blue-900/40'
                            : 'border-border hover:border-stockshop-blue/40 hover:shadow-md hover:-translate-y-0.5 bg-card'
                        )}
                      >
                        <div className={cn(
                          'rounded-xl p-2 flex-shrink-0 transition-colors',
                          selectedMethod === method.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/50 dark:bg-white/5'
                        )}>
                          {method.logo
                            ? <img src={method.logo} alt={method.label} className="h-14 w-14 object-contain" />
                            : <span className="text-3xl leading-none block">{method.icon}</span>
                          }
                        </div>
                        <span className={cn(
                          'flex-1 font-semibold text-sm',
                          selectedMethod === method.id ? 'text-stockshop-blue dark:text-blue-400' : 'text-foreground'
                        )}>
                          {method.label}
                        </span>
                        <div className={cn(
                          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                          selectedMethod === method.id
                            ? 'border-stockshop-blue bg-stockshop-blue'
                            : 'border-muted-foreground/30'
                        )}>
                          {selectedMethod === method.id && (
                            <span className="text-white text-[10px] font-bold">✓</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-4">
                    <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                    <span>Paiement sécurisé · {gatewayLabel}</span>
                  </div>
                </div>
              )}
            </PremiumDialogBody>

            <PremiumDialogFooter onCancel={closeCheckout} cancelLabel="Annuler">
              {isStripe ? (
                <a
                  href={`mailto:support@stockshop.tech?subject=Abonnement ${checkoutPlan} - ${country.name}&body=Bonjour, je souhaite souscrire au plan ${checkoutPlan} (${formatPrice(checkoutPlan)}/mois) pour ma boutique.`}
                  className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light text-white flex items-center justify-center gap-2 transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  Nous contacter
                </a>
              ) : (
                <Button
                  onClick={handlePay}
                  loading={loading}
                  disabled={!selectedMethod || loading}
                  className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light text-white"
                >
                  Payer {formatPrice(checkoutPlan)}
                </Button>
              )}
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>
    </>
  )
}
