'use client'

// Fiche produit › Numéros de série (étape 11 du Stock, migrations 197 / 198, 1er nov. 2026). Suivi activé produit par
// produit ; une unité = un numéro. Lecture avec le droit Stock ; activation, numérotation du stock existant et
// correction avec Stock en modification (vérifiés aussi par le serveur).
import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Hash, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { cn } from '@/lib/utils/cn'

interface SerialRow { id: string; serial: string; status: 'in_stock' | 'sold' | 'in_transit' | 'removed'; received_at: string; sold_at: string | null; sale: { sale_number: string | null; customer_name: string | null } | null }

export function ProductSerials({ product, onTrackingChange }: {
  product: { id: string; shop_id: string; name: string; quantity: number; track_serials?: boolean }
  onTrackingChange?: (tracked: boolean) => void
}) {
  const t = useTranslations('serials')
  const locale = useLocale()
  const { toast } = useToast()
  const { canWriteIn } = useShopPermissions()
  const canWrite = canWriteIn(product.shop_id, 'stock')
  const [tracked, setTracked] = useState(!!product.track_serials)
  const [rows, setRows] = useState<SerialRow[] | null>(null)
  const [tab, setTab] = useState<'in_stock' | 'sold'>('in_stock')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { setTracked(!!product.track_serials) }, [product.id, product.track_serials])

  const load = useCallback(async () => {
    const r = await fetch(`/api/products/serials?shop_id=${product.shop_id}&product_id=${product.id}`).catch(() => null)
    const j = r && r.ok ? await r.json().catch(() => null) : null
    setRows(j?.data ?? [])
  }, [product.id, product.shop_id])
  useEffect(() => { if (tracked) { setRows(null); load() } }, [tracked, load])

  const inStock = (rows || []).filter(r => r.status === 'in_stock')
  const sold = (rows || []).filter(r => r.status === 'sold')
  const missing = Math.max(0, Number(product.quantity) - inStock.length)
  // Plus de numéros en stock que d'unités (ex. inventaire en manque) : ceux qui ne sont plus en boutique se retirent
  const surplus = Math.max(0, inStock.length - Math.max(0, Number(product.quantity)))
  const lines = text.split(/[\n\r,;]+/).map(s => s.trim()).filter(Boolean)
  const fmt = (iso: string) => formatLocaleDate(iso, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })

  const toggle = async (next: boolean) => {
    setBusy('toggle')
    try {
      const res = await fetch('/api/products', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: product.id, shop_id: product.shop_id, track_serials: next }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      setTracked(next); onTrackingChange?.(next)
      toast({ title: next ? t('tracking_on') : t('tracking_off'), variant: 'success' })
    } finally { setBusy(null) }
  }
  const addExisting = async () => {
    setBusy('add')
    try {
      const res = await fetch('/api/products/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: product.shop_id, product_id: product.id, serials: lines }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      toast({ title: t('added', { count: lines.length }), variant: 'success' })
      setAdding(false); setText(''); load()
    } finally { setBusy(null) }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(removing.id)
    try {
      const res = await fetch('/api/products/serials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: product.shop_id, id: removing.id, action: 'remove', reason: removing.reason }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      setRemoving(null); load()
    } finally { setBusy(null) }
  }
  const correct = async () => {
    if (!editing) return
    setBusy(editing.id)
    try {
      const res = await fetch('/api/products/serials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: product.shop_id, id: editing.id, serial: editing.value }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: j.error || t('error'), variant: 'destructive' }); return }
      setEditing(null); load()
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3" data-testid="product-serials">
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t('track_label')}</span>
          <span className="block text-xs text-muted-foreground">{t('track_hint')}</span>
        </span>
        <Switch checked={tracked} onCheckedChange={toggle} disabled={!canWrite || busy === 'toggle'} data-testid="serials-toggle" aria-label={t('track_label')} />
      </label>

      {tracked && (rows === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <>
          <p className="text-sm" data-testid="serials-count">{t('count_line', { inStock: inStock.length, quantity: Number(product.quantity) })}</p>
          {missing > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="serials-missing">{t('missing', { count: missing })}</p>
          )}
          {surplus > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="serials-surplus">{t('surplus', { count: surplus })}</p>
          )}
          {canWrite && missing > 0 && (adding ? (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="serials-form">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={t('entry_many_placeholder')}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm placeholder:font-sans" data-testid="serials-input" />
              <p className="text-xs text-muted-foreground">{t('entry_count', { count: lines.length, max: missing })}</p>
              <div className="flex gap-2">
                <Button variant="stockshop" className="h-10" onClick={addExisting} loading={busy === 'add'} disabled={!lines.length || lines.length > missing} data-testid="serials-save">{t('save')}</Button>
                <Button variant="outline" className="h-10" onClick={() => { setAdding(false); setText('') }}>{t('cancel')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setAdding(true)} data-testid="serials-add"><Plus className="h-4 w-4" />{t('number_existing')}</Button>
          ))}

          <div className="flex gap-1 rounded-lg bg-muted/60 p-1 text-sm" role="tablist">
            {(['in_stock', 'sold'] as const).map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn('h-9 flex-1 rounded-md font-medium', tab === k ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
                {t(k === 'in_stock' ? 'tab_in_stock' : 'tab_sold', { count: k === 'in_stock' ? inStock.length : sold.length })}
              </button>
            ))}
          </div>
          {(tab === 'in_stock' ? inStock : sold).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(tab === 'in_stock' ? 'empty_in_stock' : 'empty_sold')}</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border" data-testid="serials-list">
              {(tab === 'in_stock' ? inStock : sold).map(r => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  {removing?.id === r.id ? (
                    <span className="flex flex-1 gap-2">
                      <Input value={removing.reason} onChange={e => setRemoving({ id: r.id, reason: e.target.value })} placeholder={t('remove_reason_placeholder')} className="h-9" aria-label={t('remove_reason_placeholder')} />
                      <Button variant="outline" className="h-9 text-destructive" onClick={remove} loading={busy === r.id}>{t('remove_action')}</Button>
                      <Button variant="outline" className="h-9" onClick={() => setRemoving(null)}>{t('cancel')}</Button>
                    </span>
                  ) : editing?.id === r.id ? (
                    <span className="flex flex-1 gap-2">
                      <Input value={editing.value} onChange={e => setEditing({ id: r.id, value: e.target.value })} className="h-9 font-mono" aria-label={t('correct')} />
                      <Button variant="stockshop" className="h-9" onClick={correct} loading={busy === r.id}>{t('save')}</Button>
                      <Button variant="outline" className="h-9" onClick={() => setEditing(null)}>{t('cancel')}</Button>
                    </span>
                  ) : (
                    <>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-mono"><Hash className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{r.serial}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.status === 'sold' && r.sold_at
                            ? t('sold_line', { date: fmt(r.sold_at), sale: r.sale?.sale_number || '', customer: r.sale?.customer_name || t('no_customer') })
                            : t('received_line', { date: fmt(r.received_at) })}
                        </span>
                      </span>
                      {canWrite && r.status === 'in_stock' && (
                        <span className="flex shrink-0 gap-1">
                          {surplus > 0 && (
                            <Button variant="ghost" size="sm" className="h-8 px-2 !min-h-0 text-xs text-destructive" onClick={() => setRemoving({ id: r.id, reason: '' })} data-testid="serial-remove">{t('remove_action')}</Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-8 w-8 !min-h-0 !min-w-0 p-0" title={t('correct')} onClick={() => setEditing({ id: r.id, value: r.serial })}>
                            <Pencil className="h-4 w-4" /><span className="sr-only">{t('correct')}</span>
                          </Button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ))}
    </div>
  )
}
