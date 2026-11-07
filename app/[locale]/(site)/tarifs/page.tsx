import type { Metadata } from 'next'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { PricingSection, type PricingFaq } from '@/components/marketing/pricing-section'

// Page Tarifs (6 nov. 2026) : la section Tarifs de l'ancienne page d'accueil, telle quelle (règles de lib/saas), dans
// le nouvel habillage, restylée au lot D (7 nov. 2026) avec les questions fréquentes de la page Abonnement.
export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site' })
  return {
    title: t('meta.pricing_title'),
    description: t('meta.pricing_desc'),
    alternates: { canonical: `/${locale}/tarifs`, languages: { fr: '/fr/tarifs', en: '/en/tarifs', ha: '/ha/tarifs' } },
  }
}

export default async function PricingPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site' })
  // Questions fréquentes : les mêmes que la page Abonnement (namespace billing_page) ; paiement selon le pays choisi
  const tb = await getTranslations({ locale, namespace: 'billing_page' })
  const faq: PricingFaq = {
    title: tb('faq_title'),
    items: [1, 2, 4].map(i => ({ q: tb(`faq_${i}_q`), a: tb(`faq_${i}_a`) })),
    pay_q: tb('faq_3_q'), pay_gateway: tb.raw('faq_3_gateway') as string, pay_unavailable: tb.raw('faq_3_unavailable') as string,
  }
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <span className="kicker">{t('pricing_page.kicker')}</span>
          <h1>{t('pricing_page.title')}</h1>
          <p className="lead">{t('pricing_page.lead')}</p>
          <div data-sticky-anchor />
        </div>
      </section>
      <div className="page-body">
        <PricingSection locale={locale} faq={faq} />
      </div>
    </>
  )
}
