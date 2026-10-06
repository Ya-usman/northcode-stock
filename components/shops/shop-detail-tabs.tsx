'use client'

// Onglets Stock, Caisse et Historique de la fiche boutique (phase 3, lot 3A).
// Résumés en lecture seule ; chaque bouton ouvre le module complet, déjà
// placé sur cette boutique (et filtré quand c'est possible). Aucune règle de
// calcul ici : tout vient de lib/shops/shop-detail-data.ts.

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, Ban, CalendarClock, ChevronDown, ClipboardList, Coins, CreditCard, Edit2, FileText,
  History, Package, PackageX, Plus, RefreshCw, ShieldCheck, ShoppingCart, Store, Trash2, Truck, UserCog, Users, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils/cn'
import {
  useShopStockDetail, useShopCashDetail, useShopHistory, historyGroupOf, HISTORY_GROUPS, HISTORY_PAGE,
  type HistoryEntry, type HistoryGroup,
} from '@/lib/shops/shop-detail-data'
import type { Shop } from '@/lib/types/database'

// ── Éléments communs ────────────────────────────────────────────────────────

export function Section({ title, icon: Icon, summary, action, children, testId }: {
  title: string; icon: typeof Store; summary?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; testId?: string
}) {
  return (
    <section className="rounded-xl border bg-card shadow-sm" data-testid={testId}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4 text-muted-foreground" />{title}</h3>
          {summary && <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 py-2">{children}</div>
    </section>
  )
}

function OpenButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={onClick} data-testid={testId}>{label}</Button>
}

function Unavailable({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('shop_detail')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted-foreground" data-testid="shop-block-unavailable">
      <span>{t('unavailable')}</span>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />{t('retry')}</Button>
    </div>
  )
}

const Empty = ({ text }: { text: string }) => <p className="py-3 text-sm text-muted-foreground">{text}</p>
const Loading = () => <div className="space-y-2 py-2"><Skeleton className="h-8 rounded-lg" /><Skeleton className="h-8 rounded-lg" /></div>

const dateFmt = (iso: string, locale: string, withTime = false) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale, withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })

// ── Stock ───────────────────────────────────────────────────────────────────

export function ShopStockTab({ shop, can, isOwner, fmt, openPage }: {
  shop: Shop
  can: { expiry: boolean; transfers: boolean; purchaseOrders: boolean }
  isOwner: boolean
  fmt: (n: number) => string
  /** Ouvre un module sur cette boutique ; preset = filtres posés avant la navigation */
  openPage: (path: string, preset?: { page: string; filters: Record<string, unknown> }) => void
}) {
  const t = useTranslations('shop_detail')
  const locale = useLocale()
  const { detail, refresh } = useShopStockDetail(shop, can)
  const levels = detail?.levels, expiry = detail?.expiry, transfers = detail?.transfers, pos = detail?.purchaseOrders
  const unitOf = (u: string | null) => (u && u !== 'piece' ? ` ${u}` : '')

  return (
    <div className="space-y-4" data-testid="shop-stock">
      {isOwner && levels?.data && (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 shadow-sm" data-testid="shop-stock-value">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Coins className="h-4 w-4" />{t('stock_value')}</span>
          <span className="text-base font-bold tabular-nums">{fmt(levels.data.stockValue)}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('levels_title')} icon={PackageX} testId="shop-stock-levels"
          summary={levels?.data ? t('levels_summary', { out: levels.data.out, low: levels.data.low }) : undefined}
          action={<OpenButton label={t('open_products')} testId="shop-open-products"
            onClick={() => openPage('stock/products', { page: 'stock', filters: { statusFilter: levels?.data?.out ? 'out' : levels?.data?.low ? 'low' : 'all' } })} />}>
          {!detail ? <Loading /> : levels!.error ? <Unavailable onRetry={refresh} /> : !levels!.data!.list.length ? <Empty text={t('levels_empty')} /> : (
            <ul className="divide-y">
              {levels!.data!.list.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.quantity <= 0
                    ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">{t('out_badge')}</span>
                    : <span className="text-xs tabular-nums text-amber-600 dark:text-amber-400">{t('qty_of_threshold', { qty: `${p.quantity}${unitOf(p.unit)}`, threshold: p.threshold })}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {can.expiry && (
          <Section title={t('expiry_title')} icon={CalendarClock} testId="shop-stock-expiry"
            summary={expiry?.data ? t('expiry_summary', { expired: expiry.data.expired, soon: expiry.data.soon }) : undefined}
            action={<OpenButton label={t('open_expiry')} onClick={() => openPage('stock/expiry', { page: 'expiry', filters: { statusFilter: 'expiring' } })} />}>
            {!detail ? <Loading /> : expiry!.error ? <Unavailable onRetry={refresh} /> : !expiry!.data!.list.length ? <Empty text={t('expiry_empty')} /> : (
              <ul className="divide-y">
                {expiry!.data!.list.map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-xs text-muted-foreground">· {p.quantity}{unitOf(p.unit)}</span></span>
                    <span className={cn('text-xs tabular-nums', p.expired ? 'font-medium text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400')}>
                      {p.expired ? t('expired_on', { date: dateFmt(p.date, locale) }) : t('expires_on', { date: dateFmt(p.date, locale) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {can.transfers && (
          <Section title={t('transfers_title')} icon={Truck} testId="shop-stock-transfers"
            action={<OpenButton label={t('open_transfers')} onClick={() => openPage('stock/transfers')} />}>
            {!detail ? <Loading /> : transfers!.error ? <Unavailable onRetry={refresh} /> : !transfers!.data!.length ? <Empty text={t('transfers_empty')} /> : (
              <ul className="divide-y">
                {transfers!.data!.map(tr => (
                  <li key={tr.id} className="flex items-center gap-3 py-2 text-sm">
                    {tr.incoming ? <ArrowDownLeft className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" /> : <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-stockshop-blue dark:text-blue-400" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{tr.incoming ? t('transfer_in', { shop: tr.otherShop || '—' }) : t('transfer_out', { shop: tr.otherShop || '—' })}</span>
                      <span className="block text-xs text-muted-foreground">{tr.reference} · {t('lines', { count: tr.lines })} · {dateFmt(tr.created_at, locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {can.purchaseOrders && (
          <Section title={t('po_title')} icon={ClipboardList} testId="shop-stock-po"
            action={<OpenButton label={t('open_po')} onClick={() => openPage('suppliers?view=purchase_orders')} />}>
            {!detail ? <Loading /> : pos!.error ? <Unavailable onRetry={refresh} /> : !pos!.data!.length ? <Empty text={t('po_empty')} /> : (
              <ul className="divide-y">
                {pos!.data!.slice(0, 10).map(po => (
                  <li key={po.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{po.supplier || '—'} <span className="text-xs text-muted-foreground">· {po.reference}</span></span>
                      <span className="block text-xs text-muted-foreground">
                        {po.expected ? t('po_expected', { date: dateFmt(po.expected, locale) }) : dateFmt(po.created_at, locale)}
                        {po.total != null && isOwner ? ` · ${fmt(po.total)}` : ''}
                      </span>
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                      po.status === 'draft' ? 'bg-muted text-muted-foreground' : po.status === 'partial' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400')}>
                      {t(`po_status_${po.status}` as any)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Caisse ──────────────────────────────────────────────────────────────────

const KNOWN_METHODS = new Set(['cash', 'mobile_money', 'transfer', 'paystack', 'credit'])

export function ShopCashTab({ shop, can, fmt, openPage }: {
  shop: Shop
  can: { caisse: boolean; credit: boolean; review: boolean }
  fmt: (n: number) => string
  openPage: (path: string) => void
}) {
  const t = useTranslations()
  const locale = useLocale()
  const { detail, refresh } = useShopCashDetail(shop, { credit: can.credit, review: can.review })
  const today = detail?.today, credit = detail?.credit, review = detail?.review
  const method = (m: string) => (KNOWN_METHODS.has(m) ? t(`payment.${m}` as any) : m)

  return (
    <div className="space-y-4" data-testid="shop-cash">
      <Section title={t('shop_detail.today_title')} icon={Wallet} testId="shop-cash-today"
        summary={today?.data ? t('shop_detail.today_sales', { count: today.data.salesCount }) : undefined}
        action={can.caisse ? <OpenButton label={t('shop_detail.open_caisse')} onClick={() => openPage('caisse')} /> : undefined}>
        {!detail ? <Loading /> : today!.error ? <Unavailable onRetry={refresh} /> : (
          <div className="space-y-3 py-2">
            <div>
              <p className="text-2xl font-bold tabular-nums" data-testid="shop-cash-total">{fmt(today!.data!.total)}</p>
              {today!.data!.repayments > 0 && <p className="text-xs text-muted-foreground">{t('shop_detail.today_repayments', { amount: fmt(today!.data!.repayments) })}</p>}
            </div>
            {today!.data!.total === 0 ? <Empty text={t('shop_detail.today_empty')} /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('shop_detail.by_method')}</p>
                  <ul className="divide-y">
                    {today!.data!.byMethod.map(m => (
                      <li key={m.method} className="flex justify-between gap-2 py-1.5 text-sm"><span>{method(m.method)}</span><span className="font-medium tabular-nums">{fmt(m.amount)}</span></li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('shop_detail.by_person')}</p>
                  <ul className="divide-y">
                    {today!.data!.byPerson.map(p => (
                      <li key={p.id} className="flex justify-between gap-2 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{p.name || t('shop_detail.unknown_person')} <span className="text-xs text-muted-foreground">· {t('shop_detail.payments_count', { count: p.count })}</span></span>
                        <span className="font-medium tabular-nums">{fmt(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {can.credit && (
          <Section title={t('shop_detail.credit_title')} icon={CreditCard} testId="shop-cash-credit"
            action={<OpenButton label={t('shop_detail.open_credits')} onClick={() => openPage('payments')} />}>
            {!detail ? <Loading /> : credit!.error ? <Unavailable onRetry={refresh} /> : credit!.data!.debtors === 0 ? <Empty text={t('shop_detail.credit_empty')} /> : (
              <div className="py-2">
                <p className="text-xs text-muted-foreground">{t('shop_detail.credit_total')}</p>
                <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{fmt(credit!.data!.total)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('shop_detail.credit_debtors', { count: credit!.data!.debtors })}
                  {credit!.data!.overdue > 0 && <span className="font-medium text-red-600 dark:text-red-400"> · {t('shop_detail.credit_overdue', { count: credit!.data!.overdue })}</span>}
                </p>
              </div>
            )}
          </Section>
        )}

        {can.review && (
          <Section title={t('shop_detail.review_title')} icon={AlertTriangle} testId="shop-cash-review"
            action={<OpenButton label={t('shop_detail.open_sales')} onClick={() => openPage('sales/history')} />}>
            {!detail ? <Loading /> : review!.error ? <Unavailable onRetry={refresh} /> : review!.data!.count === 0 ? <Empty text={t('shop_detail.review_empty')} /> : (
              <ul className="divide-y">
                {review!.data!.list.map(s => (
                  <li key={s.id} className="py-2 text-sm">
                    <span className="flex justify-between gap-2"><span className="font-medium">#{s.sale_number || s.id.slice(0, 8)}</span><span className="text-xs text-muted-foreground">{dateFmt(s.created_at, locale, true)}</span></span>
                    <span className="block text-xs text-amber-700 dark:text-amber-400">{s.reasons.map(r => t(`sales.review_reason_${r}` as any)).join(' · ')}</span>
                  </li>
                ))}
                {review!.data!.count > review!.data!.list.length && (
                  <li className="py-2 text-xs text-muted-foreground">{t('shop_detail.review_more', { count: review!.data!.count - review!.data!.list.length })}</li>
                )}
              </ul>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Historique ──────────────────────────────────────────────────────────────

/** Actions qui ont un libellé ; les autres s'affichent « Autre action » */
const LABELLED = new Set([
  'member.invite', 'member.delete', 'member.role_change', 'member.toggle_active', 'member.assign', 'permissions.update',
  'shop.update_hours', 'shop.update_info', 'shop.extend_hours', 'shop.update_logo', 'entity.update',
  'billing.subscribe', 'billing.verify', 'billing.limit_enforced', 'billing.grant_expiry_reminder', 'account.register',
  'sale.cancel', 'sale.validate_payment', 'sale.edit', 'sale.offline_synced', 'sale.reviewed', 'sale.delete', 'sale.postpone_due_date',
  'payment.cancel', 'payment.edit', 'payment.write_off',
  'expense.create', 'expense.update', 'expense.delete', 'expense.recurring_generated', 'budget.set', 'budget.delete',
  'customer.create', 'customer.update', 'customer.delete', 'customer.merged', 'supplier.delete',
  'purchase_order.send', 'purchase_order.receive', 'purchase_order.cancel', 'purchase_order.delete',
  'stock_transfer.send', 'stock_transfer.receive', 'stock_transfer.cancel',
  'create_product', 'update_product', 'archive_product', 'restore_product', 'delete_product', 'bulk_delete_products', 'delete_all_products',
  'bulk_update_category', 'update_batch_promo', 'bulk_update_promo',
])

const GROUP_STYLE: Record<HistoryGroup, { icon: typeof Store; tone: string }> = {
  sales: { icon: ShoppingCart, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400' },
  stock: { icon: Package, tone: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' },
  team: { icon: Users, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400' },
  shop: { icon: Store, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400' },
  money: { icon: FileText, tone: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400' },
}
const DANGER = /(\.|_)(cancel|delete|write_off)|^delete_|^bulk_delete|archive_product/

const MONEY_KEYS = new Set(['amount', 'total', 'old_total', 'new_total', 'debt_moved', 'selling_price', 'buying_price', 'promo_price'])
const PRODUCT_FIELD_KEYS: Record<string, string> = {
  name: 'products.journal_field_name', selling_price: 'products.journal_field_selling_price',
  buying_price: 'products.journal_field_buying_price', low_stock_threshold: 'products.journal_field_threshold', sku: 'products.journal_field_sku',
}

export function ShopHistoryTab({ shopId, fmt }: { shopId: string; fmt: (n: number) => string }) {
  const t = useTranslations()
  const locale = useLocale()
  const [period, setPeriod] = useState<'all' | 'today' | '7d' | '30d'>('7d')
  const [group, setGroup] = useState<'all' | HistoryGroup>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(HISTORY_PAGE)
  const { entries, error, loading, refresh } = useShopHistory(shopId, true, period, limit)
  // Chaque période repart de la première page
  const changePeriod = (p: typeof period) => { setPeriod(p); setLimit(HISTORY_PAGE) }

  const visible = useMemo(() => (entries || []).filter(e => group === 'all' || historyGroupOf(e.action) === group), [entries, group])
  const days = useMemo(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = iso(new Date())
    const y = new Date(); y.setDate(y.getDate() - 1)
    const out: { key: string; label: string; items: HistoryEntry[] }[] = []
    for (const e of visible) {
      const d = new Date(e.created_at)
      const key = iso(d)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        g = { key, label: key === today ? t('activity_journal.today') : key === iso(y) ? t('activity_journal.yesterday') : d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }), items: [] }
        out.push(g)
      }
      g.items.push(e)
    }
    return out
  }, [visible, locale, t])

  const label = (action: string) => (LABELLED.has(action) ? t(`shop_detail.act.${action.replace(/\./g, '_')}` as any) : t('shop_detail.act_other'))
  const subject = (m: Record<string, any>) =>
    m.product_name || m.member_name || m.name || m.kept_name || (m.sale_number ? `#${m.sale_number}` : null) || m.reference || m.description || m.email || null
  const show = (key: string, v: unknown): string => {
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return v ? t('shop_detail.yes') : t('shop_detail.no')
    if (MONEY_KEYS.has(key) && typeof v === 'number') return fmt(v)
    if (typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5)
    if (key.endsWith('role') && typeof v === 'string') return t(`roles.${v}` as any)
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  const fieldLabel = (key: string) => (PRODUCT_FIELD_KEYS[key] ? t(PRODUCT_FIELD_KEYS[key] as any) : key.replace(/_/g, ' '))

  /** Tableau Avant / Après ou Valeur, construit à partir des métadonnées connues */
  const rows = (m: Record<string, any>): { label: string; from?: string; to: string }[] => {
    const out: { label: string; from?: string; to: string }[] = []
    if (m.changes && typeof m.changes === 'object') {
      for (const [k, v] of Object.entries<any>(m.changes)) out.push({ label: fieldLabel(k), from: show(k, v?.from), to: show(k, v?.to) })
    }
    if (m.before && m.after && typeof m.before === 'object') {
      for (const k of Object.keys(m.after)) {
        const a = show(k, m.before[k]), b = show(k, m.after[k])
        if (a !== b) out.push({ label: fieldLabel(k), from: a, to: b })
      }
    }
    for (const [o, n, key] of [['old_role', 'new_role', 'role'], ['old_total', 'new_total', 'total'], ['old_active', 'new_active', 'active']] as const) {
      if (o in m || n in m) out.push({ label: t(`shop_detail.field_${key}` as any), from: show(o, m[o]), to: show(n, m[n]) })
    }
    const single: [string, string][] = [['reason', 'shop_detail.field_reason'], ['amount', 'shop_detail.field_amount'], ['minutes', 'shop_detail.field_minutes'], ['role', 'shop_detail.field_role'], ['category', 'shop_detail.field_category'], ['offline_reason', 'shop_detail.field_offline_reason']]
    for (const [k, key] of single) if (m[k] != null && m[k] !== '') out.push({ label: t(key as any), to: show(k, m[k]) })
    return out
  }

  return (
    <div className="space-y-3" data-testid="shop-history">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Select value={period} onValueChange={v => changePeriod(v as typeof period)}>
          <SelectTrigger className="h-9 text-xs" aria-label={t('activity_journal.period_label')} data-testid="shop-history-period"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t('activity_journal.today')}</SelectItem>
            <SelectItem value="7d">{t('activity_journal.period_7d')}</SelectItem>
            <SelectItem value="30d">{t('activity_journal.period_30d')}</SelectItem>
            <SelectItem value="all">{t('activity_journal.period_all')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={group} onValueChange={v => setGroup(v as typeof group)}>
          <SelectTrigger className="h-9 text-xs" aria-label={t('activity_journal.action_label')} data-testid="shop-history-group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('activity_journal.action_all')}</SelectItem>
            {(Object.keys(HISTORY_GROUPS) as HistoryGroup[]).map(g => <SelectItem key={g} value={g}>{t(`shop_detail.group_${g}` as any)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && !entries ? <Unavailable onRetry={refresh} /> : !entries || (loading && !entries.length) ? <Loading /> : !visible.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          <History className="h-6 w-6 opacity-40" />{t('shop_detail.history_empty')}
        </div>
      ) : days.map(d => (
        <section key={d.key} className="space-y-2" data-testid="shop-history-day">
          <h4 className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.label}</h4>
          {d.items.map(e => {
            const g = historyGroupOf(e.action)
            const style = g ? GROUP_STYLE[g] : { icon: Edit2, tone: 'bg-muted text-muted-foreground' }
            const Icon = DANGER.test(e.action) ? (e.action.includes('cancel') ? Ban : Trash2)
              : e.action.startsWith('create') || e.action.endsWith('.create') || e.action.endsWith('.invite') ? Plus
              : e.action === 'member.role_change' ? UserCog : e.action === 'sale.reviewed' ? ShieldCheck : style.icon
            const tone = DANGER.test(e.action) ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : style.tone
            const m = e.metadata || {}
            const who = subject(m)
            const isOpen = open === e.id
            const time = new Date(e.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
            const r = isOpen ? rows(m) : []
            const hasFrom = r.some(x => x.from !== undefined)
            return (
              <div key={e.id} className="overflow-hidden rounded-lg border bg-card">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40" data-testid="shop-history-entry">
                  <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', tone)}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label(e.action)}</span>
                    {who && <span className="block truncate text-xs text-muted-foreground">{who}</span>}
                    <span className="mt-0.5 block text-xs text-muted-foreground/80">{m.actor_name || e.actor_email || t('shop_detail.system')} · {time}</span>
                  </span>
                  <ChevronDown className={cn('mt-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-xs" data-testid="shop-history-detail">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">{t('activity_journal.who')}</dt>
                      <dd className="font-medium">{e.actor_email || t('shop_detail.system')}</dd>
                      <dt className="text-muted-foreground">{t('activity_journal.when')}</dt>
                      <dd className="first-letter:uppercase">{new Date(e.created_at).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                    </dl>
                    {r.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border bg-background">
                        <table className="w-full">
                          <thead className="bg-muted/50 text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">{t('activity_journal.field')}</th>
                              {hasFrom && <th className="px-3 py-2 text-left font-medium">{t('activity_journal.before')}</th>}
                              <th className="px-3 py-2 text-left font-medium">{hasFrom ? t('activity_journal.after') : t('activity_journal.value')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {r.map((x, i) => (
                              <tr key={i}>
                                <td className="px-3 py-2 text-muted-foreground first-letter:uppercase">{x.label}</td>
                                {hasFrom && <td className="px-3 py-2 text-muted-foreground line-through">{x.from ?? '—'}</td>}
                                <td className="break-words px-3 py-2 font-medium">{x.to}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}

      {/* Page suivante : la base en renvoie autant que demandé → il en reste peut-être */}
      {entries && entries.length >= limit && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" className="h-9" disabled={loading} onClick={() => setLimit(l => l + HISTORY_PAGE)} data-testid="shop-history-more">
            {loading ? '…' : t('shop_detail.load_more')}
          </Button>
        </div>
      )}
    </div>
  )
}
