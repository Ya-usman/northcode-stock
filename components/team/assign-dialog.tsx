'use client'

// « Affecter un membre existant » — fenêtre UNIQUE (refonte du 5 oct. 2026) :
//  - depuis la fiche membre : la personne est fixée, on choisit la boutique ;
//  - depuis Boutique → Équipe : la boutique est fixée, on choisit la personne
//    parmi l'équipe du compte, avec un lien « Inviter un nouveau membre ».
// Jamais de nouvel utilisateur : /api/team/assign (droits, quota, doublon, audit).

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, UserPlus, Users } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { RequiredMark } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import type { Shop, UserRole } from '@/lib/types/database'
import { canManageRole, manageableRoles, isAccountOwner } from '@/lib/team/roles'
import { topRole, type TeamPerson } from '@/lib/team/use-team-people'
import { teamActions } from '@/lib/team/team-actions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Boutiques proposées (celles où l'appelant peut affecter) */
  shops: Shop[]
  roleByShop: Record<string, UserRole>
  people: TeamPerson[]
  fixedPerson?: TeamPerson
  fixedShopId?: string
  myUserId?: string | null
  onDone: () => void
  /** Boutique fixée : ouvre l'invitation d'une nouvelle personne */
  onInviteNew?: () => void
}

export function AssignDialog({ open, onOpenChange, shops, roleByShop, people, fixedPerson, fixedShopId, myUserId, onDone, onInviteNew }: Props) {
  const t = useTranslations()
  const { toast } = useToast()
  const [shopId, setShopId] = useState('')
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [saving, setSaving] = useState(false)

  const effectiveShopId = fixedShopId || shopId
  const callerRole = effectiveShopId ? roleByShop[effectiveShopId] : undefined

  // Personnes affectables à la boutique fixée
  const candidates = useMemo(() => {
    if (!fixedShopId) return []
    const r = roleByShop[fixedShopId]
    return people.filter(p =>
      p.user_id !== myUserId &&
      p.accountActive &&
      !p.memberships.some(m => m.shop_id === fixedShopId) &&
      !p.memberships.some(m => m.role === 'owner') &&
      p.memberships.length + p.suspendedMemberships.length > 0 &&
      (isAccountOwner(r) || p.memberships.every(m => canManageRole(r, m.role)))
    )
  }, [people, fixedShopId, roleByShop, myUserId])

  const person = fixedPerson || people.find(p => p.user_id === userId) || null
  const roleOptions = manageableRoles(callerRole)

  // Valeurs par défaut à l'ouverture
  useEffect(() => {
    if (!open) return
    setShopId(fixedShopId || (shops.length === 1 ? shops[0].id : ''))
    setUserId(fixedPerson?.user_id || '')
    setRole('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rôle proposé : celui que la personne a déjà ailleurs, s'il est attribuable
  useEffect(() => {
    if (!person || !roleOptions.length) return
    const current = topRole(person)
    setRole(prev => (prev && roleOptions.includes(prev as UserRole)) ? prev : (current && roleOptions.includes(current) ? current : (roleOptions.includes('cashier') ? 'cashier' : roleOptions[0])))
  }, [person?.user_id, effectiveShopId]) // eslint-disable-line react-hooks/exhaustive-deps

  const shopName = (id: string) => shops.find(s => s.id === id)?.name || ''
  const canSubmit = !!effectiveShopId && !!person && !!role && !saving

  const submit = async () => {
    if (!canSubmit || !person) return
    setSaving(true)
    const r = await teamActions.assign({ shop_id: effectiveShopId, user_id: person.user_id, role: role as string })
    setSaving(false)
    if (!r.ok) { toast({ title: r.error || t('toast.retry_error'), variant: 'destructive' }); return }
    toast({ title: t('team.assign_done', { name: person.full_name, shop: shopName(effectiveShopId) }), variant: 'success' })
    onOpenChange(false)
    onDone()
  }

  return (
    <PremiumDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('team.assign_title')}
      description={fixedPerson?.full_name || (fixedShopId ? shopName(fixedShopId) : undefined)}
      icon={<Store className="h-4 w-4" />}
      maxWidth="max-w-md"
      testId="assign-dialog"
    >
      <PremiumDialogBody>
        {!fixedShopId && (
          <div className="space-y-1.5">
            <Label>{t('team.shop')}<RequiredMark /></Label>
            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger className="h-10" data-testid="assign-shop"><Store className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>{shops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {!fixedPerson && (
          <div className="space-y-1.5">
            <Label>{t('team.assign_person')}<RequiredMark /></Label>
            {candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="assign-none">{t('team.assign_none')}</p>
            ) : (
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="h-10" data-testid="assign-person"><Users className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue placeholder={t('team.assign_person_placeholder')} /></SelectTrigger>
                <SelectContent>
                  {candidates.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}{topRole(p) ? ` · ${t(`roles.${topRole(p)}` as any)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
        {roleOptions.length > 0 && (
          <div className="space-y-1.5">
            <Label>{t('team.role_label')}<RequiredMark /></Label>
            <Select value={role} onValueChange={v => setRole(v as UserRole)} disabled={!effectiveShopId}>
              <SelectTrigger className="h-10" data-testid="assign-role"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>{roleOptions.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('team.assign_hint')}</p>
            <p className="text-xs text-muted-foreground" data-testid="assign-personal-rule">{t('team.assign_personal_rule')}</p>
          </div>
        )}
        {onInviteNew && (
          <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => { onOpenChange(false); onInviteNew() }} data-testid="assign-invite-new">
            <UserPlus className="h-4 w-4" />{t('team.invite_new')}
          </button>
        )}
      </PremiumDialogBody>
      <PremiumDialogFooter
        onCancel={() => onOpenChange(false)}
        cancelLabel={t('actions.cancel')}
        onConfirm={submit}
        confirmLabel={t('team.assign_confirm')}
        confirmLoading={saving}
        confirmDisabled={!canSubmit}
        confirmIcon={<Store className="h-4 w-4" />}
      />
    </PremiumDialog>
  )
}
