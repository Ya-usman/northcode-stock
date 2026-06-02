'use client'

import { useState, useRef } from 'react'
import { Plus, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'

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
  currency: string
  isOwner: boolean
  onSaved: (count: number) => void
}

const UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box']

let nextId = 1
const newRow = (): Row => ({ id: nextId++, name: '', selling_price: '', buying_price: '', quantity: '0', unit: 'piece' })

export function BulkAddModal({ open, onClose, shopId, currency, isOwner, onSaved }: Props) {
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
    setErrors(e => { const n = { ...e }; delete n[id]; return n })
  }

  const handleSave = async () => {
    const errs: Record<number, string> = {}
    const valid = rows.filter(row => {
      if (!row.name.trim()) { errs[row.id] = 'Nom requis'; return false }
      const price = parseFloat(row.selling_price)
      if (!row.selling_price || isNaN(price) || price <= 0) { errs[row.id] = 'Prix requis'; return false }
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

      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload, shop_id: shopId }),
      })
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

  return (
    <PremiumDialog open={open} onOpenChange={v => { if (!v) handleClose() }} category="Stock" title="Ajout rapide de produits" icon={<Plus className="h-4 w-4" />} maxWidth="max-w-xl">
      <PremiumDialogBody className="space-y-3">

        {savedCount > 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="font-semibold text-lg">{savedCount} produit{savedCount > 1 ? 's' : ''} ajouté{savedCount > 1 ? 's' : ''} !</p>
            <Button variant="outline" onClick={reset}>Ajouter d'autres produits</Button>
          </div>
        ) : (
          <>
            {errors[-1] && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors[-1]}</p>
            )}

            {/* Column headers */}
            <div className={`grid gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 ${isOwner ? 'grid-cols-[1fr_80px_80px_60px_90px_28px]' : 'grid-cols-[1fr_80px_60px_90px_28px]'}`}>
              <span>Nom *</span>
              <span>Prix vente *</span>
              {isOwner && <span>Prix achat</span>}
              <span>Qté</span>
              <span>Unité</span>
              <span />
            </div>

            {/* Rows */}
            <div className="space-y-2 pr-1">
              {rows.map((row, idx) => (
                <div key={row.id} className={`grid gap-2 items-start ${isOwner ? 'grid-cols-[1fr_80px_80px_60px_90px_28px]' : 'grid-cols-[1fr_80px_60px_90px_28px]'}`}>
                  <div>
                    <Input
                      ref={idx === rows.length - 1 ? lastInputRef : undefined}
                      value={row.name}
                      onChange={e => update(row.id, 'name', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
                      placeholder={`Produit ${idx + 1}`}
                      className={`h-9 text-sm ${errors[row.id] ? 'border-red-400' : ''}`}
                    />
                    {errors[row.id] && <p className="text-[10px] text-red-500 mt-0.5">{errors[row.id]}</p>}
                  </div>
                  <Input
                    type="number" min="0" value={row.selling_price}
                    onChange={e => update(row.id, 'selling_price', e.target.value)}
                    placeholder="0" className="h-9 text-sm"
                  />
                  {isOwner && (
                    <Input
                      type="number" min="0" value={row.buying_price}
                      onChange={e => update(row.id, 'buying_price', e.target.value)}
                      placeholder="0" className="h-9 text-sm"
                    />
                  )}
                  <Input
                    type="number" min="0" value={row.quantity}
                    onChange={e => update(row.id, 'quantity', e.target.value)}
                    placeholder="0" className="h-9 text-sm"
                  />
                  <Select value={row.unit} onValueChange={v => update(row.id, 'unit', v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length === 1}
                    className="h-9 w-7 flex items-center justify-center text-muted-foreground hover:text-red-500 disabled:opacity-30 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add row */}
            <button
              onClick={addRow}
              className="w-full h-9 border-2 border-dashed border-border rounded-lg flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter une ligne  <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">Enter</kbd>
            </button>

            <p className="text-[11px] text-muted-foreground text-center">
              {rows.length} produit{rows.length > 1 ? 's' : ''} à ajouter · Appuyez sur Entrée pour passer à la ligne suivante
            </p>
          </>
        )}
      </PremiumDialogBody>

      {savedCount === 0 && (
        <PremiumDialogFooter onCancel={handleClose}>
          <Button
            className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light gap-2"
            disabled={saving || rows.every(r => !r.name.trim())}
            onClick={handleSave}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…</> : `Enregistrer ${rows.filter(r => r.name.trim()).length || ''} produit${rows.filter(r => r.name.trim()).length > 1 ? 's' : ''}`}
          </Button>
        </PremiumDialogFooter>
      )}
    </PremiumDialog>
  )
}
