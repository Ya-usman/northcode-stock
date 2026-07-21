'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Plus, Minus, Trash2, CheckCircle, MessageCircle, Printer, Share2,
  Scan, X, User, Store, ChevronDown, Clock, PauseCircle, PlayCircle, Edit2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cn } from '@/lib/utils/cn'
import { normalize } from '@/lib/utils/normalize'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PremiumDialog, PremiumDialogBody } from '@/components/ui/premium-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useCurrency } from '@/lib/hooks/use-currency'
import { shareReceiptWhatsApp, buildReceiptWhatsAppMessage } from '@/lib/utils/whatsapp'
import { sharePDFNative, printPDFNative, isCapacitor } from '@/lib/utils/native-share'
import type { Product, Customer, CartItem, Sale, SaleItem, Category } from '@/lib/types/database'
import dynamic from 'next/dynamic'
import { cacheProducts, getCachedProducts, cacheCustomers, getCachedCustomers, savePendingSale } from '@/lib/offline/db'
import { clearPageCache, clearPageCacheByPrefix } from '@/lib/offline/page-cache'
import { registerBackgroundSync } from '@/lib/offline/sync'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-1 h-12 rounded-xl bg-muted animate-pulse" /> }
)
import { useOffline } from '@/lib/offline/use-offline'
import { triggerSaleFeedback, unlockAudio } from '@/lib/utils/sale-feedback'
import { getCountry, getMethodType } from '@/lib/saas/countries'
import { withTimeout } from '@/lib/utils/with-timeout'
import { formatInputValue, formatCurrency } from '@/lib/utils/currency'
import { checkAndNotifyLowStock, notifyNewSale } from '@/lib/push'

// Prix effectif d'un produit : priorité au prix promo du lot FEFO en tête
// de file (celui qui sera réellement vendu en premier — voir
// frontBatchPromo, construit dans loadShopData), sinon la promo produit
// (091), sinon le prix catalogue. Le prix du lot revient automatiquement
// au prix produit/catalogue dès que ce lot est épuisé, puisque
// frontBatchPromo n'est construit qu'à partir des lots avec quantity > 0 —
// aucune action manuelle nécessaire (voir migration 095).
function effectivePrice(product: Product, frontBatchPromo?: Record<string, { price: number; until: string }>): number {
  const batchPromo = frontBatchPromo?.[product.id]
  if (batchPromo && batchPromo.until >= new Date().toISOString()) {
    return batchPromo.price
  }
  if (product.promo_price && product.promo_until && product.promo_until >= new Date().toISOString()) {
    return product.promo_price
  }
  return product.selling_price
}

interface Draft {
  id: string
  createdAt: string
  shopId: string
  cart: CartItem[]
  customerName: string
  customerPhone: string
  discount: number
  notes: string
  paymentMethod: string
}

const DRAFTS_KEY = 'nc_sale_drafts'

function loadDraftsFromStorage(): Draft[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]')
  } catch { return [] }
}

function saveDraftsToStorage(drafts: Draft[]) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

export default function NewSalePage({ params: { locale: _locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const locale = useLocale()
  const { profile, shop, userShops } = useAuth()
  const isOwner = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'shop_manager' || profile?.role === 'super_admin'
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null)
  const [shopPickerOpen, setShopPickerOpen] = useState(false)
  const selectedShop = userShops.find(s => s.id === (selectedShopId || shop?.id)) || shop
  const { fmt: _fmtGlobal, symbol: _globalSymbol } = useCurrency()
  // Always derive symbol from selectedShop so prices stay in sync with the shop picker
  const symbol = selectedShop?.currency || _globalSymbol
  const formatNaira = (amount: number | string | null | undefined) => formatCurrency(amount, symbol)
  const supabase = createClient()
  const { toast } = useToast()
  const searchRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [products, setProducts] = useState<Product[]>([])
  const [frontBatchPromo, setFrontBatchPromo] = useState<Record<string, { price: number; until: string }>>({})
  const [categories, setCategories] = useState<Category[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [transferRef, setTransferRef] = useState('')
  const [splitPayment, setSplitPayment] = useState(false)
  const [splitMethod2, setSplitMethod2] = useState<string>('')
  const [notes, setNotes] = useState('')
  const { isOnline, refreshPendingCount } = useOffline()
  const [completing, setCompleting] = useState(false)
  const [completedSale, setCompletedSale] = useState<Sale & { sale_items: SaleItem[] } | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [scanFlash, setScanFlash] = useState(false)
  const [showCameraScanner, setShowCameraScanner] = useState(false)

  // Debt repayment included in sale
  const [customerUnpaidSales, setCustomerUnpaidSales] = useState<any[]>([])
  const [debtRepayEnabled, setDebtRepayEnabled] = useState(false)
  const [debtRepayAmount, setDebtRepayAmount] = useState('')

  // Raw quantity input values (allows clearing/retyping without snap-back)
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({})
  // Price edit modal
  const [priceModalItem, setPriceModalItem] = useState<typeof cart[0] | null>(null)
  const [priceModalInput, setPriceModalInput] = useState<string>('')

  // Drafts (held invoices)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)

  // Load drafts from localStorage on mount
  useEffect(() => {
    setDrafts(loadDraftsFromStorage())
  }, [])

  // Barcode scanner
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<NodeJS.Timeout | null>(null)
  // Idempotency key for the current checkout attempt — generated once and reused
  // across retries (including a manual re-click after an apparent failure) so a
  // sale that actually succeeded server-side isn't silently recreated. Reset
  // once the sale completes (resetForm) or the cart changes to a new attempt.
  const checkoutIdRef = useRef<string | null>(null)

  const loadShopData = useCallback(async () => {
    if (!selectedShop?.id) return
    // Always show IndexedDB cache immediately (stale-while-revalidate)
    const [cachedProds, cachedCusts] = await Promise.all([
      getCachedProducts(selectedShop.id),
      getCachedCustomers(selectedShop.id),
    ])
    if (cachedProds.length > 0) {
      setProducts(cachedProds as unknown as Product[])
      setFilteredProducts(cachedProds as unknown as Product[])
    }
    if (cachedCusts.length > 0) setCustomers(cachedCusts as unknown as Customer[])

    if (!isOnline) return

    // Fetch fresh data in background
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave stock levels silently frozen forever (a real
      // overselling risk on the checkout screen) — a hang here previously
      // left this function stuck, with nothing retrying until the next
      // visibilitychange/reconnect trigger hit the exact same hang again.
      const [{ data: prods }, { data: custs }, { data: cats }, { data: batches }] = await withTimeout(Promise.all([
        supabase.from('products').select('*, categories(name), suppliers(name)')
          .eq('shop_id', selectedShop.id).eq('is_active', true).gt('quantity', 0).order('name'),
        supabase.from('customers').select('*').eq('shop_id', selectedShop.id).order('name'),
        supabase.from('categories').select('*').eq('shop_id', selectedShop.id).order('name'),
        supabase.from('product_batches')
          .select('product_id, expiry_date, received_at, promo_price, promo_until')
          .eq('shop_id', selectedShop.id).gt('quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false })
          .order('received_at', { ascending: true }),
      ]), 20_000, 'Chargement des produits trop lent — réessayez.')
      const safeProds = (prods || []) as unknown as Product[]
      setProducts(safeProds)
      setFilteredProducts(safeProds)
      setCustomers((custs || []) as Customer[])
      setCategories((cats || []) as Category[])

      // Le premier lot rencontré par produit (déjà trié FEFO ci-dessus) est
      // celui qui sera vendu en premier — seul son prix promo compte pour
      // la caisse, jamais celui d'un lot plus tardif.
      const frontSeen = new Set<string>()
      const promoMap: Record<string, { price: number; until: string }> = {}
      for (const b of (batches || []) as any[]) {
        if (frontSeen.has(b.product_id)) continue
        frontSeen.add(b.product_id)
        if (b.promo_price && b.promo_until) promoMap[b.product_id] = { price: Number(b.promo_price), until: b.promo_until }
      }
      setFrontBatchPromo(promoMap)
      // Refresh IndexedDB cache
      await Promise.all([
        cacheProducts(selectedShop.id, safeProds.map((p: any) => ({
          id: p.id, shop_id: selectedShop.id, name: p.name, sku: p.sku ?? null,
          selling_price: Number(p.selling_price), buying_price: Number(p.buying_price),
          quantity: Number(p.quantity), category_id: p.category_id ?? null, is_active: p.is_active,
        }))),
        cacheCustomers(selectedShop.id, (custs || []).map((c: any) => ({
          id: c.id, shop_id: selectedShop.id, name: c.name,
          phone: c.phone ?? null, total_debt: Number(c.total_debt ?? 0),
        }))),
      ])
    } catch {
      // Cache already applied above — nothing to do
    }
  }, [selectedShop?.id, isOnline])

  useEffect(() => { loadShopData() }, [loadShopData])

  // Refresh when the user comes back to this tab — the cart is built from
  // this product/customer list, so stale stock levels here risk overselling
  // during a sale. Reconnect is already covered: loadShopData depends on
  // `isOnline` (from useOffline, verified via a real request — see there for
  // why the raw browser 'online' event isn't trustworthy on Capacitor/Android),
  // so the mount effect above re-runs it whenever isOnline flips back to true.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadShopData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadShopData])

  useEffect(() => {
    let list = products
    if (categoryFilter !== 'all') {
      list = list.filter(p => p.category_id === categoryFilter)
    }
    if (searchQuery.trim()) {
      const q = normalize(searchQuery)
      list = list.filter(p =>
        normalize(p.name).includes(q) ||
        normalize(p.sku ?? '').includes(q)
      )
    }
    setFilteredProducts(list)
  }, [searchQuery, categoryFilter, products])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Enter' && barcodeBuffer.current.length >= 3) {
          const scanned = barcodeBuffer.current.trim()
          barcodeBuffer.current = ''
          if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
          handleBarcodeScan(scanned)
          return
        }
        return
      }
      if (e.key === 'Enter') {
        const scanned = barcodeBuffer.current.trim()
        barcodeBuffer.current = ''
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        if (scanned.length >= 3) handleBarcodeScan(scanned)
        return
      }
      if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = '' }, 120)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [products])

  const handleBarcodeScan = useCallback((code: string) => {
    const product = products.find(p =>
      p.sku?.toLowerCase() === code.toLowerCase() ||
      p.sku?.toLowerCase().includes(code.toLowerCase())
    )
    if (product) {
      setScanFlash(true)
      setTimeout(() => setScanFlash(false), 600)
      addToCartById(product)
      toast({ title: t('toast.product_scanned', { name: product.name }), variant: 'success' })
    } else {
      toast({ title: t('toast.barcode_not_found', { code }), variant: 'destructive' })
    }
  }, [products, toast])

  const addToCartById = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.quantity) {
          toast({ title: t('toast.max_stock', { qty: product.quantity, unit: product.unit }), variant: 'destructive' })
          return prev
        }
        return prev.map(i =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unit_price }
            : i
        )
      }
      const price = effectivePrice(product, frontBatchPromo)
      return [...prev, { product, quantity: 1, unit_price: price, subtotal: price }]
    })
  }

  const addToCart = (product: Product) => {
    addToCartById(product)
    setSearchQuery('')
    // Always blur active element to dismiss keyboard on Android/mobile
    ;(document.activeElement as HTMLElement)?.blur()
  }

  const updateQty = (productId: string, delta: number) => {
    setCart(prev => prev
      .map(item => {
        if (item.product.id !== productId) return item
        const newQty = item.quantity + delta
        if (newQty <= 0) return null
        if (newQty > item.product.quantity) {
          toast({ title: t('toast.max_stock', { qty: item.product.quantity, unit: item.product.unit }), variant: 'destructive' })
          return item
        }
        return { ...item, quantity: newQty, subtotal: newQty * item.unit_price }
      })
      .filter(Boolean) as CartItem[]
    )
  }

  const setQtyDirect = (productId: string, qty: number) => {
    if (isNaN(qty) || qty < 1) return
    setCart(prev => prev.map(item => {
      if (item.product.id !== productId) return item
      const capped = Math.min(qty, item.product.quantity)
      return { ...item, quantity: capped, subtotal: capped * item.unit_price }
    }))
  }

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const updateItemPrice = (productId: string, newPrice: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id !== productId) return item
      const minPrice = effectivePrice(item.product, frontBatchPromo)
      const price = Math.max(minPrice, newPrice)
      return { ...item, unit_price: price, subtotal: Math.round(item.quantity * price) }
    }))
  }

  const resetForm = () => {
    checkoutIdRef.current = null
    setCart([])
    setDiscount(0)
    setAmountPaid('')
    setSelectedCustomer(null)
    setCustomerName('')
    setCustomerPhone('')
    setNotes('')
    setTransferRef('')
    setSplitPayment(false)
    setSplitMethod2('')
    setPriceModalItem(null)
    setActiveDraftId(null)
    setDebtRepayEnabled(false)
    setDebtRepayAmount('')
    setCustomerUnpaidSales([])
  }

  // ── DRAFTS ─────────────────────────────────────────────
  const holdInvoice = () => {
    if (cart.length === 0) {
      toast({ title: t('toast.cart_empty'), variant: 'destructive' })
      return
    }
    const draft: Draft = {
      id: activeDraftId || `draft_${Date.now()}`,
      createdAt: new Date().toISOString(),
      shopId: selectedShop?.id || '',
      cart,
      customerName: selectedCustomer ? selectedCustomer.name : customerName,
      customerPhone,
      discount,
      notes,
      paymentMethod,
    }
    const updated = drafts.filter(d => d.id !== draft.id)
    updated.unshift(draft)
    setDrafts(updated)
    saveDraftsToStorage(updated)
    resetForm()
    toast({ title: t('toast.sale_held'), variant: 'success' })
  }

  const resumeDraft = (draft: Draft) => {
    // Only resume if products are still loaded (same shop)
    setCart(draft.cart)
    setCustomerName(draft.customerName)
    setCustomerPhone(draft.customerPhone)
    setDiscount(draft.discount)
    setNotes(draft.notes)
    setPaymentMethod(draft.paymentMethod)
    setActiveDraftId(draft.id)
    setShowDrafts(false)
    toast({ title: t('toast.sale_resumed'), variant: 'success' })
  }

  const deleteDraft = (id: string) => {
    const updated = drafts.filter(d => d.id !== id)
    setDrafts(updated)
    saveDraftsToStorage(updated)
    if (activeDraftId === id) { setActiveDraftId(null) }
  }

  // Drafts for current shop
  const shopDrafts = drafts.filter(d => d.shopId === selectedShop?.id)

  // Fetch unpaid sales when customer with debt is selected
  // Uses /api/payments/debts to bypass RLS for multi-shop accounts
  useEffect(() => {
    setDebtRepayEnabled(false)
    setDebtRepayAmount('')
    setCustomerUnpaidSales([])
    if (!selectedCustomer || Number(selectedCustomer.total_debt) <= 0 || !selectedShop?.id) return
    fetch(`/api/payments/debts?shop_id=${selectedShop.id}`)
      .then(r => r.json())
      .then(({ debtors }) => {
        const debtor = (debtors || []).find((d: any) => d.customer.id === selectedCustomer.id)
        const sales = debtor?.unpaidSales || []
        setCustomerUnpaidSales(sales)
        if (sales.length > 0) {
          const totalDebt = sales.reduce((s: number, x: any) => s + Number(x.balance), 0)
          setDebtRepayAmount(String(Math.round(totalDebt)))
        }
      })
      .catch(() => {/* keep empty */})
  }, [selectedCustomer?.id, selectedShop?.id])

  // ── TOTALS ─────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const discountAmt = discount
  const tax = Number(selectedShop?.tax_rate || 0) > 0 ? (subtotal - discountAmt) * (selectedShop!.tax_rate / 100) : 0
  const total = subtotal - discountAmt + tax
  // Montant total à encaisser = vente + remboursement crédit si activé
  const debtAmt = debtRepayEnabled ? (Number(debtRepayAmount) || 0) : 0
  const totalToCollect = total + debtAmt
  const shopCountry = getCountry(selectedShop?.country)
  const methodType = getMethodType(paymentMethod, shopCountry)
  // For credit: customer pays nothing now → paid = 0, balance = total
  // For cash: cap at total — the change given back is NOT revenue
  const paid = methodType === 'cash'
    ? Math.min(Number(amountPaid) || 0, total)
    : methodType === 'credit' ? 0 : total
  const change = methodType === 'cash' ? Math.max(0, (Number(amountPaid) || 0) - totalToCollect) : 0
  const balance = Math.max(0, total - paid)

  const filteredCustomers = customerName
    ? customers.filter(c =>
        normalize(c.name).includes(normalize(customerName)) ||
        c.phone?.includes(customerName)
      )
    : customers

  // ── COMPLETE SALE ───────────────────────────────────────
  const completeSale = async () => {
    if (cart.length === 0) { toast({ title: t('toast.cart_empty'), variant: 'destructive' }); return }
    if (methodType === 'credit' && !selectedCustomer && !customerName.trim()) {
      toast({ title: t('toast.customer_required_credit'), variant: 'destructive' }); return
    }
    if (!splitPayment && methodType === 'cash' && Number(amountPaid) < totalToCollect) {
      toast({ title: t('toast.insufficient_amount', { amount: formatNaira(totalToCollect) }), variant: 'destructive' }); return
    }
    if (splitPayment) {
      const amt1 = Number(amountPaid) || 0
      if (amt1 <= 0) {
        toast({ title: 'Entrez le montant du 1er paiement', variant: 'destructive' }); return
      }
      if (amt1 >= totalToCollect) {
        toast({ title: 'Ce montant couvre déjà tout le total — désactivez le paiement mixte', variant: 'destructive' }); return
      }
      if (!splitMethod2) {
        toast({ title: 'Choisissez le 2ème moyen de paiement', variant: 'destructive' }); return
      }
    }

    unlockAudio()   // déverrouille l'AudioContext pendant le geste utilisateur
    setCompleting(true)

    // Snapshot values NOW (before any async wait) so they stay valid
    // even if auth context updates during the 10s network timeout.
    const _shopId = selectedShop?.id
    const _cashierId = profile?.id
    const _cart = cart.map((item: any) => ({ ...item }))

    // ── Shared offline save (used by offline path AND as online fallback) ───
    // This function NEVER throws — it always shows the receipt to the user.
    const saveOffline = async (toastMsg: string) => {
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const saleNumber = `HL-${localId.slice(-5).toUpperCase()}`

      // Try to persist — if IndexedDB fails, still show the receipt
      let persisted = false
      if (_shopId && _cashierId) {
        try {
          await savePendingSale({
            local_id: localId,
            shop_id: _shopId,
            cashier_id: _cashierId,
            subtotal,
            discount: discountAmt,
            tax,
            total,
            payment_method: paymentMethod,
            payment_status: methodType === 'credit'
              ? 'pending'
              : balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
            amount_paid: paid,
            balance,
            customer_id: selectedCustomer?.id ?? null,
            customer_name: customerName.trim() || selectedCustomer?.name || null,
            customer_phone: customerPhone.trim() || selectedCustomer?.phone || null,
            notes: notes || null,
            created_at: new Date().toISOString(),
            items: _cart.map((item: any) => ({
              product_id: item.product.id,
              product_name: item.product.name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.quantity * item.unit_price,
            })),
            payment_amount: methodType !== 'credit' ? paid : 0,
            payment_reference: methodType === 'transfer' ? transferRef : null,
            synced: false,
          })
          persisted = true
          refreshPendingCount().catch(() => {})
          registerBackgroundSync()
        } catch {
          // IndexedDB failed — sale will show in receipt but won't auto-sync
        }
      }

      // Always show receipt regardless of persistence outcome
      setCompletedSale({
        id: localId,
        sale_number: saleNumber,
        shop_id: _shopId || '',
        cashier_id: _cashierId || '',
        subtotal,
        discount: discountAmt,
        tax,
        total,
        payment_method: paymentMethod,
        payment_status: 'pending',
        amount_paid: paid,
        balance,
        sale_status: 'active',
        notes: notes || null,
        created_at: new Date().toISOString(),
        sale_items: _cart.map((item: any) => ({
          id: `li-${Math.random()}`,
          sale_id: localId,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.quantity * item.unit_price,
        })),
      } as any)
      setShowReceipt(true)
      resetForm()
      triggerSaleFeedback()
      toast({
        title: persisted ? toastMsg : 'Vente enregistrée · reconnectez-vous pour synchroniser',
        variant: 'success',
      })
    }

    // ── OFFLINE PATH ─────────────────────────────────────────────────────────
    if (!isOnline) {
      try {
        await saveOffline('Vente sauvegardée hors-ligne · sera synchronisée automatiquement')
      } catch (err: any) {
        toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
      } finally {
        setCompleting(false)
      }
      return
    }

    // ── ONLINE PATH ──────────────────────────────────────────────────────────
    let sale: any = null
    try {
      const db = supabase as any

      // Create or find customer by phone/name if provided
      let customerId = selectedCustomer?.id || null
      if (!customerId && customerName.trim()) {
        // Try to find existing customer with same phone
        let existing = customerPhone
          ? customers.find(c => c.phone === customerPhone)
          : null
        if (!existing) {
          const { data: newCust } = await db.from('customers').insert({
            shop_id: selectedShop!.id,
            name: customerName.trim(),
            phone: customerPhone.trim() || null,
          }).select().single()
          if (newCust) {
            customerId = (newCust as any).id
            setCustomers(prev => [...prev, newCust as Customer])
          }
        } else {
          customerId = existing.id
        }
      }

      // Idempotency key: generated once per checkout attempt and reused across
      // retries — including a manual re-click after an apparent failure, since
      // it lives in a ref, not a local variable. If a previous attempt with this
      // exact key already landed server-side (its response was just lost to a
      // timeout/network drop), we detect that below and reuse the existing sale
      // instead of creating a second one.
      const clientRequestId = checkoutIdRef.current ?? (checkoutIdRef.current = crypto.randomUUID())

      const salePayload = {
        shop_id: selectedShop!.id,
        customer_id: customerId,
        cashier_id: profile!.id,
        subtotal,
        discount: discountAmt,
        tax,
        total,
        payment_method: splitPayment ? 'mixed' : paymentMethod,
        payment_status: splitPayment
          ? 'paid'
          : methodType === 'credit'
            ? 'pending'
            : balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
        amount_paid: 0,
        sale_status: 'active',
        notes: notes || null,
        paystack_reference: methodType === 'card' ? `PAY-${Date.now()}` : null,
        client_request_id: clientRequestId,
      }

      // Check first: did this exact checkout attempt already succeed (e.g. a
      // prior call to completeSale() got no response due to a network drop,
      // and the cashier re-clicked)? If so, reuse it instead of inserting again.
      let saleAlreadyExisted = false
      const { data: alreadyCreated } = await db
        .from('sales')
        .select('id, sale_number')
        .eq('client_request_id', clientRequestId)
        .maybeSingle()
      if (alreadyCreated) { sale = alreadyCreated; saleAlreadyExisted = true }

      // Retry up to 5 times on duplicate sale_number (race condition / pre-existing number)
      // 20 s client-side timeout per attempt: prevents infinite spinner when a DB trigger
      // blocks on a lock (e.g. shop_sale_counters row held by a zombie transaction).
      const withTimeout = (p: Promise<any>, ms: number) =>
        Promise.race([
          p,
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('La base de données ne répond pas — vérifiez votre connexion et réessayez.')), ms)
          ),
        ])

      let lastError: any = null
      for (let attempt = 0; !sale && attempt < 5; attempt++) {
        const res = await withTimeout(
          db.from('sales').insert(salePayload).select().single() as Promise<any>,
          20_000
        )
        lastError = res.error
        if (!res.error) { sale = res.data; lastError = null; break }
        if (res.error?.code !== '23505') break  // non-duplicate error → surface immediately
        // 23505 can be EITHER the auto-generated sale_number colliding (expected
        // under concurrent inserts — a new number is assigned on retry) OR this
        // exact client_request_id already existing (this submission actually
        // succeeded already — the key never changes between retries, so fetch
        // it instead of retrying blindly toward the same collision).
        if (res.error.message?.includes('client_request_id')) {
          const { data: raced } = await db.from('sales').select('id, sale_number').eq('client_request_id', clientRequestId).maybeSingle()
          if (raced) { sale = raced; saleAlreadyExisted = true; lastError = null; break }
        }
        await new Promise(r => setTimeout(r, 80 + attempt * 120))
      }

      if (lastError || !sale) {
        const msg = lastError?.message || lastError?.details || 'Erreur création vente'
        throw new Error(msg)
      }

      // If this sale already existed (idempotent retry), its items/payment were
      // presumably already inserted by the earlier successful attempt — check
      // before inserting again to avoid duplicate items (double stock deduction)
      // or a duplicate payment record.
      let itemsAlreadyExist = false
      if (saleAlreadyExisted) {
        const { count } = await db.from('sale_items').select('id', { count: 'exact', head: true }).eq('sale_id', sale.id)
        itemsAlreadyExist = Boolean(count)
      }

      if (!itemsAlreadyExist) {
        const { error: itemsError } = await db.from('sale_items').insert(
          cart.map((item: any) => ({
            sale_id: sale.id,
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: Math.round(item.quantity),
            unit_price: item.unit_price,
            buying_price: Number(item.product.buying_price) || 0,
          }))
        )
        if (itemsError) throw itemsError
      }

      // payment_status was already set optimistically on the sale insert above
      // (based on what the cashier entered, before we know this insert will
      // succeed). If it fails — e.g. a network drop right at this moment —
      // correct the sale back to 'pending' instead of silently leaving it
      // marked "paid" with 0 actually recorded (a hidden, unexplained debt).
      let paymentRecordFailed = false
      let paymentAlreadyExists = false
      if (saleAlreadyExisted) {
        const { count } = await db.from('payments').select('id', { count: 'exact', head: true }).eq('sale_id', sale.id)
        paymentAlreadyExists = Boolean(count)
      }

      if (!paymentAlreadyExists) {
        if (splitPayment) {
          const amt1 = Math.min(Number(amountPaid) || 0, totalToCollect)
          const amt2 = totalToCollect - amt1
          const recs: any[] = []
          if (amt1 > 0) recs.push({ sale_id: sale.id, amount: amt1, method: paymentMethod, reference: null, received_by: profile!.id })
          if (amt2 > 0) recs.push({ sale_id: sale.id, amount: amt2, method: splitMethod2, reference: null, received_by: profile!.id })
          if (recs.length > 0) {
            const { error: paymentError } = await db.from('payments').insert(recs)
            if (paymentError) paymentRecordFailed = true
          }
        } else if (methodType !== 'credit' && paid > 0) {
          const { error: paymentError } = await db.from('payments').insert({
            sale_id: sale.id,
            amount: paid,
            method: paymentMethod,
            reference: methodType === 'transfer' ? transferRef : null,
            received_by: profile!.id,
          })
          if (paymentError) paymentRecordFailed = true
        }
      }

      if (paymentRecordFailed) {
        await db.from('sales').update({ payment_status: 'pending' }).eq('id', sale.id)
        toast({
          title: 'Vente enregistrée, mais le paiement n\'a pas pu être confirmé (réseau) — vérifiez le solde dû du client',
          variant: 'destructive',
        })
      }

      // Include debt repayment — FIFO via admin route (bypasses RLS).
      // Skip if the sale already existed (idempotent retry): this repayment
      // was already applied by the earlier successful attempt, and calling
      // it again would deduct it from the customer's debt twice.
      if (!saleAlreadyExisted && debtRepayEnabled && Number(debtRepayAmount) > 0 && customerUnpaidSales.length > 0) {
        await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unpaid_sale_ids: customerUnpaidSales.map((s: any) => s.id),
            amount: Number(debtRepayAmount),
            method: methodType === 'credit' ? 'cash' : paymentMethod,
            reference: methodType === 'transfer' ? transferRef : null,
            notes: `Inclus dans la vente #${(sale as any).sale_number}`,
            shop_id: selectedShop!.id,
            client_request_id: clientRequestId,
          }),
        })
      }

      const { data: fullSale } = await db
        .from('sales')
        .select('*, sale_items(*), customers(*)')
        .eq('id', sale.id)
        .single()

      // Remove from drafts if it was a held invoice
      if (activeDraftId) deleteDraft(activeDraftId)

      setCompletedSale(fullSale as any)
      setShowReceipt(true)
      resetForm()
      triggerSaleFeedback()
      toast({ title: t('sales.receipt_ready'), variant: 'success' })
      // Invalidate related page caches so next visit to history/stock shows fresh data
      clearPageCacheByPrefix('sales_history_v2_')
      clearPageCache(`stock_${selectedShop?.id}`)
      if (selectedCustomer) clearPageCache(`debtors_${selectedShop?.id}`)

      // Fire-and-forget: notify admin of new sale + check low stock
      const soldProductIds = cart.map(item => item.product.id)
      notifyNewSale({
        shopId: selectedShop!.id,
        total: totalToCollect,
        currencySymbol: selectedShop!.currency || '₦',
        cashierName: profile?.full_name || undefined,
        paymentLabel: shopCountry.paymentMethods.find(m => m.id === paymentMethod)?.label || paymentMethod,
      })
      checkAndNotifyLowStock(selectedShop!.id, soldProductIds).catch(() => {})
    } catch (err: any) {
      if (sale) {
        // The sale record was already written to the DB. Going offline here would create
        // a duplicate — instead surface the real error so the user knows the sale is
        // incomplete. They can see it in history to validate the payment or cancel it.
        toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
      } else {
        // Sale was never created — safe to fall back to local save.
        try {
          await saveOffline('Connexion instable · vente sauvegardée localement et synchronisée automatiquement dès que la connexion est stable')
        } catch {
          toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
        }
      }
    } finally {
      setCompleting(false)
    }
  }

  const receiptLabels = {
    receipt: t('receipt.receipt'),
    cashier: t('receipt.cashier'),
    customer: t('receipt.customer'),
    colItem: t('receipt.col_item'),
    colQty: t('receipt.col_qty'),
    colUnitPrice: t('receipt.col_unit_price'),
    colTotal: t('receipt.col_total'),
    subtotal: t('receipt.subtotal'),
    discount: t('receipt.discount'),
    tax: t('receipt.tax'),
    total: t('receipt.total'),
    paid: t('receipt.paid'),
    via: t('receipt.via'),
    balanceDue: t('receipt.balance_due'),
    thankYou: t('receipt.thank_you'),
  }

  const handlePrintReceipt = async () => {
    if (!completedSale || !shop) return
    const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
    const blob = await generateReceiptPDFBlob({
      sale: completedSale as any,
      shop: selectedShop as any,
      cashierName: profile?.full_name || '',
      customerName: (completedSale as any).customers?.name,
      labels: receiptLabels,
    })
    await printPDFNative(blob, `Recu-${completedSale.sale_number}.pdf`)
  }

  const handleWhatsAppReceipt = async () => {
    if (!completedSale || !shop) return
    const fileName = `Recu-${completedSale.sale_number}.pdf`
    try {
      const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
      const blob = await generateReceiptPDFBlob({
        sale: completedSale as any,
        shop: selectedShop as any,
        cashierName: profile?.full_name || '',
        customerName: (completedSale as any).customers?.name,
        labels: receiptLabels,
      })
      await sharePDFNative(
        blob,
        fileName,
        `Reçu #${completedSale.sale_number} — ${selectedShop?.name}`,
      )
      return
    } catch (err: any) {
      if (err?.name === 'AbortError') return // user cancelled native share sheet
      // PDF generation or share failed — fall through to text fallback
    }
    // Last resort: WhatsApp text message
    const message = buildReceiptWhatsAppMessage({
      shopName: selectedShop?.name || '',
      saleNumber: completedSale.sale_number,
      date: new Date(completedSale.created_at).toLocaleString(locale, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
      items: ((completedSale as any).sale_items || []).map((i: any) => ({ name: i.product_name, qty: i.quantity, price: i.unit_price })),
      total: completedSale.total,
      paid: completedSale.amount_paid,
      balance: completedSale.balance,
      method: completedSale.payment_method,
      customerName: (completedSale as any).customers?.name,
      currencySymbol: selectedShop?.currency || symbol,
    })
    shareReceiptWhatsApp(message)
  }

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full md:max-w-none md:flex-row md:gap-0 md:h-[calc(100dvh-6.5rem)] md:overflow-hidden">

      {/* ── LEFT column: search + products ── */}
      <div className="flex flex-col md:flex-1 md:overflow-hidden md:border-r md:border-border md:min-h-0">

      {/* Shop selector */}
      {isOwner && userShops.length > 1 && (
        <div className="relative">
          <button
            onClick={() => setShopPickerOpen(o => !o)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
              <span>Vendre dans : <strong>{selectedShop?.name || shop?.name}</strong></span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', shopPickerOpen && 'rotate-180')} />
          </button>
          {shopPickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShopPickerOpen(false)} />
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border bg-card shadow-lg p-1.5">
                {userShops.map(s => (
                  <button key={s.id}
                    onClick={() => { setSelectedShopId(s.id); setCart([]); setShopPickerOpen(false) }}
                    className={cn('w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
                      (selectedShopId || shop?.id) === s.id ? 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium' : 'hover:bg-accent text-foreground/80'
                    )}
                  >
                    <Store className="h-3.5 w-3.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">{s.name}</p>
                      {s.city && <p className="text-xs text-muted-foreground">{s.city}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Held invoices banner */}
      {shopDrafts.length > 0 && (
        <button
          onClick={() => setShowDrafts(true)}
          className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>{t('sales.invoices_pending', { count: shopDrafts.length })}</span>
          </div>
          <Badge className="bg-amber-500 text-white text-xs">{shopDrafts.length}</Badge>
        </button>
      )}

      {/* Sticky top area: search + categories */}
      <div className="flex flex-col gap-3 px-0 pt-2 md:pt-5 md:px-5 md:pb-2 md:sticky md:top-0 md:bg-background md:z-10 md:border-b md:border-border/50">
      {/* Active draft indicator */}
      {activeDraftId && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          <PlayCircle className="h-3.5 w-3.5" />
          Facture en attente reprise — validez ou remettez en attente
        </div>
      )}

      {/* Search + Scan */}
      <div className="flex gap-2">
        <div className={`relative flex-1 transition-all ${scanFlash ? 'ring-2 ring-green-400 rounded-lg' : ''}`}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && filteredProducts.length === 1) addToCart(filteredProducts[0]) }}
            placeholder={t('sales.search_or_scan')}
            className="pl-10 pr-8 h-12 text-base border-blue-500/30 focus:border-blue-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCameraScanner(v => !v)}
          className={`h-12 px-4 flex items-center gap-1.5 text-sm font-medium border rounded-lg transition-colors shrink-0 ${
            showCameraScanner
              ? 'bg-green-500 border-green-500 text-white'
              : 'bg-muted border-border hover:bg-accent'
          }`}
        >
          <Scan className="h-4 w-4" />
          Scan
        </button>
      </div>

      {showCameraScanner && (
        <BarcodeScanner
          onDetected={(code) => {
            handleBarcodeScan(code)
            setShowCameraScanner(false)
          }}
          onClose={() => setShowCameraScanner(false)}
        />
      )}

      <p className="text-xs text-muted-foreground -mt-2 px-1">
        {t('sales.scan_hint')}
      </p>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-0 scrollbar-hide">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-stockshop-blue text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('products.all_categories')}
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-stockshop-blue text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      </div>{/* end sticky header */}

      {/* Product grid scroll wrapper */}
      <div className="flex-1 md:overflow-y-auto md:px-5 md:pb-8 md:min-h-0">
      {/* Product grid */}
      <AnimatePresence>
        {(products.length > 0 || searchQuery) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto md:max-h-none md:grid-cols-3">
              {filteredProducts.slice(0, 50).map(product => (
                <button key={product.id} onClick={() => addToCart(product)}
                  className="flex flex-col items-start text-left rounded-lg border bg-card p-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors tap-target"
                >
                  <div className="flex items-start gap-2 w-full">
                    {product.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.image_url} alt={product.name} loading="lazy" decoding="async" className="h-9 w-9 object-cover rounded border border-border shrink-0" />
                    )}
                    <p className="text-sm font-medium truncate flex-1 text-foreground">{product.name}</p>
                  </div>
                  {product.sku && <p className="text-[10px] text-muted-foreground font-mono">{product.sku}</p>}
                  <div className="flex items-center justify-between w-full mt-1">
                    {effectivePrice(product, frontBatchPromo) !== product.selling_price ? (
                      <span className="flex items-center gap-1 flex-wrap">
                        <span className="text-sm font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(effectivePrice(product, frontBatchPromo))}</span>
                        <span className="text-[10px] text-muted-foreground line-through">{formatNaira(product.selling_price)}</span>
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.selling_price)}</span>
                    )}
                    <Badge
                      variant={
                        product.quantity === 0
                          ? 'destructive'
                          : product.quantity <= ((product as any).low_stock_threshold || shop?.low_stock_threshold || 10)
                          ? 'warning'
                          : 'success'
                      }
                      className="text-[10px] px-1.5"
                    >
                      {product.quantity} {product.unit}
                    </Badge>
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <p className="col-span-2 text-sm text-muted-foreground text-center py-4">Aucun produit trouvé</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>{/* end product grid scroll wrapper */}

      </div>{/* end LEFT column */}

      {/* ── RIGHT column: cart + payment ── */}
      <div className="flex flex-col gap-3 pb-24 md:pb-0 md:w-[400px] md:overflow-y-auto md:p-5 md:shrink-0 md:min-h-0">

      {/* Cart */}
      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 text-muted-foreground md:py-20">
          <div className="text-4xl mb-3">🛒</div>
          <p className="font-medium">{t('sales.cart_empty')}</p>
          <p className="text-sm mt-1">Cherche ou scanne un produit pour commencer</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {cart.map(item => (
              <motion.div key={item.product.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    {/* Row 1 : nom + corbeille */}
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-medium truncate">{item.product.name}</p>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFromCart(item.product.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {/* Row 2 : prix modifiable + quantité + sous-total */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setPriceModalItem(item); setPriceModalInput(String(item.unit_price)) }}
                        className="flex flex-col items-start gap-0.5 text-left group shrink-0"
                      >
                        <span className="text-xs font-medium text-muted-foreground group-hover:text-blue-600 transition-colors whitespace-nowrap">
                          {formatNaira(item.unit_price)}
                          {item.unit_price === effectivePrice(item.product, frontBatchPromo) && item.unit_price !== item.product.selling_price ? (
                            <span className="ml-1 text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-1 rounded font-medium">{t('products.promo_badge')}</span>
                          ) : item.unit_price !== item.product.selling_price && (
                            <span className="ml-1 text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1 rounded font-medium">modifié</span>
                          )}
                        </span>
                        <span className="flex items-center gap-0.5 text-[10px] text-blue-400/70 group-hover:text-blue-600 transition-colors">
                          <Edit2 className="h-2.5 w-2.5" />
                          modifier
                        </span>
                      </button>
                      <div className="flex-1" />
                      {/* Quantity controls */}
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(item.product.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={item.product.quantity}
                          value={qtyInputs[item.product.id] ?? String(item.quantity)}
                          onChange={e => {
                            const raw = e.target.value
                            setQtyInputs(prev => ({ ...prev, [item.product.id]: raw }))
                            const qty = parseInt(raw)
                            if (!isNaN(qty) && qty >= 1) setQtyDirect(item.product.id, qty)
                          }}
                          onBlur={() => setQtyInputs(prev => { const n = { ...prev }; delete n[item.product.id]; return n })}
                          className="w-12 h-7 text-center text-sm font-bold p-1"
                        />
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(item.product.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm font-bold min-w-[58px] text-right">{formatNaira(item.subtotal)}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Totals */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Label className="text-sm w-24 flex-shrink-0">{t('sales.discount')}</Label>
                <div className="flex flex-1 rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
                  <span className="flex items-center px-2.5 bg-muted border-r text-sm text-muted-foreground font-medium whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(discount, selectedShop?.currency || '₦')}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '')
                      setDiscount(Math.min(Number(digits) || 0, subtotal))
                    }}
                    className="flex-1 h-9 px-3 text-sm bg-card outline-none" placeholder="0" />
                </div>
              </div>
              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('sales.subtotal')}</span><span>{formatNaira(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>{t('sales.discount')}</span><span>-{formatNaira(discount)}</span>
                  </div>
                )}
                {tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t('sales.tax')}</span><span>+{formatNaira(tax)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t">
                  <span>{t('sales.total')}</span>
                  <span className="text-stockshop-blue dark:text-blue-400">{formatNaira(total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer — nom, prénom, téléphone */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <User className="h-4 w-4" /> Client <span className="text-muted-foreground font-normal text-xs">(optionnel)</span>
              </p>

              {/* Search existing customer */}
              <div className="relative">
                <Input
                  value={selectedCustomer ? selectedCustomer.name : customerName}
                  onChange={e => { setCustomerName(e.target.value); setSelectedCustomer(null); setShowCustomerDropdown(e.target.value.length > 0) }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                  placeholder="Nom complet du client…"
                />
                {(selectedCustomer || customerName) && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('') }}>
                    <X className="h-4 w-4" />
                  </button>
                )}
                {showCustomerDropdown && !selectedCustomer && filteredCustomers.length > 0 && (
                  <div className="absolute z-20 w-full bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {filteredCustomers.slice(0, 8).map(c => (
                      <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center"
                        onMouseDown={() => { setSelectedCustomer(c); setCustomerName(''); setCustomerPhone(c.phone || ''); setShowCustomerDropdown(false) }}>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Phone — only show if no existing customer selected or if walk-in */}
              {!selectedCustomer && (
                <Input
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="Numéro de téléphone (optionnel)"
                  type="tel"
                />
              )}

              {selectedCustomer && (
                <p className="text-xs text-muted-foreground">
                  Client existant · {selectedCustomer.phone || 'pas de téléphone'}
                  {Number(selectedCustomer.total_debt) > 0 && (
                    <span className="text-red-500 ml-2">· Solde dû: {formatNaira(selectedCustomer.total_debt)}</span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Debt repayment section ── */}
          {selectedCustomer && Number(selectedCustomer.total_debt) > 0 && customerUnpaidSales.length > 0 && (
            <Card className="border border-orange-200 bg-orange-50 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-orange-800">Inclure un remboursement de crédit</p>
                    <p className="text-xs text-orange-600">
                      Solde dû actuel : <strong>{formatNaira(selectedCustomer.total_debt)}</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => setDebtRepayEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      debtRepayEnabled ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
                      debtRepayEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                {debtRepayEnabled && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-800">Montant donné par le client pour le solde dû</Label>
                      <div className="flex rounded-md border border-orange-200 overflow-hidden focus-within:ring-2 focus-within:ring-orange-300">
                        <span className="flex items-center px-2.5 bg-orange-50 border-r border-orange-200 text-sm text-muted-foreground font-medium whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={formatInputValue(debtRepayAmount, selectedShop?.currency || '₦')}
                          onChange={e => setDebtRepayAmount(e.target.value.replace(/\D/g, ''))}
                          className="flex-1 h-11 px-3 text-base font-bold bg-card outline-none"
                          placeholder="0"
                        />
                      </div>
                      {Number(debtRepayAmount) > 0 && (
                        <p className="text-xs text-orange-600">
                          Reste après : <strong>{formatNaira(Math.max(0, Number(selectedCustomer.total_debt) - Number(debtRepayAmount)))}</strong>
                          {Number(debtRepayAmount) >= Number(selectedCustomer.total_debt) && ' ✓ Solde réglé'}
                        </p>
                      )}
                    </div>

                    {/* Résumé */}
                    {debtAmt > 0 && (
                      <div className="rounded-lg bg-card border border-orange-200 p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Vente</span><span>{formatNaira(total)}</span>
                        </div>
                        <div className="flex justify-between text-orange-700">
                          <span>Remboursement crédit</span><span>+{formatNaira(debtAmt)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t pt-1">
                          <span>Total à encaisser</span>
                          <span className="text-stockshop-blue dark:text-blue-400">{formatNaira(totalToCollect)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>
              {t('payment.method')}
              {splitPayment && <span className="text-xs text-muted-foreground ml-1">(1er paiement)</span>}
            </Label>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {getCountry(selectedShop?.country).paymentMethods.map(method => (
                <button key={method.id}
                  onClick={() => {
                    setPaymentMethod(method.id)
                    if (splitMethod2 === method.id) setSplitMethod2('')
                  }}
                  className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 tap-target ${
                    paymentMethod === method.id
                      ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-blue-100/60 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                      : 'border-input bg-card hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                  }`}
                >
                  {paymentMethod === method.id && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold">✓</span>
                  )}
                  <div className={`rounded-xl p-2 transition-colors ${paymentMethod === method.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                    {method.logo
                      ? <img src={method.logo} alt={method.label} className="h-12 w-12 object-contain" />
                      : <span className="text-3xl leading-none block">{method.icon}</span>
                    }
                  </div>
                  <span className={`text-xs font-semibold text-center leading-tight ${paymentMethod === method.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                    {method.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Normal (non-split) payment sections */}
          {!splitPayment && methodType === 'cash' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.amount_paid')}</Label>
                <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, selectedShop?.currency || '₦')}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 h-12 px-3 text-lg font-bold bg-card outline-none"
                    placeholder={formatInputValue(totalToCollect, selectedShop?.currency || '₦') || '0'} />
                </div>
              </div>
              {Number(amountPaid) > 0 && Number(amountPaid) >= totalToCollect && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                  <p className="text-sm text-muted-foreground">{t('payment.change_due')}</p>
                  <p className="text-2xl font-bold text-green-600">{formatNaira(change)}</p>
                </div>
              )}
              {Number(amountPaid) > 0 && Number(amountPaid) < totalToCollect && (
                <p className="text-xs text-red-500 text-center">
                  Manque {formatNaira(totalToCollect - Number(amountPaid))}
                </p>
              )}
            </div>
          )}

          {!splitPayment && (methodType === 'transfer' || methodType === 'mobile_money' || methodType === 'card') && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.reference')}</Label>
                <Input
                  value={transferRef}
                  onChange={e => setTransferRef(e.target.value)}
                  placeholder={
                    methodType === 'mobile_money' ? 'Numéro de transaction / téléphone' :
                    methodType === 'card' ? 'Référence POS / reçu' :
                    'Numéro de référence du virement'
                  }
                />
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                <p className="text-sm text-muted-foreground">Montant à recevoir</p>
                <p className="text-2xl font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(total)}</p>
              </div>
            </div>
          )}

          {!splitPayment && methodType === 'credit' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm font-medium text-amber-700">
                📝 Ajoute {formatNaira(total)} au solde dû de{' '}
                {selectedCustomer?.name || customerName || 'ce client'}
              </p>
              {!selectedCustomer && !customerName && (
                <p className="text-xs text-amber-600 mt-1">Entre un nom client ci-dessus pour le crédit</p>
              )}
            </div>
          )}

          {/* Split payment toggle */}
          {methodType !== 'credit' && (
            <button
              type="button"
              onClick={() => {
                if (!splitPayment) {
                  const other = getCountry(selectedShop?.country).paymentMethods
                    .find(m => m.id !== paymentMethod && m.id !== 'credit')
                  setSplitMethod2(other?.id || '')
                }
                setSplitPayment(!splitPayment)
                setAmountPaid('')
              }}
              className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {splitPayment ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {splitPayment ? 'Annuler le paiement mixte' : 'Paiement mixte (2 moyens)'}
            </button>
          )}

          {/* Split payment UI */}
          {splitPayment && (
            <div className="rounded-lg border border-dashed border-blue-300 dark:border-blue-700 p-3 space-y-3">
              {/* Amount for method 1 */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Montant payé en {getCountry(selectedShop?.country).paymentMethods.find(m => m.id === paymentMethod)?.label || paymentMethod}
                </Label>
                <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, selectedShop?.currency || '₦')}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 h-11 px-3 text-lg font-bold bg-card outline-none"
                    placeholder="0" />
                </div>
              </div>

              {/* Method 2 selector */}
              <div className="space-y-1.5">
                <Label className="text-sm">2ème moyen de paiement</Label>
                <div className="grid grid-cols-3 gap-2.5">
                  {getCountry(selectedShop?.country).paymentMethods
                    .filter(m => m.id !== paymentMethod && m.id !== 'credit')
                    .map(method => (
                      <button key={method.id} type="button" onClick={() => setSplitMethod2(method.id)}
                        className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 tap-target ${
                          splitMethod2 === method.id
                            ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-blue-100/60 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                            : 'border-input bg-card hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                        }`}
                      >
                        {splitMethod2 === method.id && (
                          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold">✓</span>
                        )}
                        <div className={`rounded-xl p-2 transition-colors ${splitMethod2 === method.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                          {method.logo
                            ? <img src={method.logo} alt={method.label} className="h-12 w-12 object-contain" />
                            : <span className="text-3xl leading-none block">{method.icon}</span>
                          }
                        </div>
                        <span className={`text-xs font-semibold text-center leading-tight ${splitMethod2 === method.id ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                          {method.label}
                        </span>
                      </button>
                    ))
                  }
                </div>
              </div>

              {/* Computed amount for method 2 */}
              {splitMethod2 && (
                <div className="rounded-lg bg-muted p-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Montant {getCountry(selectedShop?.country).paymentMethods.find(m => m.id === splitMethod2)?.label || splitMethod2}
                  </span>
                  <span className="font-bold text-lg text-stockshop-blue dark:text-blue-400">
                    {formatNaira(Math.max(0, totalToCollect - (Number(amountPaid) || 0)))}
                  </span>
                </div>
              )}

              {/* Warning if method 1 already covers everything */}
              {(Number(amountPaid) || 0) >= totalToCollect && Number(amountPaid) > 0 && (
                <p className="text-xs text-orange-500 text-center">
                  Ce montant couvre déjà tout le total — pas besoin d'un 2ème paiement
                </p>
              )}
            </div>
          )}


          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes (optionnel)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarques sur cette vente…" />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 h-12 gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={holdInvoice}
              disabled={cart.length === 0 || completing}
            >
              <PauseCircle className="h-4 w-4" />
              Mettre en attente
            </Button>
            <Button
              variant="stockshop"
              className="flex-[2] h-12 text-base"
              onClick={completeSale}
              loading={completing}
              disabled={cart.length === 0 || completing}
            >
              <CheckCircle className="mr-2 h-5 w-5" />
              {`Valider · ${formatNaira(totalToCollect)}`}
            </Button>
          </div>
        </div>
      )}

      </div>{/* end RIGHT column */}

      {/* Price edit modal — premium design */}
      <Dialog open={!!priceModalItem} onOpenChange={open => { if (!open) setPriceModalItem(null) }}>
        <DialogContent className="max-w-[360px] p-0 gap-0">
          {priceModalItem && (() => {
            const minPrice = effectivePrice(priceModalItem.product, frontBatchPromo)
            return (
            <div className="overflow-hidden rounded-lg">
              {/* Header gradient */}
              <div className="bg-stockshop-blue px-5 pt-5 pb-4">
                <p className="text-xs font-medium text-blue-200 uppercase tracking-wider mb-1">Prix de vente</p>
                <p className="text-white font-semibold text-base leading-tight truncate">{priceModalItem.product.name}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-blue-200">{minPrice !== priceModalItem.product.selling_price ? t('products.promo_badge') : 'Catalogue'} :</span>
                  <span className="text-sm font-bold text-white">{formatNaira(minPrice)}</span>
                  <span className="text-[10px] bg-white/20 text-blue-100 px-1.5 py-0.5 rounded-full">minimum</span>
                </div>
              </div>
              {/* Body */}
              <div className="p-5 space-y-4 bg-background">
                <div>
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Nouveau prix de vente</p>
                  <div className="flex rounded-xl border-2 border-stockshop-blue overflow-hidden shadow-sm">
                    <span className="flex items-center px-4 bg-stockshop-blue/5 border-r border-stockshop-blue/30 text-sm font-bold text-stockshop-blue whitespace-nowrap select-none">
                      {selectedShop?.currency || '₦'}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoFocus
                      value={formatInputValue(priceModalInput, selectedShop?.currency || '₦')}
                      onChange={e => setPriceModalInput(e.target.value.replace(/\D/g, ''))}
                      className="flex-1 h-14 px-4 text-2xl font-bold bg-card outline-none tracking-tight"
                      placeholder={formatInputValue(minPrice, selectedShop?.currency || '₦')}
                    />
                  </div>
                  <div className="h-5 mt-1.5">
                    {Number(priceModalInput) > 0 && Number(priceModalInput) < minPrice && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <span>⚠</span> Prix minimum : {formatNaira(minPrice)}
                      </p>
                    )}
                    {Number(priceModalInput) > minPrice && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <span>↑</span> +{formatNaira(Number(priceModalInput) - minPrice)} par rapport au catalogue
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setPriceModalItem(null)}>
                    Annuler
                  </Button>
                  <Button
                    variant="stockshop"
                    className="flex-1 h-11 rounded-xl font-semibold"
                    disabled={!priceModalInput || Number(priceModalInput) < minPrice}
                    onClick={() => {
                      updateItemPrice(priceModalItem.product.id, Number(priceModalInput))
                      setPriceModalItem(null)
                    }}
                  >
                    Confirmer
                  </Button>
              </div>
            </div>
            </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Drafts modal */}
      <PremiumDialog
        open={showDrafts}
        onOpenChange={setShowDrafts}
        category="Ventes"
        title="Factures en attente"
        icon={<Clock className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-2 max-h-80 overflow-y-auto">
          {shopDrafts.map(draft => {
            const draftTotal = draft.cart.reduce((s, i) => s + i.subtotal, 0) - draft.discount
            const itemCount = draft.cart.reduce((s, i) => s + i.quantity, 0)
            return (
              <div key={draft.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{draft.customerName || 'Client anonyme'}</p>
                    {draft.customerPhone && <p className="text-xs text-muted-foreground">{draft.customerPhone}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {itemCount} article{itemCount > 1 ? 's' : ''} ·{' '}
                      {new Date(draft.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(draftTotal)}</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {draft.cart.map(i => `${i.product.name} ×${i.quantity}`).join(', ')}
                </div>
                <div className="flex gap-2">
                  <Button variant="stockshop" size="sm" className="flex-1 h-8 gap-1" onClick={() => resumeDraft(draft)}>
                    <PlayCircle className="h-3.5 w-3.5" /> Reprendre
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-500 hover:bg-red-50"
                    onClick={() => deleteDraft(draft.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </PremiumDialogBody>
      </PremiumDialog>

      {/* Receipt Modal */}
      <PremiumDialog
        open={showReceipt}
        onOpenChange={setShowReceipt}
        category="Ventes"
        title={t('sales.receipt_ready')}
        icon={<CheckCircle className="h-4 w-4" />}
        centered
      >
        <PremiumDialogBody>
          {completedSale && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 border p-4 text-sm space-y-2">
                <div className="flex items-center gap-2 pb-2 border-b">
                  {selectedShop?.logo_url ? (
                    <img src={selectedShop.logo_url} alt={selectedShop.name} className="h-8 w-8 object-contain rounded" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {selectedShop?.name?.slice(0, 2).toUpperCase() || 'SS'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-xs truncate">{selectedShop?.name}</p>
                    {selectedShop?.city && <p className="text-[10px] text-muted-foreground">{selectedShop.city}</p>}
                  </div>
                </div>
                <div className="flex justify-between font-bold">
                  <span>#{completedSale.sale_number}</span>
                  <span>{new Date(completedSale.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {(completedSale as any).customers && (
                  <p className="text-xs text-muted-foreground">{t('sales.customer_label')} : {(completedSale as any).customers.name}</p>
                )}
                <Separator />
                {((completedSale as any).sale_items || []).map((item: any) => (
                  <div key={item.id} className="flex justify-between text-xs">
                    <span className="truncate">{item.product_name} × {item.quantity}</span>
                    <span className="font-medium flex-shrink-0 ml-2">{formatNaira(item.subtotal)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between font-bold text-base">
                  <span>TOTAL</span>
                  <span className="text-stockshop-blue dark:text-blue-400">{formatNaira(completedSale.total)}</span>
                </div>
                {Number(completedSale.balance) > 0 && (
                  <div className="flex justify-between text-red-500 text-xs">
                    <span>{t('sales.balance_due')}</span>
                    <span>{formatNaira(completedSale.balance)}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={handleWhatsAppReceipt} className="gap-2">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </Button>
                <Button variant="outline" onClick={handlePrintReceipt} className="gap-2">
                  {isCapacitor() ? <Share2 className="h-4 w-4" /> : <Printer className="h-4 w-4" />}
                  {isCapacitor() ? t('actions.share') : t('actions.print_receipt')}
                </Button>
              </div>
              <Button variant="stockshop" className="w-full h-11 rounded-xl font-semibold"
                onClick={() => { setShowReceipt(false) }}>
                {t('sales.new_sale_cta')}
              </Button>
            </div>
          )}
        </PremiumDialogBody>
      </PremiumDialog>
    </div>
  )
}
