'use client'

import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRouter, usePathname } from 'next/navigation'
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
  onSignOut: () => void
}

export function Header({ title, locale, onSignOut }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()

  const switchLanguage = (newLocale: string) => {
    const newPath = pathname.replace(`/${locale}`, `/${newLocale}`)
    localStorage.setItem('NEXT_LOCALE', newLocale)
    router.push(newPath)
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
      {/* Mobile: StockShop logo */}
      <img src="/logo-icon.png" alt="StockShop" className="h-16 w-16 md:hidden flex-shrink-0" style={{ mixBlendMode: 'multiply' }} />

      <h1 className="flex-1 font-semibold text-base text-foreground truncate">{title}</h1>

      <div className="flex items-center gap-1">
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
              className={locale === 'en' ? 'font-semibold text-northcode-blue dark:text-blue-400' : ''}
            >
              🇬🇧 English
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => switchLanguage('fr')}
              className={locale === 'fr' ? 'font-semibold text-northcode-blue dark:text-blue-400' : ''}
            >
              🇫🇷 Français
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => switchLanguage('ha')}
              className={locale === 'ha' ? 'font-semibold text-northcode-blue dark:text-blue-400' : ''}
            >
              🇳🇬 Hausa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Logout — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          className="h-8 w-8 md:hidden text-muted-foreground hover:text-destructive"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
