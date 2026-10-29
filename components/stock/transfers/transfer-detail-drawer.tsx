'use client'

// Détail d'un transfert (Stock › Transferts V1) : résumé, produits (envoyé / reçu / écart, lots source avec date
// d'entrée et péremption, lot d'arrivée, coût seulement avec le droit de voir les coûts), historique (créé, envoyé,
// réceptionné, annulé, avec qui et quand). Actions selon les droits renvoyés par le serveur (qui revérifie tout).
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Ban, CheckCircle2, Clock, FileEdit, History, Loader2, Package, QrCode, Send, Store, Truck, XCircle } from 'lucide-react'
import { AppDrawer } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import { TransferStatusBadge } from './transfer-card'

const HISTORY_ICON: Record<string, typeof Truck> = { created: FileEdit, sent: Truck, received: CheckCircle2, received_with_discrepancy: CheckCircle2, cancelled: XCircle }

export function TransferDetailDrawer({ id, onOpenChange, onReceive, onSend, onEdit, onCancel, onShowQr, busy }: {
  id: string | null
  onOpenChange: (open: boolean) => void
  onReceive: (tr: any) => void
  onSend: (tr: any) => void
  onEdit: (tr: any) => void
  onCancel: (tr: any) => void
  onShowQr: (tr: any) => void
  busy?: string | null
}) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const [tr, setTr] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) { setTr(null); return }
    let cancelled = false
    setTr(null); setError(null)
    fetch(`/api/stock-transfers/${id}`).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) setError(json.error || 'Erreur'); else setTr(json.data)
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id])

  const dShort = (iso: string) => formatLocaleDate(iso, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const dLong = (iso: string) => formatLocaleDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = (iso: string) => formatLocaleTime(iso, locale)

  return (
    <AppDrawer
      open={!!id}
      onOpenChange={onOpenChange}
      category={tr ? `${tr.source_shop_name} → ${tr.destination_shop_name}` : undefined}
      title={tr?.reference || '…'}
      icon={<Truck className="h-4 w-4" />}
      width="md"
      testId="transfer-detail"
      footer={tr && (tr.can_receive || tr.can_send || tr.can_edit || tr.can_cancel || tr.status === 'sent') ? () => (
        <div className="flex flex-col gap-2">
          {tr.can_receive && (
            <Button variant="stockshop" className="h-11 w-full gap-2" onClick={() => onReceive(tr)} data-testid="detail-receive">
              <QrCode className="h-4 w-4" />{t('receive_cta')}
            </Button>
          )}
          {tr.can_send && (
            <Button variant="stockshop" className="h-11 w-full gap-2" loading={busy === `send:${tr.id}`} onClick={() => onSend(tr)} data-testid="detail-send">
              <Send className="h-4 w-4" />{t('action_send')}
            </Button>
          )}
          <div className="flex gap-2">
            {tr.status === 'sent' && (
              <Button variant="outline" className="h-11 flex-1 gap-2" onClick={() => onShowQr(tr)} data-testid="detail-qr"><QrCode className="h-4 w-4" />{t('action_show_qr')}</Button>
            )}
            {tr.can_edit && <Button variant="outline" className="h-11 flex-1 gap-2" onClick={() => onEdit(tr)}><FileEdit className="h-4 w-4" />{t('action_edit')}</Button>}
            {tr.can_cancel && (
              <Button variant="outline" className="h-11 flex-1 gap-2 text-destructive border-destructive/30" loading={busy === `cancel:${tr.id}`} onClick={() => onCancel(tr)} data-testid="detail-cancel">
                <Ban className="h-4 w-4" />{t('action_cancel')}
              </Button>
            )}
          </div>
        </div>
      ) : undefined}
    >
      {!tr && !error && <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}
      {error && <p className="py-8 text-center text-sm text-destructive">{error}</p>}
      {tr && (
        <div className="space-y-5">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <TransferStatusBadge status={tr.status} />
              {tr.status === 'received' && tr.units_missing > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{t('missing_units', { count: tr.units_missing })}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4 text-muted-foreground" />{tr.source_shop_name}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4 text-muted-foreground" />{tr.destination_shop_name}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Package className="h-4 w-4" />{t('card_totals', { products: tr.stock_transfer_items.length, units: tr.units_sent })}</p>
            {tr.notes && <p className="mt-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-sm">{tr.notes}</p>}
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('section_products')}</h3>
            {tr.stock_transfer_items.map((it: any) => {
              const received = tr.status === 'received' ? Number(it.quantity_received) || 0 : null
              const gap = received == null ? 0 : (Number(it.quantity_sent) || 0) - received
              return (
                <div key={it.id} className="rounded-xl border bg-card p-3" data-testid="detail-line">
                  <div className="flex items-start gap-3">
                    {it.image_url
                      ? <img src={it.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border object-cover" />
                      : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted"><Package className="h-5 w-5 text-muted-foreground" /></div>}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{it.product_name}</p>
                      {it.sku && <p className="text-xs text-muted-foreground tabular-nums">{it.sku}</p>}
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-md bg-muted/60 px-1.5 py-1"><p className="text-muted-foreground">{t('sent_label')}</p><p className="font-semibold tabular-nums text-sm">{it.quantity_sent}</p></div>
                        {received != null && (<>
                          <div className="rounded-md bg-muted/60 px-1.5 py-1"><p className="text-muted-foreground">{t('received_label')}</p><p className="font-semibold tabular-nums text-sm">{received}</p></div>
                          <div className={cn('rounded-md px-1.5 py-1', gap > 0 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-muted/60')}>
                            <p className={gap > 0 ? '' : 'text-muted-foreground'}>{t('gap_label')}</p><p className="font-semibold tabular-nums text-sm">{gap}</p>
                          </div>
                        </>)}
                      </div>
                      {gap > 0 && it.discrepancy_category && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t(`discrepancy_${it.discrepancy_category}` as any)}{it.discrepancy_detail ? ` : ${it.discrepancy_detail}` : ''}</p>
                      )}
                      {(it.lots || []).length > 0 && (
                        <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                          {it.lots.map((l: any, i: number) => (
                            <li key={i} className="flex flex-wrap items-center gap-x-1.5">
                              <span className="font-medium text-foreground tabular-nums">{l.quantity_sent} {unitLabel(it.unit, l.quantity_sent)}</span>
                              <span>·</span>
                              {l.coverage === 'batch'
                                ? <span>{l.source_received_at ? t('lot_label', { date: dShort(l.source_received_at) }) : ''}{l.source_expiry_date ? ` · ${t('lot_expiry', { date: dShort(l.source_expiry_date) })}` : ` · ${t('lot_no_expiry')}`}</span>
                                : <span>{t('lot_untracked')}</span>}
                              {l.destination_batch && <span>· {t('dest_lot_label')} : {t('lot_label', { date: dShort(l.destination_batch.received_at) })}</span>}
                              {tr.can_view_cost && <span>· {l.unit_cost != null ? `${t('cost_label')} ${tr.source_currency ? formatCurrency(Number(l.unit_cost), tr.source_currency) : l.unit_cost}` : t('cost_unknown')}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" />{t('section_history')}</h3>
            <ol className="space-y-2" data-testid="detail-history">
              {(tr.history || []).map((h: any, i: number) => {
                const Icon = HISTORY_ICON[h.event] || Clock
                return (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', h.event === 'received_with_discrepancy' ? 'text-amber-600' : h.event === 'cancelled' ? 'text-red-500' : 'text-muted-foreground')} />
                    <div>
                      <p className="font-medium">{t(`history_${h.event}` as any)}</p>
                      <p className="text-xs text-muted-foreground">{dLong(h.at)} · {time(h.at)}{h.by ? ` · ${t('by_name', { name: h.by })}` : ''}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      )}
    </AppDrawer>
  )
}
