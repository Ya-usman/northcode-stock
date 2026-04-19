'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Lock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface UpgradeWallProps {
  locale: string
  shopName?: string
}

export function UpgradeWall({ locale, shopName }: UpgradeWallProps) {
  const t = useTranslations('saas')

  const features = [
    t('feature_history'),
    t('feature_starter'),
    t('feature_cancel'),
    t('feature_instant'),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-northcode-blue to-[#1a4f9e] p-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/20 mb-4">
            <Lock className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t('trial_ended_title')}
          </h2>
          <p className="text-blue-200 text-sm">
            {shopName ? t('trial_ended_subtitle_shop', { shopName }) : t('trial_ended_subtitle')}
          </p>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground text-center mb-5">
            {t('data_safe')}
          </p>

          <ul className="space-y-2.5 mb-6">
            {features.map(item => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-foreground/80">
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>

          <Link href={`/${locale}/billing`} className="block">
            <Button className="w-full h-11 bg-northcode-blue hover:bg-northcode-blue-light font-semibold gap-2">
              {t('choose_plan')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>

          <p className="text-center text-xs text-muted-foreground mt-3">
            {t('questions_whatsapp')}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
