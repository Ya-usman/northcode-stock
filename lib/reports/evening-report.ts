// Journée d'une boutique pour le résumé du soir (serveur, client admin, lecture seule).
// « Aujourd'hui » = journée locale du pays de la boutique (lib/reports/day-window.ts).

import { resolveCurrencyCode } from '@/lib/saas/currencies'
import { getLowStockAlerts } from '@/lib/alerts/stock-alerts'
import { localDay, timeZoneFor } from './day-window'

export interface ShopDay {
  name: string
  currency: string
  revenue: number
  salesCount: number
  revenueLastWeek: number
  collected: number
  byMethod: { method: string; amount: number }[]
  creditSold: number
  repayments: number
  totalDebt: number
  expenses: number
  /** Marge brute sur les lignes dont le prix d'achat est connu ; null si aucune */
  grossMargin: number | null
  /** Part du chiffre d'affaires couverte par un prix d'achat connu (0–1) */
  marginCoverage: number
  topProducts: { name: string; quantity: number; amount: number }[]
  sellers: { name: string; count: number; amount: number }[]
  discounts: { count: number; amount: number }
  cancelled: { count: number; amount: number }
  stock: { out: number; low: number }
}

const sum = (rows: any[] | null | undefined, k: string) => (rows || []).reduce((n, r) => n + (Number(r[k]) || 0), 0)

export async function collectShopDay(admin: any, shop: { id: string; name: string; currency?: string | null; country?: string | null; low_stock_threshold?: number | null }, now = new Date()): Promise<ShopDay> {
  const tz = timeZoneFor(shop.country)
  const today = localDay(tz, now)
  const lastWeek = localDay(tz, now, 7)
  const S = today.start.toISOString(), E = today.end.toISOString()

  const [rSales, rWeek, rPay, rDebts, rExp, rCancel, stock] = await Promise.all([
    admin.from('sales').select('id, total, balance, discount, cashier_id').eq('shop_id', shop.id).eq('sale_status', 'active').gte('created_at', S).lt('created_at', E),
    admin.from('sales').select('total').eq('shop_id', shop.id).eq('sale_status', 'active').gte('created_at', lastWeek.start.toISOString()).lt('created_at', lastWeek.end.toISOString()),
    // Encaissements du jour (ventes du jour ET remboursements de dettes), hors annulés / pertes
    admin.from('payments').select('amount, method, is_repayment, sales!inner(shop_id)').eq('sales.shop_id', shop.id)
      .gte('paid_at', S).lt('paid_at', E).or('is_cancelled.is.null,is_cancelled.eq.false').or('is_write_off.is.null,is_write_off.eq.false'),
    admin.from('customers').select('total_debt').eq('shop_id', shop.id).gt('total_debt', 0),
    admin.from('expenses').select('amount').eq('shop_id', shop.id).eq('date', today.date),
    admin.from('sales').select('total').eq('shop_id', shop.id).eq('sale_status', 'cancelled').gte('cancelled_at', S).lt('cancelled_at', E),
    getLowStockAlerts(admin, shop),
  ])
  // Une requête en échec ne doit jamais se transformer en « 0 » dans l'e-mail
  for (const [label, r] of [['ventes', rSales], ['semaine précédente', rWeek], ['encaissements', rPay], ['dettes', rDebts], ['dépenses', rExp], ['annulations', rCancel]] as const) {
    if ((r as any).error) throw new Error(`${shop.name} · ${label} : ${(r as any).error.message}`)
  }
  const { data: sales } = rSales, { data: weekAgo } = rWeek, { data: payments } = rPay, { data: debts } = rDebts, { data: expenses } = rExp, { data: cancelled } = rCancel
  const list = sales || []
  const ids = list.map((s: any) => s.id)

  // Lignes vendues : meilleures ventes et marge brute (prix d'achat connu)
  const { data: items } = ids.length
    ? await admin.from('sale_items').select('product_name, quantity, subtotal, buying_price').in('sale_id', ids)
    : { data: [] }
  const byProduct = new Map<string, { quantity: number; amount: number }>()
  let margin = 0, covered = 0, itemsTotal = 0
  for (const it of items || []) {
    const q = Number(it.quantity) || 0, sub = Number(it.subtotal) || 0
    const p = byProduct.get(it.product_name) || { quantity: 0, amount: 0 }
    p.quantity += q; p.amount += sub; byProduct.set(it.product_name, p)
    itemsTotal += sub
    if (it.buying_price !== null && it.buying_price !== undefined && Number(it.buying_price) > 0) { margin += sub - Number(it.buying_price) * q; covered += sub }
  }

  // Vendeurs
  const bySeller = new Map<string, { count: number; amount: number }>()
  for (const s of list) {
    const k = s.cashier_id || 'unknown'
    const v = bySeller.get(k) || { count: 0, amount: 0 }
    v.count++; v.amount += Number(s.total) || 0; bySeller.set(k, v)
  }
  const sellerIds = Array.from(bySeller.keys()).filter(k => k !== 'unknown')
  const { data: people } = sellerIds.length ? await admin.from('profiles').select('id, full_name').in('id', sellerIds) : { data: [] }
  const nameOf = (id: string) => (people || []).find((p: any) => p.id === id)?.full_name || 'Non renseigné'

  const methods = new Map<string, number>()
  for (const p of payments || []) methods.set(p.method || 'other', (methods.get(p.method || 'other') || 0) + (Number(p.amount) || 0))

  const discounted = list.filter((s: any) => Number(s.discount) > 0)
  return {
    name: shop.name,
    currency: resolveCurrencyCode(shop.currency, shop.country) || 'XOF',
    revenue: sum(list, 'total'),
    salesCount: list.length,
    revenueLastWeek: sum(weekAgo, 'total'),
    collected: sum(payments, 'amount'),
    byMethod: Array.from(methods, ([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    creditSold: sum(list, 'balance'),
    repayments: sum((payments || []).filter((p: any) => p.is_repayment), 'amount'),
    totalDebt: sum(debts, 'total_debt'),
    expenses: sum(expenses, 'amount'),
    grossMargin: covered > 0 ? margin : null,
    marginCoverage: itemsTotal > 0 ? covered / itemsTotal : 0,
    topProducts: Array.from(byProduct, ([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 3),
    sellers: Array.from(bySeller, ([id, v]) => ({ name: id === 'unknown' ? 'Non renseigné' : nameOf(id), ...v })).sort((a, b) => b.amount - a.amount),
    discounts: { count: discounted.length, amount: sum(discounted, 'discount') },
    cancelled: { count: (cancelled || []).length, amount: sum(cancelled, 'total') },
    stock: { out: stock.outOfStock.length, low: stock.lowStock.length },
  }
}
