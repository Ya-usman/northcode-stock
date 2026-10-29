'use client'

// Demandes de prolongation pour le propriétaire et les personnes qui ont le droit « Prolonger » (décisions du
// 29 oct. 2026), de TOUTES les boutiques où l'on peut accepter, quelle que soit la boutique active (chaque demande
// porte le nom et les horaires de sa boutique). Une seule source (ExtensionRequestsProvider, relue toutes les 30 s et
// au retour sur l'onglet) pour la carte en haut de page et la cloche de l'en-tête. La carte montre ce qu'il faut pour décider : qui, combien, pourquoi,
// la fermeture actuelle et la NOUVELLE fermeture, calculée comme la base (migration 186 : à partir de maintenant,
// plafond 23:59 à l'heure de la boutique), recalculée chaque minute ; le bouton dit exactement ce qui va se passer.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { effectiveCloseInstant, extensionsUsedToday, projectedExtensionEnd } from '@/lib/saas/shop-hours'
import { cn } from '@/lib/utils/cn'

export interface PendingRequest { id: string; minutes: number; message: string | null; created_at: string; requester_name: string | null }

/** Champs de la boutique utiles au calcul de la nouvelle fermeture */
export interface RequestShop {
  id: string
  name: string
  closing_time: string | null
  hours_extension_until: string | null
  timezone?: string | null
  /** Prolongations déjà utilisées aujourd'hui (limite de 2 par jour, comme la base) */
  extensionsUsed: number
}

/** Une demande en attente, avec SA boutique (toutes les boutiques où l'on peut accepter, pas seulement l'active) */
export interface InboxRequest extends PendingRequest { shop: RequestShop }

const DAILY_LIMIT = 2
// Personne qui peut accepter quelque part : relue toutes les 30 s ; sinon, simple vérification toutes les 10 min
const POLL_APPROVER_MS = 30_000
const POLL_OTHERS_MS = 10 * 60_000

interface Ctx {
  requests: InboxRequest[]
  /** Peut accepter dans au moins une boutique */
  approver: boolean
  busy: string | null
  decide: (id: string, approve: boolean) => Promise<void>
}
const RequestsContext = createContext<Ctx>({ requests: [], approver: false, busy: null, decide: async () => {} })
export const useExtensionRequests = () => useContext(RequestsContext)

export function ExtensionRequestsProvider({ enabled, onDecided, children }: {
  enabled: boolean
  /** Après une décision : relire la boutique active (prolongation en cours) */
  onDecided?: () => void
  children: React.ReactNode
}) {
  const t = useTranslations('shop_hours')
  const { toast } = useToast()
  const [requests, setRequests] = useState<InboxRequest[]>([])
  const [approver, setApprover] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) { setRequests([]); setApprover(false); return }
    try {
      const res = await fetch('/api/shops/extension-requests?scope=approver')
      if (!res.ok) return
      const j = await res.json()
      setApprover(!!j.approver)
      const shops: Record<string, any> = j.shops || {}
      const now = new Date()
      setRequests(j.available ? ((j.requests || []) as any[]).filter(r => shops[r.shop_id]).map(r => {
        const s = shops[r.shop_id]
        return { ...r, shop: { id: s.id, name: s.name, closing_time: s.closing_time, hours_extension_until: s.hours_extension_until, timezone: s.timezone, extensionsUsed: extensionsUsedToday(s, now) } }
      }) : [])
    } catch { /* hors connexion */ }
  }, [enabled])

  useEffect(() => {
    load()
    if (!enabled) return
    const interval = setInterval(load, approver ? POLL_APPROVER_MS : POLL_OTHERS_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [load, enabled, approver])

  const decide = useCallback(async (id: string, approve: boolean) => {
    setBusy(id)
    try {
      const res = await fetch('/api/shops/extension-requests/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, approve }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || res.statusText)
      toast({ title: approve ? t('requests_accepted_toast') : t('requests_refused_toast'), variant: 'success' })
      onDecided?.()
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setBusy(null)
      await load()
    }
  }, [load, onDecided, t, toast])

  return <RequestsContext.Provider value={{ requests, approver, busy, decide }}>{children}</RequestsContext.Provider>
}

/** Heure HH:MM à l'heure de la boutique */
export function shopTime(ms: number | string, timeZone?: string | null): string {
  const d = new Date(ms)
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: timeZone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  } catch {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  }
}

function initials(name: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Recalcule l'affichage chaque minute (la nouvelle fermeture part de maintenant) */
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 30_000)
    return () => clearInterval(id)
  }, [])
}

/** Ce que donnerait l'acceptation maintenant : nouvelle fermeture, ou la raison pour laquelle c'est impossible */
export function decisionPreview(shop: RequestShop, minutes: number, now = new Date()) {
  const close = effectiveCloseInstant(shop.closing_time, shop.hours_extension_until, now, shop.timezone)
  const projected = projectedExtensionEnd(shop.closing_time, shop.hours_extension_until, minutes, now, shop.timezone)
  const blocked: 'limit' | 'too_late' | null = shop.extensionsUsed >= DAILY_LIMIT ? 'limit' : projected ? null : 'too_late'
  return { close, closed: close !== null && close <= now.getTime(), projected, blocked }
}

/** Boutons Refuser / Accepter jusqu'à HH:MM, partagés par la carte et la cloche */
export function RequestActions({ request, compact = false }: { request: InboxRequest; compact?: boolean }) {
  const t = useTranslations('shop_hours')
  const { busy, decide } = useExtensionRequests()
  const { shop } = request
  const { projected, blocked } = decisionPreview(shop, request.minutes)
  const isBusy = busy === request.id
  const size = compact ? 'h-9 text-xs' : 'h-11'
  return (
    <div className="space-y-2">
      {blocked && (
        <p className="text-xs text-muted-foreground" data-testid="extension-request-blocked">
          {blocked === 'limit' ? t('requests_limit_reached') : t('requests_too_late')}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className={cn(size, 'flex-1 sm:flex-none sm:min-w-[7.5rem]')} onClick={() => decide(request.id, false)} disabled={isBusy} data-testid="extension-request-refuse">
          {t('requests_refuse')}
        </Button>
        {!blocked && projected && (
          <Button variant="stockshop" className={cn(size, 'flex-[2] sm:flex-none')} onClick={() => decide(request.id, true)} disabled={isBusy} data-testid="extension-request-accept">
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('requests_accept_until', { time: shopTime(projected.until, shop.timezone) })}
          </Button>
        )}
      </div>
    </div>
  )
}

function RequestCard({ request }: { request: InboxRequest }) {
  const t = useTranslations('shop_hours')
  const { shop } = request
  const preview = decisionPreview(shop, request.minutes)
  const { close, closed } = preview
  // Acceptation impossible (limite du jour, trop tard) : pas de « nouvelle fermeture » trompeuse
  const projected = preview.blocked ? null : preview.projected
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5" data-testid="extension-request">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-sm font-semibold text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400" aria-hidden="true">
            {initials(request.requester_name)}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-foreground">{request.requester_name || '?'}</p>
              <span className="rounded-full bg-stockshop-blue-muted px-2 py-0.5 text-xs font-semibold text-stockshop-blue tabular-nums dark:bg-blue-950/50 dark:text-blue-400">
                +{t(`duration_${request.minutes}` as any)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('requests_card_body', { shop: shop.name })}</p>
            {request.message && (
              <p className="break-words rounded-md bg-muted/60 px-2.5 py-1.5 text-sm text-foreground">« {request.message} »</p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {t('requests_requested_at', { time: shopTime(request.created_at, shop.timezone) })}
            </p>
          </div>
        </div>

        {close !== null && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 px-4 py-3 lg:w-56 lg:grid-cols-1 lg:gap-2" data-testid="extension-request-times">
            <div>
              <dt className="text-xs text-muted-foreground">{closed ? t('requests_closed_since') : t('requests_current_close')}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">{shopTime(close, shop.timezone)}</dd>
            </div>
            {projected && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('requests_new_close')}</dt>
              <dd className="text-base font-semibold tabular-nums text-stockshop-blue dark:text-blue-400">
                {shopTime(projected.until, shop.timezone)}
              </dd>
              {projected.capped && <dd className="text-xs text-muted-foreground">{t('requests_capped')}</dd>}
            </div>
            )}
          </dl>
        )}
      </div>
      <div className="mt-4 border-t pt-4">
        <RequestActions request={request} />
      </div>
    </div>
  )
}

/** Carte en haut de page : la plus ancienne demande, les autres sur demande */
export function ExtensionRequestsBanner() {
  const t = useTranslations('shop_hours')
  const { requests } = useExtensionRequests()
  const [showAll, setShowAll] = useState(false)
  useMinuteTick()
  if (!requests.length) return null
  const shown = showAll ? requests : requests.slice(0, 1)
  const others = requests.length - 1
  return (
    <div className="space-y-2 px-4 pt-4 sm:px-6 sm:pt-6" data-testid="extension-requests-banner">
      {shown.map(r => <RequestCard key={r.id} request={r} />)}
      {others > 0 && (
        <button type="button" onClick={() => setShowAll(v => !v)} className="text-sm font-medium text-stockshop-blue hover:underline dark:text-blue-400" data-testid="extension-requests-more">
          {showAll ? t('requests_show_less') : t('requests_more', { count: others })}
        </button>
      )}
    </div>
  )
}
