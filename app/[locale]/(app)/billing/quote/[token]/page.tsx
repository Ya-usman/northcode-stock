'use client'

// Page d'un devis sur mesure (lien envoyé par e-mail, 4 nov. 2026 ; règle : lib/saas/custom-plan). Propriétaire de
// l'entreprise du devis seulement (le serveur répond « introuvable » à tout autre compte). Paiement : le montant est lu
// par le serveur dans le devis, jamais envoyé par cette page.

import * as React from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Building2, CheckCircle2, Clock, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { formatCurrency } from '@/lib/utils/currency'
import { dateLocaleTag } from '@/lib/i18n/date-format'

interface Data {
  quote: {
    state: string; monthly_price: number; billing_period: 'monthly' | 'semiannual' | 'annual'; period_total: number; currency: string
    limit_shops: number; limit_seats: number; client_note: string | null; valid_until: string | null; price_until: string | null
  }
  entity: { name: string | null }
  payable: 'first' | 'renewal' | null
}

export default function QuotePage({ params: { token } }: { params: { token: string } }) {
  const t = useTranslations('custom_quote')
  const tP = useTranslations('billing_page')
  const locale = useLocale()
  const { toast } = useToast()
  const { user } = useAuth()
  const [data, setData] = React.useState<Data | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [paying, setPaying] = React.useState(false)

  React.useEffect(() => {
    fetch(`/api/billing/custom/quote?token=${encodeURIComponent(token)}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (r.ok) setData(j); else setError(j.error || t('q_not_payable')) })
      .catch(() => setError(t('q_not_payable')))
  }, [token, t])

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'long', year: 'numeric' }) : '')
  const pay = async () => {
    if (!user?.email) return
    setPaying(true)
    try {
      const res = await fetch('/api/billing/custom/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: user.email, locale }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.authorization_url) { toast({ title: json.error || t('q_not_payable'), variant: 'destructive' }); setPaying(false); return }
      window.location.href = json.authorization_url
    } catch { toast({ title: t('q_not_payable'), variant: 'destructive' }); setPaying(false) }
  }

  const q = data?.quote
  const money = (n: number) => (q ? formatCurrency(Number(n), q.currency) : '')
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader scope="entity" title={data?.payable === 'renewal' ? t('q_renew_title') : t('page_title')} description={data?.entity.name || undefined} />
      {error ? (
        <div className="rounded-xl border bg-card p-5 text-sm" data-testid="quote-error">
          <p>{error}</p>
          <Link href={`/${locale}/billing`} className="mt-3 inline-block font-semibold text-stockshop-blue hover:underline dark:text-blue-400">{t('back')}</Link>
        </div>
      ) : !q ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" data-testid="quote-card" data-state={q.state}>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950 dark:text-blue-300"><Building2 className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold">{t('q_plan')}</p>
              <p className="text-sm text-muted-foreground" data-testid="quote-limits">{t('q_limits', { shops: q.limit_shops, seats: q.limit_seats })}</p>
            </div>
          </div>
          <dl className="divide-y rounded-lg border text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted-foreground">{t('q_monthly')}</dt><dd className="font-medium tabular-nums">{money(q.monthly_price)}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted-foreground">{t('q_period')}</dt><dd className="font-medium">{tP(`period_${q.billing_period}`)}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="font-semibold">{t('q_total')}</dt><dd className="text-lg font-extrabold text-stockshop-blue tabular-nums dark:text-blue-400" data-testid="quote-total">{money(q.period_total)}</dd></div>
          </dl>
          {q.client_note && (
            <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('q_note')}</p><p className="whitespace-pre-line">{q.client_note}</p></div>
          )}
          {data.payable === 'first' && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />{t('q_valid', { date: day(q.valid_until) })} · {t('q_guarantee')}</p>}
          {data.payable === 'renewal' && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{t('q_renew_note', { date: day(q.price_until) })}</p>}
          {!data.payable && q.state === 'expired' && <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="quote-expired">{t('q_expired', { date: day(q.valid_until) })} <a href="mailto:support@stockshop.tech" className="font-semibold underline">{t('contact')}</a></p>}
          {!data.payable && q.state === 'paid' && <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />{t('q_paid')}</p>}
          {!data.payable && !['expired', 'paid'].includes(q.state) && <p className="text-sm text-muted-foreground">{t('q_not_payable')}</p>}
          {data.payable && (
            <Button variant="stockshop" className="h-12 w-full text-base font-semibold" onClick={pay} loading={paying} data-testid="quote-pay">
              {t('q_pay', { amount: money(q.period_total) })}
            </Button>
          )}
          <Link href={`/${locale}/billing`} className="block text-center text-sm text-muted-foreground hover:underline">{t('back')}</Link>
        </section>
      )}
    </div>
  )
}
