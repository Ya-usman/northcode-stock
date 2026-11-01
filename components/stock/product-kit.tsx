'use client'

// Fiche produit › Kit (étape 16 du Stock, migration 200, 1er nov. 2026) : un kit est composé d'autres produits de la
// boutique. On ASSEMBLE N kits (les composants sortent du stock, le kit entre au coût des composants) ou on
// DÉSASSEMBLE. Lecture avec le droit Stock ; composition, assemblage et désassemblage avec Stock en modification.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Boxes, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { normalize } from '@/lib/utils/normalize'

interface Comp { product_id: string; name: string; unit: string | null; quantity: number; available?: number }

export function ProductKit({ product, onChanged }: {
  product: { id: string; shop_id: string; name: string; quantity: number; is_kit?: boolean; track_serials?: boolean }
  onChanged?: () => void
}) {
  const t = useTranslations('kits')
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const { canWriteIn } = useShopPermissions()
  const canWrite = canWriteIn(product.shop_id, 'stock')
  const [data, setData] = useState<{ is_kit: boolean; components: Comp[]; assemblable: number } | null>(null)
  const [editing, setEditing] = useState<Comp[] | null>(null)
  const [candidates, setCandidates] = useState<{ id: string; name: string; unit: string | null }[]>([])
  const [search, setSearch] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/products/kits?shop_id=${product.shop_id}&product_id=${product.id}`).catch(() => null)
    const j = r && r.ok ? await r.json().catch(() => null) : null
    setData(j?.data ?? { is_kit: false, components: [], assemblable: 0 })
  }, [product.id, product.shop_id])
  useEffect(() => { setData(null); setEditing(null); load() }, [load])

  // Produits proposés comme composants : même boutique, actifs, ni kit ni suivis par numéro de série
  const openEditor = async () => {
    setEditing((data?.components || []).map(c => ({ ...c })))
    const { data: list } = await createClient().from('products').select('id, name, unit, is_kit, track_serials')
      .eq('shop_id', product.shop_id).eq('is_active', true).order('name').limit(2000)
    setCandidates(((list || []) as any[]).filter(p => p.id !== product.id && !p.is_kit && !p.track_serials))
  }
  const results = useMemo(() => {
    const q = normalize(search.trim())
    if (!q || !editing) return []
    return candidates.filter(c => !editing.some(e => e.product_id === c.id) && normalize(c.name).includes(q)).slice(0, 8)
  }, [search, candidates, editing])

  const saveComposition = async () => {
    if (!editing) return
    setBusy('save')
    try {
      const res = await fetch('/api/products/kits', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: product.shop_id, product_id: product.id, components: editing.map(c => ({ product_id: c.product_id, quantity: c.quantity })) }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      toast({ title: editing.length ? t('saved') : t('removed'), variant: 'success' })
      setEditing(null); load(); onChanged?.()
    } finally { setBusy(null) }
  }
  const run = async (action: 'assemble' | 'disassemble') => {
    const n = Math.floor(Number(qty))
    if (!(n >= 1)) return
    setBusy(action)
    try {
      const res = await fetch('/api/products/kits', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: product.shop_id, product_id: product.id, action, quantity: n }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      toast({ title: t(action === 'assemble' ? 'assembled' : 'disassembled', { count: n }), variant: 'success' })
      setQty('1'); load(); onChanged?.()
    } finally { setBusy(null) }
  }

  if (product.track_serials) return <p className="text-sm text-muted-foreground">{t('not_for_serials')}</p>
  if (!data) return <p className="text-sm text-muted-foreground">…</p>

  // Composition en cours de modification
  if (editing) return (
    <div className="space-y-3" data-testid="kit-editor">
      {editing.length === 0 && <p className="text-sm text-muted-foreground">{t('empty_editor')}</p>}
      <ul className="divide-y rounded-lg border">
        {editing.map(c => (
          <li key={c.product_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{c.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={t('decrease')}
                onClick={() => setEditing(prev => prev!.map(x => x.product_id === c.product_id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}><Minus className="h-4 w-4" /></Button>
              <Input inputMode="numeric" value={c.quantity} className="h-9 w-16 text-center" aria-label={t('per_kit', { name: c.name })}
                onChange={e => { const n = Math.max(1, Math.min(10000, Math.floor(Number(e.target.value) || 1))); setEditing(prev => prev!.map(x => x.product_id === c.product_id ? { ...x, quantity: n } : x)) }} />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={t('increase')}
                onClick={() => setEditing(prev => prev!.map(x => x.product_id === c.product_id ? { ...x, quantity: Math.min(10000, x.quantity + 1) } : x))}><Plus className="h-4 w-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={t('remove_component', { name: c.name })}
                onClick={() => setEditing(prev => prev!.filter(x => x.product_id !== c.product_id))}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </li>
        ))}
      </ul>
      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('add_placeholder')} className="h-10" data-testid="kit-search" />
      {results.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {results.map(c => (
            <li key={c.id}>
              <button type="button" className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-muted/60"
                onClick={() => { setEditing(prev => [...prev!, { product_id: c.id, name: c.name, unit: c.unit, quantity: 1 }]); setSearch('') }}>{c.name}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="stockshop" className="h-10" onClick={saveComposition} loading={busy === 'save'} data-testid="kit-save">{t('save')}</Button>
        <Button variant="outline" className="h-10" onClick={() => { setEditing(null); setSearch('') }}>{t('cancel')}</Button>
      </div>
    </div>
  )

  if (!data.is_kit) return (
    <div className="space-y-2" data-testid="product-kit">
      <p className="text-sm text-muted-foreground">{t('not_a_kit')}</p>
      {canWrite && <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={openEditor} data-testid="kit-make"><Boxes className="h-4 w-4" />{t('make_kit')}</Button>}
    </div>
  )

  return (
    <div className="space-y-3" data-testid="product-kit">
      <ul className="divide-y rounded-lg border" data-testid="kit-components">
        {data.components.map(c => (
          <li key={c.product_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{c.quantity} × {c.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{t('available', { count: c.available ?? 0, unit: unitLabel(c.unit || 'piece', c.available ?? 0) })}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm" data-testid="kit-assemblable">{t('assemblable', { count: data.assemblable })}</p>
      {canWrite && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d]/g, ''))} className="h-10 w-20 text-center" aria-label={t('quantity')} data-testid="kit-qty" />
            <Button variant="stockshop" className="h-10" onClick={() => run('assemble')} loading={busy === 'assemble'}
              disabled={!!busy || !(Number(qty) >= 1) || Number(qty) > data.assemblable} data-testid="kit-assemble">{t('assemble')}</Button>
            <Button variant="outline" className="h-10" onClick={() => run('disassemble')} loading={busy === 'disassemble'}
              disabled={!!busy || !(Number(qty) >= 1) || Number(qty) > Math.max(0, Number(product.quantity))} data-testid="kit-disassemble">{t('disassemble')}</Button>
          </div>
          <Button variant="ghost" size="sm" className="h-9 px-2" onClick={openEditor} data-testid="kit-edit">{t('edit')}</Button>
        </>
      )}
    </div>
  )
}
