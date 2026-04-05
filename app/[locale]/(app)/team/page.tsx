'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { UserPlus, Shield, Clock, Mail, ShieldOff, ShieldCheck, AlertTriangle } from 'lucide-react'
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
import type { Profile, UserRole } from '@/lib/types/database'

const supabase = createClient()

const ROLE_COLORS: Record<UserRole, string> = {
  owner: 'bg-northcode-blue text-white',
  cashier: 'bg-green-100 text-green-700',
  stock_manager: 'bg-amber-100 text-amber-700',
  viewer: 'bg-gray-100 text-gray-600',
}

export default function TeamPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const { profile: myProfile, shop } = useAuth()
  const { toast } = useToast()

  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviting, setInviting] = useState(false)

  // Deactivation confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    employee: Profile | null
    action: 'deactivate' | 'reactivate'
  }>({ open: false, employee: null, action: 'deactivate' })

  const fetchEmployees = async () => {
    if (!shop?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('shop_id', shop.id)
      .order('role')
      .order('full_name')
    setEmployees((data || []) as Profile[])
    setLoading(false)
  }

  useEffect(() => { fetchEmployees() }, [shop?.id])

  const inviteEmployee = async () => {
    if (!inviteEmail || !inviteFullName) {
      toast({ title: 'Veuillez remplir tous les champs', variant: 'destructive' })
      return
    }
    setInviting(true)
    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          full_name: inviteFullName,
          role: inviteRole,
          shop_id: shop!.id,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Erreur')
      toast({ title: t('team.invite_sent', { email: inviteEmail }), variant: 'success' })
      setShowInviteModal(false)
      setInviteEmail('')
      setInviteFullName('')
      fetchEmployees()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }

  const changeRole = async (employeeId: string, newRole: UserRole) => {
    if (employeeId === myProfile?.id) {
      toast({ title: t('team.cannot_delete_owner'), variant: 'destructive' })
      return
    }
    setActionLoading(employeeId + '_role')
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', employeeId)
    setActionLoading(null)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: 'Rôle mis à jour', variant: 'success' })
    fetchEmployees()
  }

  const confirmToggleActive = (employee: Profile) => {
    if (employee.id === myProfile?.id) {
      toast({ title: 'Vous ne pouvez pas désactiver votre propre compte', variant: 'destructive' })
      return
    }
    setConfirmDialog({
      open: true,
      employee,
      action: employee.is_active ? 'deactivate' : 'reactivate',
    })
  }

  const doToggleActive = async () => {
    const { employee, action } = confirmDialog
    if (!employee) return

    setConfirmDialog(d => ({ ...d, open: false }))
    setActionLoading(employee.id)

    try {
      const res = await fetch('/api/team/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employee.id,
          is_active: action === 'reactivate',
          shop_id: shop!.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast({
        title: action === 'deactivate'
          ? `${employee.full_name} a été désactivé(e). Session révoquée immédiatement.`
          : `${employee.full_name} a été réactivé(e).`,
        variant: action === 'deactivate' ? 'default' : 'success',
      })
      fetchEmployees()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const activeCount = employees.filter(e => e.is_active && e.id !== myProfile?.id).length
  const inactiveCount = employees.filter(e => !e.is_active).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-lg">{t('team.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {employees.length} membre(s) · {activeCount} actif(s)
            {inactiveCount > 0 && <span className="text-red-500 ml-1">· {inactiveCount} désactivé(s)</span>}
          </p>
        </div>
        <Button
          className="gap-2 bg-northcode-blue hover:bg-northcode-blue-light"
          onClick={() => setShowInviteModal(true)}
        >
          <UserPlus className="h-4 w-4" />
          {t('team.invite_employee')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="space-y-3">
          {employees.map(employee => {
            const initials = employee.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
            const isMe = employee.id === myProfile?.id
            const isLoading = actionLoading === employee.id || actionLoading === employee.id + '_role'

            return (
              <div
                key={employee.id}
                className={`rounded-xl border bg-white shadow-sm p-4 transition-opacity ${
                  !employee.is_active ? 'opacity-60 border-red-100 bg-red-50/30' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className={`text-white text-sm font-bold ${
                        employee.is_active ? 'bg-northcode-blue' : 'bg-gray-400'
                      }`}>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    {/* Online indicator */}
                    {employee.is_active && employee.last_seen && (
                      (() => {
                        const diff = Date.now() - new Date(employee.last_seen).getTime()
                        const isOnline = diff < 5 * 60 * 1000 // within 5 minutes
                        return (
                          <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                            isOnline ? 'bg-green-500' : 'bg-gray-300'
                          }`} />
                        )
                      })()
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{employee.full_name}</p>
                      {isMe && <Badge variant="outline" className="text-[10px] px-1.5">Moi</Badge>}
                      {!employee.is_active && (
                        <Badge className="text-[10px] bg-red-100 text-red-600 border-red-200">
                          Désactivé
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[employee.role]}`}>
                        <Shield className="h-2.5 w-2.5" />
                        {t(`roles.${employee.role}`)}
                      </span>
                      {employee.last_seen ? (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(employee.last_seen), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Jamais connecté</span>
                      )}
                    </div>
                  </div>

                  {/* Actions (not for self, not for owner) */}
                  {!isMe && employee.role !== 'owner' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Role selector */}
                      <Select
                        value={employee.role}
                        onValueChange={v => changeRole(employee.id, v as UserRole)}
                        disabled={isLoading || !employee.is_active}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cashier">{t('roles.cashier')}</SelectItem>
                          <SelectItem value="stock_manager">{t('roles.stock_manager')}</SelectItem>
                          <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Activate / Deactivate button */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isLoading}
                        onClick={() => confirmToggleActive(employee)}
                        className={`h-8 gap-1.5 text-xs ${
                          employee.is_active
                            ? 'border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300'
                            : 'border-green-200 text-green-600 hover:bg-green-50 hover:border-green-300'
                        }`}
                      >
                        {isLoading ? (
                          <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        ) : employee.is_active ? (
                          <><ShieldOff className="h-3 w-3" /> Désactiver</>
                        ) : (
                          <><ShieldCheck className="h-3 w-3" /> Réactiver</>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm deactivation dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmDialog.action === 'deactivate' ? (
                <><ShieldOff className="h-5 w-5 text-red-500" /> Désactiver le compte</>
              ) : (
                <><ShieldCheck className="h-5 w-5 text-green-500" /> Réactiver le compte</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {confirmDialog.action === 'deactivate' ? (
              <>
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 p-3">
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">
                    <p className="font-semibold mb-1">
                      Désactiver <span className="text-red-800">{confirmDialog.employee?.full_name}</span> ?
                    </p>
                    <ul className="text-xs space-y-1 text-red-600">
                      <li>• La session sera révoquée <strong>immédiatement</strong></li>
                      <li>• Il ne pourra plus se connecter</li>
                      <li>• Ses ventes et données restent conservées</li>
                      <li>• Vous pouvez le réactiver à tout moment</li>
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-100 p-3">
                <ShieldCheck className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-green-700">
                  <p className="font-semibold mb-1">
                    Réactiver <span className="text-green-800">{confirmDialog.employee?.full_name}</span> ?
                  </p>
                  <p className="text-xs text-green-600">
                    L'employé pourra se reconnecter avec ses identifiants habituels.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={doToggleActive}
              className={confirmDialog.action === 'deactivate'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
              }
            >
              {confirmDialog.action === 'deactivate' ? 'Oui, désactiver' : 'Oui, réactiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.invite_employee')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nom complet *</Label>
              <Input value={inviteFullName} onChange={e => setInviteFullName(e.target.value)} placeholder="Nom de l'employé" />
            </div>
            <div className="space-y-1">
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
            <div className="space-y-1">
              <Label>{t('team.assign_role')}</Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">{t('roles.cashier')}</SelectItem>
                  <SelectItem value="stock_manager">{t('roles.stock_manager')}</SelectItem>
                  <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Un email d'invitation sera envoyé. L'employé définira son propre mot de passe.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>{t('actions.cancel')}</Button>
            <Button onClick={inviteEmployee} loading={inviting} className="bg-northcode-blue">
              {t('team.invite_employee')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Login page inactive message */}
    </div>
  )
}
