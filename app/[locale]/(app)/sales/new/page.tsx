'use client'

import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Plus, Minus, Trash2, CheckCircle, MessageCircle, Printer, Share2,
  Scan, X, User, Clock, PauseCircle, PlayCircle, Edit2, ShoppingCart, ChevronUp, Star, ArrowLeft,
  AlertTriangle, Coins, CreditCard,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { ShopSelector } from '@/components/layout/shop-selector'
import { ProductCard, type StockVariant } from '@/components/sales/product-card'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
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
import { cacheProducts, getCachedProducts, cacheCustomers, getCachedCustomers, savePendingSale, savePendingCustomerPayment, type PendingSalePayment } from '@/lib/offline/db'
import { allocateCheckout, outstandingDebt } from '@/lib/utils/checkout-allocation'
import { revalidateHeldCart, heldAgeDays, HELD_STALE_DAYS, type HeldCartChange } from '@/lib/utils/held-sales'
import { clearPageCache, clearPageCacheByPrefix } from '@/lib/offline/page-cache'
import { cashSuggestions } from '@/lib/utils/cash-suggestions'
import { registerBackgroundSync } from '@/lib/offline/sync'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-1 h-12 rounded-xl bg-muted animate-pulse" /> }
)
import { useOffline } from '@/lib/offline/use-offline'
import { triggerSaleFeedback, unlockAudio } from '@/lib/utils/sale-feedback'
import { getCountry, getMethodType } from '@/lib/saas/countries'
import { withTimeout, refreshSessionBeforeWrite } from '@/lib/utils/with-timeout'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useStockRealtime } from '@/lib/hooks/use-realtime'
import { queryClient } from '@/lib/query-client'
import { invalidateSalesData } from '@/lib/query-keys'
import { formatInputValue, formatCurrency } from '@/lib/utils/currency'
import { checkAndNotifyLowStock, notifyNewSale } from '@/lib/push'

// Prix effectif d'un produit : priorité au prix promo du lot FEFO en tête
// de file (celui qui sera réellement vendu en premier — voir
// frontBatchPromo, construit dans loadShopData), sinon la promo produit
// (091), sinon le prix catalogue. Le prix du lot revient automatiquement
// au prix produit/catalogue dès que ce lot est épuisé, puisque
// frontBatchPromo n'est construit qu'à partir des lots avec quantity > 0 —
// aucune action manuelle nécessaire (voir migration 095).
function effectivePrice(product: Product, frontBatchPromo?: Record<string, { price: number; until: string; start: string | null }>): number {
  const now = new Date().toISOString()
  const batchPromo = frontBatchPromo?.[product.id]
  if (batchPromo && batchPromo.until >= now && (!batchPromo.start || batchPromo.start <= now)) {
    return batchPromo.price
  }
  if (product.promo_price && product.promo_until && product.promo_until >= now && (!product.promo_start || product.promo_start <= now)) {
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
  /** Client EXISTANT lié — sans lui, la reprise ne gardait que le nom et
   *  la validation recréait un doublon du client (dette comprise). */
  customerId?: string | null
  /** Nom libre donné à la mise en attente (« Table 3 », « Mme Fatou »). */
  label?: string
  /** Produits dont le prix avait été modifié à la main (conservé à la
   *  reprise ; les autres suivent le prix actuel). */
  manualPriceIds?: string[]
}

const DRAFTS_KEY = 'nc_sale_drafts'

// Grille produits : lot affiché, puis lots suivants chargés automatiquement
// au défilement (voir le sentinel IntersectionObserver dans le rendu).
const PRODUCTS_PAGE_SIZE = 50

/** Filtre catégorie + recherche (nom ou SKU, insensible aux accents) —
 *  `searchIndex` = texte normalisé par produit, précalculé une fois. */
function filterProducts(
  products: Product[],
  categoryFilter: string,
  query: string,
  searchIndex: Map<string, string>,
): Product[] {
  let list = products
  if (categoryFilter !== 'all') list = list.filter(p => p.category_id === categoryFilter)
  const q = normalize(query.trim())
  if (q) list = list.filter(p => (searchIndex.get(p.id) ?? '').includes(q))
  return list
}

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
  const { fmt: _fmtGlobal, code: currencyCode, symbol } = useCurrency()
  // Code ISO + symbole résolus depuis la boutique active (via useCurrency,
  // qui normalise shop.currency + shop.country). Les prix restent en phase
  // avec le sélecteur de boutique.
  const formatNaira = (amount: number | string | null | undefined) => formatCurrency(amount, currencyCode)
  const supabase = createClient()
  const { toast } = useToast()
  const searchRef = useRef<HTMLInputElement>(null)
  const cartSectionRef = useRef<HTMLDivElement>(null)
  // Panneau panier plein écran (téléphone uniquement, voir le rendu).
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  // Téléphone : deux étapes dans le panneau — 'cart' (articles, client,
  // dette → « Encaisser ») puis 'payment' (moyen de paiement → « Valider »).
  // Sans effet sur le desktop (colonne unique, tout visible).
  const [mobileStep, setMobileStep] = useState<'cart' | 'payment'>('cart')
  // Sections repliées sur téléphone tant qu'elles sont vides (« + Ajouter… »).
  const [showDiscount, setShowDiscount] = useState(false)
  const [showCustomer, setShowCustomer] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [products, setProducts] = useState<Product[]>([])
  const [frontBatchPromo, setFrontBatchPromo] = useState<Record<string, { price: number; until: string; start: string | null }>>({})
  // Lot le plus proche de la péremption (FEFO) déjà périmé → la prochaine
  // vente de ce produit y puisera forcément en premier. Purement informatif
  // (voir plafond de crédit) : jamais bloquant, la vente reste possible.
  const [frontBatchExpired, setFrontBatchExpired] = useState<Record<string, boolean>>({})
  const [categories, setCategories] = useState<Category[]>([])
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
  const [dueDate, setDueDate] = useState('')
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
  // Saisie au-delà de la dette réelle : ramenée au plafond, avec un message.
  const [debtCapped, setDebtCapped] = useState(false)
  // Remboursement de dette encaissé avec la dernière vente — affiché sur le
  // reçu (écran, PDF, WhatsApp) avec son état d'enregistrement.
  const [receiptDebt, setReceiptDebt] = useState<{ amount: number; status: 'applied' | 'queued' | 'failed' } | null>(null)

  // Raw quantity input values (allows clearing/retyping without snap-back)
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({})
  // Price edit modal
  const [priceModalItem, setPriceModalItem] = useState<typeof cart[0] | null>(null)
  const [priceModalInput, setPriceModalInput] = useState<string>('')

  // Drafts (held invoices)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  // Mise en attente : petite fenêtre pour un nom facultatif.
  const [showHoldDialog, setShowHoldDialog] = useState(false)
  const [holdLabel, setHoldLabel] = useState('')
  // Reprise demandée alors qu'un autre panier est en cours → confirmation.
  const [pendingResume, setPendingResume] = useState<Draft | null>(null)

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
    if (!shop?.id) return
    // Always show IndexedDB cache immediately (stale-while-revalidate)
    const [cachedProds, cachedCusts] = await Promise.all([
      getCachedProducts(shop.id),
      getCachedCustomers(shop.id),
    ])
    if (cachedProds.length > 0) {
      // Rebuild the nested categories(name, color) shape the rest of the
      // page expects — the IndexedDB cache stores it flattened.
      const shaped = cachedProds.map((p: any) => ({
        ...p,
        categories: (p.category_name || p.category_color)
          ? { name: p.category_name, color: p.category_color }
          : undefined,
      })) as unknown as Product[]
      setProducts(shaped)
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
      const [prodsRes, custsRes, catsRes, batchesRes] = await withTimeout(Promise.all([
        supabase.from('products').select('*, categories(name, color), suppliers(name)')
          .eq('shop_id', shop.id).eq('is_active', true).gt('quantity', 0).order('name'),
        supabase.from('customers').select('*').eq('shop_id', shop.id).order('name'),
        supabase.from('categories').select('*').eq('shop_id', shop.id).order('name'),
        supabase.from('product_batches')
          .select('product_id, expiry_date, received_at, promo_price, promo_until, promo_start')
          .eq('shop_id', shop.id).gt('quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false })
          .order('received_at', { ascending: true }),
      ]), 20_000, 'Chargement des produits trop lent — réessayez.')
      // A transient auth/RLS hiccup (session mid-refresh right after the tab
      // resumes from background) can resolve with data: null instead of
      // throwing — silently wiping the cart's product/customer list with an
      // empty one, a real overselling risk on the checkout screen. Check every
      // error explicitly so the catch block below preserves the IndexedDB
      // cache already on screen instead of being silently bypassed.
      const err = prodsRes.error || custsRes.error || catsRes.error || batchesRes.error
      if (err) throw err
      const { data: prods } = prodsRes, { data: custs } = custsRes, { data: cats } = catsRes, { data: batches } = batchesRes
      const safeProds = (prods || []) as unknown as Product[]
      setProducts(safeProds)
      setCustomers((custs || []) as Customer[])
      setCategories((cats || []) as Category[])

      // Le premier lot rencontré par produit (déjà trié FEFO ci-dessus) est
      // celui qui sera vendu en premier — seul son prix promo compte pour
      // la caisse, jamais celui d'un lot plus tardif.
      const frontSeen = new Set<string>()
      const promoMap: Record<string, { price: number; until: string; start: string | null }> = {}
      const expiredMap: Record<string, boolean> = {}
      const todayStr = new Date().toISOString().slice(0, 10)
      for (const b of (batches || []) as any[]) {
        if (frontSeen.has(b.product_id)) continue
        frontSeen.add(b.product_id)
        if (b.promo_price && b.promo_until) promoMap[b.product_id] = { price: Number(b.promo_price), until: b.promo_until, start: b.promo_start ?? null }
        if (b.expiry_date && b.expiry_date < todayStr) expiredMap[b.product_id] = true
      }
      setFrontBatchPromo(promoMap)
      setFrontBatchExpired(expiredMap)
      // Refresh IndexedDB cache
      await Promise.all([
        cacheProducts(shop.id, safeProds.map((p: any) => ({
          id: p.id, shop_id: shop.id, name: p.name, sku: p.sku ?? null,
          selling_price: Number(p.selling_price), buying_price: Number(p.buying_price),
          quantity: Number(p.quantity), category_id: p.category_id ?? null, is_active: p.is_active,
          image_url: p.image_url ?? null,
          category_name: p.categories?.name ?? null,
          category_color: p.categories?.color ?? null,
          is_favorite: !!p.is_favorite,
        }))),
        cacheCustomers(shop.id, (custs || []).map((c: any) => ({
          id: c.id, shop_id: shop.id, name: c.name,
          phone: c.phone ?? null, total_debt: Number(c.total_debt ?? 0),
        }))),
      ])
    } catch {
      // Cache already applied above — nothing to do
    }
  }, [shop?.id, isOnline])

  useEffect(() => { loadShopData() }, [loadShopData])

  // Refresh when the user comes back to this tab — the cart is built from
  // this product/customer list, so stale stock levels here risk overselling
  // during a sale. Reconnect is already covered: loadShopData depends on
  // `isOnline` (from useOffline, verified via a real request — see there for
  // why the raw browser 'online' event isn't trustworthy on Capacitor/Android),
  // so the mount effect above re-runs it whenever isOnline flips back to true.
  useRefetchOnVisible(loadShopData)

  // Live stock updates — this screen races other cashiers/devices selling
  // the same products, so waiting for a tab-revisit/reconnect to notice a
  // quantity change is the actual overselling risk called out above.
  // complete_sale still re-validates stock atomically server-side (the real
  // safety net); this just keeps the grid itself from offering an item
  // another device already sold out from under it. Realtime payloads are
  // raw rows without the categories(name, color)/suppliers(name) joins —
  // merging preserves them on an existing product; a newly-sellable product
  // is added without them until the next full refresh (same trade-off
  // already accepted in stock/page.tsx's own realtime handler).
  useStockRealtime(shop?.id || null, (product) => {
    const isSellable = (product as any).is_active !== false && Number((product as any).quantity) > 0
    setProducts(prev => {
      const idx = prev.findIndex(p => p.id === product.id)
      if (!isSellable) return idx === -1 ? prev : prev.filter(p => p.id !== product.id)
      if (idx === -1) return [...prev, product as Product]
      const next = [...prev]
      next[idx] = { ...next[idx], ...product }
      return next
    })
  })

  // ── Recherche fluide ─────────────────────────────────────
  // Texte normalisé par produit, calculé une seule fois par chargement (et
  // non à chaque frappe pour chaque produit).
  const searchIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products) m.set(p.id, `${normalize(p.name)}\n${normalize(p.sku ?? '')}`)
    return m
  }, [products])
  // La frappe reste prioritaire : le champ affiche `searchQuery` tout de
  // suite, la grille se recalcule sur sa version différée (React
  // interrompt ce rendu si une nouvelle lettre arrive).
  const deferredQuery = useDeferredValue(searchQuery)
  const filteredProducts = useMemo(
    () => filterProducts(products, categoryFilter, deferredQuery, searchIndex),
    [products, categoryFilter, deferredQuery, searchIndex],
  )
  // Nombre de cartes affichées — revient au 1er lot dès que la liste
  // change (filtre/recherche), sans passer par un effet (pas de rendu
  // intermédiaire avec l'ancien compteur).
  const listKey = `${categoryFilter}\u0000${deferredQuery}`
  const [visible, setVisible] = useState({ key: listKey, count: PRODUCTS_PAGE_SIZE })
  const visibleCount = visible.key === listKey ? visible.count : PRODUCTS_PAGE_SIZE
  const hasMoreProducts = filteredProducts.length > visibleCount
  const loadMoreProducts = useCallback(() => {
    setVisible(v => ({ key: listKey, count: (v.key === listKey ? v.count : PRODUCTS_PAGE_SIZE) + PRODUCTS_PAGE_SIZE }))
  }, [listKey])

  // Chargement automatique au défilement : un sentinel sous la grille ;
  // dès qu'il approche de l'écran (600 px avant), le lot suivant s'ajoute.
  // Sur desktop la grille défile dans son propre conteneur → il sert de
  // racine ; sur téléphone c'est la page (racine = viewport).
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasMoreProducts || mobileCartOpen) return
    const desktop = window.matchMedia('(min-width: 768px)').matches
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) loadMoreProducts() },
      { root: desktop ? gridScrollRef.current : null, rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMoreProducts, mobileCartOpen, loadMoreProducts, visibleCount])

  // Callbacks STABLES pour les cartes mémoïsées (ProductCard) : les
  // fonctions addToCart/toggleFavorite sont recréées à chaque rendu, une
  // ref les relaie sans changer l'identité passée aux cartes.
  const addToCartRef = useRef<(p: Product) => void>(() => {})
  const toggleFavoriteRef = useRef<(p: Product, e: React.MouseEvent) => void>(() => {})
  const handleAddProduct = useCallback((p: Product) => addToCartRef.current(p), [])
  const handleToggleFavorite = useCallback((p: Product, e: React.MouseEvent) => toggleFavoriteRef.current(p, e), [])

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

  // Favoris : curation manuelle, stable (jamais recalculée automatiquement
  // depuis les ventes — voir migration 148). Lecture seule hors-ligne : le
  // toggle lui-même nécessite une connexion (évite d'ajouter toute une file
  // d'actions en attente pour un simple réglage d'affichage).
  const toggleFavorite = async (product: Product, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!shop?.id) return
    if (!isOnline) {
      toast({ title: t('sales.favorites_offline_title'), description: t('sales.favorites_offline_desc'), variant: 'destructive' })
      return
    }
    const next = !product.is_favorite
    const apply = (val: boolean) => {
      const patch = (p: Product) => p.id === product.id ? { ...p, is_favorite: val } : p
      setProducts(prev => prev.map(patch))
    }
    apply(next) // optimiste
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, shop_id: shop.id, is_favorite: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      apply(!next) // rollback
      toast({ title: t('toast.error'), variant: 'destructive' })
    }
  }
  // Toujours la dernière version des deux fonctions ci-dessus derrière les
  // callbacks stables passés aux cartes (voir handleAddProduct).
  useEffect(() => {
    addToCartRef.current = addToCart
    toggleFavoriteRef.current = toggleFavorite
  })

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
    setDebtCapped(false)
    setCustomerUnpaidSales([])
    setDueDate('')
    dueDateTouchedRef.current = false
  }

  // ── DRAFTS ─────────────────────────────────────────────
  // Le bouton ⏸ ouvre d'abord une petite fenêtre (nom facultatif) ;
  // doHold() enregistre réellement. Renvoie la liste à jour, pour pouvoir
  // enchaîner une reprise sans relire un état React pas encore à jour.
  const openHoldDialog = () => {
    if (cart.length === 0) {
      toast({ title: t('toast.cart_empty'), variant: 'destructive' })
      return
    }
    const existing = drafts.find(d => d.id === activeDraftId)
    setHoldLabel(existing?.label ?? '')
    setShowHoldDialog(true)
  }

  const doHold = (label: string): Draft[] => {
    const draft: Draft = {
      id: activeDraftId || `draft_${Date.now()}`,
      createdAt: new Date().toISOString(),
      shopId: shop?.id || '',
      cart,
      customerName: selectedCustomer ? selectedCustomer.name : customerName,
      customerPhone,
      discount,
      notes,
      paymentMethod,
      customerId: selectedCustomer?.id ?? null,
      label: label.trim() || undefined,
      manualPriceIds: cart
        .filter(i => i.unit_price !== effectivePrice(i.product, frontBatchPromo))
        .map(i => i.product.id),
    }
    const updated = drafts.filter(d => d.id !== draft.id)
    updated.unshift(draft)
    setDrafts(updated)
    saveDraftsToStorage(updated)
    resetForm()
    setShowHoldDialog(false)
    toast({ title: t('toast.sale_held'), variant: 'success' })
    return updated
  }

  // Applique une vente en attente au panier, REVÉRIFIÉE contre les produits
  // actuels (prix, stock, disponibilité) — chaque changement est signalé.
  const applyDraft = (draft: Draft) => {
    // Produits pas encore chargés (tout début de page, hors ligne sans
    // cache) : on ne peut rien revérifier — panier repris tel quel plutôt
    // que de tout déclarer « plus disponible ».
    const { cart: freshCart, changes } = products.length === 0
      ? { cart: draft.cart, changes: [] as HeldCartChange[] }
      : revalidateHeldCart(
      draft.cart,
      products,
      p => effectivePrice(p, frontBatchPromo),
      draft.manualPriceIds ?? null,
    )
    setCart(freshCart)
    // Client existant : on le reprend par son identifiant (et non plus par
    // son seul nom, qui recréait un doublon à la validation). S'il n'est
    // plus dans la liste (supprimé, liste pas encore chargée), on garde le
    // nom et le téléphone saisis.
    const linked = draft.customerId ? customers.find(c => c.id === draft.customerId) : undefined
    if (linked) {
      setSelectedCustomer(linked)
      setCustomerName('')
      setCustomerPhone(linked.phone || '')
    } else {
      setSelectedCustomer(null)
      setCustomerName(draft.customerName)
      setCustomerPhone(draft.customerPhone)
    }
    setDiscount(Math.min(draft.discount, freshCart.reduce((s, i) => s + i.subtotal, 0)))
    setNotes(draft.notes)
    setPaymentMethod(draft.paymentMethod)
    setActiveDraftId(draft.id)
    setShowDrafts(false)
    setPendingResume(null)
    if (changes.length > 0) {
      toast({
        title: t('sales.held_changes_title'),
        description: changes.map(c =>
          c.kind === 'removed' ? t('sales.held_change_removed', { name: c.name })
          : c.kind === 'capped' ? t('sales.held_change_capped', { name: c.name, from: c.from, to: c.to })
          : t('sales.held_change_price', { name: c.name, from: formatNaira(c.from), to: formatNaira(c.to) }),
        ).join(' · '),
        variant: changes.some(c => c.kind === 'removed') ? 'destructive' : 'default',
      })
    } else {
      toast({ title: t('toast.sale_resumed'), variant: 'success' })
    }
    // Téléphone : on ouvre directement le panier repris (le panneau n'existe
    // que sous md — sur desktop le panier est déjà une colonne visible).
    if (freshCart.length > 0 && window.matchMedia('(max-width: 767px)').matches) {
      setMobileStep('cart')
      setMobileCartOpen(true)
    }
  }

  // « Reprendre » ne doit jamais écraser en silence un panier en cours.
  const resumeDraft = (draft: Draft) => {
    if (cart.length > 0 && activeDraftId !== draft.id) {
      setShowDrafts(false)
      setPendingResume(draft)
      return
    }
    applyDraft(draft)
  }

  const deleteStaleDrafts = () => {
    const updated = drafts.filter(d => d.shopId !== shop?.id || heldAgeDays(d.createdAt) < HELD_STALE_DAYS)
    setDrafts(updated)
    saveDraftsToStorage(updated)
  }

  const deleteDraft = (id: string) => {
    const updated = drafts.filter(d => d.id !== id)
    setDrafts(updated)
    saveDraftsToStorage(updated)
    if (activeDraftId === id) { setActiveDraftId(null) }
  }

  // Drafts for current shop
  const shopDrafts = drafts.filter(d => d.shopId === shop?.id)

  // Fetch unpaid sales when customer with debt is selected
  // Uses /api/payments/debts to bypass RLS for multi-shop accounts
  useEffect(() => {
    setDebtRepayEnabled(false)
    setDebtRepayAmount('')
    setDebtCapped(false)
    setCustomerUnpaidSales([])
    if (!selectedCustomer || Number(selectedCustomer.total_debt) <= 0 || !shop?.id) return
    fetch(`/api/payments/debts?shop_id=${shop.id}`)
      .then(r => r.json())
      .then(({ debtors }) => {
        const debtor = (debtors || []).find((d: any) => d.customer.id === selectedCustomer.id)
        const sales = debtor?.unpaidSales || []
        setCustomerUnpaidSales(sales)
        if (sales.length > 0) {
          // floor (pas round) : la saisie est entière, et un arrondi au-dessus
          // dépasserait la dette réelle (l'excédent ne serait appliqué nulle part).
          setDebtRepayAmount(String(Math.floor(outstandingDebt(sales))))
        }
      })
      .catch(() => {/* keep empty */})
  }, [selectedCustomer?.id, shop?.id])

  // ── Panneau panier (téléphone) ─────────────────────────
  // Se referme tout seul quand le panier se vide (vente validée, mise en
  // attente, dernier article retiré) — retour direct aux produits.
  useEffect(() => {
    if (cart.length > 0) return
    setMobileCartOpen(false)
    // Nouvelle vente : on repart de l'étape panier, sections repliées.
    setMobileStep('cart')
    setShowDiscount(false); setShowCustomer(false); setShowNotes(false)
  }, [cart.length])

  // À l'ouverture : panneau remis en haut, et défilement de la grille en
  // arrière-plan bloqué (sinon le doigt fait défiler la page dessous).
  useEffect(() => {
    if (!mobileCartOpen) { setMobileStep('cart'); return }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileCartOpen])

  // Chaque ouverture / changement d'étape repart du haut du panneau.
  useEffect(() => {
    if (mobileCartOpen) cartSectionRef.current?.scrollTo({ top: 0 })
  }, [mobileCartOpen, mobileStep])

  // Retour (en-tête du panneau, bouton retour Android) : Paiement → Panier,
  // puis Panier → Produits.
  const mobileBack = useCallback(() => {
    if (mobileStep === 'payment') setMobileStep('cart')
    else setMobileCartOpen(false)
  }, [mobileStep])

  // Bouton retour Android (app Capacitor) : recule d'une étape au lieu de
  // quitter la page — et donc de perdre le panier en cours. Pas de
  // history.pushState côté navigateur : NavigationProgress l'intercepte
  // pour sa barre de chargement, qui ne se terminerait jamais (même URL).
  useEffect(() => {
    if (!mobileCartOpen || !isCapacitor()) return
    let cancelled = false
    let remove: (() => void) | undefined
    import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', mobileBack).then(h => {
        if (cancelled) h.remove(); else remove = () => { h.remove() }
      }),
    ).catch(() => {})
    return () => { cancelled = true; remove?.() }
  }, [mobileCartOpen, mobileBack])

  // Rangée "Favoris" : curation manuelle (migration 148), indépendante du
  // filtre catégorie — masquée pendant une recherche active (l'intention de
  // recherche est déjà précise, la rangée n'ajouterait que du bruit).
  const favoriteProducts = products.filter(p => p.is_favorite)
  // Props primitives/stables pour les cartes mémoïsées.
  const favoriteLabel = t('sales.favorites_title')
  const expiredLabel = t('sales.expired_batch_warning')
  const lowStockThreshold = shop?.low_stock_threshold || 10
  const stockVariantOf = (p: Product): StockVariant =>
    p.quantity === 0 ? 'destructive'
    : p.quantity <= ((p as any).low_stock_threshold || lowStockThreshold) ? 'warning'
    : 'success'
  // Section client dépliée (téléphone) dès qu'elle contient quelque chose.
  const customerOpen = showCustomer || !!selectedCustomer || !!customerName.trim() || !!customerPhone.trim()
  const showFavoritesRow = favoriteProducts.length > 0 && !searchQuery.trim()

  // ── TOTALS ─────────────────────────────────────────────
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0)
  const discountAmt = discount
  const tax = Number(shop?.tax_rate || 0) > 0 ? (subtotal - discountAmt) * (shop!.tax_rate / 100) : 0
  const total = subtotal - discountAmt + tax
  // Remboursement de dette inclus dans la vente — PLAFONNÉ à la dette
  // réellement remboursable (somme des soldes des ventes impayées, seule
  // base sur laquelle /api/payments l'applique). Sans plafond, un excédent
  // saisi était encaissé mais appliqué nulle part.
  const debtOutstanding = outstandingDebt(customerUnpaidSales)
  const debtAmt = debtRepayEnabled ? Math.min(Number(debtRepayAmount) || 0, debtOutstanding) : 0
  // Montant total à encaisser = vente + remboursement crédit si activé
  const totalToCollect = total + debtAmt
  const shopCountry = getCountry(shop?.country)
  const methodType = getMethodType(paymentMethod, shopCountry)
  // For credit: customer pays nothing now → paid = 0, balance = total
  // For cash: cap at total — the change given back is NOT revenue
  const paid = methodType === 'cash'
    ? Math.min(Number(amountPaid) || 0, total)
    : methodType === 'credit' ? 0 : total
  const change = methodType === 'cash' ? Math.max(0, (Number(amountPaid) || 0) - totalToCollect) : 0
  // Réellement encaissé maintenant : en vente à crédit, rien pour la vente,
  // seulement l'éventuel remboursement de dette.
  const isCreditSale = !splitPayment && methodType === 'credit'
  const collectedNow = isCreditSale ? debtAmt : totalToCollect
  const balance = Math.max(0, total - paid)
  // Solde qui restera RÉELLEMENT dû une fois la vente validée — seul cas
  // possible : la vente à crédit. `balance` ci-dessus ne convient pas pour
  // l'échéance : en espèces, il vaut le total tant que le caissier n'a rien
  // tapé (alors que la validation exige un montant ≥ total), et en paiement
  // mixte il ignore le 2e moyen (qui couvre pourtant le reste) — d'où une
  // échéance affichée, pré-remplie et envoyée au serveur sur des ventes
  // entièrement payées.
  const outstandingBalance = !splitPayment && methodType === 'credit' ? balance : 0

  // Pré-remplit l'échéance dès qu'un solde apparaît, avec le délai par
  // défaut de la boutique — jamais si le caissier a déjà touché le champ
  // (y compris pour le vider volontairement), et remis à vide quand le
  // solde retombe à 0 pour ne pas laisser une échéance orpheline sur une
  // vente finalement payée intégralement.
  const dueDateTouchedRef = useRef(false)
  useEffect(() => {
    if (outstandingBalance <= 0) {
      if (dueDate) setDueDate('')
      dueDateTouchedRef.current = false
      return
    }
    if (dueDateTouchedRef.current || dueDate) return
    const days = shop?.default_credit_term_days ?? 30
    setDueDate(new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outstandingBalance > 0, shop?.id])

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
        toast({ title: t('sales.split_covers_total_disable'), variant: 'destructive' }); return
      }
      if (!splitMethod2) {
        toast({ title: t('sales.choose_second_method'), variant: 'destructive' }); return
      }
    }

    unlockAudio()   // déverrouille l'AudioContext pendant le geste utilisateur
    setCompleting(true)

    // Snapshot values NOW (before any async wait) so they stay valid
    // even if auth context updates during the 10s network timeout.
    const _shopId = shop?.id
    const _cashierId = profile?.id
    const _cart = cart.map((item: any) => ({ ...item }))
    const _activeDraftId = activeDraftId

    // Payment row(s) for THIS sale only — capped at `total`, never
    // totalToCollect (which may also include an unrelated debt-repayment
    // top-up, applied separately below via /api/payments). Computed ONCE
    // and shared by the online AND offline paths: the offline path used to
    // keep only the 1st method of a split payment (and its amount), so a
    // mixed sale synced as partially paid with a phantom customer debt.
    // La même répartition fournit aussi les lignes du remboursement de dette
    // éventuel, chacune avec le moyen réellement encaissé (paiement mixte
    // compris — voir lib/utils/checkout-allocation.ts).
    const { salePayments, debtPayments } = allocateCheckout({
      saleTotal: total,
      debtAmount: debtAmt,
      paymentMethod,
      isCredit: methodType === 'credit',
      paidForSale: paid,
      reference: methodType === 'transfer' ? transferRef : null,
      split: splitPayment ? { amount1: Number(amountPaid) || 0, method2: splitMethod2 } : null,
    })
    const paymentsPayload: PendingSalePayment[] = salePayments
    const _unpaidSaleIds = customerUnpaidSales.map((s: any) => s.id)
    const salePaid = paymentsPayload.reduce((s, p) => s + p.amount, 0)
    const saleBalance = Math.max(0, total - salePaid)
    const salePaymentMethod = splitPayment ? 'mixed' : paymentMethod

    // ── Remboursement de dette inclus dans la vente ─────────────────────────
    // Une ligne par moyen réellement encaissé (paiement mixte → jusqu'à 2).
    // Chaque ligne a sa propre clé d'idempotence `<id>:debtN` : /api/payments
    // ignore un remboursement déjà reçu sous cette clé, donc retenter (relance
    // après coupure, file hors ligne) ne peut jamais le compter deux fois.
    const debtNote = (saleNumber: string) => `Inclus dans la vente #${saleNumber}`
    const queueDebtLine = async (line: PendingSalePayment, localId: string, saleNumber: string): Promise<boolean> => {
      if (!_shopId) return false
      try {
        await savePendingCustomerPayment({
          local_id: localId,
          shop_id: _shopId,
          unpaid_sale_ids: _unpaidSaleIds,
          amount: line.amount,
          method: line.method,
          reference: line.reference,
          notes: debtNote(saleNumber),
          created_at: new Date().toISOString(),
          synced: false,
        })
        return true
      } catch {
        return false
      }
    }
    // Hors ligne : toutes les lignes vont dans la file existante, synchronisée
    // automatiquement au retour du réseau (syncPendingCustomerPayments).
    const queueDebtRepayment = async (baseId: string, saleNumber: string): Promise<'queued' | 'failed'> => {
      let ok = true
      for (let i = 0; i < debtPayments.length; i++) {
        if (!(await queueDebtLine(debtPayments[i], `${baseId}:debt${i + 1}`, saleNumber))) ok = false
      }
      refreshPendingCount().catch(() => {})
      registerBackgroundSync()
      return ok ? 'queued' : 'failed'
    }
    // En ligne : envoi direct ; une coupure ou une erreur serveur bascule la
    // ligne dans la file hors ligne (retentée plus tard) au lieu d'être
    // perdue ; un refus (4xx) est signalé pour saisie manuelle.
    const applyDebtRepaymentOnline = async (
      baseId: string,
      saleNumber: string,
    ): Promise<{ status: 'applied' | 'queued' | 'failed'; error?: string; unapplied: number }> => {
      let status: 'applied' | 'queued' | 'failed' = 'applied'
      let error: string | undefined
      let unapplied = 0
      for (let i = 0; i < debtPayments.length; i++) {
        const line = debtPayments[i]
        const lineId = `${baseId}:debt${i + 1}`
        try {
          const r = await withTimeout(fetch('/api/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              unpaid_sale_ids: _unpaidSaleIds,
              amount: line.amount,
              method: line.method,
              reference: line.reference,
              notes: debtNote(saleNumber),
              shop_id: _shopId,
              client_request_id: lineId,
            }),
          }))
          const body = await r.json().catch(() => ({}))
          if (r.ok) { unapplied += Number(body.remaining) || 0; continue }
          if (r.status < 500) { status = 'failed'; error = body.error || `HTTP ${r.status}`; continue }
          throw new Error(body.error || `HTTP ${r.status}`)
        } catch (err: any) {
          if (await queueDebtLine(line, lineId, saleNumber)) {
            if (status === 'applied') status = 'queued'
          } else {
            status = 'failed'; error = err?.message || t('errors.generic')
          }
        }
      }
      if (status === 'queued') { refreshPendingCount().catch(() => {}); registerBackgroundSync() }
      return { status, error, unapplied }
    }

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
            payment_method: salePaymentMethod,
            payment_status: saleBalance > 0 ? (salePaid > 0 ? 'partial' : 'pending') : 'paid',
            amount_paid: salePaid,
            balance: saleBalance,
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
              original_price: item.product.selling_price,
              subtotal: item.quantity * item.unit_price,
            })),
            payments: paymentsPayload,
            // Champs historiques, gardés cohérents avec `payments`.
            payment_amount: salePaid,
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

      // Remboursement de dette inclus : file d'attente hors ligne (avant cette
      // correction, il était simplement perdu — l'argent encaissé, la dette
      // jamais réduite).
      if (debtPayments.length > 0) {
        const debtStatus = await queueDebtRepayment(localId, saleNumber)
        setReceiptDebt({ amount: debtAmt, status: debtStatus })
        if (debtStatus === 'failed') {
          toast({ title: t('sales.debt_failed_toast', { error: 'stockage local' }), variant: 'destructive' })
        }
      } else {
        setReceiptDebt(null)
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
        payment_method: salePaymentMethod,
        payment_status: 'pending',
        amount_paid: salePaid,
        balance: saleBalance,
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
          original_price: item.product.selling_price,
          subtotal: item.quantity * item.unit_price,
        })),
      } as any)
      // Vente en attente reprise puis validée HORS LIGNE : elle doit quitter
      // la liste d'attente comme en ligne — sinon elle pouvait être reprise et
      // validée une 2e fois (stock et chiffre d'affaires comptés deux fois).
      if (_activeDraftId) deleteDraft(_activeDraftId)
      setShowReceipt(true)
      resetForm()
      triggerSaleFeedback()
      toast({
        title: persisted ? toastMsg : t('sales.sale_saved_reconnect'),
        variant: 'success',
      })
    }

    // ── OFFLINE PATH ─────────────────────────────────────────────────────────
    if (!isOnline) {
      try {
        await saveOffline(t('sales.sale_saved_offline'))
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
      // Best-effort token refresh before the request below — if the tab sat
      // backgrounded for a while, the JWT can be stale by the time the
      // cashier clicks "Valider". Bounded to 3s so a hung refresh never
      // delays checkout.
      await refreshSessionBeforeWrite(supabase)

      // Idempotency key: generated once per checkout attempt and reused
      // across retries — including a manual re-click after an apparent
      // failure, since it lives in a ref, not a local variable. If a
      // previous attempt with this exact key already landed server-side
      // (its response was lost to a timeout/network drop), complete_sale()
      // detects that and reuses the existing sale instead of creating a
      // second one.
      const clientRequestId = checkoutIdRef.current ?? (checkoutIdRef.current = crypto.randomUUID())

      // paymentsPayload : calculé plus haut, partagé avec saveOffline.

      // Single atomic round trip: customer resolve + sale + items +
      // payment(s) all happen server-side in complete_sale() (migration
      // 109) — replaces what used to be 6 sequential client-side calls.
      const res: any = await withTimeout(
        fetch('/api/sales/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: shop!.id,
            customer_id: selectedCustomer?.id || null,
            customer_name: !selectedCustomer && customerName.trim() ? customerName.trim() : null,
            customer_phone: !selectedCustomer && customerPhone.trim() ? customerPhone.trim() : null,
            subtotal, discount: discountAmt, tax, total,
            payment_method: salePaymentMethod,
            notes: notes || null,
            paystack_reference: methodType === 'card' ? `PAY-${Date.now()}` : null,
            client_request_id: clientRequestId,
            due_date: outstandingBalance > 0 ? (dueDate || null) : null,
            items: cart.map((item: any) => ({
              product_id: item.product.id,
              product_name: item.product.name,
              quantity: Math.round(item.quantity),
              unit_price: item.unit_price,
              buying_price: Number(item.product.buying_price) || 0,
              original_price: item.product.selling_price,
            })),
            payments: paymentsPayload,
          }),
        }).then(async r => {
          const body = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(body.error || t('sales.create_error'))
          return body
        }),
        20_000,
        t('sales.db_not_responding')
      )

      sale = res.sale

      // A brand-new customer created server-side isn't in the client's
      // `customers` list yet — add it so the dropdown/debt lookups see it
      // without waiting for the next data refresh.
      if (sale?.customers && !customers.some(c => c.id === sale.customers.id)) {
        setCustomers(prev => [...prev, sale.customers as Customer])
      }

      // Remboursement de dette inclus — FIFO via /api/payments (bypasse RLS).
      // TOUJOURS tenté, y compris quand la vente existait déjà (relance après
      // coupure) : avant, il était sauté dans ce cas, donc perdu pour de bon
      // si la 1re tentative n'était pas allée jusque-là. Sans risque de
      // double comptage : clé d'idempotence par ligne (voir plus haut).
      if (debtPayments.length > 0) {
        const debtResult = await applyDebtRepaymentOnline(clientRequestId, (sale as any).sale_number)
        setReceiptDebt({ amount: debtAmt, status: debtResult.status })
        if (debtResult.status === 'failed') {
          toast({ title: t('sales.debt_failed_toast', { error: debtResult.error || '' }), variant: 'destructive' })
        } else if (debtResult.unapplied > 0.01) {
          // La dette avait été réduite entre-temps (autre caisse, page Paiements).
          toast({ title: t('sales.debt_unapplied_toast', { amount: formatNaira(debtResult.unapplied) }), variant: 'destructive' })
        }
      } else {
        setReceiptDebt(null)
      }

      const fullSale = sale

      // Remove from drafts if it was a held invoice
      if (activeDraftId) deleteDraft(activeDraftId)

      invalidateSalesData(queryClient)
      setCompletedSale(fullSale as any)
      setShowReceipt(true)
      resetForm()
      triggerSaleFeedback()
      toast({ title: t('sales.receipt_ready'), variant: 'success' })
      // Invalidate related page caches so next visit to history/stock shows fresh data
      clearPageCacheByPrefix('sales_history_v2_')
      clearPageCache(`stock_${shop?.id}`)
      if (selectedCustomer) clearPageCache(`debtors_${shop?.id}`)

      // Fire-and-forget: notify admin of new sale + check low stock
      const soldProductIds = cart.map(item => item.product.id)
      notifyNewSale({
        shopId: shop!.id,
        total: totalToCollect,
        currencySymbol: symbol,
        cashierName: profile?.full_name || undefined,
        paymentLabel: shopCountry.paymentMethods.find(m => m.id === paymentMethod)?.label || paymentMethod,
      })
      checkAndNotifyLowStock(shop!.id, soldProductIds).catch(() => {})
    } catch (err: any) {
      if (sale) {
        // The sale record was already written to the DB. Going offline here would create
        // a duplicate — instead surface the real error so the user knows the sale is
        // incomplete. They can see it in history to validate the payment or cancel it.
        toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
      } else {
        // Sale was never created — safe to fall back to local save.
        try {
          await saveOffline(t('sales.unstable_connection_saved'))
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
    promoWas: t('receipt.promo_was'),
    debtRepayment: t('receipt.debt_repayment'),
    totalCollected: t('receipt.total_collected'),
  }

  const handlePrintReceipt = async () => {
    if (!completedSale || !shop) return
    const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
    const blob = await generateReceiptPDFBlob({
      sale: completedSale as any,
      shop: shop as any,
      cashierName: profile?.full_name || '',
      customerName: (completedSale as any).customers?.name,
      labels: receiptLabels,
      debtRepayment: receiptDebt?.amount || 0,
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
        shop: shop as any,
        cashierName: profile?.full_name || '',
        customerName: (completedSale as any).customers?.name,
        labels: receiptLabels,
        debtRepayment: receiptDebt?.amount || 0,
      })
      await sharePDFNative(
        blob,
        fileName,
        t('sales.receipt_share_title', { number: completedSale.sale_number, shop: shop?.name || '' }),
      )
      return
    } catch (err: any) {
      if (err?.name === 'AbortError') return // user cancelled native share sheet
      // PDF generation or share failed — fall through to text fallback
    }
    // Last resort: WhatsApp text message
    const message = buildReceiptWhatsAppMessage({
      shopName: shop?.name || '',
      saleNumber: completedSale.sale_number,
      date: new Date(completedSale.created_at).toLocaleString(locale, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
      items: ((completedSale as any).sale_items || []).map((i: any) => ({ name: i.product_name, qty: i.quantity, price: i.unit_price })),
      total: completedSale.total,
      paid: completedSale.amount_paid,
      balance: completedSale.balance,
      method: completedSale.payment_method,
      customerName: (completedSale as any).customers?.name,
      currencySymbol: symbol,
      debtRepayment: receiptDebt?.amount || 0,
    })
    shareReceiptWhatsApp(message)
  }

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full md:max-w-none md:flex-row md:gap-0 md:h-[calc(100dvh-6.5rem)] md:overflow-hidden">

      {/* ── LEFT column: search + products ── */}
      <div className={cn('flex flex-col md:flex-1 md:overflow-hidden md:border-r md:border-border md:min-h-0', (cart.length > 0 || shopDrafts.length > 0) && 'pb-16 md:pb-0')}>

      {/* Shop selector — same shared control as everywhere else in the app, restricted to a single concrete shop (a sale can't target "all shops") */}
      {isOwner && (
        <ShopSelector
          variant="compact"
          allowAllShops={false}
          onShopChange={() => setCart([])}
          label={t('sales.selling_at')}
        />
      )}

      {/* Held invoices banner — desktop (toujours visible : hors de la zone
          qui défile). Téléphone : accès fixé en bas d'écran, voir plus bas. */}
      {shopDrafts.length > 0 && (
        <button
          onClick={() => setShowDrafts(true)}
          className="hidden md:flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
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
        <div className="flex items-center gap-2 rounded-lg bg-stockshop-blue-muted border border-stockshop-blue/20 px-3 py-2 text-xs text-stockshop-blue dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300">
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
            onKeyDown={e => {
              // Filtre recalculé sur la valeur IMMÉDIATE (la grille, elle,
              // suit la valeur différée et peut être en retard d'une lettre).
              if (e.key !== 'Enter') return
              const list = filterProducts(products, categoryFilter, searchQuery, searchIndex)
              if (list.length === 1) addToCart(list[0])
            }}
            placeholder={t('sales.search_or_scan')}
            className="pl-10 pr-8 h-12 text-base border-stockshop-blue/30 focus:border-stockshop-blue dark:border-blue-500/30 dark:focus:border-blue-500"
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

      {/* Aide lecteur USB/Bluetooth — utile surtout sur ordinateur ; masquée
          sur téléphone pour rendre la place à la grille produits. */}
      <p className="hidden md:block text-xs text-muted-foreground -mt-2 px-1">
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
              className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-stockshop-blue text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />}
              {cat.name}
            </button>
          ))}
        </div>
      )}

      </div>{/* end sticky header */}

      {/* Product grid scroll wrapper */}
      <div ref={gridScrollRef} className="flex-1 md:overflow-y-auto md:px-5 md:pb-8 md:min-h-0">

      {/* Favoris — curation manuelle (migration 148), accès 1 tap sans
          chercher/scroller pour les articles à forte rotation. Masqué
          pendant une recherche active. */}
      {showFavoritesRow && (
        <div className="pt-2 pb-1 md:pt-5">
          <div className="flex items-center gap-1.5 px-1 mb-2 text-xs font-semibold text-muted-foreground">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {t('sales.favorites_title')}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {favoriteProducts.map(product => (
              <ProductCard
                key={product.id}
                compact
                product={product}
                price={effectivePrice(product, frontBatchPromo)}
                stockVariant={stockVariantOf(product)}
                isExpired={!!frontBatchExpired[product.id]}
                currencyCode={currencyCode}
                favoriteLabel={favoriteLabel}
                expiredLabel={expiredLabel}
                onAdd={handleAddProduct}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      {/* Product grid */}
      <AnimatePresence>
        {(products.length > 0 || searchQuery) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            {/* Téléphone : 3 colonnes compactes (~110 px) pour voir ~9 produits
                par écran au lieu de 4–5 — 2 colonnes seulement sous 340 px.
                À partir de md (desktop/tablette), tailles d'origine. */}
            <div className="grid grid-cols-2 min-[340px]:grid-cols-3 gap-1.5 md:grid-cols-3 md:gap-2">
              {filteredProducts.slice(0, visibleCount).map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  price={effectivePrice(product, frontBatchPromo)}
                  stockVariant={stockVariantOf(product)}
                  isExpired={!!frontBatchExpired[product.id]}
                  currencyCode={currencyCode}
                  favoriteLabel={favoriteLabel}
                  expiredLabel={expiredLabel}
                  onAdd={handleAddProduct}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
              {filteredProducts.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground text-center py-4">{t('sales.no_products_found')}</p>
              )}
            </div>
            {/* Sentinel : le lot suivant se charge tout seul en approchant du
                bas (plus de bouton « Afficher plus » à presser). */}
            {hasMoreProducts && (
              <div ref={loadMoreRef} role="status" className="py-3 text-center text-xs text-muted-foreground">
                {t('sales.loading_more', { count: filteredProducts.length - visibleCount })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>{/* end product grid scroll wrapper */}

      </div>{/* end LEFT column */}

      {/* ── RIGHT column: cart + payment ── */}
      {/* Téléphone : le panier n'est plus empilé sous toute la grille (il
          fallait défiler ~4 000 px pour l'atteindre, sans retour). Il
          s'ouvre en panneau plein écran par-dessus la grille, qui garde sa
          position — fermer le panneau ramène exactement où on était.
          À partir de md : colonne latérale permanente, inchangée. */}
      <div
        ref={cartSectionRef}
        className={cn(
          'flex-col gap-3 md:static md:z-auto md:flex md:w-[400px] md:overflow-y-auto md:bg-transparent md:p-5 md:pb-5 md:shrink-0 md:min-h-0 md:overscroll-auto',
          mobileCartOpen
            ? 'fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-background px-4'
            : 'hidden',
        )}
      >
      {/* En-tête du panneau (téléphone uniquement) — suit l'étape */}
      <div className="md:hidden sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b bg-background/95 px-2 backdrop-blur safe-top">
        <button
          type="button"
          onClick={mobileBack}
          className="flex items-center gap-1.5 rounded-lg px-2 py-3 text-sm font-medium text-stockshop-blue dark:text-blue-400 tap-target"
        >
          <ArrowLeft className="h-5 w-5" />
          {mobileStep === 'payment' ? t('sales.back_to_cart') : t('sales.back_to_products')}
        </button>
        <span className="flex items-center gap-1.5 pr-2 text-sm font-semibold text-foreground">
          {mobileStep === 'payment'
            ? t('sales.payment_step_title')
            : <><ShoppingCart className="h-4 w-4" />{t('sales.cart_items_count', { count: cart.length })}</>}
        </span>
      </div>

      {/* Cart */}
      {cart.length === 0 ? (
        <div className="flex flex-col items-center text-center py-10 text-muted-foreground md:flex-1 md:justify-center md:py-20">
          <div className="text-4xl mb-3">🛒</div>
          <p className="font-medium">{t('sales.cart_empty')}</p>
          <p className="text-sm mt-1">{t('sales.search_or_scan_hint')}</p>
        </div>
      ) : (
        // Téléphone : occupe toute la hauteur du panneau, pour que la barre
        // d'action de l'étape soit TOUJOURS en bas d'écran, même avec un
        // panier court (un simple sticky ne colle que si le contenu déborde).
        <div className="space-y-2 max-md:flex max-md:flex-1 max-md:flex-col">
          {/* ══ Étape 1 (téléphone) : PANIER — articles, total, client, dette ══
              Sur desktop, les deux étapes restent visibles l'une sous l'autre. */}
          <div className={cn('space-y-2', mobileStep === 'payment' && 'hidden md:block')}>
          <AnimatePresence>
            {cart.map(item => (
              <motion.div key={item.product.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <Card className="border-0 shadow-sm">
                  <CardContent className="flex gap-2.5 p-2.5">
                    {/* Miniature : l'article se reconnaît d'un coup d'œil (les
                        images sont déjà en cache, y compris hors ligne). */}
                    <ProductThumbnail src={item.product.image_url} alt={item.product.name} className="h-14 w-14 rounded-md" iconClassName="h-5 w-5" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {/* Ligne 1 : nom + corbeille */}
                      <div className="flex items-start gap-1">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-5">{item.product.name}</p>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id)}
                          className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
                          aria-label={t('actions.remove')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Ligne 2 : prix unitaire (modifiable) + alerte lot périmé —
                          l'alerte reste rouge : c'est un signal, pas de la marque. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <button
                          type="button"
                          onClick={() => { setPriceModalItem(item); setPriceModalInput(String(item.unit_price)) }}
                          className="group flex items-center gap-1 text-xs font-medium text-stockshop-blue dark:text-blue-400"
                          aria-label={`${t('actions.edit')} — ${formatNaira(item.unit_price)}`}
                        >
                          <span className="whitespace-nowrap">{formatNaira(item.unit_price)}</span>
                          <Edit2 className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                          {item.unit_price === effectivePrice(item.product, frontBatchPromo) && item.unit_price !== item.product.selling_price ? (
                            <span className="rounded bg-stockshop-blue-muted px-1 text-[10px] font-medium text-stockshop-blue dark:bg-blue-900/40 dark:text-blue-400">{t('products.promo_badge')}</span>
                          ) : item.unit_price !== item.product.selling_price && (
                            <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">modifié</span>
                          )}
                        </button>
                        {frontBatchExpired[item.product.id] && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400">
                            <AlertTriangle className="h-3 w-3" />
                            {t('sales.expired_batch_warning')}
                          </span>
                        )}
                      </div>
                      {/* Ligne 3 : − qté + groupés dans un seul bloc, sous-total à droite */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center overflow-hidden rounded-lg border border-input">
                          <button
                            type="button"
                            onClick={() => updateQty(item.product.id, -1)}
                            className="flex h-9 w-10 items-center justify-center text-stockshop-blue transition-colors hover:bg-stockshop-blue-muted active:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40 dark:active:bg-blue-950/40"
                            aria-label={t('sales.qty_decrease')}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <input
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
                            aria-label={t('products.quantity')}
                            className="h-9 w-10 border-x border-input bg-card p-0 text-center text-sm font-bold tabular-nums outline-none focus-visible:bg-stockshop-blue-muted dark:focus-visible:bg-blue-950/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateQty(item.product.id, 1)}
                            className="flex h-9 w-10 items-center justify-center text-stockshop-blue transition-colors hover:bg-stockshop-blue-muted active:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40 dark:active:bg-blue-950/40"
                            aria-label={t('sales.qty_increase')}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-right text-sm font-bold tabular-nums">{formatNaira(item.subtotal)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Totals */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              {/* Téléphone : remise repliée tant qu'elle est à 0 */}
              {!(showDiscount || discount > 0) && (
                <button type="button" onClick={() => setShowDiscount(true)}
                  className="md:hidden flex items-center gap-2 text-sm font-medium text-stockshop-blue dark:text-blue-400 tap-target">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted dark:bg-blue-950/40"><Plus className="h-3.5 w-3.5" /></span>
                  {t('sales.add_discount')}
                </button>
              )}
              <div className={cn('flex items-center gap-3', !(showDiscount || discount > 0) && 'hidden md:flex')}>
                <Label className="text-sm w-24 flex-shrink-0">{t('sales.discount')}</Label>
                <div className="flex flex-1 rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
                  <span className="flex items-center px-2.5 bg-muted border-r text-sm text-muted-foreground font-medium whitespace-nowrap select-none">{symbol}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(discount, currencyCode)}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '')
                      setDiscount(Math.min(Number(digits) || 0, subtotal))
                    }}
                    className="flex-1 h-9 px-3 text-sm bg-card outline-none" placeholder="0" />
                </div>
              </div>
              <Separator className={cn(!(showDiscount || discount > 0) && 'hidden md:block')} />
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
                {/* Total sur fond bleu très clair : la seule ligne qui compte au premier regard */}
                <div className="mt-2 flex items-center justify-between rounded-lg bg-stockshop-blue-muted px-3 py-2.5 font-bold dark:bg-blue-950/40">
                  <span className="text-base">{t('sales.total')}</span>
                  <span className="text-lg tabular-nums text-stockshop-blue dark:text-blue-400">{formatNaira(total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer — nom, prénom, téléphone. Téléphone : replié derrière
              « + Ajouter un client » tant que rien n'est saisi. */}
          {!customerOpen && (
            <button type="button" onClick={() => setShowCustomer(true)}
              className="md:hidden flex w-full items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm font-medium text-stockshop-blue dark:text-blue-400 tap-target">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted dark:bg-blue-950/40"><Plus className="h-3.5 w-3.5" /></span>
              {t('sales.add_customer')}
            </button>
          )}
          <Card className={cn('border-0 shadow-sm', !customerOpen && 'hidden md:block')}>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <User className="h-4 w-4" /> Client <span className="text-muted-foreground font-normal text-xs">(optionnel)</span>
              </p>

              {selectedCustomer ? (
                /* Client choisi : avatar à l'initiale + état sur une ligne (type,
                   téléphone, solde dû) — tout se lit sans ouvrir la fiche. */
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-base font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400" aria-hidden="true">
                    {(selectedCustomer.name.trim().charAt(0) || '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{selectedCustomer.name}</p>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {t('sales.existing_customer')} · {selectedCustomer.phone || t('sales.no_phone')}
                      {Number(selectedCustomer.total_debt) > 0 && (
                        <>
                          {' · '}
                          {/* Insécable : passe à la ligne d'un bloc plutôt que de couper « Solde / dû » */}
                          <span className="whitespace-nowrap font-medium text-red-500">{t('sales.debt_due_inline', { amount: formatNaira(selectedCustomer.total_debt) })}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('') }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t('actions.remove')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  {/* Recherche d'un client existant — ou saisie d'un nouveau */}
                  <div className="relative">
                    <Input
                      value={customerName}
                      onChange={e => { setCustomerName(e.target.value); setShowCustomerDropdown(e.target.value.length > 0) }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                      placeholder={t('sales.customer_name_placeholder')}
                    />
                    {customerName && (
                      <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => { setCustomerName(''); setCustomerPhone('') }}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {showCustomerDropdown && filteredCustomers.length > 0 && (
                      <div className="absolute z-20 w-full bg-card border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {filteredCustomers.slice(0, 8).map(c => (
                          <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                            onMouseDown={() => { setSelectedCustomer(c); setCustomerName(''); setCustomerPhone(c.phone || ''); setShowCustomerDropdown(false) }}>
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-[11px] font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400" aria-hidden="true">
                              {(c.name.trim().charAt(0) || '?').toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <Input
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder={t('sales.customer_phone_placeholder')}
                    type="tel"
                  />
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Debt repayment section ── */}
          {selectedCustomer && Number(selectedCustomer.total_debt) > 0 && customerUnpaidSales.length > 0 && (
            <Card className="border border-orange-200 bg-orange-50 shadow-sm dark:border-orange-900/60 dark:bg-orange-950/30">
              <CardContent className="p-4 space-y-3">
                {/* Carte dette : reste orange (c'est un rappel, pas de la marque) ;
                    seul l'interrupteur actif prend le bleu de marque. */}
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300" aria-hidden="true">
                    <Coins className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">{t('sales.include_debt_repayment')}</p>
                    <p className="text-xs text-orange-600 dark:text-orange-300/80">
                      {t('sales.current_debt_label')} : <strong>{formatNaira(debtOutstanding)}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={debtRepayEnabled}
                    aria-label={t('sales.include_debt_repayment')}
                    onClick={() => setDebtRepayEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      debtRepayEnabled ? 'bg-stockshop-blue dark:bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      debtRepayEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>

                {debtRepayEnabled && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <Label className="text-xs text-orange-800 dark:text-orange-200">{t('sales.amount_given_for_debt')}</Label>
                      <div className="flex rounded-md border border-orange-200 overflow-hidden focus-within:ring-2 focus-within:ring-orange-300 dark:border-orange-900/60 dark:focus-within:ring-orange-700">
                        <span className="flex items-center px-2.5 bg-orange-50 border-r border-orange-200 text-sm text-muted-foreground font-medium whitespace-nowrap select-none dark:bg-orange-950/30 dark:border-orange-900/60">{symbol}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={formatInputValue(debtRepayAmount, currencyCode)}
                          onChange={e => {
                            const n = Number(e.target.value.replace(/\D/g, '')) || 0
                            const max = Math.floor(debtOutstanding)
                            setDebtCapped(n > max)
                            setDebtRepayAmount(n > max ? String(max) : (n ? String(n) : ''))
                          }}
                          className="flex-1 h-11 px-3 text-base font-bold bg-card outline-none"
                          placeholder="0"
                        />
                      </div>
                      {debtCapped && (
                        <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                          {t('sales.debt_capped', { amount: formatNaira(debtOutstanding) })}
                        </p>
                      )}
                      {debtAmt > 0 && (
                        <p className="text-xs text-orange-600 dark:text-orange-300/80">
                          {t('sales.remaining_after')} : <strong>{formatNaira(Math.max(0, debtOutstanding - debtAmt))}</strong>
                          {debtAmt >= debtOutstanding && ` ${t('sales.debt_settled_check')}`}
                        </p>
                      )}
                    </div>

                    {/* Résumé */}
                    {debtAmt > 0 && (
                      <div className="rounded-lg bg-card border border-orange-200 p-3 space-y-1 text-sm dark:border-orange-900/60">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Vente</span><span>{formatNaira(total)}</span>
                        </div>
                        <div className="flex justify-between text-orange-700 dark:text-orange-300">
                          <span>Remboursement crédit</span><span>+{formatNaira(debtAmt)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t pt-1">
                          <span>{t('sales.total_to_collect')}</span>
                          <span className="text-stockshop-blue dark:text-blue-400">{formatNaira(totalToCollect)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          </div>{/* fin étape 1 (panier) */}

          {/* Barre fixe de l'étape panier (téléphone) : mise en attente +
              « Encaisser », qui passe à l'étape paiement. */}
          <div className={cn(
            'md:hidden sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur !mt-auto',
            mobileStep !== 'cart' && 'hidden',
          )}>
            <Button
              variant="outline"
              className="h-12 w-12 shrink-0 p-0 border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={openHoldDialog}
              disabled={completing}
              aria-label="Mettre en attente"
              title="Mettre en attente"
            >
              <PauseCircle className="h-5 w-5" />
            </Button>
            <Button variant="stockshop" className="flex-1 h-12 text-base gap-2" onClick={() => setMobileStep('payment')}>
              <CreditCard className="h-5 w-5" />
              {t('sales.checkout_collect', { amount: formatNaira(collectedNow) })}
            </Button>
          </div>

          {/* ══ Étape 2 (téléphone) : PAIEMENT — moyen, montant → « Valider » ══ */}
          <div className={cn('space-y-2', mobileStep === 'cart' ? 'hidden md:block' : 'max-md:flex max-md:flex-1 max-md:flex-col')}>

          {/* Rappel du montant (téléphone) — le détail vente/dette reste
              visible sans revenir au panier. */}
          {/* Le gros montant = ce qui est RÉELLEMENT encaissé maintenant
              (en vente à crédit avec remboursement : la dette seule). */}
          <div className="md:hidden rounded-xl bg-muted/60 p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {isCreditSale && debtAmt === 0 ? t('sales.credit_sale_label') : t('sales.total_to_collect')}
            </p>
            <p className="text-2xl font-bold text-stockshop-blue dark:text-blue-400">
              {formatNaira(isCreditSale && debtAmt === 0 ? total : collectedNow)}
            </p>
            {debtAmt > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {isCreditSale ? t('sales.credit_sale_label') : t('sales.total')} {formatNaira(total)} · {t('receipt.debt_repayment')} +{formatNaira(debtAmt)}
              </p>
            )}
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <Label>
              {t('payment.method')}
              {splitPayment && <span className="text-xs text-muted-foreground ml-1">(1er paiement)</span>}
            </Label>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {getCountry(shop?.country).paymentMethods.map(method => (
                <button key={method.id}
                  onClick={() => {
                    setPaymentMethod(method.id)
                    if (splitMethod2 === method.id) setSplitMethod2('')
                  }}
                  className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 tap-target ${
                    paymentMethod === method.id
                      ? 'border-stockshop-blue bg-gradient-to-b from-stockshop-blue-muted to-stockshop-blue-muted/60 dark:border-blue-500 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                      : 'border-input bg-card hover:border-stockshop-blue/40 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                  }`}
                >
                  {paymentMethod === method.id && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-stockshop-blue dark:bg-blue-500 text-white text-[9px] font-bold">✓</span>
                  )}
                  <div className={`rounded-xl p-2 transition-colors ${paymentMethod === method.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                    {method.logo
                      ? <img src={method.logo} alt={method.label} className="h-12 w-12 object-contain" />
                      : <span className="text-3xl leading-none block">{method.icon}</span>
                    }
                  </div>
                  <span className={`text-xs font-semibold text-center leading-tight ${paymentMethod === method.id ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground'}`}>
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
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{symbol}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, currencyCode)}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 h-12 px-3 text-lg font-bold bg-card outline-none"
                    placeholder={formatInputValue(totalToCollect, currencyCode) || '0'} />
                </div>
              </div>
              {/* Montants rapides : le cas le plus courant (montant exact) en
                  1 tap, puis le total arrondi aux billets supérieurs. Saisie
                  entière (comme le champ) : arrondi au-dessus pour qu'un
                  total à décimales reste toujours couvert. */}
              <div className="flex flex-wrap gap-2">
                {[Math.ceil(totalToCollect), ...cashSuggestions(Math.ceil(totalToCollect), currencyCode)].map((v, i) => {
                  const active = Number(amountPaid) === v
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmountPaid(String(v))}
                      className={cn(
                        'h-10 rounded-lg border px-3 text-sm font-semibold transition-colors tap-target',
                        active
                          ? 'border-stockshop-blue bg-stockshop-blue-muted text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                          : 'border-input bg-card hover:bg-accent',
                      )}
                    >
                      {i === 0 ? t('sales.cash_exact_amount') : formatInputValue(v, currencyCode)}
                    </button>
                  )
                })}
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
                    methodType === 'mobile_money' ? t('sales.ref_placeholder_mobile') :
                    methodType === 'card' ? t('sales.ref_placeholder_card') :
                    t('sales.ref_placeholder_transfer')
                  }
                />
              </div>
              <div className="rounded-lg bg-stockshop-blue-muted border border-stockshop-blue/20 p-3 text-center dark:bg-blue-950/40 dark:border-blue-800">
                <p className="text-sm text-muted-foreground">{t('sales.amount_to_receive')}</p>
                <p className="text-2xl font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(total)}</p>
              </div>
            </div>
          )}

          {!splitPayment && methodType === 'credit' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm font-medium text-amber-700">
                {t('sales.adds_to_debt_of', { amount: formatNaira(total) })}{' '}
                {selectedCustomer?.name || customerName || t('sales.this_customer')}
              </p>
              {!selectedCustomer && !customerName && (
                <>
                  <p className="text-xs text-amber-600 mt-1">{t('sales.enter_customer_for_credit')}</p>
                  {/* Téléphone : le client se saisit à l'étape panier */}
                  <button type="button"
                    onClick={() => { setShowCustomer(true); setMobileStep('cart') }}
                    className="md:hidden mt-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 underline underline-offset-2 tap-target">
                    <User className="h-4 w-4" />{t('sales.choose_customer_for_credit')}
                  </button>
                </>
              )}
              {debtAmt > 0 && (
                <p className="text-xs font-medium text-amber-800 mt-1">
                  {t('sales.credit_debt_cash_note', { amount: formatNaira(debtAmt) })}
                </p>
              )}
              {selectedCustomer?.credit_limit != null && (Number(selectedCustomer.total_debt) + total) > selectedCustomer.credit_limit && (
                <p className="text-xs text-red-600 font-semibold mt-1">
                  {t('sales.exceeds_credit_limit', { limit: formatNaira(selectedCustomer.credit_limit) })}
                </p>
              )}
            </div>
          )}

          {/* Split payment toggle */}
          {methodType !== 'credit' && (
            <button
              type="button"
              onClick={() => {
                if (!splitPayment) {
                  const other = getCountry(shop?.country).paymentMethods
                    .find(m => m.id !== paymentMethod && m.id !== 'credit')
                  setSplitMethod2(other?.id || '')
                }
                setSplitPayment(!splitPayment)
                setAmountPaid('')
              }}
              className="flex items-center gap-1.5 text-sm text-stockshop-blue dark:text-blue-400 hover:underline"
            >
              {splitPayment ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {splitPayment ? t('sales.cancel_split_payment') : t('sales.split_payment_label')}
            </button>
          )}

          {/* Split payment UI */}
          {splitPayment && (
            <div className="rounded-lg border border-dashed border-stockshop-blue/40 dark:border-blue-700 p-3 space-y-3">
              {/* Amount for method 1 */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  {t('sales.amount_paid_in', { method: getCountry(shop?.country).paymentMethods.find(m => m.id === paymentMethod)?.label || paymentMethod })}
                </Label>
                <div className="flex rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex items-center px-3 bg-muted border-r text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{symbol}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, currencyCode)}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="flex-1 h-11 px-3 text-lg font-bold bg-card outline-none"
                    placeholder="0" />
                </div>
              </div>

              {/* Method 2 selector */}
              <div className="space-y-1.5">
                <Label className="text-sm">{t('sales.second_payment_method')}</Label>
                <div className="grid grid-cols-3 gap-2.5">
                  {getCountry(shop?.country).paymentMethods
                    .filter(m => m.id !== paymentMethod && m.id !== 'credit')
                    .map(method => (
                      <button key={method.id} type="button" onClick={() => setSplitMethod2(method.id)}
                        className={`relative rounded-2xl border-2 py-4 px-2 flex flex-col items-center gap-2 transition-all duration-200 active:scale-95 tap-target ${
                          splitMethod2 === method.id
                            ? 'border-stockshop-blue bg-gradient-to-b from-stockshop-blue-muted to-stockshop-blue-muted/60 dark:border-blue-500 dark:from-blue-950/60 dark:to-blue-900/30 shadow-lg shadow-blue-200/60 dark:shadow-blue-900/40'
                            : 'border-input bg-card hover:border-stockshop-blue/40 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                        }`}
                      >
                        {splitMethod2 === method.id && (
                          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-stockshop-blue dark:bg-blue-500 text-white text-[9px] font-bold">✓</span>
                        )}
                        <div className={`rounded-xl p-2 transition-colors ${splitMethod2 === method.id ? 'bg-white dark:bg-white/15 shadow-sm' : 'bg-muted/40 dark:bg-white/5'}`}>
                          {method.logo
                            ? <img src={method.logo} alt={method.label} className="h-12 w-12 object-contain" />
                            : <span className="text-3xl leading-none block">{method.icon}</span>
                          }
                        </div>
                        <span className={`text-xs font-semibold text-center leading-tight ${splitMethod2 === method.id ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground'}`}>
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
                    Montant {getCountry(shop?.country).paymentMethods.find(m => m.id === splitMethod2)?.label || splitMethod2}
                  </span>
                  <span className="font-bold text-lg text-stockshop-blue dark:text-blue-400">
                    {formatNaira(Math.max(0, totalToCollect - (Number(amountPaid) || 0)))}
                  </span>
                </div>
              )}

              {/* Warning if method 1 already covers everything */}
              {(Number(amountPaid) || 0) >= totalToCollect && Number(amountPaid) > 0 && (
                <p className="text-xs text-orange-500 text-center">
                  {t('sales.amount_covers_total_no_second')}
                </p>
              )}
            </div>
          )}


          {/* Échéance de paiement — uniquement si la vente laisse un solde */}
          {outstandingBalance > 0 && (
            <div className="space-y-1.5">
              <Label>{t('sales.due_date_label')}</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={e => { dueDateTouchedRef.current = true; setDueDate(e.target.value) }}
              />
              <p className="text-xs text-muted-foreground">{t('sales.due_date_hint')}</p>
            </div>
          )}

          {/* Notes — téléphone : repliées tant qu'elles sont vides */}
          {!(showNotes || notes) && (
            <button type="button" onClick={() => setShowNotes(true)}
              className="md:hidden flex items-center gap-1.5 text-sm font-medium text-stockshop-blue dark:text-blue-400 tap-target">
              <Plus className="h-3.5 w-3.5" />{t('sales.add_note')}
            </button>
          )}
          <div className={cn('space-y-1.5', !(showNotes || notes) && 'hidden md:block')}>
            <Label>{t('sales.notes_optional_label')}</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('sales.notes_placeholder')} />
          </div>

          {/* Action buttons — téléphone : barre fixe en bas de l'étape paiement */}
          <div className="flex gap-2 sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur max-md:!mt-auto md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <Button
              variant="outline"
              className="h-12 w-12 shrink-0 p-0 gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 md:w-auto md:flex-1 md:px-4"
              onClick={openHoldDialog}
              disabled={cart.length === 0 || completing}
              aria-label="Mettre en attente"
              title="Mettre en attente"
            >
              <PauseCircle className="h-5 w-5 md:h-4 md:w-4" />
              <span className="hidden md:inline">Mettre en attente</span>
            </Button>
            <Button
              variant="stockshop"
              className="flex-1 md:flex-[2] h-12 text-base"
              onClick={completeSale}
              loading={completing}
              disabled={cart.length === 0 || completing}
            >
              <CheckCircle className="mr-2 h-5 w-5" />
              {isCreditSale
                ? (collectedNow > 0
                    ? t('sales.validate_collect', { amount: formatNaira(collectedNow) })
                    : t('sales.validate_credit_sale'))
                : `Valider · ${formatNaira(collectedNow)}`}
            </Button>
          </div>
          </div>{/* fin étape 2 (paiement) */}
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
                <p className="text-xs font-medium text-blue-200 uppercase tracking-wider mb-1">{t('products.selling_price')}</p>
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
                  <p className="text-xs text-muted-foreground mb-2 font-medium">{t('sales.new_selling_price')}</p>
                  <div className="flex rounded-xl border-2 border-stockshop-blue overflow-hidden shadow-sm">
                    <span className="flex items-center px-4 bg-stockshop-blue/5 border-r border-stockshop-blue/30 text-sm font-bold text-stockshop-blue whitespace-nowrap select-none">
                      {symbol}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoFocus
                      value={formatInputValue(priceModalInput, currencyCode)}
                      onChange={e => setPriceModalInput(e.target.value.replace(/\D/g, ''))}
                      className="flex-1 h-14 px-4 text-2xl font-bold bg-card outline-none tracking-tight"
                      placeholder={formatInputValue(minPrice, currencyCode)}
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
        title={t('sales.pending_invoices_title')}
        icon={<Clock className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-2 max-h-[70vh] overflow-y-auto">
          {/* Nettoyage des anciennes — jamais automatique (ce sont des ventes),
              toujours sur confirmation du caissier. */}
          {(() => {
            const stale = shopDrafts.filter(d => heldAgeDays(d.createdAt) >= HELD_STALE_DAYS).length
            return stale > 0 ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <span>{t('sales.held_stale_notice', { count: stale, days: HELD_STALE_DAYS })}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0 border-amber-300 text-amber-800" onClick={deleteStaleDrafts}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />{t('sales.held_stale_delete', { count: stale })}
                </Button>
              </div>
            ) : null
          })()}
          {shopDrafts.map(draft => {
            const draftTotal = draft.cart.reduce((s, i) => s + i.subtotal, 0) - draft.discount
            const itemCount = draft.cart.reduce((s, i) => s + i.quantity, 0)
            const age = heldAgeDays(draft.createdAt)
            const time = new Date(draft.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
            const when = age === 0 ? t('sales.held_today', { time })
              : age === 1 ? t('sales.held_yesterday', { time })
              : t('sales.held_days_ago', { days: age })
            return (
              <div key={draft.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{draft.label || draft.customerName || 'Client anonyme'}</p>
                    {draft.label && draft.customerName && <p className="text-xs text-muted-foreground truncate">{draft.customerName}</p>}
                    {draft.customerPhone && <p className="text-xs text-muted-foreground">{draft.customerPhone}</p>}
                    <p className={cn('text-xs mt-0.5', age >= HELD_STALE_DAYS ? 'text-amber-700 font-medium' : 'text-muted-foreground')}>
                      {itemCount} article{itemCount > 1 ? 's' : ''} · {when}
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

      {/* Mise en attente — nom facultatif pour retrouver la facture */}
      <PremiumDialog
        open={showHoldDialog}
        onOpenChange={setShowHoldDialog}
        category="Ventes"
        title={t('sales.hold_dialog_title')}
        icon={<PauseCircle className="h-4 w-4" />}
        centered
      >
        <PremiumDialogBody>
          <form onSubmit={e => { e.preventDefault(); doHold(holdLabel) }} className="space-y-3">
            <Label htmlFor="hold-label">{t('sales.hold_label')}</Label>
            <Input
              id="hold-label"
              autoFocus
              value={holdLabel}
              maxLength={40}
              onChange={e => setHoldLabel(e.target.value)}
              placeholder={(selectedCustomer?.name || customerName.trim()) || t('sales.hold_label_placeholder')}
            />
            <p className="text-xs text-muted-foreground">{t('sales.hold_label_hint')}</p>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setShowHoldDialog(false)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" variant="stockshop" className="flex-[2] h-11 gap-2">
                <PauseCircle className="h-4 w-4" />{t('sales.hold_confirm')}
              </Button>
            </div>
          </form>
        </PremiumDialogBody>
      </PremiumDialog>

      {/* Reprise alors qu'un autre panier est en cours — jamais d'écrasement
          silencieux : on propose de le mettre d'abord en attente. */}
      <PremiumDialog
        open={!!pendingResume}
        onOpenChange={open => { if (!open) setPendingResume(null) }}
        category="Ventes"
        title={t('sales.resume_conflict_title')}
        icon={<PlayCircle className="h-4 w-4" />}
        centered
      >
        <PremiumDialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('sales.resume_conflict_desc', { count: cart.length, amount: formatNaira(total) })}
          </p>
          <Button
            variant="stockshop"
            className="w-full h-auto min-h-11 gap-2 whitespace-normal py-2.5 leading-snug"
            onClick={() => { const d = pendingResume; if (!d) return; doHold(''); applyDraft(d) }}
          >
            <PauseCircle className="h-4 w-4" />{t('sales.resume_hold_current')}
          </Button>
          <Button
            variant="outline"
            className="w-full h-auto min-h-11 whitespace-normal py-2.5 leading-snug border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => { const d = pendingResume; if (d) applyDraft(d) }}
          >
            {t('sales.resume_replace')}
          </Button>
          <Button variant="ghost" className="w-full h-10" onClick={() => setPendingResume(null)}>
            {t('actions.cancel')}
          </Button>
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
                  {shop?.logo_url ? (
                    <img src={shop.logo_url} alt={shop.name} className="h-8 w-8 object-contain rounded" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-stockshop-blue flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {shop?.name?.slice(0, 2).toUpperCase() || 'SS'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-xs truncate">{shop?.name}</p>
                    {shop?.city && <p className="text-[10px] text-muted-foreground">{shop.city}</p>}
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
                {receiptDebt && receiptDebt.amount > 0 && (
                  <>
                    <div className="flex justify-between text-xs text-orange-700 dark:text-orange-400">
                      <span>{t('receipt.debt_repayment')}</span>
                      <span>+{formatNaira(receiptDebt.amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold">
                      <span>{t('receipt.total_collected')}</span>
                      <span>{formatNaira(Number(completedSale.amount_paid) + receiptDebt.amount)}</span>
                    </div>
                    {receiptDebt.status !== 'applied' && (
                      <p className={cn('text-[11px]', receiptDebt.status === 'failed' ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                        {receiptDebt.status === 'failed' ? t('sales.debt_status_failed') : t('sales.debt_status_queued')}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={handleWhatsAppReceipt} className="gap-2">
                  <MessageCircle className="h-4 w-4" /> {t('actions.whatsapp')}
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

      {/* Bandeau panier (sous md) — ouvre le panneau panier plein écran.
          Masqué quand le panneau est ouvert (redondant, et il recouvrait le
          contenu). Point de rupture aligné sur celui du panneau (md) : avec
          l'ancien sm:hidden, entre 640 et 767 px le panier aurait été
          inaccessible. La barre de navigation du bas disparaît dès sm, d'où
          sm:bottom-0. */}
      {/* + accès permanent aux ventes en attente (téléphone) : à gauche du
          bandeau panier, ou seul (barre ambre) quand le panier est vide. */}
      {!mobileCartOpen && (cart.length > 0 || shopDrafts.length > 0) && (
        <div className="fixed bottom-16 sm:bottom-0 left-0 right-0 z-30 flex shadow-lg md:hidden">
          {shopDrafts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDrafts(true)}
              aria-label={t('sales.invoices_pending', { count: shopDrafts.length })}
              className={cn(
                'flex items-center justify-center gap-1.5 bg-amber-500 px-4 py-3 text-sm font-bold text-white',
                cart.length === 0 && 'flex-1 justify-between',
              )}
            >
              <span className="flex items-center gap-2">
                <PauseCircle className="h-4 w-4" />
                {cart.length === 0 ? t('sales.invoices_pending', { count: shopDrafts.length }) : shopDrafts.length}
              </span>
              {cart.length === 0 && <ChevronUp className="h-4 w-4" />}
            </button>
          )}
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => { setMobileStep('cart'); setMobileCartOpen(true) }}
              className="flex flex-1 items-center justify-between gap-3 bg-stockshop-blue text-white px-4 py-3"
            >
              <span className="flex items-center gap-2 font-semibold text-sm">
                <ShoppingCart className="h-4 w-4" />
                {t('sales.cart_items_count', { count: cart.length })}
              </span>
              <span className="flex items-center gap-1.5 font-bold text-sm">
                {formatNaira(total)}
                <ChevronUp className="h-4 w-4" />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
