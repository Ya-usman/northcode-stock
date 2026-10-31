'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, Edit2, PackageMinus, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { dayOf, localDate } from '@/lib/stock/batch-status'
import { withTimeout } from '@/lib/utils/with-timeout'
import { ExpiryDateField, usePastExpiryConfirm } from '@/components/stock/expiry-date-field'
import { Textarea } from '@/components/ui/textarea'
import { newRequestId, useBatchTreatmentsAvailable } from '@/components/stock/batch-treatment'

// Fenêtres d'action sur UN lot : corriger la quantité, modifier la date de
// péremption, mettre en promo, retirer du stock. Elles appellent les routes
// existantes (/api/product-batches…), qui contrôlent le droit « Stock en
// modification », gardent leurs confirmations et écrivent leur trace
// (mouvement de stock ou journal). La boutique envoyée est toujours CELLE DU
// LOT — jamais la boutique active, qui peut être une autre en « Toutes les
// boutiques ».

export interface BatchTarget {
  id: string
  shop_id: string
  quantity: number
  expiry_date: string | null
  promo_price?: number | null
  promo_until?: string | null
  promo_start?: string | null
}

// Motifs d'une correction de quantité. Migration 179 présente : motifs de l'historique des lots (« Erreur de
// comptage » remplace « Correction », plus de motif « Expiration » — un lot périmé se TRAITE) ; avant elle,
// motifs d'origine (le serveur fait la correspondance dans les deux sens).
export const BATCH_REASON_CODES = ['correction', 'damage', 'loss', 'theft', 'expiry', 'other'] as const
export const TREATMENT_REASON_CODES = ['counting_error', 'damage', 'loss', 'theft', 'other'] as const
type ReasonCode = typeof BATCH_REASON_CODES[number] | typeof TREATMENT_REASON_CODES[number]

type DialogProps<T = BatchTarget> = {
  batch: T | null
  onClose: () => void
  /** Appelé après un enregistrement réussi : la liste se recharge */
  onSaved: () => void
}

async function call(url: string, method: 'PATCH' | 'DELETE', body: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await withTimeout(fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, error: json?.error }
}

function ReasonSelect({ value, onChange, id, treatments }: { value: ReasonCode; onChange: (v: ReasonCode) => void; id: string; treatments: boolean }) {
  const t = useTranslations()
  const codes: readonly ReasonCode[] = treatments ? TREATMENT_REASON_CODES : BATCH_REASON_CODES
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('products.adjustment_reason')}</Label>
      <select
        id={id} value={value} onChange={e => onChange(e.target.value as ReasonCode)}
        className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-9"
      >
        {codes.map(code => <option key={code} value={code}>{t(`products.${code}` as any)}</option>)}
      </select>
    </div>
  )
}

/** Note d'une correction (179) : obligatoire pour une date, ou pour un motif « Autre » */
function NoteField({ id, value, onChange, required }: { id: string; value: string; onChange: (v: string) => void; required: boolean }) {
  const t = useTranslations('batch_treatment')
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{required ? t('note_required') : t('note_label')}</Label>
      <Textarea id={id} value={value} onChange={e => onChange(e.target.value)} rows={2} maxLength={1000} placeholder={t('note_placeholder')} />
    </div>
  )
}

const defaultReason = (treatments: boolean): ReasonCode => (treatments ? 'counting_error' : 'correction')

// ── Corriger la quantité ─────────────────────────────────────────────────────
export function BatchAdjustDialog({ batch, onClose, onSaved }: DialogProps) {
  const t = useTranslations()
  const { toast } = useToast()
  const treatments = useBatchTreatmentsAvailable()
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<ReasonCode>('correction')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const requestId = useRef(newRequestId())
  useEffect(() => { if (batch) { setQuantity(String(batch.quantity)); setReason(defaultReason(treatments)); setNote(''); requestId.current = newRequestId() } }, [batch?.id, treatments]) // eslint-disable-line react-hooks/exhaustive-deps
  const noteRequired = treatments && reason === 'other'

  const submit = async () => {
    if (!batch || quantity === '' || (noteRequired && !note.trim())) return
    setSaving(true)
    try {
      const r = await call('/api/product-batches/adjust', 'PATCH', { id: batch.id, shop_id: batch.shop_id, new_quantity: Number(quantity), reason_code: reason, note: note.trim() || null, request_id: requestId.current })
      if (!r.ok) { toast({ title: r.error || t('errors.generic'), variant: 'destructive' }); return }
      toast({ title: t('products.batch_quantity_adjusted_toast'), variant: 'success' })
      onClose(); onSaved()
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <PremiumDialog open={!!batch} onOpenChange={open => { if (!open) onClose() }} title={t('products.adjust_quantity_action')} icon={<Edit2 className="h-4 w-4" />}
      dirty={!!batch && !saving && (quantity !== String(batch.quantity) || !!note.trim())}>
      {batch && (
        <>
          <PremiumDialogBody>
            <div className="space-y-3" data-testid="batch-adjust-dialog">
              <div className="space-y-1.5">
                <Label htmlFor="batch-adjust-qty">{t('products.new_quantity_label')}</Label>
                <Input id="batch-adjust-qty" type="number" inputMode="numeric" min={0} value={quantity} onChange={e => setQuantity(e.target.value)} className="h-11 sm:h-9" />
              </div>
              <ReasonSelect id="batch-adjust-reason" value={reason} onChange={setReason} treatments={treatments} />
              {treatments && <NoteField id="batch-adjust-note" value={note} onChange={setNote} required={noteRequired} />}
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={onClose} cancelLabel={t('actions.cancel')}>
            <Button variant="stockshop" className="h-11 flex-1 rounded-lg font-semibold" onClick={submit} loading={saving} disabled={quantity === '' || (noteRequired && !note.trim())}>
              {t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </>
      )}
    </PremiumDialog>
  )
}

// ── Modifier la date de péremption ──────────────────────────────────────────
export function BatchExpiryDialog({ batch, onClose, onSaved }: DialogProps) {
  const t = useTranslations()
  const { toast } = useToast()
  const treatments = useBatchTreatmentsAvailable()
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const requestId = useRef(newRequestId())
  const pastExpiry = usePastExpiryConfirm()
  useEffect(() => { if (batch) { setDate(batch.expiry_date ? dayOf(batch.expiry_date) : ''); setNote(''); requestId.current = newRequestId() } }, [batch?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // 179 : toute date enregistrée qui change garde sa raison
  const noteMissing = treatments && !note.trim()

  const save = async (value: string | null) => {
    if (!batch || noteMissing) return
    // Date déjà passée : avertissement et confirmation, jamais interdite
    if (value && !(await pastExpiry.confirm([value]))) return
    setSaving(true)
    try {
      const r = await call('/api/product-batches/expiry', 'PATCH', { id: batch.id, shop_id: batch.shop_id, expiry_date: value, note: note.trim() || null, request_id: requestId.current })
      if (!r.ok) { toast({ title: r.error || t('errors.generic'), variant: 'destructive' }); return }
      toast({ title: t('products.expiry_saved'), variant: 'success' })
      onClose(); onSaved()
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <PremiumDialog open={!!batch} onOpenChange={open => { if (!open) onClose() }} title={t('products.edit_expiry_action')} icon={<CalendarClock className="h-4 w-4" />}
      dirty={!!batch && !saving && (date !== (batch.expiry_date ? dayOf(batch.expiry_date) : '') || !!note.trim())}>
      {batch && (
        <>
          <PremiumDialogBody>
            <div className="space-y-3" data-testid="batch-expiry-dialog">
              <ExpiryDateField id="batch-expiry-date" value={date} onChange={setDate} />
              {treatments && <NoteField id="batch-expiry-note" value={note} onChange={setNote} required />}
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={onClose} cancelLabel={t('actions.cancel')}>
            {batch.expiry_date && (
              <Button variant="outline" className="h-11 rounded-lg font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300" onClick={() => save(null)} loading={saving} disabled={noteMissing}>
                {t('products.clear_expiry_action')}
              </Button>
            )}
            <Button variant="stockshop" className="h-11 flex-1 rounded-lg font-semibold" onClick={() => save(date)} loading={saving} disabled={!date || noteMissing}>
              {t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </>
      )}
      {pastExpiry.dialog}
    </PremiumDialog>
  )
}

// ── Mettre le lot en promo ───────────────────────────────────────────────────
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export interface BatchPromoTarget extends BatchTarget {
  productName: string
  sellingPrice: number
  /** Coût du lot, seulement s'il a été fourni par le serveur à qui a le droit de le voir */
  cost?: number | null
}

export function BatchPromoDialog({ batch, onClose, onSaved, formatPrice }: DialogProps<BatchPromoTarget> & { formatPrice: (n: number) => string }) {
  const t = useTranslations()
  const locale = useLocale()
  const { toast } = useToast()
  const [price, setPrice] = useState('')
  const [until, setUntil] = useState('')
  const [start, setStart] = useState('')
  const [mode, setMode] = useState<'price' | 'percent'>('price')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!batch) return
    setPrice(batch.promo_price ? String(batch.promo_price) : '')
    setUntil(batch.promo_until ? localDay(batch.promo_until) : '')
    setStart(batch.promo_start ? localDay(batch.promo_start) : '')
    setMode('price')
  }, [batch?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: { promo_price: number | null; promo_until: string | null; promo_start: string | null }, saved: boolean) => {
    if (!batch) return
    setSaving(true)
    try {
      const r = await call('/api/product-batches/promo', 'PATCH', { id: batch.id, shop_id: batch.shop_id, ...body })
      if (!r.ok) { toast({ title: r.error || t('toast.error'), variant: 'destructive' }); return }
      if (saved) toast({ title: t('products.promo_saved'), variant: 'success' })
      onClose(); onSaved()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally { setSaving(false) }
  }
  const submit = () => {
    const n = Number(price)
    if (!n || n <= 0 || !until) { toast({ title: t('products.promo_invalid'), variant: 'destructive' }); return }
    send({ promo_price: n, promo_until: new Date(`${until}T23:59:59`).toISOString(), promo_start: start ? new Date(`${start}T00:00:00`).toISOString() : null }, true)
  }

  const selling = batch?.sellingPrice || 0
  const priceNum = Number(price) || 0
  const percentOff = priceNum > 0 && selling > 0 ? Math.round((1 - priceNum / selling) * 100) : null
  const cost = Number(batch?.cost) || 0
  const belowCost = priceNum > 0 && cost > 0 && priceNum < cost

  return (
    <PremiumDialog
      open={!!batch} onOpenChange={open => { if (!open) onClose() }}
      dirty={!!batch && !saving && (price !== (batch.promo_price ? String(batch.promo_price) : '') || until !== (batch.promo_until ? localDay(batch.promo_until) : '') || start !== (batch.promo_start ? localDay(batch.promo_start) : ''))}
      category={t('products.promo_batch_category')} title={batch?.productName || ''} icon={<Tag className="h-4 w-4" />}
    >
      {batch && (
        <>
          <PremiumDialogBody>
            <div className="space-y-3" data-testid="batch-promo-dialog">
              <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t('products.promo_batch_hint', {
                  quantity: batch.quantity,
                  date: batch.expiry_date ? formatLocaleDate(localDate(batch.expiry_date), locale, { day: 'numeric', month: 'short' }) : t('products.no_expiry_date'),
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t('products.promo_hint', { price: formatPrice(selling) })}</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="batch-promo-price">{mode === 'percent' ? t('products.promo_percent_label') : t('products.promo_price_label')} *</Label>
                  <div className="flex gap-0.5 rounded-md border bg-muted/30 p-0.5">
                    {(['price', 'percent'] as const).map(m => (
                      <button
                        key={m} type="button" onClick={() => setMode(m)}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                      >
                        {m === 'price' ? t('products.promo_mode_price') : '%'}
                      </button>
                    ))}
                  </div>
                </div>
                {mode === 'percent' ? (
                  <Input
                    id="batch-promo-price" type="number" inputMode="numeric" min={1} max={99} placeholder="20"
                    value={price && selling > 0 ? String(Math.round((1 - Number(price) / selling) * 100)) : ''}
                    onChange={e => {
                      if (!e.target.value) { setPrice(''); return }
                      setPrice(String(Math.max(1, Math.round(selling * (1 - Number(e.target.value) / 100)))))
                    }}
                  />
                ) : (
                  <Input id="batch-promo-price" type="number" inputMode="decimal" min={0} max={selling - 1} value={price} onChange={e => setPrice(e.target.value)} placeholder={String(selling)} />
                )}
                {priceNum > 0 && <p className="text-xs text-muted-foreground">{t('products.promo_derived_hint', { percent: percentOff ?? 0, price: formatPrice(priceNum) })}</p>}
                {belowCost && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                    {t('products.promo_below_cost_warning', { cost: formatPrice(cost) })}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-promo-start">{t('products.promo_start_label')}</Label>
                <Input id="batch-promo-start" type="date" value={start} onChange={e => setStart(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">{t('products.promo_start_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-promo-until">{t('products.promo_until_label')} *</Label>
                <Input id="batch-promo-until" type="date" value={until} onChange={e => setUntil(e.target.value)} />
              </div>
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={onClose} cancelLabel={t('actions.cancel')}>
            {batch.promo_price ? (
              <Button
                variant="outline" className="h-11 flex-1 rounded-lg border-destructive/30 font-semibold text-destructive hover:bg-red-50 dark:hover:bg-red-950/40"
                onClick={() => send({ promo_price: null, promo_until: null, promo_start: null }, false)} loading={saving}
              >
                {t('products.promo_remove')}
              </Button>
            ) : null}
            <Button variant="stockshop" className="h-11 flex-1 rounded-lg font-semibold" onClick={submit} loading={saving}>{t('actions.save')}</Button>
          </PremiumDialogFooter>
        </>
      )}
    </PremiumDialog>
  )
}

// ── Retirer du stock ─────────────────────────────────────────────────────────
// Deux routes existantes, aucune règle nouvelle : un lot jamais vendu est
// supprimé (mouvement « Suppression de lot ») ; un lot déjà entamé ne peut pas
// l'être — la base le refuse —, sa quantité est alors ramenée à zéro
// (mouvement « Correction de lot »). Dans les deux cas le stock du produit
// baisse d'autant et le motif est gardé.
export function BatchRemoveConfirm({ batch, onClose, onSaved, expired }: DialogProps & { expired?: boolean }) {
  const t = useTranslations()
  const { toast } = useToast()
  const treatments = useBatchTreatmentsAvailable()
  const [reason, setReason] = useState<ReasonCode>('correction')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const requestId = useRef(newRequestId())
  useEffect(() => { if (batch) { setReason(treatments ? 'counting_error' : expired ? 'expiry' : 'correction'); setNote(''); requestId.current = newRequestId() } }, [batch?.id, treatments]) // eslint-disable-line react-hooks/exhaustive-deps
  const noteRequired = treatments && reason === 'other'

  const submit = async () => {
    if (!batch || (noteRequired && !note.trim())) return
    setSaving(true)
    try {
      let r = await call('/api/product-batches', 'DELETE', { id: batch.id, shop_id: batch.shop_id, reason_code: reason })
      // 409 : lot déjà vendu en partie, ou avec un historique (179) → on retire ce qu'il en reste, par une
      // correction de quantité tracée (jamais une suppression)
      if (!r.ok && r.status === 409) r = await call('/api/product-batches/adjust', 'PATCH', { id: batch.id, shop_id: batch.shop_id, new_quantity: 0, reason_code: reason, note: note.trim() || null, request_id: requestId.current })
      if (!r.ok) { toast({ title: r.error || t('errors.generic'), variant: 'destructive' }); return }
      toast({ title: t('expiry.removed_toast'), variant: 'success' })
      onClose(); onSaved()
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <ConfirmModal
      open={!!batch} onOpenChange={open => { if (!open) onClose() }}
      title={t('expiry.action_remove')} description={t('expiry.remove_confirm')}
      icon={<PackageMinus className="h-4 w-4" />} tone="danger"
      confirmLabel={t('expiry.action_remove')} loading={saving} disabled={noteRequired && !note.trim()} onConfirm={submit}
    >
      {batch && (
        <div className="space-y-3">
          <ReasonSelect id="batch-remove-reason" value={reason} onChange={setReason} treatments={treatments} />
          {treatments && <NoteField id="batch-remove-note" value={note} onChange={setNote} required={noteRequired} />}
        </div>
      )}
    </ConfirmModal>
  )
}
