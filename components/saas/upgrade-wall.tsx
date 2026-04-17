'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Lock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface UpgradeWallProps {
  locale: string
  shopName?: string
}

export function UpgradeWall({ locale, shopName }: UpgradeWallProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-northcode-blue to-[#1a4f9e] p-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/20 mb-4">
            <Lock className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">
            Your free trial has ended
          </h2>
          <p className="text-blue-200 text-sm">
            {shopName ? `${shopName} needs an active plan` : 'Subscribe to continue using StockShop'}
          </p>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground text-center mb-5">
            Your data is safe. Subscribe to any plan to get back to work.
          </p>

          <ul className="space-y-2.5 mb-6">
            {[
              'All your products and sales history are saved',
              'Starter plan from ₦4,500/month',
              'Cancel or change plan anytime',
              'Instant activation after payment',
            ].map(item => (
              <li key={item} className="flex items-center gap-2.5 text-sm text-gray-700">
                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>

          <Link href={`/${locale}/billing`} className="block">
            <Button className="w-full h-11 bg-northcode-blue hover:bg-northcode-blue-light font-semibold gap-2">
              Choose a Plan
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>

          <p className="text-center text-xs text-muted-foreground mt-3">
            Questions? WhatsApp us at +234 800 NORTHCODE
          </p>
        </div>
      </motion.div>
    </div>
  )
}
