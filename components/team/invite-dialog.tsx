'use client'

// Inviter un NOUVEAU membre — fenêtre UNIQUE (page Équipe et Boutique → Équipe),
// extraite de l'ancienne page Équipe (5 oct. 2026). Si l'adresse appartient
// déjà à une personne du compte, le serveur répond « member_exists » : on
// propose alors « Affecter ce membre à cette boutique » au lieu d'une erreur
// (jamais de doublon d'utilisateur).

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { UserPlus, Mail, Send, Store, Info, AlertTriangle, UserCheck } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { RequiredMark } from '@/components/ui/input-group'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import type { Shop, UserRole } from '@/lib/types/database'
import { manageableRoles } from '@/lib/team/roles'
import { teamActions } from '@/lib/team/team-actions'
import { sharedAccountSignals } from '@/lib/team/shared-account-signals'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Boutiques où l'appelant peut inviter */
  shops: Shop[]
  defaultShopId?: string | null
  /** Boutique imposée (Boutique → Équipe) */
  fixedShopId?: string
  roleByShop: Record<string, UserRole>
  onDone: () => void
}

export function InviteDialog({ open, onOpenChange, shops, defaultShopId, fixedShopId, roleByShop, onDone }: Props) {
  const t = useTranslations()
  const { toast } = useToast()
  const [shopId, setShopId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('cashier')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [sending, setSending] = useState(false)
  const [existing, setExisting] = useState<{ user_id: string; full_name: string | null } | null>(null)

  const effectiveShopId = fixedShopId || shopId
  const roleOptions = manageableRoles(roleByShop[effectiveShopId])
  const shopName = shops.find(s => s.id === effectiveShopId)?.name || ''
  // Règle « un membre = une personne » : avertissement doux, jamais bloquant
  const signals = sharedAccountSignals({ fullName, email: /@/.test(email) ? email : '', shopNames: shops.map(s => s.name) })

  useEffect(() => {
    if (!open) return
    setShopId(fixedShopId || (defaultShopId && shops.some(s => s.id === defaultShopId) ? defaultShopId : shops[0]?.id || ''))
    setFullName(''); setEmail(''); setErrors({}); setExisting(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (roleOptions.length && !roleOptions.includes(role)) setRole(roleOptions.includes('cashier') ? 'cashier' : roleOptions[0])
  }, [effectiveShopId]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const e: { name?: string; email?: string } = {}
    if (!fullName.trim()) e.name = t('team.name_required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = t('errors.email_invalid')
    setErrors(e)
    if (e.name || e.email || !effectiveShopId) return
    setSending(true)
    const r = await teamActions.invite({ shop_id: effectiveShopId, email: email.trim(), full_name: fullName.trim(), role })
    setSending(false)
    if (!r.ok && r.code === 'member_exists') {
      setExisting({ user_id: (r.data as any).user_id, full_name: (r.data as any).full_name })
      return
    }
    if (!r.ok) {
      if (r.code === 'email_other_account') setErrors({ email: r.error })
      else toast({ title: r.error || t('toast.retry_error'), variant: 'destructive' })
      return
    }
    toast({ title: t('toast.invite_sent', { email: email.trim() }), variant: 'success' })
    onOpenChange(false)
    onDone()
  }

  const assignExisting = async () => {
    if (!existing) return
    setSending(true)
    const r = await teamActions.assign({ shop_id: effectiveShopId, user_id: existing.user_id, role })
    setSending(false)
    if (!r.ok) { toast({ title: r.error || t('toast.retry_error'), variant: 'destructive' }); return }
    toast({ title: t('team.assign_done', { name: existing.full_name || email, shop: shopName }), variant: 'success' })
    onOpenChange(false)
    onDone()
  }

  return (
    <PremiumDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('team.invite_title')}
      description={fixedShopId ? shopName : undefined}
      icon={<UserPlus className="h-4 w-4" />}
      maxWidth="max-w-md"
      dirty={!!email.trim() || !!fullName.trim()}
      testId="invite-dialog"
    >
      <PremiumDialogBody>
        {!fixedShopId && shops.length > 1 && (
          <div className="space-y-1.5">
            <Label>{t('team.shop')}<RequiredMark /></Label>
            <Select value={shopId} onValueChange={v => { setShopId(v); setExisting(null) }}>
              <SelectTrigger className="h-10"><Store className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>{shops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">{t('team.full_name')}<RequiredMark /></Label>
          <Input id="invite-name" name="full_name" value={fullName} placeholder={t('team.name_placeholder')} aria-invalid={!!errors.name}
            onChange={e => { setFullName(e.target.value); if (errors.name) setErrors(x => ({ ...x, name: undefined })) }} />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t('team.invite_email')}<RequiredMark /></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="invite-email" name="email" type="email" value={email} className="pl-9" placeholder="employe@email.com" aria-invalid={!!errors.email}
              onChange={e => { setEmail(e.target.value); setExisting(null); if (errors.email) setErrors(x => ({ ...x, email: undefined })) }} />
          </div>
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>{t('team.role_label')}</Label>
          <Select value={role} onValueChange={v => setRole(v as UserRole)}>
            <SelectTrigger className="h-10" data-testid="invite-role"><SelectValue /></SelectTrigger>
            <SelectContent>{roleOptions.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {signals.length > 0 && !existing && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300" data-testid="invite-shared-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{signals.includes('collective_name') ? t('team.shared_warning_name') : t('team.shared_warning_email')}</span>
          </div>
        )}
        {existing ? (
          <div className="space-y-3 rounded-lg border border-stockshop-blue/30 bg-stockshop-blue-muted p-3 dark:border-blue-800/50 dark:bg-blue-950/30" data-testid="invite-member-exists">
            <p className="flex items-start gap-2 text-sm text-stockshop-blue dark:text-blue-300">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              {t('team.member_exists_body', { name: existing.full_name || email, shop: shopName })}
            </p>
            <Button type="button" variant="stockshop" className="h-10 w-full gap-2" loading={sending} onClick={assignExisting} data-testid="invite-assign-existing">
              <Store className="h-4 w-4" />{t('team.member_exists_assign')}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5 rounded-lg border border-stockshop-blue/20 bg-stockshop-blue-muted p-3 text-sm text-stockshop-blue dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-400" data-testid="invite-personal-rule">
            <p className="flex items-start gap-2 font-medium"><UserCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />{t('team.personal_account_rule')}</p>
            <p className="pl-6 text-xs opacity-90">{t('team.invite_info')}</p>
          </div>
        )}
      </PremiumDialogBody>
      <PremiumDialogFooter
        onCancel={() => onOpenChange(false)}
        cancelLabel={t('actions.cancel')}
        onConfirm={send}
        confirmLabel={t('team.send_invite')}
        confirmLoading={sending && !existing}
        confirmDisabled={!!existing || !effectiveShopId}
        confirmIcon={<Send className="h-4 w-4" />}
      />
    </PremiumDialog>
  )
}
