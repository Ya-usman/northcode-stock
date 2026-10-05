'use client'

// Éléments visuels partagés par la page Équipe, la fiche membre et l'onglet
// Équipe d'une boutique (extraits de l'ancienne page Équipe, 5 oct. 2026).

import { useTranslations, useLocale } from 'next-intl'
import { formatDistanceToNow } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { AlertTriangle, CheckCircle2, Shield } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils/cn'
import type { TeamPerson } from '@/lib/team/use-team-people'
import { isPendingInvite, topRole } from '@/lib/team/use-team-people'

export const ROLE_COLORS: Record<string, string> = {
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

export const initialsOf = (name: string) => name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'

export function RoleBadge({ role, size = 'sm', suffix }: { role: string; size?: 'xs' | 'sm'; suffix?: string }) {
  const t = useTranslations()
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full font-medium', size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs', ROLE_COLORS[role] || ROLE_COLORS.viewer)}>
      <Shield className={size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {t(`roles.${role}` as any)}{suffix ? ` · ${suffix}` : ''}
    </span>
  )
}

export function PersonAvatar({ person, size = 'md' }: { person: TeamPerson; size?: 'md' | 'lg' }) {
  const role = topRole(person)
  const active = person.accountActive && person.memberships.length > 0
  const ms = person.last_seen ? Date.now() - new Date(person.last_seen).getTime() : Infinity
  const online = ms < 5 * 60 * 1000
  const away = !online && ms < 2 * 60 * 60 * 1000
  return (
    <div className="relative flex-shrink-0">
      <Avatar className={size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'}>
        <AvatarFallback className={cn('font-bold text-white', size === 'lg' ? 'text-sm' : 'text-xs', active ? (ROLE_AVATAR_COLORS[role || 'viewer'] || 'bg-gray-500') : 'bg-gray-400')}>
          {initialsOf(person.full_name)}
        </AvatarFallback>
      </Avatar>
      {active && person.last_seen && !isPendingInvite(person) && (
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card', online ? 'bg-green-500' : away ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600')} />
      )}
    </div>
  )
}

/** Invitation en attente / jamais connecté / en ligne / vu il y a… */
export function PresenceText({ person }: { person: TeamPerson }) {
  const t = useTranslations()
  const locale = useLocale()
  if (isPendingInvite(person)) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />{t('team.invite_pending')}
      </span>
    )
  }
  if (person.emailConfirmedAt && !person.lastSignInAt && !person.last_seen) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 text-green-500" />{t('team.email_confirmed_never_connected')}
      </span>
    )
  }
  const seen = person.last_seen || person.lastSignInAt
  if (seen) {
    const ms = Date.now() - new Date(seen).getTime()
    const online = ms < 5 * 60 * 1000
    const away = !online && ms < 2 * 60 * 60 * 1000
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', online ? 'bg-green-500' : away ? 'bg-amber-400' : 'bg-gray-400')} />
        {online ? t('team.online') : formatDistanceToNow(new Date(seen), { addSuffix: true, locale: locale === 'fr' ? fr : enUS })}
      </span>
    )
  }
  return <span className="text-[10px] italic text-muted-foreground">{t('team.never_connected')}</span>
}
