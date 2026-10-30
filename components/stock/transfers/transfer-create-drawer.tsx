'use client'

// Nouveau transfert / modification d'un brouillon (Stock › Transferts V1). Source = boutique de l'en-tête, ou choisie
// explicitement en « Toutes les boutiques » (jamais une boutique cachée). Étapes : « Vers quelle boutique ? »,
// produits (recherche ou scan du code-barres ; nom, code, quantité TRANSFÉRABLE = vendable, lots périmés exclus),
// quantités ; « Enregistrer en brouillon » ou « Envoyer ». Le serveur reste l'autorité (stock revérifié à l'envoi).
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Minus, Package, Plus, ScanLine, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AppDrawer } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FOOTER_CANCEL_CLASS, FOOTER_PRIMARY_CLASS, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { BarcodeScanner } from '@/components/stock/barcode-scanner'
import { useToast } from '@/components/ui/use-toast'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { normalize } from '@/lib/utils/normalize'
import { sellableStock, shopToday } from '@/lib/stock/sellable'
import { withTimeout } from '@/lib/utils/with-timeout'

const supabase = createClient() as any

interface ShopLite { id: string; name: string; timezone?: string | null; country?: string | null }
interface Prod { id: string; name: string; unit: string | null; sku: string | null; transferable: number }
interface Line { product_id: string; name: string; unit: string; sku: string | null; available: number; quantity: number }

export interface TransferDraftInput {
  id: string
  destination_shop_id: string
  notes: string | null
  updated_at?: string | null
  items: { source_product_id: string; product_name: string; unit: string | null; quantity_sent: number }[]
}

/** Transfert préparé depuis une DEMANDE (migration 190) : destination, produit et quantité déjà remplis */
export interface TransferPrefill {
  request_id: string
  destination_shop_id: string
  /** Nom de la boutique qui demande (si la personne n'en est pas membre) */
  destination_name?: string | null
  notes: string | null
  items: TransferDraftInput['items']
}

export function TransferCreateDrawer({ open, onOpenChange, source, shops, workflow, draft, prefill, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: ShopLite | null
  /** Boutiques possibles en destination (la source est exclue) */
  shops: ShopLite[]
  /** Migration 188 appliquée : brouillon disponible */
  workflow: boolean
  /** Brouillon à modifier (sinon : nouveau transfert) */
  draft?: TransferDraftInput | null
  /** Demande acceptée : nouveau transfert prérempli, rattaché à la demande à l'envoi */
  prefill?: TransferPrefill | null
  onDone: (result: { reference: string; sent: boolean }) => void
}) {
  const t = useTranslations('transfers')
  const tRoot = useTranslations()
  const { toast } = useToast()
  const unitLabel = useUnitLabel()
  const [products, setProducts] = useState<Prod[]>([])
  const [dest, setDest] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<null | 'draft' | 'send'>(null)

  // Produits de la boutique SOURCE et leur quantité transférable (même règle que la caisse et le serveur)
  useEffect(() => {
    if (!open || !source) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await withTimeout<any>(supabase.from('products').select('id, name, unit, sku, quantity')
          .eq('shop_id', source.id).eq('is_active', true).order('name'), 20_000)
        const list = (data || []) as any[]
        const ids = list.filter(p => (p.quantity || 0) > 0).map(p => p.id)
        const lots: any[] = []
        for (let i = 0; i < ids.length; i += 200) {
          const { data: part } = await supabase.from('product_batches').select('product_id, quantity, expiry_date').in('product_id', ids.slice(i, i + 200)).gt('quantity', 0)
          lots.push(...(part || []))
        }
        const asOf = shopToday(source as any)
        const byProduct: Record<string, any[]> = {}
        for (const l of lots) (byProduct[l.product_id] ||= []).push(l)
        if (!cancelled) setProducts(list.map(p => ({ id: p.id, name: p.name, unit: p.unit, sku: p.sku, transferable: sellableStock(p.quantity || 0, byProduct[p.id] || [], asOf).sellable })))
      } catch { if (!cancelled) setProducts([]) }
    })()
    return () => { cancelled = true }
  }, [open, source])

  // Ouverture : vide, le brouillon à modifier, ou une demande acceptée
  useEffect(() => {
    if (!open) return
    const from = draft ?? prefill ?? null
    setSearch(''); setScanning(false); setBusy(null)
    setDest(from?.destination_shop_id ?? '')
    setNotes(from?.notes ?? '')
    setLines((from?.items || []).map(it => ({ product_id: it.source_product_id, name: it.product_name, unit: it.unit || '', sku: null, available: it.quantity_sent, quantity: it.quantity_sent })))
  }, [open, draft, prefill])
  // Quantités transférables connues une fois les produits chargés (brouillon rouvert)
  useEffect(() => {
    if (!products.length) return
    setLines(prev => prev.map(l => { const p = products.find(x => x.id === l.product_id); return p ? { ...l, available: p.transferable, sku: p.sku } : l }))
  }, [products])

  const results = useMemo(() => {
    const q = normalize(search)
    if (!q) return []
    return products.filter(p => !lines.some(l => l.product_id === p.id) && (normalize(p.name).includes(q) || (p.sku || '').includes(search.trim()))).slice(0, 20)
  }, [search, products, lines])

  const add = (p: Prod, qty = 1) => {
    setLines(prev => {
      const existing = prev.find(l => l.product_id === p.id)
      if (existing) return prev.map(l => l.product_id === p.id ? { ...l, quantity: Math.min(l.quantity + qty, p.transferable) } : l)
      return [...prev, { product_id: p.id, name: p.name, unit: p.unit || '', sku: p.sku, available: p.transferable, quantity: Math.min(qty, Math.max(p.transferable, 0)) || 1 }]
    })
    setSearch('')
  }
  const onScan = (code: string) => {
    const p = products.find(x => (x.sku || '').trim() === code.trim())
    if (!p) { toast({ title: t('scan_product_unknown'), variant: 'destructive' }); return }
    add(p)
    toast({ title: t('scan_product_added', { name: p.name }) })
  }
  const setQty = (id: string, q: number) => setLines(prev => prev.map(l => l.product_id === id ? { ...l, quantity: Math.max(0, Math.floor(q || 0)) } : l))

  const valid = !!source && !!dest && lines.some(l => l.quantity > 0) && lines.every(l => l.quantity <= l.available || l.available <= 0)
  const submit = async (send: boolean) => {
    if (!source || !dest) return
    const items = lines.filter(l => l.quantity > 0).map(l => ({ product_id: l.product_id, quantity: l.quantity }))
    if (!items.length) { toast({ title: tRoot('transfers.select_at_least_one_product'), variant: 'destructive' }); return }
    setBusy(send ? 'send' : 'draft')
    try {
      let reference = ''
      if (draft) {
        const res = await fetch(`/api/stock-transfers/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ destination_shop_id: dest, notes: notes.trim() || null, items, expected_updated_at: draft.updated_at ?? null }) })
        const json = await res.json()
        if (!res.ok) { toast({ title: json.error || tRoot('toast.error'), variant: 'destructive' }); return }
        if (send) {
          const r2 = await fetch('/api/stock-transfers/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_id: draft.id }) })
          const j2 = await r2.json()
          if (!r2.ok) { toast({ title: j2.error || tRoot('toast.error'), variant: 'destructive' }); return }
          reference = j2.data?.reference || ''
        }
      } else {
        const res = await withTimeout(fetch('/api/stock-transfers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_shop_id: source.id, destination_shop_id: dest, notes: notes.trim() || null, items, send, ...(prefill ? { request_id: prefill.request_id } : {}) }) }))
        const json = await res.json()
        if (!res.ok) { toast({ title: json.error || tRoot('toast.error'), variant: 'destructive' }); return }
        reference = json.data?.reference || ''
      }
      onDone({ reference, sent: send })
      onOpenChange(false)
    } catch (e: any) {
      toast({ title: e.message || tRoot('toast.error'), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      category={source ? tRoot('transfers.from_shop', { name: source.name }) : undefined}
      title={draft ? t('action_edit') : tRoot('transfers.new_transfer')}
      icon={<Package className="h-4 w-4" />}
      width="md"
      dirty={!!dest || lines.length > 0 || !!notes.trim()}
      testId="transfer-drawer"
      footer={({ requestClose }) => (
        <div className="flex flex-col gap-2">
          {workflow && (
            <Button variant="outline" className="h-11 w-full" onClick={() => submit(false)} loading={busy === 'draft'} disabled={!valid || !!busy} data-testid="transfer-save-draft">
              {tRoot('transfers.save_draft')}
            </Button>
          )}
          <div className={FOOTER_ROW_CLASS}>
            <Button type="button" variant="outline" className={FOOTER_CANCEL_CLASS} onClick={requestClose} disabled={!!busy}>{tRoot('actions.cancel')}</Button>
            <Button variant="stockshop" className={FOOTER_PRIMARY_CLASS} onClick={() => submit(true)} loading={busy === 'send'} disabled={!valid || !!busy} data-testid="transfer-send">
              {t('action_send')}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        <section className="space-y-1.5">
          <Label className="text-sm font-semibold">{t('step_destination')}</Label>
          <Select value={dest} onValueChange={setDest}>
            <SelectTrigger className="h-11" data-testid="transfer-destination"><SelectValue placeholder={tRoot('form.select_placeholder')} /></SelectTrigger>
            <SelectContent>{shops.filter(s => s.id !== source?.id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-semibold">{t('step_products')}</Label>
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setScanning(s => !s)} data-testid="transfer-scan-product">
              <ScanLine className="h-4 w-4 shrink-0" />{scanning ? t('scan_mode_off') : t('scan_product')}
            </Button>
          </div>
          {scanning && <BarcodeScanner continuous onDetected={onScan} onClose={() => setScanning(false)} />}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={tRoot('transfers.search_own_product_placeholder')} className="h-11 pl-9" />
          </div>
          {results.length > 0 && (
            <div className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-card">
              {results.map(p => (
                <button key={p.id} type="button" onClick={() => add(p)} disabled={p.transferable <= 0}
                  className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50">
                  <span className="min-w-0"><span className="block truncate">{p.name}</span>{p.sku && <span className="block text-xs text-muted-foreground tabular-nums">{p.sku}</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t('transferable_short')} : {p.transferable}</span>
                </button>
              ))}
            </div>
          )}
          {lines.length > 0 && <p className="text-xs text-muted-foreground">{t('expired_excluded_hint')}</p>}
          <div className="space-y-2">
            {lines.map(l => {
              const over = l.quantity > l.available
              return (
                <div key={l.product_id} className="rounded-xl border bg-card p-3" data-testid="transfer-line-edit">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.name}</p>
                      <p className={over ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        {l.sku ? `${l.sku} · ` : ''}{t('transferable_short')} : {l.available} {unitLabel(l.unit, l.available)}
                      </p>
                    </div>
                    <button type="button" onClick={() => setLines(prev => prev.filter(x => x.product_id !== l.product_id))}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
                      aria-label={tRoot('actions.delete')}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => setQty(l.product_id, l.quantity - 1)} aria-label={t('decrease')}><Minus className="h-4 w-4" /></Button>
                    <Input type="number" inputMode="numeric" min={0} max={l.available} value={l.quantity}
                      onChange={e => setQty(l.product_id, Number(e.target.value))}
                      className="h-11 w-20 text-center text-base font-semibold tabular-nums" aria-label={`${l.name}`} />
                    <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => setQty(l.product_id, Math.min(l.quantity + 1, l.available))} aria-label={t('increase')}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="space-y-1.5">
          <Label>{tRoot('transfers.notes_label')}</Label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={500}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </section>
      </div>
    </AppDrawer>
  )
}
