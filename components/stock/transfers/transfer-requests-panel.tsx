'use client'

// Encadré « Demandes » de Stock › Transferts (migration 190, conception du 30 oct. 2026) : demandes REÇUES à traiter
// (Accepter → panneau « Nouveau transfert » prérempli ; Refuser avec motif facultatif) et demandes ENVOYÉES avec leur
// état (Annuler tant qu'elle est en attente). Absent tant qu'il n'y a rien (ou avant la 190).

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, Inbox, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { cn } from '@/lib/utils/cn'
import { ShopMark } from '@/components/shops/shop-mark'
import { useShopLook } from '@/lib/shops/use-shop-look'

export interface TransferRequestRow {
  id: string
  requesting_shop_id: string
  source_shop_id: string
  source_product_id: string
  destination_product_id: string | null
  product_name: string
  unit: string | null
  quantity: number
  note: string | null
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  decline_reason: string | null
  transfer_id: string | null
  transfer_reference: string | null
  /** État réel du transfert créé en acceptant (brouillon, en route, reçu, annulé) */
  transfer_status: 'draft' | 'sent' | 'received' | 'cancelled' | null
  requesting_shop_name: string | null
  source_shop_name: string | null
  requested_by_name: string | null
  decided_by_name: string | null
  created_at: string
  decided_at: string | null
  can_decide: boolean
  can_cancel: boolean
}

const STATUS_CLS: Record<TransferRequestRow['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  accepted: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  declined: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
}

/** Acceptée, mais le transfert créé a été annulé ensuite : rien n'arrivera */
const transferCancelled = (r: TransferRequestRow) => r.status === 'accepted' && r.transfer_status === 'cancelled'

export function TransferRequestsPanel({ shopIds, refreshKey, onAccept }: {
  shopIds: string[]
  refreshKey: number
  onAccept: (req: TransferRequestRow) => void
}) {
  const t = useTranslations('transfer_requests')
  const look = useShopLook()
  const locale = useLocale()
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const [incoming, setIncoming] = useState<TransferRequestRow[]>([])
  const [outgoing, setOutgoing] = useState<TransferRequestRow[]>([])
  const [declining, setDeclining] = useState<TransferRequestRow | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const key = shopIds.join(',')

  const load = useCallback(async () => {
    if (!key) return
    try {
      const res = await fetch(`/api/stock-transfers/requests?shop_ids=${key}`)
      if (!res.ok) return
      const j = await res.json()
      setIncoming(j.available ? j.incoming || [] : [])
      setOutgoing(j.available ? j.outgoing || [] : [])
    } catch { /* l'encadré reste tel quel */ }
  }, [key])
  useEffect(() => { load() }, [load, refreshKey])

  const patch = async (req: TransferRequestRow, action: 'decline' | 'cancel', why?: string) => {
    setBusy(`${action}:${req.id}`)
    try {
      const res = await fetch(`/api/stock-transfers/requests/${req.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason: why || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); await load(); return }
      toast({ title: action === 'decline' ? t('declined_toast') : t('cancelled_toast'), variant: 'success' })
      setDeclining(null); setReason('')
      await load()
    } finally { setBusy(null) }
  }

  if (!incoming.length && !outgoing.length) return null
  const when = (iso: string) => `${formatLocaleDate(iso, locale, { day: '2-digit', month: '2-digit' })} · ${formatLocaleTime(iso, locale)}`
  const qtyText = (r: TransferRequestRow) => `${r.quantity}${r.unit ? ` ${unitLabel(r.unit, r.quantity)}` : ''}`

  return (
    <section className="space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4" data-testid="transfer-requests">
      {incoming.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><Inbox className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />{t('incoming_title', { count: incoming.length })}</p>
          {incoming.map(r => (
            <div key={r.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20" data-testid="transfer-request-in">
              <p className="text-sm"><ShopMark shop={look(r.requesting_shop_id, r.requesting_shop_name).shop} size="xs" className="mr-1.5 align-[-2px]" /><span className="font-semibold">{r.requesting_shop_name}</span> {t('asks')} <span className="font-semibold tabular-nums">{qtyText(r)}</span> · {r.product_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{[r.requested_by_name, when(r.created_at), r.source_shop_name && shopIds.length > 1 ? t('from_your_shop', { shop: r.source_shop_name }) : null].filter(Boolean).join(' · ')}</p>
              {r.note && <p className="mt-1 text-xs italic text-foreground/80">« {r.note} »</p>}
              {r.can_decide && (
                <div className="mt-2.5 flex gap-2">
                  <Button variant="outline" className="h-10 flex-1 gap-1.5" disabled={!!busy} onClick={() => { setDeclining(r); setReason('') }} data-testid="transfer-request-decline">
                    <X className="h-4 w-4" />{t('decline')}
                  </Button>
                  <Button variant="stockshop" className="h-10 flex-[2] gap-1.5" disabled={!!busy} onClick={() => onAccept(r)} data-testid="transfer-request-accept">
                    <Check className="h-4 w-4" />{t('accept')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className={cn('space-y-2', incoming.length > 0 && 'border-t pt-3')}>
          <p className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-muted-foreground" />{t('outgoing_title')}</p>
          {outgoing.map(r => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3" data-testid="transfer-request-out">
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-semibold tabular-nums">{qtyText(r)}</span> · {r.product_name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('asked_to', { shop: r.source_shop_name ?? '' })} · {when(r.created_at)}</p>
                {r.status === 'accepted' && r.transfer_reference && (
                  <p className={cn('mt-1 text-xs font-medium', transferCancelled(r) ? 'text-muted-foreground' : 'text-green-700 dark:text-green-400')} data-testid="transfer-request-transfer">
                    {r.transfer_status ? t(`transfer_state_${r.transfer_status}`, { reference: r.transfer_reference }) : t('accepted_ref', { reference: r.transfer_reference })}
                  </p>
                )}
                {r.status === 'declined' && r.decline_reason && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{r.decline_reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', transferCancelled(r) ? STATUS_CLS.cancelled : STATUS_CLS[r.status])} data-testid="transfer-request-status">
                  {transferCancelled(r) ? t('status_transfer_cancelled') : t(`status_${r.status}`)}
                </span>
                {r.can_cancel && (
                  <Button variant="ghost" className="h-9 px-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                    disabled={!!busy} onClick={() => patch(r, 'cancel')} data-testid="transfer-request-cancel">{t('cancel_request')}</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <PremiumDialog open={!!declining} onOpenChange={o => { if (!o && !busy) setDeclining(null) }} title={t('decline_title')}
        description={declining ? `${declining.requesting_shop_name} · ${qtyText(declining)} · ${declining.product_name}` : undefined}
        icon={<X className="h-4 w-4" />} maxWidth="max-w-md" dirty={!!reason.trim()} testId="transfer-request-decline-dialog">
        <PremiumDialogBody>
          <Input value={reason} onChange={e => setReason(e.target.value.slice(0, 500))} placeholder={t('decline_reason_placeholder')} className="h-11" autoFocus />
          <p className="text-xs text-muted-foreground">{t('decline_hint')}</p>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setDeclining(null)} onConfirm={() => declining && patch(declining, 'decline', reason.trim())}
          confirmTone="danger" confirmLabel={t('decline')} confirmLoading={!!declining && busy === `decline:${declining.id}`} />
      </PremiumDialog>
    </section>
  )
}
