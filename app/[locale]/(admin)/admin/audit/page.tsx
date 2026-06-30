'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScrollText, Search, RefreshCw, ShieldOff, ShieldCheck, CreditCard, Trash2, UserPlus, Pencil, RotateCcw, Bell, StickyNote, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

const supabase = createClient() as any

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  'admin.suspend_shop':    { label: 'Suspension',        color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',     icon: ShieldOff },
  'admin.reactivate_shop': { label: 'Réactivation',      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: ShieldCheck },
  'admin.extend_access':   { label: 'Extension accès',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',  icon: CreditCard },
  'admin.grant_plan':      { label: 'Plan accordé',      color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', icon: CreditCard },
  'admin.edit_shop':       { label: 'Modif. boutique',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: Pencil },
  'admin.restore_product': { label: 'Produit restauré',  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: RotateCcw },
  'admin.restore_customer':{ label: 'Client restauré',   color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: RotateCcw },
  'member.invite':         { label: 'Invitation',        color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',     icon: UserPlus },
  'member.delete':         { label: 'Membre supprimé',   color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',     icon: Trash2 },
  'admin.notify':          { label: 'Notification',      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: Bell },
  'admin.note':            { label: 'Note interne',      color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',   icon: StickyNote },
}

const ACTION_FILTERS = [
  { value: '', label: 'Toutes les actions' },
  { value: 'admin.suspend_shop', label: 'Suspensions' },
  { value: 'admin.reactivate_shop', label: 'Réactivations' },
  { value: 'admin.grant_plan,admin.extend_access', label: 'Plans / Accès' },
  { value: 'member.invite,member.delete', label: 'Équipe' },
  { value: 'admin.restore_product,admin.restore_customer', label: 'Restaurations' },
]

interface AuditLog {
  id: string
  action: string
  actor_email: string | null
  target_type: string | null
  metadata: Record<string, any> | null
  ip: string | null
  created_at: string
  shop_id: string | null
  shops?: { name: string } | null
}

const PAGE_SIZE = 30

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLogs = useCallback(async (reset = false) => {
    if (reset) setPage(0)
    const currentPage = reset ? 0 : page
    setLoading(true)

    let query = supabase
      .from('audit_logs')
      .select('id, action, actor_email, target_type, metadata, ip, created_at, shop_id, shops(name)')
      .order('created_at', { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)

    if (actionFilter) {
      const actions = actionFilter.split(',')
      query = actions.length === 1
        ? query.eq('action', actions[0])
        : query.in('action', actions)
    }

    const { data, error } = await query
    if (!error) {
      const entries = (data || []) as AuditLog[]
      setLogs(prev => reset ? entries : [...prev, ...entries])
      setHasMore(entries.length === PAGE_SIZE)
    }
    setLoading(false)
    setRefreshing(false)
  }, [page, actionFilter])

  useEffect(() => { fetchLogs(true) }, [actionFilter])

  const refresh = () => {
    setRefreshing(true)
    fetchLogs(true)
  }

  const filteredLogs = search.trim()
    ? logs.filter(l =>
        l.actor_email?.toLowerCase().includes(search.toLowerCase()) ||
        l.shops?.name?.toLowerCase().includes(search.toLowerCase()) ||
        l.action.toLowerCase().includes(search.toLowerCase()) ||
        JSON.stringify(l.metadata || {}).toLowerCase().includes(search.toLowerCase())
      )
    : logs

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    fetchLogs()
  }

  const renderMetadata = (log: AuditLog) => {
    const m = log.metadata
    if (!m) return null
    const parts: string[] = []
    if (m.days) parts.push(`+${m.days}j`)
    if (m.plan) parts.push(`Plan: ${m.plan}`)
    if (m.role) parts.push(`Rôle: ${m.role}`)
    if (m.email) parts.push(m.email)
    if (m.name) parts.push(m.name)
    if (m.city) parts.push(`Ville: ${m.city}`)
    if (m.currency) parts.push(`Devise: ${m.currency}`)
    return parts.length ? parts.join(' · ') : null
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            Journal d'audit
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Toutes les actions admin enregistrées</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2 h-8">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Actualiser
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="pl-8 h-8 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ACTION_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setActionFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                actionFilter === f.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Log list */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="divide-y">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 rounded-none" />)}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Aucun événement trouvé
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredLogs.map(log => {
              const cfg = ACTION_CONFIG[log.action]
              const Icon = cfg?.icon || ScrollText
              const meta = renderMetadata(log)
              return (
                <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className={`mt-0.5 flex-shrink-0 rounded-full p-1.5 ${cfg?.color || 'bg-muted text-muted-foreground'}`}>
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">
                        {cfg?.label || log.action}
                      </span>
                      {log.shops?.name && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">
                          {log.shops.name}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {log.actor_email && (
                        <span className="text-xs text-muted-foreground">{log.actor_email}</span>
                      )}
                      {meta && (
                        <span className="text-xs text-muted-foreground/70">· {meta}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: fr })}
                    </p>
                    {log.ip && (
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">{log.ip}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Load more */}
        {!loading && hasMore && !search && (
          <div className="border-t p-3 flex justify-center">
            <Button variant="ghost" size="sm" onClick={loadMore} className="text-xs h-7 gap-2">
              <RefreshCw className="h-3 w-3" />
              Charger plus
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
