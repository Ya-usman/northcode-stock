'use client'

import { Fragment, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, MessageCircle, Mail, BookOpen, HelpCircle, List } from 'lucide-react'
import Image from 'next/image'
import { PageHeader } from '@/components/layout/page-header'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { HelpTours } from '@/components/onboarding/help-tours'
import { cn } from '@/lib/utils/cn'

// Page Aide (refaite le 31 oct. 2026) : questions fréquentes et manuel illustré, TRADUITS (messages « help_page »)
// avec des captures prises dans chaque langue (public/manual/<langue>/<écran>.png, téléphone, compte vitrine).
// À refaire quand l'application sera terminée et toutes les vues à jour (consigne de l'utilisateur).

interface FaqGroup { title: string; items: { q: string; a: string }[] }
interface Callout { type?: 'info' | 'warning' | 'success'; text: string }
interface ManualBlock { image: string; title: string; tips: string[]; callouts?: Callout[] }
interface ManualSection { id: string; title: string; blocks: ManualBlock[] }

const MANUAL_LOCALES = ['fr', 'en', 'ha']

/** « **gras** » → <strong>, sans HTML injecté (textes des fichiers de langue) */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-foreground">{p}</strong> : <Fragment key={i}>{p}</Fragment>))}</>
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:text-stockshop-blue dark:hover:text-blue-400"
        data-testid="help-faq-question"
      >
        <span>{q}</span>
        {open
          ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-stockshop-blue dark:text-blue-400" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      </button>
      {open && <p className="pb-3 text-sm leading-relaxed text-muted-foreground"><Rich text={a} /></p>}
    </div>
  )
}

function CalloutBox({ type = 'info', text }: Callout) {
  const cls = {
    info: 'bg-stockshop-blue-muted dark:bg-blue-950/40 border-stockshop-blue dark:border-blue-500 text-stockshop-blue dark:text-blue-300',
    warning: 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-800 dark:text-amber-300',
    success: 'bg-green-50 dark:bg-green-950/40 border-green-500 text-green-800 dark:text-green-300',
  }[type]
  return <div className={cn('mt-3 rounded-r-lg border-l-4 px-3 py-2 text-xs leading-relaxed', cls)}>{text}</div>
}

function ScreenRow({ block, reverse, imgLocale }: { block: ManualBlock; reverse: boolean; imgLocale: string }) {
  return (
    <div className={cn('flex items-start gap-5 max-sm:flex-col', reverse ? 'flex-row-reverse' : 'flex-row')} data-testid="help-manual-block">
      <div className="w-[240px] shrink-0 max-sm:mx-auto max-sm:w-[78%]">
        <Image
          src={`/manual/${imgLocale}/${block.image}.png`}
          alt={block.title}
          width={390}
          height={844}
          className="w-full rounded-2xl border-4 border-border object-cover shadow-lg"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-2 text-[15px] font-semibold text-stockshop-blue dark:text-blue-400">{block.title}</h3>
        <ul className="space-y-1.5 text-sm text-foreground/80">
          {block.tips.map((tip, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 font-bold text-stockshop-blue dark:text-blue-400" aria-hidden="true">•</span>
              <span><Rich text={tip} /></span>
            </li>
          ))}
        </ul>
        {block.callouts?.map((c, i) => <CalloutBox key={i} {...c} />)}
      </div>
    </div>
  )
}

function ManualContent({ sections, toc, imgLocale }: { sections: ManualSection[]; toc: string; imgLocale: string }) {
  let blockIndex = 0
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <List className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stockshop-blue dark:text-blue-400">{toc}</h2>
        </div>
        <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#help-${s.id}`} className="text-sm font-medium text-stockshop-blue hover:underline dark:text-blue-400">{i + 1}. {s.title}</a>
            </li>
          ))}
        </ol>
      </div>
      {sections.map((section, i) => (
        <div key={section.id} id={`help-${section.id}`} className="scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 bg-stockshop-blue px-5 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">{i + 1}</span>
            <h2 className="text-[15px] font-bold text-white">{section.title}</h2>
          </div>
          <div className="space-y-8 p-5 sm:p-8">
            {section.blocks.map((block, j) => (
              <div key={j}>
                {j > 0 && <hr className="mb-6 border-border" />}
                <ScreenRow block={block} reverse={blockIndex++ % 2 === 1} imgLocale={imgLocale} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HelpPage() {
  const tPage = useTranslations('page_header')
  const t = useTranslations('help_page')
  const locale = useLocale()
  const imgLocale = MANUAL_LOCALES.includes(locale) ? locale : 'en'
  const [tab, setTab] = useState<'faq' | 'manual'>('faq')
  const faq = t.raw('faq') as FaqGroup[]
  const manual = t.raw('manual') as ManualSection[]

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Tours guidés et guide « Bien démarrer » */}
      <HelpTours />
      <PageHeader scope="entity" title={tPage('help_title')} description={tPage('help')} />
      <SegmentedTabs fill value={tab} onChange={v => setTab(v as typeof tab)} testId="help-tabs" items={[
        { key: 'faq', label: t('tab_faq'), icon: HelpCircle },
        { key: 'manual', label: t('tab_manual'), icon: BookOpen },
      ]} />

      {tab === 'faq' && (
        <>
          {faq.map(group => (
            <div key={group.title} className="rounded-xl border bg-card p-5 shadow-sm" data-testid="help-faq-group">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stockshop-blue dark:text-blue-400">{group.title}</h2>
              <div>{group.items.map(item => <FAQItem key={item.q} {...item} />)}</div>
            </div>
          ))}
          <div className="rounded-xl border bg-stockshop-blue p-5 text-white shadow-sm">
            <h2 className="mb-1 font-semibold">{t('contact_title')}</h2>
            <p className="mb-4 text-sm text-blue-100">{t('contact_body')}</p>
            <div className="flex flex-wrap gap-3">
              {/* Numéro WhatsApp du support : adresse provisoire tant que le numéro n'est pas fourni */}
              <a href="https://wa.me/message/stockshop" className="flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-stockshop-blue transition-colors hover:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40">
                <MessageCircle className="h-4 w-4" />WhatsApp
              </a>
              <a href="mailto:support@stockshop.tech" className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20">
                <Mail className="h-4 w-4" />support@stockshop.tech
              </a>
            </div>
          </div>
        </>
      )}

      {tab === 'manual' && <ManualContent sections={manual} toc={t('toc')} imgLocale={imgLocale} />}
    </div>
  )
}
