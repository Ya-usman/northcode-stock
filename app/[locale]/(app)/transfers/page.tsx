'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Search, Plus, X, ArrowRight, Package, Download, Share2, Mail, Copy, Ban, CheckCircle2 } from 'lucide-react'
import { isCapacitor } from '@/lib/utils/native-share'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { normalize } from '@/lib/utils/normalize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'
import { generateStockTransferPDF } from '@/lib/utils/pdf'
import type { Product } from '@/lib/types/database'

const STATUS_STYLES: Record<string, string> = {
  sent: 'bg-blue-50 dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400',
  received: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400',
  cancelled: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
}

const DISCREPANCY_CATEGORIES = ['transport_loss', 'theft', 'breakage', 'count_error', 'other'] as const

const supabase = createClient() as any

export default function TransfersPage() {
  const t = useTranslations()
  const { shop, userShops, roleInActiveShop, profile } = useAuth()
  const { isOnline } = useOffline()
  const { toast } = useToast()

  const effectiveRole = roleInActiveShop ?? profile?.role
  const canManage = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin'].includes(effectiveRole || '')

  const [transfers, setTransfers] = useState<any[]>(() => getPageCache<any[]>(`transfers_${shop?.id}`) || [])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(() => !getPageCache(`transfers_${shop?.id}`))
  const [{ search }, setFilter] = usePersistedFilters('transfers', shop?.id, { search: '' })

  // ── Nouveau transfert ────────────────────────────────────────────────────
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newDestShopId, setNewDestShopId] = useState('')
  const [newProductSearch, setNewProductSearch] = useState('')
  const [newItems, setNewItems] = useState<{ product_id: string; name: string; unit: string; available: number; quantity: string }[]>([])
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [lastCreatedRef, setLastCreatedRef] = useState<string | null>(null)

  // ── Réception ────────────────────────────────────────────────────────────
  const [receivingTransfer, setReceivingTransfer] = useState<any | null>(null)
  const [receiveLines, setReceiveLines] = useState<Record<string, {
    destination_product_id: string | null
    matchSearch: string
    quantity_received: string
    discrepancy_category: string
    discrepancy_detail: string
  }>>({})
  const [receiving, setReceiving] = useState(false)

  // ── Annulation / email ───────────────────────────────────────────────────
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [emailTransfer, setEmailTransfer] = useState<any | null>(null)

  const fetchTransfers = async () => {
    if (!shop?.id) return
    const cacheKey = `transfers_${shop.id}`
    const cached = getPageCache<any[]>(cacheKey)
    if (cached) { setTransfers(cached); setLoading(false) }
    if (!isOnline) { if (!cached) setLoading(false); return }
    try {
      const res = await withTimeout(fetch(`/api/stock-transfers?shop_id=${shop.id}`), 20_000, t('transfers.load_timeout'))
      if (!res.ok) return
      const json = await res.json()
      setTransfers(json.data || [])
      setPageCache(cacheKey, json.data || [])
    } catch {
      // cache déjà appliqué si disponible
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async () => {
    if (!shop?.id) return
    try {
      const { data } = await withTimeout<any>(
        supabase.from('products').select('id, name, unit, quantity, buying_price, selling_price')
          .eq('shop_id', shop.id).eq('is_active', true).order('name'),
        20_000
      )
      setProducts((data || []) as Product[])
    } catch {
      // silencieux — la sélection de produits rouvre juste vide
    }
  }

  useEffect(() => { fetchTransfers(); fetchProducts() }, [shop?.id])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchTransfers(); fetchProducts() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [shop?.id])
  useRefetchOnReconnect(() => { fetchTransfers(); fetchProducts() }, isOnline)

  const shopName = (id: string) => userShops.find(s => s.id === id)?.name ?? '—'

  const filteredTransfers = transfers.filter(tr => {
    if (!search) return true
    const q = normalize(search)
    return normalize(tr.reference || '').includes(q)
      || normalize(tr.source_shop_name || '').includes(q)
      || normalize(tr.destination_shop_name || '').includes(q)
  })

  const destShopOptions = userShops.filter(s => s.id !== shop?.id)

  // ── Nouveau transfert ────────────────────────────────────────────────────
  const openNewTransfer = () => {
    setNewDestShopId('')
    setNewProductSearch('')
    setNewItems([])
    setNewNotes('')
    setLastCreatedRef(null)
    setShowNewDialog(true)
  }

  const addNewItem = (p: Product) => {
    if (newItems.some(it => it.product_id === p.id)) return
    setNewItems(prev => [...prev, { product_id: p.id, name: p.name, unit: p.unit || '', available: p.quantity, quantity: '1' }])
    setNewProductSearch('')
  }

  const removeNewItem = (productId: string) => {
    setNewItems(prev => prev.filter(it => it.product_id !== productId))
  }

  const newProductResults = newProductSearch.trim()
    ? products.filter(p => !newItems.some(it => it.product_id === p.id) && normalize(p.name).includes(normalize(newProductSearch)))
    : []

  const submitNewTransfer = async () => {
    if (!shop?.id || !newDestShopId) return
    const items = newItems
      .filter(it => Number(it.quantity) > 0)
      .map(it => ({ product_id: it.product_id, quantity: Number(it.quantity) }))
    if (items.length === 0) {
      toast({ title: t('transfers.select_at_least_one_product'), variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await withTimeout(fetch('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_shop_id: shop.id, destination_shop_id: newDestShopId, notes: newNotes.trim() || null, items }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setLastCreatedRef(json.data?.reference || null)
      toast({ title: t('transfers.created_toast', { reference: json.data?.reference || '' }), variant: 'success' })
      fetchTransfers()
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // ── Réception ────────────────────────────────────────────────────────────
  const openReceive = (tr: any) => {
    const lines: typeof receiveLines = {}
    for (const item of (tr.stock_transfer_items || [])) {
      const match = products.find(p => normalize(p.name) === normalize(item.product_name))
      lines[item.id] = {
        destination_product_id: match?.id ?? null,
        matchSearch: match?.name ?? item.product_name,
        quantity_received: String(item.quantity_sent),
        discrepancy_category: '',
        discrepancy_detail: '',
      }
    }
    setReceiveLines(lines)
    setReceivingTransfer(tr)
  }

  const updateReceiveLine = (itemId: string, updates: Partial<(typeof receiveLines)[string]>) => {
    setReceiveLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...updates } }))
  }

  const submitReceive = async () => {
    if (!receivingTransfer || !shop?.id) return
    const items = (receivingTransfer.stock_transfer_items || []).map((item: any) => {
      const line = receiveLines[item.id]
      const received = Number(line?.quantity_received) || 0
      const hasDiscrepancy = received !== item.quantity_sent
      return {
        transfer_item_id: item.id,
        destination_product_id: line?.destination_product_id || null,
        quantity_received: received,
        discrepancy_category: hasDiscrepancy ? (line?.discrepancy_category || 'other') : null,
        discrepancy_detail: hasDiscrepancy ? (line?.discrepancy_detail || null) : null,
      }
    })
    setReceiving(true)
    try {
      const res = await withTimeout(fetch('/api/stock-transfers/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id: receivingTransfer.id, destination_shop_id: shop.id, items }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('transfers.received_toast'), variant: 'success' })
      setReceivingTransfer(null)
      fetchTransfers()
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setReceiving(false)
    }
  }

  // ── Annulation ───────────────────────────────────────────────────────────
  const cancelTransfer = async (tr: any) => {
    if (!shop?.id) return
    if (!confirm(t('transfers.confirm_cancel', { reference: tr.reference }))) return
    setCancelling(tr.id)
    try {
      const res = await fetch('/api/stock-transfers/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfer_id: tr.id, source_shop_id: shop.id }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('transfers.cancelled_toast') })
      fetchTransfers()
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setCancelling(null)
    }
  }

  // ── PDF / email ──────────────────────────────────────────────────────────
  const downloadTransferPdf = async (tr: any) => {
    await generateStockTransferPDF({
      sourceShopName: tr.source_shop_name || shopName(tr.source_shop_id),
      destinationShopName: tr.destination_shop_name || shopName(tr.destination_shop_id),
      reference: tr.reference,
      dateStr: new Date(tr.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      notes: tr.notes,
      items: (tr.stock_transfer_items || []).map((it: any) => ({ name: it.product_name, quantity: it.quantity_sent, unit: it.unit || '' })),
    })
  }

  const buildTransferEmailContent = (tr: any) => {
    const items = tr.stock_transfer_items || []
    const subject = `Bon de transfert ${tr.reference} — ${tr.source_shop_name} → ${tr.destination_shop_name}`
    const lines = items.map((it: any) => `- ${it.product_name} : ${it.quantity_sent} ${it.unit || ''}`.trim())
    const body = [
      `Bonjour,`,
      '',
      `Veuillez trouver ci-joint le bon de transfert ${tr.reference} de ${tr.source_shop_name} vers ${tr.destination_shop_name}.`,
      '',
      'Produits envoyés :',
      ...lines,
      '',
      tr.notes ? `Notes : ${tr.notes}` : '',
      '',
      'Cordialement,',
      tr.source_shop_name || 'StockShop',
    ].filter(Boolean).join('\n')
    return { subject, body }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: t('suppliers.po_copied', { label }), variant: 'success' })
    } catch {
      toast({ title: t('toast.error'), variant: 'destructive' })
    }
  }

  if (!shop) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setFilter({ search: e.target.value })}
            placeholder={t('transfers.search_placeholder')}
            className="pl-9 h-9"
          />
        </div>
        {canManage && destShopOptions.length > 0 && (
          <Button variant="stockshop" size="sm" className="h-9 gap-1" onClick={openNewTransfer}>
            <Plus className="h-4 w-4" />{t('transfers.new_transfer')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : filteredTransfers.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm text-center px-6">
          {transfers.length === 0 ? t('transfers.no_transfers') : t('transfers.no_search_results')}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTransfers.map(tr => {
            const isSource = tr.source_shop_id === shop.id
            const isDestination = tr.destination_shop_id === shop.id
            const itemCount = (tr.stock_transfer_items || []).length
            return (
              <div key={tr.id} className="rounded-lg border bg-card shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{tr.reference}</p>
                      <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${STATUS_STYLES[tr.status] || ''}`}>
                        {t(`transfers.status_${tr.status}`)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                      <span className={isSource ? 'font-medium text-foreground' : ''}>{tr.source_shop_name || shopName(tr.source_shop_id)}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className={isDestination ? 'font-medium text-foreground' : ''}>{tr.destination_shop_name || shopName(tr.destination_shop_id)}</span>
                      <span>· {t('transfers.items_count', { count: itemCount })}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      {new Date(tr.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => downloadTransferPdf(tr)}>
                      {isCapacitor() ? <Share2 className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                      {isCapacitor() ? t('actions.share') : t('transfers.download_pdf')}
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailTransfer(tr)}>
                      <Mail className="h-3 w-3" />{t('suppliers.po_email_helper')}
                    </Button>
                    {tr.status === 'sent' && isDestination && canManage && (
                      <Button variant="stockshop" size="sm" className="h-7 gap-1 text-xs" onClick={() => openReceive(tr)}>
                        <CheckCircle2 className="h-3 w-3" />{t('transfers.receive_button')}
                      </Button>
                    )}
                    {tr.status === 'sent' && isSource && canManage && (
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1 text-xs text-destructive hover:bg-red-50 dark:hover:bg-red-950/40"
                        loading={cancelling === tr.id}
                        onClick={() => cancelTransfer(tr)}
                      >
                        <Ban className="h-3 w-3" />{t('actions.cancel')}
                      </Button>
                    )}
                  </div>
                </div>

                {tr.status !== 'sent' && itemCount > 0 && (
                  <div className="mt-2 pt-2 border-t divide-y divide-border/50">
                    {(tr.stock_transfer_items || []).map((it: any) => {
                      const hasDiscrepancy = it.quantity_received != null && it.quantity_received !== it.quantity_sent
                      return (
                        <div key={it.id} className="flex items-center justify-between py-1.5 text-xs gap-2">
                          <span className="truncate">{it.product_name}</span>
                          <span className={`shrink-0 ${hasDiscrepancy ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                            {it.quantity_received != null ? `${it.quantity_received} / ${it.quantity_sent}` : `${it.quantity_sent}`} {it.unit || ''}
                            {hasDiscrepancy && it.discrepancy_category && ` · ${t(`transfers.discrepancy_${it.discrepancy_category}`)}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Nouveau transfert ─────────────────────────────────────────────── */}
      <PremiumDialog
        open={showNewDialog}
        onOpenChange={open => { if (!open) setShowNewDialog(false) }}
        category={t('transfers.nav_label')}
        title={t('transfers.new_transfer')}
        icon={<Package className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        <PremiumDialogBody>
          {lastCreatedRef ? (
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
              <p className="text-sm text-muted-foreground">{t('transfers.created_success_hint')}</p>
              <p className="text-lg font-bold">{lastCreatedRef}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t('transfers.destination_shop_label')} *</Label>
                <Select value={newDestShopId} onValueChange={setNewDestShopId}>
                  <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    {destShopOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 mt-3">
                <Label>{t('transfers.add_products_label')}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={newProductSearch}
                    onChange={e => setNewProductSearch(e.target.value)}
                    placeholder={t('transfers.search_own_product_placeholder')}
                    className="pl-9 h-9"
                  />
                </div>
                {newProductResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                    {newProductResults.slice(0, 20).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addNewItem(p)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{t('transfers.available_short')}: {p.quantity}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {newItems.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {newItems.map(it => (
                    <div key={it.product_id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{it.name}</p>
                        <p className="text-[11px] text-muted-foreground">{t('transfers.available_short')}: {it.available} {it.unit}</p>
                      </div>
                      <Input
                        type="number" min={1} max={it.available} inputMode="numeric"
                        value={it.quantity}
                        onChange={e => setNewItems(prev => prev.map(x => x.product_id === it.product_id ? { ...x, quantity: e.target.value } : x))}
                        className="w-16 h-8 text-center text-xs flex-shrink-0"
                      />
                      <button
                        type="button"
                        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors shrink-0"
                        onClick={() => removeNewItem(it.product_id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 mt-3">
                <Label>{t('transfers.notes_label')}</Label>
                <textarea
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                />
              </div>
            </>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setShowNewDialog(false)}
          cancelLabel={lastCreatedRef ? t('actions.close') : t('actions.cancel')}
          {...(lastCreatedRef ? {} : {
            onConfirm: submitNewTransfer,
            confirmLabel: t('transfers.send_button'),
            confirmLoading: creating,
            confirmDisabled: !newDestShopId || newItems.length === 0,
          })}
        />
      </PremiumDialog>

      {/* ── Réception ─────────────────────────────────────────────────────── */}
      <PremiumDialog
        open={!!receivingTransfer}
        onOpenChange={open => { if (!open) setReceivingTransfer(null) }}
        category={t('transfers.nav_label')}
        title={t('transfers.receive_title')}
        icon={<CheckCircle2 className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {receivingTransfer && (
          <>
            <PremiumDialogBody>
              <p className="text-xs text-muted-foreground">{t('transfers.receive_hint')}</p>
              <div className="mt-3 space-y-3">
                {(receivingTransfer.stock_transfer_items || []).map((item: any) => {
                  const line = receiveLines[item.id]
                  if (!line) return null
                  const received = Number(line.quantity_received)
                  const hasDiscrepancy = !isNaN(received) && received !== item.quantity_sent
                  const matchResults = line.matchSearch.trim()
                    ? products.filter(p => normalize(p.name).includes(normalize(line.matchSearch)))
                    : []
                  const matchedProduct = products.find(p => p.id === line.destination_product_id)
                  return (
                    <div key={item.id} className="rounded-lg border px-2.5 py-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{item.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">{t('transfers.sent_label')}: {item.quantity_sent} {item.unit || ''}</p>
                        </div>
                        <Input
                          type="number" min={0} inputMode="numeric"
                          value={line.quantity_received}
                          onChange={e => updateReceiveLine(item.id, { quantity_received: e.target.value })}
                          className="w-20 h-9 text-center flex-shrink-0"
                        />
                      </div>

                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">{t('transfers.match_product_label')}</p>
                        {matchedProduct ? (
                          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                            <span className="text-xs truncate">{matchedProduct.name}</span>
                            <button
                              type="button"
                              className="text-[11px] text-stockshop-blue dark:text-blue-400 hover:underline shrink-0"
                              onClick={() => updateReceiveLine(item.id, { destination_product_id: null, matchSearch: '' })}
                            >
                              {t('transfers.change_match')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <Input
                              value={line.matchSearch}
                              onChange={e => updateReceiveLine(item.id, { matchSearch: e.target.value })}
                              placeholder={t('transfers.search_own_product_placeholder')}
                              className="h-8 text-xs"
                            />
                            {matchResults.length > 0 && (
                              <div className="max-h-28 overflow-y-auto rounded-md border divide-y">
                                {matchResults.slice(0, 8).map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => updateReceiveLine(item.id, { destination_product_id: p.id, matchSearch: p.name })}
                                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent transition-colors truncate"
                                  >
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            {line.matchSearch.trim() && (
                              <p className="text-[11px] text-muted-foreground">{t('transfers.no_match_will_create')}</p>
                            )}
                          </>
                        )}
                      </div>

                      {hasDiscrepancy && (
                        <div className="space-y-1.5 pt-1 border-t">
                          <Select value={line.discrepancy_category} onValueChange={v => updateReceiveLine(item.id, { discrepancy_category: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('transfers.discrepancy_category_placeholder')} /></SelectTrigger>
                            <SelectContent>
                              {DISCREPANCY_CATEGORIES.map(cat => (
                                <SelectItem key={cat} value={cat}>{t(`transfers.discrepancy_${cat}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={line.discrepancy_detail}
                            onChange={e => updateReceiveLine(item.id, { discrepancy_detail: e.target.value })}
                            placeholder={t('transfers.discrepancy_detail_placeholder')}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter
              onCancel={() => setReceivingTransfer(null)}
              cancelLabel={t('actions.cancel')}
              onConfirm={submitReceive}
              confirmLabel={t('actions.save')}
              confirmLoading={receiving}
            />
          </>
        )}
      </PremiumDialog>

      {/* ── Email ─────────────────────────────────────────────────────────── */}
      <PremiumDialog
        open={!!emailTransfer}
        onOpenChange={open => { if (!open) setEmailTransfer(null) }}
        category={t('transfers.nav_label')}
        title={t('suppliers.po_email_helper')}
        icon={<Mail className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {emailTransfer && (() => {
          const { subject, body } = buildTransferEmailContent(emailTransfer)
          const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
          return (
            <>
              <PremiumDialogBody>
                <p className="text-xs text-muted-foreground">
                  {isCapacitor() ? t('suppliers.po_email_hint_mobile') : t('suppliers.po_email_hint')}
                </p>

                <div className="space-y-1.5 mt-3">
                  <div className="flex items-center justify-between">
                    <Label>{t('suppliers.po_email_subject')}</Label>
                    <button className="flex items-center gap-1 text-xs text-stockshop-blue dark:text-blue-400 hover:underline" onClick={() => copyToClipboard(subject, t('suppliers.po_email_subject'))}>
                      <Copy className="h-3 w-3" />{t('suppliers.po_copy')}
                    </button>
                  </div>
                  <Input readOnly value={subject} onFocus={e => e.target.select()} />
                </div>

                <div className="space-y-1.5 mt-3">
                  <div className="flex items-center justify-between">
                    <Label>{t('suppliers.po_email_body')}</Label>
                    <button className="flex items-center gap-1 text-xs text-stockshop-blue dark:text-blue-400 hover:underline" onClick={() => copyToClipboard(body, t('suppliers.po_email_body'))}>
                      <Copy className="h-3 w-3" />{t('suppliers.po_copy')}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={body}
                    onFocus={e => e.target.select()}
                    rows={10}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
              </PremiumDialogBody>
              <PremiumDialogFooter onCancel={() => setEmailTransfer(null)} cancelLabel={t('actions.cancel')}>
                <Button variant="stockshop" className="flex-1 h-11 rounded-xl font-semibold min-w-0 px-2" asChild>
                  <a href={mailtoHref} className="min-w-0">
                    <Mail className="h-4 w-4 mr-1.5 flex-shrink-0" /><span className="truncate text-[13px] sm:text-sm">{t('suppliers.po_open_mail_app')}</span>
                  </a>
                </Button>
              </PremiumDialogFooter>
            </>
          )
        })()}
      </PremiumDialog>
    </div>
  )
}
