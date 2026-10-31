'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Check, HelpCircle, Languages, Loader2, LogOut, Moon, Sparkles, Sun } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useTheme } from '@/lib/hooks/use-theme'
import type { Profile, UserRole } from '@/lib/types/database'

// Menu de l'utilisateur (barre du haut, téléphone et ordinateur) : avatar rond aux initiales, et tout ce qui
// concerne la personne au même endroit (nom, rôle, Nouveautés, mode sombre, langue, aide, déconnexion).
// Remplace le bloc utilisateur du bas de la barre latérale et les boutons isolés de l'en-tête.

const LOCALES: { code: string; flag: string; label: string }[] = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'ha', flag: '🇳🇬', label: 'Hausa' },
]

export const initialsOf = (name: string | null | undefined) =>
  (name || '').trim().split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?'

export function UserMenu({ locale, profile, role, onSignOut, signingOut = false, whatsNew }: {
  locale: string
  profile: Pick<Profile, 'full_name'> & { email?: string | null }
  role: UserRole | string | null | undefined
  onSignOut?: () => void
  signingOut?: boolean
  /** Nouveautés : point sur l'avatar tant qu'il y a du nouveau */
  whatsNew?: { hasUnread: boolean; onOpen: () => void }
}) {
  const t = useTranslations('nav')
  const tRoles = useTranslations('roles')
  const tWhatsNew = useTranslations('whats_new')
  const pathname = usePathname()
  const router = useRouter()
  const { updateLocale } = useAuthContext()
  const { isDark, toggle } = useTheme()
  const unread = !!whatsNew?.hasUnread

  const switchLanguage = (next: string) => {
    if (next === locale) return
    const newPath = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${next}`)
    updateLocale(next)
    router.replace(newPath + window.location.search) // paramètres de l'adresse conservés
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue/50"
          aria-label={unread ? tWhatsNew('open_unread') : profile.full_name}
          title={profile.full_name}
          data-testid="user-menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stockshop-blue text-xs font-semibold text-white dark:bg-blue-500">
            {initialsOf(profile.full_name)}
          </span>
          {unread && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-card" data-testid="whats-new-dot" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold">{profile.full_name}</p>
          {role && <p className="text-xs text-muted-foreground">{tRoles(role as any)}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {whatsNew && (
          <DropdownMenuItem onClick={whatsNew.onOpen} data-testid="whats-new-button">
            <Sparkles className="mr-2 h-4 w-4" />
            <span className="flex-1">{tWhatsNew('title')}</span>
            {unread && <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={toggle} data-testid="user-menu-theme">
          {isDark ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
          {isDark ? t('theme_light') : t('theme_dark')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="user-menu-language">
            <Languages className="mr-2 h-4 w-4" />
            <span className="flex-1">{t('language')}</span>
            <span className="mr-1 text-xs text-muted-foreground">{LOCALES.find(l => l.code === locale)?.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LOCALES.map(l => (
              <DropdownMenuItem key={l.code} onClick={() => switchLanguage(l.code)}>
                <span className="mr-2">{l.flag}</span>
                <span className="flex-1">{l.label}</span>
                {l.code === locale && <Check className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/help`}>
            <HelpCircle className="mr-2 h-4 w-4" />
            {t('help')}
          </Link>
        </DropdownMenuItem>
        {onSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} disabled={signingOut} className="text-red-600 focus:text-red-600 dark:text-red-400" data-testid="user-menu-logout">
              {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              {t('logout')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
