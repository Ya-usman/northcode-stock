'use client'

// « + Nouveau conditionnement » sur place, à la réception (prix de gros, 1er nov. 2026) : le fournisseur livre dans un
// format pas encore connu (carton de 12 au lieu de 24…). Il est créé par la route des conditionnements (mêmes contrôles
// que depuis la fiche : type, 2 à 100 000 pièces, code-barres unique), puis gardé sur la fiche pour les prochaines fois.
// Réservé à qui peut modifier les produits (le serveur le vérifie aussi) ; inscrit au journal (packaging.create).
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PACK_UNITS, type Packaging } from '@/lib/products/packaging'

export function NewPackagingInline({ shopId, productId, baseUnit, makeDefault, unitLabel, onCreated, onCancel }: {
  shopId: string
  productId: string
  baseUnit: string
  /** Premier conditionnement du produit : il devient celui par défaut */
  makeDefault: boolean
  unitLabel: (unit: string, n: number) => string
  onCreated: (p: Packaging) => void
  onCancel: () => void
}) {
  const t = useTranslations('packaging')
  const [unit, setUnit] = useState<string>('carton')
  const [count, setCount] = useState('')
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = Math.floor(Number(count))

  const save = async () => {
    if (!(n >= 2)) { setError(t('new_units_invalid')); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/products/packagings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, product_id: productId, unit, units_per_pack: n, barcode: barcode.trim() || null, is_default: makeDefault }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.data) { setError(j.error || t('error')); return }
      onCreated(j.data as Packaging)
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-stockshop-blue/40 p-3 dark:border-blue-800" data-testid="new-packaging">
      <p className="text-xs text-muted-foreground">{t('new_hint')}</p>
      <div className="grid grid-cols-2 gap-2">
        <Select value={unit} onValueChange={setUnit}>
          <SelectTrigger className="h-10" aria-label={t('new_type')} data-testid="new-packaging-unit"><SelectValue /></SelectTrigger>
          <SelectContent>{PACK_UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}</SelectContent>
        </Select>
        <Input inputMode="numeric" value={count} onChange={e => setCount(e.target.value.replace(/\D/g, ''))} placeholder={t('units_placeholder', { base: unitLabel(baseUnit, 2) })}
          className="h-10" aria-label={t('units_placeholder', { base: unitLabel(baseUnit, 2) })} data-testid="new-packaging-count" />
      </div>
      <Input value={barcode} onChange={e => setBarcode(e.target.value)} maxLength={32} placeholder={t('barcode_placeholder')} className="h-10 font-mono text-sm" data-testid="new-packaging-barcode" />
      {n >= 2 && <p className="text-xs text-muted-foreground">{t('preview', { pack: t('pack_of', { pack: unitLabel(unit, 1), count: n, base: unitLabel(baseUnit, n) }) })}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="stockshop" size="sm" className="h-9" loading={busy} onClick={save} data-testid="new-packaging-save">{t('save')}</Button>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  )
}
