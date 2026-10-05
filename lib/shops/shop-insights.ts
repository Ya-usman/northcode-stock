'use client'

// Repères et états d'une boutique — SOURCE UNIQUE pour la liste Boutiques et
// la fiche boutique (refonte du 5 oct. 2026). Uniquement des données réelles :
//  - Encaissé aujourd'hui : paiements du jour (ventes actives, hors annulés et
//    pertes), y compris les remboursements de dettes — même définition que le
//    Contrôle de caisse ;
//  - Ventes du jour (nombre et montant) et des 30 derniers jours (ventes actives) ;
//  - Produits actifs, ruptures, stock bas (seuil produit, sinon boutique),
//    valeur du stock au coût d'achat (affichée au propriétaire seulement).

import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils/with-timeout'
import { lowStockThresholdOf } from '@/lib/stock/signals'
import { isShopOpenNow, getMsUntilClosing } from '@/lib/saas/shop-hours'
import type { Shop } from '@/lib/types/database'

const supabase = createClient() as any
const DAY = 86_400_000

export interface ShopStats {
  cashToday: number
  salesTodayCount: number
  salesToday: number
  sales30: number
  products: number
  out: number
  low: number
  stockValue: number
}

const empty = (): ShopStats => ({ cashToday: 0, salesTodayCount: 0, salesToday: 0, sales30: 0, products: 0, out: 0, low: 0, stockValue: 0 })

export function useShopStats(shops: Shop[]) {
  const key = shops.map(s => s.id).join(',')
  const [stats, setStats] = useState<Record<string, ShopStats>>({})
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const ids = shops.map(s => s.id)
    if (!ids.length) { setStats({}); setLoaded(true); return }
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const since30 = new Date(Date.now() - 30 * DAY).toISOString()
    try {
      const [salesRes, payRes, prodRes] = await withTimeout(Promise.all([
        supabase.from('sales').select('shop_id, total, created_at').in('shop_id', ids).eq('sale_status', 'active').gte('created_at', since30),
        supabase.from('payments').select('amount, sales!inner(shop_id, sale_status)')
          .in('sales.shop_id', ids).eq('is_cancelled', false).eq('is_write_off', false)
          .gte('paid_at', startToday.toISOString()),
        supabase.from('products').select('shop_id, quantity, buying_price, low_stock_threshold').in('shop_id', ids).eq('is_active', true),
      ]), 20_000)
      if (salesRes.error || payRes.error || prodRes.error) throw salesRes.error || payRes.error || prodRes.error
      const next: Record<string, ShopStats> = Object.fromEntries(ids.map(id => [id, empty()]))
      for (const s of salesRes.data || []) {
        const st = next[s.shop_id]; if (!st) continue
        const total = Number(s.total) || 0
        st.sales30 += total
        if (new Date(s.created_at) >= startToday) { st.salesToday += total; st.salesTodayCount++ }
      }
      for (const p of payRes.data || []) {
        const st = next[p.sales?.shop_id]; if (!st || p.sales?.sale_status === 'cancelled') continue
        st.cashToday += Number(p.amount) || 0
      }
      const threshold = Object.fromEntries(shops.map(s => [s.id, s.low_stock_threshold]))
      for (const p of prodRes.data || []) {
        const st = next[p.shop_id]; if (!st) continue
        const qty = Number(p.quantity) || 0
        st.products++
        if (qty <= 0) st.out++
        else if (qty <= lowStockThresholdOf(p, threshold[p.shop_id])) st.low++
        st.stockValue += Math.max(qty, 0) * (Number(p.buying_price) || 0)
      }
      setStats(next)
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
    const open = isShopOpenNow(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until)
    if (!open) return { text: t('shops.closed_now'), open: false }
    const ms = getMsUntilClosing(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until)
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
