'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  UserPlus, Shield, Mail, ShieldOff, ShieldCheck,
  AlertTriangle, Trash2, Store, ChevronDown, RotateCcw,
  CheckCircle2, Clock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
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

const supabase = createClient() as any

const ROLE_COLORS: Record<string, string> = {
  owner:         'bg-stockshop-blue dark:bg-blue-500 text-white',
  shop_manager:  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  manager:       'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
  cashier:       'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  stock_manager: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  viewer:        'bg-muted text-muted-foreground',
  super_admin:   'bg-purple-100 text-purple-700',
}

const ROLE_AVATAR_COLORS: Record<string, string> = {
  owner:         'bg-blue-600 dark:bg-blue-500',
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
  const { profile: myProfile, shop, userShops, effectiveShopIds, dashboardShopFilter } = useAuth()
  const { toast } = useToast()

  const [viewShopId, setViewShopId] = useState<string>(shop?.id || '')
  const [shopPickerOpen, setShopPickerOpen] = useState(false)
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

  const isOwner = myProfile?.role === 'owner' || myProfile?.role === 'manager' || myProfile?.role === 'shop_manager' || myProfile?.role === 'super_admin'

  useEffect(() => {
    if (dashboardShopFilter) {
      setViewShopId(dashboardShopFilter)
      setInviteShopId(dashboardShopFilter)
    } else if (shop?.id) {
      if (!viewShopId) setViewShopId(shop.id)
      if (!inviteShopId) setInviteShopId(shop.id)
    }
  }, [shop?.id, dashboardShopFilter])

  const withTimeout = (p: Promise<any>, ms = 15_000) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connexion trop lente — réessayez.')), ms))])

  const fetchMembers = useCallback(async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `team_${effectiveShopIds.join(',')}`
    const cached = getPageCache<Member[]>(cacheKey)
    if (cached) { setMembers(cached); setLoading(false) }
    else setLoading(true)

    try {
      const results = await Promise.all(
        effectiveShopIds.map(sid =>
          supabase.from('shop_members')
            .select('id, user_id, shop_id, role, is_active, joined_at')
            .eq('shop_id', sid)
            .order('role')
        )
      )

      const rows = results.flatMap(r => (r.data || []) as any[])
      if (rows.length === 0) { setMembers([]); setLoading(false); return }

      const userIds = Array.from(new Set(rows.map((r: any) => r.user_id))) as string[]

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, last_seen, is_active')
        .in('id', userIds)

      const profilesMap: Record<string, any> = {}
      ;(profilesData || []).forEach((p: any) => { profilesMap[p.id] = p })

      const membersArray = rows.map(m => ({
        ...m,
        profiles: profilesMap[m.user_id] ?? { id: m.user_id, full_name: '—', last_seen: null, is_active: m.is_active },
      })) as Member[]

      setMembers(membersArray)
      setPageCache(cacheKey, membersArray)

      // Fetch auth status (email confirmed, last sign in) for owners/managers only
      if (isOwner && viewShopId) {
        try {
          const res = await fetch('/api/team/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: userIds, shop_id: viewShopId }),
          })
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
  }, [effectiveShopIds.join(','), isOwner, viewShopId])

  useEffect(() => { fetchMembers() }, [effectiveShopIds.join(',')])

  const changeRole = async (member: Member, newRole: UserRole) => {
    if (member.user_id === myProfile?.id) {
      toast({ title: t('toast.cannot_edit_own_role'), variant: 'destructive' })
      return
    }
    setActionLoading(member.id + '_role')
    supabase.auth.getSession().catch(() => {})
    try {
      const { error } = await withTimeout(
        supabase.from('shop_members').update({ role: newRole as string }).eq('id', member.id)
      )
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: t('toast.role_updated'), variant: 'success' })
      fetchMembers()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
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
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const inviteEmployee = async () => {
    if (!inviteEmail || !inviteFullName) {
      toast({ title: t('toast.invite_fields_required'), variant: 'destructive' })
      return
    }
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
      if (inviteShopId === viewShopId) fetchMembers()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }

  const resendInvite = async (member: Member) => {
    const email = member.email || member.profiles?.full_name
    if (!email?.includes('@')) {
      toast({ title: "Email introuvable pour cet employé", variant: 'destructive' })
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
      toast({ title: `Invitation renvoyée à ${email}`, variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const displayedMembers = viewShopId
    ? members.filter(m => m.shop_id === viewShopId)
    : members

  const activeCount = displayedMembers.filter(m => m.is_active).length
  const pendingCount = displayedMembers.filter(m => m.authStatus && !m.authStatus.email_confirmed_at).length
  const viewShopName = userShops.find(s => s.id === viewShopId)?.name || shop?.name || ''

  const renderMemberStatus = (member: Member) => {
    const p = member.profiles
    const auth = member.authStatus
    const lastSeenMs = p?.last_seen ? Date.now() - new Date(p.last_seen).getTime() : Infinity
    const isOnline = lastSeenMs < 5 * 60 * 1000
    const isAway = !isOnline && lastSeenMs < 2 * 60 * 60 * 1000

    // Email not confirmed → invitation pending
    if (auth && !auth.email_confirmed_at) {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
            <AlertTriangle className="h-3 w-3" />
            Invitation en attente
          </span>
          {isOwner && (
            <button
              onClick={() => resendInvite(member)}
              disabled={actionLoading === member.id + '_resend'}
              className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {actionLoading === member.id + '_resend'
                ? <span className="h-2.5 w-2.5 rounded-full border border-current border-t-transparent animate-spin" />
                : <RotateCcw className="h-2.5 w-2.5" />}
              Renvoyer
            </button>
          )}
        </div>
      )
    }

    // Email confirmed but never signed in
    if (auth && auth.email_confirmed_at && !auth.last_sign_in_at) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-500" />
          Email confirmé · jamais connecté
        </span>
      )
    }

    // Last sign in (from auth) takes priority over last_seen
    if (auth?.last_sign_in_at) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', isOnline ? 'bg-green-500' : isAway ? 'bg-amber-400' : 'bg-gray-400')} />
          {isOnline ? 'En ligne' : formatDistanceToNow(new Date(p?.last_seen || auth.last_sign_in_at), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      )
    }

    // Fallback: use last_seen from profiles
    if (p?.last_seen) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', isOnline ? 'bg-green-500' : isAway ? 'bg-amber-400' : 'bg-gray-400')} />
          {isOnline ? 'En ligne' : formatDistanceToNow(new Date(p.last_seen), { addSuffix: true, locale: dateFnsLocale })}
        </span>
      )
    }

    return <span className="text-[10px] text-muted-foreground italic">{t('team.never_connected')}</span>
  }

  const renderMember = (member: Member) => {
    const p = member.profiles
    if (!p) return null
    const initials = p.full_name.split(' ').filter(Boolean).map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?'
    const isMe = member.user_id === myProfile?.id
    const isLoadingAction = actionLoading === member.id || actionLoading === member.id + '_role'
    const emailNotConfirmed = member.authStatus && !member.authStatus.email_confirmed_at

    return (
      <div
        key={member.id}
        className={cn(
          'rounded-xl border bg-card shadow-sm transition-all',
          !member.is_active && 'opacity-60 border-red-100 dark:border-red-900/30 bg-red-50/20 dark:bg-red-950/10',
          emailNotConfirmed && member.is_active && 'border-amber-200 dark:border-amber-800/40',
        )}
      >
        <div className="flex items-center gap-3 p-3.5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <Avatar className="h-9 w-9">
              <AvatarFallback className={cn('text-white text-xs font-bold', member.is_active ? (ROLE_AVATAR_COLORS[member.role] || 'bg-gray-500') : 'bg-gray-400')}>
                {initials}
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
              <p className="font-semibold text-sm leading-tight truncate max-w-[140px]">{p.full_name}</p>
              {isMe && <Badge variant="outline" className="text-[9px] px-1 h-4 flex-shrink-0">{t('team.me')}</Badge>}
              {!member.is_active && <Badge className="text-[9px] px-1.5 h-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border-red-200 flex-shrink-0">{t('team.deactivated_badge')}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', ROLE_COLORS[member.role] || ROLE_COLORS.viewer)}>
                <Shield className="h-2.5 w-2.5" />
                {t(`roles.${member.role}` as any) || member.role}
              </span>
              {renderMemberStatus(member)}
            </div>
          </div>

          {/* Joined date */}
          {member.joined_at && (
            <div className="hidden sm:flex flex-col items-end flex-shrink-0">
              <span className="text-[9px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {new Date(member.joined_at).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'short', year: '2-digit' })}
              </span>
            </div>
          )}
        </div>

        {/* Actions (owners/managers only, non-owner members) */}
        {!isMe && member.role !== 'owner' && isOwner && (
          <div className="flex items-center gap-2 px-3.5 pb-3 pt-0 border-t border-border/50 mt-0 pt-2.5">
            <Select
              value={member.role}
              onValueChange={v => changeRole(member, v as UserRole)}
              disabled={isLoadingAction || !member.is_active}
            >
              <SelectTrigger className="h-7 w-[130px] text-xs border-border/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shop_manager">{t('roles.shop_manager')}</SelectItem>
                <SelectItem value="manager">{t('roles.manager')}</SelectItem>
                <SelectItem value="cashier">{t('roles.cashier')}</SelectItem>
                <SelectItem value="stock_manager">{t('roles.stock_manager')}</SelectItem>
                <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                size="sm"
                variant="outline"
                disabled={isLoadingAction}
                onClick={() => setConfirmDialog({ open: true, member, action: member.is_active ? 'deactivate' : 'reactivate' })}
                className={cn('h-7 gap-1 text-xs px-2.5', member.is_active ? 'border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20' : 'border-green-200 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20')}
              >
                {isLoadingAction && actionLoading === member.id
                  ? <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  : member.is_active
                    ? <><ShieldOff className="h-3 w-3" />{t('team.deactivate')}</>
                    : <><ShieldCheck className="h-3 w-3" />{t('team.reactivate')}</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isLoadingAction}
                onClick={() => setDeleteDialog({ open: true, member })}
                className="h-7 w-7 p-0 border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                title={t('team.delete_title')}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-lg">{t('team.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeCount} {activeCount === 1 ? 'membre actif' : 'membres actifs'}
            {pendingCount > 0 && (
              <span className="text-amber-500 ml-1">· {pendingCount} invitation{pendingCount > 1 ? 's' : ''} en attente</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Shop selector */}
          {isOwner && userShops.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShopPickerOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
              >
                <Store className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
                <span className="max-w-[120px] truncate">{viewShopName}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
              </button>
              {shopPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShopPickerOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border bg-card shadow-lg p-1.5">
                    {userShops.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setViewShopId(s.id); setShopPickerOpen(false) }}
                        className={cn(
                          'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                          viewShopId === s.id
                            ? 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium'
                            : 'hover:bg-accent text-foreground/80'
                        )}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {isOwner && (
            <Button
              variant="stockshop"
              className="gap-2"
              disabled={inviting}
              onClick={() => { setInviteShopId(viewShopId); setShowInviteModal(true) }}
            >
              <UserPlus className="h-4 w-4" />
              {t('team.invite_btn')}
            </Button>
          )}
        </div>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="space-y-2.5">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
        </div>
      ) : displayedMembers.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm rounded-xl border bg-card">
          {t('team.no_members')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayedMembers.map(member => renderMember(member))}
        </div>
      )}

      {/* Confirm deactivation / reactivation dialog */}
      <PremiumDialog
        open={confirmDialog.open}
        onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}
        category={t('nav.team')}
        title={confirmDialog.action === 'deactivate' ? t('team.deactivate_title') : t('team.reactivate_title')}
        icon={confirmDialog.action === 'deactivate' ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          {confirmDialog.action === 'deactivate' ? (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 p-3">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-400">
                <p className="font-semibold mb-1">{t('team.deactivate_confirm', { name: confirmDialog.member?.profiles?.full_name })}</p>
                <ul className="text-xs space-y-1 text-red-600 dark:text-red-500">
                  <li>• {t('team.deactivate_effect_session')}</li>
                  <li>• {t('team.deactivate_effect_login')}</li>
                  <li>• {t('team.deactivate_effect_sales')}</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 p-3">
              <ShieldCheck className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-green-700 dark:text-green-400">{t('team.reactivate_confirm', { name: confirmDialog.member?.profiles?.full_name })}</p>
            </div>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setConfirmDialog(d => ({ ...d, open: false }))}
          cancelLabel={t('actions.cancel')}
          onConfirm={doToggleActive}
          confirmLabel={confirmDialog.action === 'deactivate' ? t('team.yes_deactivate') : t('team.yes_reactivate')}
          confirmDestructive={confirmDialog.action === 'deactivate'}
        />
      </PremiumDialog>

      {/* Delete dialog */}
      <PremiumDialog
        open={deleteDialog.open}
        onOpenChange={open => !open && setDeleteDialog({ open: false, member: null })}
        category={t('nav.team')}
        title={t('team.delete_title')}
        icon={<Trash2 className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 p-3">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-400">
              <p className="font-semibold mb-1">{t('team.delete_confirm', { name: deleteDialog.member?.profiles?.full_name })}</p>
              <ul className="text-xs space-y-1 text-red-600 dark:text-red-500">
                <li>• {t('team.delete_effect_permanent')}</li>
                <li>• {t('team.deactivate_effect_login')}</li>
                <li>• {t('team.deactivate_effect_sales')}</li>
                <li>• {t('team.delete_effect_irreversible')}</li>
              </ul>
            </div>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDeleteDialog({ open: false, member: null })}
          cancelLabel={t('actions.cancel')}
          onConfirm={doDeleteMember}
          confirmLabel={t('actions.delete')}
          confirmDisabled={deleting}
          confirmLoading={deleting}
          confirmDestructive
        />
      </PremiumDialog>

      {/* Invite modal */}
      <PremiumDialog
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        category={t('nav.team')}
        title={t('team.invite_title')}
        icon={<UserPlus className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          {isOwner && userShops.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t('team.shop_label')}</Label>
              <Select value={inviteShopId} onValueChange={setInviteShopId}>
                <SelectTrigger>
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
            <Label>{t('team.full_name_label')}</Label>
            <Input
              value={inviteFullName}
              onChange={e => setInviteFullName(e.target.value)}
              placeholder={t('team.name_placeholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('team.invite_email')} *</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="pl-9"
                placeholder="employe@email.com"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('team.role_label')}</Label>
            <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shop_manager">{t('roles.shop_manager')}</SelectItem>
                <SelectItem value="manager">{t('roles.manager')}</SelectItem>
                <SelectItem value="cashier">{t('roles.cashier')}</SelectItem>
                <SelectItem value="stock_manager">{t('roles.stock_manager')}</SelectItem>
                <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 p-3 text-sm text-blue-700 dark:text-blue-400">
            {t('team.invite_info')}
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setShowInviteModal(false)}
          cancelLabel={t('actions.cancel')}
          onConfirm={inviteEmployee}
          confirmLabel={t('team.send_invite')}
          confirmLoading={inviting}
        />
      </PremiumDialog>
    </div>
  )
}
