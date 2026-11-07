'use client'

// Section Tarifs de la page /tarifs (étape 4B du 5 nov. 2026 ; restylée au lot D du 7 nov. 2026 comme les autres pages
// publiques). Mêmes règles : pays de départ via /api/geo puis langue, durées, options, comparaison repliée, offre sur
// mesure. Les montants viennent de lib/saas (countries, plan-offer), jamais écrits en dur. Chaque formule mène à
// l'inscription avec la formule ET la durée choisies (« Vous avez choisi : Pro, 1 an »). Mêmes repères de test.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { CountrySelect } from '@/components/ui/country-select'
import { formatCurrency } from '@/lib/utils/currency'
import { COUNTRIES, getBillingCurrency, getPeriodPrice, BILLING_PERIODS, OFFERED_PERIODS, type BillingPeriod, type CountryCode } from '@/lib/saas/countries'
import { OFFER_PLANS, PLAN_LINE_KEYS, POPULAR_PLAN, COMPARE_ROWS, compareCell, defaultPricingCountry } from '@/lib/saas/plan-offer'
import { IconCheck, IconMinus } from './icons'

export interface PricingFaq {
  title: string
  items: { q: string; a: string }[]
  /** Question sur le paiement : réponse selon le pays choisi ({gateway}, {country}, {methods}) */
  pay_q: string; pay_gateway: string; pay_unavailable: string
}

const GATEWAY_LABEL: Record<string, string> = { paystack: 'Paystack', notchpay: 'NotchPay', stripe: 'Stripe', flutterwave: 'Flutterwave' }
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

export function PricingSection({ locale, faq }: { locale: string; faq?: PricingFaq }) {
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
    features: PLAN_LINE_KEYS[id].map(k => tOffer(k as any)),
  }))
  const periodSuffix = { monthly: tOffer('per_month'), semiannual: tOffer('per_6months'), quarterly: tOffer('per_3months'), annual: tOffer('per_year') }[period]

  // Prix affiché = prix FACTURÉ par StockShop, donc en billingCurrency (pas la devise boutique du pays : pour 6 pays UE
  // elles divergent, CZ/DK/HU/PL/RO/SE facturent en EUR malgré une devise locale)
  const formatPrice = (n: number) => formatCurrency(n, getBillingCurrency(country))
  const methods = country.paymentMethods.filter(m => m.type !== 'cash' && m.type !== 'credit').map(m => m.label).join(', ')
  const payAnswer = faq && (country.gateway === 'stripe'
    ? fill(faq.pay_unavailable, { country: tCountries(country.code as any) })
    : fill(faq.pay_gateway, { gateway: GATEWAY_LABEL[country.gateway], country: tCountries(country.code as any), methods }))

  return (
    <section id="pricing" className="pricing">
      <div className="wrap">
        <div className="ptools">
          <p className="psub">{t('pricing.subtitle')}</p>
          {/* Sélecteur de pays : 52 pays, avec recherche */}
          <div className="pcountry"><CountrySelect value={pricingCountry} onChange={choosePricingCountry} /></div>
          {country.gateway === 'stripe' ? (
            // Paiement en ligne pas encore ouvert pour ce pays (Flutterwave partout : lot 4C)
            <p className="ppay soon" data-testid="landing-pay-soon">{tOffer('pay_soon', { country: tCountries(country.code as any) })}</p>
          ) : (
            <p className="ppay" data-testid="landing-pay-methods">
              {country.gateway === 'paystack' && t('payment_paystack')}
              {country.gateway === 'notchpay' && t('payment_notchpay')}
              {country.gateway === 'flutterwave' && t('payment_flutterwave')}
            </p>
          )}
          {/* Durées : mensuel, 6 mois (2 semaines offertes), 1 an (2 mois offerts) ; même calcul que le paiement */}
          <div role="radiogroup" aria-label={tOffer('period_label')} className="pseg" data-testid="landing-period">
            {OFFERED_PERIODS.map(p => (
              <button key={p} type="button" role="radio" aria-checked={period === p} data-testid={`landing-period-${p}`} onClick={() => setPeriod(p)}>
                {tOffer(`period_${p}` as any)}
                {p !== 'monthly' && <em className={p === 'annual' ? 'save' : ''}>{tOffer(`badge_${p}` as any)}</em>}
              </button>
            ))}
          </div>
        </div>

        <div className="plans">
          {plans.map(plan => (
            <div key={plan.id} className={`plan${plan.popular ? ' pop' : ''}`} data-testid={`landing-plan-${plan.id}`}>
              <div className="plan-top">
                <h3>{plan.name}</h3>
                {plan.popular && <span className="flag">{t('pricing.popular')}</span>}
              </div>
              <div className="price">
                <span className="num" data-testid={`landing-price-${plan.id}`}>{formatPrice(getPeriodPrice(plan.monthly, period))}</span>
                <small>{periodSuffix}</small>
              </div>
              {period !== 'monthly' && (
                <p className="pnote" data-testid="landing-period-note">
                  <b>{tOffer(`badge_${period}` as any)}</b> · {tOffer('per_month_equiv', { price: formatPrice(Math.round(getPeriodPrice(plan.monthly, period) / BILLING_PERIODS[period].months)) })}
                </p>
              )}
              <ul>{plan.features.map(f => <li key={f}>{f}</li>)}</ul>
              <Link href={`/${locale}/register?plan=${plan.id}&period=${period}`} className={`btn ${plan.popular ? 'btn-cta' : 'btn-ghost'}`} data-testid={`landing-cta-${plan.id}`}>
                {t('pricing.cta')}
              </Link>
            </div>
          ))}
        </div>

        {/* Options payantes : vrais montants du pays choisi (lib/saas/countries, addons) */}
        <p className="paddons" data-testid="landing-addons">
          {tOffer('addons_line', { seat: formatPrice(country.addons.seat), shop: formatPrice(country.addons.shop) })}
        </p>

        {/* Comparer les formules : replié par défaut, mêmes règles que le serveur (lib/saas/plan-offer) */}
        <div className="center">
          <button type="button" className="pcompare-toggle" onClick={() => setCompareOpen(o => !o)} aria-expanded={compareOpen} aria-controls="landing-compare" data-testid="landing-compare-toggle">
            {compareOpen ? tOffer('compare_hide') : tOffer('compare_toggle')}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ transform: compareOpen ? 'rotate(180deg)' : undefined }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>
        {compareOpen && (
          <div id="landing-compare" className="pcompare" data-testid="landing-compare">
            <table>
              <caption className="sr-only">{tOffer('compare_caption')}</caption>
              <thead><tr><td />{plans.map(plan => <th key={plan.id} scope="col" className={plan.popular ? 'pop' : ''}>{plan.name}</th>)}</tr></thead>
              <tbody>
                {COMPARE_ROWS.map(row => (
                  <tr key={row} data-testid={`landing-compare-${row}`}>
                    <th scope="row">{tOffer(`row_${row}` as any)}</th>
                    {plans.map(plan => {
                      const cell = compareCell(row, plan.id)
                      return (
                        <td key={plan.id}>
                          {cell.kind === 'count' && cell.value}
                          {cell.kind === 'text' && tOffer(cell.key)}
                          {cell.kind === 'bool' && (cell.value
                            ? <><span className="yes"><IconCheck /></span><span className="sr-only">{tOffer('included')}</span></>
                            : <><span className="no"><IconMinus /></span><span className="sr-only">{tOffer('not_included')}</span></>)}
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
        <div className="pcustom" data-testid="landing-custom">
          <div>
            <strong>{t('pricing.custom_title')}</strong>
            <span>{t('pricing.custom_text')}</span>
            <a href="mailto:support@stockshop.tech">{t('pricing.custom_contact')}</a>
          </div>
          <Link href={`/${locale}/register?plan=business`} className="btn btn-ghost">{t('pricing.custom_cta')}</Link>
        </div>

        <p className="pfine" data-testid="landing-pricing-note">{t('pricing.note')}</p>

        {faq && (
          <div className="pfaq" data-testid="pricing-faq">
            <h2>{faq.title}</h2>
            {[...faq.items.slice(0, 2), { q: faq.pay_q, a: payAnswer || '' }, ...faq.items.slice(2)].map(item => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
