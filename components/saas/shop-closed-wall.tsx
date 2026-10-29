'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ShopClosedWallProps {
  locale: string
  shopName?: string
  openingTime: string | null
  closingTime: string | null
  /** Fuseau de la boutique (shops.timezone) : l'heure affichée est celle de la boutique, comme la règle d'ouverture */
  timeZone?: string | null
  /** Fermée manuellement par le propriétaire (dérogation « fermée ») : pas d'heure de réouverture annoncée */
  manuallyClosed?: boolean
}

/** Heure locale de la boutique (fuseau invalide : heure de l'appareil) */
function shopTime(now: Date, locale: string, timeZone: string): string {
  try { return now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone }) }
  catch { return now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }
}

function formatTime(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return `${h}:${m}`
}

export function ShopClosedWall({ locale, shopName, openingTime, closingTime, timeZone, manuallyClosed = false }: ShopClosedWallProps) {
  const t = useTranslations('shop_hours')
  // Heure recalculée régulièrement : seul repère disponible pour un employé bloqué (rien d'autre à cliquer ici)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const opening = formatTime(openingTime)
  const closing = formatTime(closingTime)
  const time = timeZone ? shopTime(now, locale, timeZone) : now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="alertdialog" aria-modal="true" aria-labelledby="shop-closed-title" aria-describedby="shop-closed-hint"
      data-testid="shop-closed-wall"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="shop-closed-title" className="text-base font-semibold leading-6 text-foreground">{t('closed_title')}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {shopName ? t('closed_subtitle_shop', { shopName }) : t('closed_subtitle')}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {t('closed_status')}
          </span>
        </div>

        <dl className="divide-y border-y px-5 text-sm">
          {/* Fermée manuellement sans horaires configurés : pas de ligne d'horaires */}
          {opening && closing && (
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">{t('closed_hours_label')}</dt>
              <dd className="font-medium tabular-nums text-foreground" data-testid="shop-closed-hours">{t('closed_hours_value', { opening, closing })}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-muted-foreground">{timeZone ? t('closed_now_label') : t('closed_now_device_label')}</dt>
            <dd className="font-medium tabular-nums text-foreground" data-testid="shop-closed-time">{time}</dd>
          </div>
        </dl>

        <p id="shop-closed-hint" className="bg-muted/40 px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          {opening && !manuallyClosed ? t('closed_hint', { opening }) : t('closed_hint_manual')}
        </p>
      </div>
    </div>
  )
}
