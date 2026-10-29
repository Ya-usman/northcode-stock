'use client'

import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { ShopSelector } from '@/components/layout/shop-selector'
import { NotificationBell } from '@/components/layout/notification-bell'
import { ShopStatusPill } from '@/components/layout/shop-status-pill'
import { useTheme } from '@/lib/hooks/use-theme'
import { WhatsNewButton } from '@/components/announcements/whats-new'

const LOCALE_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  ha: '🇳🇬',
}

interface HeaderProps {
  title: string
  locale: string
  onSignOut?: () => void
  /** Nouveautés : icône avec point bleu tant qu'il y a du nouveau */
  whatsNew?: { hasUnread: boolean; onOpen: () => void }
}

export function Header({ title, locale, whatsNew }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { updateLocale } = useAuthContext()
  const { isDark, toggle } = useTheme()

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${newLocale}`)
    updateLocale(newLocale)
    router.replace(newPath + window.location.search) // paramètres de l'adresse conservés
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 sm:px-6">
      {/* Mobile: StockShop logo */}
      <img src="/logo-icon-t.png" alt="StockShop" className="h-10 w-10 sm:hidden flex-shrink-0 dark:brightness-0 dark:invert" />

      {/* Téléphone : nom de la page en haut, état de la boutique en petit dessous (largeur minimale pour ne jamais
          chevaucher le sélecteur de boutique ; c'est lui qui se raccourcit). Ordinateur : titre puis pastille sur une ligne. */}
      <div className="flex min-w-[5rem] flex-1 flex-col justify-center sm:min-w-0 sm:flex-row sm:items-center sm:justify-start sm:gap-2">
        <h1 className="min-w-0 truncate text-sm font-semibold leading-tight text-foreground sm:text-base">{title}</h1>
        {/* État de la boutique (propriétaire) : ouverte jusqu'à quand, ou fermée jusqu'à quand */}
        <ShopStatusPill locale={locale} />
      </div>

      {/* min-w-0 : sur téléphone, c'est le nom de la boutique (sélecteur) qui se raccourcit, jamais de défilement horizontal */}
      <div className="flex min-w-0 items-center gap-1">
        {/* Contexte boutique — téléphone seulement (sur ordinateur, il est dans la barre latérale).
            Texte court toujours visible (« Akwa ▾ » / « Toutes ▾ ») dans cet en-tête collant : le
            contexte ne disparaît jamais au défilement ; noms complets dans la liste. Comptes à
            plusieurs boutiques uniquement (rien à choisir sinon). */}
        <ShopSelector variant="compact" iconOnly className="flex min-w-0 sm:hidden w-auto" />

        {/* Centre de notifications : demandes de prolongation et messages du support (voir notification-bell.tsx) */}
        <NotificationBell />

        {whatsNew && <WhatsNewButton hasUnread={whatsNew.hasUnread} onOpen={whatsNew.onOpen} />}

        {/* Mode sombre et langue : ordinateur seulement ; sur téléphone, menu « Plus » (en-tête trop chargé) */}
        {/* Dark / Light toggle */}
        <Button variant="ghost" size="icon" onClick={toggle} className="hidden h-8 w-8 text-muted-foreground hover:text-foreground sm:inline-flex">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Language toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 text-base sm:inline-flex">
              {LOCALE_FLAGS[locale] ?? '🌐'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => switchLanguage('en')}
              className={locale === 'en' ? 'font-semibold text-stockshop-blue dark:text-blue-400' : ''}
            >
              🇬🇧 English
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => switchLanguage('fr')}
              className={locale === 'fr' ? 'font-semibold text-stockshop-blue dark:text-blue-400' : ''}
            >
              🇫🇷 Français
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => switchLanguage('ha')}
              className={locale === 'ha' ? 'font-semibold text-stockshop-blue dark:text-blue-400' : ''}
            >
              🇳🇬 Hausa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  )
}
