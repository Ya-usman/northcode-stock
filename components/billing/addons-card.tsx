'use client'

// Options payantes sur la page Abonnement (tarification du 3 nov. 2026, étape 2 ; règle : lib/saas/addons).
// Le propriétaire ajoute des employés ou des boutiques à sa formule sans en changer : paiement au prorata des jours
// restants, puis renouvellement avec la formule. Retrait : au prochain renouvellement, sans remboursement.
// Montants affichés avec la MÊME fonction que le serveur (prorataQuote) ; le serveur recalcule et vérifie au paiement.

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Minus, Plus, Store, Users, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency } from '@/lib/utils/currency'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { prorataQuote, type AddonPrices } from '@/lib/saas/addons'
import type { BillingPeriod } from '@/lib/saas/countries'

export interface AddonInfo {
  plan: string
  active: boolean
  plan_expires_at: string | null
  billing_period: BillingPeriod
  currency: string
  prices: AddonPrices
  addons: { seats: number; shops: number; seats_renew: number; shops_renew: number }
  max: { seats: number; shops: number }
  min_days: number
  renewal: { monthly_addons: number; period_total: number } | null
  advice: { plan: 'pro' | 'business'; extraMonthly: number } | null
}

type Kind = 'seats' | 'shops'

export function AddonsCard({ info, shopId, email, onChanged }: { info: AddonInfo; shopId: string; email: string; onChanged: () => void }) {
  const t = useTranslations('addons')
  const locale = useLocale()
  const { toast } = useToast()
  const [buying, setBuying] = React.useState<Kind | null>(null)
  const [qty, setQty] = React.useState(1)
  const [paying, setPaying] = React.useState(false)
  const [removing, setRemoving] = React.useState<Kind | null>(null)
  const [saving, setSaving] = React.useState(false)
  const money = (n: number) => formatCurrency(n, info.currency)
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'long', year: 'numeric' }) : '')
  const until = day(info.plan_expires_at)

  if (!info.active) return null
  const rows: { kind: Kind; icon: React.ReactNode; paid: number; renew: number; max: number; price: number }[] = [
    { kind: 'seats', icon: <Users className="h-4 w-4" />, paid: info.addons.seats, renew: info.addons.seats_renew, max: info.max.seats, price: info.prices.seat },
    ...(info.max.shops > 0 || info.addons.shops > 0
      ? [{ kind: 'shops' as Kind, icon: <Store className="h-4 w-4" />, paid: info.addons.shops, renew: info.addons.shops_renew, max: info.max.shops, price: info.prices.shop }]
      : []),
  ]
  const quoteFor = (kind: Kind, n: number) => prorataQuote({
    prices: info.prices, seats: kind === 'seats' ? n : 0, shops: kind === 'shops' ? n : 0,
    planExpiresAt: info.plan_expires_at, billingPeriod: info.billing_period, currency: info.currency,
  })

  const openBuy = (kind: Kind) => { setQty(1); setBuying(kind) }
  const pay = async () => {
    if (!buying) return
    setPaying(true)
    try {
      const res = await fetch('/api/billing/addons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy', shop_id: shopId, email, locale, seats: buying === 'seats' ? qty : 0, shops: buying === 'shops' ? qty : 0 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.authorization_url) { toast({ title: json.error || t('error'), variant: 'destructive' }); setPaying(false); return }
      window.location.href = json.authorization_url
    } catch { toast({ title: t('error'), variant: 'destructive' }); setPaying(false) }
  }
  const setRenewal = async (kind: Kind, value: number) => {
    setSaving(true)
    try {
      const res = await fetch('/api/billing/addons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'renewal', shop_id: shopId,
          seats: kind === 'seats' ? value : info.addons.seats_renew, shops: kind === 'shops' ? value : info.addons.shops_renew,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      toast({ title: value < (kind === 'seats' ? info.addons.seats : info.addons.shops) ? t('removal_saved', { date: until }) : t('removal_cancelled'), variant: 'success' })
      setRemoving(null); onChanged()
    } finally { setSaving(false) }
  }

  const buyRow = buying ? rows.find(r => r.kind === buying) : null
  const room = buyRow ? Math.max(0, buyRow.max - buyRow.paid) : 0
  const quote = buyRow ? quoteFor(buyRow.kind, qty) : null

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" data-testid="addons-card">
      <h2 className="font-semibold">{t('title')}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('intro')}</p>
      <div className="mt-4 divide-y">
        {rows.map(r => (
          <div key={r.kind} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`addons-row-${r.kind}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950 dark:text-blue-300">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(`${r.kind}_label`)}</p>
              <p className="text-xs text-muted-foreground">{t(`${r.kind}_unit_price`, { price: money(r.price) })}</p>
              {r.renew < r.paid && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`addons-not-renewed-${r.kind}`}>
                  {t(`${r.kind}_not_renewed`, { count: r.paid - r.renew, date: until })}{' '}
                  <button type="button" className="font-medium underline-offset-2 hover:underline" disabled={saving} onClick={() => setRenewal(r.kind, r.paid)} data-testid={`addons-cancel-removal-${r.kind}`}>{t('cancel_removal')}</button>
                </p>
              )}
            </div>
            <p className="text-sm font-semibold tabular-nums" data-testid={`addons-paid-${r.kind}`}>{t(`${r.kind}_paid`, { count: r.paid })}</p>
            <div className="flex gap-2">
              {r.renew > 0 && (
                <Button variant="outline" className="h-11 gap-1.5" onClick={() => setRemoving(r.kind)} data-testid={`addons-remove-${r.kind}`}>
                  <Minus className="h-4 w-4" />{t('remove')}
                </Button>
              )}
              <Button variant="stockshop" className="h-11 gap-1.5" onClick={() => openBuy(r.kind)} disabled={r.paid >= r.max} data-testid={`addons-add-${r.kind}`}>
                <Plus className="h-4 w-4" />{t('add')}
              </Button>
            </div>
            {r.kind === 'shops' && r.paid >= r.max && <p className="basis-full text-xs text-muted-foreground">{t('shops_max_custom')}</p>}
            {r.kind === 'seats' && r.paid >= r.max && <p className="basis-full text-xs text-muted-foreground">{t('seats_max', { max: r.max })}</p>}
          </div>
        ))}
      </div>
      {info.renewal && info.renewal.monthly_addons > 0 && (
        <p className="mt-3 border-t pt-3 text-sm text-muted-foreground" data-testid="addons-renewal">{t('renewal_line', { amount: money(info.renewal.monthly_addons), date: until })}</p>
      )}
      {info.advice && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-stockshop-blue-muted px-3 py-2 text-sm text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300" data-testid="addons-advice">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
          {info.advice.extraMonthly > 0
            ? t('advice', { plan: info.advice.plan === 'pro' ? 'Pro' : 'Business', amount: money(info.advice.extraMonthly) })
            : t('advice_same', { plan: info.advice.plan === 'pro' ? 'Pro' : 'Business' })}
        </p>
      )}

      {/* Achat : quantité, montant du jour (prorata), puis le prix mensuel au renouvellement */}
      <PremiumDialog open={!!buyRow} onOpenChange={o => { if (!o && !paying) setBuying(null) }} title={buyRow ? t(`buy_title_${buyRow.kind}`) : ''} icon={buyRow?.icon} testId="addons-buy-dialog">
        {buyRow && (
          <>
            <PremiumDialogBody>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{t('quantity')}</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))} aria-label={t('less')}><Minus className="h-4 w-4" /></Button>
                  <span className="w-8 text-center text-lg font-semibold tabular-nums" data-testid="addons-qty">{qty}</span>
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={qty >= room} onClick={() => setQty(q => Math.min(room, q + 1))} aria-label={t('more')}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
              {quote ? (
                <div className="space-y-1 rounded-xl border border-stockshop-blue/20 bg-stockshop-blue-muted px-4 py-3 dark:bg-blue-950/30">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{t('pay_today')}</span>
                    <span className="text-2xl font-extrabold text-stockshop-blue dark:text-blue-400" data-testid="addons-amount">{money(quote.amount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('prorata_note', { days: quote.days, date: day(quote.until) })}</p>
                  <p className="text-xs text-muted-foreground">{t('then_monthly', { amount: money(qty * buyRow.price) })}</p>
                </div>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="addons-too-close">{t('too_close', { days: info.min_days })}</p>
              )}
              <p className="text-xs text-muted-foreground">{t('no_refund_note')}</p>
            </PremiumDialogBody>
            <PremiumDialogFooter
              onCancel={() => setBuying(null)}
              onConfirm={quote ? pay : undefined}
              confirmLabel={quote ? t('pay_btn', { amount: money(quote.amount) }) : undefined}
              confirmLoading={paying}
            />
          </>
        )}
      </PremiumDialog>

      {/* Retrait d'une unité au prochain renouvellement */}
      {removing && (() => {
        const r = rows.find(x => x.kind === removing)!
        return (
          <ConfirmModal
            open
            onOpenChange={o => { if (!o) setRemoving(null) }}
            title={t('remove_confirm_title')}
            description={t('remove_confirm_text', { date: until })}
            confirmLabel={t('remove_confirm_btn')}
            tone="warning"
            loading={saving}
            onConfirm={() => setRenewal(r.kind, Math.max(0, r.renew - 1))}
          />
        )
      })()}
    </section>
  )
}
