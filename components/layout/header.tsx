'use client'

import { ShopSelector } from '@/components/layout/shop-selector'
import { NotificationBell } from '@/components/layout/notification-bell'
import { ShopStatusPill } from '@/components/layout/shop-status-pill'
import { UserMenu } from '@/components/layout/user-menu'
import { BrandLogo } from '@/components/brand/brand-logo'
import type { Profile, UserRole } from '@/lib/types/database'

interface HeaderProps {
  /** Nom de la page : plus affiché (31 oct. 2026, il est en tête de chaque page) ; gardé pour le titre accessible */
  title: string
  locale: string
  profile: Pick<Profile, 'full_name'>
  role: UserRole | string | null | undefined
  onSignOut?: () => void
  signingOut?: boolean
  /** Nouveautés : dans le menu de l'avatar, point sur l'avatar tant qu'il y a du nouveau */
  whatsNew?: { hasUnread: boolean; onOpen: () => void }
}

// Barre du haut (31 oct. 2026) : plus de nom de page (doublon avec l'en-tête de chaque page).
// Téléphone : marque StockShop, boutique (sélecteur + point ouverte / fermée), notifications, avatar.
// Ordinateur : état de la boutique à gauche (la marque et le sélecteur sont dans la barre latérale), notifications
// et avatar à droite. Mode sombre, langue, Nouveautés, aide et déconnexion : menu de l'avatar.
export function Header({ title, locale, profile, role, onSignOut, signingOut, whatsNew }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4 sm:px-6" aria-label={title}>
      <BrandLogo className="text-[17px] sm:hidden" />
      <div className="hidden min-w-0 flex-1 items-center sm:flex">
        <ShopStatusPill locale={locale} />
      </div>
      {/* min-w-0 : sur téléphone, c'est le nom de la boutique (sélecteur) qui se raccourcit, jamais de défilement horizontal */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 sm:flex-none sm:gap-1">
        <ShopSelector variant="compact" iconOnly className="flex min-w-0 sm:hidden w-auto" />
        <ShopStatusPill locale={locale} variant="dot" className="sm:hidden" />
        <NotificationBell />
        <UserMenu locale={locale} profile={profile} role={role} onSignOut={onSignOut} signingOut={signingOut} whatsNew={whatsNew} />
      </div>
    </header>
  )
}
