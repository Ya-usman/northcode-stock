'use client'

import { Sun, Moon, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname } from 'next/navigation'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useTheme } from '@/lib/hooks/use-theme'
import { useCurrency } from '@/lib/hooks/use-currency'
import { getCountry } from '@/lib/saas/countries'
import type { Shop } from '@/lib/types/database'

const LOCALE_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  ha: '🇳🇬',
}

interface HeaderProps {
  title: string
  shop: Shop | null
  locale: string
  onSignOut?: () => void
  crispUnread?: number
  onOpenChat?: () => void
}

export function Header({ title, locale, crispUnread = 0, onOpenChat }: HeaderProps) {
  const pathname = usePathname()
  const { shop, updateLocale } = useAuthContext()
  const { isDark, toggle } = useTheme()
  const { symbol } = useCurrency()
  const countryFlag = getCountry(shop?.country).flag

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    updateLocale(newLocale)
    window.location.href = newPath
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 sm:px-6">
      {/* Mobile: StockShop logo */}
      <img src="/logo-icon-t.png" alt="StockShop" className="h-10 w-10 sm:hidden flex-shrink-0 dark:brightness-0 dark:invert" />

      <h1 className="flex-1 font-semibold text-base text-foreground truncate">{title}</h1>

      <div className="flex items-center gap-1">
        {/* Currency badge */}
        {shop && (
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs font-medium text-muted-foreground select-none">
            <span>{countryFlag}</span>
            <span>{symbol}</span>
          </div>
        )}

        {/* Crisp chat button */}
        {onOpenChat && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenChat}
            className="relative h-8 w-8 text-muted-foreground hover:text-foreground overflow-visible"
            aria-label="Support chat"
          >
            <MessageCircle className="h-5 w-5" />
            {crispUnread > 0 && (
              <span className="pointer-events-none absolute top-0.5 right-0.5 flex min-w-[16px] h-4 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-2 ring-card">
                {crispUnread > 9 ? '9+' : crispUnread}
              </span>
            )}
          </Button>
        )}

        {/* Dark / Light toggle */}
        <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 text-muted-foreground hover:text-foreground">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Language toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-base">
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
