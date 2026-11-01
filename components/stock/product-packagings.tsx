'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Package, Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { PACK_UNITS, type Packaging } from '@/lib/products/packaging'
import { cn } from '@/lib/utils/cn'

// Fiche produit › Conditionnements d'achat (étape 9 du Stock, 1er nov. 2026) : « carton de 24 », « sac de 50 »…
// Servent à saisir un réapprovisionnement ou un bon de commande en colis ; le stock reste en unité de base.
// Lecture avec le droit Stock, ajout / retrait avec Stock en modification (vérifiés aussi par le serveur).
export function ProductPackagings({ product }: { product: { id: string; shop_id: string; unit: string | null } }) {
  const t = useTranslations('packaging')
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const { canWriteIn } = useShopPermissions()
  const canWrite = canWriteIn(product.shop_id, 'stock')
  const [list, setList] = useState<Packaging[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [unit, setUnit] = useState<string>('carton')
  const [units, setUnits] = useState('')
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/products/packagings?shop_id=${product.shop_id}&product_id=${product.id}`).catch(() => null)
    const j = r && r.ok ? await r.json().catch(() => null) : null
    setList(j?.data ?? [])
  }, [product.id, product.shop_id])
  useEffect(() => { setList(null); load() }, [load])

  const base = (n: number) => unitLabel(product.unit || 'piece', n)
  const packText = (p: Pick<Packaging, 'unit' | 'units_per_pack'>) => t('pack_of', { pack: unitLabel(p.unit, 1), count: p.units_per_pack, base: base(p.units_per_pack) })

  const add = async () => {
    setBusy('add')
    try {
      const res = await fetch('/api/products/packagings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: product.shop_id, product_id: product.id, unit, units_per_pack: Number(units), barcode: barcode.trim() || null, is_default: !list?.length }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      setAdding(false); setUnits(''); setBarcode('')
      toast({ title: t('added', { pack: packText(j.data) }), variant: 'success' })
      load()
    } finally { setBusy(null) }
  }
  const makeDefault = async (p: Packaging) => {
    setBusy(p.id)
    try {
      const res = await fetch('/api/products/packagings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: product.shop_id, id: p.id, is_default: true }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      load()
    } finally { setBusy(null) }
  }
  const remove = async (p: Packaging) => {
    setBusy(p.id)
    try {
      const res = await fetch(`/api/products/packagings?shop_id=${product.shop_id}&id=${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      load()
    } finally { setBusy(null) }
  }

  const unitsOk = Number.isInteger(Number(units)) && Number(units) >= 2 && Number(units) <= 100000

  return (
    <div className="space-y-2" data-testid="product-packagings">
      {list === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : list.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t('none', { base: base(1) })}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" data-testid="packaging-row">
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium"><Package className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{packText(p)}
                  {p.is_default && <span className="rounded-full bg-stockshop-blue-muted px-2 py-0.5 text-[10px] font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">{t('default')}</span>}
                </span>
                {p.barcode && <span className="block font-mono text-[11px] text-muted-foreground">{p.barcode}</span>}
              </span>
              {canWrite && (
                <span className="flex shrink-0 gap-1">
                  {!p.is_default && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 !min-h-0 !min-w-0 p-0" title={t('make_default')} onClick={() => makeDefault(p)} disabled={!!busy}>
                      <Star className="h-4 w-4" /><span className="sr-only">{t('make_default')}</span>
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 !min-h-0 !min-w-0 p-0 text-destructive" title={t('remove')} onClick={() => remove(p)} disabled={!!busy} data-testid="packaging-remove">
                    <Trash2 className="h-4 w-4" /><span className="sr-only">{t('remove')}</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (adding ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="packaging-form">
          <div className="grid grid-cols-2 gap-2">
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger className="h-10" data-testid="packaging-unit"><SelectValue /></SelectTrigger>
              <SelectContent>{PACK_UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}</SelectContent>
            </Select>
            <Input inputMode="numeric" value={units} onChange={e => setUnits(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('units_placeholder', { base: base(2) })} className="h-10" data-testid="packaging-units" />
          </div>
          <Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder={t('barcode_placeholder')} className="h-10 font-mono placeholder:font-sans" data-testid="packaging-barcode" />
          {unitsOk && <p className="text-xs text-muted-foreground">{t('preview', { pack: packText({ unit, units_per_pack: Number(units) }) })}</p>}
          <div className="flex gap-2">
            <Button variant="stockshop" className="h-10" onClick={add} loading={busy === 'add'} disabled={!unitsOk} data-testid="packaging-save">{t('save')}</Button>
            <Button variant="outline" className="h-10" onClick={() => setAdding(false)}>{t('cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className={cn('h-9 gap-1.5')} onClick={() => setAdding(true)} data-testid="packaging-add">
          <Plus className="h-4 w-4" />{t('add')}
        </Button>
      ))}
    </div>
  )
}
