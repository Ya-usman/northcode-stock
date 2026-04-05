'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { getPlan, PLANS } from '@/lib/saas/plans'
import type { PlanId } from '@/lib/saas/plans'

interface PlanLimitAlertProps {
  currentPlan: string | null
  productCount: number
  teamMemberCount: number
  locale: string
}

export function PlanLimitAlert({ currentPlan, productCount, teamMemberCount, locale }: PlanLimitAlertProps) {
  const [dismissed, setDismissed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isWarning, setIsWarning] = useState(false) // warning = near limit, error = at limit

  useEffect(() => {
    const plan = getPlan(currentPlan)
    const limits = plan.limits

    // Products limit
    if (limits.products !== -1) {
      const pct = productCount / limits.products
      if (productCount >= limits.products) {
        setMessage(`Vous avez atteint la limite de ${limits.products} produits de votre plan ${plan.name}. Passez au plan supérieur pour ajouter plus.`)
        setIsWarning(false)
        setDismissed(false)
        return
      } else if (pct >= 0.8) {
        setMessage(`Vous utilisez ${productCount}/${limits.products} produits (${Math.round(pct * 100)}%). Pensez à upgrader votre plan.`)
        setIsWarning(true)
        setDismissed(false)
        return
      }
    }

    // Team members limit
    if (limits.team_members !== -1) {
      if (teamMemberCount >= limits.team_members) {
        setMessage(`Vous avez atteint la limite de ${limits.team_members} membres d'équipe de votre plan ${plan.name}.`)
        setIsWarning(false)
        setDismissed(false)
        return
      } else if (teamMemberCount / limits.team_members >= 0.8) {
        setMessage(`Vous avez ${teamMemberCount}/${limits.team_members} membres d'équipe.`)
        setIsWarning(true)
        setDismissed(false)
        return
      }
    }

    setMessage(null)
  }, [currentPlan, productCount, teamMemberCount])

  // Find next plan to recommend
  const planOrder: PlanId[] = ['trial', 'starter', 'pro', 'business']
  const currentIdx = planOrder.indexOf((currentPlan as PlanId) ?? 'trial')
  const nextPlan = planOrder[Math.min(currentIdx + 1, planOrder.length - 1)]
  const nextPlanData = PLANS[nextPlan]

  if (!message || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`mx-4 mt-3 md:mx-6 rounded-xl border p-4 flex items-start gap-3 shadow-sm ${
          isWarning
            ? 'bg-amber-50 border-amber-200'
            : 'bg-red-50 border-red-200'
        }`}
      >
        <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isWarning ? 'text-amber-500' : 'text-red-500'}`} />

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${isWarning ? 'text-amber-800' : 'text-red-800'}`}>
            {message}
          </p>
          {nextPlan !== currentPlan && (
            <div className="mt-2 flex items-center gap-3">
              <Link
                href={`/${locale}/billing`}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  isWarning
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                Passer au plan {nextPlanData.name} — ₦{nextPlanData.price_monthly.toLocaleString('en-NG')}/mois
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <span className="text-xs text-gray-500">
                {nextPlanData.limits.products === -1 ? 'Produits illimités' : `Jusqu'à ${nextPlanData.limits.products} produits`}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
