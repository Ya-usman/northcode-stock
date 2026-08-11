'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ShopClosedWallProps {
  locale: string
  shopName?: string
  openingTime: string
  closingTime: string
}

function formatTime(t: string): string {
  const [h, m] = t.split(':')
  return `${h}:${m}`
}

export function ShopClosedWall({ locale, shopName, openingTime, closingTime }: ShopClosedWallProps) {
  const t = useTranslations('shop_hours')
  // Recalculée régulièrement pour qu'une horloge d'appareil mal réglée soit
  // visible immédiatement — c'est le seul diagnostic disponible pour un
  // employé bloqué, il n'y a rien d'autre à cliquer sur cet écran.
  const [deviceTime, setDeviceTime] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setDeviceTime(new Date()), 30_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="bg-gradient-to-br from-stockshop-blue to-[#1a4f9e] p-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/20 mb-4">
            <Clock className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t('closed_title')}
          </h2>
          <p className="text-blue-200 text-sm">
            {shopName ? t('closed_subtitle_shop', { shopName }) : t('closed_subtitle')}
          </p>
        </div>

        <div className="p-6 text-center space-y-2">
          <p className="text-sm text-foreground font-medium">
            {t('closed_hours', { opening: formatTime(openingTime), closing: formatTime(closingTime) })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('closed_device_time', { time: deviceTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
