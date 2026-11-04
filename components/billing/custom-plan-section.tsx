'use client'

// Offre sur mesure sur la page Abonnement (tarification du 3-4 nov. 2026, étape 3 ; règle : lib/saas/custom-plan).
//   • carte « Sur mesure » (à partir de 4 boutiques) et bouton « Demander un devis » ;
//   • état de la dernière demande : envoyée, devis reçu (lien vers la page du devis), expirée, refusée ;
//   • offre sur mesure en cours : limites, prix, garantie, « Renouveler » (page du devis, même prix) ;
//   • formulaire court de demande (boutiques, employés, durée, besoins, téléphone WhatsApp).
// Propriétaire seulement (le serveur refuse les autres). Ouvrable depuis l'extérieur : ?custom=1 dans l'adresse.

import * as React from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Building2, CheckCircle2, Clock, Minus, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormDrawer } from '@/components/ui/form-drawer'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency } from '@/lib/utils/currency'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { CUSTOM_MIN_SHOPS, needsCustom } from '@/lib/saas/custom-plan'

interface Quote {
  id: string; state: 'requested' | 'quoted' | 'paid' | 'declined' | 'expired' | 'cancelled'
  req_shops: number; req_seats: number; currency: string | null; monthly_price: number | null
  limit_shops: number | null; limit_seats: number | null; decline_reason: string | null
  valid_until: string | null; price_until: string | null; token: string | null; created_at: string
}

export function CustomPlanSection({ shopId, phone }: { shopId: string; phone?: string | null }) {
  const t = useTranslations('custom_quote')
  const tP = useTranslations('billing_page')
  const locale = useLocale()
  const { toast } = useToast()
  const [data, setData] = React.useState<{ quotes: Quote[]; current: string | null } | null>(null)
  const [open, setOpen] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({ shops: CUSTOM_MIN_SHOPS, seats: 10, period: 'annual' as 'monthly' | 'semiannual' | 'annual', needs: '', phone: phone || '' })

  const [forbidden, setForbidden] = React.useState(false)
  const load = React.useCallback(() => {
    fetch(`/api/billing/custom?shop_id=${shopId}`).then(async r => { if (r.status === 403) setForbidden(true); else if (r.ok) setData(await r.json()) }).catch(() => {})
  }, [shopId])
  React.useEffect(() => { load() }, [load])
  // Ouverture demandée par une autre page (fenêtre « Limite atteinte ») : ?custom=1
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('custom') !== '1') return
    window.history.replaceState(window.history.state, '', window.location.pathname)
    setOpen(true)
  }, [])

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'long', year: 'numeric' }) : '')
  const money = (q: Quote) => (q.monthly_price && q.currency ? formatCurrency(Number(q.monthly_price), q.currency) : '')
  const latest = data?.quotes[0] ?? null
  const current = data?.current ? data.quotes.find(q => q.id === data.current) ?? null : null
  const tooSmall = !needsCustom(form.shops, form.seats)

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/billing/custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, shops: form.shops, seats: form.seats, period: form.period, needs: form.needs.trim() || null, phone: form.phone.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || t('q_not_payable')); return }
      setSent(true); load()
    } catch { toast({ title: t('q_not_payable'), variant: 'destructive' }) } finally { setSaving(false) }
  }
  const stepper = (key: 'shops' | 'seats', min: number, max: number) => (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={form[key] <= min} onClick={() => setForm(f => ({ ...f, [key]: Math.max(min, f[key] - 1) }))} aria-label="-"><Minus className="h-4 w-4" /></Button>
      <Input type="number" inputMode="numeric" value={form[key]} min={min} max={max} className="h-11 w-20 text-center tabular-nums" data-testid={`custom-${key}`}
        onChange={e => { const n = Math.floor(Number(e.target.value)); setForm(f => ({ ...f, [key]: Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min })) }} />
      <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={form[key] >= max} onClick={() => setForm(f => ({ ...f, [key]: Math.min(max, f[key] + 1) }))} aria-label="+"><Plus className="h-4 w-4" /></Button>
    </div>
  )

  // Pas le propriétaire : rien à demander ici
  if (forbidden) return null
  return (
    <section className="rounded-xl border-2 border-dashed border-stockshop-blue/30 bg-card p-5 shadow-sm dark:border-blue-400/30" data-testid="custom-plan-section">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950 dark:text-blue-300"><Building2 className="h-5 w-5" /></span>
          <div>
            <p className="font-semibold">{t('card_title')} <span className="ml-1 text-sm font-normal text-muted-foreground">· {t('card_tagline')}</span></p>
            <p className="text-sm text-muted-foreground">{t('card_price')}</p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(['card_f1', 'card_f2', 'card_f3'] as const).map(k => <li key={k} className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{t(k)}</li>)}
            </ul>
          </div>
        </div>
        {/* Une seule demande ouverte à la fois : pas de bouton pendant une demande ou un devis en cours */}
        {!current && !(latest && (latest.state === 'requested' || latest.state === 'quoted')) && (
          <Button variant="stockshop" className="h-11 gap-2" onClick={() => { setSent(false); setError(null); setOpen(true) }} data-testid="custom-request-open">
            <Sparkles className="h-4 w-4" />{t('card_cta')}
          </Button>
        )}
      </div>

      {/* Offre en cours, ou état de la dernière demande */}
      {current ? (
        <div className="mt-4 rounded-lg bg-stockshop-blue-muted px-4 py-3 text-sm text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300" data-testid="custom-current">
          <p className="font-semibold">{t('current_title')}</p>
          <p>{t('current_body', { shops: current.limit_shops ?? 0, seats: current.limit_seats ?? 0, monthly: money(current), date: day(current.price_until) })}</p>
          {current.token && <Link href={`/${locale}/billing/quote/${current.token}`} className="mt-1 inline-block font-semibold underline-offset-2 hover:underline">{t('renew')}</Link>}
        </div>
      ) : latest && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm" data-testid="custom-status" data-state={latest.state}>
          <Clock className="h-4 w-4 text-muted-foreground" />
          {latest.state === 'requested' && <span>{t('status_requested', { date: day(latest.created_at) })}</span>}
          {latest.state === 'quoted' && <>
            <span>{t('status_quoted', { monthly: money(latest), date: day(latest.valid_until) })}</span>
            {latest.token && <Link href={`/${locale}/billing/quote/${latest.token}`} className="font-semibold text-stockshop-blue underline-offset-2 hover:underline dark:text-blue-400" data-testid="custom-see-quote">{t('see_quote')}</Link>}
          </>}
          {latest.state === 'expired' && <span>{t('status_expired', { date: day(latest.valid_until) })} <a href="mailto:support@stockshop.tech" className="font-semibold text-stockshop-blue underline-offset-2 hover:underline dark:text-blue-400">{t('contact')}</a></span>}
          {latest.state === 'declined' && <span>{t('status_declined', { reason: latest.decline_reason || '' })}</span>}
        </div>
      )}

      <FormDrawer
        open={open}
        onOpenChange={o => { if (!saving) setOpen(o) }}
        title={t('form_title')}
        description={t('form_intro')}
        icon={<Building2 className="h-4 w-4" />}
        onSubmit={sent ? undefined : submit}
        submitting={saving}
        submitLabel={t('send')}
        submitDisabled={tooSmall}
        error={error}
        testId="custom-request-drawer"
      >
        {sent ? (
          <div className="space-y-2 py-6 text-center" data-testid="custom-request-sent">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <p className="text-lg font-semibold">{t('sent_title')}</p>
            <p className="text-sm text-muted-foreground">{t('sent_body')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3"><Label>{t('shops')}</Label>{stepper('shops', 1, 200)}</div>
            <div className="flex items-center justify-between gap-3"><Label>{t('seats')}</Label>{stepper('seats', 0, 2000)}</div>
            {tooSmall && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" data-testid="custom-too-small">{t('min_hint')}</p>}
            <div className="space-y-1.5">
              <Label>{t('period')}</Label>
              <SegmentedTabs value={form.period} onChange={v => setForm(f => ({ ...f, period: v as typeof f.period }))} testId="custom-period"
                items={(['monthly', 'semiannual', 'annual'] as const).map(p => ({ key: p, label: tP(`period_${p}`) }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-needs">{t('needs')}</Label>
              <Textarea id="custom-needs" rows={3} maxLength={1000} value={form.needs} placeholder={t('needs_ph')} onChange={e => setForm(f => ({ ...f, needs: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-phone">{t('phone')}</Label>
              <Input id="custom-phone" type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-11" />
            </div>
          </div>
        )}
      </FormDrawer>
    </section>
  )
}
