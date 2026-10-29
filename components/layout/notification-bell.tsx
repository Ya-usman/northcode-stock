'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useLocale, useTranslations } from 'next-intl'
import { dateFnsLocale } from '@/lib/i18n/date-format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { RequestActions, shopTime, useExtensionRequests } from '@/components/saas/extension-requests-banner'

const supabase = createClient() as any

interface AdminNotification {
  id: string
  type: 'info' | 'warning' | 'urgent'
  title: string
  message: string
  read_at: string | null
  created_at: string
  /** Masqué par le propriétaire (migration 187) ; colonne absente tant que la 187 n'est pas appliquée */
  dismissed_at?: string | null
}

// Messages du support lus : gardés 30 jours après lecture, puis retirés de la cloche (toujours visibles côté admin)
const READ_KEPT_MS = 30 * 24 * 3_600_000

const TYPE_DOT: Record<AdminNotification['type'], string> = {
  info: 'bg-stockshop-blue dark:bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
}

// Centre de notifications de l'en-tête (29 oct. 2026) : demandes de prolongation en attente (propriétaire et droit
// « Prolonger », même source que la carte en haut de page) et messages du support (owner seulement : seul rôle
// autorisé à lire admin_notifications, voir migration 039). Un seul compteur pour les deux.
export function NotificationBell() {
  const locale = useLocale()
  const t = useTranslations('notification_center')
  const th = useTranslations('shop_hours')
  const requests = useExtensionRequests()
  const { activeShop, roleInActiveShop } = useAuthContext()
  const { toast } = useToast()
  const [items, setItems] = useState<AdminNotification[]>([])
  const [open, setOpen] = useState(false)
  const shopIdRef = useRef<string | null>(null)

  const pendingRequests = requests.requests
  const unreadCount = items.filter(n => !n.read_at).length + pendingRequests.length
  const isOwner = roleInActiveShop === 'owner'

  useEffect(() => {
    if (roleInActiveShop !== 'owner' || !activeShop?.id) {
      setItems([])
      return
    }
    shopIdRef.current = activeShop.id

    let cancelled = false
    supabase
      .from('admin_notifications')
      .select('*')
      .eq('shop_id', activeShop.id)
      // Message lu depuis plus de 30 jours : n'est plus affiché (décision du 29 oct. 2026) ; un message non lu reste
      .or(`read_at.is.null,read_at.gte.${new Date(Date.now() - READ_KEPT_MS).toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }: any) => { if (!cancelled) setItems(((data || []) as AdminNotification[]).filter(n => !n.dismissed_at)) })

    const channel = supabase
      .channel(`admin-notifs-${activeShop.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_notifications', filter: `shop_id=eq.${activeShop.id}` },
        (payload: any) => {
          const n = payload.new as AdminNotification
          setItems(prev => [n, ...prev])
          toast({
            title: n.title,
            description: n.message,
            variant: n.type === 'urgent' ? 'destructive' : 'default',
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [activeShop?.id, roleInActiveShop])

  const markAllRead = () => {
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, read_at: now } : n))
    supabase.from('admin_notifications').update({ read_at: now }).in('id', unreadIds).then(() => {})
  }

  // « × » : masque le message (et le compte comme lu). Proposé seulement quand la colonne existe (migration 187)
  const dismiss = (n: AdminNotification) => {
    const now = new Date().toISOString()
    setItems(prev => prev.filter(x => x.id !== n.id))
    supabase.from('admin_notifications').update({ dismissed_at: now, read_at: n.read_at ?? now }).eq('id', n.id)
      .then(({ error }: any) => { if (error) setItems(prev => [n, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at))) })
  }

  if (!isOwner && !requests.approver && !pendingRequests.length) return null

  return (
    <DropdownMenu open={open} onOpenChange={v => { setOpen(v); if (v) markAllRead() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('aria')} className="relative h-8 w-8 text-muted-foreground hover:text-foreground" data-testid="notification-bell">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-card" data-testid="notification-bell-count">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] max-h-[70vh] overflow-y-auto p-0" data-testid="notification-center">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">{t('title')}</p>
        </div>
        {pendingRequests.length === 0 && items.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t('empty')}</p>
        )}
        {pendingRequests.length > 0 && (
          <section>
            <p className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('section_requests')}</p>
            <div className="divide-y divide-border/50">
              {pendingRequests.map(r => (
                <div key={r.id} className="space-y-2 px-4 py-3" data-testid="notification-request">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{r.requester_name || '?'}</span>{' '}
                      <span className="text-muted-foreground">{th('requests_card_body', { shop: r.shop.name })}</span>
                    </p>
                    <span className="shrink-0 rounded-full bg-stockshop-blue-muted px-2 py-0.5 text-xs font-semibold text-stockshop-blue tabular-nums dark:bg-blue-950/50 dark:text-blue-400">
                      +{th(`duration_${r.minutes}` as any)}
                    </span>
                  </div>
                  {r.message && <p className="break-words text-xs text-muted-foreground">« {r.message} »</p>}
                  <p className="text-[11px] text-muted-foreground/80">{th('requests_requested_at', { time: shopTime(r.created_at, r.shop.timezone) })}</p>
                  <RequestActions request={r} compact />
                </div>
              ))}
            </div>
          </section>
        )}
        {isOwner && items.length > 0 && (
          <section className={pendingRequests.length > 0 ? 'border-t border-border' : ''}>
            <p className="px-4 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('section_support')}</p>
            <div className="divide-y divide-border/50">
              {items.map(n => (
                <div key={n.id} className="px-4 py-2.5 flex items-start gap-2.5" data-testid="notification-support">
                  <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${TYPE_DOT[n.type]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: dateFnsLocale(locale) })}
                    </p>
                  </div>
                  {'dismissed_at' in n && (
                    <button
                      type="button"
                      onClick={() => dismiss(n)}
                      aria-label={t('dismiss')}
                      title={t('dismiss')}
                      className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="notification-dismiss"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
