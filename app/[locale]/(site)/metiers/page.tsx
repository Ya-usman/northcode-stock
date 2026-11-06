import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { FinalCta, getWaitlistLabels } from '@/components/marketing/sections'
import { WaitlistForm } from '@/components/marketing/waitlist-form'
import { NotifyButton } from '@/components/marketing/waitlist-bits'
import { IconArrow, IconCalendar, IconHealth, IconPlus, IconSchool, IconStore, IconTools } from '@/components/marketing/icons'
import type { WaitlistSector } from '@/lib/site/waitlist'

// Page Métiers (lot C du 6 nov. 2026) : le commerce disponible, les modules à venir (une page par secteur quand elle
// existe, Santé d'abord), la liste d'attente enregistrée par le serveur (/api/waitlist, migration 217).
export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site.trades_page' })
  return {
    title: t('meta_title'), description: t('meta_desc'),
    alternates: { canonical: `/${locale}/metiers`, languages: { fr: '/fr/metiers', en: '/en/metiers', ha: '/ha/metiers' } },
  }
}

const LIST_SECTORS: WaitlistSector[] = ['health', 'services', 'education', 'rental', 'hospitality', 'restaurant', 'beauty', 'property', 'other']

export default async function TradesPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site.trades_page' })
  const labels = await getWaitlistLabels(locale)
  const lines = (k: string) => <ul>{[1, 2, 3].map(i => <li key={i}>{t(`${k}_l${i}`)}</li>)}</ul>
  const soon = (k: 'services' | 'education' | 'rental', icon: React.ReactNode) => (
    <div className="trade" data-testid={`trade-${k}`}>
      <div className="trade-head"><span className="ic ic-blue">{icon}</span><h3>{t(`${k}_t`)}</h3><span className="tag">{t('soon')}</span></div>
      <p>{t(`${k}_d`)}</p>
      {lines(k)}
      <div className="actions"><NotifyButton sector={k} label={t('notify')} /></div>
    </div>
  )

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <span className="kicker">{t('kicker')}</span>
          <h1>{t('title')}</h1>
          <p className="lead">{t('lead')}</p>
          <div data-sticky-anchor />
        </div>
      </section>
      <section className="sec tint" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <div className="trades">
            <div className="trade live" data-testid="trade-commerce">
              <div className="trade-head"><span className="ic ic-blue"><IconStore /></span><h3>{t('commerce_t')}</h3><span className="tag tag-live">{t('available')}</span></div>
              <p>{t('commerce_d')}</p>
              {lines('commerce')}
              <div className="actions">
                <Link href={`/${locale}/register`} className="btn btn-cta btn-sm">{t('commerce_cta')}</Link>
                <Link href={`/${locale}/plateforme`} className="link">{t('commerce_more')} <IconArrow /></Link>
              </div>
            </div>
            <div className="trade next" data-testid="trade-health">
              <div className="trade-head"><span className="ic ic-green"><IconHealth /></span><h3>{t('health_t')}</h3><span className="tag tag-next">{t('next')}</span></div>
              <p>{t('health_d')}</p>
              {lines('health')}
              <div className="actions">
                <Link href={`/${locale}/metiers/sante`} className="link" data-testid="trade-health-more">{t('health_cta')} <IconArrow /></Link>
                <NotifyButton sector="health" label={t('notify')} />
              </div>
            </div>
            {soon('services', <IconTools />)}
            {soon('education', <IconSchool />)}
            {soon('rental', <IconCalendar />)}
            <div className="trade later" data-testid="trade-later">
              <div className="trade-head"><span className="ic ic-blue"><IconPlus /></span><h3>{t('later_t')}</h3></div>
              <p>{t('later_d')}</p>
              <div className="actions"><NotifyButton sector="other" label={t('later_cta')} /></div>
            </div>
          </div>

          <div className="waitlist" id="liste">
            <div><strong>{t('wl_title')}</strong><span>{t('wl_sub')}</span></div>
            <WaitlistForm locale={locale} labels={labels} sectors={LIST_SECTORS} />
          </div>
        </div>
      </section>
      <FinalCta locale={locale} />
    </>
  )
}
