'use client'

// État de la boutique dans l'en-tête (29 oct. 2026) pour le propriétaire et le super admin, qui ne sont jamais bloqués
// par les horaires : « Ouverte · ferme à 20:00 » ou « Fermée · rouvre à 08:00 », à l'heure de la boutique. Discret
// (pas d'alerte rouge), toujours visible, un clic mène à l'onglet Horaires. Sur téléphone, le mot seul, sur une
// petite ligne SOUS le nom de la page (qui garde ainsi toute la largeur). Masqué en
// contexte « Toutes les boutiques » (les horaires concernent une boutique) et quand les horaires sont désactivés.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { effectiveCloseInstant, isShopOpenNow } from '@/lib/saas/shop-hours'
import { shopTime } from '@/components/saas/extension-requests-banner'
import { cn } from '@/lib/utils/cn'

const hhmm = (time: string | null | undefined) => (time || '').slice(0, 5)

// variant 'pill' (ordinateur, à gauche de la barre du haut) : « ● Ouverte · ferme à 20:00 » ; variant 'dot'
// (téléphone, juste après le sélecteur de boutique) : le point seul, état complet au survol et pour les lecteurs
// d'écran (31 oct. 2026 : le nom de la page ne s'affiche plus dans la barre du haut).
export function ShopStatusPill({ locale, variant = 'pill', className }: { locale: string; variant?: 'pill' | 'dot'; className?: string }) {
  const t = useTranslations('shop_hours')
  const { shop, roleInActiveShop, userShops, dashboardShopFilter } = useAuthContext()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const exempt = roleInActiveShop === 'owner' || roleInActiveShop === 'super_admin'
  const showingAll = dashboardShopFilter === null && userShops.length > 1
  if (!shop || !shop.hours_enabled || !exempt || showingAll) return null

  const override = shop.hours_manual_override
  const open = isShopOpenNow(shop.hours_enabled, shop.opening_time, shop.closing_time, override, shop.hours_extension_until, undefined, shop.timezone)
  const close = effectiveCloseInstant(shop.closing_time, shop.hours_extension_until, new Date(), shop.timezone)
  const full = override === 'open' ? t('status_open_manual')
    : override === 'closed' ? t('status_closed_manual')
    : open ? (close !== null ? t('status_open_until', { time: shopTime(close, shop.timezone) }) : t('status_open'))
    : t('status_closed_reopens', { time: hhmm(shop.opening_time) })
  const short = open ? t('status_open') : t('status_closed')

  const dot = <span className={cn('shrink-0 rounded-full', variant === 'dot' ? 'h-2.5 w-2.5' : 'h-2 w-2', open ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-slate-400 dark:bg-slate-500')} aria-hidden="true" />
  return variant === 'dot' ? (
    <Link
      href={`/${locale}/shops/${shop.id}?tab=hours`}
      aria-label={t('status_aria', { status: full })}
      title={full}
      className={cn('flex h-8 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      data-testid="shop-status-pill"
      data-open={open ? 'true' : 'false'}
    >
      {dot}
      <span className="sr-only">{short}</span>
    </Link>
  ) : (
    <Link
      href={`/${locale}/shops/${shop.id}?tab=hours`}
      aria-label={t('status_aria', { status: full })}
      title={full}
      className={cn('inline-flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      data-testid="shop-status-pill"
      data-open={open ? 'true' : 'false'}
    >
      {dot}
      <span className="whitespace-nowrap tabular-nums">{full}</span>
    </Link>
  )
}
