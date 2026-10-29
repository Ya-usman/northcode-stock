'use client'

// Écran « Boutique fermée » (maquette validée le 29 oct. 2026) : horaires et heure de la boutique, prochaine ouverture,
// demande de prolongation (30 min, 1 h, 2 h) envoyée au propriétaire et aux personnes qui ont le droit « Prolonger »,
// ou prolongation directe pour ces dernières ; « Se déconnecter ». L'écran reste BLOQUANT : il disparaît seul quand la
// boutique rouvre (la boutique est diffusée en direct : prolongation accordée → mise à jour immédiate).
import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Clock, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils/cn'
import { shopClosedPhase } from '@/lib/saas/shop-hours'

interface ShopClosedWallProps {
  locale: string
  shopId?: string
  shopName?: string
  openingTime: string | null
  closingTime: string | null
  /** Fuseau de la boutique (shops.timezone) : l'heure affichée est celle de la boutique, comme la règle d'ouverture */
  timeZone?: string | null
  /** Fermée manuellement par le propriétaire (dérogation « fermée ») : ni réouverture annoncée, ni prolongation */
  manuallyClosed?: boolean
  hoursEnabled?: boolean | null
  extensionUntil?: string | null
  /** Droit « Prolonger » : prolongation directe au lieu d'une demande */
  canExtend?: boolean
  onSignOut?: () => void
  /** Après une prolongation accordée : relire la boutique (le mur disparaît) */
  onExtended?: () => void
}

interface MyRequest { id: string; minutes: number; status: 'pending' | 'approved' | 'refused' | 'cancelled' | 'expired'; created_at: string }

const DURATIONS = [30, 60, 120] as const

/** Heure locale de la boutique (fuseau invalide : heure de l'appareil) */
function formatClock(d: Date, locale: string, timeZone?: string | null): string {
  try { return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }) }
  catch { return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }
}

function formatTime(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return `${h}:${m}`
}

export function ShopClosedWall({
  locale, shopId, shopName, openingTime, closingTime, timeZone, manuallyClosed = false,
  hoursEnabled = true, extensionUntil = null, canExtend = false, onSignOut, onExtended,
}: ShopClosedWallProps) {
  const t = useTranslations('shop_hours')
  const { toast } = useToast()
  // Heure recalculée régulièrement : repère visible pour un employé bloqué
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const opening = formatTime(openingTime)
  const closing = formatTime(closingTime)
  const phase = shopClosedPhase(hoursEnabled, openingTime, closingTime, manuallyClosed ? 'closed' : null, extensionUntil, now, timeZone)
  const afterClose = phase === 'after_close'

  // Ma demande (dernières heures) : lue au serveur, rafraîchie toutes les 15 s tant que l'écran est affiché
  const [mine, setMine] = useState<MyRequest | null>(null)
  const [available, setAvailable] = useState(false)
  const load = useCallback(async () => {
    if (!shopId || !afterClose) return
    try {
      const res = await fetch(`/api/shops/extension-requests?shop_id=${shopId}`)
      if (!res.ok) return
      const j = await res.json()
      setAvailable(!!j.available)
      setMine(j.mine ?? null)
      if (j.mine?.status === 'approved') onExtended?.()
    } catch { /* hors connexion : l'écran reste tel quel */ }
  }, [shopId, afterClose]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
    const interval = setInterval(load, 15_000)
    return () => clearInterval(interval)
  }, [load])

  const [choosing, setChoosing] = useState(false)
  const [minutes, setMinutes] = useState<number>(60)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const post = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || res.statusText)
    return j
  }
  const submit = async () => {
    if (!shopId) return
    setBusy(true)
    try {
      if (canExtend) {
        const j = await post('/api/shops/extend-hours', 'POST', { shop_id: shopId, minutes })
        toast({ title: t('extended_toast', { time: formatClock(new Date(j.hours_extension_until), locale, timeZone) }), variant: 'success' })
        onExtended?.()
      } else {
        await post('/api/shops/extension-requests', 'POST', { shop_id: shopId, minutes, message: message.trim() || null })
        toast({ title: t('request_sent_toast'), variant: 'success' })
        await load()
      }
      setChoosing(false); setMessage('')
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally { setBusy(false) }
  }
  const cancelRequest = async () => {
    if (!shopId || !mine) return
    setBusy(true)
    try { await post('/api/shops/extension-requests', 'DELETE', { shop_id: shopId, id: mine.id }); await load() }
    catch (e: any) { toast({ title: e.message, variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  const pending = mine?.status === 'pending'
  const canAct = afterClose && (canExtend || available) && !pending
  const nextOpening = !manuallyClosed && opening
    ? t(phase === 'before_open' ? 'next_opening_today' : 'next_opening_tomorrow', { time: opening })
    : null
  const hint = manuallyClosed || !opening ? t('closed_hint_manual')
    : phase === 'before_open' ? t('before_open_hint', { time: opening })
    : canExtend ? t('need_more_direct') : t('need_more')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="alertdialog" aria-modal="true" aria-labelledby="shop-closed-title" aria-describedby="shop-closed-hint"
      data-testid="shop-closed-wall"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400">
            <Clock className="h-7 w-7" aria-hidden="true" />
          </div>
          <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {t('closed_status')}
          </span>
        </div>

        <h2 id="shop-closed-title" className="mt-4 text-2xl font-bold tracking-tight text-foreground">{t('closed_title')}</h2>
        <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
          {shopName ? t('closed_subtitle_shop', { shopName }) : t('closed_subtitle')}
        </p>

        <dl className="mt-5 divide-y divide-border rounded-xl bg-muted/60 px-4 text-sm">
          {opening && closing && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="text-muted-foreground">{t('closed_hours_label')}</dt>
              <dd className="font-semibold tabular-nums text-foreground" data-testid="shop-closed-hours">{t('closed_hours_value', { opening, closing })}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-3.5">
            <dt className="text-muted-foreground">{timeZone ? t('closed_now_label') : t('closed_now_device_label')}</dt>
            <dd className="font-semibold tabular-nums text-foreground" data-testid="shop-closed-time">{formatClock(now, locale, timeZone)}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t pt-5">
          {nextOpening && (
            <p className="flex items-center gap-2.5 text-base font-semibold text-stockshop-blue dark:text-blue-400" data-testid="shop-closed-next">
              <CalendarClock className="h-5 w-5 shrink-0" aria-hidden="true" />{nextOpening}
            </p>
          )}
          <p id="shop-closed-hint" className={cn('text-sm leading-relaxed text-muted-foreground', nextOpening && 'mt-2')}>{hint}</p>

          {/* Demande en attente / refusée / expirée */}
          {afterClose && mine && mine.status !== 'approved' && mine.status !== 'cancelled' && (
            <div className={cn('mt-4 rounded-xl border px-4 py-3 text-sm', pending ? 'border-stockshop-blue/20 bg-stockshop-blue-muted/60 dark:border-blue-900 dark:bg-blue-950/30' : 'border-border bg-muted/40')} data-testid="shop-closed-request" data-status={mine.status}>
              <p className="font-semibold text-foreground">
                {pending ? t('pending_title', { time: formatClock(new Date(mine.created_at), locale, timeZone) })
                  : mine.status === 'refused' ? t('refused_title') : t('expired_title')}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {pending ? t('pending_body') : mine.status === 'refused' ? t('refused_body') : t('expired_body')}
              </p>
            </div>
          )}

          {/* Choix de la durée (et message pour une demande) */}
          {choosing && (
            <div className="mt-4 space-y-3" data-testid="shop-closed-choose">
              <p className="text-sm font-medium text-foreground">{t('choose_duration')}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('choose_duration')}>
                {DURATIONS.map(d => (
                  <button key={d} type="button" role="radio" aria-checked={minutes === d} onClick={() => setMinutes(d)}
                    className={cn('h-11 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      minutes === d ? 'border-stockshop-blue bg-stockshop-blue-muted text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300' : 'border-input bg-background text-foreground hover:bg-accent')}
                    data-testid={`shop-closed-duration-${d}`}>
                    {t(`duration_${d}` as any)}
                  </button>
                ))}
              </div>
              {!canExtend && (
                <div className="space-y-1.5">
                  <label htmlFor="shop-closed-message" className="text-sm font-medium text-foreground">{t('message_label')}</label>
                  <textarea id="shop-closed-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={200} rows={2}
                    placeholder={t('message_placeholder')}
                    className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          {pending ? (
            <Button variant="outline" className="h-12 w-full rounded-xl text-base" onClick={cancelRequest} disabled={busy} data-testid="shop-closed-cancel-request">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('cancel_request')}
            </Button>
          ) : canAct && (choosing ? (
            <div className="space-y-1">
              <Button variant="stockshop" className="h-12 w-full rounded-xl text-base" onClick={submit} disabled={busy} data-testid="shop-closed-submit">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{canExtend ? t('extend_button') : t('send_request')}
              </Button>
              <Button variant="ghost" className="h-10 w-full rounded-xl text-sm text-muted-foreground" onClick={() => setChoosing(false)} disabled={busy}>{t('cancel')}</Button>
            </div>
          ) : (
            <Button variant="stockshop" className="h-12 w-full rounded-xl text-base" onClick={() => setChoosing(true)} data-testid="shop-closed-request-button">
              {canExtend ? t('extend_button') : t('request_button')}
            </Button>
          ))}
          {onSignOut && (
            <Button variant="outline" className="h-12 w-full rounded-xl border-stockshop-blue text-base text-stockshop-blue hover:bg-stockshop-blue-muted dark:border-blue-500 dark:text-blue-400 dark:hover:bg-blue-950/40"
              onClick={onSignOut} data-testid="shop-closed-signout">
              {t('sign_out')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
