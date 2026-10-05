'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { Plus, Search, Edit2, Package, ArrowDown, FileDown, Settings2, Trash2, Store, RotateCcw, Archive, Upload, CheckSquare, Square, AlertTriangle, History, Tag, CalendarClock, ShoppingCart, X, LayoutGrid, List, SlidersHorizontal, ChevronDown, MoreHorizontal, Zap, Columns3 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { PRODUCT_FORM_ID, type ProductFormState } from '@/components/stock/product-form-submit'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createRestockSchema, type RestockFormData, type ProductFormData } from '@/lib/validations/product'
import type { Product, Category, Supplier } from '@/lib/types/database'
// ProductForm, ImportProductsModal et BulkAddModal : chargés à la demande
// (déclarations dynamic plus bas), hors du code de première ouverture
import { useRestoredPhoto } from '@/lib/photo/use-restored-photo'
import { ProductTable, ProductTableSkeleton, OPTIONAL_COLUMNS, PENDING_COLUMNS, type ProductColumnKey, type ProductSort, type ProductStatus } from '@/components/stock/product-table'
import { useStockViewMode } from '@/lib/hooks/use-stock-view-mode'
import { ProductActivityJournal } from '@/components/stock/product-activity-journal'
import { fetchExpiryByProduct, fetchSoldQty30d, readSignalsCache, writeSignalsCache } from '@/lib/stock/signals'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'

import { savePendingMovement, updateCachedProductQuantity } from '@/lib/offline/db'
import { registerBackgroundSync } from '@/lib/offline/sync'
import { downloadOrShareCSV } from '@/lib/utils/native-share'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useStockRealtime } from '@/lib/hooks/use-realtime'
import { StockTabs } from '@/components/stock/stock-tabs'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getExpiryAlertDays } from '@/lib/utils/expiry'

// Fiches et modales rarement ouvertes (formulaire produit avec sa validation,
// ajout rapide, import CSV) : chargées au premier usage, pour que l'ouverture
// de la liste n'attende pas leur code.
const ProductForm = dynamic(() => import('@/components/stock/product-form').then(m => ({ default: m.ProductForm })), {
  ssr: false,
  loading: () => <div className="p-5"><Skeleton className="h-72 rounded-xl" /></div>,
})
const ImportProductsModal = dynamic(() => import('@/components/stock/import-products-modal').then(m => ({ default: m.ImportProductsModal })), { ssr: false })
const BulkAddModal = dynamic(() => import('@/components/stock/bulk-add-modal').then(m => ({ default: m.BulkAddModal })), { ssr: false })


function StockBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  const t = useTranslations('status')
  if (quantity === 0) return <Badge variant="danger">{t('out_of_stock')}</Badge>
  if (quantity <= threshold) return <Badge variant="warning">{t('low_stock')}</Badge>
  return <Badge variant="success">{t('in_stock')}</Badge>
}

export default function StockPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const { canAccess } = useRolePermissions()
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const supabase = createClient()
  const { toast } = useToast()

  // Lazy initializers: read localStorage cache synchronously on mount so the
  // first render shows cached data instead of a skeleton flash.
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ prods: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.prods || []) as Product[]
  })
  const [categories, setCategories] = useState<Category[]>(() => {
    const c = getPageCache<{ cats: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.cats || []) as Category[]
  })
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const c = getPageCache<{ sups: any[] }>(`stock_${effectiveShopIds.join(',')}`)
    return (c?.sups || []) as Supplier[]
  })
  const [loading, setLoading] = useState(() =>
    !getPageCache(`stock_${effectiveShopIds.join(',')}`)
  )
  const { isOnline } = useOffline()
  const [{ search, categoryFilter, statusFilter, supplierFilter, shopFilter, noSku, noImage }, setFilter, resetFilters] = usePersistedFilters(
    'stock', shop?.id, { search: '', categoryFilter: 'all', statusFilter: 'all', supplierFilter: 'all', shopFilter: 'all', noSku: false, noImage: false }
  )
  // Signaux (péremption, ventes 30 j) : repris du cache local partagé avec la
  // Vue d'ensemble (lib/stock/signals), rafraîchis ensuite en arrière-plan.
  const [expiryByProduct, setExpiryByProduct] = useState<Record<string, string>>(() => readSignalsCache(effectiveShopIds)?.expiryByProduct ?? {})
  const [soldQtyByProduct, setSoldQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.soldQtyByProduct ?? {})
  // Tant que les ventes 30 j ne sont ni en cache ni chargées, isDormant ne
  // doit pas prendre « pas encore chargé » pour « zéro vente confirmée »,
  // sinon tout produit en stock passerait brièvement pour dormant.
  const [soldQtyLoaded, setSoldQtyLoaded] = useState(() => !!readSignalsCache(effectiveShopIds)?.soldQtyByProduct)
  const [promoProduct, setPromoProduct] = useState<Product | null>(null)
  const [promoPrice, setPromoPrice] = useState('')
  const [promoUntil, setPromoUntil] = useState('')
  const [promoStart, setPromoStart] = useState('')
  const [promoInputMode, setPromoInputMode] = useState<'price' | 'percent'>('price')
  const [savingPromo, setSavingPromo] = useState(false)
  const [promoSuggestionReason, setPromoSuggestionReason] = useState<string | null>(null)
  const [promoSuggestionKey, setPromoSuggestionKey] = useState<'expiry' | 'dormant' | null>(null)
  const [promoBatch, setPromoBatch] = useState<any | null>(null)
  const [expiryBatch, setExpiryBatch] = useState<any | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [batchesProduct, setBatchesProduct] = useState<Product | null>(null)
  const [productBatches, setProductBatches] = useState<any[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [adjustBatch, setAdjustBatch] = useState<any | null>(null)
  const [adjustQuantity, setAdjustQuantity] = useState('')
  const [adjustReason, setAdjustReason] = useState('correction')
  const [savingAdjust, setSavingAdjust] = useState(false)
  const [deleteBatchConfirm, setDeleteBatchConfirm] = useState<any | null>(null)
  const [deleteBatchReason, setDeleteBatchReason] = useState('correction')
  const [deletingBatch, setDeletingBatch] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addFormKey, setAddFormKey] = useState(0)
  const [sessionAddCount, setSessionAddCount] = useState(0)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showRestockModal, setShowRestockModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  // Reprise après destruction de l'activité Android pendant la prise de vue
  // (voir PhotoRestoreHandler) : brouillon + photo à réinjecter dans la fiche.
  // Ajout : lié à la clé du formulaire, donc oublié dès que la fiche est
  // recréée (« enregistrer et ajouter », fermeture). Édition : lié au produit.
  const [restoredAdd, setRestoredAdd] = useState<{ formKey: number; values: Partial<ProductFormData>; file: File | null } | null>(null)
  const [restoredEdit, setRestoredEdit] = useState<{ productId: string; values: Partial<ProductFormData>; file: File | null; applied: boolean } | null>(null)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [saving, setSaving] = useState(false)
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([])
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null)
  // État remonté par le formulaire produit (garde de fermeture, photo en cours)
  const [addFormState, setAddFormState] = useState<ProductFormState>({ dirty: false, busy: false })
  const [editFormState, setEditFormState] = useState<ProductFormState>({ dirty: false, busy: false })
  // « Ajouter un autre produit ensuite » : choix mémorisé le temps de la session
  const [addAnother, setAddAnother] = useState(() => {
    try { return typeof window !== 'undefined' && sessionStorage.getItem('stock_add_another') === '1' } catch { return false }
  })
  const toggleAddAnother = (v: boolean) => {
    setAddAnother(v)
    try { sessionStorage.setItem('stock_add_another', v ? '1' : '0') } catch { /* stockage indisponible */ }
  }
  const [deleting, setDeleting] = useState(false)
  const [archiveConfirmProduct, setArchiveConfirmProduct] = useState<Product | null>(null)
  const [archiving, setArchiving] = useState(false)

  // ── Suppression en masse ────────────────────────────────────────────────
  const canDeleteProducts = canAccess('delete_products')
  // Mirrors STOCK_ALWAYS_ALLOW in app/api/products/route.ts: cashier is
  // trusted with product writes unconditionally (e.g. restocking during
  // checkout), regardless of the "Produits / Stock" toggle value for them.
  const canWriteStock = effectiveRole === 'cashier' || canAccess('stock')
  // Mêmes rôles que la création de bon de commande côté Fournisseurs
  // (canManage dans suppliers/page.tsx) — pas canWriteStock, plus large
  // et pas pertinent pour une décision d'achat fournisseur.
  const canOrderStock = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin'].includes(effectiveRole || '')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Vue cartes / tableau (choix mémorisé) et tri du tableau (idem)
  const [viewMode, setViewMode] = useStockViewMode()
  const [tableSort, setTableSort] = useState<ProductSort>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('stock_table_sort') : null
      const s = raw ? JSON.parse(raw) : null
      if (s && ['name', 'sku', 'price', 'quantity', 'sold', 'status'].includes(s.key) && ['asc', 'desc'].includes(s.dir)) return s
    } catch { /* valeur par défaut */ }
    return { key: 'name', dir: 'asc' }
  })
  useEffect(() => {
    try { localStorage.setItem('stock_table_sort', JSON.stringify(tableSort)) } catch { /* sans stockage, tri non mémorisé */ }
  }, [tableSort])
  // Colonnes optionnelles du tableau (bouton « Colonnes »), mémorisées sur l'appareil
  const [tableColumns, setTableColumns] = useState<ProductColumnKey[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('stock_table_columns') : null
      const arr = raw ? JSON.parse(raw) : null
      const known = new Set(OPTIONAL_COLUMNS.map(c => c.key))
      if (Array.isArray(arr)) return arr.filter((k): k is ProductColumnKey => known.has(k))
    } catch { /* valeur par défaut */ }
    return []
  })
  useEffect(() => {
    try { localStorage.setItem('stock_table_columns', JSON.stringify(tableColumns)) } catch { /* non mémorisé */ }
  }, [tableColumns])
  const toggleColumn = (key: ProductColumnKey) =>
    setTableColumns(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false)
  const [bulkDeleteAll, setBulkDeleteAll] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkCategoryDialog, setBulkCategoryDialog] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState<string | null>(null)
  const [bulkAssigningCategory, setBulkAssigningCategory] = useState(false)
  const [bulkPromoDialog, setBulkPromoDialog] = useState(false)
  const [bulkPromoPercent, setBulkPromoPercent] = useState('')
  const [bulkPromoUntil, setBulkPromoUntil] = useState('')
  const [bulkPromoStart, setBulkPromoStart] = useState('')
  const [bulkApplyingPromo, setBulkApplyingPromo] = useState(false)

  // ── Journal d'activité (panneau latéral) et produits archivés ────────────
  // Anciens sous-onglets « Journal » et « Archivés » : le journal s'ouvre
  // depuis la barre d'actions, les archivés sont une valeur du filtre Statut.
  const isOwnerRole = effectiveRole === 'owner' || effectiveRole === 'super_admin'
  const [journalOpen, setJournalOpen] = useState(false)
  const showArchived = isOwnerRole && statusFilter === 'archived'
  // Filtres secondaires actifs (badge sur « Plus de filtres ») et lien « Réinitialiser »
  const extraFilterCount = (supplierFilter !== 'all' ? 1 : 0) + (noSku ? 1 : 0) + (noImage ? 1 : 0)
  const anyFilterActive = !!search || categoryFilter !== 'all' || statusFilter !== 'all' || shopFilter !== 'all' || extraFilterCount > 0
  // Mode sélection (cartes) : mêmes rôles qu'avant pour les actions groupées
  const canSelectProducts = canWriteStock || canAccess('categories') || canDeleteProducts
  const [archiveDateFrom, setArchiveDateFrom] = useState('')
  const [archiveDateTo, setArchiveDateTo] = useState('')

  const restockForm = useForm<RestockFormData>({ resolver: zodResolver(createRestockSchema({ restock_min_qty: t('errors.restock_min_qty') })) })


  // Réinitialiser la sélection quand on change de boutique
  useEffect(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [shop?.id])

  const fetchProducts = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `stock_${effectiveShopIds.join(',')}`
    const cached = getPageCache<{ prods: any[]; cats: any[]; sups: any[] }>(cacheKey)
    if (cached) {
      setProducts(cached.prods as unknown as Product[])
      setCategories(cached.cats as Category[])
      setSuppliers(cached.sups as Supplier[])
      setLoading(false)
    }
    if (!isOnline) {
      // No cache for this shop and no network to fetch fresh — without this,
      // loading stayed true forever (stuck skeleton) instead of showing a
      // genuinely empty state.
      if (!cached) {
        setProducts([])
        setCategories([])
        setSuppliers([])
        setLoading(false)
      }
      return
    }
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const [prodsRes, archivedRes, catsRes, supsRes] = await withTimeout(Promise.all([
        supabase.from('products')
          .select('*, categories(name, color), suppliers(name)')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true)
          .order('name'),
        supabase.from('products')
          .select('*, categories(name, color), suppliers(name)')
          .in('shop_id', effectiveShopIds)
          .eq('is_active', false)
          .order('name'),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('suppliers').select('*').in('shop_id', effectiveShopIds).order('name'),
      ]), 20_000, 'Chargement du stock trop lent — réessayez.')
      // A transient auth/RLS hiccup right after the tab resumes from background
      // (session mid-refresh) can make one of these calls resolve successfully
      // with data: null instead of throwing — silently replacing real counts
      // with 0 everywhere, with no error to land in the catch block below and
      // preserve the previous good state. Check every error explicitly instead
      // of trusting `data ?? []` to mean "genuinely empty".
      const err = prodsRes.error || archivedRes.error || catsRes.error || supsRes.error
      if (err) throw err
      const { data: prods } = prodsRes, { data: archived } = archivedRes, { data: cats } = catsRes, { data: sups } = supsRes
      setProducts((prods || []) as unknown as Product[])
      setArchivedProducts((archived || []) as unknown as Product[])
      setCategories((cats || []) as Category[])
      setSuppliers((sups || []) as Supplier[])
      setPageCache(cacheKey, { prods: prods || [], cats: cats || [], sups: sups || [] })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  // Date de péremption la plus proche par produit (lots encore en stock) et
  // quantité vendue sur 30 jours glissants (détection stock dormant) — deux
  // signaux additifs, séparés du fetch principal pour ne pas bloquer
  // l'affichage des produits si l'un des deux échoue.
  // Règles et requêtes partagées avec la Vue d'ensemble (lib/stock/signals).
  // Chaque signal échoue séparément : on garde alors le dernier état connu
  // plutôt que d'écraser avec un faux « vide ».
  const fetchStockSignals = async () => {
    if (!effectiveShopIds.length || !isOnline) return
    try {
      const expiry = await fetchExpiryByProduct(supabase, effectiveShopIds)
      setExpiryByProduct(expiry)
      writeSignalsCache(effectiveShopIds, { expiryByProduct: expiry })
    } catch { /* dernier état connu conservé */ }
    try {
      const sold = await fetchSoldQty30d(supabase, effectiveShopIds)
      setSoldQtyByProduct(sold)
      setSoldQtyLoaded(true)
      writeSignalsCache(effectiveShopIds, { soldQtyByProduct: sold })
    } catch { /* idem */ }
  }

  const openProductBatches = async (product: Product) => {
    setBatchesProduct(product)
    setProductBatches([])
    setLoadingBatches(true)
    try {
      const { data } = await supabase
        .from('product_batches')
        .select('*')
        .eq('product_id', product.id)
        .gt('quantity', 0)
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .order('received_at', { ascending: true })
      setProductBatches(data || [])
    } catch {
      // liste vide affichée si l'appel échoue
    } finally {
      setLoadingBatches(false)
    }
  }

  useEffect(() => { fetchProducts() }, [effectiveShopIds.join(',')])

  // Lien profond (Vue d'ensemble, tableau de bord…) : /stock/products?status=low
  // applique le filtre Statut puis nettoie l'URL, pour qu'un rechargement ne
  // réimpose pas le filtre par-dessus un choix fait entre-temps.
  useEffect(() => {
    const s = searchParams.get('status')
    if (!s) return
    if (['all', 'ok', 'low', 'out', 'expiry', 'dormant', 'promo', 'archived'].includes(s)) setFilter({ statusFilter: s })
    // replaceState natif (synchronisé avec le routeur de Next 14) : un
    // router.replace lancé pendant la navigation entrante était ignoré.
    window.history.replaceState(window.history.state, '', `/${locale}/stock/products`)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Péremption/Ventes lentes n'ont pas d'équivalent temps réel (contrairement
  // à la liste produits, tenue à jour par useStockRealtime plus bas) — sans ce
  // déclencheur basé sur le chemin de navigation, ces deux cartes resteraient
  // figées sur leur dernière valeur si l'app réutilise une instance déjà
  // montée de cette page en naviguant en interne (onglets), au lieu de la
  // remonter à chaque fois — observé sur l'app Android.
  useEffect(() => {
    if (pathname === `/${locale}/stock/products`) fetchStockSignals()
  }, [pathname, effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches stock changes
  // made by other team members while this page sat in the background.
  useRefetchOnVisible(() => { fetchProducts(); fetchStockSignals() })
  useRefetchOnReconnect(() => { fetchProducts(); fetchStockSignals() }, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  // Live stock updates (quantity, price, archive status) for the active shop.
  // Realtime payloads are raw rows without the categories(name)/suppliers(name)
  // joins from the initial fetch, so we merge onto the existing record instead
  // of replacing it outright — keeps joined display fields intact.
  useStockRealtime(shop?.id || null, (product) => {
    const isActive = (product as any).is_active !== false
    const upsert = (list: Product[]) => {
      const idx = list.findIndex(p => p.id === product.id)
      if (idx === -1) return [...list, product as Product]
      const next = [...list]
      next[idx] = { ...next[idx], ...product }
      return next
    }
    setProducts(prev => isActive ? upsert(prev) : prev.filter(p => p.id !== product.id))
    setArchivedProducts(prev => isActive ? prev.filter(p => p.id !== product.id) : upsert(prev))
  })

  const todayStr = new Date().toISOString().slice(0, 10)
  // Seuil par catégorie (catégorie.expiry_alert_days) si défini, sinon le
  // réglage de la boutique — voir lib/utils/expiry.ts.
  const getExpiryCutoffFor = (p: Product) => {
    const cat = categories.find(c => c.id === p.category_id)
    const alertDays = getExpiryAlertDays(cat?.expiry_alert_days, shop?.expiry_alert_days)
    return new Date(Date.now() + alertDays * 86_400_000).toISOString().slice(0, 10)
  }
  const isExpired = (p: Product) => { const exp = expiryByProduct[p.id]; return !!exp && exp < todayStr }
  const isExpiringSoon = (p: Product) => { const exp = expiryByProduct[p.id]; return !!exp && exp >= todayStr && exp <= getExpiryCutoffFor(p) }
  const isDormant = (p: Product) => soldQtyLoaded && p.quantity > 0 && !(soldQtyByProduct[p.id] > 0)
  // Partagé produit/lot (les deux ont promo_price/promo_until) — un seul
  // endroit à faire évoluer quand promo_start (Étape 4) sera ajouté.
  const isPromoActive = (o: { promo_price?: number | null; promo_until?: string | null; promo_start?: string | null }) =>
    !!o.promo_price && !!o.promo_until && o.promo_until >= new Date().toISOString()
    && (!o.promo_start || o.promo_start <= new Date().toISOString())

  // Suggestion de promo — jamais pour un produit déjà périmé (à retirer de
  // la vente, pas à brader), un rabais plus fort à mesure que l'échéance
  // approche pour un produit proche de péremption, un rabais fixe pour un
  // produit qui ne se vend juste pas. Purement une suggestion pré-remplie,
  // modifiable avant validation.
  const suggestPromo = (p: Product): { price: number; until: string; reason: string; key: 'expiry' | 'dormant' } | null => {
    const exp = expiryByProduct[p.id]
    if (isExpiringSoon(p) && exp) {
      const daysLeft = Math.round((new Date(exp).getTime() - new Date(todayStr).getTime()) / 86_400_000)
      const pct = daysLeft <= 3 ? 0.3 : daysLeft <= 7 ? 0.2 : 0.1
      const price = Math.max(1, Math.round(p.selling_price * (1 - pct)))
      return { price, until: exp, reason: t('products.promo_suggested_expiry', { days: daysLeft }), key: 'expiry' }
    }
    if (isDormant(p)) {
      const price = Math.max(1, Math.round(p.selling_price * 0.85))
      const until = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
      return { price, until, reason: t('products.promo_suggested_dormant'), key: 'dormant' }
    }
    return null
  }

  // Une promo produit posée depuis une suggestion (péremption/vente lente)
  // n'est plus justifiée si le lot/la situation qui l'a déclenchée n'existe
  // plus — mais on ne la retire jamais automatiquement (voir migration 094).
  const promoStale = (p: Product) => {
    const active = isPromoActive(p)
    if (!active || !p.promo_reason) return false
    if (p.promo_reason === 'expiry') return !isExpiringSoon(p)
    if (p.promo_reason === 'dormant') return !isDormant(p)
    return false
  }

  const filtered = products
    .filter(p => {
      if (search) {
        // Nom et SKU / code-barres (un lecteur de codes tape ici)
        const q = normalize(search)
        const hit = normalize(p.name).includes(q) || (!!p.sku && normalize(p.sku).includes(q))
        if (!hit) return false
      }
      if (shopFilter !== 'all' && p.shop_id !== shopFilter) return false
      if (supplierFilter !== 'all' && p.supplier_id !== supplierFilter) return false
      if (noSku && p.sku) return false
      if (noImage && p.image_url) return false
      if (categoryFilter === 'uncategorized' && p.category_id) return false
      if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && p.category_id !== categoryFilter) return false
      const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
      if (statusFilter === 'out' && p.quantity !== 0) return false
      if (statusFilter === 'low' && (p.quantity === 0 || p.quantity > threshold)) return false
      if (statusFilter === 'ok' && p.quantity <= threshold) return false
      if (statusFilter === 'expiry' && !isExpired(p) && !isExpiringSoon(p)) return false
      if (statusFilter === 'dormant' && !isDormant(p)) return false
      if (statusFilter === 'promo' && !isPromoActive(p)) return false
      return true
    })


  const saveProduct = async (data: ProductFormData) => {
    if (!shop?.id) { toast({ title: t('toast.no_active_shop'), variant: 'destructive' }); return false }
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          name: data.name,
          category_id: data.category_id || null,
          supplier_id: data.supplier_id || null,
          buying_price: data.buying_price ?? 0,
          selling_price: data.selling_price,
          quantity: data.quantity,
          unit: data.unit || 'piece',
          low_stock_threshold: data.low_stock_threshold || null,
          sku: data.sku || null,
          image_url: data.image_url || null,
          is_active: true,
        }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return false }
      fetchProducts()
      return true
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
      return false
    } finally {
      setSaving(false)
    }
  }

  const onAddProduct = async (data: ProductFormData) => {
    const ok = await saveProduct(data)
    if (!ok) return
    toast({ title: t('toast.product_added'), variant: 'success' })
    setShowAddModal(false)
    setSessionAddCount(0)
  }

  const onSaveAndAdd = async (data: ProductFormData) => {
    const ok = await saveProduct(data)
    if (!ok) return
    setSessionAddCount(c => c + 1)
    setAddFormKey(k => k + 1)
    toast({ title: t('toast.product_added'), variant: 'success' })
  }

  const onEditProduct = async (data: ProductFormData) => {
    if (!editingProduct) return
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProduct.id,
          shop_id: editingProduct.shop_id,
          name: data.name,
          category_id: data.category_id || null,
          supplier_id: data.supplier_id || null,
          buying_price: data.buying_price ?? 0,
          selling_price: data.selling_price,
          unit: data.unit || 'piece',
          low_stock_threshold: data.low_stock_threshold || null,
          sku: data.sku || null,
          image_url: data.image_url || null,
        }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.product_updated'), variant: 'success' })
      setEditingProduct(null)
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const onRestock = async (data: RestockFormData) => {
    if (!restockProduct || !shop?.id) return
    setSaving(true)

    // Offline path — save to IndexedDB and update local cache optimistically
    if (!navigator.onLine) {
      const localId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await savePendingMovement({
        local_id: localId,
        shop_id: shop.id,
        product_id: restockProduct.id,
        product_name: restockProduct.name,
        current_quantity: restockProduct.quantity,
        quantity_to_add: data.quantity,
        supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
        supplier_id: data.supplier_id || null,
        buying_price: data.buying_price || null,
        expiry_date: data.expiry_date || null,
        notes: data.notes || null,
        performed_by: profile!.id,
        created_at: new Date().toISOString(),
        synced: false,
      })
      await updateCachedProductQuantity(restockProduct.id, data.quantity)
      registerBackgroundSync()
      setSaving(false)
      toast({ title: t('toast.restock_done', { qty: data.quantity, name: restockProduct.name }), variant: 'success' })
      setShowRestockModal(false)
      restockForm.reset()
      // Update UI locally — no network call
      setProducts(prev => prev.map(p =>
        p.id === restockProduct.id ? { ...p, quantity: p.quantity + data.quantity } : p
      ))
      return
    }

    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: restockProduct.id,
          shop_id: shop.id,
          current_quantity: restockProduct.quantity,
          quantity_to_add: data.quantity,
          supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
          supplier_id: data.supplier_id || null,
          buying_price: data.buying_price || null,
          expiry_date: data.expiry_date || null,
          notes: data.notes || null,
          performed_by: profile!.id,
        }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.restock_done', { qty: data.quantity, name: restockProduct.name }), variant: 'success' })
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
      return
    } finally {
      setSaving(false)
    }
    setShowRestockModal(false)
    restockForm.reset()
    fetchProducts()
  }

  const submitPromo = async () => {
    if (!promoProduct || !shop?.id) return
    const price = Number(promoPrice)
    if (!price || price <= 0 || !promoUntil) {
      toast({ title: t('products.promo_invalid'), variant: 'destructive' })
      return
    }
    setSavingPromo(true)
    try {
      const until = new Date(`${promoUntil}T23:59:59`).toISOString()
      const start = promoStart ? new Date(`${promoStart}T00:00:00`).toISOString() : null
      const res = promoBatch
        ? await withTimeout(fetch('/api/product-batches/promo', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: promoBatch.id, shop_id: shop.id, promo_price: price, promo_until: until, promo_start: start }),
          }))
        : await withTimeout(fetch('/api/products', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: promoProduct.id,
              shop_id: shop.id,
              promo_price: price,
              promo_until: until,
              promo_start: start,
              // Uniquement quand la promo vient d'une suggestion fraîche —
              // sinon on ne touche pas au motif déjà enregistré (édition).
              ...(promoSuggestionKey ? { promo_reason: promoSuggestionKey } : {}),
            }),
          }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.promo_saved'), variant: 'success' })
      setPromoProduct(null)
      setPromoBatch(null)
      setPromoSuggestionReason(null)
      setPromoSuggestionKey(null)
      fetchProducts()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingPromo(false)
    }
  }

  const removePromo = async () => {
    if (!promoProduct || !shop?.id) return
    setSavingPromo(true)
    try {
      const res = promoBatch
        ? await withTimeout(fetch('/api/product-batches/promo', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: promoBatch.id, shop_id: shop.id, promo_price: null, promo_until: null, promo_start: null }),
          }))
        : await withTimeout(fetch('/api/products', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: promoProduct.id, shop_id: shop.id, promo_price: null, promo_until: null, promo_start: null, promo_reason: null }),
          }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setPromoProduct(null)
      setPromoBatch(null)
      setPromoSuggestionReason(null)
      setPromoSuggestionKey(null)
      fetchProducts()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingPromo(false)
    }
  }

  const submitExpiry = async () => {
    if (!expiryBatch || !shop?.id || !expiryDate) return
    setSavingExpiry(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches/expiry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expiryBatch.id, shop_id: shop.id, expiry_date: expiryDate }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.expiry_saved'), variant: 'success' })
      setExpiryBatch(null)
      fetchStockSignals()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingExpiry(false)
    }
  }

  const clearExpiry = async () => {
    if (!expiryBatch || !shop?.id) return
    setSavingExpiry(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches/expiry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: expiryBatch.id, shop_id: shop.id, expiry_date: null }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.expiry_saved'), variant: 'success' })
      setExpiryBatch(null)
      fetchStockSignals()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingExpiry(false)
    }
  }

  const submitAdjustQuantity = async () => {
    if (!adjustBatch || !shop?.id || adjustQuantity === '') return
    setSavingAdjust(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches/adjust', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: adjustBatch.id, shop_id: shop.id, new_quantity: Number(adjustQuantity), reason_code: adjustReason }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.batch_quantity_adjusted_toast'), variant: 'success' })
      setAdjustBatch(null)
      fetchProducts()
      fetchStockSignals()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingAdjust(false)
    }
  }

  const submitDeleteBatch = async () => {
    if (!deleteBatchConfirm || !shop?.id) return
    setDeletingBatch(true)
    try {
      const res = await withTimeout(fetch('/api/product-batches', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteBatchConfirm.id, shop_id: shop.id, reason_code: deleteBatchReason }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.batch_deleted_toast'), variant: 'success' })
      setDeleteBatchConfirm(null)
      fetchProducts()
      fetchStockSignals()
      if (batchesProduct) openProductBatches(batchesProduct)
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setDeletingBatch(false)
    }
  }

  const archiveProduct = async () => {
    if (!archiveConfirmProduct) return
    setArchiving(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: archiveConfirmProduct.id, shop_id: archiveConfirmProduct.shop_id, is_active: false }),
      }))
      const json = await res.json()
      setArchiveConfirmProduct(null)
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.product_archived') })
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setArchiving(false)
    }
  }

  const restoreProduct = async (product: Product) => {
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, shop_id: product.shop_id, is_active: true }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.product_restored'), variant: 'success' })
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    }
  }

  const permanentlyDelete = async () => {
    if (!deleteConfirmProduct) return
    // La saisie du nom est exigée par la ConfirmModal avant d'activer le bouton
    setDeleting(true)
    try {
      const res = await withTimeout(fetch(`/api/products?id=${deleteConfirmProduct.id}&shop_id=${deleteConfirmProduct.shop_id}`, { method: 'DELETE' }))
      if (!res.ok) {
        const json = await res.json()
        toast({ title: json.error || t('toast.error'), variant: 'destructive' })
      } else {
        toast({ title: t('toast.product_deleted'), variant: 'success' })
        setDeleteConfirmProduct(null)
        fetchProducts()
      }
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const exportCSV = async () => {
    const rows = [
      [
        t('products.name'), t('products.category'),
        t('products.buying_price'), t('products.selling_price'),
        t('products.quantity'), t('products.unit'), t('products.pdf_col_status'),
      ],
      ...filtered.map(p => {
        const threshold = p.low_stock_threshold || shop?.low_stock_threshold || 10
        const status = p.quantity === 0
          ? t('status.out_of_stock')
          : p.quantity <= threshold ? t('status.low_stock') : t('status.in_stock')
        return [
          `"${(p.name || '').replace(/"/g, '""')}"`,
          `"${((p as any).categories?.name || '').replace(/"/g, '""')}"`,
          p.buying_price, p.selling_price, p.quantity, p.unit,
          `"${status}"`,
        ]
      })
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    await downloadOrShareCSV(csv, `${t('actions.csv_stock')}-${shop?.name?.replace(/\s+/g, '-') || 'export'}-${Date.now()}.csv`)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)))
    }
  }

  const bulkDelete = async () => {
    if (!shop?.id) return
    const isAll = bulkDeleteAll
    // Pour « tout supprimer », le mot de confirmation est exigé par la ConfirmModal
    setBulkDeleting(true)
    const payload = isAll
      ? { shop_id: shop.id, all: true }
      : { shop_id: shop.id, ids: Array.from(selectedIds) }
    let res: Response
    try {
      res = await withTimeout(fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }), 30_000) // bulk/all delete can legitimately take longer on a large catalog
    } catch (err: any) {
      setBulkDeleting(false)
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
      return
    }
    setBulkDeleting(false)
    const json = await res.json()
    if (!res.ok) {
      toast({ title: json.error || t('toast.error'), variant: 'destructive' })
      return
    }
    const count = json.deleted ?? selectedIds.size
    toast({
      title: isAll ? t('products.all_deleted_toast') : t('products.bulk_deleted_toast', { count }),
      variant: 'success',
    })
    setBulkDeleteDialog(false)
    setBulkDeleteAll(false)
    setSelectedIds(new Set())
    setSelectionMode(false)
    fetchProducts()
  }

  const bulkAssignCategory = async () => {
    if (!shop?.id || selectedIds.size === 0) return
    setBulkAssigningCategory(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, ids: Array.from(selectedIds), category_id: bulkCategoryId }),
      }), 30_000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.bulk_category_assigned_toast', { count: json.updated ?? selectedIds.size }), variant: 'success' })
      setBulkCategoryDialog(false)
      setBulkCategoryId(null)
      setSelectedIds(new Set())
      setSelectionMode(false)
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setBulkAssigningCategory(false)
    }
  }

  // Un % appliqué au prix catalogue de CHAQUE produit sélectionné — pas un
  // prix absolu partagé, qui n'aurait aucun sens entre des produits à des
  // prix différents. Le calcul se fait ici, côté client, puis chaque
  // (id, promo_price) est envoyé — voir app/api/products/route.ts.
  const bulkApplyPromo = async () => {
    if (!shop?.id || selectedIds.size === 0) return
    const pct = Number(bulkPromoPercent)
    if (!pct || pct <= 0 || pct >= 100 || !bulkPromoUntil) {
      toast({ title: t('products.promo_invalid'), variant: 'destructive' })
      return
    }
    setBulkApplyingPromo(true)
    try {
      const items = Array.from(selectedIds)
        .map(id => products.find(p => p.id === id))
        .filter((p): p is Product => !!p)
        .map(p => ({ id: p.id, promo_price: Math.max(1, Math.round(p.selling_price * (1 - pct / 100))) }))
      const until = new Date(`${bulkPromoUntil}T23:59:59`).toISOString()
      const start = bulkPromoStart ? new Date(`${bulkPromoStart}T00:00:00`).toISOString() : null
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, items, promo_until: until, promo_start: start, percent: pct }),
      }), 30_000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('products.bulk_promo_applied_toast', { count: json.updated ?? items.length }), variant: 'success' })
      setBulkPromoDialog(false)
      setBulkPromoPercent('')
      setBulkPromoUntil('')
      setBulkPromoStart('')
      setSelectedIds(new Set())
      setSelectionMode(false)
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setBulkApplyingPromo(false)
    }
  }

  // Journal d'activité : voir components/stock/product-activity-journal.tsx

  // Refresh the Journal when the user comes back to this tab or regains
  // connectivity — same treatment as the rest of the page.
  // (le journal d'activité se recharge à l'ouverture de son panneau)

  // Ouverture de la boîte Promo (cartes et tableau) : pré-remplie avec la
  // promo en cours, sinon avec la suggestion (péremption proche, vente lente).
  const openPromoDialog = (product: Product) => {
    const suggestion = !isPromoActive(product) ? suggestPromo(product) : null
    setPromoProduct(product)
    setPromoBatch(null)
    setPromoInputMode('price')
    if (product.promo_price) {
      setPromoPrice(String(product.promo_price))
      setPromoUntil(product.promo_until ? product.promo_until.slice(0, 10) : '')
      setPromoStart(product.promo_start ? product.promo_start.slice(0, 10) : '')
      setPromoSuggestionReason(null)
      setPromoSuggestionKey(null)
    } else {
      setPromoPrice(suggestion ? String(suggestion.price) : '')
      setPromoUntil(suggestion ? suggestion.until : '')
      setPromoStart('')
      setPromoSuggestionReason(suggestion ? suggestion.reason : null)
      setPromoSuggestionKey(suggestion ? suggestion.key : null)
    }
  }

  const renderProductCard = (product: Product, idx: number) => {
    const threshold = product.low_stock_threshold || shop?.low_stock_threshold || 10
    const isSelected = selectedIds.has(product.id)
    const promoActive = isPromoActive(product)
    const expiry = expiryByProduct[product.id]
    const expired = expiry ? expiry < todayStr : false
    const expiringSoonBadge = expiry && !expired ? expiry <= getExpiryCutoffFor(product) : false
    return (
      <div
        key={product.id}
        // Apparition en CSS (tailwindcss-animate) : framer-motion n'est plus
        // chargé pour cette page, 113 Ko de JavaScript en moins à l'ouverture
        className={`animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards rounded-lg border bg-card shadow-sm p-4 space-y-2 transition-colors ${
          selectionMode ? 'cursor-pointer select-none' : ''
        } ${isSelected ? 'border-stockshop-blue/60 dark:border-blue-500 bg-stockshop-blue-muted/60 dark:bg-blue-950/25' : ''}`}
        style={{
          animationDelay: `${Math.min(idx, 20) * 20}ms`,
          ...(!isSelected && product.categories?.color ? { borderTopColor: product.categories.color, borderTopWidth: 3 } : {}),
        }}
        onClick={selectionMode ? () => setSelectedIds(prev => {
          const next = new Set(prev)
          next.has(product.id) ? next.delete(product.id) : next.add(product.id)
          return next
        }) : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            {selectionMode && (
              <div className="flex-shrink-0 mt-0.5">
                {isSelected
                  ? <CheckSquare className="h-5 w-5 text-stockshop-blue dark:text-blue-400" />
                  : <Square className="h-5 w-5 text-muted-foreground/50" />
                }
              </div>
            )}
            <ProductThumbnail src={product.image_url} alt={product.name} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{product.name}</p>
              {product.sku && (
                <p className="text-[10px] font-mono text-muted-foreground truncate">{product.sku}</p>
              )}
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {promoActive && (
                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${promoStale(product) ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400' : 'bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400'}`}>
                    {promoStale(product) ? t('products.promo_stale_badge') : t('products.promo_badge')}
                  </span>
                )}
                {expired && (
                  <button
                    onClick={e => { e.stopPropagation(); openProductBatches(product) }}
                    className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:opacity-80"
                  >
                    {t('products.expired_badge')}
                  </button>
                )}
                {expiringSoonBadge && (
                  <button
                    onClick={e => { e.stopPropagation(); openProductBatches(product) }}
                    className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 hover:opacity-80"
                  >
                    {t('products.expiring_badge', { date: new Date(expiry!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })}
                  </button>
                )}
              </div>
            </div>
          </div>
          <StockBadge quantity={product.quantity} threshold={threshold} />
        </div>
        <div className="flex items-center justify-between text-sm">
          {promoActive ? (
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.promo_price!)}</span>
              <span className="text-xs text-muted-foreground line-through">{formatNaira(product.selling_price)}</span>
            </span>
          ) : (
            <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.selling_price)}</span>
          )}
          {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
            <span className="text-xs text-muted-foreground">{t('products.cost_label')}: {formatNaira(product.buying_price)}</span>
          )}
        </div>
        {!selectionMode && (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              <span className={`font-bold ${product.quantity === 0 ? 'text-red-500' : product.quantity <= threshold ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                {product.quantity}
              </span>{' '}
              <span className="text-muted-foreground text-xs">{product.unit}s</span>
            </span>
            <div className="flex gap-1">
              {canOrderStock && product.quantity <= threshold && (
                <Button
                  variant="outline" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => { const href = `/${locale}/suppliers?order_product=${product.id}`; startNavigationProgress(href); router.push(href) }}
                >
                  <ShoppingCart className="h-3 w-3 mr-1" />
                  {t('actions.order')}
                </Button>
              )}
              <Button
                variant="outline" size="sm" className="h-7 px-2 text-xs"
                disabled={saving}
                onClick={() => { setEditingProduct(null); setShowAddModal(false); setRestockProduct(product); restockForm.reset({ product_id: product.id, quantity: 1 }); setShowRestockModal(true) }}
              >
                <ArrowDown className="h-3 w-3 mr-1" />
                {t('actions.restock')}
              </Button>
              {canWriteStock && (
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={saving} onClick={() => { setShowAddModal(false); setShowRestockModal(false); setEditingProduct(product) }}>
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
              {canWriteStock && (() => {
                const suggestion = !promoActive ? suggestPromo(product) : null
                const stale = promoActive && promoStale(product)
                return (
                  <Button
                    variant="outline" size="sm"
                    className={`h-7 px-2 ${stale ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-700' : promoActive ? 'text-stockshop-blue dark:text-blue-400 border-stockshop-blue/20 dark:border-blue-800' : suggestion ? 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700' : ''}`}
                    disabled={saving}
                    title={stale ? t('products.promo_stale_hint') : suggestion ? suggestion.reason : t('products.promo_action')}
                    onClick={() => openPromoDialog(product)}
                  >
                    <Tag className="h-3 w-3" />
                  </Button>
                )
              })()}
              <Button
                variant="outline" size="sm" className="h-7 px-2"
                disabled={saving}
                title={t('products.view_batches')}
                onClick={() => openProductBatches(product)}
              >
                <History className="h-3 w-3" />
              </Button>
              {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400" disabled={saving} title={t('products.archive_label')} onClick={() => setArchiveConfirmProduct(product)}>
                  <Archive className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        )}
        {selectionMode && (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              <span className={`font-bold ${product.quantity === 0 ? 'text-red-500' : product.quantity <= threshold ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                {product.quantity}
              </span>{' '}
              <span className="text-muted-foreground text-xs">{product.unit}s</span>
            </span>
          </div>
        )}
      </div>
    )
  }

  // Photo + saisie restaurées après une destruction de l'activité pendant la
  // prise de vue : on rouvre la fiche concernée telle qu'elle était.
  useRestoredPhoto('product', ({ draft, file }) => {
    const values = draft.values as Partial<ProductFormData>
    const productId = draft.meta?.isEdit ? (draft.meta?.productId as string | undefined) : undefined
    setShowRestockModal(false)
    if (productId) {
      setRestoredEdit({ productId, values, file, applied: false })
      return
    }
    const nextKey = addFormKey + 1
    setEditingProduct(null)
    setSessionAddCount(0)
    setAddFormKey(nextKey)
    setRestoredAdd({ formKey: nextKey, values, file })
    setShowAddModal(true)
  })
  // Édition : la fiche ne s'ouvre qu'une fois le produit connu (liste en cache
  // ou chargée) ; introuvable une fois le chargement fini → reprise abandonnée.
  useEffect(() => {
    if (!restoredEdit || restoredEdit.applied) return
    const product = products.find(p => p.id === restoredEdit.productId)
    if (product) {
      setShowAddModal(false)
      setEditingProduct(product)
      setRestoredEdit({ ...restoredEdit, applied: true })
    } else if (!loading) {
      setRestoredEdit(null)
    }
  }, [restoredEdit, products, loading])
  // Fiche d'édition refermée (annulation ou enregistrement) : la reprise ne doit
  // pas resservir à la prochaine ouverture du même produit
  useEffect(() => {
    if (!editingProduct) setRestoredEdit(r => (r?.applied ? null : r))
  }, [editingProduct])
  const addRestore = restoredAdd && restoredAdd.formKey === addFormKey ? restoredAdd : null
  const editRestore = restoredEdit?.applied && editingProduct && restoredEdit.productId === editingProduct.id ? restoredEdit : null

  // Sélection depuis le tableau : cocher une ligne active la barre d'actions
  // groupées existante ; plus rien de coché → la barre disparaît.
  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedIds(next)
    setSelectionMode(next.size > 0)
  }
  const toggleSelectMany = (ids: string[], select: boolean) => {
    const next = new Set(selectedIds)
    ids.forEach(id => (select ? next.add(id) : next.delete(id)))
    setSelectedIds(next)
    setSelectionMode(next.size > 0)
  }
  // En tableau, le bouton « Sélectionner / Annuler » n'existe pas : la barre
  // groupée disparaît d'elle-même dès que plus rien n'est coché (y compris
  // après « Tout désélectionner » depuis la barre).
  useEffect(() => {
    if (viewMode === 'table' && selectionMode && selectedIds.size === 0) setSelectionMode(false)
  }, [viewMode, selectionMode, selectedIds])
  const thresholdFor = (p: Product) => p.low_stock_threshold || shop?.low_stock_threshold || 10
  const tableProps = {
    thresholdFor,
    statusFor: (p: Product): ProductStatus =>
      p.quantity === 0 ? 'out' : p.quantity <= thresholdFor(p) ? 'low' : isDormant(p) ? 'dormant' : 'ok',
    soldQty: (p: Product) => (soldQtyLoaded ? soldQtyByProduct[p.id] || 0 : null),
    expiryFor: (p: Product) => {
      const exp = expiryByProduct[p.id]
      if (!exp) return null
      const expired = exp < todayStr
      return { date: exp, expired, soon: !expired && exp <= getExpiryCutoffFor(p) }
    },
    isPromoActive,
    promoStale,
    promoSuggestion: (p: Product) => (isPromoActive(p) ? null : suggestPromo(p)?.reason ?? null),
    formatPrice: formatNaira,
    isOwner: effectiveRole === 'owner' || effectiveRole === 'super_admin',
    canWriteStock,
    canOrderStock,
    busy: saving,
    selectedIds,
    onToggleSelect: toggleSelectOne,
    onToggleSelectMany: toggleSelectMany,
    sort: tableSort,
    onSortChange: setTableSort,
    // Colonnes financières (coût, valeur) réservées au propriétaire, quel que soit l'appareil
    columns: tableColumns.filter(k => isOwnerRole || !OPTIONAL_COLUMNS.find(c => c.key === k)?.ownerOnly),
    onOrder: (p: Product) => { const href = `/${locale}/suppliers?order_product=${p.id}`; startNavigationProgress(href); router.push(href) },
    onRestock: (p: Product) => { setEditingProduct(null); setShowAddModal(false); setRestockProduct(p); restockForm.reset({ product_id: p.id, quantity: 1 }); setShowRestockModal(true) },
    onEdit: (p: Product) => { setShowAddModal(false); setShowRestockModal(false); setEditingProduct(p) },
    onPromo: openPromoDialog,
    onBatches: openProductBatches,
    onArchive: (p: Product) => setArchiveConfirmProduct(p),
  }

  const productFormProps = {
    categories: categories.filter((c: any) => !shop?.id || c.shop_id === shop.id),
    suppliers: suppliers.filter((s: any) => !shop?.id || s.shop_id === shop.id),
    currency: currencySymbol,
    isOwner: effectiveRole === 'owner' || effectiveRole === 'super_admin',
    shopId: shop?.id,
  }
  const resetAddForm = () => { setShowAddModal(false); setSessionAddCount(0); setAddFormState({ dirty: false, busy: false }) }

  return (
    <div className="space-y-4">
      {/* Stock / Mouvements / Inventaire physique */}
      <StockTabs locale={locale} />

      <>
      {/* Barre : recherche et filtres à gauche, actions regroupées en menus à
          droite (une seule action principale « Ajouter »). Les filtres
          secondaires (fournisseur, hygiène du catalogue) vivent sous
          « Plus de filtres » pour garder la ligne légère. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('products.search_placeholder')} className="h-9 pl-9" aria-label={t('products.search_placeholder')} />
          </div>
          <Select value={categoryFilter} onValueChange={v => setFilter({ categoryFilter: v })}>
            <SelectTrigger className="h-9 w-auto min-w-[150px] gap-1" aria-label={t('products.category')}><SelectValue placeholder={t('products.all_categories')} /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value="all">{t('products.all_categories')}</SelectItem>
              {products.some(p => !p.category_id) && (
                <SelectItem value="uncategorized">
                  {t('categories.uncategorized')} ({products.filter(p => !p.category_id).length})
                </SelectItem>
              )}
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    {c.color && <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />}
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
            <SelectTrigger className="h-9 w-auto min-w-[140px] gap-1" aria-label={t('products.status_label')}><SelectValue placeholder={t('products.all_statuses')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('products.all_statuses')}</SelectItem>
              <SelectItem value="ok">{t('status.in_stock')}</SelectItem>
              <SelectItem value="low">{t('status.low_stock')}</SelectItem>
              <SelectItem value="out">{t('status.out_of_stock')}</SelectItem>
              <SelectItem value="expiry">{t('products.card_expiry')}</SelectItem>
              <SelectItem value="dormant">{t('products.card_dormant')}</SelectItem>
              <SelectItem value="promo">{t('products.promo_badge')}</SelectItem>
              {isOwnerRole && (
                <SelectItem value="archived">
                  <span className="flex items-center gap-1.5"><Archive className="h-3 w-3" /> {t('products.tab_archived')}{archivedProducts.length > 0 ? ` (${archivedProducts.length})` : ''}</span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {isMultiShop && (
            <Select value={shopFilter} onValueChange={v => setFilter({ shopFilter: v })}>
              <SelectTrigger className="h-9 w-auto min-w-[160px] gap-1" aria-label={t('products.filter_shop')}><SelectValue placeholder={t('dashboard.all_shops')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('dashboard.all_shops')}</SelectItem>
                {userShops.filter(s => effectiveShopIds.includes(s.id)).map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('products.more_filters')}
                {extraFilterCount > 0 && (
                  <span className="rounded-full bg-stockshop-blue px-1.5 text-[11px] font-semibold leading-5 text-white">{extraFilterCount}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('products.filter_supplier')}</Label>
                <Select value={supplierFilter} onValueChange={v => setFilter({ supplierFilter: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('products.all_suppliers')} /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">{t('products.all_suppliers')}</SelectItem>
                    {suppliers.filter((s: any) => effectiveShopIds.includes(s.shop_id)).map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={noSku} onChange={e => setFilter({ noSku: e.target.checked })} />
                {t('products.filter_no_sku')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={noImage} onChange={e => setFilter({ noImage: e.target.checked })} />
                {t('products.filter_no_image')}
              </label>
            </PopoverContent>
          </Popover>
          {anyFilterActive && (
            <button type="button" onClick={resetFilters} className="text-xs text-muted-foreground underline hover:text-foreground">
              {t('products.reset_filters')}
            </button>
          )}
        </div>

        {/* Actions sur une seule ligne dès le grand écran ; les filtres, eux, peuvent passer sur deux lignes */}
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
          {canWriteStock && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <FileDown className="h-3.5 w-3.5" />
                  {t('products.import_export')}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[210px]">
                <DropdownMenuItem onClick={() => setShowImportModal(true)}><Upload className="mr-2 h-4 w-4" /> {t('products.import_csv')}</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV}><FileDown className="mr-2 h-4 w-4" /> {t('actions.export_csv')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canWriteStock && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="stockshop" size="sm" className="h-9 gap-1.5" disabled={saving}>
                  <Plus className="h-4 w-4" />
                  {t('products.add_menu')}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[230px]">
                <DropdownMenuItem onClick={() => { setEditingProduct(null); setShowRestockModal(false); setSessionAddCount(0); setAddFormKey(k => k + 1); setShowAddModal(true) }}>
                  <Plus className="mr-2 h-4 w-4" /> {t('actions.add_product')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowBulkModal(true)}><Zap className="mr-2 h-4 w-4" /> {t('products.add_quick')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowImportModal(true)}><Upload className="mr-2 h-4 w-4" /> {t('products.add_import')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Cartes / tableau */}
          <div className="flex h-9 rounded-lg border bg-muted/30 p-0.5" role="group" aria-label={t('products.view_label')}>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              title={t('products.view_cards')}
              className={`flex h-full w-8 items-center justify-center rounded-md transition-colors ${viewMode === 'cards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="sr-only">{t('products.view_cards')}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              title={t('products.view_table')}
              className={`flex h-full w-8 items-center justify-center rounded-md transition-colors ${viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="h-4 w-4" />
              <span className="sr-only">{t('products.view_table')}</span>
            </button>
          </div>
          {/* Colonnes optionnelles du tableau : coût, valeur, catégorie, fournisseur, couverture… */}
          {viewMode === 'table' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <Columns3 className="h-3.5 w-3.5" />
                  {t('products.columns_button')}
                  {tableColumns.length > 0 && (
                    <span className="rounded-full bg-stockshop-blue px-1.5 text-[11px] font-semibold leading-5 text-white">{tableColumns.length}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-1">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('products.columns_title')}</p>
                {OPTIONAL_COLUMNS.filter(c => isOwnerRole || !c.ownerOnly).map(c => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60">
                    <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={tableColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    {t(c.labelKey as any)}
                  </label>
                ))}
                {/* Annoncées, sans donnée tant que le suivi réservé / en transit / en commande n'existe pas */}
                {PENDING_COLUMNS.map(c => (
                  <label key={c.key} className="flex cursor-not-allowed items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground" title={t('products.columns_soon')}>
                    <input type="checkbox" className="h-4 w-4 rounded" disabled />
                    {t(c.labelKey as any)}
                  </label>
                ))}
                {tableColumns.length > 0 && (
                  <button type="button" onClick={() => setTableColumns([])} className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">
                    {t('products.columns_default')}
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}
          {/* Sélection en cours (cartes) : annulation visible en un geste */}
          {viewMode === 'cards' && selectionMode && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()) }}>
              <Square className="h-3.5 w-3.5" /> {t('actions.cancel')}
            </Button>
          )}
          {/* Actions secondaires : sélection (cartes), journal d'activité (propriétaire) */}
          {(isOwnerRole || (viewMode === 'cards' && canSelectProducts && !selectionMode)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0" title={t('products.more_actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">{t('products.more_actions')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[210px]">
                {viewMode === 'cards' && canSelectProducts && !selectionMode && (
                  <DropdownMenuItem onClick={() => setSelectionMode(true)}><CheckSquare className="mr-2 h-4 w-4" /> {t('products.select_action')}</DropdownMenuItem>
                )}
                {isOwnerRole && (
                  <DropdownMenuItem onClick={() => setJournalOpen(true)}><History className="mr-2 h-4 w-4" /> {t('products.activity_journal')}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Les cartes d'alerte vivent désormais dans la Vue d'ensemble (/stock) */}

      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        {/* Pas de « 0 produit(s) » trompeur tant que la liste se charge sans cache */}
        <span>{loading && products.length === 0 ? '…' : t('products.stats_count', { count: showArchived ? archivedProducts.length : filtered.length })}</span>
      </div>

      {/* Barre de sélection */}
      {selectionMode && (
        <div className="flex items-center justify-between rounded-lg bg-stockshop-blue-muted dark:bg-blue-950/40 border border-stockshop-blue/20 dark:border-blue-800 px-3 py-2">
          <button
            className="flex items-center gap-2 text-sm font-medium text-stockshop-blue dark:text-blue-400 hover:text-stockshop-blue dark:hover:text-blue-400 transition-colors"
            onClick={toggleSelectAll}
          >
            {selectedIds.size > 0 && selectedIds.size === filtered.length
              ? <CheckSquare className="h-4 w-4" />
              : <Square className="h-4 w-4" />
            }
            {selectedIds.size > 0 && selectedIds.size === filtered.length ? t('products.deselect_all') : t('products.select_all')}
            <span className="text-xs font-normal text-stockshop-blue dark:text-blue-400">({filtered.length})</span>
          </button>
          {canDeleteProducts && products.length > 0 && (
            <button
              onClick={() => { setBulkDeleteAll(true); setBulkDeleteDialog(true) }}
              className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('products.delete_all_count', { count: products.length })}
            </button>
          )}
        </div>
      )}

      {/* Product grid (masquée quand le filtre Statut affiche les archivés) */}
      {showArchived ? null : loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        viewMode === 'table' ? <ProductTableSkeleton /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
          <Package className="h-12 w-12 mb-3 opacity-30" />
          <p>{t('products.no_products')}</p>
          <p className="text-sm mt-1">{t('products.add_first')}</p>
        </div>
      ) : viewMode === 'table' ? (
        isMultiShop ? (
          <div className="space-y-4">
            {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
              const shopProducts = filtered.filter(p => p.shop_id === shopEntry.id)
              if (!shopProducts.length) return null
              return (
                <div key={shopEntry.id} className="space-y-2">
                  <div className="flex items-center gap-2 pt-1">
                    <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <ProductTable {...tableProps} products={shopProducts} />
                </div>
              )
            })}
          </div>
        ) : (
          <ProductTable {...tableProps} products={filtered} />
        )
      ) : isMultiShop ? (
        <div className="space-y-4">
          {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopProducts = filtered.filter(p => p.shop_id === shopEntry.id)
            if (!shopProducts.length) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {shopProducts.map((product, idx) => renderProductCard(product, idx))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((product, idx) => renderProductCard(product, idx))}
        </div>
      )}

      </>

      {/* Produits archivés — filtre Statut « Archivés », propriétaire seulement.
          La recherche principale s'applique ; période d'archivage en plus. */}
      {showArchived && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={archiveDateFrom} max={archiveDateTo || undefined} onChange={e => setArchiveDateFrom(e.target.value)} className="h-8 w-[140px] text-xs" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={archiveDateTo} min={archiveDateFrom || undefined} onChange={e => setArchiveDateTo(e.target.value)} className="h-8 w-[140px] text-xs" />
            {(archiveDateFrom || archiveDateTo) && (
              <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => { setArchiveDateFrom(''); setArchiveDateTo('') }}>
                {t('products.reset_filters')}
              </button>
            )}
          </div>
          {(() => {
            const filteredArchived = archivedProducts.filter(p => {
              const d = (p as any).updated_at?.slice(0, 10)
              if (archiveDateFrom && d < archiveDateFrom) return false
              if (archiveDateTo && d > archiveDateTo) return false
              if (search && !normalize(p.name).includes(normalize(search))) return false
              return true
            })
            if (filteredArchived.length === 0) {
              return <p className="text-xs text-muted-foreground text-center py-3">{t('products.archived_empty')}</p>
            }
            return filteredArchived.map(product => (
              <div key={product.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground truncate">{product.name}</p>
                  {(product as any).updated_at && (
                    <p className="text-[11px] text-muted-foreground/70">
                      {t('products.archived_on', { date: new Date((product as any).updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="outline" size="sm" className="h-7 gap-1 text-xs text-green-700 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/40 dark:text-green-400 dark:border-green-800"
                    onClick={() => restoreProduct(product)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('products.restore')}
                  </Button>
                  <Button
                    variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirmProduct(product)}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('products.delete_permanent')}
                  </Button>
                </div>
              </div>
            ))
          })()}
        </div>
      )}

      {/* Journal d'activité (panneau latéral, propriétaire seulement) */}
      <ProductActivityJournal
        open={journalOpen}
        onOpenChange={setJournalOpen}
        shopId={shop?.id}
        productExists={id => products.some(p => p.id === id)}
        onOpenProduct={id => {
          const p = products.find(x => x.id === id)
          if (!p) return false
          setShowAddModal(false); setShowRestockModal(false); setEditingProduct(p)
          return true
        }}
      />

      {/* Bulk Add Modal */}
      {shop?.id && (
        <BulkAddModal
          open={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          shopId={shop.id}
          currency={currencySymbol}
          isOwner={effectiveRole === 'owner' || effectiveRole === 'super_admin'}
          onSaved={(count) => { fetchProducts() }}
        />
      )}

      {/* Import Products Modal */}
      {shop?.id && (
        <ImportProductsModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          shopId={shop.id}
          onImported={(count) => { setShowImportModal(false); fetchProducts(); }}
        />
      )}

      {/* Panneau « Ajouter un produit » : formulaire en sections, pied fixe
          (Annuler · Enregistrer et ajouter un autre · Enregistrer), garde de
          fermeture tant que la saisie n'est pas enregistrée */}
      <FormDrawer
        open={showAddModal}
        onOpenChange={open => { if (!open) resetAddForm() }}
        title={t('actions.add_product')}
        icon={<Package className="h-4 w-4" />}
        width="md"
        formId={PRODUCT_FORM_ID}
        submitting={saving}
        submitDisabled={addFormState.busy}
        dirty={addFormState.dirty}
        testId="product-drawer"
        footerExtra={(
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={addAnother}
              onChange={e => toggleAddAnother(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-stockshop-blue"
              data-testid="add-another"
            />
            {t('product_form.add_another_after')}
          </label>
        )}
      >
        {showAddModal && (
          <ProductForm
            key={addFormKey}
            {...productFormProps}
            sessionCount={sessionAddCount}
            defaultValues={addRestore?.values}
            initialPhoto={addRestore?.file ?? null}
            startDirty={!!addRestore}
            onSubmit={addAnother ? onSaveAndAdd : onAddProduct}
            onStateChange={setAddFormState}
          />
        )}
      </FormDrawer>

      {/* Panneau « Modifier le produit » */}
      <FormDrawer
        open={!!editingProduct}
        onOpenChange={open => { if (!open) { setEditingProduct(null); setEditFormState({ dirty: false, busy: false }) } }}
        title={t('products.edit_title')}
        description={editingProduct?.name}
        icon={<Edit2 className="h-4 w-4" />}
        width="md"
        formId={PRODUCT_FORM_ID}
        submitting={saving}
        submitDisabled={editFormState.busy}
        submitLabel={t('actions.update')}
        dirty={editFormState.dirty}
        testId="product-drawer"
      >
        {editingProduct && (
          <ProductForm key={editingProduct.id} {...productFormProps} isEdit productId={editingProduct.id}
            defaultValues={{ name: editingProduct.name, category_id: editingProduct.category_id || '', supplier_id: editingProduct.supplier_id || '', buying_price: editingProduct.buying_price, selling_price: editingProduct.selling_price, quantity: editingProduct.quantity, unit: editingProduct.unit, low_stock_threshold: editingProduct.low_stock_threshold || undefined, sku: editingProduct.sku || '', image_url: editingProduct.image_url || '', ...(editRestore?.values ?? {}) }}
            initialPhoto={editRestore?.file ?? null}
            startDirty={!!editRestore}
            onSubmit={onEditProduct}
            onStateChange={setEditFormState}
          />
        )}
      </FormDrawer>

      {/* Archivage : confirmation courte, bouton ambre */}
      <ConfirmModal
        open={!!archiveConfirmProduct}
        onOpenChange={open => { if (!open) setArchiveConfirmProduct(null) }}
        category={t('products.archive_label')}
        title={archiveConfirmProduct?.name || ''}
        description={t('products.archive_confirm')}
        icon={<Archive className="h-4 w-4" />}
        tone="warning"
        confirmLabel={t('products.archive_label')}
        loading={archiving}
        onConfirm={archiveProduct}
        maxWidth="max-w-md"
      />

      {/* Suppression définitive : saisie du nom exigée, bouton rouge */}
      <ConfirmModal
        open={!!deleteConfirmProduct}
        onOpenChange={open => { if (!open) setDeleteConfirmProduct(null) }}
        category={t('products.delete_permanent')}
        title={deleteConfirmProduct?.name || ''}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('products.delete_permanent')}
        loading={deleting}
        onConfirm={permanentlyDelete}
        requireText={deleteConfirmProduct?.name}
      >
        <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400 space-y-1">
          <p className="font-semibold">{t('products.delete_warning_title')}</p>
          <p>{t('products.delete_warning_body')}</p>
        </div>
      </ConfirmModal>

      {/* Suppression en masse : mot de confirmation exigé pour « tout supprimer » */}
      <ConfirmModal
        open={bulkDeleteDialog}
        onOpenChange={open => { if (!open) { setBulkDeleteDialog(false); setBulkDeleteAll(false) } }}
        category={t('products.delete_warning_title_short')}
        title={bulkDeleteAll ? t('products.delete_all_title') : t('products.delete_selected_title', { count: selectedIds.size })}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={bulkDeleteAll ? 'Tout supprimer' : `Supprimer ${selectedIds.size} produit${selectedIds.size > 1 ? 's' : ''}`}
        loading={bulkDeleting}
        onConfirm={bulkDelete}
        requireText={bulkDeleteAll ? t('products.delete_confirm_word') : undefined}
      >
        <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-400">
              <p className="font-semibold mb-1">
                {bulkDeleteAll
                  ? t('products.bulk_delete_all_warning', { count: products.length })
                  : t('products.bulk_delete_selected_warning', { count: selectedIds.size })
                }
              </p>
              <ul className="text-xs space-y-1 text-red-600 dark:text-red-400">
                <li>• {t('products.sales_data_kept')}</li>
                <li>• {t('products.irreversible_action')}</li>
              </ul>
            </div>
          </div>
        </div>
      </ConfirmModal>

      {/* Restock Modal */}
      <PremiumDialog open={showRestockModal} onOpenChange={setShowRestockModal} category={t('products.restock_title')} title={restockProduct?.name || ''} icon={<ArrowDown className="h-4 w-4" />} dirty={restockForm.formState.isDirty}>
        <form onSubmit={restockForm.handleSubmit(onRestock)}>
          <PremiumDialogBody>
            <input type="hidden" {...restockForm.register('product_id')} />
            <div className="space-y-1.5">
              <Label>{t('products.quantity_to_add')} *</Label>
              <Input type="number" min={1} {...restockForm.register('quantity')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('products.supplier')}</Label>
              <Select onValueChange={v => restockForm.setValue('supplier_id', v)}>
                <SelectTrigger><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(effectiveRole === 'owner' || effectiveRole === 'super_admin') && (
              <div className="space-y-1.5">
                <Label>{t('products.restock_buying_price')}</Label>
                <Input type="number" {...restockForm.register('buying_price')} placeholder={String(restockProduct?.buying_price)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t('products.expiry_date_label')}</Label>
              <Input type="date" {...restockForm.register('expiry_date')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('products.notes_label')}</Label>
              <Input {...restockForm.register('notes')} placeholder={t('products.notes_placeholder')} />
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={() => setShowRestockModal(false)} cancelLabel={t('actions.cancel')}>
            <Button variant="stockshop" type="submit" loading={saving} className="flex-1 h-11 rounded-lg font-semibold">{t('actions.restock')}</Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>

      {/* Promotion Modal */}
      <PremiumDialog
        open={!!promoProduct}
        onOpenChange={open => { if (!open) { setPromoProduct(null); setPromoBatch(null); setPromoSuggestionReason(null); setPromoSuggestionKey(null) } }}
        category={promoBatch ? t('products.promo_batch_category') : t('products.promo_action')}
        title={promoProduct?.name || ''}
        icon={<Tag className="h-4 w-4" />}
      >
        {promoProduct && (
          <>
            <PremiumDialogBody>
              {promoBatch && (
                <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {t('products.promo_batch_hint', {
                    quantity: promoBatch.quantity,
                    date: promoBatch.expiry_date
                      ? new Date(promoBatch.expiry_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                      : t('products.no_expiry_date'),
                  })}
                </div>
              )}
              {!promoBatch && promoStale(promoProduct) && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                  {t('products.promo_stale_hint')}
                </div>
              )}
              {promoSuggestionReason && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {promoSuggestionReason}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('products.promo_hint', { price: formatNaira(promoProduct.selling_price) })}
              </p>
              {(() => {
                const sellingPrice = promoProduct.selling_price
                const costPrice = Number(promoBatch ? promoBatch.buying_price : promoProduct.buying_price) || 0
                const priceNum = Number(promoPrice) || 0
                const percentOff = priceNum > 0 ? Math.round((1 - priceNum / sellingPrice) * 100) : null
                const belowCost = priceNum > 0 && costPrice > 0 && priceNum < costPrice
                const percentDisplayValue = promoPrice
                  ? String(Math.round((1 - Number(promoPrice) / sellingPrice) * 100))
                  : ''
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>{(promoInputMode === 'percent' ? t('products.promo_percent_label') : t('products.promo_price_label'))} *</Label>
                      <div className="flex gap-0.5 rounded-md border bg-muted/30 p-0.5">
                        <button
                          type="button"
                          onClick={() => setPromoInputMode('price')}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${promoInputMode === 'price' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                        >
                          {t('products.promo_mode_price')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPromoInputMode('percent')}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${promoInputMode === 'percent' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                        >
                          %
                        </button>
                      </div>
                    </div>
                    {promoInputMode === 'percent' ? (
                      <Input
                        type="number" min={1} max={99}
                        value={percentDisplayValue}
                        onChange={e => {
                          if (!e.target.value) { setPromoPrice(''); return }
                          const pct = Number(e.target.value)
                          setPromoPrice(String(Math.max(1, Math.round(sellingPrice * (1 - pct / 100)))))
                        }}
                        placeholder="20"
                      />
                    ) : (
                      <Input
                        type="number" min={0} max={sellingPrice - 1}
                        value={promoPrice}
                        onChange={e => setPromoPrice(e.target.value)}
                        placeholder={String(sellingPrice)}
                      />
                    )}
                    {priceNum > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('products.promo_derived_hint', { percent: percentOff ?? 0, price: formatNaira(priceNum) })}
                      </p>
                    )}
                    {belowCost && (
                      <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                        {t('products.promo_below_cost_warning', { cost: formatNaira(costPrice) })}
                      </div>
                    )}
                  </div>
                )
              })()}
              <div className="space-y-1.5">
                <Label>{t('products.promo_start_label')}</Label>
                <Input type="date" value={promoStart} onChange={e => setPromoStart(e.target.value)} placeholder={t('products.promo_start_placeholder')} />
                <p className="text-[11px] text-muted-foreground">{t('products.promo_start_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t('products.promo_until_label')} *</Label>
                <Input type="date" value={promoUntil} onChange={e => setPromoUntil(e.target.value)} />
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => { setPromoProduct(null); setPromoBatch(null); setPromoSuggestionReason(null); setPromoSuggestionKey(null) }} cancelLabel={t('actions.cancel')}>
              {(promoBatch ? promoBatch.promo_price : promoProduct.promo_price) && (
                <Button
                  variant="outline"
                  className="flex-1 h-11 rounded-lg font-semibold text-destructive border-destructive/30 hover:bg-red-50 dark:hover:bg-red-950/40"
                  onClick={removePromo}
                  loading={savingPromo}
                >
                  {t('products.promo_remove')}
                </Button>
              )}
              <Button variant="stockshop" className="flex-1 h-11 rounded-lg font-semibold" onClick={submitPromo} loading={savingPromo}>
                {t('actions.save')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      {/* Lots du produit : panneau de consultation, actions par lot dans de petites modales */}
      <DetailDrawer
        open={!!batchesProduct}
        onOpenChange={open => { if (!open) setBatchesProduct(null) }}
        category={t('products.batches_title')}
        title={batchesProduct?.name || ''}
        description={t('products.batches_hint')}
        icon={<History className="h-4 w-4" />}
        width="md"
        testId="batches-drawer"
      >
        {batchesProduct && (
          <>
            <div>
              {loadingBatches ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
              ) : productBatches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('products.no_batches')}</p>
              ) : (
                <div className="space-y-2">
                  {productBatches.map((b: any) => {
                    const today = new Date().toISOString().slice(0, 10)
                    const isExpired = b.expiry_date && b.expiry_date < today
                    const sourceLabel = t(`products.batch_source_${b.source}` as any) || b.source
                    const batchPromoActive = isPromoActive(b)
                    return (
                      <div key={b.id} className="rounded-lg border bg-card px-3 py-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold flex items-center gap-1">
                            {b.quantity} {batchesProduct.unit}
                            {canWriteStock && (
                              <button
                                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-stockshop-blue dark:hover:text-blue-400"
                                title={t('products.adjust_quantity_action')}
                                onClick={() => { setAdjustBatch(b); setAdjustQuantity(String(b.quantity)); setAdjustReason('correction') }}
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
                              {sourceLabel}
                            </span>
                            {canWriteStock && (
                              <button
                                className={`h-6 w-6 flex items-center justify-center rounded ${batchPromoActive ? 'text-stockshop-blue dark:text-blue-400' : 'text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400'}`}
                                title={t('products.promo_action')}
                                onClick={() => {
                                  setPromoProduct(batchesProduct)
                                  setPromoBatch(b)
                                  setPromoInputMode('price')
                                  setPromoPrice(b.promo_price ? String(b.promo_price) : '')
                                  setPromoUntil(b.promo_until ? b.promo_until.slice(0, 10) : '')
                                  setPromoStart(b.promo_start ? b.promo_start.slice(0, 10) : '')
                                  setPromoSuggestionReason(null)
                                  setPromoSuggestionKey(null)
                                }}
                              >
                                <Tag className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canWriteStock && (
                              <button
                                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                                title={t('products.delete_batch_action')}
                                onClick={() => { setDeleteBatchConfirm(b); setDeleteBatchReason('correction') }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t('products.cost_label')}: {formatNaira(b.buying_price)}</span>
                          <span>{t('products.received_on')}: {new Date(b.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {b.expiry_date ? (
                            <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${isExpired ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400' : 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'}`}>
                              {isExpired ? t('products.expired_badge') : t('products.expiring_badge', { date: new Date(b.expiry_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) })}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">{t('products.no_expiry_date')}</span>
                          )}
                          {canWriteStock && (
                            <button
                              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-stockshop-blue dark:hover:text-blue-400"
                              title={t('products.edit_expiry_action')}
                              onClick={() => { setExpiryBatch(b); setExpiryDate(b.expiry_date ? b.expiry_date.slice(0, 10) : '') }}
                            >
                              <CalendarClock className="h-3 w-3" />
                            </button>
                          )}
                          {batchPromoActive && (
                            <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400">
                              {t('products.promo_badge')}: {formatNaira(b.promo_price)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </DetailDrawer>

      {/* Correction de la date de péremption d'un lot */}
      <PremiumDialog
        open={!!expiryBatch}
        onOpenChange={open => { if (!open) setExpiryBatch(null) }}
        title={t('products.edit_expiry_action')}
        icon={<CalendarClock className="h-4 w-4" />}
      >
        {expiryBatch && (
          <>
            <PremiumDialogBody>
              <div className="space-y-1.5">
                <Label>{t('products.card_expiry')}</Label>
                <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="h-9" />
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setExpiryBatch(null)} cancelLabel={t('actions.cancel')}>
              {expiryBatch.expiry_date && (
                <Button variant="outline" className="h-11 rounded-lg font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300" onClick={clearExpiry} loading={savingExpiry}>
                  {t('products.clear_expiry_action')}
                </Button>
              )}
              <Button variant="stockshop" className="flex-1 h-11 rounded-lg font-semibold" onClick={submitExpiry} loading={savingExpiry} disabled={!expiryDate}>
                {t('actions.save')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      {/* Correction de la quantité d'un lot */}
      <PremiumDialog
        open={!!adjustBatch}
        onOpenChange={open => { if (!open) setAdjustBatch(null) }}
        title={t('products.adjust_quantity_action')}
        icon={<Edit2 className="h-4 w-4" />}
      >
        {adjustBatch && (
          <>
            <PremiumDialogBody>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t('products.new_quantity_label')}</Label>
                  <Input type="number" min={0} value={adjustQuantity} onChange={e => setAdjustQuantity(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('products.adjustment_reason')}</Label>
                  {/* select natif — un Select Radix imbriqué dans ce Dialog laisse
                      pointer-events bloqué après fermeture (même bug que dans
                      Inventaire physique) */}
                  <select
                    value={adjustReason}
                    onChange={e => setAdjustReason(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {(['correction', 'damage', 'loss', 'theft', 'expiry', 'other'] as const).map(code => (
                      <option key={code} value={code}>{t(`products.${code}` as any)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </PremiumDialogBody>
            <PremiumDialogFooter onCancel={() => setAdjustBatch(null)} cancelLabel={t('actions.cancel')}>
              <Button variant="stockshop" className="flex-1 h-11 rounded-lg font-semibold" onClick={submitAdjustQuantity} loading={savingAdjust} disabled={adjustQuantity === ''}>
                {t('actions.save')}
              </Button>
            </PremiumDialogFooter>
          </>
        )}
      </PremiumDialog>

      {/* Suppression d'un lot : confirmation avec motif, bouton rouge */}
      <ConfirmModal
        open={!!deleteBatchConfirm}
        onOpenChange={open => { if (!open) setDeleteBatchConfirm(null) }}
        title={t('products.delete_batch_action')}
        description={t('products.delete_batch_confirm')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('products.delete_batch_action')}
        loading={deletingBatch}
        onConfirm={submitDeleteBatch}
      >
        {deleteBatchConfirm && (
          <div className="space-y-1.5">
            <Label>{t('products.adjustment_reason')}</Label>
            <select
              value={deleteBatchReason}
              onChange={e => setDeleteBatchReason(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {(['correction', 'damage', 'loss', 'theft', 'expiry', 'other'] as const).map(code => (
                <option key={code} value={code}>{t(`products.${code}` as any)}</option>
              ))}
            </select>
          </div>
        )}
      </ConfirmModal>
      {/* Bulk category assignment dialog */}
      <PremiumDialog
        open={bulkCategoryDialog}
        onOpenChange={open => { if (!open) { setBulkCategoryDialog(false); setBulkCategoryId(null) } }}
        title={t('products.assign_category_title', { count: selectedIds.size })}
        icon={<Settings2 className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            <button
              type="button"
              onClick={() => setBulkCategoryId(null)}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors border',
                bulkCategoryId === null ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium' : 'border-transparent hover:bg-accent text-foreground/80'
              )}
            >
              {t('categories.uncategorized')}
            </button>
            {categories.filter(c => c.shop_id === shop?.id).map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setBulkCategoryId(c.id)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors border',
                  bulkCategoryId === c.id ? 'border-stockshop-blue dark:border-blue-500 bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 font-medium' : 'border-transparent hover:bg-accent text-foreground/80'
                )}
              >
                {c.color && <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />}
                {c.name}
              </button>
            ))}
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => { setBulkCategoryDialog(false); setBulkCategoryId(null) }}
          cancelLabel={t('actions.cancel')}
          onConfirm={bulkAssignCategory}
          confirmLabel={bulkAssigningCategory ? t('payment.saving') : t('actions.save')}
          confirmLoading={bulkAssigningCategory}
        />
      </PremiumDialog>

      {/* Bulk promo dialog */}
      <PremiumDialog
        open={bulkPromoDialog}
        onOpenChange={open => { if (!open) setBulkPromoDialog(false) }}
        title={t('products.assign_promo_title', { count: selectedIds.size })}
        icon={<Tag className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label>{t('products.promo_percent_label')} *</Label>
            <Input
              type="number" min={1} max={99}
              value={bulkPromoPercent}
              onChange={e => setBulkPromoPercent(e.target.value)}
              placeholder="20"
            />
            <p className="text-xs text-muted-foreground">{t('products.bulk_promo_hint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t('products.promo_start_label')}</Label>
            <Input type="date" value={bulkPromoStart} onChange={e => setBulkPromoStart(e.target.value)} placeholder={t('products.promo_start_placeholder')} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('products.promo_until_label')} *</Label>
            <Input type="date" value={bulkPromoUntil} onChange={e => setBulkPromoUntil(e.target.value)} />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setBulkPromoDialog(false)}
          cancelLabel={t('actions.cancel')}
          onConfirm={bulkApplyPromo}
          confirmLabel={t('actions.save')}
          confirmLoading={bulkApplyingPromo}
        />
      </PremiumDialog>

      {/* Barre flottante de sélection */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <div className="rounded-2xl bg-card border shadow-xl px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('products.selected_count', { count: selectedIds.size })}
              </span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="h-7 w-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                title={t('actions.cancel')}
                aria-label={t('actions.cancel')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {canAccess('categories') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 gap-1.5 text-xs"
                  onClick={() => { setBulkCategoryId(null); setBulkCategoryDialog(true) }}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {t('products.assign_category_action')}
                </Button>
              )}
              {canWriteStock && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 gap-1.5 text-xs"
                  onClick={() => { setBulkPromoPercent(''); setBulkPromoUntil(''); setBulkPromoStart(''); setBulkPromoDialog(true) }}
                >
                  <Tag className="h-3.5 w-3.5" />
                  {t('products.assign_promo_action')}
                </Button>
              )}
              {canDeleteProducts && (
                <Button
                  size="sm"
                  className="h-9 flex-1 gap-1.5 bg-destructive hover:bg-destructive/90 text-white text-xs"
                  onClick={() => { setBulkDeleteAll(false); setBulkDeleteDialog(true) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
