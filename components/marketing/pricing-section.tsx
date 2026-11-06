'use client'

// Section Tarifs (étape 4B du 5 nov. 2026), sortie de l'ancienne page d'accueil le 6 nov. 2026 pour la page /tarifs :
// mêmes règles (pays de départ via /api/geo puis langue, durées, options, comparaison repliée, offre sur mesure) et
// mêmes repères de test. Les montants viennent de lib/saas (countries, plan-offer), jamais écrits en dur.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ChevronDown, CreditCard, Minus, Smartphone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CountrySelect } from '@/components/ui/country-select'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import { COUNTRIES, getBillingCurrency, getPeriodPrice, BILLING_PERIODS, OFFERED_PERIODS, type BillingPeriod, type CountryCode } from '@/lib/saas/countries'
import { OFFER_PLANS, PLAN_LINE_KEYS, POPULAR_PLAN, COMPARE_ROWS, compareCell, defaultPricingCountry } from '@/lib/saas/plan-offer'

export function PricingSection({ locale }: { locale: string }) {
  const t = useTranslations('landing')
  const tOffer = useTranslations('plan_offer')
  const tCountries = useTranslations('countries')
  // Pays de départ des tarifs : celui du visiteur (hébergeur), sinon celui de la langue ; affichage seulement
  const knownCountry = (c: string) => c in COUNTRIES
  const [pricingCountry, setPricingCountry] = useState<CountryCode>(() => defaultPricingCountry(locale, null, knownCountry) as CountryCode)
  const countryChosen = useRef(false)
  useEffect(() => {
    let alive = true
    fetch('/api/geo').then(r => (r.ok ? r.json() : null)).then(j => {
      if (alive && j?.country && !countryChosen.current) setPricingCountry(defaultPricingCountry(locale, j.country, knownCountry) as CountryCode)
    }).catch(() => {})
    return () => { alive = false }
  }, [locale])
  const choosePricingCountry = (c: CountryCode) => { countryChosen.current = true; setPricingCountry(c) }
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const [compareOpen, setCompareOpen] = useState(false)
  const country = COUNTRIES[pricingCountry]

  const plans = OFFER_PLANS.map(id => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    monthly: country.prices[id],
    popular: id === POPULAR_PLAN,
    color: id === POPULAR_PLAN ? 'border-stockshop-blue dark:border-blue-500' : 'border-gray-200 dark:border-gray-700',
    features: PLAN_LINE_KEYS[id].map(k => tOffer(k as any)),
  }))
  const periodSuffix = { monthly: tOffer('per_month'), semiannual: tOffer('per_6months'), quarterly: tOffer('per_3months'), annual: tOffer('per_year') }[period]

  // Prix affiché = prix FACTURÉ par StockShop, donc en billingCurrency (pas la devise boutique du pays : pour 6 pays UE
  // elles divergent, CZ/DK/HU/PL/RO/SE facturent en EUR malgré une devise locale)
  const formatPrice = (n: number) => formatCurrency(n, getBillingCurrency(country))

  return (
    <section id="pricing" className="py-12 md:py-20 px-4">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-8 md:mb-10">
                      <p className="text-base md:text-lg text-muted-foreground mb-5">{t('pricing.subtitle')}</p>

          {/* Sélecteur de pays — 52 pays (dont les 27 de l'UE individuellement)
              ne tiennent plus dans une rangée de boutons (Phase 2 "pays UE"). */}
          <div className="max-w-xs mx-auto">
            <CountrySelect value={pricingCountry} onChange={choosePricingCountry} />
          </div>
          {country.gateway === 'stripe' ? (
            // Paiement en ligne pas encore ouvert pour ce pays (Flutterwave partout : lot 4C)
            <p className="mx-auto mt-2 max-w-md text-xs text-amber-800 dark:text-amber-300" data-testid="landing-pay-soon">
              {tOffer('pay_soon', { country: tCountries(country.code as any) })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1" data-testid="landing-pay-methods">
              {country.gateway === 'paystack' && <><CreditCard className="h-3.5 w-3.5" /> {t('payment_paystack')}</>}
              {country.gateway === 'notchpay' && <><CreditCard className="h-3.5 w-3.5" /> {t('payment_notchpay')}</>}
              {country.gateway === 'flutterwave' && <><Smartphone className="h-3.5 w-3.5" /> {t('payment_flutterwave')}</>}
            </p>
          )}

          {/* Durées : mensuel, 6 mois (2 semaines offertes), 1 an (2 mois offerts) ; même calcul que le paiement */}
          <div role="radiogroup" aria-label={tOffer('period_label')} className="mx-auto mt-5 inline-flex max-w-full flex-wrap justify-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800" data-testid="landing-period">
            {OFFERED_PERIODS.map(p => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                data-testid={`landing-period-${p}`}
                onClick={() => setPeriod(p)}
                className={cn(
                  'flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue',
                  period === p ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                )}
              >
                {tOffer(`period_${p}` as any)}
                {p !== 'monthly' && (
                  <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-bold', p === 'annual'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                    : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-900/40 dark:text-blue-400')}>{tOffer(`badge_${p}` as any)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {plans.map(plan => (
            <div
              key={plan.id}
              data-testid={`landing-plan-${plan.id}`}
              className={cn(
                'relative rounded-2xl border-2 bg-white dark:bg-gray-800/50 p-6 shadow-sm',
                plan.color,
                plan.popular && 'shadow-xl ring-2 ring-stockshop-blue dark:ring-blue-500 mt-4 md:mt-0'
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-stockshop-blue text-white px-3 py-1 text-xs font-semibold">
                    {t('pricing.popular')}
                  </Badge>
                </div>
              )}

              <div className="mb-5">
                <p className="font-bold text-gray-900 dark:text-white text-lg mb-1">{plan.name}</p>
                <div className="flex items-baseline gap-1 flex-wrap">
                  <span className="text-2xl md:text-3xl font-extrabold text-stockshop-blue dark:text-blue-400" data-testid={`landing-price-${plan.id}`}>
                    {formatPrice(getPeriodPrice(plan.monthly, period))}
                  </span>
                  <span className="text-muted-foreground text-sm">{periodSuffix}</span>
                </div>
                {period !== 'monthly' && (
                  <p className="mt-1 text-sm" data-testid="landing-period-note">
                    <span className="font-semibold text-green-700 dark:text-green-400">{tOffer(`badge_${period}` as any)}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-medium text-gray-900 dark:text-white">{tOffer('per_month_equiv', { price: formatPrice(Math.round(getPeriodPrice(plan.monthly, period) / BILLING_PERIODS[period].months)) })}</span>
                  </p>
                )}
              </div>

              <ul className="space-y-2 mb-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link href={`/${locale}/register?plan=${plan.id}`}>
                <Button className={cn(
                  'w-full',
                  plan.popular
                    ? 'bg-stockshop-blue hover:bg-stockshop-blue-light dark:bg-blue-600 dark:hover:bg-blue-500 text-white'
                    : 'border border-stockshop-blue dark:border-blue-400 text-stockshop-blue dark:text-blue-400 hover:bg-stockshop-blue-muted dark:hover:bg-blue-950/40 bg-transparent'
                )}>
                  {t('pricing.cta')}
                </Button>
              </Link>
            </div>
          ))}
        </div>

        {/* Options payantes : vrais montants du pays choisi (lib/saas/countries, addons) */}
        <p className="mt-5 text-center text-sm text-gray-700 dark:text-gray-300" data-testid="landing-addons">
          {tOffer('addons_line', { seat: formatPrice(country.addons.seat), shop: formatPrice(country.addons.shop) })}
        </p>

        {/* Comparer les formules : replié par défaut, mêmes règles que le serveur (lib/saas/plan-offer) */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setCompareOpen(o => !o)}
            aria-expanded={compareOpen}
            aria-controls="landing-compare"
            data-testid="landing-compare-toggle"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-stockshop-blue hover:bg-stockshop-blue-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            {compareOpen ? tOffer('compare_hide') : tOffer('compare_toggle')}
            <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', compareOpen && 'rotate-180')} aria-hidden />
          </button>
        </div>
        {compareOpen && (
          <div id="landing-compare" className="relative mx-auto mt-3 max-w-5xl overflow-x-auto rounded-2xl border bg-white dark:border-gray-700 dark:bg-gray-900" data-testid="landing-compare">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">{tOffer('compare_caption')}</caption>
              <thead>
                <tr className="border-b dark:border-gray-700">
                  <td className="px-4 py-3" />
                  {plans.map(plan => (
                    <th key={plan.id} scope="col" className={cn('px-3 py-3 text-center font-bold', plan.popular ? 'text-stockshop-blue dark:text-blue-400' : 'text-gray-900 dark:text-white')}>{plan.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(row => (
                  <tr key={row} className="border-b last:border-0 dark:border-gray-800" data-testid={`landing-compare-${row}`}>
                    <th scope="row" className="px-4 py-2.5 text-left font-normal text-gray-700 dark:text-gray-300">{tOffer(`row_${row}` as any)}</th>
                    {plans.map(plan => {
                      const cell = compareCell(row, plan.id)
                      return (
                        <td key={plan.id} className="px-3 py-2.5 text-center tabular-nums text-gray-900 dark:text-white">
                          {cell.kind === 'count' && cell.value}
                          {cell.kind === 'text' && tOffer(cell.key)}
                          {cell.kind === 'bool' && (cell.value
                            ? <><CheckCircle2 className="mx-auto h-4 w-4 text-green-600 dark:text-green-400" aria-hidden /><span className="sr-only">{tOffer('included')}</span></>
                            : <><Minus className="mx-auto h-4 w-4 text-gray-400" aria-hidden /><span className="sr-only">{tOffer('not_included')}</span></>)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Offre sur mesure (à partir de 4 boutiques) : essai d'abord, puis demande de devis dans l'application */}
        <div className="mx-auto mt-6 flex max-w-5xl flex-col gap-3 rounded-2xl border-2 border-dashed border-stockshop-blue/30 bg-white p-5 text-left sm:flex-row sm:items-center sm:justify-between dark:border-blue-400/30 dark:bg-gray-900" data-testid="landing-custom">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{t('pricing.custom_title')}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('pricing.custom_text')}</p>
            <a href="mailto:support@stockshop.tech" className="mt-1 inline-block text-sm text-stockshop-blue hover:underline dark:text-blue-400">{t('pricing.custom_contact')}</a>
          </div>
          <Link href={`/${locale}/register?plan=business`} className="shrink-0">
            <Button className="w-full bg-stockshop-blue text-white hover:bg-stockshop-blue-light sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-500">{t('pricing.custom_cta')}</Button>
          </Link>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6" data-testid="landing-pricing-note">{t('pricing.note')}</p>
      </div>
    </section>
  )
}
