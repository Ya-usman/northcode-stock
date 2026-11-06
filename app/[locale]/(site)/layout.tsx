import { Montserrat, Noto_Sans } from 'next/font/google'
import Link from 'next/link'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { BrandLogo } from '@/components/brand/brand-logo'
import { SiteHeader, type SiteHeaderLabels } from '@/components/marketing/site-header'
import { FooterLanguages, StickyTrial } from '@/components/marketing/site-bits'
import { isLive, type SitePageKey } from '@/lib/site/pages'
import '@/components/marketing/site.css'

// Pages publiques (accueil, plateforme, métiers, tarifs) : générées à l'avance par langue, sans requête à la base.
// Polices auto-hébergées (next/font) : titres Montserrat 700/800, texte Noto Sans.
const display = Montserrat({ subsets: ['latin'], weight: ['700', '800'], variable: '--mk-display', display: 'swap' })
const body = Noto_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--mk-body', display: 'swap' })

export default async function SiteLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site' })
  const pages: SitePageKey[] = ['platform', 'trades', 'pricing', 'help']
  const labels: SiteHeaderLabels = {
    home: t('nav.home'), login: t('nav.login'), trial: t('nav.trial'), trial_long: t('nav.trial_long'),
    menu_open: t('nav.menu_open'), menu_close: t('nav.menu_close'), theme_dark: t('nav.theme_dark'), theme_light: t('nav.theme_light'), theme: t('nav.theme'),
    language: t('nav.language'), language_choose: t('nav.language_choose'), back: t('nav.back'),
    pages: Object.fromEntries(pages.map(k => [k, { label: t(`nav.${k}`), sub: t(`nav.${k}_sub`) }])) as SiteHeaderLabels['pages'],
  }
  const link = (key: SitePageKey, path: string, label: string) => (isLive(key) ? <li><Link href={`/${locale}${path}`}>{label}</Link></li> : null)

  return (
    <div className={`mk ${display.variable} ${body.variable}`}>
      <SiteHeader locale={locale} labels={labels} />
      <main id="contenu">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <BrandLogo tone="auto" className="text-xl" />
              <p style={{ marginTop: 12, maxWidth: 280 }}>{t('footer.tagline')}</p>
            </div>
            <div>
              <h4>{t('footer.platform')}</h4>
              <ul>
                {isLive('platform') ? (
                  <>
                    <li><Link href={`/${locale}/plateforme#vente`}>{t('tiles.sale_t')}</Link></li>
                    <li><Link href={`/${locale}/plateforme#stock`}>{t('tiles.stock_t')}</Link></li>
                    <li><Link href={`/${locale}/plateforme#pilotage`}>{t('tiles.pilot_t')}</Link></li>
                    <li><Link href={`/${locale}/plateforme#equipe`}>{t('footer.team')}</Link></li>
                  </>
                ) : (
                  <>
                    <li>{t('tiles.sale_t')}</li><li>{t('tiles.stock_t')}</li><li>{t('tiles.pilot_t')}</li><li>{t('footer.team')}</li>
                  </>
                )}
              </ul>
            </div>
            <div>
              <h4>{t('footer.resources')}</h4>
              <ul>
                {link('trades', '/metiers', t('nav.trades'))}
                {link('pricing', '/tarifs', t('nav.pricing'))}
                {link('help', '/aide', t('nav.help'))}
                <li><a href="mailto:support@stockshop.tech">support@stockshop.tech</a></li>
              </ul>
            </div>
            <div>
              <h4>{t('footer.legal')}</h4>
              <ul>
                <li><a href="/mentions-legales">{t('footer.legal_notice')}</a></li>
                <li><a href="/privacy">{t('footer.privacy')}</a></li>
              </ul>
            </div>
          </div>
          <div className="bottom">
            <span>{t('footer.rights', { year: new Date().getFullYear() })}</span>
            <FooterLanguages locale={locale} label={t('nav.language')} />
          </div>
        </div>
      </footer>
      <StickyTrial href={`/${locale}/register`} label={t('nav.trial_long')} />
    </div>
  )
}
