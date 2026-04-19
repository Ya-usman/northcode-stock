'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Plus, Minus, Trash2, CheckCircle, MessageCircle, Printer,
  Scan, X, User, Store, ChevronDown, Clock, PauseCircle, PlayCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { cn } from '@/lib/utils/cn'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useCurrency } from '@/lib/hooks/use-currency'
import { generateReceiptPDF, generateReceiptPDFBlob } from '@/lib/utils/pdf'
import { shareReceiptWhatsApp, buildReceiptWhatsAppMessage } from '@/lib/utils/whatsapp'
import type { Product, Customer, CartItem, Sale, SaleItem, Category } from '@/lib/types/database'
import { cacheProducts, getCachedProducts, savePendingSale } from '@/lib/offline/db'
import { useOffline } from '@/lib/offline/use-offline'

interface Draft {
  id: string
  createdAt: string
  shopId: string
  cart: CartItem[]
  customerName: string
  customerPhone: string
  discount: number
  notes: string
  paymentMethod: 'cash' | 'transfer' | 'credit' | 'paystack'
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
  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null)
  const [shopPickerOpen, setShopPickerOpen] = useState(false)
  const selectedShop = userShops.find(s => s.id === (selectedShopId || shop?.id)) || shop
  const { fmt: formatNaira } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()
  const searchRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'credit' | 'paystack'>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [transferRef, setTransferRef] = useState('')
  const [notes, setNotes] = useState('')
  const { isOnline, refreshPendingCount } = useOffline()
  const [completing, setCompleting] = useState(false)
  const [completedSale, setCompletedSale] = useState<Sale & { sale_items: SaleItem[] } | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [scanFlash, setScanFlash] = useState(false)

  // Debt repayment included in sale
  const [customerUnpaidSales, setCustomerUnpaidSales] = useState<any[]>([])
  const [debtRepayEnabled, setDebtRepayEnabled] = useState(false)
  const [debtRepayAmount, setDebtRepayAmount] = useState('')

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

  useEffect(() => {
    if (!selectedShop?.id) return
    const load = async () => {
      // Offline: use IndexedDB cache
      if (!navigator.onLine) {
        const cached = await getCachedProducts(selectedShop.id)
        if (cached.length > 0) {
          setProducts(cached as unknown as Product[])
          setFilteredProducts(cached as unknown as Product[])
        }
        return
      }
      const [{ data: prods }, { data: custs }, { data: cats }] = await Promise.all([
        supabase.from('products').select('*, categories(name), suppliers(name)')
          .eq('shop_id', selectedShop.id).eq('is_active', true).gt('quantity', 0).order('name'),
        supabase.from('customers').select('*').eq('shop_id', selectedShop.id).order('name'),
        supabase.from('categories').select('*').eq('shop_id', selectedShop.id).order('name'),
      ])
      const safeProds = (prods || []) as unknown as Product[]
      setProducts(safeProds)
      setFilteredProducts(safeProds)
      setCustomers((custs || []) as Customer[])
      setCategories((cats || []) as Category[])
      // Cache products for offline use
      if (safeProds.length > 0) {
        await cacheProducts(selectedShop.id, safeProds.map((p: any) => ({
          id: p.id,
          shop_id: selectedShop.id,
          name: p.name,
          sku: p.sku ?? null,
          selling_price: Number(p.selling_price),
          buying_price: Number(p.buying_price),
          quantity: Number(p.quantity),
          category_id: p.category_id ?? null,
          is_active: p.is_active,
        })))
      }
    }
    load()
  }, [selectedShop?.id])

  useEffect(() => {
    let list = products
    if (categoryFilter !== 'all') {
      list = list.filter(p => p.category_id === categoryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.name_hausa?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
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
      return [...prev, { product, quantity: 1, unit_price: product.selling_price, subtotal: product.selling_price }]
    })
  }

  const addToCart = (product: Product) => {
    addToCartById(product)
    setSearchQuery('')
    searchRef.current?.focus()
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

  const resetForm = () => {
    setCart([])
    setDiscount(0)
    setAmountPaid('')
    setSelectedCustomer(null)
    setCustomerName('')
    setCustomerPhone('')
    setNotes('')
    setTransferRef('')
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
  // Montant total à encaisser = vente + remboursement dette si activé
  const debtAmt = debtRepayEnabled ? (Number(debtRepayAmount) || 0) : 0
  const totalToCollect = total + debtAmt
  // For credit: customer pays nothing now → paid = 0, balance = total
  // For cash: cap at total — the change given back is NOT revenue
  const paid = paymentMethod === 'cash'
    ? Math.min(Number(amountPaid) || 0, total)
    : paymentMethod === 'credit' ? 0 : total
  const change = paymentMethod === 'cash' ? Math.max(0, (Number(amountPaid) || 0) - totalToCollect) : 0
  const balance = Math.max(0, total - paid)

  const filteredCustomers = customerName
    ? customers.filter(c =>
        c.name.toLowerCase().includes(customerName.toLowerCase()) ||
        c.phone?.includes(customerName)
      )
    : customers

  // ── COMPLETE SALE ───────────────────────────────────────
  const completeSale = async () => {
    if (cart.length === 0) { toast({ title: t('toast.cart_empty'), variant: 'destructive' }); return }
    if (paymentMethod === 'credit' && !selectedCustomer && !customerName.trim()) {
      toast({ title: t('toast.customer_required_credit'), variant: 'destructive' }); return
    }
    if (paymentMethod === 'cash' && Number(amountPaid) < totalToCollect) {
      toast({ title: t('toast.insufficient_amount', { amount: formatNaira(totalToCollect) }), variant: 'destructive' }); return
    }

    setCompleting(true)

    // ── OFFLINE PATH ────────────────────────────────────────────────────────
    if (!navigator.onLine) {
      try {
        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const saleNumber = `HL-${localId.slice(-5).toUpperCase()}`
        await savePendingSale({
          local_id: localId,
          shop_id: selectedShop!.id,
          cashier_id: profile!.id,
          subtotal,
          discount: discountAmt,
          tax,
          total,
          payment_method: paymentMethod,
          payment_status: paymentMethod === 'credit'
            ? 'pending'
            : balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
          amount_paid: paid,
          balance,
          customer_name: customerName.trim() || selectedCustomer?.name || null,
          customer_phone: customerPhone.trim() || selectedCustomer?.phone || null,
          notes: notes || null,
          created_at: new Date().toISOString(),
          items: cart.map((item: any) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price,
          })),
          payment_amount: paymentMethod !== 'credit' ? paid : 0,
          payment_reference: paymentMethod === 'transfer' ? transferRef : null,
          synced: false,
        })
        await refreshPendingCount()
        // Build a fake completed sale for the receipt modal
        setCompletedSale({
          id: localId,
          sale_number: saleNumber,
          shop_id: selectedShop!.id,
          cashier_id: profile!.id,
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
          sale_items: cart.map((item: any) => ({
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
        toast({ title: 'Vente sauvegardée hors-ligne · sera synchronisée automatiquement', variant: 'success' })
      } catch (err: any) {
        toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
      } finally {
        setCompleting(false)
      }
      return
    }

    // ── ONLINE PATH ──────────────────────────────────────────────────────────
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

      const { data: sale, error: saleError } = await db
        .from('sales')
        .insert({
          shop_id: selectedShop!.id,
          customer_id: customerId,
          cashier_id: profile!.id,
          subtotal,
          discount: discountAmt,
          tax,
          total,
          payment_method: paymentMethod,
          payment_status: paymentMethod === 'credit'
            ? 'pending'
            : balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
          // Start at 0 — the DB trigger (after_payment_insert) will add the payment amount.
          // Setting paid here would cause the trigger to double it.
          amount_paid: 0,
          sale_status: 'active',
          notes: notes || null,
          paystack_reference: paymentMethod === 'paystack' ? `PAY-${Date.now()}` : null,
        })
        .select()
        .single()

      if (saleError || !sale) throw saleError || new Error('Erreur création vente')

      const { error: itemsError } = await db.from('sale_items').insert(
        cart.map((item: any) => ({
          sale_id: sale.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))
      )
      if (itemsError) throw itemsError

      if (paymentMethod !== 'credit' && paid > 0) {
        await db.from('payments').insert({
          sale_id: sale.id,
          amount: paid,
          method: paymentMethod,
          reference: paymentMethod === 'transfer' ? transferRef : null,
          received_by: profile!.id,
        })
      }

      // Include debt repayment — FIFO via admin route (bypasses RLS)
      if (debtRepayEnabled && Number(debtRepayAmount) > 0 && customerUnpaidSales.length > 0) {
        await fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unpaid_sale_ids: customerUnpaidSales.map((s: any) => s.id),
            amount: Number(debtRepayAmount),
            method: paymentMethod === 'credit' ? 'cash' : paymentMethod,
            reference: paymentMethod === 'transfer' ? transferRef : null,
            notes: `Inclus dans la vente #${(sale as any).sale_number}`,
            shop_id: selectedShop!.id,
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
      toast({ title: t('sales.receipt_ready'), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally {
      setCompleting(false)
    }
  }

  const handlePrintReceipt = async () => {
    if (!completedSale || !shop) return
    await generateReceiptPDF({
      sale: completedSale as any,
      shop: selectedShop as any,
      cashierName: profile?.full_name || '',
      customerName: (completedSale as any).customers?.name,
    })
  }

  const handleWhatsAppReceipt = async () => {
    if (!completedSale || !shop) return
    const fileName = `Receipt-${completedSale.sale_number}.pdf`
    try {
      const blob = await generateReceiptPDFBlob({
        sale: completedSale as any,
        shop: selectedShop as any,
        cashierName: profile?.full_name || '',
        customerName: (completedSale as any).customers?.name,
      })
      const file = new File([blob], fileName, { type: 'application/pdf' })
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Receipt #${completedSale.sale_number}` })
        return
      }
      // Fallback: download PDF then open WhatsApp
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
      URL.revokeObjectURL(url)
    } catch {
      // If PDF fails, fall back to text message
    }
    // Open WhatsApp with text summary
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
    })
    shareReceiptWhatsApp(message)
  }

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-4 max-w-2xl mx-auto">

      {/* Shop selector */}
      {isOwner && userShops.length > 1 && (
        <div className="relative">
          <button
            onClick={() => setShopPickerOpen(o => !o)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-accent transition-colors"
          >
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-northcode-blue" />
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
                      (selectedShopId || shop?.id) === s.id ? 'bg-northcode-blue-muted text-northcode-blue font-medium' : 'hover:bg-accent text-foreground/80'
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

      {/* Active draft indicator */}
      {activeDraftId && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          <PlayCircle className="h-3.5 w-3.5" />
          Facture en attente reprise — validez ou remettez en attente
        </div>
      )}

      {/* Search + Scan */}
      <div className={`relative transition-all ${scanFlash ? 'ring-2 ring-green-400 rounded-lg' : ''}`}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && filteredProducts.length === 1) addToCart(filteredProducts[0]) }}
          placeholder={t('sales.search_or_scan')}
          className="pl-10 pr-12 h-12 text-base border-northcode-blue/30 focus:border-northcode-blue"
          autoFocus
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
          <Scan className={`h-5 w-5 transition-colors ${scanFlash ? 'text-green-500' : 'text-muted-foreground'}`} />
        </div>
      </div>

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
                ? 'bg-northcode-blue text-white'
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
                  ? 'bg-northcode-blue text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Product grid */}
      <AnimatePresence>
        {(products.length > 0 || searchQuery) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {filteredProducts.slice(0, 50).map(product => (
                <button key={product.id} onClick={() => addToCart(product)}
                  className="flex flex-col items-start text-left rounded-lg border bg-card p-3 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors tap-target"
                >
                  <p className="text-sm font-medium truncate w-full text-foreground">{product.name}</p>
                  {product.name_hausa && <p className="text-xs text-muted-foreground truncate w-full">{product.name_hausa}</p>}
                  {product.sku && <p className="text-[10px] text-muted-foreground font-mono">{product.sku}</p>}
                  <div className="flex items-center justify-between w-full mt-1">
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{formatNaira(product.selling_price)}</span>
                    <Badge variant={product.quantity <= 5 ? 'warning' : 'success'} className="text-[10px] px-1.5">
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

      {/* Cart */}
      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 text-muted-foreground">
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
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNaira(item.unit_price)} / unité</p>
                      </div>
                      {/* Quantity controls */}
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQty(item.product.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={item.product.quantity}
                          value={item.quantity}
                          onChange={e => setQtyDirect(item.product.id, parseInt(e.target.value))}
                          className="w-14 h-8 text-center text-sm font-bold p-1"
                        />
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQty(item.product.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right min-w-[70px]">
                        <p className="text-sm font-bold">{formatNaira(item.subtotal)}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFromCart(item.product.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
                  <input type="number" min={0} max={subtotal} value={discount || ''} onChange={e => setDiscount(Math.min(Number(e.target.value), subtotal))} className="flex-1 h-9 px-3 text-sm bg-card outline-none" placeholder="0" />
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
                  <span className="text-northcode-blue">{formatNaira(total)}</span>
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
                    <span className="text-red-500 ml-2">· Dette: {formatNaira(selectedCustomer.total_debt)}</span>
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
                    <p className="text-sm font-semibold text-orange-800">Inclure un remboursement de dette</p>
                    <p className="text-xs text-orange-600">
                      Dette actuelle : <strong>{formatNaira(selectedCustomer.total_debt)}</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => setDebtRepayEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      debtRepayEnabled ? 'bg-northcode-blue' : 'bg-gray-300'
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
                      <Label className="text-xs text-orange-800">Montant donné par le client pour la dette</Label>
                      <div className="flex rounded-md border border-orange-200 overflow-hidden focus-within:ring-2 focus-within:ring-orange-300">
                        <span className="flex items-center px-2.5 bg-orange-50 border-r border-orange-200 text-sm text-muted-foreground font-medium whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                        <input
                          type="number"
                          value={debtRepayAmount}
                          onChange={e => setDebtRepayAmount(e.target.value)}
                          className="flex-1 h-11 px-3 text-base font-bold bg-card outline-none"
                          min={1}
                          placeholder="0"
                        />
                      </div>
                      {Number(debtRepayAmount) > 0 && (
                        <p className="text-xs text-orange-600">
                          Reste après : <strong>{formatNaira(Math.max(0, Number(selectedCustomer.total_debt) - Number(debtRepayAmount)))}</strong>
                          {Number(debtRepayAmount) >= Number(selectedCustomer.total_debt) && ' ✓ Dette soldée'}
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
                          <span>Remboursement dette</span><span>+{formatNaira(debtAmt)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t pt-1">
                          <span>Total à encaisser</span>
                          <span className="text-northcode-blue">{formatNaira(totalToCollect)}</span>
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
            <Label>{t('payment.method')}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['cash', 'transfer', 'credit', 'paystack'] as const).map(method => (
                <button key={method} onClick={() => setPaymentMethod(method)}
                  className={`rounded-lg border p-3 text-sm font-medium transition-colors tap-target ${
                    paymentMethod === method
                      ? 'border-northcode-blue bg-northcode-blue-muted text-northcode-blue'
                      : 'border-input bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {method === 'cash' && '💵 '}
                  {method === 'transfer' && '🏦 '}
                  {method === 'credit' && '📝 '}
                  {method === 'paystack' && '💳 '}
                  {t(`payment.${method}`)}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.amount_paid')}</Label>
                <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{selectedShop?.currency || '₦'}</span>
                  <input type="number" min={0} value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                    className="flex-1 h-12 px-3 text-lg font-bold bg-card outline-none" placeholder={totalToCollect.toString()} />
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

          {paymentMethod === 'transfer' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.reference')}</Label>
                <Input value={transferRef} onChange={e => setTransferRef(e.target.value)} placeholder="Numéro de référence du virement" />
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                <p className="text-sm text-muted-foreground">Montant à recevoir</p>
                <p className="text-2xl font-bold text-northcode-blue">{formatNaira(total)}</p>
              </div>
            </div>
          )}

          {paymentMethod === 'credit' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm font-medium text-amber-700">
                📝 Ajoute {formatNaira(total)} à la dette de{' '}
                {selectedCustomer?.name || customerName || 'ce client'}
              </p>
              {!selectedCustomer && !customerName && (
                <p className="text-xs text-amber-600 mt-1">Entre un nom client ci-dessus pour le crédit</p>
              )}
            </div>
          )}

          {paymentMethod === 'paystack' && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
              <p className="text-sm text-northcode-blue font-medium">{t('payment.paystack_link')}</p>
              <p className="text-2xl font-bold text-northcode-blue mt-1">{formatNaira(total)}</p>
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
              disabled={cart.length === 0}
            >
              <PauseCircle className="h-4 w-4" />
              Mettre en attente
            </Button>
            <Button
              className="flex-[2] h-12 text-base bg-northcode-blue hover:bg-northcode-blue-light"
              onClick={completeSale}
              loading={completing}
              disabled={cart.length === 0}
            >
              <CheckCircle className="mr-2 h-5 w-5" />
              {`Valider · ${formatNaira(totalToCollect)}`}
            </Button>
          </div>
        </div>
      )}

      {/* Drafts modal */}
      <Dialog open={showDrafts} onOpenChange={setShowDrafts}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Factures en attente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
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
                      <p className="font-bold text-northcode-blue">{formatNaira(draftTotal)}</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {draft.cart.map(i => `${i.product.name} ×${i.quantity}`).join(', ')}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 h-8 bg-northcode-blue gap-1" onClick={() => resumeDraft(draft)}>
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              {t('sales.receipt_ready')}
            </DialogTitle>
          </DialogHeader>
          {completedSale && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 border p-4 text-sm space-y-2">
                {/* Shop header */}
                <div className="flex items-center gap-2 pb-2 border-b">
                  {selectedShop?.logo_url ? (
                    <img src={selectedShop.logo_url} alt={selectedShop.name} className="h-8 w-8 object-contain rounded" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-northcode-blue flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {selectedShop?.name?.slice(0, 2).toUpperCase() || 'NC'}
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
                  <span className="text-northcode-blue">{formatNaira(completedSale.total)}</span>
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
                  <Printer className="h-4 w-4" /> {t('actions.print_receipt')}
                </Button>
              </div>
              <Button className="w-full bg-northcode-blue hover:bg-northcode-blue-light"
                onClick={() => { setShowReceipt(false); searchRef.current?.focus() }}>
                {t('sales.new_sale_cta')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
