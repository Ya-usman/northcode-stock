'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpRight, X, AlertTriangle, Plus } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getPlan } from '@/lib/saas/plans'
import { openLimitReached } from '@/components/billing/limit-reached-dialog'

interface PlanLimitAlertProps {
  currentPlan: string | null
  productCount: number
  teamMemberCount: number
  /** Limite effective du serveur (formule + membres offerts) ; à défaut, celle de la formule */
  teamLimit?: number
  locale: string
}

export function PlanLimitAlert({ currentPlan, productCount, teamMemberCount, teamLimit, locale }: PlanLimitAlertProps) {
  const t = useTranslations('saas')
  const [dismissed, setDismissed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isWarning, setIsWarning] = useState(false) // warning = near limit, error = at limit
  const [teamFull, setTeamFull] = useState(false)

  useEffect(() => {
    const plan = getPlan(currentPlan)
    const limits = plan.limits
    setTeamFull(false)

    // Products limit
    if (limits.products !== -1) {
      const pct = productCount / limits.products
      if (productCount >= limits.products) {
        setMessage(t('plan_limit_reached', { limit: limits.products, plan: plan.name }))
        setIsWarning(false)
        setDismissed(false)
        return
      } else if (pct >= 0.8) {
        setMessage(t('plan_limit_warning', { count: productCount, limit: limits.products, pct: Math.round(pct * 100) }))
        setIsWarning(true)
        setDismissed(false)
        return
      }
    }

    // Team members limit
    const memberLimit = teamLimit ?? limits.team_members
    if (memberLimit !== -1) {
      if (teamMemberCount >= memberLimit) {
        setMessage(t('team_limit_reached', { limit: memberLimit, plan: plan.name }))
        setIsWarning(false)
        setTeamFull(true)
        setDismissed(false)
        return
      } else if (teamMemberCount / memberLimit >= 0.8) {
        setMessage(t('team_limit_warning', { count: teamMemberCount, limit: memberLimit }))
        setIsWarning(true)
        setDismissed(false)
        return
      }
    }

    setMessage(null)
    setTeamFull(false)
  }, [currentPlan, productCount, teamMemberCount, teamLimit, t])

  // Prochaine action (4 nov. 2026) : à la limite d'équipe, ajouter une place (option, fenêtre « Limite atteinte ») ;
  // toujours, voir les formules. Plus de prix affiché ici : l'ancien prix de référence en naira suivi du symbole de la
  // boutique donnait un montant faux hors FCFA / Nigeria (les vrais prix sont sur la page Abonnement, par pays).
  const atTeamLimit = teamFull && !isWarning

  if (!message || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="mx-4 mt-3 md:mx-6 rounded-xl border p-4 flex items-start gap-3 shadow-sm bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60"
        data-testid="plan-limit-alert"
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-500" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {message}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {atTeamLimit && (
              <button
                type="button"
                onClick={() => openLimitReached({ kind: 'seats', returnTo: '/team?resume=invite' })}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-stockshop-blue px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stockshop-blue-light dark:bg-blue-600 dark:hover:bg-blue-500"
                data-testid="plan-limit-add-seat"
              >
                <Plus className="h-3.5 w-3.5" />{t('add_seat')}
              </button>
            )}
            <Link
              href={`/${locale}/billing`}
              className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
            >
              {t('see_plans')}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-gray-400 hover:text-muted-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
