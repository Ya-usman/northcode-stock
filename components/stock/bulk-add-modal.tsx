'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormDrawer } from '@/components/ui/form-drawer'
import { withTimeout } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'

// Ajout rapide de produits (lot 5 de l'harmonisation, 30 oct. 2026) : panneau de formulaire commun au lieu d'une
// fenêtre centrale. Ordinateur : une ligne par produit (saisie au clavier, Entrée = ligne suivante). Téléphone : une
// carte par produit (nom, puis prix / quantité / unité étiquetés). Fermer avec une saisie en cours demande confirmation.

interface Row {
  id: number
  name: string
  selling_price: string
  buying_price: string
  quantity: string
  unit: string
}

interface Props {
  open: boolean
  onClose: () => void
  shopId: string
  /** « Boutique : Akwa » — boutique qui reçoit les produits, rappelée au-dessus du titre (plusieurs boutiques) */
  shopLabel?: string
  currency: string
  fullRights: boolean
  onSaved: (count: number) => void
}

const UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box']

let nextId = 1
const newRow = (): Row => ({ id: nextId++, name: '', selling_price: '', buying_price: '', quantity: '0', unit: 'piece' })
const touched = (r: Row) => !!(r.name.trim() || r.selling_price || r.buying_price || (r.quantity && r.quantity !== '0'))

export function BulkAddModal({ open, onClose, shopId, shopLabel, currency, fullRights, onSaved }: Props) {
  const t = useTranslations('bulk_add')
  const tActions = useTranslations('actions')
  const unitLabel = useUnitLabel()
  const [rows, setRows] = useState<Row[]>([newRow()])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [savedCount, setSavedCount] = useState(0)
  const lastInputRef = useRef<HTMLInputElement>(null)

  const addRow = () => {
    setRows(r => [...r, newRow()])
    setTimeout(() => lastInputRef.current?.focus(), 50)
  }

  const removeRow = (id: number) => setRows(r => r.length > 1 ? r.filter(row => row.id !== id) : r)

  const update = (id: number, field: keyof Row, value: string) => {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value } : row))
    setErrors(e => { const n = { ...e }; delete n[id]; delete n[-1]; return n })
  }

  const handleSave = async () => {
    const errs: Record<number, string> = {}
    const valid = rows.filter(row => {
      if (!touched(row)) return false
      if (!row.name.trim()) { errs[row.id] = t('name_required'); return false }
      const price = parseFloat(row.selling_price)
      if (!row.selling_price || isNaN(price) || price <= 0) { errs[row.id] = t('price_required'); return false }
      return true
    })

    setErrors(errs)
    if (Object.keys(errs).length > 0 || valid.length === 0) return

    setSaving(true)
    try {
      const payload = valid.map(row => ({
        name: row.name.trim(),
        selling_price: parseFloat(row.selling_price),
        buying_price: parseFloat(row.buying_price) || 0,
        quantity: parseInt(row.quantity) || 0,
        unit: row.unit,
      }))

      const res = await withTimeout(fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload, shop_id: shopId }),
      }), 30_000)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSavedCount(json.inserted)
      onSaved(json.inserted)
    } catch (err: any) {
      setErrors({ [-1]: err.message })
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setRows([newRow()])
    setErrors({})
    setSavedCount(0)
  }

  const handleClose = () => { reset(); onClose() }

  const named = rows.filter(r => r.name.trim()).length
  const done = savedCount > 0
  // Ordinateur : colonnes du tableau ; téléphone : carte à 2 colonnes
  const desktopCols = fullRights ? 'sm:grid-cols-[minmax(0,1fr)_144px_112px_80px_128px_40px]' : 'sm:grid-cols-[minmax(0,1fr)_144px_80px_128px_40px]'
  const fieldLabel = 'mb-1 block text-xs font-medium text-muted-foreground sm:hidden'

  return (
    <FormDrawer
      open={open}
      onOpenChange={v => { if (!v) handleClose() }}
      category={shopLabel}
      title={t('title')}
      icon={<Plus className="h-4 w-4" />}
      width="xl"
      testId="bulk-add-drawer"
      dirty={!done && rows.some(touched)}
      onSubmit={done ? reset : handleSave}
      submitting={saving}
      submitLabel={done ? t('add_more') : t('save_button', { count: named })}
      submittingLabel={t('saving')}
      submitDisabled={!done && named === 0}
      submitIcon={done ? <Plus className="h-4 w-4" /> : undefined}
      cancelLabel={done ? tActions('close') : undefined}
      error={errors[-1] || null}
    >
      {done ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" data-testid="bulk-add-done">
          <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
          <p className="text-lg font-semibold">{t('added_count', { count: savedCount })}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* En-têtes de colonnes : ordinateur seulement */}
          <div className={cn('hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid', desktopCols)}>
            <span>{t('col_name')}</span>
            <span>{t('col_selling_price_cur', { currency })}</span>
            {fullRights && <span>{t('col_buying_price')}</span>}
            <span>{t('col_qty')}</span>
            <span>{t('col_unit')}</span>
            <span />
          </div>

          {rows.map((row, idx) => (
            <div key={row.id} data-testid="bulk-add-row"
              className={cn('grid grid-cols-2 gap-2 rounded-xl border bg-card p-3 sm:items-start sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0', desktopCols)}>
              {/* Nom + retirer : une rangée sur téléphone, deux colonnes du tableau sur ordinateur */}
              <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
                <div className="min-w-0 flex-1">
                  <Input
                    ref={idx === rows.length - 1 ? lastInputRef : undefined}
                    value={row.name}
                    onChange={e => update(row.id, 'name', e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
                    placeholder={t('row_placeholder', { index: idx + 1 })}
                    aria-label={t('col_name')}
                    className={cn('h-11 text-base sm:h-10 sm:text-sm', errors[row.id] && 'border-red-400')}
                    data-testid="bulk-add-name"
                  />
                  {errors[row.id] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[row.id]}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length === 1}
                  aria-label={t('remove_row', { index: idx + 1 })}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40 sm:hidden"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div>
                <label className={fieldLabel}>{t('col_selling_price_cur', { currency })}</label>
                <Input type="number" inputMode="decimal" min="0" value={row.selling_price}
                  onChange={e => update(row.id, 'selling_price', e.target.value)}
                  placeholder="0" aria-label={t('col_selling_price')} className="h-11 text-base sm:h-10 sm:text-sm" data-testid="bulk-add-price" />
              </div>
              {fullRights && (
                <div>
                  <label className={fieldLabel}>{t('col_buying_price')}</label>
                  <Input type="number" inputMode="decimal" min="0" value={row.buying_price}
                    onChange={e => update(row.id, 'buying_price', e.target.value)}
                    placeholder="0" aria-label={t('col_buying_price')} className="h-11 text-base sm:h-10 sm:text-sm" />
                </div>
              )}
              <div>
                <label className={fieldLabel}>{t('col_qty')}</label>
                <Input type="number" inputMode="numeric" min="0" value={row.quantity}
                  onChange={e => update(row.id, 'quantity', e.target.value)}
                  placeholder="0" aria-label={t('col_qty')} className="h-11 text-base sm:h-10 sm:text-sm" />
              </div>
              <div>
                <label className={fieldLabel}>{t('col_unit')}</label>
                <Select value={row.unit} onValueChange={v => update(row.id, 'unit', v)}>
                  <SelectTrigger className="h-11 sm:h-10 sm:text-sm" aria-label={t('col_unit')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                aria-label={t('remove_row', { index: idx + 1 })}
                className="hidden h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40 sm:flex"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-stockshop-blue hover:text-foreground dark:hover:border-blue-400"
            data-testid="bulk-add-row-add"
          >
            <Plus className="h-4 w-4" />
            {t('add_row')}
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">{t('enter_key')}</kbd>
          </button>

          <p className="text-center text-xs text-muted-foreground">
            {t('rows_to_add', { count: rows.length })}<span className="hidden sm:inline"> · {t('enter_hint')}</span>
          </p>
        </div>
      )}
    </FormDrawer>
  )
}
