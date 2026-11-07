import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { PageTabs } from '@/components/marketing/page-tabs'
import { FinalCta, MultiShopsSection } from '@/components/marketing/sections'
import { IconAlert, IconCart, IconChart, IconKey, IconShield } from '@/components/marketing/icons'

// Page Plateforme (lot B du 6 nov. 2026, maquette v6 validée) : le socle commun, identique pour tous les métiers.
// En onglets depuis le 7 nov. 2026 (une partie à la fois) : Vente, Stock, Pilotage, Clients et crédits, Équipe,
// Plusieurs boutiques ; bouton « Suivant » en bas de chaque partie.
// Chaque promesse correspond à une fonction réelle de l'application (vérifié le 6 nov. 2026) ; captures du compte de
// démonstration (tests/e2e/landing-captures.js).

// Équipe d'exemple : les membres réels des boutiques de démonstration (noms fictifs créés pour la démo)
const DEMO_TEAM = [
  { initials: 'AN', name: 'Aïcha Ndiaye', role: 'owner', shop: null, color: 'var(--blue)' },
  { initials: 'JM', name: 'Jean-Paul Mbarga', role: 'shop_manager', shop: 'Akwa', color: 'var(--s-akwa)' },
  { initials: 'FB', name: 'Fatou Bello', role: 'cashier', shop: 'Akwa', color: 'var(--s-akwa)' },
  { initials: 'SE', name: 'Samuel Etoa', role: 'cashier', shop: 'Bonapriso', color: 'var(--s-bona)' },
  { initials: 'MS', name: 'Mariam Sow', role: 'stock_manager', shop: 'Bastos', color: 'var(--s-bastos)' },
] as const

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site.platform' })
  return {
    title: t('meta_title'),
    description: t('meta_desc'),
    alternates: { canonical: `/${locale}/plateforme`, languages: { fr: '/fr/plateforme', en: '/en/plateforme', ha: '/ha/plateforme' } },
  }
}

const Window = ({ src, alt }: { src: string; alt: string }) => (
  <div className="window">
    <div className="bar"><i /><i /><i /><span>stockshop.tech</span></div>
    <div className="shot"><Image src={src} alt={alt} fill sizes="(max-width: 900px) 92vw, 620px" /></div>
  </div>
)
const Phone = ({ src, alt }: { src: string; alt: string }) => (
  <div className="phone-wrap"><div className="phone"><div className="screen"><Image src={src} alt={alt} fill sizes="300px" /></div></div></div>
)

export default async function PlatformPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site.platform' })
  const tRoles = await getTranslations({ locale, namespace: 'roles' })
  const list = (k: string) => (
    <ul className="list">
      {[1, 2, 3].map(i => <li key={i}><b>{t(`${k}_l${i}_t`)}</b><span>{t(`${k}_l${i}_d`)}</span></li>)}
    </ul>
  )
  const copy = (k: string, color: string, icon: React.ReactNode) => (
    <div className="copy">
      <span className={`kicker k-${color}`}><span className={`ic ic-${color}`}>{icon}</span>{t(`${k}_kicker`)}</span>
      <h2>{t(`${k}_title`)}</h2>
      <p className="sub">{t(`${k}_sub`)}</p>
      {list(k)}
    </div>
  )

  // Onglets : Vente d'abord (la plupart des visiteurs ont une seule boutique), Plusieurs boutiques en dernier
  const tabs = [
    { id: 'vente', label: t('nav_sale'), content: (
      <section className="sec">
        <div className="wrap two narrow flip acc-green">
          {copy('sale', 'green', <IconCart />)}
          <Phone src="/landing/tel-pos.webp" alt={t('sale_img')} />
        </div>
      </section>
    ) },
    { id: 'stock', label: t('nav_stock'), content: (
      <section className="sec">
        <div className="wrap two acc-orange">
          {copy('stock', 'orange', <IconAlert />)}
          <Window src="/landing/pc-stock.webp" alt={t('stock_img')} />
        </div>
      </section>
    ) },
    { id: 'pilotage', label: t('nav_pilot'), content: (
      <section className="sec">
        <div className="wrap two flip acc-violet">
          {copy('pilot', 'violet', <IconChart />)}
          <Window src="/landing/pc-dashboard.webp" alt={t('pilot_img')} />
        </div>
      </section>
    ) },
    { id: 'clients', label: t('nav_clients'), content: (
      <section className="sec">
        <div className="wrap two narrow acc-blue">
          {copy('clients', 'blue', <IconShield />)}
          <Phone src="/landing/tel-credits.webp" alt={t('clients_img')} />
        </div>
      </section>
    ) },
    { id: 'equipe', label: t('nav_team'), content: (
      <section className="sec">
        <div className="wrap two flip acc-blue">
          {copy('team', 'blue', <IconKey />)}
          <div>
            <div className="panel" data-testid="platform-team-panel">
              <div className="panel-top"><span className="selector">{t('team_panel')}</span><small>{t('team_count', { count: DEMO_TEAM.length })}</small></div>
              {DEMO_TEAM.map(m => (
                <div className="member" key={m.name}>
                  <span className="av" style={{ background: m.color }}>{m.initials}</span>
                  <span><b>{m.name}</b><span>{tRoles(m.role)}</span></span>
                  <em>{m.shop ?? t('team_all')}</em>
                </div>
              ))}
            </div>
            <p className="fine">{t('team_fine')}</p>
          </div>
        </div>
      </section>
    ) },
    { id: 'multi', label: t('nav_multi'), content: <MultiShopsSection locale={locale} className="sec" /> },
  ]

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
      <PageTabs testid="platform" label={t('nav_label')} tabs={tabs.map((tab, i) => ({ ...tab, next: tabs[i + 1] ? t('next_tab', { name: tabs[i + 1].label }) : undefined }))} />

      <FinalCta locale={locale} showPlatform={false} />
    </>
  )
}
