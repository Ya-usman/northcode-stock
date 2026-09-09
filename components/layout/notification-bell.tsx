'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient() as any

interface AdminNotification {
  id: string
  type: 'info' | 'warning' | 'urgent'
  title: string
  message: string
  read_at: string | null
  created_at: string
}

const TYPE_DOT: Record<AdminNotification['type'], string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
}

// Cloche de messages du support — réservée au owner (seul rôle autorisé à
// lire admin_notifications, voir migration 039) : un message concerne la
// boutique/le compte, pas une tâche d'un membre de l'équipe.
export function NotificationBell() {
  const { activeShop, roleInActiveShop } = useAuthContext()
  const { toast } = useToast()
  const [items, setItems] = useState<AdminNotification[]>([])
  const [open, setOpen] = useState(false)
  const shopIdRef = useRef<string | null>(null)

  const unreadCount = items.filter(n => !n.read_at).length

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
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }: any) => { if (!cancelled) setItems(data || []) })

    const channel = supabase
      .channel(`admin-notifs-${activeShop.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_notifications', filter: `shop_id=eq.${activeShop.id}` },
        (payload: any) => {
          const n = payload.new as AdminNotification
          setItems(prev => [n, ...prev])
          toast({
            title: n.type === 'urgent' ? `🔴 ${n.title}` : n.type === 'warning' ? `🟡 ${n.title}` : `🔵 ${n.title}`,
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

  if (roleInActiveShop !== 'owner') return null

  return (
    <DropdownMenu open={open} onOpenChange={v => { setOpen(v); if (v) markAllRead() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto p-0">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Messages du support</p>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">Aucun message pour l'instant.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map(n => (
              <div key={n.id} className="px-3 py-2.5 flex items-start gap-2.5">
                <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${TYPE_DOT[n.type]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
