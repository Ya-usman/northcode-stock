'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  UserPlus, Shield, Clock, Mail, ShieldOff, ShieldCheck,
  AlertTriangle, Trash2, Store, ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { UserRole } from '@/lib/types/database'
import { cn } from '@/lib/utils/cn'

const supabase = createClient() as any

const ROLE_COLORS: Record<string, string> = {
  owner:         'bg-northcode-blue text-white',
  cashier:       'bg-green-100 text-green-700',
  stock_manager: 'bg-amber-100 text-amber-700',
  viewer:        'bg-gray-100 text-gray-600',
  super_admin:   'bg-purple-100 text-purple-700',
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire', cashier: 'Caissier', stock_manager: 'Gestionnaire stock',
  viewer: 'Lecteur', super_admin: 'Super Admin',
}

interface Member {
  id: string          // shop_members.id
  user_id: string
  shop_id: string
  role: UserRole
  is_active: boolean
  can_delete_sales: boolean
  joined_at: string
  profiles: {
    id: string
    full_name: string
    last_seen: string | null
    is_active: boolean
  } | null
}

export default function TeamPage() {
  const t = useTranslations()
  const { profile: myProfile, shop, userShops } = useAuth()
  const { toast } = useToast()

  // Which shop's team we're viewing
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

  // Deactivation confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; member: Member | null; action: 'deactivate' | 'reactivate'
  }>({ open: false, member: null, action: 'deactivate' })

  // Delete confirm dialog
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; member: Member | null }>({ open: false, member: null })
  const [deleting, setDeleting] = useState(false)

  const isOwner = myProfile?.role === 'owner' || myProfile?.role === 'super_admin'

  // Sync viewShopId when shop loads
  useEffect(() => {
    if (shop?.id && !viewShopId) setViewShopId(shop.id)
    if (shop?.id && !inviteShopId) setInviteShopId(shop.id)
  }, [shop?.id])

  const fetchMembers = async () => {
    if (!viewShopId) return
    setLoading(true)
    try {
      // Step 1: get shop_members
      const { data: membersData, error: membersError } = await supabase
        .from('shop_members')
        .select('id, user_id, shop_id, role, is_active, can_delete_sales, joined_at')
        .eq('shop_id', viewShopId)
        .order('role')

      if (membersError) {
        toast({ title: membersError.message, variant: 'destructive' })
        setLoading(false)
        return
      }

      const rows = (membersData || []) as any[]
      if (rows.length === 0) { setMembers([]); setLoading(false); return }

      // Step 2: get profiles for those user_ids (admin-level read via service key not needed — just read all visible profiles)
      const userIds = rows.map(r => r.user_id)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, last_seen, is_active')
        .in('id', userIds)

      const profilesMap: Record<string, any> = {}
      ;(profilesData || []).forEach((p: any) => { profilesMap[p.id] = p })

      // Merge
      setMembers(rows.map(m => ({
        ...m,
        can_delete_sales: m.can_delete_sales ?? false,
        profiles: profilesMap[m.user_id] ?? { id: m.user_id, full_name: 'Invité', last_seen: null, is_active: m.is_active },
      })) as Member[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMembers() }, [viewShopId])

  const changeRole = async (member: Member, newRole: UserRole) => {
    if (member.user_id === myProfile?.id) {
      toast({ title: t('toast.cannot_edit_own_role'), variant: 'destructive' })
      return
    }
    setActionLoading(member.id + '_role')
    const { error } = await supabase.from('shop_members').update({ role: newRole as string }).eq('id', member.id)
    setActionLoading(null)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: t('toast.role_updated'), variant: 'success' })
    fetchMembers()
  }

  const toggleCanDelete = async (member: Member) => {
    setActionLoading(member.id + '_del')
    const newVal = !member.can_delete_sales
    const res = await fetch('/api/team/permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: member.shop_id, user_id: member.user_id, can_delete_sales: newVal }),
    })
    const json = await res.json()
    setActionLoading(null)
    if (!res.ok) { toast({ title: json.error, variant: 'destructive' }); return }
    toast({ title: newVal ? t('toast.delete_permission_on') : t('toast.delete_permission_off'), variant: 'success' })
    fetchMembers()
  }

  const confirmToggleActive = (member: Member) => {
    if (member.user_id === myProfile?.id) {
      toast({ title: t('toast.cannot_deactivate_self'), variant: 'destructive' })
      return
    }
    setConfirmDialog({ open: true, member, action: member.is_active ? 'deactivate' : 'reactivate' })
  }

  const doToggleActive = async () => {
    const { member, action } = confirmDialog
    if (!member) return
    setConfirmDialog(d => ({ ...d, open: false }))
    setActionLoading(member.id)
    try {
      const res = await fetch('/api/team/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: member.user_id,
          is_active: action === 'reactivate',
          shop_id: member.shop_id,
        }),
      })
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
      const res = await fetch('/api/team/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: member.user_id, shop_id: member.shop_id }),
      })
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
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteFullName,
          role: inviteRole,
          shop_id: inviteShopId || shop?.id,
          invited_by: myProfile?.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      toast({ title: t('toast.invite_sent', { email: inviteEmail }), variant: 'success' })
      setShowInviteModal(false)
      setInviteEmail(''); setInviteFullName('')
      if (inviteShopId === viewShopId) fetchMembers()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }

  const activeCount = members.filter(m => m.is_active && m.user_id !== myProfile?.id).length
  const inactiveCount = members.filter(m => !m.is_active).length
  const viewShopName = userShops.find(s => s.id === viewShopId)?.name || shop?.name || ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-lg">Équipe</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {members.length} membre(s) · {activeCount} actif(s)
            {inactiveCount > 0 && <span className="text-red-500 ml-1">· {inactiveCount} désactivé(s)</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Shop selector (if owner with multiple shops) */}
          {isOwner && userShops.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShopPickerOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50 transition-colors"
              >
                <Store className="h-4 w-4 text-northcode-blue" />
                <span className="max-w-[120px] truncate">{viewShopName}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
              </button>
              {shopPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShopPickerOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border bg-white shadow-lg p-1.5">
                    {userShops.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setViewShopId(s.id); setShopPickerOpen(false) }}
                        className={cn(
                          'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                          viewShopId === s.id ? 'bg-northcode-blue-muted text-northcode-blue font-medium' : 'hover:bg-gray-50 text-gray-700'
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

          <Button
            className="gap-2 bg-northcode-blue hover:bg-northcode-blue-light"
            onClick={() => { setInviteShopId(viewShopId); setShowInviteModal(true) }}
          >
            <UserPlus className="h-4 w-4" />
            Inviter
          </Button>
        </div>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="space-y-3">
          {members.map(member => {
            const p = member.profiles
            if (!p) return null
            const initials = p.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
            const isMe = member.user_id === myProfile?.id
            const isLoading = actionLoading === member.id || actionLoading === member.id + '_role' || actionLoading === member.id + '_del'
            const isOnline = p.last_seen && (Date.now() - new Date(p.last_seen).getTime()) < 5 * 60 * 1000

            return (
              <div
                key={member.id}
                className={`rounded-xl border bg-white shadow-sm p-4 transition-opacity ${
                  !member.is_active ? 'opacity-60 border-red-100 bg-red-50/30' : ''
                }`}
              >
                {/* Top row: avatar + info */}
                <div className="flex items-start gap-3">
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className={`text-white text-sm font-bold ${member.is_active ? 'bg-northcode-blue' : 'bg-gray-400'}`}>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    {member.is_active && p.last_seen && (
                      <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm truncate max-w-[160px]">{p.full_name}</p>
                      {isMe && <Badge variant="outline" className="text-[10px] px-1.5 flex-shrink-0">Moi</Badge>}
                      {!member.is_active && <Badge className="text-[10px] bg-red-100 text-red-600 border-red-200 flex-shrink-0">Désactivé</Badge>}
                      {member.can_delete_sales && (
                        <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200 gap-0.5 flex-shrink-0">
                          <Trash2 className="h-2.5 w-2.5" /> Peut supprimer
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[member.role] || ROLE_COLORS.viewer}`}>
                        <Shield className="h-2.5 w-2.5" />
                        {ROLE_LABELS[member.role] || member.role}
                      </span>
                      {member.is_active && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {isOnline ? 'En ligne' : 'Hors ligne'}
                        </span>
                      )}
                      {p.last_seen && !isOnline && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(p.last_seen), { addSuffix: true, locale: fr })}
                        </span>
                      )}
                      {!p.last_seen && (
                        <span className="text-[10px] text-muted-foreground italic">Jamais connecté</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions — below info, wraps on small screens */}
                {!isMe && member.role !== 'owner' && isOwner && (
                  <div className="mt-3 pt-3 border-t flex flex-wrap gap-2 items-center">
                    {/* Role selector */}
                    <Select
                      value={member.role}
                      onValueChange={v => changeRole(member, v as UserRole)}
                      disabled={isLoading || !member.is_active}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashier">Caissier</SelectItem>
                        <SelectItem value="stock_manager">Gest. stock</SelectItem>
                        <SelectItem value="viewer">Lecteur</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Activate / Deactivate */}
                    <Button
                      size="sm" variant="outline" disabled={isLoading}
                      onClick={() => confirmToggleActive(member)}
                      className={`h-8 gap-1.5 text-xs ${
                        member.is_active
                          ? 'border-red-200 text-red-600 hover:bg-red-50'
                          : 'border-green-200 text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {isLoading && actionLoading === member.id ? (
                        <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : member.is_active ? (
                        <><ShieldOff className="h-3 w-3" /> Désactiver</>
                      ) : (
                        <><ShieldCheck className="h-3 w-3" /> Réactiver</>
                      )}
                    </Button>

                    {/* Delete permanently */}
                    <Button
                      size="sm" variant="outline" disabled={isLoading}
                      onClick={() => setDeleteDialog({ open: true, member })}
                      className="h-8 w-8 p-0 border-red-300 text-red-600 hover:bg-red-50"
                      title="Supprimer définitivement"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>

                    {/* can_delete_sales toggle — only for cashier */}
                    {member.role === 'cashier' && (
                      <button
                        onClick={() => toggleCanDelete(member)}
                        disabled={isLoading}
                        className={`flex items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 transition-colors ${
                          member.can_delete_sales
                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        <Trash2 className="h-3 w-3" />
                        {member.can_delete_sales ? 'Peut suppr. ✓' : 'Autoriser suppr.'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {members.length === 0 && !loading && (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm rounded-xl border bg-white">
              Aucun membre dans cette boutique
            </div>
          )}
        </div>
      )}

      {/* Confirm deactivation dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmDialog.action === 'deactivate'
                ? <><ShieldOff className="h-5 w-5 text-red-500" /> Désactiver le compte</>
                : <><ShieldCheck className="h-5 w-5 text-green-500" /> Réactiver le compte</>}
            </DialogTitle>
          </DialogHeader>
          <div>
            {confirmDialog.action === 'deactivate' ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 p-3">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-700">
                  <p className="font-semibold mb-1">Désactiver <span className="text-red-800">{confirmDialog.member?.profiles?.full_name}</span> ?</p>
                  <ul className="text-xs space-y-1 text-red-600">
                    <li>• Session révoquée <strong>immédiatement</strong></li>
                    <li>• Il ne pourra plus se connecter</li>
                    <li>• Ses ventes restent conservées</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-100 p-3">
                <ShieldCheck className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-green-700">
                  <span className="font-semibold">{confirmDialog.member?.profiles?.full_name}</span> pourra se reconnecter avec ses identifiants.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}>Annuler</Button>
            <Button
              size="sm" onClick={doToggleActive}
              className={confirmDialog.action === 'deactivate' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}
            >
              {confirmDialog.action === 'deactivate' ? 'Oui, désactiver' : 'Oui, réactiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete permanently dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={open => !open && setDeleteDialog({ open: false, member: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Supprimer définitivement
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 p-3">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <p className="font-semibold mb-1">Supprimer <span className="text-red-800">{deleteDialog.member?.profiles?.full_name}</span> ?</p>
              <ul className="text-xs space-y-1 text-red-600">
                <li>• Compte supprimé <strong>définitivement</strong></li>
                <li>• Il ne pourra plus se connecter</li>
                <li>• Ses ventes restent conservées</li>
                <li>• Cette action est <strong>irréversible</strong></li>
              </ul>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteDialog({ open: false, member: null })}>Annuler</Button>
            <Button
              size="sm" onClick={doDeleteMember} disabled={deleting}
              className="bg-red-600 hover:bg-red-700 gap-1.5"
            >
              {deleting ? <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un employé</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Shop selector in invite */}
            {isOwner && userShops.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Boutique *</Label>
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
            <div className="space-y-1">
              <Label>Nom complet *</Label>
              <Input value={inviteFullName} onChange={e => setInviteFullName(e.target.value)} placeholder="Nom de l'employé" />
            </div>
            <div className="space-y-1">
              <Label>Email *</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="pl-9" placeholder="employe@email.com" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rôle</Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">Caissier</SelectItem>
                  <SelectItem value="stock_manager">Gestionnaire stock</SelectItem>
                  <SelectItem value="viewer">Lecteur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Un email d'invitation sera envoyé. L'employé définira son mot de passe.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>Annuler</Button>
            <Button onClick={inviteEmployee} loading={inviting} className="bg-northcode-blue">
              Envoyer l'invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
