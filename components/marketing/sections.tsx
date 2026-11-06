import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { formatCurrency } from '@/lib/utils/currency'
import { isLive } from '@/lib/site/pages'
import { IconStore } from './icons'

// Sections communes à l'accueil et à la page Plateforme (rendues par le serveur).

// Exemple du panneau multi-boutiques : chiffres réels d'octobre 2026 des boutiques de démonstration (ventes actives,
// relevées le 6 nov. 2026 ; marge et crédits = page Rapports « Mois dernier », toutes les boutiques).
const DEMO_OCTOBER = {
  revenue: 7_308_950, margin: 1_666_250, credits: 476_550,
  shops: [
    { name: 'Akwa', amount: 3_501_900, color: 'var(--s-akwa)' },
    { name: 'Bonapriso', amount: 2_654_450, color: 'var(--s-bona)' },
    { name: 'Bastos', amount: 1_152_600, color: 'var(--s-bastos)' },
  ],
}

/** Multi-boutiques : texte + panneau d'exemple (chiffres réels des boutiques de démonstration). */
export async function MultiShopsSection({ locale, id, className = 'sec' }: { locale: string; id?: string; className?: string }) {
  const t = await getTranslations({ locale, namespace: 'site' })
  const numLocale = locale === 'fr' ? 'fr-FR' : 'en-US'
  const money = (n: number) => formatCurrency(n, 'XAF', numLocale)
  const short = (n: number) => `${new Intl.NumberFormat(numLocale, { maximumFractionDigits: 1 }).format(n / 1_000_000)} M F CFA`
  const top = Math.max(...DEMO_OCTOBER.shops.map(s => s.amount))
  return (
    <section id={id} className={className}>
      <div className="wrap two acc-cyan">
        <div className="copy">
          <span className="kicker k-cyan"><span className="ic ic-cyan"><IconStore /></span>{t('multi.kicker')}</span>
          <h2>{t('multi.title')}</h2>
          <p className="sub">{t('multi.sub')}</p>
          <ul className="list">
            <li><b>{t('multi.l1_t')}</b><span>{t('multi.l1_d')}</span></li>
            <li><b>{t('multi.l2_t')}</b><span>{t('multi.l2_d')}</span></li>
            <li><b>{t('multi.l3_t')}</b><span>{t('multi.l3_d')}</span></li>
          </ul>
        </div>
        <div>
          <div className="panel" data-testid="home-multi-panel">
            <div className="panel-top"><span className="selector">{t('multi.selector')} ▾</span><small>{t('multi.period')}</small></div>
            <div className="totals">
              <div><small>{t('multi.revenue')}</small><span className="num k-green">{short(DEMO_OCTOBER.revenue)}</span></div>
              <div><small>{t('multi.margin')}</small><span className="num k-violet">{short(DEMO_OCTOBER.margin)}</span></div>
              <div><small>{t('multi.credits')}</small><span className="num k-orange">{money(DEMO_OCTOBER.credits)}</span></div>
            </div>
            <div className="rows">
              {DEMO_OCTOBER.shops.map(s => (
                <div className="row" key={s.name}>
                  <b><span className="dot" style={{ background: s.color }} />{s.name}</b>
                  <span className="bar2"><i style={{ width: `${Math.round((s.amount / top) * 100)}%`, background: s.color }} /></span>
                  <span className="num">{short(s.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="fine">{t('multi.fine')}</p>
        </div>
      </div>
    </section>
  )
}

/** Appel final (essai gratuit + plateforme quand la page est en ligne). */
export async function FinalCta({ locale, showPlatform = true }: { locale: string; showPlatform?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'site' })
  const platformHref = `/${locale}/plateforme`
  return (
    <section className="final">
      <div className="wrap">
        <h2>{t('final.title_1')}<span>{t('final.title_2')}</span></h2>
        <p>{t('final.sub')}</p>
        <div className="cta-row">
          <Link href={`/${locale}/register`} className="btn btn-cta">{t('nav.trial_long')}</Link>
          {showPlatform && isLive('platform') && <Link href={platformHref} className="btn btn-outline-w">{t('hero.cta_platform')}</Link>}
        </div>
        <p className="reassure">{t('final.reassure')}</p>
      </div>
    </section>
  )
}
