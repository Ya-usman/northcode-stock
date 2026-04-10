'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, Minus, Trash2, CheckCircle, MessageCircle, Printer, Scan, X, User, Store, ChevronDown } from 'lucide-react'
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
import { generateReceiptPDF } from '@/lib/utils/pdf'
import { shareReceiptWhatsApp, buildReceiptWhatsAppMessage } from '@/lib/utils/whatsapp'
import type { Product, Customer, CartItem, Sale, SaleItem } from '@/lib/types/database'

export default function NewSalePage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
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
  const [products, setProducts] = useState<Product[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState('') // free text for walk-in
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'credit' | 'paystack'>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [transferRef, setTransferRef] = useState('')
  const [notes, setNotes] = useState('')
  const [completing, setCompleting] = useState(false)
  const [completedSale, setCompletedSale] = useState<Sale & { sale_items: SaleItem[] } | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [scanFlash, setScanFlash] = useState(false)

  // Barcode scanner detection (keyboard wedge)
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<NodeJS.Timeout | null>(null)

  // Load products and customers
  useEffect(() => {
    if (!selectedShop?.id) return
    const load = async () => {
      const [{ data: prods }, { data: custs }] = await Promise.all([
        supabase.from('products').select('*, categories(name), suppliers(name)')
          .eq('shop_id', selectedShop.id).eq('is_active', true).gt('quantity', 0).order('name'),
        supabase.from('customers').select('*').eq('shop_id', selectedShop.id).order('name'),
      ])
      setProducts((prods || []) as unknown as Product[])
      setFilteredProducts((prods || []) as unknown as Product[])
      setCustomers((custs || []) as Customer[])
    }
    load()
  }, [selectedShop?.id])

  // Filter products on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredProducts(products)
      return
    }
    const q = searchQuery.toLowerCase()
    setFilteredProducts(products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.name_hausa?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    ))
  }, [searchQuery, products])

  // Barcode scanner: detect rapid keystrokes ending with Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input (except our search ref)
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // Only capture if it's a scanner (very fast, ends with Enter)
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
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = ''
        }, 120) // scanner types < 120ms per char
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
      toast({ title: `✓ ${product.name} ajouté`, variant: 'success' })
    } else {
      toast({ title: `Code non trouvé: ${code}`, variant: 'destructive' })
    }
  }, [products, toast])

  const addToCartById = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.quantity) {
          toast({ title: `Stock max: ${product.quantity} ${product.unit}`, variant: 'destructive' })
          return prev
        }
        return prev.map(i =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unit_price }
            : i
        )
      }
      return [...prev, {
        product,
        quantity: 1,
        unit_price: product.selling_price,
        subtotal: product.selling_price,
      }]
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
          toast({ title: `Max stock: ${item.product.quantity}`, variant: 'destructive' })
          return item
        }
        return { ...item, quantity: newQty, subtotal: newQty * item.unit_price }
      })
      .filter(Boolean) as CartItem[]
    )
  }

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const discountAmt = discount
  const tax = Number(selectedShop?.tax_rate || 0) > 0 ? (subtotal - discountAmt) * (selectedShop!.tax_rate / 100) : 0
  const total = subtotal - discountAmt + tax
  const paid = paymentMethod === 'cash' ? Number(amountPaid) || 0 : total
  const change = paymentMethod === 'cash' ? Math.max(0, paid - total) : 0
  const balance = Math.max(0, total - paid)

  const filteredCustomers = customerName
    ? customers.filter(c =>
        c.name.toLowerCase().includes(customerName.toLowerCase()) ||
        c.phone?.includes(customerName)
      )
    : customers

  const completeSale = async () => {
    if (cart.length === 0) {
      toast({ title: 'Panier vide', variant: 'destructive' })
      return
    }
    if (paymentMethod === 'credit' && !selectedCustomer && !customerName.trim()) {
      toast({ title: 'Entre un nom de client pour une vente à crédit', variant: 'destructive' })
      return
    }
    if (paymentMethod === 'cash' && Number(amountPaid) < total) {
      toast({ title: `Montant insuffisant (${formatNaira(Number(amountPaid))})`, variant: 'destructive' })
      return
    }

    setCompleting(true)
    try {
      const db = supabase as any

      const { data: sale, error: saleError } = await db
        .from('sales')
        .insert({
          shop_id: selectedShop!.id,
          customer_id: selectedCustomer?.id || null,
          cashier_id: profile!.id,
          subtotal,
          discount: discountAmt,
          tax,
          total,
          payment_method: paymentMethod,
          payment_status: balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
          amount_paid: paymentMethod === 'credit' ? 0 : paid,
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

      const { data: fullSale } = await db
        .from('sales')
        .select('*, sale_items(*), customers(*)')
        .eq('id', sale.id)
        .single()

      setCompletedSale(fullSale as any)
      setShowReceipt(true)
      setCart([])
      setDiscount(0)
      setAmountPaid('')
      setSelectedCustomer(null)
      setCustomerName('')
      setNotes('')
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
      sale: completedSale,
      shop: selectedShop as any,
      cashierName: profile?.full_name || '',
      customerName: completedSale.customers?.name,
    })
  }

  const handleWhatsAppReceipt = () => {
    if (!completedSale || !shop) return
    const message = buildReceiptWhatsAppMessage({
      shopName: selectedShop?.name || '',
      saleNumber: completedSale.sale_number,
      date: new Date(completedSale.created_at).toLocaleString('en-NG'),
      items: completedSale.sale_items.map(i => ({
        name: i.product_name,
        qty: i.quantity,
        price: i.unit_price,
      })),
      total: completedSale.total,
      paid: completedSale.amount_paid,
      balance: completedSale.balance,
      method: completedSale.payment_method,
      customerName: completedSale.customers?.name,
    })
    shareReceiptWhatsApp(message)
  }

  return (
    <div className="flex flex-col h-full gap-4 max-w-2xl mx-auto">

      {/* Shop selector — visible only for owners with multiple shops */}
      {isOwner && userShops.length > 1 && (
        <div className="relative">
          <button
            onClick={() => setShopPickerOpen(o => !o)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-medium shadow-sm hover:bg-gray-50 transition-colors"
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
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border bg-white shadow-lg p-1.5">
                {userShops.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedShopId(s.id); setCart([]); setShopPickerOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
                      (selectedShopId || shop?.id) === s.id
                        ? 'bg-northcode-blue-muted text-northcode-blue font-medium'
                        : 'hover:bg-gray-50 text-gray-700'
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

      {/* Search + Scan */}
      <div className={`relative transition-all ${scanFlash ? 'ring-2 ring-green-400 rounded-lg' : ''}`}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && filteredProducts.length === 1) {
              addToCart(filteredProducts[0])
            }
          }}
          placeholder="Chercher produit ou scanner code-barres…"
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

      {/* Hint scanner */}
      <p className="text-xs text-muted-foreground -mt-2 px-1">
        Tape le nom, SKU ou scanne le code-barres avec un lecteur USB/Bluetooth
      </p>

      {/* Product grid */}
      <AnimatePresence>
        {searchQuery && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {filteredProducts.slice(0, 20).map(product => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="flex flex-col items-start text-left rounded-lg border bg-white p-3 hover:border-northcode-blue hover:bg-northcode-blue-muted transition-colors tap-target"
                >
                  <p className="text-sm font-medium truncate w-full">{product.name}</p>
                  {product.name_hausa && (
                    <p className="text-xs text-muted-foreground truncate w-full">{product.name_hausa}</p>
                  )}
                  {product.sku && (
                    <p className="text-[10px] text-muted-foreground font-mono">{product.sku}</p>
                  )}
                  <div className="flex items-center justify-between w-full mt-1">
                    <span className="text-sm font-bold text-northcode-blue">
                      {formatNaira(product.selling_price)}
                    </span>
                    <Badge
                      variant={product.quantity <= 5 ? 'warning' : 'success'}
                      className="text-[10px] px-1.5"
                    >
                      {product.quantity} {product.unit}
                    </Badge>
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <p className="col-span-2 text-sm text-muted-foreground text-center py-4">
                  Aucun produit trouvé
                </p>
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
              <motion.div
                key={item.product.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <Card className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNaira(item.unit_price)} / unité</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQty(item.product.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateQty(item.product.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right min-w-[70px]">
                        <p className="text-sm font-bold">{formatNaira(item.subtotal)}</p>
                      </div>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeFromCart(item.product.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Totals + discount */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Label className="text-sm w-24 flex-shrink-0">{t('sales.discount')}</Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{selectedShop?.currency || '₦'}</span>
                  <Input
                    type="number" min={0} max={subtotal}
                    value={discount || ''}
                    onChange={e => setDiscount(Math.min(Number(e.target.value), subtotal))}
                    className="pl-7 h-9" placeholder="0"
                  />
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

          {/* Customer — optional, free text or select existing */}
          <div className="space-y-1.5 relative">
            <Label className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              Client <span className="text-muted-foreground font-normal text-xs">(optionnel)</span>
            </Label>
            <div className="relative">
              <Input
                value={selectedCustomer ? selectedCustomer.name : customerName}
                onChange={e => {
                  setCustomerName(e.target.value)
                  setSelectedCustomer(null)
                  setShowCustomerDropdown(e.target.value.length > 0)
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                placeholder="Tape un nom, téléphone, ou laisse vide…"
                className="pr-8"
              />
              {(selectedCustomer || customerName) && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSelectedCustomer(null); setCustomerName('') }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Dropdown: existing customers matching search */}
            {showCustomerDropdown && !selectedCustomer && filteredCustomers.length > 0 && (
              <div className="absolute z-20 w-full bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredCustomers.slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center"
                    onMouseDown={() => { setSelectedCustomer(c); setCustomerName(''); setShowCustomerDropdown(false) }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>{t('payment.method')}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['cash', 'transfer', 'credit', 'paystack'] as const).map(method => (
                <button
                  key={method}
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-lg border p-3 text-sm font-medium transition-colors tap-target ${
                    paymentMethod === method
                      ? 'border-northcode-blue bg-northcode-blue-muted text-northcode-blue'
                      : 'border-input bg-white text-muted-foreground hover:bg-muted'
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

          {/* Payment details */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.amount_paid')}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-medium text-muted-foreground">{selectedShop?.currency || '₦'}</span>
                  <Input
                    type="number" min={0}
                    value={amountPaid}
                    onChange={e => setAmountPaid(e.target.value)}
                    className="pl-7 h-12 text-lg font-bold"
                    placeholder={total.toString()}
                  />
                </div>
              </div>
              {Number(amountPaid) > 0 && Number(amountPaid) >= total && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                  <p className="text-sm text-muted-foreground">{t('payment.change_due')}</p>
                  <p className="text-2xl font-bold text-green-600">{formatNaira(change)}</p>
                </div>
              )}
            </div>
          )}

          {paymentMethod === 'transfer' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('payment.reference')}</Label>
                <Input
                  value={transferRef}
                  onChange={e => setTransferRef(e.target.value)}
                  placeholder="Numéro de référence du virement bancaire"
                />
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
              <Button
                variant="outline"
                className="mt-2 border-northcode-blue text-northcode-blue"
                onClick={() => {
                  const ref = `PAY-${Date.now()}`
                  const url = `https://paystack.com/pay/${process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY}?amount=${total * 100}&reference=${ref}`
                  window.open(url, '_blank')
                }}
              >
                Ouvrir Paystack
              </Button>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes (optionnel)</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Remarques sur cette vente…"
            />
          </div>

          {/* Complete sale */}
          <Button
            className="w-full h-14 text-lg bg-northcode-blue hover:bg-northcode-blue-light"
            onClick={completeSale}
            loading={completing}
            disabled={cart.length === 0}
          >
            <CheckCircle className="mr-2 h-5 w-5" />
            {t('actions.complete_sale')} · {formatNaira(total)}
          </Button>
        </div>
      )}

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
              <div className="rounded-lg bg-gray-50 border p-4 text-sm space-y-2">
                <div className="flex justify-between font-bold">
                  <span>#{completedSale.sale_number}</span>
                  <span>{new Date(completedSale.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <Separator />
                {completedSale.sale_items?.map(item => (
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
                    <span>Solde dû</span>
                    <span>{formatNaira(completedSale.balance)}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={handleWhatsAppReceipt} className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </Button>
                <Button variant="outline" onClick={handlePrintReceipt} className="gap-2">
                  <Printer className="h-4 w-4" />
                  {t('actions.print_receipt')}
                </Button>
              </div>

              <Button
                className="w-full bg-northcode-blue hover:bg-northcode-blue-light"
                onClick={() => { setShowReceipt(false); searchRef.current?.focus() }}
              >
                Nouvelle vente →
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
