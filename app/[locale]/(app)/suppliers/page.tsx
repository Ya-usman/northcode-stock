'use client'

import { useState, useEffect, useMemo } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Package, Store, ChevronDown, ChevronRight, X, ArrowRightLeft, FileText, Download, Send, CheckCircle2, Ban, Mail, Copy, Share2, History, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react'
import { isCapacitor } from '@/lib/utils/native-share'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatInputValue } from '@/lib/utils/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { supplierSchema, type SupplierFormData } from '@/lib/validations/customer'
import type { Supplier, Product, PurchaseOrder } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { generatePurchaseOrderPDF } from '@/lib/utils/pdf'
import { withTimeout } from '@/lib/utils/with-timeout'

const PO_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-50 dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400',
  received: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400',
  partial: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  cancelled: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
}

function SupplierCard({ supplier, products, productCount, expandedId, setExpandedId, canManage, setEditingSupplier, form, setShowModal, deleteSupplier, onOpenJournal, t, fmt }: any) {
  const isExpanded = expandedId === supplier.id
  const supplierProducts = products.filter((p: any) => p.supplier_id === supplier.id)
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpandedId(isExpanded ? null : supplier.id)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{supplier.name}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {supplier.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />{supplier.phone}
              </span>
            )}
            {supplier.city && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{supplier.city}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Package className="h-3 w-3" />{t('suppliers.products_count', { count: productCount })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            role="button"
            className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={t('suppliers.po_journal_button')}
            onClick={(e: any) => { e.stopPropagation(); onOpenJournal(supplier) }}
          >
            <History className="h-3.5 w-3.5" />
          </span>
          {canManage && (
            <>
              <span
                role="button"
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
                onClick={(e: any) => { e.stopPropagation(); setEditingSupplier(supplier); form.reset({ name: supplier.name, phone: supplier.phone || '', city: supplier.city || '', email: supplier.email || '' }); setShowModal(true) }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </span>
              <span
                role="button"
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                onClick={(e: any) => { e.stopPropagation(); deleteSupplier(supplier) }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            </>
          )}
          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t bg-muted/10">
          {supplierProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.no_products_for_supplier')}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {supplierProducts.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground">{p.quantity} {p.unit}</span>
                    <span className="text-sm font-semibold text-stockshop-blue dark:text-blue-400">
                      {fmt(p.selling_price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SuppliersPage() {
  const t = useTranslations()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const { isOnline } = useOffline()
  const { fmt, symbol } = useCurrency()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient() as any
  const { toast } = useToast()

  const effectiveRole = roleInActiveShop ?? profile?.role
  const canManage = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin'].includes(effectiveRole || '')

  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const c = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(`suppliers_${effectiveShopIds.join(',')}`)
    return c?.suppliers || []
  })
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(`suppliers_${effectiveShopIds.join(',')}`)
    return c?.products || []
  })
  const [loading, setLoading] = useState(() => !getPageCache(`suppliers_${effectiveShopIds.join(',')}`))
  const [{ search }, setFilter] = usePersistedFilters('suppliers', shop?.id, { search: '' })
  const [showModal, setShowModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [journalSupplier, setJournalSupplier] = useState<Supplier | null>(null)

  // ── Comparateur de prix par produit ─────────────────────────────────────
  const [view, setView] = useState<'suppliers' | 'by_product' | 'purchase_orders'>('suppliers')
  const [productSearch, setProductSearch] = useState('')
  const [productPrices, setProductPrices] = useState<{ id: string; product_id: string; supplier_id: string; price: number }[]>([])
  const [addPriceProduct, setAddPriceProduct] = useState<Product | null>(null)
  const [addPriceSupplierId, setAddPriceSupplierId] = useState('')
  const [addPriceValue, setAddPriceValue] = useState('')
  const [savingPrice, setSavingPrice] = useState(false)

  // ── Bons de commande ─────────────────────────────────────────────────────
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([])
  const [showPoDialog, setShowPoDialog] = useState(false)
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poShowAll, setPoShowAll] = useState(false)
  const [poChecked, setPoChecked] = useState<Record<string, boolean>>({})
  const [poQuantities, setPoQuantities] = useState<Record<string, string>>({})
  const [creatingPo, setCreatingPo] = useState(false)
  const [poActionLoading, setPoActionLoading] = useState<string | null>(null)
  const [emailPo, setEmailPo] = useState<any | null>(null)
  const [receivingPo, setReceivingPo] = useState<any | null>(null)
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({})
  const [receiveExpiryDates, setReceiveExpiryDates] = useState<Record<string, string>>({})
  const [receiveNotes, setReceiveNotes] = useState<Record<string, string>>({})
  const [receivePaymentStatus, setReceivePaymentStatus] = useState<'paid' | 'partial' | 'credit'>('credit')
  const [receivePaymentAmount, setReceivePaymentAmount] = useState('')
  const [receivePaymentMethod, setReceivePaymentMethod] = useState('cash')
  const [receivingLoading, setReceivingLoading] = useState(false)
  const [{ search: poSearch, status: poStatusFilter, dateFrom: poDateFrom, dateTo: poDateTo }, setPoFilter] = usePersistedFilters(
    'purchase_orders', shop?.id, { search: '', status: '', dateFrom: '', dateTo: '' }
  )
  const [journalPo, setJournalPo] = useState<any | null>(null)
  const [poExpandedId, setPoExpandedId] = useState<string | null>(null)
  const [editingPo, setEditingPo] = useState<any | null>(null)
  const [editItems, setEditItems] = useState<{ id?: string; product_id: string | null; product_name: string; unit: string | null; quantity_ordered: string; unit_price: string }[]>([])
  const [savingEditPo, setSavingEditPo] = useState(false)
  const [reorderPo, setReorderPo] = useState<any | null>(null)
  const [reorderItems, setReorderItems] = useState<{ product_id: string | null; product_name: string; unit: string | null; quantity_ordered: string; unit_price: string }[]>([])
  const [creatingReorder, setCreatingReorder] = useState(false)
  const [deletePoConfirm, setDeletePoConfirm] = useState<any | null>(null)
  const [deletingPo, setDeletingPo] = useState(false)

  const form = useForm<SupplierFormData>({ resolver: zodResolver(supplierSchema) })

  const fetchSuppliers = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `suppliers_${effectiveShopIds.join(',')}`
    const cached = getPageCache<{ suppliers: Supplier[]; products: Product[] }>(cacheKey)
    if (cached) { setSuppliers(cached.suppliers); setProducts(cached.products); setLoading(false) }
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const [suppliersRes, productsRes] = await withTimeout(Promise.all([
        supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('products').select('id, name, selling_price, buying_price, quantity, unit, supplier_id, shop_id').in('shop_id', effectiveShopIds).eq('is_active', true),
      ]), 20_000, 'Chargement des fournisseurs trop lent — réessayez.')
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — check explicitly so the catch below preserves the cache
      // already on screen instead of zeroing it out.
      if (suppliersRes.error || productsRes.error) throw suppliersRes.error || productsRes.error
      const { data: supplierData } = suppliersRes, { data: productData } = productsRes
      const fetchedSuppliers = (supplierData || []) as Supplier[]
      const fetchedProducts = (productData || []) as unknown as Product[]
      setSuppliers(fetchedSuppliers)
      setProducts(fetchedProducts)
      setPageCache(cacheKey, { suppliers: fetchedSuppliers, products: fetchedProducts })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  const fetchProductPrices = async () => {
    if (!shop?.id) return
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave a hung request retried forever.
      const res = await withTimeout(fetch(`/api/product-supplier-prices?shop_id=${shop.id}`), 20_000)
      if (!res.ok) return
      const json = await res.json()
      setProductPrices(json.data || [])
    } catch {
      // silencieux — comparaison purement informative
    }
  }

  const fetchPurchaseOrders = async () => {
    if (!shop?.id) return
    try {
      const res = await withTimeout(fetch(`/api/purchase-orders?shop_id=${shop.id}`), 20_000)
      if (!res.ok) return
      const json = await res.json()
      setPurchaseOrders(json.data || [])
    } catch {
      // silencieux
    }
  }

  useEffect(() => { fetchSuppliers(); fetchProductPrices(); fetchPurchaseOrders() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches suppliers/prices/
  // bons de commande ajoutés ou modifiés par un autre membre de l'équipe.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchSuppliers(); fetchProductPrices(); fetchPurchaseOrders() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [effectiveShopIds.join(',')])
  useRefetchOnReconnect(() => { fetchSuppliers(); fetchProductPrices(); fetchPurchaseOrders() }, isOnline)

  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of products) {
      if ((p as any).supplier_id) counts[(p as any).supplier_id] = (counts[(p as any).supplier_id] || 0) + 1
    }
    return counts
  }, [products])

  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = normalize(search)
    return normalize(s.name).includes(q) || normalize(s.city ?? '').includes(q)
  })

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? '—'

  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter((po: any) => {
      if (poSearch.trim()) {
        const q = normalize(poSearch)
        const supplier = po.suppliers?.name || supplierName(po.supplier_id) || ''
        if (!normalize(po.reference || '').includes(q) && !normalize(supplier).includes(q)) return false
      }
      if (poStatusFilter && po.status !== poStatusFilter) return false
      if (poDateFrom && po.created_at < poDateFrom) return false
      if (poDateTo && po.created_at.slice(0, 10) > poDateTo) return false
      return true
    })
  }, [purchaseOrders, poSearch, poStatusFilter, poDateFrom, poDateTo])

  const onSubmit = async (data: SupplierFormData) => {
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/suppliers', {
        method: editingSupplier ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, id: editingSupplier?.id, shop_id: shop!.id }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: editingSupplier ? t('toast.supplier_updated') : t('toast.supplier_added'), variant: 'success' })
      setShowModal(false)
      setEditingSupplier(null)
      form.reset({ name: '', phone: '', city: '', email: '' })
      fetchSuppliers()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteSupplier = async (s: Supplier) => {
    if (productCounts[s.id] > 0) {
      toast({ title: t('toast.supplier_has_products', { name: s.name, count: productCounts[s.id] }), variant: 'destructive' })
      return
    }
    if (!confirm(t('confirm.delete_supplier'))) return
    const res = await fetch(`/api/suppliers?id=${s.id}&shop_id=${s.shop_id}`, { method: 'DELETE' })
    if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.supplier_deleted') })
    fetchSuppliers()
  }

  const filteredProducts = productSearch.trim()
    ? products.filter(p => normalize(p.name).includes(normalize(productSearch)))
    : []

  const openAddPrice = (product: Product) => {
    setAddPriceProduct(product)
    setAddPriceSupplierId('')
    setAddPriceValue('')
  }

  const submitAddPrice = async () => {
    if (!addPriceProduct || !addPriceSupplierId || !shop?.id) return
    setSavingPrice(true)
    try {
      const res = await fetch('/api/product-supplier-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: addPriceProduct.shop_id,
          product_id: addPriceProduct.id,
          supplier_id: addPriceSupplierId,
          price: Number(addPriceValue),
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setAddPriceProduct(null)
      fetchProductPrices()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSavingPrice(false)
    }
  }

  const deletePrice = async (entryId: string) => {
    if (!shop?.id) return
    const res = await fetch(`/api/product-supplier-prices?id=${entryId}&shop_id=${shop.id}`, { method: 'DELETE' })
    if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    fetchProductPrices()
  }

  const usePrice = async (product: Product, supplierId: string, price: number) => {
    // Preserve the outgoing supplier's price before switching — it only ever
    // lived in product.buying_price, so overwriting it without saving it
    // first would silently erase that supplier from the comparator.
    const oldSupplierId = (product as any).supplier_id as string | null
    const oldPrice = Number((product as any).buying_price || 0)
    if (oldSupplierId && oldSupplierId !== supplierId && oldPrice > 0) {
      await fetch('/api/product-supplier-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: product.shop_id, product_id: product.id, supplier_id: oldSupplierId, price: oldPrice }),
      })
    }

    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: product.id, shop_id: product.shop_id, supplier_id: supplierId, buying_price: price }),
    })
    const json = await res.json()
    if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
    toast({ title: t('toast.supplier_updated'), variant: 'success' })
    fetchSuppliers()
    fetchProductPrices()
  }

  // ── Bons de commande ─────────────────────────────────────────────────────
  const lowStockThreshold = (p: any) => p.low_stock_threshold || shop?.low_stock_threshold || 10
  const isLowOrOut = (p: any) => p.quantity === 0 || p.quantity <= lowStockThreshold(p)
  const priceFor = (product: any, supplierId: string) =>
    productPrices.find(e => e.product_id === product.id && e.supplier_id === supplierId)?.price ?? Number(product.buying_price || 0)

  const poSupplierProducts = products.filter((p: any) => p.supplier_id === poSupplierId)
  const poVisibleProducts = poShowAll ? poSupplierProducts : poSupplierProducts.filter(isLowOrOut)

  const openCreatePo = () => {
    setPoSupplierId('')
    setPoShowAll(false)
    setPoChecked({})
    setPoQuantities({})
    setShowPoDialog(true)
  }

  const onPoSupplierChange = (supplierId: string) => {
    setPoSupplierId(supplierId)
    const supplierProducts = products.filter((p: any) => p.supplier_id === supplierId)
    const checked: Record<string, boolean> = {}
    const quantities: Record<string, string> = {}
    supplierProducts.filter(isLowOrOut).forEach((p: any) => {
      checked[p.id] = true
      const threshold = lowStockThreshold(p)
      quantities[p.id] = String(Math.max(threshold * 2 - p.quantity, threshold))
    })
    setPoChecked(checked)
    setPoQuantities(quantities)
  }

  const submitCreatePo = async () => {
    if (!shop?.id || !poSupplierId) return
    const items = poVisibleProducts
      .filter((p: any) => poChecked[p.id])
      .map((p: any) => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        quantity_ordered: Number(poQuantities[p.id]) || 1,
        unit_price: priceFor(p, poSupplierId),
      }))
    if (items.length === 0) {
      toast({ title: 'Sélectionnez au moins un produit', variant: 'destructive' })
      return
    }
    setCreatingPo(true)
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, supplier_id: poSupplierId, items }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('suppliers.po_created'), variant: 'success' })
      setShowPoDialog(false)
      fetchPurchaseOrders()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setCreatingPo(false)
    }
  }

  const updatePoStatus = async (po: any, status: string) => {
    if (!shop?.id) return
    setPoActionLoading(po.id)
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: po.id, shop_id: shop.id, status }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      fetchPurchaseOrders()
    } finally {
      setPoActionLoading(null)
    }
  }

  const openReceivePo = (po: any) => {
    const quantities: Record<string, string> = {}
    for (const it of po.purchase_order_items || []) {
      quantities[it.id] = String(it.quantity_ordered)
    }
    setReceiveQuantities(quantities)
    setReceiveExpiryDates({})
    setReceiveNotes({})
    setReceivePaymentStatus('credit')
    setReceivePaymentAmount('')
    setReceivePaymentMethod('cash')
    setReceivingPo(po)
  }

  // Total de ce qui sera effectivement reçu — sert à la fois d'affichage et
  // à préremplir/valider le montant payé à la réception.
  const receiveTotal = (receivingPo?.purchase_order_items || []).reduce((s: number, it: any) =>
    s + (it.unit_price || 0) * (Number(receiveQuantities[it.id]) || 0), 0)

  const submitReceivePo = async () => {
    if (!shop?.id || !receivingPo) return
    setReceivingLoading(true)
    try {
      const items = (receivingPo.purchase_order_items || []).map((it: any) => ({
        item_id: it.id,
        product_id: it.product_id,
        quantity_received: Number(receiveQuantities[it.id]) || 0,
        unit_price: it.unit_price,
        expiry_date: receiveExpiryDates[it.id] || null,
        receipt_note: receiveNotes[it.id] || null,
      }))
      const paymentAmount = receivePaymentStatus === 'paid'
        ? receiveTotal
        : receivePaymentStatus === 'partial'
          ? Number(receivePaymentAmount) || 0
          : 0
      const res = await fetch('/api/purchase-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          purchase_order_id: receivingPo.id,
          items,
          payment_amount: paymentAmount > 0 ? paymentAmount : null,
          payment_method: paymentAmount > 0 ? receivePaymentMethod : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('suppliers.po_received_success'), variant: 'success' })
      setReceivingPo(null)
      fetchPurchaseOrders()
      fetchSuppliers()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setReceivingLoading(false)
    }
  }

  const confirmDeletePo = async () => {
    if (!shop?.id || !deletePoConfirm) return
    setDeletingPo(true)
    try {
      const res = await fetch(`/api/purchase-orders?id=${deletePoConfirm.id}&shop_id=${shop.id}`, { method: 'DELETE' })
      if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setDeletePoConfirm(null)
      fetchPurchaseOrders()
    } finally {
      setDeletingPo(false)
    }
  }

  const openEditPo = (po: any) => {
    setEditItems((po.purchase_order_items || []).map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      product_name: it.product_name,
      unit: it.unit,
      quantity_ordered: String(it.quantity_ordered),
      unit_price: it.unit_price != null ? String(it.unit_price) : '',
    })))
    setEditingPo(po)
  }

  const submitEditPo = async () => {
    if (!shop?.id || !editingPo) return
    if (editItems.length === 0) {
      toast({ title: 'Le bon doit contenir au moins un produit', variant: 'destructive' })
      return
    }
    setSavingEditPo(true)
    try {
      const items = editItems.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        unit: it.unit,
        quantity_ordered: Number(it.quantity_ordered) || 1,
        unit_price: it.unit_price ? Number(it.unit_price) : null,
      }))
      const res = await fetch('/api/purchase-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingPo.id, shop_id: shop.id, items }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setEditingPo(null)
      fetchPurchaseOrders()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setSavingEditPo(false)
    }
  }

  const openReorderPo = (po: any) => {
    const shortfall = (po.purchase_order_items || [])
      .map((it: any) => ({ ...it, missing: it.quantity_ordered - (it.quantity_received ?? 0) }))
      .filter((it: any) => it.missing > 0)
    setReorderItems(shortfall.map((it: any) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      unit: it.unit,
      quantity_ordered: String(it.missing),
      unit_price: it.unit_price != null ? String(it.unit_price) : '',
    })))
    setReorderPo(po)
  }

  const submitReorder = async () => {
    if (!shop?.id || !reorderPo || reorderItems.length === 0) return
    setCreatingReorder(true)
    try {
      const items = reorderItems.map(it => ({
        product_id: it.product_id,
        product_name: it.product_name,
        unit: it.unit,
        quantity_ordered: Number(it.quantity_ordered) || 1,
        unit_price: it.unit_price ? Number(it.unit_price) : null,
      }))
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          supplier_id: reorderPo.supplier_id,
          items,
          // Marqueur machine (pas affiché tel quel) — garde le lien vers le
          // bon d'origine pour que l'email généré plus tard sache adapter
          // son objet/corps (voir buildPoEmailContent).
          notes: `[reorder:${reorderPo.reference}]`,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('suppliers.po_created'), variant: 'success' })
      setReorderPo(null)
      fetchPurchaseOrders()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur, réessayez', variant: 'destructive' })
    } finally {
      setCreatingReorder(false)
    }
  }

  const downloadPoPdf = async (po: any) => {
    const items = (po.purchase_order_items || [])
    await generatePurchaseOrderPDF({
      shopName: shop?.name || 'StockShop',
      reference: po.reference,
      dateStr: new Date(po.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      supplierName: po.suppliers?.name || supplierName(po.supplier_id),
      supplierPhone: po.suppliers?.phone,
      supplierCity: po.suppliers?.city,
      items: items.map((it: any) => ({
        name: it.product_name,
        quantity: it.quantity_ordered,
        unit: it.unit || '',
        unitPriceLabel: it.unit_price != null ? fmt(it.unit_price) : '—',
        totalLabel: it.unit_price != null ? fmt(it.unit_price * it.quantity_ordered) : '—',
      })),
      totalLabel: fmt(items.reduce((s: number, it: any) => s + (it.unit_price || 0) * it.quantity_ordered, 0)),
    })
  }

  const buildPoEmailContent = (po: any) => {
    const items = po.purchase_order_items || []
    const supplier = po.suppliers?.name || supplierName(po.supplier_id)
    const dateStr = new Date(po.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    // Bon créé via "Commander le reste" (voir submitReorder) — garde le
    // lien vers le bon d'origine dans notes pour adapter l'objet/le corps.
    const reorderOriginalRef = po.notes?.match(/^\[reorder:(.+?)\]/)?.[1] as string | undefined
    const subject = reorderOriginalRef
      ? `Complément au bon ${reorderOriginalRef} — solde manquant (${po.reference}) — ${shop?.name || 'StockShop'}`
      : `Bon de commande ${po.reference} — ${shop?.name || 'StockShop'}`
    const lines = items.map((it: any) => `- ${it.product_name} : ${it.quantity_ordered} ${it.unit || ''}`.trim())
    const intro = reorderOriginalRef
      ? `Suite à la livraison partielle de notre bon de commande ${reorderOriginalRef}, veuillez trouver ci-joint le bon ${po.reference} du ${dateStr} pour le solde manquant.`
      : `Veuillez trouver ci-joint notre bon de commande ${po.reference} du ${dateStr}.`
    const body = [
      `Bonjour ${supplier},`,
      '',
      intro,
      '',
      'Produits commandés :',
      ...lines,
      '',
      'Merci de nous confirmer la réception de cette commande.',
      '',
      'Cordialement,',
      shop?.name || 'StockShop',
    ].join('\n')
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

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setView('suppliers')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === 'suppliers' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('suppliers.tab_suppliers')}
        </button>
        <button
          onClick={() => setView('by_product')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'by_product' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" /> {t('suppliers.tab_by_product')}
        </button>
        <button
          onClick={() => setView('purchase_orders')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'purchase_orders' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <FileText className="h-3.5 w-3.5" /> {t('suppliers.tab_purchase_orders')}
        </button>
      </div>

      {view === 'suppliers' && (
      <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('suppliers.search_placeholder')} className="pl-9 h-9" />
        </div>
        {canManage && (
          <Button
            variant="stockshop"
            className="h-9 gap-1"
            size="sm"
            onClick={() => { form.reset({ name: '', phone: '', city: '', email: '' }); setEditingSupplier(null); setShowModal(true) }}
          >
            <Plus className="h-4 w-4" />
            {t('suppliers.add_supplier')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
          {t('suppliers.no_suppliers')}
        </div>
      ) : isMultiShop ? (
        <div className="space-y-4">
          {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopSuppliers = filtered.filter(s => s.shop_id === shopEntry.id)
            if (!shopSuppliers.length) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopSuppliers.map(supplier => (
                  <SupplierCard key={supplier.id} supplier={supplier} products={products} productCount={productCounts[supplier.id] || 0}
                    expandedId={expandedId} setExpandedId={setExpandedId} canManage={canManage}
                    setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} onOpenJournal={setJournalSupplier} t={t} fmt={fmt} />
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(supplier => (
            <SupplierCard key={supplier.id} supplier={supplier} products={products} productCount={productCounts[supplier.id] || 0}
              expandedId={expandedId} setExpandedId={setExpandedId} canManage={canManage}
              setEditingSupplier={setEditingSupplier} form={form} setShowModal={setShowModal} deleteSupplier={deleteSupplier} t={t} fmt={fmt} />
          ))}
        </div>
      )}
      </>
      )}

      {view === 'by_product' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder={t('suppliers.search_product_placeholder')} className="pl-9 h-9" />
          </div>

          {!productSearch.trim() ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm text-center px-6">
              {t('suppliers.search_product_hint')}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
              {t('suppliers.no_suppliers')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProducts.map(p => {
                const entries = productPrices.filter(e => e.product_id === p.id)
                const currentSupplierId = (p as any).supplier_id as string | null
                const rows = [
                  ...(currentSupplierId ? [{ supplierId: currentSupplierId, price: Number((p as any).buying_price || 0), isCurrent: true, entryId: null as string | null }] : []),
                  ...entries.filter(e => e.supplier_id !== currentSupplierId).map(e => ({ supplierId: e.supplier_id, price: e.price, isCurrent: false, entryId: e.id })),
                ].sort((a, b) => a.price - b.price)

                return (
                  <div key={p.id} className="rounded-lg border bg-card shadow-sm p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      {canManage && (
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs shrink-0" onClick={() => openAddPrice(p)}>
                          <Plus className="h-3 w-3" />{t('suppliers.add_price')}
                        </Button>
                      )}
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-2">{t('suppliers.no_prices_for_product')}</p>
                    ) : (
                      <div className="mt-2 divide-y divide-border/50">
                        {rows.map(row => (
                          <div key={row.supplierId} className="flex items-center justify-between py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm truncate">{supplierName(row.supplierId)}</span>
                              {row.isCurrent && (
                                <span className="text-[10px] font-medium rounded-full bg-blue-50 dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 px-2 py-0.5 shrink-0">
                                  {t('suppliers.current_price_label')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-sm font-semibold">{fmt(row.price)}</span>
                              {!row.isCurrent && canManage && (
                                <>
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => usePrice(p, row.supplierId, row.price)}>
                                    {t('suppliers.use_this_price')}
                                  </Button>
                                  <button
                                    className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                    onClick={() => row.entryId && deletePrice(row.entryId)}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {view === 'purchase_orders' && (
        <div className="space-y-3">
          {canManage && (
            <div className="flex justify-end">
              <Button variant="stockshop" size="sm" className="h-9 gap-1" onClick={openCreatePo}>
                <Plus className="h-4 w-4" />{t('suppliers.new_po')}
              </Button>
            </div>
          )}

          {purchaseOrders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={poSearch}
                  onChange={e => setPoFilter({ search: e.target.value })}
                  placeholder={t('suppliers.po_search_placeholder')}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={poStatusFilter || 'all'} onValueChange={v => setPoFilter({ status: v === 'all' ? '' : v })}>
                <SelectTrigger className="h-9 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('suppliers.po_filter_status_all')}</SelectItem>
                  <SelectItem value="draft">{t('suppliers.po_status_draft')}</SelectItem>
                  <SelectItem value="sent">{t('suppliers.po_status_sent')}</SelectItem>
                  <SelectItem value="received">{t('suppliers.po_status_received')}</SelectItem>
                  <SelectItem value="partial">{t('suppliers.po_status_partial')}</SelectItem>
                  <SelectItem value="cancelled">{t('suppliers.po_status_cancelled')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Input type="date" value={poDateFrom} onChange={e => setPoFilter({ dateFrom: e.target.value })} className="h-9 w-[130px] text-xs" />
                <span className="text-muted-foreground text-xs">→</span>
                <Input type="date" value={poDateTo} onChange={e => setPoFilter({ dateTo: e.target.value })} className="h-9 w-[130px] text-xs" />
              </div>
            </div>
          )}

          {purchaseOrders.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
              {t('suppliers.no_purchase_orders')}
            </div>
          ) : filteredPurchaseOrders.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
              {t('suppliers.po_filter_no_results')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPurchaseOrders.map((po: any) => {
                const itemCount = (po.purchase_order_items || []).length
                const total = (po.purchase_order_items || []).reduce((s: number, it: any) => s + (it.unit_price || 0) * it.quantity_ordered, 0)
                const isExpanded = poExpandedId === po.id
                return (
                  <div key={po.id} className="rounded-lg border bg-card shadow-sm overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full flex items-start justify-between gap-2 flex-wrap p-4 text-left hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setPoExpandedId(isExpanded ? null : po.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPoExpandedId(isExpanded ? null : po.id) } }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{po.reference}</p>
                          <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${PO_STATUS_STYLES[po.status] || PO_STATUS_STYLES.draft}`}>
                            {t(`suppliers.po_status_${po.status}`)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {po.suppliers?.name || supplierName(po.supplier_id)} · {t('suppliers.po_items_count', { count: itemCount })} · {fmt(total)}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                          {new Date(po.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title={t('suppliers.po_journal_button')}
                          onClick={() => setJournalPo(po)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => downloadPoPdf(po)}>
                          {isCapacitor() ? <Share2 className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                          {isCapacitor() ? t('actions.share') : t('suppliers.po_download')}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailPo(po)}>
                          <Mail className="h-3 w-3" />{t('suppliers.po_email_helper')}
                        </Button>
                        {canManage && po.status === 'draft' && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" loading={poActionLoading === po.id} onClick={() => updatePoStatus(po, 'sent')}>
                            <Send className="h-3 w-3" />{t('suppliers.po_mark_sent')}
                          </Button>
                        )}
                        {canManage && po.status === 'sent' && (
                          <Button size="sm" className="h-7 gap-1 text-xs bg-green-700 hover:bg-green-800 text-white border-0" onClick={() => openReceivePo(po)}>
                            <CheckCircle2 className="h-3 w-3" />{t('suppliers.po_mark_received')}
                          </Button>
                        )}
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" /> : <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t bg-muted/10 px-4 py-3">
                        <div className="space-y-1.5">
                          {(po.purchase_order_items || []).map((it: any) => {
                            const shortfall = (po.status === 'partial' || po.status === 'received') && it.quantity_received != null && it.quantity_received < it.quantity_ordered
                            return (
                              <div key={it.id} className="text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{it.product_name} × {it.quantity_ordered} {it.unit || ''}</span>
                                  <span className="tabular-nums text-muted-foreground shrink-0">
                                    {it.unit_price != null ? fmt(it.unit_price * it.quantity_ordered) : '—'}
                                  </span>
                                </div>
                                {shortfall && (
                                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                    {t('suppliers.po_received_vs_ordered', { received: it.quantity_received, ordered: it.quantity_ordered })}
                                    {it.receipt_note ? ` — ${it.receipt_note}` : ''}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        {canManage && po.status === 'partial' && (
                          <div className="flex gap-2 pt-3 mt-3 border-t">
                            <Button
                              variant="outline" size="sm"
                              className="h-8 gap-1.5 text-xs flex-1 text-stockshop-blue border-blue-200 dark:border-blue-800 dark:text-blue-400"
                              onClick={() => openReorderPo(po)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />{t('suppliers.po_reorder_action')}
                            </Button>
                          </div>
                        )}
                        {canManage && (po.status === 'draft' || po.status === 'sent') && (
                          <div className="flex gap-2 pt-3 mt-3 border-t">
                            {po.status === 'draft' && (
                              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs flex-1" onClick={() => openEditPo(po)}>
                                <Edit2 className="h-3.5 w-3.5" />{t('actions.edit')}
                              </Button>
                            )}
                            <Button
                              variant="outline" size="sm"
                              className="h-8 gap-1.5 text-xs flex-1 text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/40"
                              loading={poActionLoading === po.id}
                              onClick={() => updatePoStatus(po, 'cancelled')}
                            >
                              <Ban className="h-3.5 w-3.5" />{t('suppliers.po_cancel')}
                            </Button>
                            {po.status === 'draft' && (
                              <Button
                                variant="outline" size="sm"
                                className="h-8 gap-1.5 text-xs flex-1 text-destructive border-destructive/30 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={() => setDeletePoConfirm(po)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />{t('actions.delete')}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <PremiumDialog
        open={showModal}
        onOpenChange={open => { if (!open) { setShowModal(false); setEditingSupplier(null); form.reset({ name: '', phone: '', city: '', email: '' }) } }}
        category={t('nav.suppliers')}
        title={editingSupplier ? t('suppliers.edit_title') : t('suppliers.add_supplier')}
        icon={<Package className="h-4 w-4" />}
      >
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <PremiumDialogBody>
            <div className="space-y-1.5">
              <Label>{t('suppliers.name')} *</Label>
              <Input {...form.register('name')} placeholder={t('suppliers.name_placeholder')} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.phone')}</Label>
              <Input {...form.register('phone')} placeholder="08012345678" type="tel" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.city')}</Label>
              <Input {...form.register('city')} placeholder={t('suppliers.city_placeholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('suppliers.email')}</Label>
              <Input {...form.register('email')} placeholder="fournisseur@example.com" type="email" />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter
            onCancel={() => setShowModal(false)}
            cancelLabel={t('actions.cancel')}
          >
            <Button variant="stockshop" type="submit" loading={saving} className="flex-1 h-11 rounded-xl font-semibold">
              {t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>

      <PremiumDialog
        open={!!addPriceProduct}
        onOpenChange={open => { if (!open) setAddPriceProduct(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.add_price')}
        icon={<ArrowRightLeft className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <p className="text-sm font-medium truncate">{addPriceProduct?.name}</p>
          <div className="space-y-1.5 mt-3">
            <Label>{t('nav.suppliers')} *</Label>
            <Select value={addPriceSupplierId} onValueChange={setAddPriceSupplierId}>
              <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>
                {suppliers
                  .filter(s => s.shop_id === addPriceProduct?.shop_id && s.id !== (addPriceProduct as any)?.supplier_id)
                  .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 mt-3">
            <Label>{t('suppliers.price_label')} *</Label>
            <Input type="number" min={0} inputMode="numeric" value={addPriceValue} onChange={e => setAddPriceValue(e.target.value)} placeholder="0" />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setAddPriceProduct(null)} cancelLabel={t('actions.cancel')}>
          <Button
            variant="stockshop"
            onClick={submitAddPrice}
            loading={savingPrice}
            disabled={!addPriceSupplierId || !addPriceValue || Number(addPriceValue) <= 0}
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {t('actions.save')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

      <PremiumDialog
        open={showPoDialog}
        onOpenChange={setShowPoDialog}
        category={t('nav.suppliers')}
        title={t('suppliers.new_po')}
        icon={<FileText className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label>{t('nav.suppliers')} *</Label>
            <Select value={poSupplierId} onValueChange={onPoSupplierChange}>
              <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {poSupplierId && (
            <>
              <label className="flex items-center gap-2 mt-3 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={poShowAll} onChange={e => setPoShowAll(e.target.checked)} />
                {t('suppliers.po_show_all_products')}
              </label>

              {poVisibleProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.po_no_products')}</p>
              ) : (
                <div className="mt-2 max-h-72 overflow-y-auto space-y-1.5">
                  {poVisibleProducts.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={!!poChecked[p.id]}
                        onChange={e => setPoChecked(prev => ({ ...prev, [p.id]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t('suppliers.po_stock_label')}: {p.quantity} {p.unit} · {fmt(priceFor(p, poSupplierId))}
                        </p>
                      </div>
                      <Input
                        type="number" min={1} inputMode="numeric"
                        value={poQuantities[p.id] ?? ''}
                        onChange={e => setPoQuantities(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-16 h-8 text-center text-xs flex-shrink-0"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setShowPoDialog(false)} cancelLabel={t('actions.cancel')}>
          <Button
            variant="stockshop"
            onClick={submitCreatePo}
            loading={creatingPo}
            disabled={!poSupplierId}
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {t('actions.save')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

      <PremiumDialog
        open={!!editingPo}
        onOpenChange={open => { if (!open) setEditingPo(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.po_edit_title')}
        icon={<Edit2 className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {editingPo && (
          <>
            <PremiumDialogBody>
              <div className="space-y-2">
                {editItems.map((it, idx) => (
                  <div key={it.id ?? idx} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{it.product_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="number" min={1} inputMode="numeric"
                          value={it.quantity_ordered}
                          onChange={e => setEditItems(prev => prev.map((row, i) => i === idx ? { ...row, quantity_ordered: e.target.value } : row))}
                          className="w-16 h-8 text-center text-xs"
                        />
                        <span className="text-[11px] text-muted-foreground">{it.unit}</span>
                        <Input
                          type="number" min={0} inputMode="numeric"
                          value={it.unit_price}
                          onChange={e => setEditItems(prev => prev.map((row, i) => i === idx ? { ...row, unit_price: e.target.value } : row))}
                          placeholder={t('suppliers.price_label')}
                          className="w-24 h-8 text-center text-xs"
                        />
                      </div>
                    </div>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex-shrink-0"
                      onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {editItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.po_no_products')}</p>
                )}
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setEditingPo(null)} cancelLabel={t('actions.cancel')}>
              <Button
                variant="stockshop"
                onClick={submitEditPo}
                loading={savingEditPo}
                disabled={editItems.length === 0}
                className="flex-1 h-11 rounded-xl font-semibold"
              >
                {t('actions.save')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      <PremiumDialog
        open={!!reorderPo}
        onOpenChange={open => { if (!open) setReorderPo(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.po_reorder_title')}
        icon={<RotateCcw className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {reorderPo && (
          <>
            <PremiumDialogBody>
              <p className="text-xs text-muted-foreground">
                {t('suppliers.po_reorder_hint', { reference: reorderPo.reference })}
              </p>
              <div className="space-y-2 mt-3">
                {reorderItems.map((it, idx) => (
                  <div key={it.product_id ?? idx} className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{it.product_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          type="number" min={1} inputMode="numeric"
                          value={it.quantity_ordered}
                          onChange={e => setReorderItems(prev => prev.map((row, i) => i === idx ? { ...row, quantity_ordered: e.target.value } : row))}
                          className="w-16 h-8 text-center text-xs"
                        />
                        <span className="text-[11px] text-muted-foreground">{it.unit}</span>
                        <Input
                          type="number" min={0} inputMode="numeric"
                          value={it.unit_price}
                          onChange={e => setReorderItems(prev => prev.map((row, i) => i === idx ? { ...row, unit_price: e.target.value } : row))}
                          placeholder={t('suppliers.price_label')}
                          className="w-24 h-8 text-center text-xs"
                        />
                      </div>
                    </div>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex-shrink-0"
                      onClick={() => setReorderItems(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {reorderItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.po_no_products')}</p>
                )}
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setReorderPo(null)} cancelLabel={t('actions.cancel')}>
              <Button
                variant="stockshop"
                onClick={submitReorder}
                loading={creatingReorder}
                disabled={reorderItems.length === 0}
                className="flex-1 h-11 rounded-xl font-semibold"
              >
                {t('suppliers.po_reorder_confirm')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      <PremiumDialog
        open={!!deletePoConfirm}
        onOpenChange={open => { if (!open) setDeletePoConfirm(null) }}
        category={t('nav.suppliers')}
        title={deletePoConfirm?.reference || ''}
        icon={<Trash2 className="h-4 w-4 text-destructive" />}
        maxWidth="max-w-md"
      >
        <PremiumDialogBody>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 shadow-inner p-3 text-sm text-red-700 dark:text-red-400">
            <p>{t('suppliers.po_delete_confirm')}</p>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDeletePoConfirm(null)}
          cancelLabel={t('actions.cancel')}
          onConfirm={confirmDeletePo}
          confirmLabel={t('actions.delete')}
          confirmLoading={deletingPo}
          confirmDestructive
        />
      </PremiumDialog>

      <PremiumDialog
        open={!!emailPo}
        onOpenChange={open => { if (!open) setEmailPo(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.po_email_helper')}
        icon={<Mail className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {emailPo && (() => {
          const { subject, body } = buildPoEmailContent(emailPo)
          const supplierEmail = emailPo.suppliers?.email || ''
          const mailtoHref = `mailto:${encodeURIComponent(supplierEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
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

                {!supplierEmail && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{t('suppliers.po_no_supplier_email')}</p>
                )}
              </PremiumDialogBody>
              <PremiumDialogFooter onCancel={() => setEmailPo(null)} cancelLabel={t('actions.cancel')}>
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

      <PremiumDialog
        open={!!receivingPo}
        onOpenChange={open => { if (!open) setReceivingPo(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.po_receive_title')}
        icon={<CheckCircle2 className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {receivingPo && (
          <>
            <PremiumDialogBody>
              <p className="text-xs text-muted-foreground">{t('suppliers.po_receive_hint')}</p>
              <div className="mt-3 space-y-2">
                {(receivingPo.purchase_order_items || []).map((it: any) => {
                  const received = Number(receiveQuantities[it.id])
                  const isShort = receiveQuantities[it.id] !== undefined && !isNaN(received) && received < it.quantity_ordered
                  return (
                    <div key={it.id} className="rounded-lg border px-2.5 py-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{it.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">{t('suppliers.po_ordered_label')}: {it.quantity_ordered} {it.unit || ''}</p>
                        </div>
                        <Input
                          type="number" min={0} inputMode="numeric"
                          value={receiveQuantities[it.id] ?? ''}
                          onChange={e => setReceiveQuantities(prev => ({ ...prev, [it.id]: e.target.value }))}
                          className="w-20 h-9 text-center flex-shrink-0"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground shrink-0">{t('products.expiry_date_label')}</span>
                        <Input
                          type="date"
                          value={receiveExpiryDates[it.id] ?? ''}
                          onChange={e => setReceiveExpiryDates(prev => ({ ...prev, [it.id]: e.target.value }))}
                          className="h-8 text-xs flex-1"
                        />
                      </div>
                      {isShort && (
                        <Input
                          value={receiveNotes[it.id] ?? ''}
                          onChange={e => setReceiveNotes(prev => ({ ...prev, [it.id]: e.target.value }))}
                          placeholder={t('suppliers.po_receipt_note_placeholder')}
                          className="h-8 text-xs"
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 pt-3 border-t space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('suppliers.po_payment_status_label')}</Label>
                  <span className="text-xs text-muted-foreground">{t('suppliers.po_total_label')}: {fmt(receiveTotal)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['paid', 'partial', 'credit'] as const).map(status => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setReceivePaymentStatus(status)}
                      className={`h-9 rounded-lg text-xs font-medium border transition-colors ${
                        receivePaymentStatus === status
                          ? status === 'paid' ? 'bg-green-600 border-green-600 text-white'
                            : status === 'partial' ? 'bg-amber-500 border-amber-500 text-white'
                            : 'bg-muted-foreground/80 border-muted-foreground/80 text-white'
                          : 'border-input bg-card text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {t(`suppliers.po_payment_status_${status}`)}
                    </button>
                  ))}
                </div>
                {receivePaymentStatus === 'partial' && (
                  <Input
                    inputMode="numeric"
                    value={formatInputValue(receivePaymentAmount, symbol)}
                    onChange={e => setReceivePaymentAmount(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('suppliers.po_payment_amount_placeholder')}
                    className="h-9"
                  />
                )}
                {receivePaymentStatus !== 'credit' && (
                  <Select value={receivePaymentMethod} onValueChange={setReceivePaymentMethod}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t('payment.cash')}</SelectItem>
                      <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
                      <SelectItem value="mobile_money">{t('payment.mobile_money')}</SelectItem>
                      <SelectItem value="other">{t('products.other')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {receivePaymentStatus === 'credit' && (
                  <p className="text-[11px] text-muted-foreground">{t('suppliers.po_payment_credit_hint')}</p>
                )}
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setReceivingPo(null)} cancelLabel={t('actions.cancel')}>
              <Button
                variant="stockshop"
                onClick={submitReceivePo}
                loading={receivingLoading}
                className="flex-1 h-11 rounded-xl font-semibold bg-green-600 hover:bg-green-700"
              >
                {t('suppliers.po_confirm_receipt')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      <PremiumDialog
        open={!!journalPo}
        onOpenChange={open => { if (!open) setJournalPo(null) }}
        category={t('nav.suppliers')}
        title={t('suppliers.po_journal_title')}
        icon={<History className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {journalPo && (() => {
          const events: { key: string; label: string; date: string; Icon: any; color: string; actorName?: string | null }[] = [
            { key: 'created', label: t('suppliers.po_journal_created'), date: journalPo.created_at, Icon: FileText, color: 'text-muted-foreground border-border bg-muted', actorName: journalPo.created_by_name },
          ]
          if (journalPo.sent_at) {
            events.push({ key: 'sent', label: t('suppliers.po_journal_sent'), date: journalPo.sent_at, Icon: Send, color: 'text-stockshop-blue border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800', actorName: journalPo.sent_by_name })
          }
          if ((journalPo.status === 'received' || journalPo.status === 'partial') && journalPo.received_at) {
            events.push({ key: 'received', label: t('suppliers.po_journal_received'), date: journalPo.received_at, Icon: CheckCircle2, color: 'text-green-700 border-green-200 bg-green-50 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800', actorName: journalPo.received_by_name })
          }
          if (journalPo.status === 'cancelled') {
            events.push({ key: 'cancelled', label: t('suppliers.po_journal_cancelled'), date: journalPo.updated_at || journalPo.created_at, Icon: Ban, color: 'text-red-600 border-red-200 bg-red-50 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800', actorName: journalPo.cancelled_by_name })
          }
          events.sort((a, b) => a.date.localeCompare(b.date))
          const items = journalPo.purchase_order_items || []

          return (
            <>
              <PremiumDialogBody>
                <div className="space-y-0">
                  {events.map((ev, idx) => (
                    <div key={ev.key} className="relative flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${ev.color}`}>
                          <ev.Icon className="h-3.5 w-3.5" />
                        </div>
                        {idx < events.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1 mb-1 min-h-[16px]" />}
                      </div>
                      <div className={`flex-1 min-w-0 ${idx < events.length - 1 ? 'pb-4' : ''}`}>
                        <p className="text-sm font-semibold">{ev.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(ev.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {ev.actorName && <> · {t('suppliers.po_journal_by', { name: ev.actorName })}</>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {(journalPo.status === 'received' || journalPo.status === 'partial') && items.length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('suppliers.po_journal_items_title')}</p>
                    <div className="space-y-1.5">
                      {items.map((it: any) => (
                        <div key={it.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="truncate">{it.product_name}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {(it.quantity_received ?? it.quantity_ordered)}/{it.quantity_ordered} {it.unit || ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </PremiumDialogBody>
              <PremiumDialogFooter onCancel={() => setJournalPo(null)} cancelLabel={t('actions.close')} />
            </>
          )
        })()}
      </PremiumDialog>

      <PremiumDialog
        open={!!journalSupplier}
        onOpenChange={open => { if (!open) setJournalSupplier(null) }}
        category={t('nav.suppliers')}
        title={journalSupplier?.name || ''}
        icon={<History className="h-4 w-4" />}
        maxWidth="max-w-lg"
      >
        {journalSupplier && (() => {
          const supplierPOs = purchaseOrders.filter((po: any) => po.supplier_id === journalSupplier.id)
          const meaningfulPOs = supplierPOs.filter((po: any) => po.status !== 'draft')
          // 'partial' compte aussi comme une livraison reçue (argent dépensé,
          // stock rentré) — seule la complétude diffère.
          const receivedPOs = supplierPOs.filter((po: any) => po.status === 'received' || po.status === 'partial')

          const totalSpent = receivedPOs.reduce((sum: number, po: any) =>
            sum + (po.purchase_order_items || []).reduce((s: number, it: any) =>
              s + (it.unit_price || 0) * (it.quantity_received ?? it.quantity_ordered), 0), 0)

          const delays = receivedPOs
            .filter((po: any) => po.sent_at && po.received_at)
            .map((po: any) => (new Date(po.received_at).getTime() - new Date(po.sent_at).getTime()) / 86_400_000)
          const avgDelay = delays.length ? Math.round(delays.reduce((a: number, b: number) => a + b, 0) / delays.length) : null

          const completeCount = receivedPOs.filter((po: any) => po.status === 'received').length
          const completeRate = receivedPOs.length ? Math.round((completeCount / receivedPOs.length) * 100) : null

          // Tendance des prix : compare le premier et le dernier prix payé pour
          // chaque produit, sur les commandes reçues triées chronologiquement.
          const sortedReceived = [...receivedPOs].sort((a: any, b: any) =>
            (a.received_at || a.created_at).localeCompare(b.received_at || b.created_at))
          const priceHistory: Record<string, { first: number; last: number }> = {}
          for (const po of sortedReceived) {
            for (const it of po.purchase_order_items || []) {
              if (!it.unit_price) continue
              if (!priceHistory[it.product_name]) priceHistory[it.product_name] = { first: it.unit_price, last: it.unit_price }
              else priceHistory[it.product_name].last = it.unit_price
            }
          }
          const trends = Object.entries(priceHistory)
            .filter(([, v]) => v.first !== v.last)
            .map(([name, v]) => ({ name, ...v, pct: Math.round(((v.last - v.first) / v.first) * 100) }))

          return (
            <>
              <PremiumDialogBody>
                {supplierPOs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">{t('suppliers.supplier_journal_no_orders')}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border divide-x divide-y sm:divide-y-0">
                      <div className="flex flex-col items-center justify-center py-3 px-2 text-center">
                        <p className="text-lg font-bold">{meaningfulPOs.length}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('suppliers.supplier_journal_orders_count')}</p>
                      </div>
                      <div className="flex flex-col items-center justify-center py-3 px-2 text-center">
                        <p className="text-lg font-bold">{fmt(totalSpent)}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('suppliers.supplier_journal_total_spent')}</p>
                      </div>
                      <div className="flex flex-col items-center justify-center py-3 px-2 text-center">
                        <p className="text-lg font-bold">
                          {avgDelay != null ? t('suppliers.supplier_journal_avg_delay_days', { count: avgDelay }) : t('suppliers.supplier_journal_no_data')}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('suppliers.supplier_journal_avg_delay')}</p>
                      </div>
                      <div className="flex flex-col items-center justify-center py-3 px-2 text-center">
                        <p className={`text-lg font-bold ${completeRate == null ? '' : completeRate >= 80 ? 'text-green-600' : completeRate >= 50 ? 'text-amber-500' : 'text-red-600'}`}>
                          {completeRate != null ? `${completeRate}%` : t('suppliers.supplier_journal_no_data')}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('suppliers.supplier_journal_complete_rate')}</p>
                      </div>
                    </div>

                    {Number(journalSupplier.total_owed) > 0 && (
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('suppliers.supplier_journal_owed')}</span>
                        <span className="text-sm font-bold text-amber-700 dark:text-amber-400">{fmt(journalSupplier.total_owed)}</span>
                      </div>
                    )}

                    <div className="mt-4 divide-y divide-border/50">
                      {supplierPOs
                        .slice()
                        .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
                        .map((po: any) => {
                          const itemCount = (po.purchase_order_items || []).length
                          const total = (po.purchase_order_items || []).reduce((s: number, it: any) => s + (it.unit_price || 0) * it.quantity_ordered, 0)
                          return (
                            <button
                              key={po.id}
                              className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:bg-muted/30 transition-colors"
                              onClick={() => { setJournalSupplier(null); setJournalPo(po) }}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium truncate">{po.reference}</span>
                                  <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${PO_STATUS_STYLES[po.status] || PO_STATUS_STYLES.draft}`}>
                                    {t(`suppliers.po_status_${po.status}`)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {t('suppliers.po_items_count', { count: itemCount })} · {fmt(total)} · {new Date(po.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            </button>
                          )
                        })}
                    </div>

                    {trends.length > 0 && (
                      <div className="mt-4 pt-3 border-t">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('suppliers.supplier_journal_price_trend_title')}</p>
                        <div className="space-y-1.5">
                          {trends.map(tr => (
                            <div key={tr.name} className="flex items-center justify-between text-sm gap-2">
                              <span className="truncate">{tr.name}</span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className="text-muted-foreground text-xs tabular-nums">{fmt(tr.first)} → {fmt(tr.last)}</span>
                                <span className={`flex items-center gap-0.5 text-xs font-semibold tabular-nums ${tr.pct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  {tr.pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {tr.pct > 0 ? '+' : ''}{tr.pct}%
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </PremiumDialogBody>
              <PremiumDialogFooter onCancel={() => setJournalSupplier(null)} cancelLabel={t('actions.close')} />
            </>
          )
        })()}
      </PremiumDialog>
    </div>
  )
}
