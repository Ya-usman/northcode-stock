'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { getCountry } from '@/lib/saas/countries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { CheckCircle2, Zap, Crown, Building2, Clock, CreditCard, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSearchParams, useRouter } from 'next/navigation'
import Script from 'next/script'

const PLAN_DETAILS = [
  {
    id: 'starter' as const,
    icon: Zap,
    color: 'border-blue-200 hover:border-northcode-blue',
    headerColor: 'bg-blue-50',
    features: [
      '200 produits',
      '3 comptes employés',
      'Export CSV & PDF',
      '90 jours d\'historique',
      'Gestion de stock complète',
      'Suivi crédits clients',
    ],
  },
  {
    id: 'pro' as const,
    icon: Crown,
    color: 'border-northcode-blue ring-2 ring-northcode-blue',
    headerColor: 'bg-northcode-blue text-white',
    popular: true,
    features: [
      'Produits illimités',
      '10 comptes employés',
      'Reçus WhatsApp',
      '1 an d\'historique',
      'Rapports avancés',
      'Support prioritaire',
    ],
  },
  {
    id: 'business' as const,
    icon: Building2,
    color: 'border-gray-200 hover:border-gray-400',
    headerColor: 'bg-gray-900 text-white',
    features: [
      'Produits & employés illimités',
      'Onboarding personnalisé',
      'Support dédié',
      'Historique complet',
      'Accès API',
      'Garantie SLA',
    ],
  },
]

export default function BillingPage({ params: { locale } }: { params: { locale: string } }) {
  const { shop, user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')

    if (success === '1') {
      toast({
        title: 'Paiement réussi !',
        description: 'Votre abonnement est maintenant actif.',
        variant: 'success',
      })
      // Clean URL
      router.replace(`/${locale}/billing`)
    } else if (error) {
      const messages: Record<string, string> = {
        payment_failed: 'Le paiement a échoué. Veuillez réessayer.',
        no_reference: 'Référence de paiement manquante.',
        invalid_plan: 'Plan invalide.',
        server: 'Erreur serveur. Veuillez contacter le support.',
      }
      toast({
        title: 'Erreur de paiement',
        description: messages[error] || 'Une erreur est survenue.',
        variant: 'destructive',
      })
      router.replace(`/${locale}/billing`)
    }
  }, [searchParams])

  const currentPlan = getPlan(shop?.plan)
  const trialDaysLeft = getTrialDaysLeft(shop?.trial_ends_at)
  const isSubscribed = hasActiveSubscription(shop?.plan ?? null, shop?.plan_expires_at ?? null)
  const isTrialActive = !isSubscribed && trialDaysLeft >= 0

  const country = getCountry(shop?.country)
  const isNigeria = country.code === 'NG'
  const isCameroon = country.code === 'CM'

  const handleSubscribe = useCallback(async (planId: 'starter' | 'pro' | 'business') => {
    if (!shop || !user) return
    setLoading(planId)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, shop_id: shop.id, email: user.email, locale }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur initialisation paiement')

      // Nigeria → Paystack Inline popup (stays on page, cleaner UX)
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
          metadata: { shop_id: shop.id, plan_id: planId },
          onClose: () => {
            setLoading(null)
            toast({ title: 'Paiement annulé', variant: 'destructive' })
          },
          callback: (response: { reference: string }) => {
            // Verify server-side — must not be async (Paystack requirement)
            fetch(`/api/billing/verify?reference=${response.reference}&locale=${locale}`)
              .then(() => {
                toast({ title: 'Paiement réussi !', description: 'Votre abonnement est actif.', variant: 'success' })
                window.location.reload()
              })
              .catch(() => {
                toast({ title: 'Erreur de vérification', variant: 'destructive' })
              })
              .finally(() => setLoading(null))
          },
        })
        handler.openIframe()
      } else {
        // Cameroun → Flutterwave redirect
        window.location.href = data.authorization_url
      }
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
      setLoading(null)
    }
  }, [shop, user, country, locale, toast])

  return (
    <>
    <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Current plan status */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="font-bold text-lg">Abonnement</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-xl">{country.flag}</span>
            <span>{country.name} · {country.currencySymbol}</span>
            {isNigeria && (
              <span className="flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                <CreditCard className="h-3 w-3" /> Paystack
              </span>
            )}
            {isCameroon && (
              <span className="flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5">
                <Smartphone className="h-3 w-3" /> MTN / Orange
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-gray-900">Plan actuel :</p>
              <Badge variant={isSubscribed ? 'success' : isTrialActive ? 'warning' : 'danger'}>
                {isSubscribed ? currentPlan.name : isTrialActive ? 'Essai gratuit' : 'Expiré'}
              </Badge>
            </div>

            {isTrialActive && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600">
                <Clock className="h-4 w-4" />
                <span>
                  {trialDaysLeft === 0
                    ? 'L\'essai expire aujourd\'hui'
                    : `${trialDaysLeft} jour${trialDaysLeft !== 1 ? 's' : ''} restant${trialDaysLeft !== 1 ? 's' : ''}`}
                </span>
              </div>
            )}

            {isSubscribed && shop?.plan_expires_at && (
              <p className="text-sm text-muted-foreground">
                Renouvellement le {new Date(shop.plan_expires_at).toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </p>
            )}

            {!isSubscribed && !isTrialActive && (
              <p className="text-sm text-red-600 font-medium">
                Votre plan a expiré. Abonnez-vous pour continuer.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Plan selection */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-4">
          {isSubscribed ? 'Changer de plan' : 'Choisir un plan'}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_DETAILS.map(({ id, icon: Icon, color, headerColor, popular, features }) => {
            const price = country.prices[id]
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
                      Populaire
                    </Badge>
                  </div>
                )}

                <div className={cn('px-5 py-4', headerColor)}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-4 w-4" />
                    <p className="font-bold text-sm">{id.charAt(0).toUpperCase() + id.slice(1)}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={cn('text-2xl font-extrabold', popular ? 'text-white' : 'text-northcode-blue')}>
                      {country.currencySymbol}{price.toLocaleString('fr-FR')}
                    </span>
                    <span className={cn('text-xs', popular ? 'text-blue-100' : 'text-muted-foreground')}>/mois</span>
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
                      Plan actuel
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
                      {isNigeria ? '💳' : '📱'} {isSubscribed ? 'Passer à ' : ''}{id.charAt(0).toUpperCase() + id.slice(1)}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          {isNigeria
            ? 'Paiement sécurisé via Paystack · Carte, virement, USSD'
            : 'Paiement mobile via Flutterwave · MTN MoMo · Orange Money'}
        </p>
      </div>

      {/* FAQ */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Questions fréquentes</h2>
        <div className="space-y-4 text-sm">
          {[
            {
              q: 'Mes données sont-elles supprimées si mon plan expire ?',
              a: 'Non. Vos données sont conservées en sécurité et restent accessibles dès que vous souscrivez à nouveau.',
            },
            {
              q: 'Puis-je changer de plan plus tard ?',
              a: 'Oui. Vous pouvez upgrader ou downgrader à tout moment. Le changement est immédiat.',
            },
            {
              q: 'Comment fonctionne le paiement ?',
              a: isNigeria
                ? 'Nous utilisons Paystack pour les paiements sécurisés. Carte, virement bancaire ou USSD acceptés.'
                : 'Nous utilisons Flutterwave pour les paiements Mobile Money. MTN MoMo et Orange Money acceptés.',
            },
            {
              q: 'Y a-t-il un remboursement ?',
              a: 'Oui. Contactez-nous dans les 7 jours suivant le paiement pour un remboursement complet.',
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
    </>
  )
}
