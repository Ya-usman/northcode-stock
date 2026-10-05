'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  UserPlus, Shield, Mail, ShieldOff, ShieldCheck,
  AlertTriangle, Trash2, Store, RotateCcw,
  CheckCircle2, Clock, Search, ChevronRight, ChevronDown, Users, Send, UserMinus, UserCog,
} from 'lucide-react'
import { normalize } from '@/lib/utils/normalize'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { RequiredMark } from '@/components/ui/input-group'
import { FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { ShopSelector } from '@/components/layout/shop-selector'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import type { UserRole } from '@/lib/types/database'
import { cn } from '@/lib/utils/cn'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'

const supabase = createClient() as any

const ROLE_COLORS: Record<string, string> = {
  owner:         'bg-stockshop-blue dark:bg-blue-500 text-white',
  shop_manager:  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  manager:       'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
  cashier:       'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  stock_manager: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  viewer:        'bg-muted text-muted-foreground',
  super_admin:   'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
}

const ROLE_AVATAR_COLORS: Record<string, string> = {
  owner:         'bg-stockshop-blue dark:bg-blue-500',
  shop_manager:  'bg-indigo-600 dark:bg-indigo-500',
  manager:       'bg-violet-600 dark:bg-violet-500',
  cashier:       'bg-green-600 dark:bg-green-500',
  stock_manager: 'bg-amber-600 dark:bg-amber-500',
  viewer:        'bg-gray-500',
  super_admin:   'bg-purple-600',
}

interface AuthStatus {
  email_confirmed_at: string | null
  last_sign_in_at: string | null
}

interface Member {
  id: string
  user_id: string
  shop_id: string
  role: UserRole
  is_active: boolean
  joined_at: string
  email?: string
  profiles: {
    id: string
    full_name: string
    last_seen: string | null
    is_active: boolean
  } | null
  authStatus?: AuthStatus
}

export default function TeamPage() {
  const t = useTranslations()
  const locale = useLocale()
  const dateFnsLocale = locale === 'fr' ? fr : enUS
  const { profile: myProfile, shop, userShops, effectiveShopIds } = useAuth()
  const { isOnline } = useOffline()
  const { toast } = useToast()
  // The shop whose team is shown/managed — the single global active shop, shared
  // with the sidebar/header selector (no more page-local shop state to drift out of sync).
  const shopId = shop?.id

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteShopId, setInviteShopId] = useState<string>(shop?.id || '')
  const [inviting, setInviting] = useState(false)

  // Confirm dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; member: Member | null; action: 'deactivate' | 'reactivate'
  }>({ open: false, member: null, action: 'deactivate' })
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; member: Member | null }>({ open: false, member: null })
  const [deleting, setDeleting] = useState(false)

  // ── Journal ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<'team' | 'journal'>('team')
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingJournal, setLoadingJournal] = useState(false)
  const [journalPeriod, setJournalPeriod] = useState<'all' | 'today' | '7d' | '30d'>('all')
  const [journalAction, setJournalAction] = useState<'all' | 'member.invite' | 'member.role_change' | 'member.toggle_active' | 'member.delete'>('all')
  const [journalExpanded, setJournalExpanded] = useState<string | null>(null)

  // ── Liste : recherche, filtres, fiche, changement de rôle confirmé ──────
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>('all')
  const [sheetMemberId, setSheetMemberId] = useState<string | null>(null)
  const [roleChange, setRoleChange] = useState<{ member: Member; to: UserRole } | null>(null)
  const [inviteErrors, setInviteErrors] = useState<{ name?: string; email?: string }>({})

  const isOwner = myProfile?.role === 'owner' || myProfile?.role === 'manager' || myProfile?.role === 'shop_manager' || myProfile?.role === 'super_admin'
  // True owners (and super_admin) manage everyone. Managers (manager/shop_manager) only
  // manage subordinate roles — they never see the owner and can't touch peer managers.
  const isFullOwner = myProfile?.role === 'owner' || myProfile?.role === 'super_admin'
  const isSubManager = myProfile?.role === 'manager' || myProfile?.role === 'shop_manager'
  const SUBORDINATE_ROLES: UserRole[] = ['cashier', 'stock_manager', 'viewer']
  const canManageMember = (member: Member) =>
    isFullOwner || (isSubManager && SUBORDINATE_ROLES.includes(member.role))

  useEffect(() => {
    if (shop?.id) setInviteShopId(id => id || shop.id)
  }, [shop?.id])

  const fetchMembers = useCallback(async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `team_${effectiveShopIds.join(',')}`
    const cached = getPageCache<Member[]>(cacheKey)
    if (cached) { setMembers(cached); setLoading(false) }
    else setLoading(true)

    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const results = await withTimeout(Promise.all(
        effectiveShopIds.map(sid =>
          supabase.from('shop_members')
            .select('id, user_id, shop_id, role, is_active, joined_at')
            .eq('shop_id', sid)
            .order('role')
        )
      ), 20_000, 'Chargement de l\'équipe trop lent — réessayez.')

      // A transient auth/RLS hiccup can resolve a per-shop query with
      // data: null instead of throwing — check explicitly so a single-shop
      // account doesn't fall into "rows.length === 0" (which bypasses the
      // catch below and directly zeroes the member list) on a fluke failure.
      const membersErr = results.find(r => r.error)?.error
      if (membersErr) throw membersErr
      const rows = results.flatMap(r => (r.data || []) as any[])
      if (rows.length === 0) { setMembers([]); setLoading(false); return }

      const userIds = Array.from(new Set(rows.map((r: any) => r.user_id))) as string[]

      const { data: profilesData } = await withTimeout<any>(
        supabase.from('profiles').select('id, full_name, last_seen, is_active').in('id', userIds),
        20_000
      )

      const profilesMap: Record<string, any> = {}
      ;(profilesData || []).forEach((p: any) => { profilesMap[p.id] = p })

      const membersArray = rows.map(m => ({
        ...m,
        profiles: profilesMap[m.user_id] ?? { id: m.user_id, full_name: '—', last_seen: null, is_active: m.is_active },
      })) as Member[]

      setMembers(membersArray)
      setPageCache(cacheKey, membersArray)

      // Fetch auth status (email confirmed, last sign in) for owners/managers only
      if (isOwner && shopId) {
        try {
          const res = await withTimeout(fetch('/api/team/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds, shop_id: shopId }),
          }), 15_000)
          if (res.ok) {
            const { status } = await res.json()
            setMembers(prev => prev.map(m => ({
              ...m,
              authStatus: status[m.user_id] ?? undefined,
            })))
          }
        } catch {
          // non-blocking — auth status is nice-to-have
        }
      }
    } catch {
      // cache fallback already applied
    } finally {
      setLoading(false)
    }
  }, [effectiveShopIds.join(','), isOwner, shopId])

  useEffect(() => { fetchMembers() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches team changes
  // (new invites, role/status changes) made while this page sat in the background.
  useRefetchOnVisible(fetchMembers)
  useRefetchOnReconnect(fetchMembers, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const fetchAuditLogs = useCallback(async () => {
    if (!shopId) return
    setLoadingJournal(true)
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .eq('shop_id', shopId)
        .in('action', journalAction === 'all' ? ['member.invite', 'member.delete', 'member.role_change', 'member.toggle_active'] : [journalAction])
        .order('created_at', { ascending: false })
        .limit(100)
      if (journalPeriod !== 'all') {
        const d = new Date(); d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() - (journalPeriod === 'today' ? 0 : journalPeriod === '7d' ? 6 : 29))
        query = query.gte('created_at', d.toISOString())
      }
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave the journal spinning forever.
      const { data } = await withTimeout<any>(query, 20_000, 'Chargement du journal trop lent — réessayez.')
      setAuditLogs(data || [])
    } catch {
      // journal just stays empty/stale — non-critical secondary tab
    } finally {
      setLoadingJournal(false)
    }
  }, [shopId, journalAction, journalPeriod])

  useEffect(() => { if (view === 'journal') fetchAuditLogs() }, [view, fetchAuditLogs])

  const changeRole = async (member: Member, newRole: UserRole) => {
    if (member.user_id === myProfile?.id) {
      toast({ title: t('toast.cannot_edit_own_role'), variant: 'destructive' })
      return
    }
    setActionLoading(member.id + '_role')
    try {
      const res = await withTimeout(fetch('/api/team/change-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: member.id, shop_id: member.shop_id, new_role: newRole }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: t('toast.role_updated'), variant: 'success' })
      fetchMembers()
      if (view === 'journal') fetchAuditLogs()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
      setTimeout(() => fetchMembers(), 3_000)
    } finally {
      setActionLoading(null)
    }
  }

  const doToggleActive = async () => {
    const { member, action } = confirmDialog
    if (!member) return
    setConfirmDialog(d => ({ ...d, open: false }))
    setActionLoading(member.id)
    try {
      const res = await withTimeout(fetch('/api/team/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: member.user_id, is_active: action === 'reactivate', shop_id: member.shop_id }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({
        title: `${member.profiles?.full_name} ${action === 'deactivate' ? t('status.inactive') : t('status.active')}`,
        variant: action === 'deactivate' ? 'default' : 'success',
      })
      fetchMembers()
      if (view === 'journal') fetchAuditLogs()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const doDeleteMember = async () => {
    const { member } = deleteDialog
    if (!member) return
    setDeleting(true)
    try {
      const res = await withTimeout(fetch('/api/team/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: member.user_id, shop_id: member.shop_id }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: t('toast.member_deleted', { name: member.profiles?.full_name }), variant: 'success' })
      setDeleteDialog({ open: false, member: null })
      fetchMembers()
      if (view === 'journal') fetchAuditLogs()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const inviteEmployee = async () => {
    // Erreurs sous les champs plutôt qu'une notification
    const errors: { name?: string; email?: string } = {}
    if (!inviteFullName.trim()) errors.name = t('team.name_required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) errors.email = t('errors.email_invalid')
    setInviteErrors(errors)
    if (errors.name || errors.email) return
    setInviting(true)
    try {
      const res = await withTimeout(fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteFullName,
          role: inviteRole,
          shop_id: inviteShopId || shop?.id,
          invited_by: myProfile?.id,
        }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      toast({ title: t('toast.invite_sent', { email: inviteEmail }), variant: 'success' })
      setShowInviteModal(false)
      setInviteEmail('')
      setInviteFullName('')
      if (inviteShopId === shopId) fetchMembers()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }

  const resendInvite = async (member: Member) => {
    const email = member.email || member.profiles?.full_name
    if (!email?.includes('@')) {
      toast({ title: t('team.email_not_found'), variant: 'destructive' })
      return
    }
    setActionLoading(member.id + '_resend')
    try {
      const res = await withTimeout(fetch('/api/team/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, shop_id: member.shop_id }),
      }))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: t('team.invite_resent', { email }), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const displayedMembers = (shopId
    ? members.filter(m => m.shop_id === shopId)
    : members
  ).filter(m => !(isSubManager && m.role === 'owner'))

  const isPending = (m: Member) => !!m.authStatus && !m.authStatus.email_confirmed_at
  const activeCount = displayedMembers.filter(m => m.is_active).length
  const pendingCount = displayedMembers.filter(isPending).length

  // Recherche (nom, e-mail) et filtres (rôle, statut)
  const q = normalize(search.trim())
  const visibleMembers = displayedMembers.filter(m => {
    if (q && !normalize(m.profiles?.full_name || '').includes(q) && !normalize(m.email || '').includes(q)) return false
    if (roleFilter !== 'all' && m.role !== roleFilter) return false
    if (statusFilter === 'active' && !m.is_active) return false
    if (statusFilter === 'inactive' && m.is_active) return false
    if (statusFilter === 'pending' && !isPending(m)) return false
    return true
  })
  const filtersActive = !!q || roleFilter !== 'all' || statusFilter !== 'all'
  const rolesPresent = Array.from(new Set(displayedMembers.map(m => m.role)))

  // Fiche ouverte : toujours la version à jour du membre (après une action)
  const sheetMember = sheetMemberId ? members.find(m => m.id === sheetMemberId) ?? null : null
  const assignableRoles: UserRole[] = [
    ...(isFullOwner ? (['shop_manager', 'manager'] as UserRole[]) : []),
    'cashier', 'stock_manager', 'viewer',
  ]

  const renderMemberStatus = (member: Member) => {
    const p = member.profiles
    const auth = member.authStatus
    const lastSeenMs = p?.last_seen ? Date.now() - new Date(p.last_seen).getTime() : Infinity
    const isOnline = lastSeenMs < 5 * 60 * 1000
    const isAway = !isOnline && lastSeenMs < 2 * 60 * 60 * 1000

    // Email not confirmed → invitation pending
    if (auth && !auth.email_confirmed_at) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="h-3 w-3" />
          {t('team.invite_pending')}
        </span>
      )
    }

    // Email confirmed but never signed in
    if (auth && auth.email_confirmed_at && !auth.last_sign_in_at) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-500" />
          {t('team.email_confirmed_never_connected')}
        </span>
      )
    }

    const seen = p?.last_seen || auth?.last_sign_in_at
    if (seen) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', isOnline ? 'bg-green-500' : isAway ? 'bg-amber-400' : 'bg-gray-400')} />
          {isOnline ? t('team.online') : formatDistanceToNow(new Date(seen), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      )
    }

    return <span className="text-[10px] text-muted-foreground italic">{t('team.never_connected')}</span>
  }

  const initialsOf = (name: string) => name.split(' ').filter(Boolean).map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?'

  // Carte allégée : un clic ouvre la fiche, où se trouvent les actions
  const renderMember = (member: Member) => {
    const p = member.profiles
    if (!p) return null
    const isMe = member.user_id === myProfile?.id
    const emailNotConfirmed = isPending(member)

    return (
      <button
        type="button"
        key={member.id}
        onClick={() => setSheetMemberId(member.id)}
        data-testid="member-card"
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !member.is_active && 'opacity-60 border-red-100 dark:border-red-900/30 bg-red-50/20 dark:bg-red-950/10',
          emailNotConfirmed && member.is_active && 'border-amber-200 dark:border-amber-800/40',
        )}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <Avatar className="h-9 w-9">
            <AvatarFallback className={cn('text-white text-xs font-bold', member.is_active ? (ROLE_AVATAR_COLORS[member.role] || 'bg-gray-500') : 'bg-gray-400')}>
              {initialsOf(p.full_name)}
            </AvatarFallback>
          </Avatar>
          {member.is_active && p.last_seen && !emailNotConfirmed && (() => {
            const ms = Date.now() - new Date(p.last_seen).getTime()
            const online = ms < 5 * 60 * 1000
            const away = !online && ms < 2 * 60 * 60 * 1000
            return (
              <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card', online ? 'bg-green-500' : away ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600')} />
            )
          })()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm leading-tight truncate">{p.full_name}</p>
            {isMe && <Badge variant="outline" className="text-[9px] px-1 h-4 flex-shrink-0">{t('team.me')}</Badge>}
            {!member.is_active && <Badge className="text-[9px] px-1.5 h-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/60 flex-shrink-0">{t('team.deactivated_badge')}</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', ROLE_COLORS[member.role] || ROLE_COLORS.viewer)}>
              <Shield className="h-2.5 w-2.5" />
              {t(`roles.${member.role}` as any) || member.role}
            </span>
            {renderMemberStatus(member)}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>
    )
  }

  // Journal : libellé, détail et changement Avant / Après par entrée
  type LogRow = { label: string; from?: string; to: string }
  const describeLog = (log: any): { label: string; who: string; Icon: typeof Send; tone: string; rows: LogRow[] } => {
    const meta = log.metadata || {}
    const roleLabel = (r?: string) => (r ? t(`roles.${r}` as any) : '—')
    if (log.action === 'member.invite') return { label: t('team.journal_invited'), who: meta.email || '—', Icon: Send, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400', rows: [{ label: t('team.role_label'), to: roleLabel(meta.role) }, { label: t('team.invite_email'), to: meta.email || '—' }] }
    if (log.action === 'member.delete') return { label: t('team.journal_deleted'), who: meta.member_name || '—', Icon: Trash2, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400', rows: [] }
    if (log.action === 'member.role_change') return { label: t('team.journal_role_changed'), who: meta.member_name || '—', Icon: UserCog, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400', rows: [{ label: t('team.role_label'), from: roleLabel(meta.old_role), to: roleLabel(meta.new_role) }] }
    return { label: t('team.journal_toggled'), who: meta.member_name || '—', Icon: meta.new_active ? ShieldCheck : UserMinus, tone: meta.new_active ? 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400', rows: [{ label: t('team.sheet_status'), from: meta.new_active ? t('status.inactive') : t('status.active'), to: meta.new_active ? t('status.active') : t('status.inactive') }] }
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-muted-foreground" data-testid="team-counts">
            {t('team.active_count', { count: activeCount })}
            {pendingCount > 0 && (
              <span className="text-amber-500 ml-1">· {t('team.pending_count', { count: pendingCount })}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Shop selector — same shared control as everywhere else in the app */}
          {isOwner && <ShopSelector variant="compact" allowAllShops={false} className="w-auto" />}

          {isOwner && (
            <Button
              variant="stockshop"
              className="gap-2"
              disabled={inviting}
              onClick={() => { setInviteShopId(shopId ?? ''); setInviteErrors({}); setShowInviteModal(true) }}
            >
              <UserPlus className="h-4 w-4" />
              {t('team.invite_btn')}
            </Button>
          )}
        </div>
      </div>

      {/* View toggle */}
      {isFullOwner && (
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setView('team')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'team' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('team.tab_team')}
          </button>
          <button
            onClick={() => setView('journal')}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'journal' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Clock className="h-3.5 w-3.5" /> {t('team.tab_journal')}
          </button>
        </div>
      )}

      {/* Member list */}
      {view === 'team' && (
        <>
          {displayedMembers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('team.search_placeholder')} aria-label={t('team.search_placeholder')} className="h-9 pl-9" />
              </div>
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
                  <SelectItem value="inactive">{t('team.status_inactive')}</SelectItem>
                  <SelectItem value="pending">{t('team.status_pending')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
            <LoadErrorFallback />
          ) : loading ? (
            <div className="space-y-2.5">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
            </div>
          ) : displayedMembers.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm rounded-xl border bg-card">
              {t('team.no_members')}
            </div>
          ) : visibleMembers.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-sm text-muted-foreground">
              {t('team.no_results_filtered')}
              {filtersActive && (
                <button type="button" className="text-xs font-medium text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all') }}>
                  {t('activity_journal.reset')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleMembers.map(member => renderMember(member))}
            </div>
          )}
        </>
      )}

      {/* Journal */}
      {view === 'journal' && isFullOwner && (
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
            <Select value={journalAction} onValueChange={v => setJournalAction(v as typeof journalAction)}>
              <SelectTrigger className="h-9 text-xs" aria-label={t('activity_journal.action_label')} data-testid="team-journal-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('activity_journal.action_all')}</SelectItem>
                <SelectItem value="member.invite">{t('team.journal_filter_invites')}</SelectItem>
                <SelectItem value="member.role_change">{t('team.journal_filter_roles')}</SelectItem>
                <SelectItem value="member.toggle_active">{t('team.journal_filter_status')}</SelectItem>
                <SelectItem value="member.delete">{t('team.journal_filter_deletes')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loadingJournal && auditLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">{t('team.journal_loading')}</p>
          ) : auditLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">{t('team.journal_empty')}</p>
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
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setJournalExpanded(isOpen ? null : log.id)}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                        data-testid="team-journal-entry"
                      >
                        <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', d.tone)}><d.Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{d.who}</span>
                          <span className="block truncate text-xs text-muted-foreground">{d.label}</span>
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

      {/* Fiche d'un membre : informations et actions */}
      <DetailDrawer
        open={!!sheetMember}
        onOpenChange={open => { if (!open) setSheetMemberId(null) }}
        title={sheetMember?.profiles?.full_name || ''}
        description={sheetMember ? (t(`roles.${sheetMember.role}` as any) as string) : undefined}
        icon={<Users className="h-4 w-4" />}
        width="sm"
        testId="member-sheet"
        actions={sheetMember && sheetMember.user_id !== myProfile?.id && sheetMember.role !== 'owner' && isOwner && canManageMember(sheetMember) ? (
          <div className={FOOTER_ROW_CLASS}>
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-0 rounded-lg border-red-200 px-3 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
              aria-label={t('team.delete_title')}
              onClick={() => setDeleteDialog({ open: true, member: sheetMember })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn('h-11 min-w-0 flex-1 gap-2 rounded-lg px-4 sm:flex-none', sheetMember.is_active ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400' : 'border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:text-green-400')}
              loading={actionLoading === sheetMember.id}
              onClick={() => setConfirmDialog({ open: true, member: sheetMember, action: sheetMember.is_active ? 'deactivate' : 'reactivate' })}
              data-testid="member-toggle"
            >
              {sheetMember.is_active ? <><ShieldOff className="h-4 w-4" />{t('team.deactivate')}</> : <><ShieldCheck className="h-4 w-4" />{t('team.reactivate')}</>}
            </Button>
          </div>
        ) : undefined}
      >
        {sheetMember && (
          <div className="space-y-4">
            <DrawerSection title={t('team.sheet_info')}>
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  <AvatarFallback className={cn('text-white text-sm font-bold', sheetMember.is_active ? (ROLE_AVATAR_COLORS[sheetMember.role] || 'bg-gray-500') : 'bg-gray-400')}>
                    {initialsOf(sheetMember.profiles?.full_name || '')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{sheetMember.profiles?.full_name}</p>
                  {renderMemberStatus(sheetMember)}
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('team.role_label')}</dt>
                <dd>
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ROLE_COLORS[sheetMember.role] || ROLE_COLORS.viewer)}>
                    <Shield className="h-3 w-3" />{t(`roles.${sheetMember.role}` as any)}
                  </span>
                </dd>
                <dt className="text-muted-foreground">{t('team.shop')}</dt>
                <dd>{userShops.find(s => s.id === sheetMember.shop_id)?.name || '—'}</dd>
                <dt className="text-muted-foreground">{t('team.sheet_status')}</dt>
                <dd>{!sheetMember.is_active ? t('team.status_inactive') : isPending(sheetMember) ? t('team.status_pending') : t('team.status_active')}</dd>
                {sheetMember.joined_at && (
                  <>
                    <dt className="text-muted-foreground">{t('team.sheet_joined')}</dt>
                    <dd>{new Date(sheetMember.joined_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
                  </>
                )}
              </dl>
              {isPending(sheetMember) && isOwner && (
                <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" loading={actionLoading === sheetMember.id + '_resend'} onClick={() => resendInvite(sheetMember)}>
                  <RotateCcw className="h-3.5 w-3.5" />{t('team.resend')}
                </Button>
              )}
            </DrawerSection>

            {sheetMember.user_id !== myProfile?.id && sheetMember.role !== 'owner' && isOwner && canManageMember(sheetMember) && (
              <DrawerSection title={t('team.sheet_role_hint')}>
                <Select
                  value={sheetMember.role}
                  onValueChange={v => { if (v !== sheetMember.role) setRoleChange({ member: sheetMember, to: v as UserRole }) }}
                  disabled={actionLoading === sheetMember.id + '_role' || !sheetMember.is_active}
                >
                  <SelectTrigger className="h-10" data-testid="member-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('team.role_change_hint')}</p>
              </DrawerSection>
            )}
          </div>
        )}
      </DetailDrawer>

      {/* Changement de rôle : confirmation (ambre si le rôle peut gérer l'équipe) */}
      <ConfirmModal
        open={!!roleChange}
        onOpenChange={open => { if (!open) setRoleChange(null) }}
        title={t('team.role_change_title')}
        description={roleChange ? t('team.role_change_confirm', { name: roleChange.member.profiles?.full_name || '', from: t(`roles.${roleChange.member.role}` as any), to: t(`roles.${roleChange.to}` as any) }) : undefined}
        icon={<UserCog className="h-4 w-4" />}
        tone={roleChange && (roleChange.to === 'manager' || roleChange.to === 'shop_manager') ? 'warning' : 'primary'}
        confirmLabel={t('team.role_change_title')}
        loading={!!roleChange && actionLoading === roleChange.member.id + '_role'}
        onConfirm={async () => { if (!roleChange) return; await changeRole(roleChange.member, roleChange.to); setRoleChange(null) }}
      >
        <p className="text-xs text-muted-foreground">{t('team.role_change_hint')}</p>
        {roleChange && (roleChange.to === 'manager' || roleChange.to === 'shop_manager') && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{t('team.role_change_manager_hint')}
          </div>
        )}
      </ConfirmModal>

      {/* Désactivation / réactivation */}
      <ConfirmModal
        open={confirmDialog.open}
        onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}
        title={confirmDialog.action === 'deactivate' ? t('team.deactivate_title') : t('team.reactivate_title')}
        description={confirmDialog.action === 'deactivate'
          ? t('team.deactivate_confirm', { name: confirmDialog.member?.profiles?.full_name })
          : t('team.reactivate_confirm', { name: confirmDialog.member?.profiles?.full_name })}
        icon={confirmDialog.action === 'deactivate' ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        tone={confirmDialog.action === 'deactivate' ? 'danger' : 'primary'}
        confirmLabel={confirmDialog.action === 'deactivate' ? t('team.yes_deactivate') : t('team.yes_reactivate')}
        onConfirm={doToggleActive}
      >
        {confirmDialog.action === 'deactivate' && (
          <ul className="space-y-1 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
            <li>• {t('team.deactivate_effect_session')}</li>
            <li>• {t('team.deactivate_effect_login')}</li>
            <li>• {t('team.deactivate_effect_sales')}</li>
          </ul>
        )}
      </ConfirmModal>

      {/* Suppression définitive */}
      <ConfirmModal
        open={deleteDialog.open}
        onOpenChange={open => { if (!open && !deleting) setDeleteDialog({ open: false, member: null }) }}
        title={t('team.delete_title')}
        description={t('team.delete_confirm', { name: deleteDialog.member?.profiles?.full_name })}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('actions.delete')}
        loading={deleting}
        onConfirm={async () => { await doDeleteMember(); setSheetMemberId(null) }}
      >
        <ul className="space-y-1 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
          <li>• {t('team.delete_effect_permanent')}</li>
          <li>• {t('team.deactivate_effect_login')}</li>
          <li>• {t('team.deactivate_effect_sales')}</li>
          <li>• {t('team.delete_effect_irreversible')}</li>
        </ul>
      </ConfirmModal>

      {/* Invitation : formulaire court → modale */}
      <PremiumDialog
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        title={t('team.invite_title')}
        icon={<UserPlus className="h-4 w-4" />}
        maxWidth="max-w-md"
        dirty={!!inviteEmail.trim() || !!inviteFullName.trim()}
        testId="invite-dialog"
      >
        <PremiumDialogBody>
          {isOwner && userShops.length > 1 && (
            <div className="space-y-1.5">
              <Label>{t('team.shop')}<RequiredMark /></Label>
              <Select value={inviteShopId} onValueChange={setInviteShopId}>
                <SelectTrigger className="h-10">
                  <Store className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userShops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{t('team.full_name')}<RequiredMark /></Label>
            <Input
              id="invite-name"
              name="full_name"
              value={inviteFullName}
              onChange={e => { setInviteFullName(e.target.value); if (inviteErrors.name) setInviteErrors(x => ({ ...x, name: undefined })) }}
              placeholder={t('team.name_placeholder')}
              aria-invalid={!!inviteErrors.name}
            />
            {inviteErrors.name && <p className="text-xs text-destructive">{inviteErrors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{t('team.invite_email')}<RequiredMark /></Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="invite-email"
                name="email"
                type="email"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); if (inviteErrors.email) setInviteErrors(x => ({ ...x, email: undefined })) }}
                className="pl-9"
                placeholder="employe@email.com"
                aria-invalid={!!inviteErrors.email}
              />
            </div>
            {inviteErrors.email && <p className="text-xs text-destructive">{inviteErrors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t('team.role_label')}</Label>
            <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {assignableRoles.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg bg-stockshop-blue-muted dark:bg-blue-950/30 border border-stockshop-blue/20 dark:border-blue-800/40 p-3 text-sm text-stockshop-blue dark:text-blue-400">
            {t('team.invite_info')}
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setShowInviteModal(false)}
          cancelLabel={t('actions.cancel')}
          onConfirm={inviteEmployee}
          confirmLabel={t('team.send_invite')}
          confirmLoading={inviting}
          confirmIcon={<Send className="h-4 w-4" />}
        />
      </PremiumDialog>
    </div>
  )
}
