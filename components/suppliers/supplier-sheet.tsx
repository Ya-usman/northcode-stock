'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Banknote, ChevronRight, Edit2, FileText, Mail, MapPin, MessageCircle, Package, Phone, TrendingDown, TrendingUp } from 'lucide-react'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { FOOTER_CANCEL_CLASS, FOOTER_PRIMARY_CLASS, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { normalizeWhatsAppNumber } from '@/lib/utils/whatsapp'
import { getCountry } from '@/lib/saas/countries'
import { cn } from '@/lib/utils/cn'
import type { Supplier } from '@/lib/types/database'

// Fiche fournisseur en panneau latéral : contact (appeler, WhatsApp, e-mail),
// repères sous l'en-tête (commandes, montant acheté, délai moyen, livraisons
// complètes), solde dû avec accès au paiement, produits fournis avec leur
// prix d'achat, bons de commande (clic → historique du bon), tendance des
// prix. Actions dans le pied : Modifier, Nouveau bon.

export const PO_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400',
  received: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400',
  partial: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  cancelled: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
}

export const poTotalOf = (po: any) =>
  (po?.purchase_order_items || []).reduce((s: number, it: any) => s + (it.unit_price || 0) * it.quantity_ordered, 0)

interface Props {
  supplier: Supplier | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Produits dont ce fournisseur est le fournisseur principal */
  products: any[]
  /** Bons de commande de ce fournisseur */
  orders: any[]
  canManage: boolean
  shopCountry?: string | null
  fmt: (n: number) => string
  onEdit: (s: Supplier) => void
  onNewPo: (s: Supplier) => void
  onOpenPo: (po: any) => void
  onRecordPayment: (s: Supplier) => void
}

export function SupplierSheet({ supplier, open, onOpenChange, products, orders, canManage, shopCountry, fmt, onEdit, onNewPo, onOpenPo, onRecordPayment }: Props) {
  const t = useTranslations()
  const locale = useLocale()

  const stats = useMemo(() => {
    const meaningful = orders.filter(po => po.status !== 'draft')
    // 'partial' compte aussi comme une livraison reçue (argent dépensé, stock
    // rentré) — seule la complétude diffère.
    const received = orders.filter(po => po.status === 'received' || po.status === 'partial')
    const totalSpent = received.reduce((sum, po) =>
      sum + (po.purchase_order_items || []).reduce((s: number, it: any) => s + (it.unit_price || 0) * (it.quantity_received ?? it.quantity_ordered), 0), 0)
    const delays = received
      .filter(po => po.sent_at && po.received_at)
      .map(po => (new Date(po.received_at).getTime() - new Date(po.sent_at).getTime()) / 86_400_000)
    const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null
    const completeCount = received.filter(po => po.status === 'received').length
    const completeRate = received.length ? Math.round((completeCount / received.length) * 100) : null
    // Tendance des prix : premier et dernier prix payé par produit, commandes reçues dans l'ordre
    const sorted = [...received].sort((a, b) => (a.received_at || a.created_at).localeCompare(b.received_at || b.created_at))
    const history: Record<string, { first: number; last: number }> = {}
    for (const po of sorted) for (const it of po.purchase_order_items || []) {
      if (!it.unit_price) continue
      if (!history[it.product_name]) history[it.product_name] = { first: it.unit_price, last: it.unit_price }
      else history[it.product_name].last = it.unit_price
    }
    const trends = Object.entries(history).filter(([, v]) => v.first !== v.last)
      .map(([name, v]) => ({ name, ...v, pct: Math.round(((v.last - v.first) / v.first) * 100) }))
    return { ordersCount: meaningful.length, totalSpent, avgDelay, completeRate, trends }
  }, [orders])

  if (!supplier) return null
  const owed = Number(supplier.total_owed || 0)
  const prefix = getCountry(shopCountry).phonePrefix
  const waNumber = supplier.phone ? normalizeWhatsAppNumber(supplier.phone, prefix) : ''
  const recentOrders = [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8)
  const dateShort = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  const tile = (value: string, label: string, tone?: string) => (
    <div className="rounded-xl border bg-card px-2 py-2 text-center">
      <p className={cn('text-base font-bold tabular-nums leading-tight', tone)}>{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{label}</p>
    </div>
  )

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={supplier.name}
      description={[supplier.city, supplier.phone].filter(Boolean).join(' · ') || undefined}
      icon={<Package className="h-4 w-4" />}
      width="lg"
      testId="supplier-sheet"
      meta={(
        <div className="grid grid-cols-4 gap-2" data-testid="supplier-kpis">
          {tile(String(stats.ordersCount), t('suppliers.supplier_journal_orders_count'))}
          {tile(fmt(stats.totalSpent), t('suppliers.supplier_journal_total_spent'))}
          {tile(stats.avgDelay != null ? t('suppliers.supplier_journal_avg_delay_days', { count: stats.avgDelay }) : '—', t('suppliers.supplier_journal_avg_delay'))}
          {tile(stats.completeRate != null ? `${stats.completeRate}%` : '—', t('suppliers.supplier_journal_complete_rate'),
            stats.completeRate == null ? undefined : stats.completeRate >= 80 ? 'text-green-600 dark:text-green-400' : stats.completeRate >= 50 ? 'text-amber-500' : 'text-red-600 dark:text-red-400')}
        </div>
      )}
      actions={canManage ? (
        <div className={FOOTER_ROW_CLASS}>
          <Button type="button" variant="outline" className={cn(FOOTER_CANCEL_CLASS, 'gap-2')} onClick={() => onEdit(supplier)}>
            <Edit2 className="h-4 w-4" /> {t('suppliers.edit_supplier')}
          </Button>
          <Button type="button" variant="stockshop" className={FOOTER_PRIMARY_CLASS} onClick={() => onNewPo(supplier)} data-testid="sheet-new-po">
            <FileText className="h-4 w-4" /> {t('suppliers.new_po_for')}
          </Button>
        </div>
      ) : undefined}
    >
      <div className="space-y-4">
        {/* Contact */}
        <DrawerSection title={t('suppliers.sheet_contact')}>
          <div className="space-y-2 text-sm">
            {supplier.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{supplier.phone}</p>}
            {supplier.email && <p className="flex items-center gap-2 break-all"><Mail className="h-4 w-4 text-muted-foreground" />{supplier.email}</p>}
            {supplier.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{supplier.city}</p>}
            {!supplier.phone && !supplier.email && !supplier.city && <p className="text-muted-foreground">—</p>}
          </div>
          {(supplier.phone || supplier.email) && (
            <div className="flex flex-wrap gap-2">
              {supplier.phone && (
                <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                  <a href={`tel:${supplier.phone}`}><Phone className="h-3.5 w-3.5" />{t('suppliers.call')}</a>
                </Button>
              )}
              {waNumber && (
                <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-green-700 dark:text-green-400">
                  <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />{t('suppliers.whatsapp')}</a>
                </Button>
              )}
              {supplier.email && (
                <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                  <a href={`mailto:${supplier.email}`}><Mail className="h-3.5 w-3.5" />{t('suppliers.email')}</a>
                </Button>
              )}
            </div>
          )}
        </DrawerSection>

        {/* Solde dû */}
        {owed > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30" data-testid="supplier-owed">
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('suppliers.supplier_journal_owed')}</p>
              <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmt(owed)}</p>
            </div>
            {canManage && (
              <Button type="button" size="sm" className="h-9 gap-1.5 bg-amber-600 text-white hover:bg-amber-700" onClick={() => onRecordPayment(supplier)}>
                <Banknote className="h-4 w-4" />{t('suppliers.record_payment')}
              </Button>
            )}
          </div>
        )}

        {/* Produits fournis */}
        <DrawerSection title={t('suppliers.sheet_products')} description={t('suppliers.products_count', { count: products.length })}>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('suppliers.no_products_for_supplier')}</p>
          ) : (
            <div className="-mx-4 -my-4 divide-y divide-border">
              {products.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{p.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">{p.quantity} {p.unit}</span>
                    <span className="text-sm font-semibold tabular-nums">{fmt(Number(p.buying_price || 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DrawerSection>

        {/* Bons de commande */}
        <DrawerSection title={t('suppliers.sheet_orders')} description={t('suppliers.po_items_count', { count: orders.length })}>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('suppliers.sheet_no_orders')}</p>
          ) : (
            <div className="-mx-4 -my-4 divide-y divide-border">
              {recentOrders.map(po => (
                <button
                  key={po.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onOpenPo(po)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{po.reference}</span>
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', PO_STATUS_STYLES[po.status] || PO_STATUS_STYLES.draft)}>
                        {t(`suppliers.po_status_${po.status}` as any)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t('suppliers.po_items_count', { count: (po.purchase_order_items || []).length })} · {fmt(poTotalOf(po))} · {dateShort(po.created_at)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </DrawerSection>

        {/* Tendance des prix */}
        {stats.trends.length > 0 && (
          <DrawerSection title={t('suppliers.supplier_journal_price_trend_title')}>
            <div className="space-y-1.5">
              {stats.trends.map(tr => (
                <div key={tr.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{tr.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs tabular-nums text-muted-foreground">{fmt(tr.first)} → {fmt(tr.last)}</span>
                    <span className={cn('flex items-center gap-0.5 text-xs font-semibold tabular-nums', tr.pct > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                      {tr.pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {tr.pct > 0 ? '+' : ''}{tr.pct}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </DrawerSection>
        )}
      </div>
    </DetailDrawer>
  )
}
