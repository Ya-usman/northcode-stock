'use client'

// « Disponible ailleurs » (décisions du 30 oct. 2026) : stock d'un produit dans les AUTRES boutiques de l'entreprise,
// pour orienter le client (ville, téléphone, ouverte ou fermée, quantité exacte), et DEMANDE de transfert à la boutique
// qui a le stock (elle décide dans Stock › Transferts). Utilisé en caisse et dans la fiche produit.

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, MapPin, Minus, Phone, Plus, Send, Store } from 'lucide-react'
import { AppDrawer } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'
import { defaultRequestQty, type ElsewhereShop } from '@/lib/stock/elsewhere'

export interface ElsewhereData {
  enabled: boolean
  canRequest: boolean
  items: Record<string, { total: number; shops: ElsewhereShop[] }>
}

/** Stock des autres boutiques pour des produits de la boutique (null = pas encore chargé ou indisponible) */
export function useElsewhere(shopId: string | null | undefined, productIds: string[], active = true) {
  const [data, setData] = useState<ElsewhereData | null>(null)
  const key = productIds.slice().sort().join(',')
  const load = useCallback(async () => {
    if (!active || !shopId || !key) { setData(null); return }
    try {
      const res = await fetch(`/api/stock/elsewhere?shop_id=${shopId}&product_ids=${key}`)
      if (!res.ok) { setData(null); return }
      const j = await res.json()
      setData({ enabled: !!j.enabled, canRequest: !!j.can_request, items: j.items || {} })
    } catch { setData(null) }
  }, [shopId, key, active])
  useEffect(() => { load() }, [load])
  return { data, reload: load }
}

export function ElsewhereSheet({ open, onOpenChange, shopId, product, entry, canRequest, onRequested }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Boutique qui vend (celle qui demande) */
  shopId: string
  product: { id: string; name: string; unit?: string | null; threshold?: number; available?: number }
  entry: { total: number; shops: ElsewhereShop[] } | null | undefined
  canRequest: boolean
  onRequested?: () => void
}) {
  const t = useTranslations('elsewhere')
  const { toast } = useToast()
  const unitLabel = useUnitLabel()
  const [asking, setAsking] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => { if (!open) { setAsking(null); setNote('') } }, [open])

  const startAsk = (s: ElsewhereShop) => {
    setAsking(s.shop_id)
    setQty(defaultRequestQty({ available: s.available, threshold: product.threshold ?? 0, localAvailable: product.available ?? 0 }))
    setNote('')
  }
  const send = async (s: ElsewhereShop) => {
    setSending(true)
    try {
      const res = await fetch('/api/stock-transfers/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, product_id: product.id, source_shop_id: s.shop_id, quantity: qty, note: note.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: json.error || t('request_failed'), variant: 'destructive' }); return }
      toast({ title: t('request_sent', { shop: s.name }), variant: 'success' })
      setAsking(null)
      onRequested?.()
    } finally { setSending(false) }
  }
  const shops = entry?.shops || []

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange} title={t('title')} description={product.name} icon={<Store className="h-4 w-4" />}
      width="sm" mobile="sheet" testId="elsewhere-sheet">
      <div className="space-y-2">
        {!shops.length && <p className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">{t('none')}</p>}
        {shops.map(s => (
          <section key={s.shop_id} className="rounded-xl border bg-card p-3 shadow-sm" data-testid="elsewhere-shop">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {s.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.city}</span>}
                  <span className={cn('flex items-center gap-1 font-medium', s.open ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
                    <Clock className="h-3 w-3" />{s.open ? (s.closes_at ? t('open_until', { time: s.closes_at }) : t('open')) : t('closed')}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xl font-bold tabular-nums" data-testid="elsewhere-qty">{s.available}</p>
                {product.unit && <p className="text-xs text-muted-foreground">{unitLabel(product.unit, s.available)}</p>}
              </div>
            </div>
            {s.pending > 0 && <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t('already_requested', { count: s.pending })}</p>}
            <div className="mt-3 flex gap-2">
              {s.phone && (
                <Button asChild variant="outline" className="h-10 flex-1 gap-1.5">
                  <a href={`tel:${s.phone.replace(/\s+/g, '')}`}><Phone className="h-4 w-4" />{t('call')}</a>
                </Button>
              )}
              {canRequest && s.pending === 0 && asking !== s.shop_id && (
                <Button variant="stockshop" className="h-10 flex-1 gap-1.5" onClick={() => startAsk(s)} data-testid="elsewhere-request">
                  <Send className="h-4 w-4" />{t('request')}
                </Button>
              )}
            </div>
            {asking === s.shop_id && (
              <div className="mt-3 space-y-3 border-t pt-3 animate-in fade-in-0 slide-in-from-top-1" data-testid="elsewhere-request-form">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t('request_qty')}</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-10 w-10" disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))} aria-label={t('less')}><Minus className="h-4 w-4" /></Button>
                    <Input type="number" inputMode="numeric" min={1} max={s.available} value={qty} onChange={e => setQty(Math.max(1, Math.min(s.available, Math.floor(Number(e.target.value)) || 1)))}
                      className="h-10 w-16 text-center font-bold tabular-nums" aria-label={t('request_qty')} data-testid="elsewhere-request-qty" />
                    <Button type="button" variant="outline" size="icon" className="h-10 w-10" disabled={qty >= s.available} onClick={() => setQty(q => Math.min(s.available, q + 1))} aria-label={t('more')}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
                <Input value={note} onChange={e => setNote(e.target.value.slice(0, 500))} placeholder={t('request_note_placeholder')} className="h-10" />
                <p className="text-xs text-muted-foreground">{t('request_hint', { shop: s.name })}</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-11 flex-1" onClick={() => setAsking(null)} disabled={sending}>{t('cancel')}</Button>
                  <Button variant="stockshop" className="h-11 flex-[2] gap-1.5" loading={sending} onClick={() => send(s)} data-testid="elsewhere-request-send">
                    {!sending && <Send className="h-4 w-4" />}{t('request_send')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
    </AppDrawer>
  )
}
