import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { FinalCta } from '@/components/marketing/sections'
import { IconArrow } from '@/components/marketing/icons'

// Page Aide publique (lot D du 7 nov. 2026) : questions fréquentes avant de commencer et contact. Réponses vérifiées dans
// l'application ; questions d'abonnement = celles de la page Abonnement (billing_page.faq_*), boutiques par formule lues
// dans les règles (plan_offer). Données structurées FAQPage pour les moteurs de recherche.
export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site.help' })
  return {
    title: t('meta_title'), description: t('meta_desc'),
    alternates: { canonical: `/${locale}/aide`, languages: { fr: '/fr/aide', en: '/en/aide', ha: '/ha/aide' } },
  }
}

export default async function HelpPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site.help' })
  const tb = await getTranslations({ locale, namespace: 'billing_page' })
  const tOffer = await getTranslations({ locale, namespace: 'plan_offer' })
  const groups: { title: string; items: { q: string; a: string }[] }[] = [
    { title: t('g_start'), items: [
      { q: t('q_card'), a: t('a_card') }, { q: t('q_devices'), a: t('a_devices') }, { q: t('q_setup'), a: t('a_setup') },
    ] },
    { title: t('g_use'), items: [
      { q: t('q_offline'), a: t('a_offline') },
      { q: t('q_shops'), a: t('a_shops', { starter: tOffer('starter_f1'), pro: tOffer('pro_f1'), business: tOffer('business_f1') }) },
      { q: t('q_team'), a: t('a_team') }, { q: t('q_lang'), a: t('a_lang') },
    ] },
    { title: t('g_billing'), items: [1, 2, 4].map(i => ({ q: tb(`faq_${i}_q`), a: tb(`faq_${i}_a`) })) },
  ]
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: groups.flatMap(g => g.items).map(i => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <section className="page-head">
        <div className="wrap">
          <span className="kicker">{t('kicker')}</span>
          <h1>{t('title')}</h1>
          <p className="lead">{t('lead')}</p>
          <div data-sticky-anchor />
        </div>
      </section>
      <section className="page-body">
        <div className="wrap">
          <div className="pfaq help-faq" data-testid="help-faq">
            {groups.map(g => (
              <div key={g.title} className="help-group">
                <h2>{g.title}</h2>
                {g.items.map(i => (
                  <details key={i.q}><summary>{i.q}</summary><p>{i.a}</p></details>
                ))}
              </div>
            ))}
            <div className="help-contact" data-testid="help-contact">
              <div>
                <strong>{t('contact_title')}</strong>
                <span>{t('contact_text')}</span>
              </div>
              <a className="btn btn-cta" href="mailto:support@stockshop.tech">{t('contact_cta')}</a>
              <Link className="center-link" href={`/${locale}/tarifs`}>{t('pricing_link')} <IconArrow /></Link>
            </div>
          </div>
        </div>
      </section>
      <FinalCta locale={locale} />
    </>
  )
}
