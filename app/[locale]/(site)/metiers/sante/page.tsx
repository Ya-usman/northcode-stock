import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server'
import { PageTabs } from '@/components/marketing/page-tabs'
import { FinalCta, getWaitlistLabels } from '@/components/marketing/sections'
import { WaitlistForm } from '@/components/marketing/waitlist-form'
import { IconArrow, IconChevron, IconFlask, IconHealth, IconPill, IconStore } from '@/components/marketing/icons'

// Page Santé (lot C du 6 nov. 2026, maquette validée) : module EN PRÉPARATION. Illustrations HTML sobres, toujours
// annoncées comme telles (noms fictifs), aucune capture inventée. Promesses retirées jusqu'à la V1 du module :
// assurances / part assurance (décision du 6 nov.). Même modèle que Plateforme : onglets (7 nov.), socle commun
// rappelé ; la liste d'attente du métier reste visible sous les onglets (« Me prévenir » y mène depuis chaque onglet).
export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'site.sante' })
  return {
    title: t('meta_title'), description: t('meta_desc'),
    alternates: { canonical: `/${locale}/metiers/sante`, languages: { fr: '/fr/metiers/sante', en: '/en/metiers/sante', ha: '/ha/metiers/sante' } },
  }
}

export default async function HealthPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'site.sante' })
  const tTrades = await getTranslations({ locale, namespace: 'site.trades_page' })
  const tPlatform = await getTranslations({ locale, namespace: 'site.platform' })
  const labels = await getWaitlistLabels(locale)
  const copy = (k: string, icon: React.ReactNode) => (
    <div className="copy">
      <span className="kicker k-sector"><span className="ic ic-sector">{icon}</span>{t(`nav_${k === 'pharmacy' ? 'pharmacy' : k === 'lab' ? 'lab' : 'clinic'}`)}</span>
      <h2>{t(`${k}_title`)}</h2>
      <p className="sub">{t(`${k}_sub`)}</p>
      <ul className="list">{[1, 2, 3].map(i => <li key={i}><b>{t(`${k}_l${i}_t`)}</b><span>{t(`${k}_l${i}_d`)}</span></li>)}</ul>
    </div>
  )
  const Row = ({ title, st, tone, note }: { title: string; st: string; tone?: 'go' | 'warn' | 'done'; note: string }) => (
    <div className="illus-row"><b>{title}</b><span className={`st${tone ? ` st-${tone}` : ''}`}>{st}</span><small>{note}</small></div>
  )
  const Illus = ({ title, meta, children, id }: { title: string; meta: string; children: React.ReactNode; id: string }) => (
    <div>
      <div className="illus" data-testid={`illus-${id}`} aria-label={t('illus')}>
        <div className="illus-top"><b>{title}</b><small>{meta}</small></div>
        {children}
      </div>
      <p className="illus-note">{t('illus')}</p>
    </div>
  )

  const tabs = [
    { id: 'clinique', label: t('nav_clinic'), content: (
      <section className="sec">
        <div className="wrap two acc-sector">
          {copy('clinic', <IconHealth />)}
          <Illus id="clinic" title={t('clinic_panel')} meta={t('clinic_meta', { count: 14 })}>
            <Row title="Aïcha N." st={t('st_consult')} tone="go" note={`${t('act_consult')} · Dr Mbarga`} />
            <Row title="Jean-Paul M." st={t('st_waiting')} tone="warn" note={`${t('act_dressing')} · ${t('room', { n: 2 })}`} />
            <Row title="Fatimé H." st={t('st_waiting')} tone="warn" note={`${t('act_echo')} · Dr Kouam`} />
            <Row title="Samuel E." st={t('st_paid')} tone="done" note={`${t('act_consult')} · 15 000 F CFA`} />
          </Illus>
        </div>
      </section>
    ) },
    { id: 'pharmacie', label: t('nav_pharmacy'), content: (
      <section className="sec">
        <div className="wrap two flip acc-sector">
          {copy('pharmacy', <IconPill />)}
          <Illus id="pharmacy" title={t('pharmacy_panel')} meta={t('pharmacy_meta')}>
            <Row title="Amoxicilline 500 mg" st={t('in_days', { days: 12 })} tone="warn" note={`Lot A2291 · ${t('boxes', { count: 48 })}`} />
            <Row title="Paracétamol 1 g" st={t('in_days', { days: 27 })} note={`Lot P0874 · ${t('boxes', { count: 120 })}`} />
            <Row title="Artéméther-luméfantrine" st={t('in_days', { days: 54 })} note={`Lot L5530 · ${t('boxes', { count: 36 })}`} />
            <Row title="Sérum physiologique" st={t('in_days', { days: 58 })} note={`Lot S1102 · ${t('units', { count: 200 })}`} />
          </Illus>
        </div>
      </section>
    ) },
    { id: 'laboratoire', label: t('nav_lab'), content: (
      <section className="sec">
        <div className="wrap two acc-sector">
          {copy('lab', <IconFlask />)}
          <Illus id="lab" title={t('lab_panel')} meta={t('lab_meta', { count: 23 })}>
            <Row title={`${t('ex_cbc')} · Aïcha N.`} st={t('st_analysis')} tone="warn" note={t('sampled_at', { time: '08:40' })} />
            <Row title={`${t('ex_glucose')} · Paul T.`} st={t('st_validate')} tone="go" note={t('sampled_at', { time: '09:05' })} />
            <Row title={`${t('ex_smear')} · Ruth B.`} st={t('st_sent')} tone="done" note={t('validated_by', { name: 'Dr Ndzié' })} />
            <Row title={`${t('ex_lipid')} · Ali S.`} st={t('st_registered')} note={t('awaiting_sample')} />
          </Illus>
        </div>
      </section>
    ) },
    { id: 'cabinets', label: t('nav_small'), content: (
      <section className="sec">
        <div className="wrap center">
          <span className="kicker k-sector">{t('small_kicker')}</span>
          <h2>{t('small_title')}</h2>
          <div className="duo">
            {(['office', 'center'] as const).map(k => (
              <div className="trade" key={k}>
                <div className="trade-head"><span className="ic ic-sector"><IconHealth /></span><h3>{t(`${k}_t`)}</h3></div>
                <p>{t(`${k}_d`)}</p>
                <ul>{[1, 2, 3].map(i => <li key={i}>{t(`${k}_l${i}`)}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    ) },
    { id: 'socle', label: t('nav_core'), content: (
      <section className="sec">
        <div className="wrap center">
          <span className="kicker"><span className="ic ic-blue"><IconStore /></span>{t('core_kicker')}</span>
          <h2>{t('core_title')}</h2>
          <ul className="core">
            {[1, 2, 3, 4, 5, 6].map(i => <li key={i}><b>{t(`c${i}_t`)}</b><span>{t(`c${i}_d`)}</span></li>)}
          </ul>
          <div className="highlight"><b>{t('duo_t')}</b><span>{t('duo_d')}</span></div>
          <Link className="center-link" href={`/${locale}/plateforme`}>{t('core_more')} <IconArrow /></Link>
        </div>
      </section>
    ) },
  ]

  return (
    <div className="sector-health">
      <section className="page-head sector-head">
        <div className="wrap">
          <span className="crumb"><Link href={`/${locale}/metiers`}>{t('crumb')}</Link><IconChevron /><span>{tTrades('health_t')}</span><span className="tag tag-next">{t('tag')}</span></span>
          <h1>{t('title')}</h1>
          <p className="lead">{t('lead')}</p>
          <div className="hero-actions" data-sticky-anchor>
            <a href="#liste" className="btn btn-cta" data-testid="health-notify">{t('cta_notify')}</a>
            <Link href={`/${locale}/plateforme`} className="btn btn-ghost">{t('cta_existing')}</Link>
          </div>
        </div>
      </section>
      <PageTabs testid="health" label={t('nav_label')} tabs={tabs.map((tab, i) => ({ ...tab, next: tabs[i + 1] ? tPlatform('next_tab', { name: tabs[i + 1].label }) : undefined }))} />

      <section className="sec" id="liste">
        <div className="wl-block">
          <div className="wrap">
            <span className="kicker k-sector">{t('wl_kicker')}</span>
            <h2>{t('wl_title')}</h2>
            <p className="sub">{t('wl_sub')}</p>
            <WaitlistForm locale={locale} labels={labels} fixedSector="health" />
            <p className="fine">{t('wl_price')}</p>
          </div>
        </div>
      </section>
      <FinalCta locale={locale} />
    </div>
  )
}
