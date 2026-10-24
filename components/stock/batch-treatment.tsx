'use client'

// Traitement des lots (migration 179) — visible SEULEMENT quand la 179 est présente (réponse « available » du
// serveur) : avant elle, rien ne change à l'écran.
//   • « Traiter le lot périmé » : destruction, retour fournisseur (si le lot a un fournisseur), correction de
//     quantité ou de date — un événement immuable par traitement, photos facultatives ajoutées APRÈS ;
//   • « Historique du traitement » du lot ;
//   • ventes hors ligne non attribuées que CE lot peut expliquer : « Attribuer à ce lot » ne modifie PAS le
//     stock produit (unités déjà sorties à la vente), seulement la traçabilité du lot.
// Le serveur relit la boutique, le produit et le fournisseur depuis le lot et revérifie toutes les règles.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Camera, History, Link2, PackageCheck, X } from 'lucide-react'
import { FormDrawer } from '@/components/ui/form-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { compressImage } from '@/lib/utils/compress-image'
import { withTimeout } from '@/lib/utils/with-timeout'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { localDate } from '@/lib/stock/batch-status'
import { cn } from '@/lib/utils/cn'

export type TreatmentAction = 'dispose' | 'supplier_return' | 'quantity_adjustment' | 'date_correction'
export const ADJUST_REASONS = ['counting_error', 'damage', 'loss', 'theft', 'other'] as const

export interface TreatmentEvent {
  id: string
  action: TreatmentAction | 'unallocated_resolution'
  quantity: number | null
  lot_qty_before: number
  lot_qty_after: number
  old_expiry_date: string | null
  new_expiry_date: string | null
  supplier_name: string | null
  sale_number: string | null
  reason_code: string | null
  note: string | null
  corrects_treatment_id: string | null
  performed_by_name: string | null
  created_at: string
  photos: { id: string; url: string | null }[]
  can_add_photo: boolean
}
export interface UnallocatedCandidate { sale_id: string; sale_number: string | null; sale_at: string; unallocated: number }
export interface LotTreatments { available: boolean; can_write: boolean; has_supplier: boolean; treatments: TreatmentEvent[]; candidates: UnallocatedCandidate[] }

export const newRequestId = () => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return `bt-${crypto.randomUUID()}` } catch {}
  return `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// Présence de la 179, partagée par tous les écrans de la session (une seule lecture, revérifiée après 5 min)
let availability: { at: number; promise: Promise<boolean> } | null = null
function readAvailability(): Promise<boolean> {
  if (availability && Date.now() - availability.at < 5 * 60_000) return availability.promise
  const promise = withTimeout(fetch('/api/stock/batch-treatments/status'))
    .then(r => (r.ok ? r.json() : { available: false })).then(j => !!j.available).catch(() => false)
  availability = { at: Date.now(), promise }
  return promise
}

/** La migration 179 est-elle appliquée ? false tant que la réponse n'est pas connue (ancien comportement) */
export function useBatchTreatmentsAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => { let alive = true; readAvailability().then(v => { if (alive) setAvailable(v) }); return () => { alive = false } }, [])
  return available
}

/** Historique + ventes résolubles d'un lot (rien tant que la 179 n'est pas appliquée) */
export function useLotTreatments(lotId: string | null | undefined) {
  const [data, setData] = useState<LotTreatments | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    if (!lotId) { setData(null); return }
    setLoading(true)
    try {
      const res = await withTimeout(fetch(`/api/stock/batch-treatments?batch_id=${encodeURIComponent(lotId)}`))
      setData(res.ok ? await res.json() : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [lotId])
  useEffect(() => { load() }, [load])
  return { data, loading, reload: load }
}

async function postJson(url: string, body: unknown) {
  const res = await withTimeout(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

/** Envoi d'une photo (après le traitement) ; jamais d'annulation du traitement en cas d'échec */
async function uploadPhoto(treatmentId: string, file: File): Promise<{ ok: boolean; error?: string; orphan?: boolean }> {
  try {
    const compressed = await compressImage(file).catch(() => file)
    const form = new FormData()
    form.append('treatment_id', treatmentId)
    form.append('file', compressed)
    const res = await withTimeout(fetch('/api/stock/batch-treatments/photo', { method: 'POST', body: form }), 60_000)
    const json = await res.json().catch(() => ({}))
    return res.ok ? { ok: true } : { ok: false, error: json.error, orphan: !!json.orphan }
  } catch (e: any) { return { ok: false, error: e?.message } }
}

export interface TreatmentLot {
  id: string
  quantity: number
  expiry_date: string | null
  received_at: string
  productName: string
  unit: string
  shopName?: string | null
  supplierName?: string | null
}

// ── Panneau « Traiter le lot » ───────────────────────────────────────────────────────────────────────────────
export function BatchTreatmentDrawer({ lot, open, expired, onClose, onSaved }: {
  lot: TreatmentLot | null
  open: boolean
  /** Lot périmé : destruction et retour proposés ; sinon seulement les corrections */
  expired: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('batch_treatment')
  const tp = useTranslations('products')
  const locale = useLocale()
  const { toast } = useToast()
  // Fournisseur du lot relu par le serveur : « Retour fournisseur » masqué s'il est inconnu
  const { data: info } = useLotTreatments(open ? lot?.id : null)
  const hasSupplier = !!info?.has_supplier
  const actions: TreatmentAction[] = expired
    ? ['dispose', ...(hasSupplier ? ['supplier_return' as const] : []), 'quantity_adjustment', 'date_correction']
    : ['quantity_adjustment', 'date_correction']
  const [action, setAction] = useState<TreatmentAction>(actions[0])
  const [quantity, setQuantity] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [reason, setReason] = useState<typeof ADJUST_REASONS[number]>('counting_error')
  const [date, setDate] = useState('')
  const [noDate, setNoDate] = useState(false)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoFailure, setPhotoFailure] = useState<{ treatmentId: string; files: File[]; orphan: boolean } | null>(null)
  const requestId = useRef(newRequestId())
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !lot) return
    setAction(actions[0]); setQuantity(String(lot.quantity)); setNewQuantity(String(lot.quantity)); setReason('counting_error')
    setDate(lot.expiry_date ? lot.expiry_date.slice(0, 10) : ''); setNoDate(false); setNote(''); setPhotos([]); setError(null)
    requestId.current = newRequestId()
  }, [open, lot?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lot) return null
  const noteRequired = action === 'date_correction' || (action === 'quantity_adjustment' && reason === 'other')
  const qty = Number(quantity), nq = Number(newQuantity)
  const newDate = noDate ? null : (date || null)
  const valid =
    (action === 'dispose' || action === 'supplier_return') ? Number.isInteger(qty) && qty >= 1 && qty <= lot.quantity
    : action === 'quantity_adjustment' ? newQuantity !== '' && Number.isInteger(nq) && nq >= 0 && nq !== lot.quantity
    : (newDate ?? null) !== (lot.expiry_date ? lot.expiry_date.slice(0, 10) : null)
  const canSubmit = valid && (!noteRequired || note.trim().length > 0)

  const finish = () => { toast({ title: t('saved_toast'), variant: 'success' }); setPhotoFailure(null); onClose(); onSaved() }

  const sendPhotos = async (treatmentId: string, files: File[]) => {
    const failed: File[] = []; let orphan = false
    for (const f of files) { const r = await uploadPhoto(treatmentId, f); if (!r.ok) { failed.push(f); orphan = orphan || !!r.orphan } }
    if (failed.length) { setPhotoFailure({ treatmentId, files: failed, orphan }); return false }
    return true
  }

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      const r = await postJson('/api/stock/batch-treatments', {
        batch_id: lot.id, action, request_id: requestId.current,
        quantity: action === 'dispose' || action === 'supplier_return' ? qty : undefined,
        new_quantity: action === 'quantity_adjustment' ? nq : undefined,
        new_expiry_date: action === 'date_correction' ? newDate : undefined,
        reason_code: action === 'quantity_adjustment' ? reason : undefined,
        note: note.trim() || null,
      })
      if (!r.ok) { setError(r.json.error || t('error_generic')); return }
      const treatmentId = r.json.data?.treatment_id
      if (photos.length && treatmentId && !(await sendPhotos(treatmentId, photos))) return
      finish()
    } catch (e: any) {
      setError(e?.message || t('error_generic'))
    } finally { setSaving(false) }
  }

  const unit = lot.unit
  return (
    <>
      <FormDrawer
        open={open && !photoFailure} onOpenChange={o => { if (!o) onClose() }}
        category={t('category')} title={expired ? t('title') : t('title_correct')} icon={<PackageCheck className="h-4 w-4" />}
        width="md" testId="batch-treatment-drawer" dirty={note.trim().length > 0 || photos.length > 0}
        onSubmit={submit} submitting={saving} submitLabel={t('submit')} submitDisabled={!canSubmit} error={error}
      >
        <div className="space-y-4">
          <dl className="divide-y rounded-lg border text-sm" data-testid="batch-treatment-facts">
            {[
              [t('field_product'), lot.productName],
              [t('field_lot'), t('lot_of', { date: formatLocaleDate(new Date(lot.received_at), locale, { day: 'numeric', month: 'short', year: 'numeric' }) })],
              ...(lot.shopName ? [[t('field_shop'), lot.shopName]] : []),
              [t('field_expiry'), lot.expiry_date ? formatLocaleDate(localDate(lot.expiry_date), locale, { day: 'numeric', month: 'long', year: 'numeric' }) : t('no_date')],
              [t('field_remaining'), `${lot.quantity} ${unit}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>

          <fieldset className="space-y-2" data-testid="batch-treatment-actions">
            <legend className="mb-1 text-sm font-medium">{t('action_label')}</legend>
            {actions.map(a => (
              <label key={a} className={cn('flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', action === a ? 'border-stockshop-blue bg-stockshop-blue-muted dark:border-blue-500 dark:bg-blue-950/40' : 'hover:bg-muted/50')}>
                <input type="radio" name="batch-treatment-action" value={a} checked={action === a} onChange={() => { setAction(a); setError(null) }} className="mt-0.5 h-4 w-4" data-testid={`batch-treatment-action-${a}`} />
                <span>
                  <span className="block font-medium">{t(`action_${a}`)}</span>
                  <span className="block text-xs text-muted-foreground">{a === 'supplier_return' ? t('action_supplier_return_hint', { supplier: lot.supplierName || t('supplier_of_lot') }) : t(`action_${a}_hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {(action === 'dispose' || action === 'supplier_return') && (
            <div className="space-y-1.5">
              <Label htmlFor="batch-treatment-qty">{t('quantity_label')}</Label>
              <Input id="batch-treatment-qty" type="number" inputMode="numeric" min={1} max={lot.quantity} value={quantity} onChange={e => setQuantity(e.target.value)} className="h-11" />
              <p className="text-xs text-muted-foreground">{t('quantity_hint', { max: lot.quantity })}</p>
            </div>
          )}
          {action === 'quantity_adjustment' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batch-treatment-new-qty">{t('new_quantity_label')}</Label>
                <Input id="batch-treatment-new-qty" type="number" inputMode="numeric" min={0} value={newQuantity} onChange={e => setNewQuantity(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-treatment-reason">{t('reason_label')}</Label>
                <select id="batch-treatment-reason" value={reason} onChange={e => setReason(e.target.value as any)} className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {ADJUST_REASONS.map(code => <option key={code} value={code}>{tp(code as any)}</option>)}
                </select>
              </div>
            </div>
          )}
          {action === 'date_correction' && (
            <div className="space-y-2">
              <Label htmlFor="batch-treatment-date">{t('new_date_label')}</Label>
              <Input id="batch-treatment-date" type="date" value={date} disabled={noDate} onChange={e => setDate(e.target.value)} className="h-11" />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={noDate} onChange={e => setNoDate(e.target.checked)} className="h-4 w-4" data-testid="batch-treatment-no-date" />{t('no_date')}
              </label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="batch-treatment-note">{noteRequired ? t('note_required') : t('note_label')}</Label>
            <Textarea id="batch-treatment-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3} placeholder={t('note_placeholder')} />
          </div>

          {action !== 'date_correction' && (
            <div className="space-y-2" data-testid="batch-treatment-photos">
              <p className="text-sm font-medium">{t('photos_label')}</p>
              <div className="flex flex-wrap gap-2">
                {photos.map((f, i) => (
                  <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center" aria-label={t('photo_remove')}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
              {photos.length < 3 && (
                <>
                  <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setPhotos(p => [...p, f].slice(0, 3)); e.target.value = '' }} />
                  <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => fileInput.current?.click()}><Camera className="h-4 w-4" />{t('photos_add')}</Button>
                </>
              )}
            </div>
          )}
        </div>
      </FormDrawer>

      {/* Traitement enregistré, photo non envoyée : jamais présenté comme un échec de l'opération */}
      <ConfirmModal
        open={!!photoFailure} onOpenChange={o => { if (!o) finish() }}
        title={t('photo_failed_title')} description={photoFailure?.orphan ? t('photo_orphan') : undefined}
        icon={<Camera className="h-4 w-4" />} confirmLabel={t('photo_retry')} cancelLabel={t('photo_continue')} loading={saving}
        onConfirm={async () => {
          if (!photoFailure) return
          setSaving(true)
          try { if (await sendPhotos(photoFailure.treatmentId, photoFailure.files)) finish() } finally { setSaving(false) }
        }}
      />
    </>
  )
}

// ── Historique ───────────────────────────────────────────────────────────────────────────────────────────────
export function BatchTreatmentHistory({ events, unit }: { events: TreatmentEvent[]; unit: (n: number) => string }) {
  const t = useTranslations('batch_treatment')
  const tp = useTranslations('products')
  const locale = useLocale()
  const day = (d: string | null) => d ? formatLocaleDate(localDate(d), locale, { day: 'numeric', month: 'short', year: 'numeric' }) : t('no_date')
  if (!events.length) return <p className="text-sm text-muted-foreground" data-testid="batch-treatment-history-empty">{t('history_empty')}</p>
  return (
    <ol className="space-y-2" data-testid="batch-treatment-history">
      {events.map(e => (
        <li key={e.id} className="rounded-lg border px-3 py-2.5 text-sm" data-testid="batch-treatment-event" data-action={e.action}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="font-semibold">{t(`kind_${e.action}`)}</span>
            <span className="text-xs text-muted-foreground">{formatLocaleDate(new Date(e.created_at), locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {e.action === 'date_correction'
              ? t('history_date_change', { from: day(e.old_expiry_date), to: day(e.new_expiry_date) })
              : <>{e.quantity != null && <span className="tabular-nums">{e.quantity > 0 && e.action === 'quantity_adjustment' ? '+' : ''}{e.quantity} {unit(Math.abs(e.quantity))}</span>}{' · '}{t('history_remaining', { count: e.lot_qty_after })}</>}
          </p>
          {e.reason_code && <p className="text-muted-foreground">{tp(e.reason_code as any)}</p>}
          {e.supplier_name && <p className="text-muted-foreground">{t('history_supplier', { name: e.supplier_name })}</p>}
          {e.sale_number && <p className="text-muted-foreground">{t('history_sale', { number: e.sale_number })}</p>}
          {e.corrects_treatment_id && <p className="text-xs text-muted-foreground">{t('history_correction')}</p>}
          {e.note && <p className="mt-1 whitespace-pre-wrap break-words">{e.note}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{t('history_by', { name: e.performed_by_name || t('history_unknown_user') })}</p>
          {e.photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {e.photos.map(p => p.url && (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block h-16 w-16 overflow-hidden rounded-md border" aria-label={t('photo_open')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

// ── Lots épuisés / traités d'un produit (fiche produit) ──────────────────────────────────────────────────────
// Un lot à 0 n'est jamais supprimé s'il a un historique : il disparaît des listes de travail mais reste
// retrouvable ici, avec son historique de traitement (quand la 179 est présente).
function ExhaustedLotHistory({ lotId, unit }: { lotId: string; unit: (n: number) => string }) {
  const { data, loading } = useLotTreatments(lotId)
  if (loading && !data) return <p className="text-xs text-muted-foreground">…</p>
  return data?.available ? <BatchTreatmentHistory events={data.treatments} unit={unit} /> : null
}

export function ExhaustedLots({ productId, unit }: { productId: string; unit: (n: number) => string }) {
  const t = useTranslations('batch_treatment')
  const locale = useLocale()
  const available = useBatchTreatmentsAvailable()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [lots, setLots] = useState<any[] | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setOpen(false); setLots(null); setShown(null)
    import('@/lib/supabase/client').then(({ createClient }) => createClient()
      .from('product_batches').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('quantity', 0))
      .then(({ count: n }: any) => { if (alive) setCount(n ?? 0) }).catch(() => {})
    return () => { alive = false }
  }, [productId])
  useEffect(() => {
    if (!open || lots) return
    import('@/lib/supabase/client').then(({ createClient }) => createClient()
      .from('product_batches').select('id, initial_quantity, expiry_date, received_at, source').eq('product_id', productId).eq('quantity', 0)
      .order('received_at', { ascending: false }).limit(50))
      .then(({ data }: any) => setLots(data || [])).catch(() => setLots([]))
  }, [open, lots, productId])
  if (!count) return null
  const day = (d: string) => formatLocaleDate(new Date(d), locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="pt-1" data-testid="exhausted-lots">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1 text-sm font-medium text-muted-foreground hover:text-foreground" aria-expanded={open} data-testid="exhausted-lots-toggle">
        <span className="flex items-center gap-2"><History className="h-4 w-4" />{open ? t('zero_lots_hide') : t('zero_lots_toggle', { count })}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-2">
          {(lots || []).map(l => (
            <li key={l.id} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="exhausted-lot">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{t('lot_of', { date: day(l.received_at) })}</span>
                <span className="text-xs text-muted-foreground">{t('zero_lot_meta', { initial: l.initial_quantity, unit: unit(l.initial_quantity) })}{l.expiry_date ? ` · ${formatLocaleDate(localDate(l.expiry_date), locale, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span>
              </div>
              {available && (
                shown === l.id
                  ? <div className="mt-2"><ExhaustedLotHistory lotId={l.id} unit={unit} /></div>
                  : <button type="button" onClick={() => setShown(l.id)} className="mt-1 min-h-10 text-xs font-medium text-stockshop-blue underline underline-offset-2 dark:text-blue-400">{t('history_show')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Ventes hors ligne à attribuer à CE lot ───────────────────────────────────────────────────────────────────
export function UnallocatedBanner({ lotId, lotQuantity, candidates, onResolved }: {
  lotId: string; lotQuantity: number; candidates: UnallocatedCandidate[]; onResolved: () => void
}) {
  const t = useTranslations('batch_treatment')
  const locale = useLocale()
  const { toast } = useToast()
  const [target, setTarget] = useState<UnallocatedCandidate | null>(null)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const requestId = useRef(newRequestId())
  if (!candidates.length) return null

  const open = (c: UnallocatedCandidate) => { setTarget(c); setQuantity(String(Math.min(c.unallocated, lotQuantity))); setNote(''); requestId.current = newRequestId() }
  const n = Number(quantity)
  const valid = !!target && Number.isInteger(n) && n >= 1 && n <= Math.min(target.unallocated, lotQuantity) && note.trim().length > 0

  const resolve = async () => {
    if (!target || !valid) return
    setSaving(true)
    try {
      const r = await postJson('/api/stock/batch-treatments/resolve', { batch_id: lotId, sale_id: target.sale_id, quantity: n, note: note.trim(), request_id: requestId.current })
      if (!r.ok) { toast({ title: r.json.error || t('error_generic'), variant: 'destructive' }); return }
      toast({ title: t('resolved_toast'), variant: 'success' })
      setTarget(null); onResolved()
    } catch (e: any) {
      toast({ title: e?.message || t('error_generic'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="lot-unallocated-banner">
      <p className="font-semibold">{t('unallocated_title')}</p>
      <p className="text-xs">{t('unallocated_desc')}</p>
      <ul className="mt-2 space-y-1.5">
        {candidates.map(c => (
          <li key={c.sale_id} className="flex flex-wrap items-center justify-between gap-2" data-testid="lot-unallocated-sale">
            <span>
              <span className="font-medium">{t('unallocated_sale', { number: c.sale_number || '—' })}</span>
              <span className="text-xs"> · {formatLocaleDate(new Date(c.sale_at), locale, { day: 'numeric', month: 'short', year: 'numeric' })} · {t('unallocated_row', { count: c.unallocated })}</span>
            </span>
            <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => open(c)}><Link2 className="h-4 w-4" />{t('unallocated_action')}</Button>
          </li>
        ))}
      </ul>

      <ConfirmModal
        open={!!target} onOpenChange={o => { if (!o) setTarget(null) }}
        title={t('resolve_title')} icon={<History className="h-4 w-4" />}
        description={t('resolve_confirm', { count: Number.isInteger(n) && n > 0 ? n : 0 })}
        confirmLabel={t('unallocated_action')} loading={saving} disabled={!valid} onConfirm={resolve}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="resolve-qty">{t('resolve_quantity')}</Label>
            <Input id="resolve-qty" type="number" inputMode="numeric" min={1} max={target ? Math.min(target.unallocated, lotQuantity) : undefined} value={quantity} onChange={e => setQuantity(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resolve-note">{t('note_required')}</Label>
            <Textarea id="resolve-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} placeholder={t('resolve_note_placeholder')} />
          </div>
        </div>
      </ConfirmModal>
    </div>
  )
}
