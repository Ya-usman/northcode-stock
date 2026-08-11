'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getMsUntilClosing } from '@/lib/saas/shop-hours'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'

interface ShopHoursCountdownBannerProps {
  shopId: string
  hoursEnabled: boolean
  openingTime: string | null
  closingTime: string | null
  manualOverride: 'open' | 'closed' | null
  extensionUntil: string | null
  extensionCount: number
  canExtend: boolean
}

const PRESET_MINUTES = [15, 30, 45, 60] as const

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes}min`
}

// Pas de bouton de fermeture — contrairement à TrialBanner (qui prévient
// d'une échéance dans plusieurs semaines), ce bandeau prévient d'une perte
// d'accès le jour même : même catégorie d'urgence que GracePeriodBanner,
// qui n'est pas non plus dismissible.
export function ShopHoursCountdownBanner({
  shopId, hoursEnabled, openingTime, closingTime, manualOverride,
  extensionUntil, extensionCount, canExtend,
}: ShopHoursCountdownBannerProps) {
  const t = useTranslations('shop_hours')
  const { patchShop } = useAuthContext()
  const { toast } = useToast()
  const [msLeft, setMsLeft] = useState(() =>
    getMsUntilClosing(hoursEnabled, openingTime, closingTime, manualOverride, extensionUntil))
  const [extending, setExtending] = useState(false)

  useEffect(() => {
    const update = () => setMsLeft(getMsUntilClosing(hoursEnabled, openingTime, closingTime, manualOverride, extensionUntil))
    update()
    const interval = setInterval(update, 30_000)
    return () => clearInterval(interval)
  }, [hoursEnabled, openingTime, closingTime, manualOverride, extensionUntil])

  if (msLeft === null) return null

  const remaining = Math.max(0, 2 - extensionCount)
  const showExtendControls = canExtend && !manualOverride && remaining > 0

  const extend = async (minutes: number) => {
    if (extending) return
    setExtending(true)
    try {
      const res = await withTimeout(fetch('/api/shops/extend-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, minutes }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Erreur', variant: 'destructive' }); return }
      patchShop(shopId, {
        hours_extension_until: json.hours_extension_until,
        hours_extension_count: json.hours_extension_count,
      })
      toast({ title: t('extend_success', { minutes }), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || 'Erreur réseau', variant: 'destructive' })
    } finally {
      setExtending(false)
    }
  }

  return (
    <div className="w-full bg-stockshop-blue text-white px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm font-medium">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 flex-shrink-0" />
        <span>{t('countdown', { time: formatDuration(msLeft) })}</span>
      </div>
      {showExtendControls && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESET_MINUTES.map(minutes => (
            <button
              key={minutes}
              type="button"
              disabled={extending}
              onClick={() => extend(minutes)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25 transition-colors',
                extending && 'opacity-60 cursor-not-allowed'
              )}
            >
              +{minutes}min
            </button>
          ))}
          <span className="text-xs text-blue-100">{t('extend_remaining', { count: remaining })}</span>
        </div>
      )}
    </div>
  )
}
