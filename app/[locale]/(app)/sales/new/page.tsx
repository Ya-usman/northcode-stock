'use client'

import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Plus, Minus, Trash2, CheckCircle, MessageCircle, Printer, Share2,
  Scan, X, User, Clock, PauseCircle, PlayCircle, Edit2, ShoppingCart, ChevronUp, ChevronRight, Star, ArrowLeft,
  AlertTriangle, CreditCard, Coins, ShoppingBag, FileText,
} from 'lucide-react'
import { readTicketSettings } from '@/lib/receipt/print-settings'
import { printSaleTicket, ticketErrorKey } from '@/lib/receipt/print-ticket'
import { ticketLabelsFromT } from '@/lib/receipt/ticket'
import { hideStockShopBranding } from '@/lib/receipt/branding'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { effectivePrice as sharedEffectivePrice } from '@/lib/sales/pricing'
import { ShopSelector } from '@/components/layout/shop-selector'
import { ProductCard, type StockVariant } from '@/components/sales/product-card'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { DebtRepaymentCard } from '@/components/sales/debt-repayment-card'
import { PaymentMethodCard } from '@/components/sales/payment-method-card'
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
import { buildWhatsAppLink, buildReceiptWhatsAppMessage, normalizeWhatsAppNumber } from '@/lib/utils/whatsapp'
import { generateReceiptToken, receiptUrl } from '@/lib/receipt/receipt-link'
import { ShopLogo } from '@/components/shop/shop-logo'
import { CustomerPicker } from '@/components/sales/customer-picker'
import { BookUser as BookUserIcon, UploadCloud as CloudUpload, Loader2, ExternalLink as ExternalLinkIcon } from 'lucide-react'
import { receiptLabelsFromT } from '@/lib/receipt/receipt-labels'
import { sharePDFNative, isCapacitor } from '@/lib/utils/native-share'
import type { Product, Customer, CartItem, Sale, SaleItem, Category } from '@/lib/types/database'
import dynamic from 'next/dynamic'
import { cacheProducts, getCachedProducts, cacheCustomers, getCachedCustomers, savePendingSale, savePendingCustomerPayment, type PendingSalePayment } from '@/lib/offline/db'
import { allocateCheckout, outstandingDebt } from '@/lib/utils/checkout-allocation'
import { revalidateHeldCart, heldAgeDays, HELD_STALE_DAYS, type HeldCartChange } from '@/lib/utils/held-sales'
import { clearPageCache, clearPageCacheByPrefix } from '@/lib/offline/page-cache'
import { cashSuggestions } from '@/lib/utils/cash-suggestions'
import { registerBackgroundSync, syncSoon, syncSaleNow } from '@/lib/offline/sync'
import { ConfirmModal } from '@/components/ui/confirm-modal'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-1 h-12 rounded-xl bg-muted animate-pulse" /> }
)
import { useOffline, checkConnectivity } from '@/lib/offline/use-offline'
import { triggerSaleFeedback, unlockAudio } from '@/lib/utils/sale-feedback'
import { getCountry, getMethodType, getPaymentMethodLabel } from '@/lib/saas/countries'
import { withTimeout, refreshSessionBeforeWrite } from '@/lib/utils/with-timeout'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useStockRealtime } from '@/lib/hooks/use-realtime'
import { queryClient } from '@/lib/query-client'
import { invalidateSalesData } from '@/lib/query-keys'
import { formatInputValue, formatCurrency } from '@/lib/utils/currency'
import { checkAndNotifyLowStock, notifyNewSale } from '@/lib/push'
import { samePhone, resolveStoredPhone } from '@/lib/phone/compare'
import { emitOnboarding } from '@/lib/onboarding/events'

// Champ téléphone international (indicatif dans une liste) : chargé à l'usage,
// seulement quand le vendeur ouvre la saisie d'un nouveau client
const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => ({ default: m.PhoneInput })), {
  ssr: false,
  loading: () => <div className="h-10 w-full animate-pulse rounded-md border border-input bg-muted/40" />,
})

// Prix effectif d'un produit : priorité au prix promo du lot FEFO en tête
// de file (celui qui sera réellement vendu en premier — voir
// frontBatchPromo, construit dans loadShopData), sinon la promo produit
// (091), sinon le prix catalogue. Le prix du lot revient automatiquement
// au prix produit/catalogue dès que ce lot est épuisé, puisque
// frontBatchPromo n'est construit qu'à partir des lots avec quantity > 0 —
// aucune action manuelle nécessaire (voir migration 095).
// Règle unique, partagée avec le contrôle serveur de la vente
// (lib/sales/pricing.ts, lib/api/sale-validation.ts) : plancher du prix de
// ligne — au-dessus, libre.
function effectivePrice(product: Product, frontBatchPromo?: Record<string, { price: number; until: string; start: string | null }>): number {
  return sharedEffectivePrice(product, frontBatchPromo?.[product.id] ?? null)
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
  // Remise : droit « Accorder une remise » (règle unique des permissions)
  const { canAccess } = useRolePermissions()
  const canDiscount = canAccess('discount')
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
  const [clearCartOpen, setClearCartOpen] = useState(false)
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
  // Tour guidé « Faire une vente » : un article vient d'entrer dans le panier
  const cartLenRef = useRef(0)
  useEffect(() => {
    if (cart.length > cartLenRef.current) emitOnboarding('cart_item_added')
    cartLenRef.current = cart.length
  }, [cart.length])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  // Sélecteur de client (carnet) ; « Récents » = clients des dernières ventes, chargés à la 1re ouverture
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerPickerQuery, setCustomerPickerQuery] = useState('')
  const [recentCustomerIds, setRecentCustomerIds] = useState<string[]>([])
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
  // Vente affichée dans le reçu, lisible depuis le code asynchrone (envoi / impression)
  const completedSaleRef = useRef<any>(null)
  useEffect(() => { completedSaleRef.current = completedSale }, [completedSale])
  // Reçu d'une vente mise en file : synchronisation avant envoi, envoi sans lien, ouverture bloquée
  const [preparingReceipt, setPreparingReceipt] = useState(false)
  const [noLinkPrompt, setNoLinkPrompt] = useState(false)
  const [waFallbackUrl, setWaFallbackUrl] = useState<string | null>(null)
  const autoWhatsAppRef = useRef<string | null>(null)
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
  // Détail d'encaissement pour le ticket (capturé AVANT resetForm) : lignes par
  // moyen (mixte), espèces reçues et monnaie rendue.
  const [receiptPay, setReceiptPay] = useState<{ payments: { method: string; amount: number }[]; cashReceived: number; change: number; customerName?: string; customerPhone?: string } | null>(null)
  // Nom et téléphone du client sur le reçu : relation `customers` de la vente
  // enregistrée, sinon ce qui était saisi (vente hors ligne : pas de relation).
  const receiptCustomerName = (completedSale as any)?.customers?.name || receiptPay?.customerName || undefined
  const receiptCustomerPhone = (completedSale as any)?.customers?.phone || receiptPay?.customerPhone || undefined
  const autoPrintedRef = useRef<string | null>(null)

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

  // « Vider le panier » : abandon de toute la vente en cours (articles, client,
  // remise, notes, dette), après confirmation. Une facture en attente reprise
  // n'est pas touchée : elle n'est supprimée qu'à la validation.
  const clearCart = () => {
    resetForm()
    setClearCartOpen(false)
    toast({ title: t('sales.clear_cart_done') })
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
    autoLinkDismissed.current = ''
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
  // Sans le droit, une remise restée dans un panier mis de côté est ignorée
  const discountAmt = canDiscount ? discount : 0
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
  // Saisie du remboursement (carte dette) : plafonnée à la dette réelle.
  const handleDebtAmountChange = useCallback((raw: string) => {
    const n = Number(raw.replace(/\D/g, '')) || 0
    const max = Math.floor(debtOutstanding)
    setDebtCapped(n > max)
    setDebtRepayAmount(n > max ? String(max) : (n ? String(n) : ''))
  }, [debtOutstanding])
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
  // « 3 clients existants correspondent » sous le champ « nouveau client » : évite les doublons
  const matchingCustomers = customerName.trim().length >= 2 ? filteredCustomers.length : 0

  // Suggestions DIRECTES sous le champ « nom » (dès 2 caractères) : un client
  // déjà dans le carnet est proposé pendant la saisie, un toucher le rattache.
  // Ordre : nom qui commence par la saisie, puis un mot qui commence par la
  // saisie, puis nom qui la contient, puis téléphone qui contient les chiffres
  // tapés (≥ 3). Jamais de rattachement automatique sur une simple
  // ressemblance : le vendeur choisit (règle anti-doublon inchangée).
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(-1)
  const customerSuggestions = useMemo(() => {
    const q = customerName.trim()
    if (q.length < 2 || selectedCustomer) return [] as Customer[]
    const nq = normalize(q)
    const dq = q.replace(/\D/g, '')
    return customers
      .map(c => {
        const n = normalize(c.name)
        const byName = n.startsWith(nq) ? 0 : n.split(/\s+/).some(w => w.startsWith(nq)) ? 1 : n.includes(nq) ? 2 : -1
        const byPhone = dq.length >= 3 && c.phone && c.phone.replace(/\D/g, '').includes(dq) ? 3 : -1
        return { c, score: byName >= 0 ? byName : byPhone }
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
      .map(x => x.c)
  }, [customerName, customers, selectedCustomer])
  const SUGGEST_MAX = 5
  const showSuggestions = suggestOpen && customerSuggestions.length > 0
  const pickSuggestion = (c: Customer) => {
    setSuggestOpen(false)
    setSuggestIndex(-1)
    linkCustomer(c)
  }
  const onCustomerNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return
    const max = Math.min(customerSuggestions.length, SUGGEST_MAX)
    if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIndex(i => (i + 1) % max) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIndex(i => (i <= 0 ? max - 1 : i - 1)) }
    else if (e.key === 'Enter' && suggestIndex >= 0) { e.preventDefault(); pickSuggestion(customerSuggestions[suggestIndex]) }
    else if (e.key === 'Escape') { setSuggestOpen(false); setSuggestIndex(-1) }
  }

  // Anti-doublon : un nom tapé qui correspond EXACTEMENT (accents et majuscules
  // ignorés) à une seule fiche existante, avec un téléphone compatible (absent
  // d'un côté ou identique), est rattaché à cette fiche — sinon la base créait
  // un client par vente (elle ne réutilise une fiche que sur le téléphone).
  // Homonymes : si le vendeur retire lui-même un rattachement (×), ce nom n'est
  // plus rattaché automatiquement pour cette vente → une nouvelle fiche est créée.
  const autoLinkDismissed = useRef('')
  const exactCustomerMatches = (): Customer[] => {
    const typed = normalize(customerName.trim())
    if (!typed || typed === autoLinkDismissed.current) return []
    const typedPhone = customerPhone.replace(/\D/g, '')
    return customers.filter(c => {
      if (normalize(c.name) !== typed) return false
      // « 0753… » et « +33 7 53… » désignent le même numéro
      return !typedPhone || !c.phone || samePhone(customerPhone, c.phone)
    })
  }
  const linkCustomer = (c: Customer) => {
    setSelectedCustomer(c); setCustomerName(''); setCustomerPhone(c.phone || '')
    toast({ title: t('sales.customer_linked', { name: c.name }), variant: 'success' })
  }
  // À la sortie du champ « nom » : rattachement immédiat, visible avant de payer
  const autoLinkTypedCustomer = () => {
    if (selectedCustomer) return
    const exact = exactCustomerMatches()
    if (exact.length === 1) linkCustomer(exact[0])
  }
  // Rattachement au moment d'encaisser : l'état React se met à jour après le
  // retour de completeSale, l'effet relance alors la validation une seule fois.
  const autoLinkRetry = useRef(false)
  useEffect(() => {
    if (autoLinkRetry.current && selectedCustomer) {
      autoLinkRetry.current = false
      completeSale()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer])

  const loadRecentCustomers = async () => {
    if (!shop?.id || recentCustomerIds.length || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    try {
      const { data } = await withTimeout(
        supabase.from('sales').select('customer_id, created_at').eq('shop_id', shop.id)
          .not('customer_id', 'is', null).order('created_at', { ascending: false }).limit(120),
      )
      const ids: string[] = []
      for (const r of (data || []) as { customer_id: string | null }[]) {
        if (r.customer_id && !ids.includes(r.customer_id)) ids.push(r.customer_id)
      }
      setRecentCustomerIds(ids.slice(0, 20))
    } catch { /* hors ligne ou lent : pas d'onglet Récents, le carnet reste utilisable */ }
  }
  const openCustomerPicker = (query = '') => {
    setCustomerPickerQuery(query)
    setCustomerPickerOpen(true)
    loadRecentCustomers()
  }

  // ── COMPLETE SALE ───────────────────────────────────────
  const completeSale = async () => {
    if (cart.length === 0) { toast({ title: t('toast.cart_empty'), variant: 'destructive' }); return }
    // Filet de sécurité anti-doublon (voir exactCustomerMatches) : une fiche
    // exacte → rattachée puis validation relancée ; plusieurs → le carnet s'ouvre
    if (!selectedCustomer && customerName.trim()) {
      const exact = exactCustomerMatches()
      if (exact.length === 1) { autoLinkRetry.current = true; linkCustomer(exact[0]); return }
      if (exact.length > 1) { openCustomerPicker(customerName.trim()); return }
    }
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
    // `reason` : pourquoi la vente part en file (affiché dans l'Historique).
    // `onlineKey` : clé de l'essai en ligne qui a échoué (délai, serveur) — la
    // synchronisation retrouve alors la vente si cet essai avait en fait
    // abouti côté serveur, au lieu de la créer une 2e fois.
    const saveOffline = async (toastMsg: string, reason: string, onlineKey?: string) => {
      const localId = onlineKey ? `local-${onlineKey}` : `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const saleNumber = `HL-${localId.slice(-5).toUpperCase()}`
      // Jeton du reçu tiré ici : le QR du ticket est imprimé avant la synchro
      const receiptToken = generateReceiptToken()

      // Try to persist — if IndexedDB fails, still show the receipt
      let persisted = false
      if (_shopId && _cashierId) {
        try {
          await savePendingSale({
            local_id: localId,
            receipt_token: receiptToken,
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
            // Forme enregistrée d'un client connu au même numéro : la
            // synchronisation ne rattache un client que sur égalité exacte
            customer_phone: resolveStoredPhone(customerPhone, customers) || selectedCustomer?.phone || null,
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
            offline_reason: reason,
          })
          persisted = true
          refreshPendingCount().catch(() => {})
          registerBackgroundSync()
          // Réseau présent (délai dépassé, serveur indisponible, détection trop
          // prudente) : envoi tout de suite puis à 5 s et 15 s, sans attendre
          // la boucle de 30 s — le lien du reçu devient actif au plus vite.
          if (typeof navigator === 'undefined' || navigator.onLine !== false) syncSoon(_shopId)
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
      emitOnboarding('sale_completed') // tour guidé « Faire une vente » (vente mise en file hors ligne)
      setReceiptPay({ payments: salePayments.map(p => ({ method: p.method, amount: p.amount })), cashReceived: !splitPayment && methodType === 'cash' ? (Number(amountPaid) || 0) : 0, change, customerName: selectedCustomer?.name || customerName.trim() || undefined, customerPhone: selectedCustomer?.phone || customerPhone.trim() || undefined })
      setCompletedSale({
        id: localId,
        sale_number: saleNumber,
        receipt_token: receiptToken,
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
    // Le moniteur peut dire « hors ligne » quelques secondes à tort (réveil de
    // la radio au retour au premier plan) : si le système n'annonce pas
    // « aucun réseau », on revérifie (3 s au plus) avant de mettre en file.
    let online = isOnline
    if (!online && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      online = await Promise.race([
        checkConnectivity(),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3_000)),
      ])
    }
    if (!online) {
      try {
        await saveOffline(t('sales.sale_saved_offline'), 'offline')
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
      const checkoutBody = JSON.stringify({
            shop_id: shop!.id,
            customer_id: selectedCustomer?.id || null,
            customer_name: !selectedCustomer && customerName.trim() ? customerName.trim() : null,
            // La fonction serveur ne rattache un client que sur égalité exacte
            // du numéro : on envoie la forme enregistrée d'un client connu
            customer_phone: !selectedCustomer && customerPhone.trim() ? resolveStoredPhone(customerPhone, customers) : null,
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
          })

      // Chaque essai réutilise la même clé d'idempotence (clientRequestId) :
      // complete_sale() ne crée jamais la vente deux fois.
      const callCheckout = () => withTimeout(
        fetch('/api/sales/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: checkoutBody })
          .then(async r => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) as any })),
        20_000,
        t('sales.db_not_responding')
      )
      // Seule une VRAIE coupure (réseau, délai, serveur indisponible) met la
      // vente en file. Avant, TOUTE erreur le faisait — session expirée, droit
      // manquant, donnée refusée — et la synchronisation l'insérait ensuite
      // sans repasser par ces contrôles. Cas typique : réseau parfait mais
      // session à renouveler après un passage en arrière-plan → vente en file,
      // lien du reçu « introuvable » jusqu'à la synchronisation.
      const queueError = (message: string, reason: string) => Object.assign(new Error(message), { queueReason: reason })
      const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      let resp: { status: number; ok: boolean; body: any }
      try {
        resp = await callCheckout()
        if (resp.status === 401) {
          // Session à renouveler (app restée en arrière-plan) : on renouvelle et on renvoie
          await Promise.race([supabase.auth.refreshSession(), pause(5_000)]).catch(() => {})
          resp = await callCheckout()
        } else if (resp.status === 429) {
          await pause(2_000); resp = await callCheckout()
        } else if (resp.status >= 500) {
          await pause(1_500); resp = await callCheckout()
        }
      } catch (err: any) {
        // fetch rejeté (pas de réseau) ou délai de 20 s dépassé
        throw queueError(err?.message || t('sales.db_not_responding'), /trop lent|not responding|ne répond|timeout/i.test(err?.message || '') ? 'timeout' : 'network')
      }
      if (!resp.ok) {
        const message = resp.body?.error || t('sales.create_error')
        if (resp.status >= 500) throw queueError(message, `server_${resp.status}`)
        if (resp.status === 429) throw queueError(message, 'rate_limited')
        // 400 / 401 / 403 / 409 : refus réel — on l'affiche, le panier reste intact
        throw Object.assign(new Error(resp.status === 401 ? t('sales.session_expired_retry') : message), { refused: true })
      }
      const res: any = resp.body

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
      setReceiptPay({ payments: salePayments.map(p => ({ method: p.method, amount: p.amount })), cashReceived: !splitPayment && methodType === 'cash' ? (Number(amountPaid) || 0) : 0, change, customerName: selectedCustomer?.name || customerName.trim() || undefined, customerPhone: selectedCustomer?.phone || customerPhone.trim() || undefined })
      emitOnboarding('sale_completed') // tour guidé « Faire une vente »
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
      } else if (err?.refused) {
        // Refus réel du serveur (droit, donnée, session) : rien en file — la
        // vente n'existe pas, le panier reste à l'écran pour corriger ou réessayer.
        toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
      } else {
        // Vraie coupure (ou erreur inattendue) : la vente n'a pas été créée en
        // ligne — mise en file avec la clé de l'essai en ligne (anti-doublon).
        try {
          await saveOffline(t('sales.unstable_connection_saved'), err?.queueReason || 'unexpected', checkoutIdRef.current || undefined)
        } catch {
          toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
        }
      }
    } finally {
      setCompleting(false)
    }
  }

  const receiptLabels = receiptLabelsFromT(t)

  // Libellé lisible d'un moyen de paiement (« Espèces », « MTN MoMo », « Paiement mixte »)
  const paymentMethodLabel = (id: string) => id === 'mixed'
    ? t('receipt.method_mixed')
    : (getCountry(shop?.country).paymentMethods.find(m => m.id === id)?.label ?? getPaymentMethodLabel(id) ?? id)

  // ── Reçu d'une vente MISE EN FILE ─────────────────────────────────────────
  // Une vente enregistrée sur l'appareil (id « local-… ») n'existe pas encore
  // sur le serveur : son lien de reçu afficherait « Reçu introuvable » et son
  // numéro « HL-… » est provisoire. Avant tout envoi ou impression, on la
  // synchronise (quelques secondes au plus) et on reprend la version serveur :
  // vrai numéro, lien actif. Jamais de lien inactif envoyé au client.
  const isQueuedSale = (s: any) => !!s && String(s.id).startsWith('local-')
  const ensureSyncedSale = async (timeoutMs: number, opts?: { silent?: boolean }): Promise<{ sale: any; synced: boolean }> => {
    const current: any = completedSaleRef.current
    if (!current || !isQueuedSale(current) || !shop?.id) return { sale: current, synced: !isQueuedSale(current) }
    if (!opts?.silent) setPreparingReceipt(true)
    try {
      const server = await syncSaleNow(shop.id, current.id, timeoutMs)
      if (server) {
        completedSaleRef.current = server
        setCompletedSale(server)
        refreshPendingCount().catch(() => {})
        return { sale: server, synced: true }
      }
      return { sale: current, synced: false }
    } finally {
      if (!opts?.silent) setPreparingReceipt(false)
    }
  }

  // « Reçu PDF » : le document A5 s'ouvre / se partage (PC : nouvel onglet à
  // enregistrer ; Android : feuille de partage). L'impression, c'est le ticket.
  const handlePrintReceipt = async () => {
    if (!completedSale || !shop) return
    const { sale } = await ensureSyncedSale(6_000)
    const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
    const blob = await generateReceiptPDFBlob({
      sale: sale as any,
      shop: shop as any,
      cashierName: profile?.full_name || '',
      customerName: (sale as any)?.customers?.name || receiptCustomerName,
      labels: receiptLabels,
      debtRepayment: receiptDebt?.amount || 0, locale, hideBranding: hideStockShopBranding(shop),
    })
    try {
      await sharePDFNative(blob, `Recu-${sale.sale_number}.pdf`, t('sales.receipt_share_title', { number: sale.sale_number, shop: shop?.name || '' }))
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: err?.message || 'Erreur', variant: 'destructive' })
    }
  }

  // WhatsApp : client avec numéro → sa conversation s'ouvre directement avec le
  // reçu en texte et le lien ACTIF du reçu en ligne (un lien wa.me ne peut pas
  // joindre un fichier) ; sinon feuille de partage avec le PDF, puis repli texte.
  // Vente encore en file et serveur injoignable : on propose d'envoyer le reçu
  // sans lien plutôt qu'un lien qui afficherait « Reçu introuvable ».
  const openWhatsApp = (url: string) => {
    // Ouverture bloquée (navigateur d'ordinateur, envoi automatique hors clic) → bouton dans le reçu
    if (window.open(url, '_blank') === null) setWaFallbackUrl(url)
  }
  const sendWhatsAppReceipt = async (opts?: { allowNoLink?: boolean }) => {
    if (!completedSaleRef.current || !shop) return
    setWaFallbackUrl(null)
    const { sale, synced } = await ensureSyncedSale(10_000)
    if (!synced && !opts?.allowNoLink) { setNoLinkPrompt(true); return }
    const customer = (sale as any)?.customers
    const text = buildReceiptWhatsAppMessage({
      shopName: shop?.name || '',
      saleNumber: sale.sale_number,
      date: new Date(sale.created_at).toLocaleString(locale, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
      items: ((sale as any).sale_items || []).map((i: any) => ({ name: i.product_name, qty: i.quantity, price: i.unit_price })),
      total: sale.total,
      paid: sale.amount_paid,
      balance: sale.balance,
      method: paymentMethodLabel(sale.payment_method),
      customerName: customer?.name || receiptCustomerName,
      currencySymbol: symbol,
      debtRepayment: receiptDebt?.amount || 0,
      // Lien seulement si la vente est bien sur le serveur
      receiptUrl: synced ? receiptUrl(sale.receipt_token) : null,
      labels: {
        receipt: t('receipt.receipt'), items: t('receipt.items'), paid: t('receipt.paid'), balance: t('receipt.balance_due'),
        fullyPaid: t('receipt.fully_paid'), debtRepayment: t('receipt.debt_repayment'), totalCollected: t('receipt.total_collected'), thankYou: t('receipt.thank_you'),
        onlineReceipt: t('receipt.online_receipt'),
      },
    })
    const phone = customer?.phone || receiptCustomerPhone
    if (phone) {
      const number = normalizeWhatsAppNumber(phone, getCountry(shop.country).phonePrefix)
      if (number) { openWhatsApp(buildWhatsAppLink(number, text)); return }
    }
    try {
      const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
      const blob = await generateReceiptPDFBlob({
        sale: sale as any,
        shop: shop as any,
        cashierName: profile?.full_name || '',
        customerName: customer?.name || receiptCustomerName,
        labels: receiptLabels,
        debtRepayment: receiptDebt?.amount || 0, locale, hideBranding: hideStockShopBranding(shop),
      })
      await sharePDFNative(blob, `Recu-${sale.sale_number}.pdf`, t('sales.receipt_share_title', { number: sale.sale_number, shop: shop?.name || '' }))
      return
    } catch (err: any) {
      if (err?.name === 'AbortError') return // user cancelled native share sheet
      // PDF generation or share failed — fall through to text fallback
    }
    // Last resort: WhatsApp text message (chat picker)
    openWhatsApp(`https://wa.me/?text=${encodeURIComponent(text)}`)
  }
  const handleWhatsAppReceipt = () => { sendWhatsAppReceipt().catch(() => {}) }

  // ── Ticket de caisse (rouleau 58/80 mm) — sortie choisie dans Paramètres ──
  // Montants sans « ₦ » (police PDF standard) : même règle que le reçu A5.
  const ticketFmt = (n: number) => currencyCode === 'NGN' ? `NGN ${Math.round(n).toLocaleString('en-NG')}` : formatNaira(n)
  const handlePrintTicket = async () => {
    if (!completedSaleRef.current || !shop) return
    // Vrai numéro et QR actif si la vente peut être envoyée tout de suite ;
    // sinon le ticket sort quand même (le QR s'activera à la synchronisation)
    const { sale } = await ensureSyncedSale(6_000)
    const methodLabel = paymentMethodLabel
    try {
      await printSaleTicket({
        settings: readTicketSettings(),
        fileName: `Ticket-${sale.sale_number}.pdf`,
        logoUrl: shop.logo_url,
        data: {
          shop: { name: shop.name, city: shop.city, state: shop.state, whatsapp: shop.whatsapp, tagline: shop.receipt_tagline, legalIds: shop.receipt_legal_ids },
          footerMessage: shop.receipt_footer,
          receiptUrl: receiptUrl(sale.receipt_token),
          saleNumber: sale.sale_number,
          createdAt: sale.created_at,
          items: ((sale as any).sale_items || []).map((i: any) => ({
            name: i.product_name, qty: Number(i.quantity), unitPrice: Number(i.unit_price), subtotal: Number(i.subtotal),
          })),
          subtotal: Number(sale.subtotal), discount: Number(sale.discount), tax: Number(sale.tax), total: Number(sale.total),
          amountPaid: Number(sale.amount_paid), balance: Number(sale.balance),
          paymentLabel: methodLabel(sale.payment_method),
          payments: receiptPay?.payments.length ? receiptPay.payments.map(p => ({ label: methodLabel(p.method), amount: p.amount })) : undefined,
          cashReceived: receiptPay?.cashReceived, change: receiptPay?.change,
          cashierName: profile?.full_name || '',
          customerName: (sale as any)?.customers?.name || receiptCustomerName,
          debtRepayment: receiptDebt?.amount || 0,
          locale,
          fmt: ticketFmt,
          fmtShort: n => Math.round(n).toLocaleString(locale),
          labels: ticketLabelsFromT(t),
          hideBranding: hideStockShopBranding(shop),
        },
      })
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      toast({ title: t(ticketErrorKey(err)), description: err?.code ? undefined : err?.message, variant: 'destructive' })
    }
  }

  // Clé stable d'un reçu affiché : le jeton (identique avant et après la
  // synchronisation d'une vente mise en file, alors que l'id change).
  const receiptKey = completedSale ? ((completedSale as any).receipt_token || completedSale.id) : null

  // Impression automatique (réglage par appareil) : une seule fois par vente.
  useEffect(() => {
    if (!showReceipt || !completedSale || !receiptKey) return
    if (autoPrintedRef.current === receiptKey) return
    if (!readTicketSettings().autoPrint) return
    autoPrintedRef.current = receiptKey
    handlePrintTicket().catch(() => {})
  }, [showReceipt, receiptKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Envoi WhatsApp automatique (réglage par appareil, activé par défaut) : client
  // avec numéro → sa conversation s'ouvre avec le reçu et le lien actif.
  useEffect(() => {
    if (!showReceipt || !completedSale || !receiptKey || !receiptCustomerPhone) return
    if (autoWhatsAppRef.current === receiptKey) return
    if (!readTicketSettings().autoWhatsApp) return
    autoWhatsAppRef.current = receiptKey
    sendWhatsAppReceipt().catch(() => {})
  }, [showReceipt, receiptKey, receiptCustomerPhone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Vente mise en file et reçu ouvert : on récupère sa version serveur dès
  // qu'elle est synchronisée (vrai numéro à l'écran), sans bloquer l'écran.
  useEffect(() => {
    if (!showReceipt || !isQueuedSale(completedSale)) return
    ensureSyncedSale(15_000, { silent: true }).catch(() => {})
  }, [showReceipt, receiptKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
          className="hidden md:flex items-center justify-between gap-2 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
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
            <div className="grid grid-cols-2 min-[340px]:grid-cols-3 gap-1.5 md:grid-cols-3 md:gap-2" data-tour="pos-grid">
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
        <div className="flex items-center">
          <span className="flex items-center gap-1.5 pr-2 text-sm font-semibold text-foreground">
            {mobileStep === 'payment'
              ? t('sales.payment_step_title')
              : <><ShoppingCart className="h-4 w-4" />{t(cart.length === 1 ? 'sales.cart_items_one' : 'sales.cart_items_other', { count: cart.length })}</>}
          </span>
          {/* Vider toute la vente en cours — ici, loin d'« Encaisser », avec confirmation */}
          {mobileStep === 'cart' && cart.length > 0 && (
            <button
              type="button"
              onClick={() => setClearCartOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
              aria-label={t('sales.clear_cart')}
              title={t('sales.clear_cart')}
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>
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
          {/* Ordinateur : en-tête du panier avec « Vider » (sur téléphone, la
              corbeille est dans l'en-tête du panneau). Confirmation avant de vider. */}
          <div className="hidden md:flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ShoppingCart className="h-4 w-4" />{t(cart.length === 1 ? 'sales.cart_items_one' : 'sales.cart_items_other', { count: cart.length })}
            </span>
            <button
              type="button"
              onClick={() => setClearCartOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />{t('sales.clear_cart')}
            </button>
          </div>
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
              {/* Téléphone : remise repliée tant qu'elle est à 0 ; masquée sans le droit */}
              {canDiscount && !(showDiscount || discount > 0) && (
                <button type="button" onClick={() => setShowDiscount(true)}
                  className="md:hidden flex items-center gap-2 text-sm font-medium text-stockshop-blue dark:text-blue-400 tap-target">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted dark:bg-blue-950/40"><Plus className="h-3.5 w-3.5" /></span>
                  {t('sales.add_discount')}
                </button>
              )}
              <div className={cn('flex items-center gap-3', !canDiscount && 'hidden', canDiscount && !(showDiscount || discount > 0) && 'hidden md:flex')} data-testid="sale-discount-row">
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
              <Separator className={cn(!canDiscount && 'hidden', canDiscount && !(showDiscount || discount > 0) && 'hidden md:block')} />
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
                      {t('sales.existing_customer')} · {selectedCustomer.phone || t('sales.no_phone')}{selectedCustomer.city ? ` · ${selectedCustomer.city}` : ''}
                      {Number(selectedCustomer.total_debt) > 0 && (
                        <>
                          {' · '}
                          {/* Insécable : passe à la ligne d'un bloc plutôt que de couper « Solde / dû » */}
                          <span className="whitespace-nowrap font-medium text-red-500">{t('sales.debt_due_inline', { amount: formatNaira(selectedCustomer.total_debt) })}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <button type="button" onClick={() => openCustomerPicker()}
                    className="shrink-0 text-xs font-semibold text-stockshop-blue hover:underline dark:text-blue-400">
                    {t('sales.customer_change')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { autoLinkDismissed.current = normalize(selectedCustomer.name); setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('') }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t('actions.remove')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  {/* Le carnet d'abord (bouton explicite → sélecteur), la saisie d'un
                      nouveau client ensuite — plus de liste cachée sous le champ. */}
                  <p className="-mt-1 text-xs text-muted-foreground">{t('sales.customer_hint')}</p>
                  <button type="button" onClick={() => openCustomerPicker()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-stockshop-blue/30 bg-stockshop-blue-muted px-4 py-2.5 text-sm font-semibold text-stockshop-blue tap-target dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                    <BookUserIcon className="h-4 w-4" />
                    {t('sales.choose_customer')}
                    {customers.length > 0 && <span className="font-normal opacity-70">({customers.length})</span>}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />{t('sales.or_new_customer')}<span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="relative">
                    <Input
                      id="customer-name-input"
                      value={customerName}
                      onChange={e => { setCustomerName(e.target.value); setSuggestOpen(true); setSuggestIndex(-1) }}
                      onFocus={() => setSuggestOpen(true)}
                      onBlur={() => { setSuggestOpen(false); autoLinkTypedCustomer() }}
                      onKeyDown={onCustomerNameKeyDown}
                      placeholder={t('sales.customer_name_placeholder')}
                      className="pr-9"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={showSuggestions}
                      aria-controls="customer-suggestions"
                    />
                    {customerName && (
                      <button type="button" aria-label={t('actions.clear')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => { setCustomerName(''); setCustomerPhone('') }}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {/* Clients du carnet proposés pendant la saisie (onMouseDown : le
                        choix passe avant la sortie du champ) */}
                    {showSuggestions && (
                      <div id="customer-suggestions" role="listbox" data-testid="customer-suggestions"
                        className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
                        {customerSuggestions.slice(0, SUGGEST_MAX).map((c, i) => (
                          <button key={c.id} type="button" role="option" aria-selected={i === suggestIndex} data-testid="customer-suggestion"
                            onMouseDown={e => { e.preventDefault(); pickSuggestion(c) }}
                            onMouseEnter={() => setSuggestIndex(i)}
                            className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left tap-target', i === suggestIndex ? 'bg-stockshop-blue-muted dark:bg-blue-950/40' : 'hover:bg-muted/60')}>
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-stockshop-blue text-xs font-bold text-white dark:bg-blue-500">
                              {c.name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{c.name}</span>
                              {c.phone && <span className="block truncate text-xs text-muted-foreground">{c.phone}</span>}
                            </span>
                            {Number(c.total_debt) > 0 && (
                              <span className="flex-shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
                                {t('sales.customer_suggest_debt', { amount: formatNaira(Number(c.total_debt)) })}
                              </span>
                            )}
                          </button>
                        ))}
                        {customerSuggestions.length > SUGGEST_MAX && (
                          <button type="button" onMouseDown={e => { e.preventDefault(); setSuggestOpen(false); openCustomerPicker(customerName.trim()) }}
                            className="block w-full border-t px-3 py-2 text-left text-xs font-medium text-stockshop-blue hover:bg-muted/60 dark:text-blue-400">
                            {t('sales.customer_suggest_more', { count: customerSuggestions.length })}
                          </button>
                        )}
                        <button type="button" data-testid="customer-suggestion-new"
                          onMouseDown={e => { e.preventDefault(); setSuggestOpen(false); setSuggestIndex(-1) }}
                          className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/60">
                          <Plus className="h-3.5 w-3.5" />{t('sales.customer_suggest_new', { name: customerName.trim() })}
                        </button>
                      </div>
                    )}
                  </div>
                  {matchingCustomers > 0 && !showSuggestions && (
                    <button type="button" onClick={() => openCustomerPicker(customerName.trim())}
                      className="-mt-1 text-left text-xs font-medium text-stockshop-blue hover:underline dark:text-blue-400">
                      {t(matchingCustomers === 1 ? 'sales.customer_matches_one' : 'sales.customer_matches_other', { count: matchingCustomers })}
                    </button>
                  )}
                  {/* Indicatif choisi dans une liste ; un numéro invalide est
                      signalé sans bloquer la vente */}
                  <PhoneInput
                    value={customerPhone}
                    onChange={v => setCustomerPhone(v)}
                    defaultCountry={shop?.country}
                    preferredCountries={userShops.map(s => s.country)}
                  />
                </>
              )}
            </CardContent>
          </Card>
          <CustomerPicker
            open={customerPickerOpen}
            onOpenChange={setCustomerPickerOpen}
            customers={customers}
            recentIds={recentCustomerIds}
            initialQuery={customerPickerQuery}
            formatAmount={formatNaira}
            onSelect={c => { setSelectedCustomer(c); setCustomerName(''); setCustomerPhone(c.phone || ''); setCustomerPickerOpen(false) }}
            onCreateNew={() => {
              // Un client déjà choisi est retiré : les champs « nouveau client » réapparaissent
              setCustomerPickerOpen(false); setShowCustomer(true)
              setSelectedCustomer(null); setCustomerName(''); setCustomerPhone('')
              // Après la fermeture de la boîte (qui rend le focus à son déclencheur)
              setTimeout(() => document.getElementById('customer-name-input')?.focus(), 300)
            }}
          />

          {/* ── Debt repayment section ── */}
          {selectedCustomer && Number(selectedCustomer.total_debt) > 0 && customerUnpaidSales.length > 0 && (
            <DebtRepaymentCard
              currencyCode={currencyCode}
              symbol={symbol}
              debtOutstanding={debtOutstanding}
              enabled={debtRepayEnabled}
              amount={debtRepayAmount}
              capped={debtCapped}
              debtAmt={debtAmt}
              saleTotal={total}
              totalToCollect={totalToCollect}
              onToggle={setDebtRepayEnabled}
              onAmountChange={handleDebtAmountChange}
            />
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
              className="h-12 w-12 shrink-0 gap-2 p-0 border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 min-[380px]:w-auto min-[380px]:px-3"
              onClick={openHoldDialog}
              disabled={completing}
              aria-label={t('sales.hold_confirm')}
              title={t('sales.hold_confirm')}
            >
              <PauseCircle className="h-5 w-5" />
              {/* Libellé court dès 380 px, comme à l'étape paiement : une icône pause seule n'est pas évidente */}
              <span className="hidden min-[380px]:inline">{t('sales.hold_short')}</span>
            </Button>
            <Button variant="stockshop" className="flex-1 h-12 text-base gap-2" onClick={() => setMobileStep('payment')} data-tour="pos-collect">
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
          <div className="md:hidden rounded-xl bg-stockshop-blue-muted/60 p-4 dark:bg-blue-950/30">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/60 dark:text-blue-300" aria-hidden="true">
                <ShoppingBag className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {isCreditSale && debtAmt === 0 ? t('sales.credit_sale_label') : t('sales.total_to_collect')}
                </p>
                <p className="text-2xl font-bold tabular-nums text-stockshop-blue dark:text-blue-400">
                  {formatNaira(isCreditSale && debtAmt === 0 ? total : collectedNow)}
                </p>
              </div>
            </div>
            {/* Détail vente / dette en deux cellules, seulement s'il y a une dette */}
            {debtAmt > 0 && (
              <div className="mt-3 grid grid-cols-2 divide-x divide-border/70 border-t border-border/70 pt-3">
                <div className="flex items-center gap-2 pr-2">
                  <ShoppingCart className="h-4 w-4 shrink-0 text-stockshop-blue dark:text-blue-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">{isCreditSale ? t('sales.credit_sale_label') : t('sales.sale_label')}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatNaira(total)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-3">
                  <Coins className="h-4 w-4 shrink-0 text-stockshop-blue dark:text-blue-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">{t('receipt.debt_repayment')}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatNaira(debtAmt)}</p>
                  </div>
                </div>
              </div>
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
                <PaymentMethodCard
                  key={method.id}
                  method={method}
                  selected={paymentMethod === method.id}
                  subtitle={t(`sales.method_sub_${method.type}`)}
                  onSelect={id => {
                    setPaymentMethod(id)
                    if (splitMethod2 === id) setSplitMethod2('')
                  }}
                />
              ))}
            </div>
          </div>

          {/* Normal (non-split) payment sections */}
          {!splitPayment && methodType === 'cash' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t('payment.amount_paid')}</Label>
                  <span className="text-xs text-muted-foreground">
                    {t('sales.amount_due')} : <span className="font-semibold tabular-nums text-foreground">{formatNaira(totalToCollect)}</span>
                  </span>
                </div>
                <div className="flex rounded-lg border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, currencyCode)}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="min-w-0 flex-1 h-12 px-3 text-xl font-bold tabular-nums bg-card outline-none"
                    placeholder={formatInputValue(totalToCollect, currencyCode) || '0'} />
                  <span className="flex items-center px-3 bg-muted border-l text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{symbol}</span>
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
                <div className="rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/60 p-3 text-center">
                  <p className="text-sm text-muted-foreground">{t('payment.change_due')}</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatNaira(change)}</p>
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
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-3">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {t('sales.adds_to_debt_of', { amount: formatNaira(total) })}{' '}
                {selectedCustomer?.name || customerName || t('sales.this_customer')}
              </p>
              {!selectedCustomer && !customerName && (
                <>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t('sales.enter_customer_for_credit')}</p>
                  {/* Téléphone : le client se saisit à l'étape panier */}
                  <button type="button"
                    onClick={() => { setShowCustomer(true); setMobileStep('cart') }}
                    className="md:hidden mt-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300 underline underline-offset-2 tap-target">
                    <User className="h-4 w-4" />{t('sales.choose_customer_for_credit')}
                  </button>
                </>
              )}
              {debtAmt > 0 && (
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mt-1">
                  {t('sales.credit_debt_cash_note', { amount: formatNaira(debtAmt) })}
                </p>
              )}
              {selectedCustomer?.credit_limit != null && (Number(selectedCustomer.total_debt) + total) > selectedCustomer.credit_limit && (
                <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-1">
                  {t('sales.exceeds_credit_limit', { limit: formatNaira(selectedCustomer.credit_limit) })}
                </p>
              )}
            </div>
          )}

          {/* Split payment toggle */}
          {methodType !== 'credit' && (
            splitPayment ? (
              <button
                type="button"
                onClick={() => { setSplitPayment(false); setAmountPaid('') }}
                className="flex items-center gap-1.5 text-sm text-stockshop-blue dark:text-blue-400 hover:underline"
              >
                <X className="h-3.5 w-3.5" />{t('sales.cancel_split_payment')}
              </button>
            ) : (
              /* Carte neutre (pas d'ambre : réservé aux alertes) — même pastille
                 ronde que « Ajouter une remise / un client » */
              <button
                type="button"
                onClick={() => {
                  const other = getCountry(shop?.country).paymentMethods
                    .find(m => m.id !== paymentMethod && m.id !== 'credit')
                  setSplitMethod2(other?.id || '')
                  setSplitPayment(true)
                  setAmountPaid('')
                }}
                className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:border-stockshop-blue/40 dark:hover:border-blue-700 tap-target"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400" aria-hidden="true">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t('sales.split_payment_label')}</span>
                  <span className="block text-xs text-muted-foreground">{t('sales.split_payment_hint')}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            )
          )}

          {/* Split payment UI */}
          {splitPayment && (
            <div className="rounded-lg border border-dashed border-stockshop-blue/40 dark:border-blue-700 p-3 space-y-3">
              {/* Amount for method 1 */}
              <div className="space-y-1.5">
                <Label className="text-sm">
                  {t('sales.amount_paid_in', { method: getCountry(shop?.country).paymentMethods.find(m => m.id === paymentMethod)?.label || paymentMethod })}
                </Label>
                <div className="flex rounded-lg border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={formatInputValue(amountPaid, currencyCode)}
                    onChange={e => setAmountPaid(e.target.value.replace(/\D/g, ''))}
                    className="min-w-0 flex-1 h-11 px-3 text-lg font-bold tabular-nums bg-card outline-none"
                    placeholder="0" />
                  <span className="flex items-center px-3 bg-muted border-l text-sm font-medium text-muted-foreground whitespace-nowrap select-none">{symbol}</span>
                </div>
              </div>

              {/* Method 2 selector */}
              <div className="space-y-1.5">
                <Label className="text-sm">{t('sales.second_payment_method')}</Label>
                <div className="grid grid-cols-3 gap-2.5">
                  {getCountry(shop?.country).paymentMethods
                    .filter(m => m.id !== paymentMethod && m.id !== 'credit')
                    .map(method => (
                      <PaymentMethodCard
                        key={method.id}
                        method={method}
                        selected={splitMethod2 === method.id}
                        subtitle={t(`sales.method_sub_${method.type}`)}
                        onSelect={setSplitMethod2}
                      />
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
              className="h-12 w-12 shrink-0 gap-2 p-0 border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 min-[380px]:w-auto min-[380px]:px-3 md:flex-1 md:px-4"
              onClick={openHoldDialog}
              disabled={cart.length === 0 || completing}
              aria-label={t('sales.hold_confirm')}
              title={t('sales.hold_confirm')}
            >
              <PauseCircle className="h-5 w-5 md:h-4 md:w-4" />
              {/* Libellé court dès 380 px (une icône pause seule n'est pas évidente), complet sur ordinateur */}
              <span className="hidden min-[380px]:inline md:hidden">{t('sales.hold_short')}</span>
              <span className="hidden md:inline">{t('sales.hold_confirm')}</span>
            </Button>
            <Button
              variant="stockshop"
              className="flex-1 md:flex-[2] h-12 text-base"
              data-tour="pos-checkout"
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
                  <div className="flex rounded-xl border-2 border-stockshop-blue dark:border-blue-500 overflow-hidden shadow-sm">
                    <span className="flex items-center px-4 bg-stockshop-blue/5 border-r border-stockshop-blue/30 text-sm font-bold text-stockshop-blue dark:text-blue-400 whitespace-nowrap select-none">
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
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <span>↑</span> +{formatNaira(Number(priceModalInput) - minPrice)} par rapport au catalogue
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <Button variant="outline" className="flex-1 h-11 rounded-lg" onClick={() => setPriceModalItem(null)}>
                    Annuler
                  </Button>
                  <Button
                    variant="stockshop"
                    className="flex-1 h-11 rounded-lg font-semibold"
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
        title={t('sales.pending_invoices_title')}
        icon={<Clock className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-2 max-h-[70vh] overflow-y-auto">
          {/* Nettoyage des anciennes — jamais automatique (ce sont des ventes),
              toujours sur confirmation du caissier. */}
          {(() => {
            const stale = shopDrafts.filter(d => heldAgeDays(d.createdAt) >= HELD_STALE_DAYS).length
            return stale > 0 ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <span>{t('sales.held_stale_notice', { count: stale, days: HELD_STALE_DAYS })}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0 border-amber-300 dark:border-amber-700/60 text-amber-800 dark:text-amber-300" onClick={deleteStaleDrafts}>
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
                    <p className={cn('text-xs mt-0.5', age >= HELD_STALE_DAYS ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-muted-foreground')}>
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
                  <Button size="sm" variant="outline" className="h-8 border-red-200 dark:border-red-800/60 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
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

      {/* Vider le panier : confirmation (pas d'annulation possible après),
          avec le rappel de l'alternative « Mettre en attente ». */}
      <PremiumDialog
        open={clearCartOpen}
        onOpenChange={setClearCartOpen}
        title={t('sales.clear_cart_title')}
        icon={<Trash2 className="h-4 w-4" />}
        centered
      >
        <PremiumDialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('sales.clear_cart_body', { count: cart.length })}</p>
          {activeDraftId && (
            <p className="text-xs font-medium text-muted-foreground">{t('sales.clear_cart_draft_kept')}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setClearCartOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="button" variant="destructive" className="flex-[2] h-11 gap-2" onClick={clearCart}>
              <Trash2 className="h-4 w-4" />{t('sales.clear_cart')}
            </Button>
          </div>
        </PremiumDialogBody>
      </PremiumDialog>

      {/* Reprise alors qu'un autre panier est en cours — jamais d'écrasement
          silencieux : on propose de le mettre d'abord en attente. */}
      <PremiumDialog
        open={!!pendingResume}
        onOpenChange={open => { if (!open) setPendingResume(null) }}
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
            className="w-full h-auto min-h-11 whitespace-normal py-2.5 leading-snug border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
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
        title={t('sales.receipt_ready')}
        icon={<CheckCircle className="h-4 w-4" />}
        centered
      >
        <PremiumDialogBody>
          {completedSale && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 border p-4 text-sm space-y-2">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <ShopLogo src={shop?.logo_url} name={shop?.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-xs truncate">{shop?.name}</p>
                    {shop?.city && <p className="text-[10px] text-muted-foreground">{shop.city}</p>}
                  </div>
                </div>
                {isQueuedSale(completedSale) && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300" data-testid="receipt-queued">
                    <CloudUpload className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>{t('sales.receipt_queued_status')}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span data-testid="receipt-number">#{completedSale.sale_number}</span>
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
                      <p className={cn('text-[11px]', receiptDebt.status === 'failed' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground')}>
                        {receiptDebt.status === 'failed' ? t('sales.debt_status_failed') : t('sales.debt_status_queued')}
                      </p>
                    )}
                  </>
                )}
              </div>
              {/* Ticket de caisse (rouleau, sortie réglée dans Paramètres) en premier ;
                  le reçu PDF A5 reste pour l'envoi au client qui le demande. */}
              <div className="grid grid-cols-2 gap-2">
                {preparingReceipt && (
                  <p className="col-span-2 flex items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="receipt-preparing">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />{t('sales.receipt_preparing')}
                  </p>
                )}
                {waFallbackUrl && (
                  <a href={waFallbackUrl} target="_blank" rel="noreferrer" onClick={() => setWaFallbackUrl(null)} data-testid="receipt-wa-fallback"
                    className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-semibold text-white hover:bg-[#1ebe5b]">
                    <MessageCircle className="h-4 w-4" />{t('sales.open_whatsapp')}<ExternalLinkIcon className="h-3.5 w-3.5" />
                  </a>
                )}
                <Button variant="outline" onClick={handlePrintTicket} disabled={preparingReceipt} className="col-span-2 gap-2">
                  <Printer className="h-4 w-4" /> {t('sales.print_ticket')}
                </Button>
                <Button variant="outline" onClick={handleWhatsAppReceipt} disabled={preparingReceipt} className="gap-2" data-testid="receipt-whatsapp">
                  <MessageCircle className="h-4 w-4" /> {t('actions.whatsapp')}
                </Button>
                <Button variant="outline" onClick={handlePrintReceipt} disabled={preparingReceipt} className="gap-2">
                  {isCapacitor() ? <Share2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  {t('sales.receipt_pdf')}
                </Button>
              </div>
              <Button variant="stockshop" className="w-full h-11 rounded-lg font-semibold"
                onClick={() => { setShowReceipt(false) }}>
                {t('sales.new_sale_cta')}
              </Button>
            </div>
          )}
        </PremiumDialogBody>
      </PremiumDialog>

      {/* Vente encore en file et serveur injoignable : jamais de lien inactif */}
      <ConfirmModal
        open={noLinkPrompt}
        onOpenChange={setNoLinkPrompt}
        title={t('sales.receipt_not_synced_title')}
        description={t('sales.receipt_not_synced_desc')}
        icon={<CloudUpload className="h-4 w-4" />}
        tone="warning"
        confirmLabel={t('sales.send_without_link')}
        onConfirm={() => { setNoLinkPrompt(false); sendWhatsAppReceipt({ allowNoLink: true }).catch(() => {}) }}
      >
        <Button type="button" variant="outline" className="w-full gap-2" data-testid="receipt-retry-sync"
          onClick={() => { setNoLinkPrompt(false); sendWhatsAppReceipt().catch(() => {}) }}>
          <CloudUpload className="h-4 w-4" />{t('sales.retry_sync_send')}
        </Button>
      </ConfirmModal>

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
              data-tour="pos-open-cart"
              onClick={() => { setMobileStep('cart'); setMobileCartOpen(true) }}
              className="flex flex-1 items-center justify-between gap-3 bg-stockshop-blue text-white px-4 py-3"
            >
              <span className="flex items-center gap-2 font-semibold text-sm">
                <ShoppingCart className="h-4 w-4" />
                {t(cart.length === 1 ? 'sales.cart_items_one' : 'sales.cart_items_other', { count: cart.length })}
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
