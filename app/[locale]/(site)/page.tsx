import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { COUNTRIES, getBillingCurrency } from '@/lib/saas/countries'
import { formatCurrency } from '@/lib/utils/currency'
import { isLive } from '@/lib/site/pages'
import { StartingPrice } from '@/components/marketing/site-bits'
import { FinalCta, MultiShopsSection } from '@/components/marketing/sections'
import {
  IconAlert, IconArrow, IconCart, IconChart, IconCheck, IconCoins, IconDevices, IconGlobe, IconKey, IconOffline, IconShield, IconStore, IconSync,
} from '@/components/marketing/icons'

// Accueil court (refonte du 6 nov. 2026, maquette v6 validée) : scène produit, 6 avantages, 4 tuiles vers Plateforme,
// multi-boutiques, aperçu des métiers, aperçu des tarifs, appel final. Rendu par le serveur, généré à l'avance.
// Captures : compte de démonstration vivant (tests/e2e/landing-captures.js). Aucun chiffre ni avis inventé.

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site' })
  return {
    title: t('meta.home_title'),
    description: t('meta.home_desc'),
    alternates: { canonical: `/${locale}`, languages: { fr: '/fr', en: '/en', ha: '/ha' } },
    openGraph: { title: t('meta.home_title'), description: t('meta.home_desc'), images: ['/landing/pc-reports.webp'] },
  }
}

export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site' })
  const tOffer = await getTranslations({ locale, namespace: 'plan_offer' })
  // Prix de départ par pays, mis en forme ici : le navigateur choisit seulement le pays (page légère)
  const startingPrices = Object.fromEntries(Object.values(COUNTRIES).map(c => [c.code, formatCurrency(c.prices.starter, getBillingCurrency(c))]))
  const platformHref = isLive('platform') ? `/${locale}/plateforme` : `/${locale}/tarifs`
  const tile = (icon: React.ReactNode, color: string, title: string, text: string, anchor: string) => {
    const inner = (<><span className={`ic ic-${color}`}>{icon}</span><h3>{title}</h3><p>{text}</p>{isLive('platform') && <span className="more">{t('tiles.more')} <IconArrow /></span>}</>)
    return isLive('platform')
      ? <Link className="tile" href={`/${locale}/plateforme#${anchor}`}>{inner}</Link>
      : <div className="tile">{inner}</div>
  }

  return (
    <>
      {/* 1. Haut de page : scène produit (ordinateur, téléphone devant, 3 cartes dans les marges) */}
      <section className="hero">
        <i className="halo h1" /><i className="halo h2" /><i className="halo h3" />
        <div className="wrap center">
          <span className="eyebrow"><b>{t('hero.eyebrow_tag')}</b>{t('hero.eyebrow')}</span>
          <h1><span>{t('hero.title_1')}</span><span>{t('hero.title_2')}</span><span className="hl">{t('hero.title_3')}</span></h1>
          <p className="lead">{t('hero.lead')}</p>
          <div className="cta-row" data-sticky-anchor>
            <Link href={`/${locale}/register`} className="btn btn-cta" data-testid="home-trial">{t('nav.trial_long')}</Link>
            {isLive('platform') && <Link href={platformHref} className="btn btn-ghost">{t('hero.cta_platform')}</Link>}
          </div>
          <p className="reassure">
            <span><IconCheck />{t('hero.reassure_1')}</span><span><IconCheck />{t('hero.reassure_2')}</span><span><IconCheck />{t('hero.reassure_3')}</span>
          </p>
          <div className="scene">
            <div className="window">
              <div className="bar"><i /><i /><i /><span>stockshop.tech</span></div>
              <div className="shot"><Image src="/landing/pc-reports.webp" alt={t('hero.img_desktop')} fill priority sizes="(max-width: 760px) 92vw, 900px" /></div>
            </div>
            <div className="phone"><div className="screen"><Image src="/landing/tel-pos.webp" alt={t('hero.img_phone')} fill sizes="(max-width: 760px) 116px, 210px" /></div></div>
            <div className="float f1" aria-hidden="true"><span className="ic ic-green"><IconCart /></span><div><b>{t('hero.float_1_t')}</b><span>{t('hero.float_1_s')}</span></div></div>
            <div className="float f2" aria-hidden="true"><span className="ic ic-cyan"><IconSync /></span><div><b>{t('hero.float_2_t')}</b><span>{t('hero.float_2_s')}</span></div></div>
            <div className="float f3" aria-hidden="true"><span className="ic ic-orange"><IconAlert /></span><div><b>{t('hero.float_3_t')}</b><span>{t('hero.float_3_s')}</span></div></div>
          </div>
          <ul className="chips" aria-hidden="true">
            <li className="ic-green">{t('hero.chip_offline')}</li><li className="ic-cyan">{t('hero.chip_multi')}</li>
            <li className="ic-orange">{t('hero.chip_stock')}</li><li className="ic-violet">{t('hero.chip_reports')}</li>
          </ul>
        </div>
      </section>

      {/* 2. Avantages */}
      <div className="strip">
        <ul className="wrap grid">
          <li className="adv"><span className="ic ic-cyan"><IconStore /></span><b>{t('adv.multi_t')}</b><span>{t('adv.multi_d')}</span></li>
          <li className="adv"><span className="ic ic-green"><IconOffline /></span><b>{t('adv.offline_t')}</b><span>{t('adv.offline_d')}</span></li>
          <li className="adv"><span className="ic ic-violet"><IconCoins /></span><b>{t('adv.currency_t')}</b><span>{t('adv.currency_d')}</span></li>
          <li className="adv"><span className="ic ic-blue"><IconGlobe /></span><b>{t('adv.lang_t')}</b><span>{t('adv.lang_d')}</span></li>
          <li className="adv"><span className="ic ic-blue"><IconShield /></span><b>{t('adv.roles_t')}</b><span>{t('adv.roles_d')}</span></li>
          <li className="adv"><span className="ic ic-orange"><IconDevices /></span><b>{t('adv.devices_t')}</b><span>{t('adv.devices_d')}</span></li>
        </ul>
      </div>

      {/* 3. Ce que fait StockShop : 4 tuiles vers la page Plateforme */}
      <section className="sec tint">
        <div className="wrap center">
          <span className="kicker">{t('tiles.kicker')}</span>
          <h2>{t('tiles.title')}</h2>
          <div className="tiles">
            {tile(<IconCart />, 'green', t('tiles.sale_t'), t('tiles.sale_d'), 'vente')}
            {tile(<IconAlert />, 'orange', t('tiles.stock_t'), t('tiles.stock_d'), 'stock')}
            {tile(<IconChart />, 'violet', t('tiles.pilot_t'), t('tiles.pilot_d'), 'pilotage')}
            {tile(<IconKey />, 'blue', t('tiles.team_t'), t('tiles.team_d'), 'equipe')}
          </div>
          {isLive('platform') && <Link className="center-link" href={platformHref}>{t('tiles.all')} <IconArrow /></Link>}
        </div>
      </section>

      <MultiShopsSection locale={locale} />

      {/* 5. Métiers : aperçu */}
      <section className="sec alt">
        <div className="wrap center">
          <span className="kicker">{t('trades.kicker')}</span>
          <h2><span className="line">{t('trades.title_1')}</span><span className="line">{t('trades.title_2')}</span></h2>
          <ul className="peek">
            <li className="live">{t('trades.commerce')} <em>{t('trades.available')}</em></li>
            <li className="next">{t('trades.health')} <em>{t('trades.next')}</em></li>
            <li>{t('trades.services')} <em>{t('trades.soon')}</em></li>
            <li>{t('trades.education')} <em>{t('trades.soon')}</em></li>
            <li>{t('trades.rental')} <em>{t('trades.soon')}</em></li>
          </ul>
          {isLive('trades') && <Link className="center-link" href={`/${locale}/metiers`}>{t('trades.link')} <IconArrow /></Link>}
        </div>
      </section>

      {/* 6. Tarifs : aperçu (prix de départ et formules lus dans lib/saas) */}
      <section className="sec">
        <div className="wrap center">
          <span className="kicker">{t('price.kicker')}</span>
          <h2>{t('price.title')}</h2>
          <div className="price-peek">
            <div>
              <span className="from">{t('price.from')}</span>
              <div className="big"><StartingPrice locale={locale} prices={startingPrices} /> <small>{t('price.per_month')}</small></div>
              <ul><li>{t('price.l1')}</li><li>{t('price.l2')}</li><li>{t('price.l3')}</li></ul>
            </div>
            <div className="side">
              <ul className="plans-mini">
                <li><b>Starter</b> · {tOffer('starter_f1')}</li>
                <li><b>Pro</b> · {tOffer('pro_f1')}</li>
                <li><b>Business</b> · {tOffer('business_f1')}</li>
              </ul>
              <Link className="btn btn-cta" href={`/${locale}/tarifs`} data-testid="home-pricing">{t('price.cta')}</Link>
            </div>
          </div>
        </div>
      </section>

      <FinalCta locale={locale} />
    </>
  )
}
