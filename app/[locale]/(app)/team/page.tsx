'use client'

// ÉQUIPE — vue GLOBALE des personnes du compte (refonte du 5 oct. 2026).
// Une personne = une carte, quel que soit le nombre de boutiques auxquelles
// elle est affectée. Un Manager / Responsable ne voit que les personnes des
// boutiques qu'il gère. La fiche (MemberSheet), l'invitation (InviteDialog) et
// l'affectation (AssignDialog) sont les MÊMES composants que dans
// Boutique → Équipe.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  UserPlus, Search, ChevronRight, ChevronDown, Clock, Send, Trash2, UserCog, ShieldCheck, UserMinus, Users, Store,
} from 'lucide-react'
import { normalize } from '@/lib/utils/normalize'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'
import { isTeamManager, isAccountOwner, manageableRoles, ROLE_ORDER } from '@/lib/team/roles'
import { useTeamPeople, isPendingInvite, type TeamPerson } from '@/lib/team/use-team-people'
import { useTeamQuota } from '@/lib/team/use-team-quota'
import { PersonAvatar, PresenceText, RoleBadge } from '@/components/team/team-ui'
import { MemberSheet } from '@/components/team/member-sheet'
import { InviteDialog } from '@/components/team/invite-dialog'

const supabase = createClient() as any

export default function TeamPage() {
  const t = useTranslations()
  const locale = useLocale()
  const { profile: myProfile, shop, userShops, roleByShop } = useAuth()
  const { isOnline } = useOffline()

  // Boutiques que l'appelant gère (Propriétaire, Manager, Responsable)
  const managedShops = useMemo(() => userShops.filter(s => isTeamManager(roleByShop[s.id])), [userShops, roleByShop])
  const managedIds = useMemo(() => managedShops.map(s => s.id), [managedShops])
  const contextShopId = managedIds.includes(shop?.id ?? '') ? shop!.id : managedIds[0] ?? null
  const ownerShopIds = useMemo(() => managedShops.filter(s => isAccountOwner(roleByShop[s.id])).map(s => s.id), [managedShops, roleByShop])
  const isOwner = ownerShopIds.length > 0
  const inviteShops = useMemo(() => managedShops.filter(s => manageableRoles(roleByShop[s.id]).length > 0), [managedShops, roleByShop])
  const multiShop = managedShops.length > 1

  const { people, loading, refresh } = useTeamPeople(managedIds, contextShopId)
  const quota = useTeamQuota(contextShopId)
  const refreshAll = useCallback(() => { refresh(); quota.refresh() }, [refresh, quota])

  useRefetchOnVisible(refreshAll)
  useRefetchOnReconnect(refreshAll, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(userShops.length)

  // ── Liste : recherche et filtres ──────────────────────────────────────────
  const [view, setView] = useState<'team' | 'journal'>('team')
  const [search, setSearch] = useState('')
  const [shopFilter, setShopFilter] = useState<string>('all')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'deactivated'>('all')
  const [sheetUserId, setSheetUserId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  // Un Manager / Responsable ne voit pas le propriétaire
  const displayed = useMemo(() => people.filter(p => isOwner || !p.memberships.concat(p.suspendedMemberships).some(m => m.role === 'owner')), [people, isOwner])
  const shopName = (id: string) => userShops.find(s => s.id === id)?.name || '—'
  const allOf = (p: TeamPerson) => p.memberships.length ? p.memberships : p.suspendedMemberships

  const q = normalize(search.trim())
  const visible = displayed.filter(p => {
    if (q && !normalize(p.full_name).includes(q) && !normalize(p.email || '').includes(q)) return false
    if (shopFilter !== 'all' && !allOf(p).some(m => m.shop_id === shopFilter)) return false
    if (roleFilter !== 'all' && !allOf(p).some(m => m.role === roleFilter && (shopFilter === 'all' || m.shop_id === shopFilter))) return false
    if (statusFilter === 'active' && (!p.accountActive || isPendingInvite(p))) return false
    if (statusFilter === 'pending' && !(p.accountActive && isPendingInvite(p))) return false
    if (statusFilter === 'deactivated' && p.accountActive) return false
    return true
  })
  const filtersActive = !!q || shopFilter !== 'all' || roleFilter !== 'all' || statusFilter !== 'all'
  const rolesPresent = ROLE_ORDER.filter(r => displayed.some(p => allOf(p).some(m => m.role === r)))
  // Membres = hors propriétaire (même règle que le quota)
  const isOwnerPerson = (p: TeamPerson) => allOf(p).some(m => m.role === 'owner')
  const activeCount = displayed.filter(p => p.accountActive && p.memberships.length > 0 && !isOwnerPerson(p)).length
  const pendingCount = displayed.filter(p => p.accountActive && isPendingInvite(p) && !isOwnerPerson(p)).length
  const sheetPerson = sheetUserId ? people.find(p => p.user_id === sheetUserId) ?? null : null

  const renderPerson = (p: TeamPerson) => {
    const isMe = p.user_id === myProfile?.id
    const ms = allOf(p)
    const roles = Array.from(new Set(ms.map(m => m.role)))
    const shopIds = ms.map(m => m.shop_id)
    const primary = p.primaryShopId && shopIds.includes(p.primaryShopId) ? p.primaryShopId : shopIds[0]
    const others = shopIds.filter(id => id !== primary)
    return (
      <button
        type="button"
        key={p.user_id}
        onClick={() => setSheetUserId(p.user_id)}
        data-testid="member-card"
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !p.accountActive && 'border-red-100 bg-red-50/20 opacity-70 dark:border-red-900/30 dark:bg-red-950/10',
          p.accountActive && isPendingInvite(p) && 'border-amber-200 dark:border-amber-800/40',
        )}
      >
        <PersonAvatar person={p} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold leading-tight">{p.full_name}</p>
            {isMe && <span className="rounded border px-1 text-[9px] text-muted-foreground">{t('team.me')}</span>}
            {!p.accountActive && <span className="rounded-full border border-red-200 bg-red-100 px-1.5 text-[9px] font-medium text-red-600 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-400">{t('team.account_deactivated_badge')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="member-roles">
            {roles.map(r => <RoleBadge key={r} role={r} size="xs" />)}
            <PresenceText person={p} />
          </div>
          {multiShop && shopIds.length > 0 && (
            <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" data-testid="member-shops">
              <Store className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {shopName(primary!)}{others.length > 0 && <> · {others.length <= 2 ? others.map(shopName).join(', ') : t('team.other_shops', { count: others.length })}</>}
              </span>
            </p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>
    )
  }

  // ── Journal (propriétaire : RLS audit_logs) ───────────────────────────────
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingJournal, setLoadingJournal] = useState(false)
  const [journalPeriod, setJournalPeriod] = useState<'all' | 'today' | '7d' | '30d'>('all')
  const [journalAction, setJournalAction] = useState<string>('all')
  const [journalExpanded, setJournalExpanded] = useState<string | null>(null)
  const JOURNAL_ACTIONS = ['member.invite', 'member.assign', 'member.delete', 'member.role_change', 'member.toggle_active']

  const fetchAuditLogs = useCallback(async () => {
    const ids = shopFilter !== 'all' ? [shopFilter].filter(id => ownerShopIds.includes(id)) : ownerShopIds
    if (!ids.length) { setAuditLogs([]); return }
    setLoadingJournal(true)
    try {
      let query = supabase.from('audit_logs').select('*')
        .in('shop_id', ids)
        .in('action', journalAction === 'all' ? JOURNAL_ACTIONS : [journalAction])
        .order('created_at', { ascending: false })
        .limit(100)
      if (journalPeriod !== 'all') {
        const d = new Date(); d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() - (journalPeriod === 'today' ? 0 : journalPeriod === '7d' ? 6 : 29))
        query = query.gte('created_at', d.toISOString())
      }
      const { data } = await withTimeout<any>(query, 20_000, 'Chargement du journal trop lent — réessayez.')
      setAuditLogs(data || [])
    } catch {
      // journal non critique
    } finally {
      setLoadingJournal(false)
    }
  }, [ownerShopIds.join(','), shopFilter, journalAction, journalPeriod]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'journal') fetchAuditLogs() }, [view, fetchAuditLogs])

  type LogRow = { label: string; from?: string; to: string }
  const describeLog = (log: any): { label: string; who: string; Icon: typeof Send; tone: string; rows: LogRow[] } => {
    const meta = log.metadata || {}
    const roleLabel = (r?: string) => (r ? t(`roles.${r}` as any) : '—')
    if (log.action === 'member.invite') return { label: t('team.journal_invited'), who: meta.member_name || meta.email || '—', Icon: Send, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400', rows: [{ label: t('team.role_label'), to: roleLabel(meta.role) }, { label: t('team.invite_email'), to: meta.email || '—' }] }
    if (log.action === 'member.assign') return { label: t('team.journal_assigned'), who: meta.member_name || '—', Icon: Store, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400', rows: [{ label: t('team.role_label'), to: roleLabel(meta.role) }] }
    if (log.action === 'member.delete') return { label: meta.scope === 'shop' ? t('team.journal_removed') : t('team.journal_deleted'), who: meta.member_name || '—', Icon: meta.scope === 'shop' ? UserMinus : Trash2, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400', rows: meta.role ? [{ label: t('team.role_label'), to: roleLabel(meta.role) }] : [] }
    if (log.action === 'member.role_change') return { label: t('team.journal_role_changed'), who: meta.member_name || '—', Icon: UserCog, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400', rows: [{ label: t('team.role_label'), from: roleLabel(meta.old_role), to: roleLabel(meta.new_role) }] }
    const label = meta.scope === 'account' ? (meta.new_active ? t('team.journal_account_reactivated') : t('team.journal_account_deactivated')) : t('team.journal_toggled')
    return { label, who: meta.member_name || '—', Icon: meta.new_active ? ShieldCheck : UserMinus, tone: meta.new_active ? 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400', rows: [{ label: t('team.sheet_status'), from: meta.new_active ? t('status.inactive') : t('status.active'), to: meta.new_active ? t('status.active') : t('status.inactive') }] }
  }

  const journalGroups = useMemo(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = iso(new Date())
    const y = new Date(); y.setDate(y.getDate() - 1)
    const yesterday = iso(y)
    const out: { key: string; label: string; items: any[] }[] = []
    for (const log of auditLogs) {
      const d = new Date(log.created_at)
      const key = iso(d)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        g = { key, label: key === today ? t('activity_journal.today') : key === yesterday ? t('activity_journal.yesterday') : d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }), items: [] }
        out.push(g)
      }
      g.items.push(log)
    }
    return out
  }, [auditLogs, locale, t])

  return (
    <div className="space-y-4">
      {/* En-tête : effectifs, quota, invitation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground" data-testid="team-counts">
            {t('team.active_count', { count: activeCount })}
            {pendingCount > 0 && <span className="ml-1 text-amber-500">· {t('team.pending_count', { count: pendingCount })}</span>}
          </p>
          {quota.data && (
            <p className={cn('text-xs font-medium', quota.data.limit !== -1 && quota.data.used >= quota.data.limit ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} data-testid="team-quota">
              {quota.data.limit === -1 ? t('team.quota_unlimited', { used: quota.data.used }) : t('team.quota', { used: quota.data.used, limit: quota.data.limit, plan: quota.data.planName })}
            </p>
          )}
        </div>
        {inviteShops.length > 0 && (
          <Button variant="stockshop" className="gap-2" onClick={() => setInviteOpen(true)} data-testid="team-invite">
            <UserPlus className="h-4 w-4" />{t('team.invite_btn')}
          </Button>
        )}
      </div>

      {isOwner && (
        <div className="flex w-fit gap-1 rounded-lg border bg-muted/30 p-1">
          <button onClick={() => setView('team')} className={cn('rounded-md px-4 py-1.5 text-sm font-medium transition-colors', view === 'team' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t('team.tab_team')}
          </button>
          <button onClick={() => setView('journal')} className={cn('flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors', view === 'journal' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Clock className="h-3.5 w-3.5" /> {t('team.tab_journal')}
          </button>
        </div>
      )}

      {/* Filtre boutique : commun à la liste et au journal */}
      {(view === 'team' || view === 'journal') && (displayed.length > 0 || view === 'journal') && (
        <div className="flex flex-wrap gap-2">
          {view === 'team' && (
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('team.search_placeholder')} aria-label={t('team.search_placeholder')} className="h-9 pl-9" />
            </div>
          )}
          {multiShop && (
            <Select value={shopFilter} onValueChange={setShopFilter}>
              <SelectTrigger className="h-9 w-auto min-w-[170px] max-w-[240px] gap-1 text-xs" aria-label={t('team.shop')} data-testid="team-shop-filter"><Store className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('team.filter_shop_all')}</SelectItem>
                {managedShops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {view === 'team' && (
            <>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="h-9 w-[160px] text-xs" aria-label={t('team.role_label')} data-testid="team-role-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('team.filter_role_all')}</SelectItem>
                  {rolesPresent.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="h-9 w-[170px] text-xs" aria-label={t('team.sheet_status')} data-testid="team-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('team.filter_status_all')}</SelectItem>
                  <SelectItem value="active">{t('team.status_active')}</SelectItem>
                  <SelectItem value="pending">{t('team.status_pending')}</SelectItem>
                  <SelectItem value="deactivated">{t('team.account_deactivated_badge')}</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {view === 'team' && (
        loading && shopLoadTimedOut && userShops.length === 0 ? (
          <LoadErrorFallback />
        ) : loading && displayed.length === 0 ? (
          <div className="space-y-2.5">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}</div>
        ) : displayed.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-sm text-muted-foreground">
            <Users className="h-6 w-6 opacity-40" />{t('team.no_members')}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-sm text-muted-foreground">
            {t('team.no_results_filtered')}
            {filtersActive && (
              <button type="button" className="text-xs font-medium text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => { setSearch(''); setShopFilter('all'); setRoleFilter('all'); setStatusFilter('all') }}>
                {t('activity_journal.reset')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">{visible.map(renderPerson)}</div>
        )
      )}

      {view === 'journal' && isOwner && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Select value={journalPeriod} onValueChange={v => setJournalPeriod(v as typeof journalPeriod)}>
              <SelectTrigger className="h-9 text-xs" aria-label={t('activity_journal.period_label')} data-testid="team-journal-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('activity_journal.period_all')}</SelectItem>
                <SelectItem value="today">{t('activity_journal.today')}</SelectItem>
                <SelectItem value="7d">{t('activity_journal.period_7d')}</SelectItem>
                <SelectItem value="30d">{t('activity_journal.period_30d')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={journalAction} onValueChange={setJournalAction}>
              <SelectTrigger className="h-9 text-xs" aria-label={t('activity_journal.action_label')} data-testid="team-journal-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('activity_journal.action_all')}</SelectItem>
                <SelectItem value="member.invite">{t('team.journal_filter_invites')}</SelectItem>
                <SelectItem value="member.assign">{t('team.journal_filter_assign')}</SelectItem>
                <SelectItem value="member.role_change">{t('team.journal_filter_roles')}</SelectItem>
                <SelectItem value="member.toggle_active">{t('team.journal_filter_status')}</SelectItem>
                <SelectItem value="member.delete">{t('team.journal_filter_deletes')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loadingJournal && auditLogs.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">{t('team.journal_loading')}</p>
          ) : auditLogs.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">{t('team.journal_empty')}</p>
          ) : (
            journalGroups.map(g => (
              <section key={g.key} className="space-y-2" data-testid="team-journal-day">
                <h4 className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h4>
                {g.items.map((log: any) => {
                  const d = describeLog(log)
                  const isOpen = journalExpanded === log.id
                  const time = new Date(log.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={log.id} className="overflow-hidden rounded-lg border bg-card">
                      <button type="button" aria-expanded={isOpen} onClick={() => setJournalExpanded(isOpen ? null : log.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40" data-testid="team-journal-entry">
                        <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', d.tone)}><d.Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{d.who}</span>
                          <span className="block truncate text-xs text-muted-foreground">{d.label}{multiShop && log.shop_id ? ` · ${shopName(log.shop_id)}` : ''}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground/80">{log.actor_email || '—'} · {time}</span>
                        </span>
                        <ChevronDown className={cn('mt-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && (
                        <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-xs" data-testid="team-journal-detail">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">{t('activity_journal.who')}</dt>
                            <dd className="font-medium">{log.actor_email || '—'}</dd>
                            <dt className="text-muted-foreground">{t('activity_journal.when')}</dt>
                            <dd className="first-letter:uppercase">{new Date(log.created_at).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                            <dt className="text-muted-foreground">{t('team.journal_member')}</dt>
                            <dd>{d.who}</dd>
                            {multiShop && log.shop_id && (<><dt className="text-muted-foreground">{t('team.shop')}</dt><dd>{shopName(log.shop_id)}</dd></>)}
                          </dl>
                          {d.rows.length > 0 && (
                            <div className="overflow-hidden rounded-lg border bg-background">
                              <table className="w-full">
                                <thead className="bg-muted/50 text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-medium">{t('activity_journal.field')}</th>
                                    {d.rows.some(r => r.from !== undefined) && <th className="px-3 py-2 text-left font-medium">{t('activity_journal.before')}</th>}
                                    <th className="px-3 py-2 text-left font-medium">{d.rows.some(r => r.from !== undefined) ? t('activity_journal.after') : t('activity_journal.value')}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {d.rows.map(r => (
                                    <tr key={r.label}>
                                      <td className="px-3 py-2 text-muted-foreground">{r.label}</td>
                                      {d.rows.some(x => x.from !== undefined) && <td className="px-3 py-2 text-muted-foreground line-through">{r.from ?? '—'}</td>}
                                      <td className="px-3 py-2 font-medium">{r.to}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </section>
            ))
          )}
        </div>
      )}

      <MemberSheet
        person={sheetPerson}
        onOpenChange={open => { if (!open) setSheetUserId(null) }}
        shops={managedShops}
        roleByShop={roleByShop}
        myUserId={myProfile?.id}
        people={people}
        onChanged={refreshAll}
      />

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        shops={inviteShops}
        defaultShopId={shopFilter !== 'all' ? shopFilter : contextShopId}
        roleByShop={roleByShop}
        onDone={refreshAll}
      />
    </div>
  )
}
