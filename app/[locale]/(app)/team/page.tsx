'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { UserPlus, Shield, Clock, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/use-auth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatDistanceToNow } from 'date-fns'
import type { Profile, UserRole } from '@/lib/types/database'

const ROLE_COLORS: Record<UserRole, string> = {
  owner: 'bg-northcode-blue text-white',
  cashier: 'bg-green-100 text-green-700',
  stock_manager: 'bg-amber-100 text-amber-700',
  viewer: 'bg-gray-100 text-gray-600',
}

export default function TeamPage() {
  const t = useTranslations()
  const { profile: myProfile, shop } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [employees, setEmployees] = useState<(Profile & { email?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviting, setInviting] = useState(false)

  const fetchEmployees = async () => {
    if (!shop?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('shop_id', shop.id)
      .order('created_at')
    setEmployees((data || []) as Profile[])
    setLoading(false)
  }

  useEffect(() => { fetchEmployees() }, [shop?.id])

  const inviteEmployee = async () => {
    if (!inviteEmail || !inviteFullName) {
      toast({ title: 'Please fill all fields', variant: 'destructive' })
      return
    }
    setInviting(true)
    try {
      // Use Supabase Admin to invite user
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
      if (!response.ok) throw new Error('Failed to send invite')
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
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', employeeId)
    if (error) { toast({ title: error.message, variant: 'destructive' }); return }
    toast({ title: 'Role updated', variant: 'success' })
    fetchEmployees()
  }

  const toggleActive = async (employee: Profile) => {
    if (employee.id === myProfile?.id) {
      toast({ title: 'Cannot deactivate your own account', variant: 'destructive' })
      return
    }
    await supabase.from('profiles').update({ is_active: !employee.is_active }).eq('id', employee.id)
    toast({ title: employee.is_active ? 'Account deactivated' : 'Account reactivated', variant: 'success' })
    fetchEmployees()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
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
            const initials = employee.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
            const isMe = employee.id === myProfile?.id
            return (
              <div key={employee.id} className={`rounded-lg border bg-white shadow-sm p-4 ${!employee.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-northcode-blue text-white text-sm">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{employee.full_name}</p>
                      {isMe && <Badge variant="outline" className="text-[10px] px-1.5">You</Badge>}
                      {!employee.is_active && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[employee.role]}`}>
                        <Shield className="h-2.5 w-2.5" />
                        {t(`roles.${employee.role}`)}
                      </span>
                      {employee.last_seen && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(employee.last_seen), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>

                  {!isMe && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={employee.role}
                        onValueChange={(v) => changeRole(employee.id, v as UserRole)}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cashier">{t('roles.cashier')}</SelectItem>
                          <SelectItem value="stock_manager">{t('roles.stock_manager')}</SelectItem>
                          <SelectItem value="viewer">{t('roles.viewer')}</SelectItem>
                          <SelectItem value="owner">{t('roles.owner')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Switch
                        checked={employee.is_active}
                        onCheckedChange={() => toggleActive(employee)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Invite Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.invite_employee')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Full Name *</Label>
              <Input value={inviteFullName} onChange={e => setInviteFullName(e.target.value)} placeholder="Employee full name" />
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
                  placeholder="employee@email.com"
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
                  <SelectItem value="owner">{t('roles.owner')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              An email invitation will be sent. The employee will set their own password.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>{t('actions.cancel')}</Button>
            <Button onClick={inviteEmployee} loading={inviting} className="bg-northcode-blue">{t('team.invite_employee')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
