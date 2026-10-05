'use client'

// FICHE MEMBRE — composant UNIQUE ouvert depuis la page Équipe (vue globale)
// et depuis Boutique → Équipe (refonte du 5 oct. 2026). Identité, statut,
// boutiques et rôle par boutique, boutique principale, historique ; actions :
// affecter à une boutique, retirer d'une boutique, modifier le rôle,
// désactiver / réactiver le compte (propriétaire), renvoyer l'invitation.
// Les droits suivent lib/team/roles.ts (même règle que le serveur).

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Users, Store, ShieldOff, ShieldCheck, RotateCcw, UserMinus, UserPlus, AlertTriangle, UserCog, Star, Mail, Phone, Send } from 'lucide-react'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import type { Shop, UserRole } from '@/lib/types/database'
import { canManageRole, manageableRoles, isAccountOwner } from '@/lib/team/roles'
import { isPendingInvite, type TeamPerson } from '@/lib/team/use-team-people'
import { teamActions } from '@/lib/team/team-actions'
import { PersonAvatar, PresenceText, RoleBadge } from './team-ui'
import { AssignDialog } from './assign-dialog'

const supabase = createClient() as any

interface Props {
  person: TeamPerson | null
  onOpenChange: (open: boolean) => void
  /** Boutiques de l'appelant (auth-context userShops) */
  shops: Shop[]
  /** Rôle de l'appelant par boutique (auth-context roleByShop) */
  roleByShop: Record<string, UserRole>
  myUserId?: string | null
  /** Personnes connues (pour la fenêtre Affecter) */
  people: TeamPerson[]
  onChanged: () => void
}

export function MemberSheet({ person, onOpenChange, shops, roleByShop, myUserId, people, onChanged }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const { toast } = useToast()
  const shopName = (id: string) => shops.find(s => s.id === id)?.name || '—'
  const isMe = !!person && person.user_id === myUserId
  const multiShop = shops.length > 1

  const [roleChange, setRoleChange] = useState<{ shopId: string; memberId: string; from: UserRole; to: UserRole } | null>(null)
  const [removeShopId, setRemoveShopId] = useState<string | null>(null)
  const [accountAction, setAccountAction] = useState<'deactivate' | 'reactivate' | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [history, setHistory] = useState<any[] | null>(null)

  // Boutique de contexte pour les actions « compte » : une boutique du compte où l'appelant est propriétaire
  const ownerShopId = useMemo(() => {
    const ids = person ? [...person.memberships, ...person.suspendedMemberships].map(m => m.shop_id) : []
    return ids.find(id => isAccountOwner(roleByShop[id])) ?? shops.find(s => isAccountOwner(roleByShop[s.id]))?.id ?? null
  }, [person, roleByShop, shops])
  const canManageAccount = !!person && !isMe && !!ownerShopId && !person.memberships.concat(person.suspendedMemberships).some(m => m.role === 'owner')

  // Boutiques où l'appelant pourrait affecter cette personne
  const personRoles = person ? person.memberships.map(m => m.role) : []
  const assignableShops = useMemo(() => shops.filter(s => {
    if (!person || isMe || !person.accountActive) return false
    const r = roleByShop[s.id]
    if (!manageableRoles(r).length) return false
    if (person.memberships.some(m => m.shop_id === s.id)) return false
    // Un non-propriétaire n'affecte que des personnes dont tous les rôles relèvent de lui
    return isAccountOwner(r) || personRoles.every(pr => canManageRole(r, pr))
  }), [shops, roleByShop, person, isMe]) // eslint-disable-line react-hooks/exhaustive-deps

  // Historique (journal d'audit : lisible par le propriétaire seulement, RLS)
  useEffect(() => {
    setHistory(null)
    if (!person || !ownerShopId) return
    const visible = shops.filter(s => isAccountOwner(roleByShop[s.id])).map(s => s.id)
    supabase.from('audit_logs')
      .select('id, action, shop_id, actor_email, metadata, created_at')
      .eq('target_id', person.user_id)
      .in('shop_id', visible)
      .order('created_at', { ascending: false })
      .limit(15)
      .then(({ data }: any) => setHistory(data || []))
      .catch(() => setHistory([]))
  }, [person?.user_id, ownerShopId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    if (!r.ok) { toast({ title: r.error || t('toast.retry_error'), variant: 'destructive' }); return false }
    toast({ title: success, variant: 'success' })
    onChanged()
    return true
  }

  const joined = person ? [...person.memberships, ...person.suspendedMemberships].map(m => m.joined_at).filter(Boolean).sort()[0] : null
  const statusLabel = !person ? '' : !person.accountActive ? t('team.account_deactivated_badge') : isPendingInvite(person) ? t('team.status_pending') : t('team.status_active')

  const describe = (log: any) => {
    const meta = log.metadata || {}
    const role = (r?: string) => (r ? t(`roles.${r}` as any) : '—')
    switch (log.action) {
      case 'member.invite': return { Icon: Send, label: t('team.journal_invited'), detail: role(meta.role) }
      case 'member.assign': return { Icon: UserPlus, label: t('team.journal_assigned'), detail: role(meta.role) }
      case 'member.delete': return { Icon: UserMinus, label: meta.scope === 'shop' ? t('team.journal_removed') : t('team.journal_deleted'), detail: '' }
      case 'member.role_change': return { Icon: UserCog, label: t('team.journal_role_changed'), detail: `${role(meta.old_role)} → ${role(meta.new_role)}` }
      case 'member.toggle_active': return { Icon: meta.new_active ? ShieldCheck : ShieldOff, label: meta.new_active ? t('team.journal_account_reactivated') : t('team.journal_account_deactivated'), detail: '' }
      default: return { Icon: Users, label: log.action, detail: '' }
    }
  }

  return (
    <>
      <DetailDrawer
        open={!!person}
        onOpenChange={onOpenChange}
        title={person?.full_name || ''}
        description={statusLabel}
        icon={<Users className="h-4 w-4" />}
        width="md"
        testId="member-sheet"
        actions={person && (canManageAccount || assignableShops.length > 0) ? (
          <div className={FOOTER_ROW_CLASS}>
            {canManageAccount && (
              <Button
                type="button"
                variant="outline"
                className={cn('h-11 min-w-0 gap-2 rounded-lg px-4', person.accountActive ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20' : 'border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:text-green-400')}
                onClick={() => setAccountAction(person.accountActive ? 'deactivate' : 'reactivate')}
                data-testid="member-account-toggle"
              >
                {person.accountActive ? <><ShieldOff className="h-4 w-4" /><span className="truncate">{t('team.account_deactivate')}</span></> : <><ShieldCheck className="h-4 w-4" /><span className="truncate">{t('team.account_reactivate')}</span></>}
              </Button>
            )}
            {assignableShops.length > 0 && (
              <Button type="button" variant="stockshop" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-4 font-semibold sm:flex-none" onClick={() => setAssignOpen(true)} data-testid="member-assign">
                <Store className="h-4 w-4" /><span className="truncate">{t('team.assign_btn')}</span>
              </Button>
            )}
          </div>
        ) : undefined}
      >
        {person && (
          <div className="space-y-4">
            <DrawerSection title={t('team.sheet_info')}>
              <div className="flex items-center gap-3">
                <PersonAvatar person={person} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{person.full_name}{isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t('team.me')})</span>}</p>
                  <PresenceText person={person} />
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {person.email && (<><dt className="text-muted-foreground">{t('team.invite_email')}</dt><dd className="flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" /><a href={`mailto:${person.email}`} className="truncate hover:underline">{person.email}</a></dd></>)}
                {person.phone && (<><dt className="text-muted-foreground">{t('team.phone')}</dt><dd className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><a href={`tel:${person.phone}`} className="hover:underline">{person.phone}</a></dd></>)}
                <dt className="text-muted-foreground">{t('team.sheet_status')}</dt>
                <dd className={cn(!person.accountActive && 'font-medium text-red-600 dark:text-red-400', isPendingInvite(person) && person.accountActive && 'text-amber-600 dark:text-amber-400')}>{statusLabel}</dd>
                {multiShop && person.primaryShopId && (<><dt className="text-muted-foreground">{t('team.primary_shop')}</dt><dd>{shopName(person.primaryShopId)}</dd></>)}
                {joined && (<><dt className="text-muted-foreground">{t('team.sheet_joined')}</dt><dd>{new Date(joined).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></>)}
              </dl>
              {isPendingInvite(person) && person.email && person.memberships[0] && canManageRole(roleByShop[person.memberships[0].shop_id], person.memberships[0].role) && (
                <Button type="button" variant="outline" size="sm" className="h-9 w-fit gap-1.5" loading={busy === 'resend'}
                  onClick={() => run('resend', () => teamActions.resendInvite({ shop_id: person.memberships[0].shop_id, email: person.email! }), t('team.invite_resent', { email: person.email! }))}>
                  <RotateCcw className="h-3.5 w-3.5" />{t('team.resend')}
                </Button>
              )}
            </DrawerSection>

            <DrawerSection title={multiShop ? t('team.sheet_shops') : t('team.role_label')}>
              {person.memberships.length === 0 && person.suspendedMemberships.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('team.no_shop')}</p>
              )}
              <ul className="divide-y rounded-lg border" data-testid="member-memberships">
                {person.memberships.map(m => {
                  const callerRole = roleByShop[m.shop_id]
                  const manageable = !isMe && m.role !== 'owner' && canManageRole(callerRole, m.role)
                  const roleOptions = manageable ? manageableRoles(callerRole) : []
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="member-membership">
                      <div className="flex min-w-[180px] flex-1 items-center gap-2">
                        <Store className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate text-sm font-medium">{shopName(m.shop_id)}</span>
                        {multiShop && person.primaryShopId === m.shop_id && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-stockshop-blue-muted px-1.5 py-0.5 text-[10px] font-medium text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400"><Star className="h-2.5 w-2.5" />{t('team.primary_badge')}</span>
                        )}
                      </div>
                      {manageable ? (
                        <Select value={m.role} onValueChange={v => { if (v !== m.role) setRoleChange({ shopId: m.shop_id, memberId: m.id, from: m.role, to: v as UserRole }) }} disabled={busy === 'role'}>
                          <SelectTrigger className="h-9 w-[160px] text-xs" aria-label={t('team.role_in_shop', { shop: shopName(m.shop_id) })} data-testid="member-role-select"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roleOptions.map(r => <SelectItem key={r} value={r}>{t(`roles.${r}` as any)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <RoleBadge role={m.role} />}
                      {manageable && (
                        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground hover:text-red-600" aria-label={t('team.remove_btn')} title={t('team.remove_btn')} onClick={() => setRemoveShopId(m.shop_id)} data-testid="member-remove">
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  )
                })}
                {person.suspendedMemberships.map(m => (
                  <li key={m.id} className="flex items-center gap-2 p-3 opacity-60">
                    <Store className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm line-through">{shopName(m.shop_id)}</span>
                    <RoleBadge role={m.role} />
                  </li>
                ))}
              </ul>
              {!person.accountActive && <p className="text-xs text-muted-foreground">{t('team.account_deactivated_hint')}</p>}
            </DrawerSection>

            {history !== null && (
              <DrawerSection title={t('team.history')}>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('team.history_empty')}</p>
                ) : (
                  <ul className="space-y-2" data-testid="member-history">
                    {history.map(log => {
                      const d = describe(log)
                      return (
                        <li key={log.id} className="flex items-start gap-2.5 text-sm">
                          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted"><d.Icon className="h-3.5 w-3.5 text-muted-foreground" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block">{d.label}{d.detail && <span className="text-muted-foreground"> · {d.detail}</span>}</span>
                            <span className="block text-xs text-muted-foreground">
                              {multiShop && log.shop_id ? `${shopName(log.shop_id)} · ` : ''}{log.actor_email || '—'} · {new Date(log.created_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </DrawerSection>
            )}
          </div>
        )}
      </DetailDrawer>

      {/* Rôle dans UNE boutique : confirmation (ambre si le rôle gère l'équipe) */}
      <ConfirmModal
        open={!!roleChange}
        onOpenChange={open => { if (!open && busy !== 'role') setRoleChange(null) }}
        title={t('team.role_change_title')}
        description={roleChange && person ? t('team.role_change_confirm', { name: person.full_name, from: t(`roles.${roleChange.from}` as any), to: t(`roles.${roleChange.to}` as any) }) : undefined}
        icon={<UserCog className="h-4 w-4" />}
        tone={roleChange && (roleChange.to === 'manager' || roleChange.to === 'shop_manager') ? 'warning' : 'primary'}
        confirmLabel={t('team.role_change_title')}
        loading={busy === 'role'}
        onConfirm={async () => {
          if (!roleChange) return
          const ok = await run('role', () => teamActions.changeRole({ shop_id: roleChange.shopId, member_id: roleChange.memberId, role: roleChange.to }), t('toast.role_updated'))
          if (ok) setRoleChange(null)
        }}
      >
        {roleChange && multiShop && <p className="text-xs text-muted-foreground">{t('team.role_change_shop_hint', { shop: shopName(roleChange.shopId) })}</p>}
        {roleChange && (roleChange.to === 'manager' || roleChange.to === 'shop_manager') && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />{t('team.role_change_manager_hint')}
          </div>
        )}
      </ConfirmModal>

      {/* Retirer de CETTE boutique : seule l'affectation est touchée */}
      <ConfirmModal
        open={!!removeShopId}
        onOpenChange={open => { if (!open && busy !== 'remove') setRemoveShopId(null) }}
        title={t('team.remove_title')}
        description={removeShopId && person ? t('team.remove_confirm', { name: person.full_name, shop: shopName(removeShopId) }) : undefined}
        icon={<UserMinus className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('team.remove_btn')}
        loading={busy === 'remove'}
        onConfirm={async () => {
          if (!removeShopId || !person) return
          const ok = await run('remove', () => teamActions.removeFromShop({ shop_id: removeShopId, user_id: person.user_id }), t('team.removed_toast', { name: person.full_name, shop: shopName(removeShopId) }))
          if (ok) setRemoveShopId(null)
        }}
      />

      {/* Désactiver / réactiver le COMPTE : confirmation claire, toutes boutiques */}
      <ConfirmModal
        open={!!accountAction}
        onOpenChange={open => { if (!open && busy !== 'account') setAccountAction(null) }}
        category={accountAction === 'deactivate' ? t('team.account_deactivate') : undefined}
        title={person ? (accountAction === 'deactivate' ? t('team.account_deactivate_title', { name: person.full_name }) : t('team.account_reactivate_title', { name: person.full_name })) : ''}
        description={person && accountAction === 'reactivate' ? t('team.account_reactivate_confirm', { name: person.full_name }) : undefined}
        icon={accountAction === 'deactivate' ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        tone={accountAction === 'deactivate' ? 'danger' : 'primary'}
        confirmLabel={accountAction === 'deactivate' ? t('team.account_deactivate') : t('team.account_reactivate')}
        loading={busy === 'account'}
        onConfirm={async () => {
          if (!person || !ownerShopId || !accountAction) return
          const active = accountAction === 'reactivate'
          const ok = await run('account', () => teamActions.setAccountActive({ shop_id: ownerShopId, user_id: person.user_id, active }),
            active ? t('team.account_reactivated_toast', { name: person.full_name }) : t('team.account_deactivated_toast', { name: person.full_name }))
          if (ok) setAccountAction(null)
        }}
      >
        {accountAction === 'deactivate' && person && (
          <ul className="space-y-1 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400" data-testid="account-deactivate-effects">
            <li>• {t('team.account_effect_all_shops', { count: person.memberships.length })}</li>
            <li>• {t('team.deactivate_effect_session')}</li>
            <li>• {t('team.deactivate_effect_sales')}</li>
            <li>• {t('team.account_effect_reversible')}</li>
          </ul>
        )}
      </ConfirmModal>

      {person && (
        <AssignDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          shops={assignableShops}
          roleByShop={roleByShop}
          people={people}
          fixedPerson={person}
          onDone={onChanged}
        />
      )}
    </>
  )
}
