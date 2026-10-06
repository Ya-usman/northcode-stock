'use client'

// Données des onglets Stock, Caisse et Historique de la fiche boutique
// (phase 3, lot 3A). Aucune règle propre : mêmes sources et mêmes calculs que
// les modules complets —
//  - Stock : seuils et péremption de lib/stock/signals (Vue d'ensemble Stock),
//    transferts et bons de commande par leurs routes serveur ;
//  - Caisse : encaissé du jour = paiements du jour (même définition que
//    useShopStats et le Contrôle de caisse), crédits = /api/payments/debts
//    (page Crédits), ventes hors ligne « à vérifier » (lot 3) ;
//  - Historique : journal d'audit de la boutique (lecture propriétaire, RLS).
// Chaque bloc se charge et échoue séparément : un bloc en erreur affiche
// « indisponible », jamais un faux zéro.

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils/with-timeout'
import {
  fetchExpiryByProduct, lowStockThresholdOf, isExpired, isExpiringSoon, type StockRulesContext,
} from '@/lib/stock/signals'
import type { Shop } from '@/lib/types/database'

const supabase = createClient() as any
const LIST_MAX = 10

type Block<T> = { data: T | null; error: boolean }
const ok = <T,>(data: T): Block<T> => ({ data, error: false })
const failed = <T,>(): Block<T> => ({ data: null, error: true })

async function settle<T>(p: Promise<T>): Promise<Block<T>> {
  try { return ok(await p) } catch { return failed<T>() }
}

async function getJson(url: string): Promise<any> {
  const res = await withTimeout<Response>(fetch(url), 20_000)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || String(res.status))
  return json
}

// ── Stock ───────────────────────────────────────────────────────────────────

export interface StockAlertItem { id: string; name: string; unit: string | null; quantity: number; threshold: number }
export interface ExpiryAlertItem { id: string; name: string; unit: string | null; quantity: number; date: string; expired: boolean }
export interface TransferItem { id: string; reference: string; incoming: boolean; otherShop: string | null; lines: number; created_at: string }
export interface PendingPo { id: string; reference: string; status: string; supplier: string | null; expected: string | null; total: number | null; created_at: string }

export interface ShopStockDetail {
  levels: Block<{ out: number; low: number; list: StockAlertItem[]; stockValue: number }>
  expiry: Block<{ expired: number; soon: number; list: ExpiryAlertItem[] }>
  transfers: Block<TransferItem[]>
  purchaseOrders: Block<PendingPo[]>
}

export function useShopStockDetail(shop: Shop | null, show: { expiry: boolean; transfers: boolean; purchaseOrders: boolean }) {
  const [detail, setDetail] = useState<ShopStockDetail | null>(null)
  const shopId = shop?.id

  const refresh = useCallback(async () => {
    if (!shop) return
    const [prodRes, catRes, expiryRes, transfersRes, poRes] = await Promise.all([
      settle(withTimeout<any>(supabase.from('products').select('id, name, unit, quantity, low_stock_threshold, buying_price, category_id').eq('shop_id', shop.id).eq('is_active', true), 20_000)
        .then((r: any) => { if (r.error) throw r.error; return r.data as any[] })),
      settle(withTimeout<any>(supabase.from('categories').select('id, expiry_alert_days').eq('shop_id', shop.id), 20_000)
        .then((r: any) => { if (r.error) throw r.error; return r.data as any[] })),
      show.expiry ? settle(fetchExpiryByProduct(supabase, [shop.id])) : Promise.resolve(ok<Record<string, string>>({})),
      show.transfers ? settle(getJson(`/api/stock-transfers?shop_id=${shop.id}`)) : Promise.resolve(ok<any>({ data: [] })),
      show.purchaseOrders ? settle(getJson(`/api/purchase-orders?shop_id=${shop.id}`)) : Promise.resolve(ok<any>({ data: [] })),
    ])

    const products = prodRes.data || []
    const levels: ShopStockDetail['levels'] = prodRes.error ? failed() : (() => {
      let out = 0, low = 0, stockValue = 0
      const alerts: (StockAlertItem & { ratio: number })[] = []
      for (const p of products) {
        const qty = Number(p.quantity) || 0
        const threshold = lowStockThresholdOf(p, shop.low_stock_threshold)
        stockValue += Math.max(qty, 0) * (Number(p.buying_price) || 0)
        if (qty <= 0) out++
        else if (qty <= threshold) low++
        else continue
        alerts.push({ id: p.id, name: p.name, unit: p.unit, quantity: qty, threshold, ratio: threshold > 0 ? qty / threshold : 0 })
      }
      // Ruptures d'abord, puis les plus proches de zéro par rapport à leur seuil
      alerts.sort((a, b) => a.ratio - b.ratio || a.name.localeCompare(b.name))
      return ok({ out, low, stockValue, list: alerts.slice(0, LIST_MAX).map(({ ratio, ...rest }) => rest) })
    })()

    const expiry: ShopStockDetail['expiry'] = !show.expiry ? ok({ expired: 0, soon: 0, list: [] })
      : (prodRes.error || catRes.error || expiryRes.error) ? failed() : (() => {
        const ctx: StockRulesContext = {
          shopExpiryAlertDays: shop.expiry_alert_days,
          categoryAlertDays: Object.fromEntries((catRes.data || []).map((c: any) => [c.id, c.expiry_alert_days])),
          expiryByProduct: expiryRes.data || {},
          soldQtyByProduct: {},
          soldQtyLoaded: false,
        }
        let expired = 0, soon = 0
        const list: ExpiryAlertItem[] = []
        for (const p of products) {
          const isOld = isExpired(p, ctx)
          if (!isOld && !isExpiringSoon(p, ctx)) continue
          isOld ? expired++ : soon++
          list.push({ id: p.id, name: p.name, unit: p.unit, quantity: Number(p.quantity) || 0, date: ctx.expiryByProduct[p.id], expired: isOld })
        }
        list.sort((a, b) => a.date.localeCompare(b.date))
        return ok({ expired, soon, list: list.slice(0, LIST_MAX) })
      })()

    const transfers: ShopStockDetail['transfers'] = transfersRes.error ? failed() : ok(
      ((transfersRes.data?.data ?? []) as any[])
        .filter(tr => tr.status === 'sent')
        .map(tr => {
          const incoming = tr.destination_shop_id === shop.id
          return {
            id: tr.id, reference: tr.reference, incoming,
            otherShop: incoming ? tr.source_shop_name : tr.destination_shop_name,
            lines: (tr.stock_transfer_items || []).length, created_at: tr.created_at,
          }
        }),
    )

    const purchaseOrders: ShopStockDetail['purchaseOrders'] = poRes.error ? failed() : ok(
      ((poRes.data?.data ?? []) as any[])
        .filter(po => ['draft', 'sent', 'partial'].includes(po.status))
        .map(po => ({
          id: po.id, reference: po.reference, status: po.status, supplier: po.suppliers?.name ?? null,
          expected: po.expected_delivery_date, total: po.total_amount, created_at: po.created_at,
        })),
    )

    setDetail({ levels, expiry, transfers, purchaseOrders })
  }, [shopId, show.expiry, show.transfers, show.purchaseOrders]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setDetail(null); refresh() }, [refresh])
  return { detail, refresh }
}

// ── Caisse ──────────────────────────────────────────────────────────────────

export interface ShopCashDetail {
  today: Block<{
    total: number
    salesCount: number
    repayments: number
    byMethod: { method: string; amount: number }[]
    byPerson: { id: string; name: string | null; amount: number; count: number }[]
  }>
  credit: Block<{ total: number; debtors: number; overdue: number }>
  review: Block<{ count: number; list: { id: string; sale_number: string | null; created_at: string; reasons: string[] }[] }>
}

export function useShopCashDetail(shop: Shop | null, show: { credit: boolean; review: boolean }) {
  const [detail, setDetail] = useState<ShopCashDetail | null>(null)
  const shopId = shop?.id

  const refresh = useCallback(async () => {
    if (!shop) return
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const since = start.toISOString()
    const [payRes, salesRes, debtsRes, reviewRes] = await Promise.all([
      settle(withTimeout<any>(supabase.from('payments')
        .select('amount, method, is_repayment, received_by, sales!inner(shop_id, sale_status, cashier_id)')
        .eq('sales.shop_id', shop.id).eq('is_cancelled', false).eq('is_write_off', false).gte('paid_at', since), 20_000)
        .then((r: any) => { if (r.error) throw r.error; return r.data as any[] })),
      settle(withTimeout<any>(supabase.from('sales').select('id', { count: 'exact', head: true })
        .eq('shop_id', shop.id).eq('sale_status', 'active').gte('created_at', since), 20_000)
        .then((r: any) => { if (r.error) throw r.error; return r.count as number })),
      show.credit ? settle(getJson(`/api/payments/debts?shop_ids=${shop.id}`)) : Promise.resolve(ok<any>({ debtors: [] })),
      show.review ? settle(withTimeout<any>(supabase.from('sales').select('id, sale_number, created_at, review_reason', { count: 'exact' })
        .eq('shop_id', shop.id).not('review_reason', 'is', null).is('reviewed_at', null)
        .order('created_at', { ascending: false }).limit(5), 20_000)
        .then((r: any) => { if (r.error) throw r.error; return { rows: r.data as any[], count: r.count as number } })) : Promise.resolve(ok<any>({ rows: [], count: 0 })),
    ])

    let today: ShopCashDetail['today'] = failed()
    if (!payRes.error && !salesRes.error) {
      const byMethod: Record<string, number> = {}
      const byPerson: Record<string, { amount: number; count: number }> = {}
      let total = 0, repayments = 0
      for (const p of payRes.data || []) {
        if (p.sales?.sale_status === 'cancelled') continue
        const amount = Number(p.amount) || 0
        total += amount
        if (p.is_repayment) repayments += amount
        byMethod[p.method || 'cash'] = (byMethod[p.method || 'cash'] || 0) + amount
        // Comme le Contrôle de caisse : la vente au vendeur, le remboursement à qui l'a reçu
        const who = (p.is_repayment ? p.received_by : p.sales?.cashier_id) || 'unknown'
        byPerson[who] = byPerson[who] || { amount: 0, count: 0 }
        byPerson[who].amount += amount
        byPerson[who].count++
      }
      const ids = Object.keys(byPerson).filter(id => id !== 'unknown')
      const names: Record<string, string> = {}
      if (ids.length) {
        try {
          const { data } = await withTimeout<any>(supabase.from('profiles').select('id, full_name').in('id', ids), 20_000)
          for (const pr of data || []) names[pr.id] = pr.full_name
        } catch { /* noms absents : identifiant inconnu affiché */ }
      }
      today = ok({
        total, repayments, salesCount: salesRes.data || 0,
        byMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
        byPerson: Object.entries(byPerson).map(([id, v]) => ({ id, name: names[id] ?? null, ...v })).sort((a, b) => b.amount - a.amount),
      })
    }

    const todayIso = new Date().toISOString().slice(0, 10)
    const credit: ShopCashDetail['credit'] = debtsRes.error ? failed() : (() => {
      const debtors = (debtsRes.data?.debtors || []) as any[]
      return ok({
        total: debtors.reduce((s, d) => s + (Number(d.totalDebt) || 0), 0),
        debtors: debtors.length,
        // Même règle que la page Crédits : échéance dépassée et solde restant
        overdue: debtors.filter(d => (d.unpaidSales || []).some((s: any) => s.due_date && s.balance > 0 && s.due_date < todayIso)).length,
      })
    })()

    const review: ShopCashDetail['review'] = reviewRes.error ? failed() : ok({
      count: reviewRes.data?.count || 0,
      list: (reviewRes.data?.rows || []).map((s: any) => ({
        id: s.id, sale_number: s.sale_number, created_at: s.created_at,
        reasons: String(s.review_reason || '').split(',').filter(Boolean),
      })),
    })

    setDetail({ today, credit, review })
  }, [shopId, show.credit, show.review]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setDetail(null); refresh() }, [refresh])
  return { detail, refresh }
}

// ── Historique ──────────────────────────────────────────────────────────────

/** Familles d'actions du journal de la boutique (filtre) */
export const HISTORY_GROUPS = {
  sales: ['sale.', 'payment.'],
  stock: ['create_product', 'update_product', 'archive_product', 'restore_product', 'delete_product', 'bulk_delete_products', 'delete_all_products', 'bulk_update_category', 'update_batch_promo', 'bulk_update_promo', 'stock_transfer.', 'purchase_order.', 'supplier.', 'inventory'],
  team: ['member.', 'permissions.'],
  shop: ['shop.', 'entity.', 'billing.', 'account.'],
  money: ['expense.', 'budget.', 'customer.'],
} as const
export type HistoryGroup = keyof typeof HISTORY_GROUPS

export function historyGroupOf(action: string): HistoryGroup | null {
  for (const [group, prefixes] of Object.entries(HISTORY_GROUPS) as [HistoryGroup, readonly string[]][]) {
    if (prefixes.some(p => action === p || action.startsWith(p))) return group
  }
  return null
}

export interface HistoryEntry { id: string; action: string; actor_email: string | null; created_at: string; metadata: Record<string, any>; target_id: string | null }

export const HISTORY_PAGE = 200

export function useShopHistory(shopId: string | null, enabled: boolean, period: 'all' | 'today' | '7d' | '30d', limit = HISTORY_PAGE) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!shopId || !enabled) return
    setLoading(true)
    try {
      // Actions internes de l'équipe StockShop (admin.*) exclues : notes internes
      let query = supabase.from('audit_logs').select('id, action, actor_email, created_at, metadata, target_id')
        .eq('shop_id', shopId).not('action', 'like', 'admin.%')
        .order('created_at', { ascending: false }).limit(limit)
      if (period !== 'all') {
        const d = new Date(); d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() - (period === 'today' ? 0 : period === '7d' ? 6 : 29))
        query = query.gte('created_at', d.toISOString())
      }
      const { data, error: err } = await withTimeout<any>(query, 20_000)
      if (err) throw err
      setEntries(data || [])
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [shopId, enabled, period, limit])

  useEffect(() => { refresh() }, [refresh])
  return { entries, error, loading, refresh }
}
