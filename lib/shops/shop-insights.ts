'use client'

// Repères et états d'une boutique — SOURCE UNIQUE pour la liste Boutiques et
// la fiche boutique (refonte du 5 oct. 2026). Uniquement des données réelles :
//  - Encaissé aujourd'hui : paiements du jour (ventes actives, hors annulés et
//    pertes), y compris les remboursements de dettes — même définition que le
//    Contrôle de caisse ;
//  - Ventes du jour (nombre et montant) et des 30 derniers jours (ventes actives) ;
//  - Produits actifs, ruptures, stock bas (seuil produit, sinon boutique),
//    valeur du stock au coût d'achat (affichée au propriétaire seulement).
// Calculés par le SERVEUR (/api/shops/stats, lot 2B du 26 oct. 2026) selon les droits de la personne dans CHAQUE
// boutique : ventes avec « Historique » ou « Contrôle de caisse », stock avec « Stock », valeur avec le droit aux
// coûts. Un repère non autorisé vaut null (affiché « — »).

import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { withTimeout } from '@/lib/utils/with-timeout'
import { isShopOpenNow, getMsUntilClosing } from '@/lib/saas/shop-hours'
import type { Shop } from '@/lib/types/database'

const DAY = 86_400_000

/** null = repère non autorisé pour la personne dans cette boutique (affiché « — ») */
export interface ShopStats {
  cashToday: number | null
  salesTodayCount: number | null
  salesToday: number | null
  sales30: number | null
  products: number | null
  out: number | null
  low: number | null
  stockValue: number | null
}

/** Le serveur décide (droit aux coûts) : `_withCost` n'est plus utilisé, gardé pour les appels existants. */
export function useShopStats(shops: Shop[], _withCost = false) {
  const key = shops.map(s => s.id).join(',')
  const [stats, setStats] = useState<Record<string, ShopStats>>({})
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const ids = shops.map(s => s.id)
    if (!ids.length) { setStats({}); setLoaded(true); return }
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    try {
      const params = new URLSearchParams({ shop_ids: ids.join(','), day_start: startToday.toISOString() })
      const res = await withTimeout(fetch(`/api/shops/stats?${params}`), 20_000)
      if (!res.ok) throw new Error(`stats ${res.status}`)
      const { stats: next } = await res.json() as { stats: Record<string, ShopStats> }
      setStats(next || {})
    } catch {
      // repères absents : les pages restent utilisables
    } finally {
      setLoaded(true)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh() }, [refresh])
  return { stats, loaded, refresh }
}

/** Libellés d'état partagés : formule, abonnement, horaires, statut */
export function useShopStatus() {
  const t = useTranslations()
  const locale = useLocale()

  const planLabel = (plan: string | null | undefined) => {
    const p = plan || 'trial'
    return ['trial', 'starter', 'pro', 'business'].includes(p) ? t(`shops.plan_${p}` as any) : p
  }

  // Jours restants d'essai ou date de fin ; ambre à 7 jours ou moins, rouge une fois dépassé
  const subscriptionOf = (s: Shop): { text: string; tone: 'ok' | 'warn' | 'bad' } | null => {
    const now = Date.now()
    if ((s.plan || 'trial') === 'trial') {
      if (!s.trial_ends_at) return null
      const days = Math.ceil((new Date(s.trial_ends_at).getTime() - now) / DAY)
      if (days <= 0) return { text: t('shops.sub_trial_ended'), tone: 'bad' }
      return { text: t('shops.sub_trial_left', { count: days }), tone: days <= 7 ? 'warn' : 'ok' }
    }
    if (!s.plan_expires_at) return null
    const end = new Date(s.plan_expires_at)
    const days = Math.ceil((end.getTime() - now) / DAY)
    if (days <= 0) return { text: t('shops.sub_expired', { plan: planLabel(s.plan) }), tone: 'bad' }
    return { text: t('shops.sub_until', { plan: planLabel(s.plan), date: end.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }), tone: days <= 7 ? 'warn' : 'ok' }
  }

  // Ouverte / fermée maintenant (seulement si les horaires sont activés)
  const hoursOf = (s: Shop): { text: string; open: boolean } | null => {
    if (!s.hours_enabled) return null
    const open = isShopOpenNow(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until, undefined, s.timezone)
    if (!open) return { text: t('shops.closed_now'), open: false }
    const ms = getMsUntilClosing(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until, undefined, s.timezone)
    if (ms == null) return { text: t('shops.open_now'), open: true }
    const closeAt = new Date(Date.now() + ms)
    return { text: t('shops.open_until', { time: closeAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }), open: true }
  }

  /** Statut affiché : suspendue par la formule, sinon ouverte / fermée, sinon active */
  const statusOf = (s: Shop): { text: string; tone: 'ok' | 'muted' | 'bad' } => {
    if ((s as any).suspended_by_plan) return { text: t('shops.status_suspended'), tone: 'bad' }
    const h = hoursOf(s)
    if (h) return { text: h.text, tone: h.open ? 'ok' : 'muted' }
    return { text: t('shops.status_active'), tone: 'ok' }
  }

  const toneClass = { ok: 'text-muted-foreground', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400' } as const
  return { planLabel, subscriptionOf, hoursOf, statusOf, toneClass }
}
