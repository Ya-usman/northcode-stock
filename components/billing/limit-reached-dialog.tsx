'use client'

// « Limite atteinte » (tarification du 3 nov. 2026, étape 2 lot 2) : au moment où le client bloque (inviter, affecter
// ou réactiver un employé, créer une boutique), on propose l'option au lieu d'un simple refus. Fenêtre UNIQUE, montée
// une fois dans la mise en page ; ouverte par openLimitReached() (bouton déjà au plafond, ou refus du serveur
// code team_limit / shop_limit).
//   • propriétaire, formule payée en cours : « Ajouter un employé : 1 500 F par mois, aujourd'hui 900 F » → paiement,
//     puis retour sur la page de départ avec la saisie gardée (lib/billing/resume-after-payment) ;
//   • 3 boutiques en tout, ou 20 employés en plus : offre sur mesure ;
//   • moins de 3 jours avant le renouvellement : renouveler d'abord ;
//   • essai : choisir une formule ; formule terminée : renouveler ;
//   • gérant (pas le propriétaire) : « le propriétaire peut ajouter une place » (le serveur lui refuse les options).

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Store, Users } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useAuth } from '@/lib/hooks/use-auth'
import { formatCurrency } from '@/lib/utils/currency'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import { isPaidPlan, prorataQuote } from '@/lib/saas/addons'
import { saveResume, type ResumeDraft } from '@/lib/billing/resume-after-payment'
import type { AddonInfo } from '@/components/billing/addons-card'

type Kind = 'seats' | 'shops'
interface Request { kind: Kind; returnTo?: string; draft?: ResumeDraft }
const EVENT = 'stockshop:limit-reached'

/** Ouvre la fenêtre « Limite atteinte » (returnTo : chemin où revenir après paiement ; draft : saisie gardée) */
export function openLimitReached(req: Request) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: req }))
}

/** Refus du serveur pour la limite : ouvre la fenêtre et renvoie true */
export function handleLimitRefusal(r: { code?: string | null } | null | undefined, req: Omit<Request, 'kind'> = {}): boolean {
  const kind: Kind | null = r?.code === 'team_limit' ? 'seats' : r?.code === 'shop_limit' ? 'shops' : null
  if (!kind) return false
  openLimitReached({ kind, ...req })
  return true
}

const SUPPORT = 'support@stockshop.tech'

export function LimitReachedDialog() {
  const t = useTranslations('limit_reached')
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const { shop } = useAuth()
  const [req, setReq] = React.useState<Request | null>(null)
  const [info, setInfo] = React.useState<AddonInfo | null | 'not_owner'>(null)
  const [loading, setLoading] = React.useState(false)
  const [paying, setPaying] = React.useState(false)
  const { user } = useAuth()

  React.useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent).detail as Request)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  React.useEffect(() => {
    if (!req || !shop?.id) return
    let alive = true
    setLoading(true); setInfo(null)
    fetch(`/api/billing/addons?shop_id=${shop.id}`)
      .then(async res => { if (!alive) return; setInfo(res.status === 403 ? 'not_owner' : res.ok ? await res.json() : null) })
      .catch(() => { if (alive) setInfo(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [req, shop?.id])

  const close = () => { if (!paying) setReq(null) }
  const go = (path: string) => { setReq(null); window.setTimeout(() => router.push(`/${locale}${path}`), 350) }
  const kind = req?.kind ?? 'seats'
  const money = (n: number) => formatCurrency(n, (info && info !== 'not_owner' && info.currency) || 'XOF')
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'long' })

  // État à présenter
  let state: 'loading' | 'not_owner' | 'trial' | 'expired' | 'custom' | 'too_close' | 'offer' | 'error' = 'loading'
  let quote: ReturnType<typeof prorataQuote> = null
  if (!loading && req) {
    if (info === 'not_owner') state = 'not_owner'
    else if (!info) state = 'error'
    else if (!isPaidPlan(info.plan)) state = 'trial'
    else if (!info.active) state = 'expired'
    else {
      const paid = kind === 'seats' ? info.addons.seats : info.addons.shops
      const max = kind === 'seats' ? info.max.seats : info.max.shops
      if (paid >= max) state = 'custom'
      else {
        quote = prorataQuote({ prices: info.prices, seats: kind === 'seats' ? 1 : 0, shops: kind === 'shops' ? 1 : 0, planExpiresAt: info.plan_expires_at, billingPeriod: info.billing_period, currency: info.currency })
        state = quote ? 'offer' : 'too_close'
      }
    }
  }
  const planName = info && info !== 'not_owner' ? (info.plan === 'business' ? 'Business' : info.plan === 'pro' ? 'Pro' : info.plan === 'starter' ? 'Starter' : '') : ''
  const unit = info && info !== 'not_owner' ? (kind === 'seats' ? info.prices.seat : info.prices.shop) : 0

  const pay = async () => {
    if (!shop?.id || !user?.email || !req) return
    setPaying(true)
    try {
      const res = await fetch('/api/billing/addons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy', shop_id: shop.id, email: user.email, locale, seats: kind === 'seats' ? 1 : 0, shops: kind === 'shops' ? 1 : 0 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.authorization_url) { toast({ title: json.error || t('error'), variant: 'destructive' }); setPaying(false); return }
      saveResume(req.returnTo || window.location.pathname.replace(/^\/(fr|en|ha)(?=\/|$)/, '') + window.location.search, req.draft)
      window.location.href = json.authorization_url
    } catch { toast({ title: t('error'), variant: 'destructive' }); setPaying(false) }
  }

  const icon = kind === 'seats' ? <Users className="h-4 w-4" /> : <Store className="h-4 w-4" />
  const footer = () => {
    switch (state) {
      case 'offer': return <PremiumDialogFooter onCancel={() => go('/billing')} cancelLabel={t('see_plans')} onConfirm={pay} confirmLoading={paying} confirmLabel={t('add_and_pay', { amount: money(quote!.amount) })} />
      case 'trial': case 'expired': case 'too_close': return <PremiumDialogFooter onCancel={close} cancelLabel={t('close')} onConfirm={() => go('/billing')} confirmLabel={t(state === 'trial' ? 'choose_plan' : state === 'expired' ? 'renew' : 'see_subscription')} />
      case 'custom': return <PremiumDialogFooter onCancel={close} cancelLabel={t('close')} onConfirm={() => { window.location.href = `mailto:${SUPPORT}?subject=${encodeURIComponent(t('custom_mail_subject'))}` }} confirmLabel={t('contact_us')} />
      default: return <PremiumDialogFooter onCancel={close} cancelLabel={t('close')} />
    }
  }

  return (
    <PremiumDialog open={!!req} onOpenChange={o => { if (!o) close() }} title={t(`title_${kind}`)} icon={icon} centered testId="limit-reached-dialog">
      <PremiumDialogBody>
        <div className="space-y-2 text-sm text-foreground/80" data-testid="limit-reached-text" data-state={state}>
          {state === 'loading' && <p className="text-muted-foreground">{t('loading')}</p>}
          {state === 'offer' && quote && (
            <>
              <p>{t(`all_used_${kind}`, { plan: planName })}</p>
              <div className="space-y-1 rounded-xl border border-stockshop-blue/20 bg-stockshop-blue-muted px-4 py-3 dark:bg-blue-950/30">
                <p className="font-semibold text-foreground">{t(`add_one_${kind}`, { price: money(unit) })}</p>
                <p className="text-xs text-muted-foreground">{t('today', { amount: money(quote.amount), date: day(quote.until) })}</p>
              </div>
              <p className="text-xs text-muted-foreground">{t('resume_note')}</p>
            </>
          )}
          {state === 'custom' && <p>{t(kind === 'shops' ? 'custom_shops' : 'custom_seats')}</p>}
          {state === 'too_close' && <p>{t('too_close')}</p>}
          {state === 'trial' && <p>{t(`trial_${kind}`)}</p>}
          {state === 'expired' && <p>{t('expired')}</p>}
          {state === 'not_owner' && <p>{t(`not_owner_${kind}`)}</p>}
          {state === 'error' && <p>{t('error')}</p>}
        </div>
      </PremiumDialogBody>
      {footer()}
    </PremiumDialog>
  )
}
