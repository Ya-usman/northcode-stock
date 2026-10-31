'use client'

import { PageHeader } from '@/components/layout/page-header'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { dateLocaleTag } from '@/lib/i18n/date-format'
import type { ProductFieldError } from '@/components/stock/product-form'
import dynamic from 'next/dynamic'
import { Plus, Search, Edit2, Package, ArrowDown, FileDown, Settings2, Trash2, Store, RotateCcw, Archive, Upload, CheckSquare, Square, AlertTriangle, History, Tag, CalendarClock, ShoppingCart, X, LayoutGrid, List, SlidersHorizontal, ChevronDown, MoreHorizontal, Zap, Columns3, FileSpreadsheet } from 'lucide-react'
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
import { emitOnboarding } from '@/lib/onboarding/events'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { ExpiryDateField, usePastExpiryConfirm } from '@/components/stock/expiry-date-field'
import { BatchAdjustDialog, BatchExpiryDialog, BatchRemoveConfirm } from '@/components/stock/batch-dialogs'
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
import { ProductTable, ProductTableSkeleton, OPTIONAL_COLUMNS, type ProductColumnKey, type ProductSort, type ProductStatus } from '@/components/stock/product-table'
import { useStockViewMode } from '@/lib/hooks/use-stock-view-mode'
import { ProductActivityJournal } from '@/components/stock/product-activity-journal'
import { ProductDetailDrawer, type ProductDetailSection } from '@/components/stock/product-detail-drawer'
import { isNeutralClick } from '@/lib/utils/open-on-click'
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/products/columns'
import { SUPPLIER_PUBLIC_COLUMNS } from '@/lib/suppliers/columns'
import { fetchCosts, withCosts } from '@/lib/costs/client'
import { fetchExpiryByProduct, fetchExpiredQtyByProduct, availableQty, stockLevelOf, stockQuantities, fetchSoldQty30dForShops, readSignalsCache, shopRulesOf, writeSignalsCache } from '@/lib/stock/signals'
import { shopToday } from '@/lib/stock/sellable'
import { addDays } from '@/lib/stock/batch-status'
import { fetchStockPipeline, type StockPipeline } from '@/lib/stock/pipeline'
import { fetchReservedQtyByProduct } from '@/lib/stock/reservations'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { MultiSelectFilter, MultiSelectList } from '@/components/ui/multi-select-filter'
import { asValueList, keepKnown, matchesAny, shopScopedGroups, toggleValue, type FilterGroup } from '@/lib/filters/multi-select'
import { useFilterScope } from '@/lib/filters/use-filter-scope'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'

import { savePendingMovement, updateCachedProductQuantity } from '@/lib/offline/db'
import { registerBackgroundSync } from '@/lib/offline/sync'
import { useRolePermissions, useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { EmptyGuide } from '@/components/onboarding/empty-guide'
import { useTableExport } from '@/lib/export/use-table-export'
import { PRODUCT_UNITS } from '@/lib/import/products-import'
import { useStockRealtime } from '@/lib/hooks/use-realtime'
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


// Ordre MÉTIER du filtre Statut (jamais alphabétique) ; « Archivé » s'ajoute pour qui gère le stock
const STATUS_ORDER = ['ok', 'low', 'out', 'expiry', 'dormant', 'promo']

function StockBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  const t = useTranslations('status')
  if (quantity === 0) return <Badge variant="danger">{t('out_of_stock')}</Badge>
  if (quantity <= threshold) return <Badge variant="warning">{t('low_stock')}</Badge>
  return <Badge variant="success">{t('in_stock')}</Badge>
}

export default function StockPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const unitLabelFor = useUnitLabel()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const effectiveRole = roleInActiveShop ?? profile?.role
  const { canAccess, canWrite, canViewCost } = useRolePermissions()
  // Prix d'achat (saisie comprise) : droit au coût DANS la boutique du produit — « Stock en modification » ne le donne plus
  const { canViewCostIn } = useShopPermissions()
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
  // Pas de filtre « Boutique » ici : la boutique affichée est celle du sélecteur de l'en-tête (effectiveShopIds),
  // seule source de vérité — toutes les boutiques (produits regroupés par boutique) ou une boutique précise.
  // Catégorie, Statut et Fournisseur : choix multiples (OU dans un filtre, ET entre filtres), par
  // identifiant — jamais par libellé. Mémoire par contexte réel de l'en-tête (une boutique ou « Toutes
  // les boutiques ») : chaque contexte retrouve son propre état, un filtre d'Akwa ne suit pas vers Bastos.
  const filterScope = useFilterScope()
  // Contexte boutique : l'en-tête décide de ce que l'on voit ; l'OBJET décide où s'applique une action sur
  // un produit existant ; une création sans boutique déterminée passe par requireOneShop (jamais la
  // boutique active cachée)
  const scope = useShopScope()
  const multiShopAccount = userShops.length > 1
  const shopById: Record<string, (typeof userShops)[number]> = Object.fromEntries(userShops.map(s => [s.id, s]))
  const [createShop, setCreateShop] = useState<(typeof userShops)[number] | null>(null)
  const [journalShop, setJournalShop] = useState<(typeof userShops)[number] | null>(null)
  // Changement de contexte (Akwa → Toutes → Bastos…) : création, ajout rapide et journal en cours sont
  // fermés et leur boutique oubliée — aucune action ne part avec la boutique précédente
  const scopeKey = `${scope.mode}:${scope.shopIds.join(',')}`
  const firstScope = useRef(true)
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return }
    setShowAddModal(false); setShowBulkModal(false); setJournalOpen(false)
    setCreateShop(null); setJournalShop(null)
  }, [scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [{ search, categoryIds, statuses, supplierIds, noSku, noImage }, setFilter, resetFilters] = usePersistedFilters(
    'stock', filterScope,
    { search: '', categoryIds: [] as string[], statuses: [] as string[], supplierIds: [] as string[], noSku: false, noImage: false },
    { keepPerScope: true },
  )
  // Signaux (péremption, ventes 30 j) : repris du cache local partagé avec la
  // Vue d'ensemble (lib/stock/signals), rafraîchis ensuite en arrière-plan.
  const [expiryByProduct, setExpiryByProduct] = useState<Record<string, string>>(() => readSignalsCache(effectiveShopIds)?.expiryByProduct ?? {})
  const [soldQtyByProduct, setSoldQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.soldQtyByProduct ?? {})
  // Tant que les ventes 30 j ne sont ni en cache ni chargées, isDormant ne
  // doit pas prendre « pas encore chargé » pour « zéro vente confirmée »,
  // sinon tout produit en stock passerait brièvement pour dormant.
  const [soldQtyLoaded, setSoldQtyLoaded] = useState(() => !!readSignalsCache(effectiveShopIds)?.soldQtyByProduct)
  // Quantité des lots périmés par produit (sortie du « Disponible »)
  const [expiredQtyByProduct, setExpiredQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.expiredQtyByProduct ?? {})
  // Quantité gardée pour des factures en attente à la caisse : elle sort aussi du disponible
  const [reservedQtyByProduct, setReservedQtyByProduct] = useState<Record<string, number>>(() => readSignalsCache(effectiveShopIds)?.reservedQtyByProduct ?? {})
  // Stock à venir (en transit, en commande) : null tant qu'il n'est ni en cache ni chargé
  const [pipeline, setPipeline] = useState<StockPipeline | null>(() => readSignalsCache(effectiveShopIds)?.pipeline ?? null)
  const [promoProduct, setPromoProduct] = useState<Product | null>(null)
  const [promoPrice, setPromoPrice] = useState('')
  const [promoUntil, setPromoUntil] = useState('')
  const [promoStart, setPromoStart] = useState('')
  const [promoInputMode, setPromoInputMode] = useState<'price' | 'percent'>('price')
  const [savingPromo, setSavingPromo] = useState(false)
  const [promoSuggestionReason, setPromoSuggestionReason] = useState<string | null>(null)
  const [promoSuggestionKey, setPromoSuggestionKey] = useState<'expiry' | 'dormant' | null>(null)
  const [promoBatch, setPromoBatch] = useState<any | null>(null)
  // Garde de fermeture (lot 7) : valeurs de la fenêtre promo à son ouverture (suggestion, promo existante ou lot)
  const [promoInitial, setPromoInitial] = useState('')
  useEffect(() => { if (promoProduct) setPromoInitial(JSON.stringify([promoPrice, promoUntil, promoStart])) }, [promoProduct?.id, promoBatch?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [expiryBatch, setExpiryBatch] = useState<any | null>(null)
  // Fiche produit : `batchesProduct` est le produit affiché ; la fiche s'ouvre en haut, ou sur ses lots (icône « Lots »)
  const [batchesProduct, setBatchesProduct] = useState<Product | null>(null)
  const [detailSection, setDetailSection] = useState<ProductDetailSection>('top')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [productBatches, setProductBatches] = useState<any[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [adjustBatch, setAdjustBatch] = useState<any | null>(null)
  const [deleteBatchConfirm, setDeleteBatchConfirm] = useState<any | null>(null)
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
  // Règle unique (lib/permissions) : niveau « modification » de Produits /
  // Stock — même règle que les routes /api/products et /api/product-batches.
  const canWriteStock = canWrite('stock')
  // Commander = créer un bon de commande : niveau « modification » de
  // Fournisseurs (même règle que la page Fournisseurs).
  const canOrderStock = canWrite('suppliers')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Vue cartes / tableau (choix mémorisé) et tri du tableau (idem)
  const [viewMode, setViewMode] = useStockViewMode()
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
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
  // « Stock : modification » = tous les droits sur les produits : prix d'achat, coût et
  // valeur du stock, archivage, journal d'activité (règle du 9 oct. 2026)
  const fullStock = canWriteStock
  const [journalOpen, setJournalOpen] = useState(false)
  // Valeurs mémorisées encore valables : une catégorie supprimée, un fournisseur retiré ou un statut
  // réservé (Archivé) ne restent jamais comme filtre fantôme qui viderait la liste
  const statusValues = fullStock ? [...STATUS_ORDER, 'archived'] : STATUS_ORDER
  const categoryFilter = keepKnown(asValueList(categoryIds), loading ? null : new Set(['uncategorized', ...categories.map(c => c.id)]))
  const statusFilter = keepKnown(asValueList(statuses), new Set(statusValues))
  const supplierFilter = keepKnown(asValueList(supplierIds), loading ? null : new Set(suppliers.map(s => s.id)))
  const showArchived = fullStock && statusFilter.includes('archived')
  // Filtres secondaires actifs (badge sur « Plus de filtres ») et lien « Réinitialiser »
  const extraFilterCount = (supplierFilter.length ? 1 : 0) + (noSku ? 1 : 0) + (noImage ? 1 : 0)
  const anyFilterActive = !!search || categoryFilter.length > 0 || statusFilter.length > 0 || extraFilterCount > 0
  // Mode sélection (cartes) : mêmes rôles qu'avant pour les actions groupées
  const canSelectProducts = canWriteStock || canWrite('categories') || canDeleteProducts
  const [archiveDateFrom, setArchiveDateFrom] = useState('')
  const [archiveDateTo, setArchiveDateTo] = useState('')

  const restockForm = useForm<RestockFormData>({ resolver: zodResolver(createRestockSchema({ restock_min_qty: t('errors.restock_min_qty') })) })
  // Date de péremption déjà passée (réassort, date d'un lot) : on demande, on n'interdit pas
  const pastExpiry = usePastExpiryConfirm()


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
          .select(`${PRODUCT_PUBLIC_COLUMNS}, categories(name, color), suppliers(name)`)
          .in('shop_id', effectiveShopIds)
          .eq('is_active', true)
          .order('name'),
        supabase.from('products')
          .select(`${PRODUCT_PUBLIC_COLUMNS}, categories(name, color), suppliers(name)`)
          .in('shop_id', effectiveShopIds)
          .eq('is_active', false)
          .order('name'),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('suppliers').select(SUPPLIER_PUBLIC_COLUMNS).in('shop_id', effectiveShopIds).order('name'),
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
      // Lus SANS prix d'achat ; le coût déjà obtenu du serveur (si la personne y a droit) est reposé dessus
      setProducts(withCosts((prods || []) as unknown as Product[], costsRef.current))
      setArchivedProducts(withCosts((archived || []) as unknown as Product[], costsRef.current))
      setCategories((cats || []) as Category[])
      setSuppliers((sups || []) as Supplier[])
      setPageCache(cacheKey, { prods: prods || [], cats: cats || [], sups: sups || [] })
      loadCosts()
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  // Prix d'achat : demandés au serveur (/api/costs) UNIQUEMENT si la personne a le droit de les voir, puis posés
  // sur les lignes. Ils ne sont ni lus par le navigateur dans la base, ni rangés dans le cache local.
  const costsRef = useRef<Record<string, number> | null>(null)
  const loadCosts = async () => {
    if (!canViewCost || !effectiveShopIds.length || !isOnline) return
    try {
      const costs = await fetchCosts(effectiveShopIds)
      costsRef.current = costs?.products ?? null
      setProducts(prev => withCosts(prev, costsRef.current))
      setArchivedProducts(prev => withCosts(prev, costsRef.current))
    } catch { /* colonnes de coût en « — » jusqu'au prochain chargement */ }
  }
  // Droit connu après le premier chargement (réglages de la boutique arrivés entre-temps), ou retiré
  useEffect(() => {
    if (canViewCost) loadCosts()
    else { costsRef.current = null }
  }, [canViewCost]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const sold = await fetchSoldQty30dForShops(effectiveShopIds)
      setSoldQtyByProduct(sold)
      setSoldQtyLoaded(true)
      writeSignalsCache(effectiveShopIds, { soldQtyByProduct: sold })
    } catch { /* idem */ }
    try {
      const expiredQty = await fetchExpiredQtyByProduct(supabase, effectiveShopIds)
      setExpiredQtyByProduct(expiredQty)
      writeSignalsCache(effectiveShopIds, { expiredQtyByProduct: expiredQty })
    } catch { /* idem */ }
    try {
      const reservedQty = await fetchReservedQtyByProduct(supabase, effectiveShopIds)
      setReservedQtyByProduct(reservedQty)
      writeSignalsCache(effectiveShopIds, { reservedQtyByProduct: reservedQty })
    } catch { /* idem */ }
    try {
      const incoming = await fetchStockPipeline(effectiveShopIds)
      setPipeline(incoming)
      writeSignalsCache(effectiveShopIds, { pipeline: incoming })
    } catch { /* idem */ }
  }

  // Stock à venir d'un produit : null = pas encore connu ou non visible pour ce rôle (jamais confondu avec zéro)
  const pipelineFor = (p: Product) => ({
    inTransit: !pipeline || pipeline.visible?.inTransit === false ? null : pipeline.byProduct[p.id]?.inTransit ?? 0,
    onOrder: !pipeline || pipeline.visible?.onOrder === false ? null : pipeline.byProduct[p.id]?.onOrder ?? 0,
  })

  const loadProductBatches = async (product: Product, quiet = false) => {
    // quiet : relecture après une action, sans vider la liste affichée
    if (!quiet) { setProductBatches([]); setLoadingBatches(true) }
    try {
      const { data } = await supabase
        .from('product_batches')
        .select('id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at, created_at, updated_at, promo_price, promo_until, promo_start')
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
  const openProductDetail = (product: Product, section: ProductDetailSection = 'top') => {
    setDetailSection(section)
    setBatchesProduct(product)
    loadProductBatches(product)
  }
  // Icône « Lots » : la fiche, ouverte directement sur ses lots
  const openProductBatches = (product: Product) => openProductDetail(product, 'batches')
  // Après une action (réassort, lot corrigé, promo…) : la fiche ouverte relit ses lots et ses chiffres
  const refreshProductDetail = () => {
    if (!batchesProduct) return
    loadProductBatches(batchesProduct, true)
    setDetailRefreshKey(k => k + 1)
  }

  useEffect(() => { fetchProducts() }, [effectiveShopIds.join(',')])
  // La liste vient d'être relue (réassort, modification, retour sur l'onglet) : la fiche ouverte suit
  useEffect(() => { refreshProductDetail() }, [products]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lien profond (Vue d'ensemble, tableau de bord…) : /stock/products?status=low
  // applique le filtre Statut puis nettoie l'URL, pour qu'un rechargement ne
  // réimpose pas le filtre par-dessus un choix fait entre-temps.
  useEffect(() => {
    const s = searchParams.get('status')
    if (!s) return
    if (s === 'all') setFilter({ statuses: [] })
    else if ([...STATUS_ORDER, 'archived'].includes(s)) setFilter({ statuses: [s] })
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

  // Date métier de la boutique DU produit (shops.timezone, migration 178) — règle commune lib/stock/sellable ;
  // seuil par catégorie (catégorie.expiry_alert_days) si défini, sinon le réglage de la boutique (lib/utils/expiry.ts).
  const todayOf = (p: Product) => shopToday(shopById[p.shop_id] ?? shop)
  const getExpiryCutoffFor = (p: Product) => {
    const cat = categories.find(c => c.id === p.category_id)
    const alertDays = getExpiryAlertDays(cat?.expiry_alert_days, shopById[p.shop_id]?.expiry_alert_days ?? shop?.expiry_alert_days)
    return addDays(todayOf(p), alertDays)
  }
  const isExpired = (p: Product) => { const exp = expiryByProduct[p.id]; return !!exp && exp < todayOf(p) }
  const isExpiringSoon = (p: Product) => { const exp = expiryByProduct[p.id]; return !!exp && exp >= todayOf(p) && exp <= getExpiryCutoffFor(p) }
  const isDormant = (p: Product) => soldQtyLoaded && p.quantity > 0 && !(soldQtyByProduct[p.id] > 0)
  // Niveau de stock jugé sur le disponible (vendable − réservé ; expiredQtyByProduct = part NON VENDABLE) — lib/stock/signals
  const levelOf = (p: Product) => stockLevelOf(p, { shopRules: shopRulesOf(userShops), shopLowStockThreshold: shop?.low_stock_threshold, expiredQtyByProduct, reservedQtyByProduct })
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
      const daysLeft = Math.round((new Date(exp).getTime() - new Date(todayOf(p)).getTime()) / 86_400_000)
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
      if (noSku && p.sku) return false
      if (noImage && p.image_url) return false
      // OU à l'intérieur de chaque filtre, ET entre les filtres ; toujours par identifiant
      if (!matchesAny(supplierFilter, v => p.supplier_id === v)) return false
      if (!matchesAny(categoryFilter, v => (v === 'uncategorized' ? !p.category_id : p.category_id === v))) return false
      // Statuts : chacun garde sa propre règle. En stock / faible / rupture = niveau (un seul par produit) ;
      // péremption, ventes lentes, promo = conditions calculées qui peuvent se cumuler. Archivé est une
      // autre liste (produits désactivés), jamais combinée avec les autres.
      const level = levelOf(p)
      if (!matchesAny(statusFilter, v => {
        if (v === 'ok' || v === 'low' || v === 'out') return level === v
        if (v === 'expiry') return isExpired(p) || isExpiringSoon(p)
        if (v === 'dormant') return isDormant(p)
        if (v === 'promo') return isPromoActive(p)
        return false
      })) return false
      return true
    })


  const saveProduct = async (data: ProductFormData): Promise<true | false | ProductFieldError> => {
    const target = createShop
    if (!target) { toast({ title: t('toast.no_active_shop'), variant: 'destructive' }); return false }
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Boutique choisie pour cette création (en-tête, ou choix explicite en « Toutes les boutiques »)
          shop_id: target.id,
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
          // Date du LOT initial créé avec le stock (jamais enregistrée sur le produit)
          expiry_date: Number(data.quantity) > 0 && data.expiry_date ? data.expiry_date : null,
        }),
      }))
      const json = await res.json()
      if (!res.ok) {
        if (json.field === 'sku' && json.error) return { field: 'sku', message: json.error }
        toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return false
      }
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
    if (ok !== true) return ok
    emitOnboarding('product_created') // tour guidé « Ajouter un produit »
    toast({ title: t('toast.product_added'), variant: 'success' })
    setShowAddModal(false)
    setSessionAddCount(0)
  }

  const onSaveAndAdd = async (data: ProductFormData) => {
    const ok = await saveProduct(data)
    if (ok !== true) return ok
    emitOnboarding('product_created')
    setSessionAddCount(c => c + 1)
    setAddFormKey(k => k + 1)
    toast({ title: t('toast.product_added'), variant: 'success' })
  }

  const onEditProduct = async (data: ProductFormData): Promise<void | ProductFieldError> => {
    if (!editingProduct) return
    // Seulement ce qui a changé : ajouter une photo ne touche que la photo (une ancienne
    // valeur imparfaite d'un autre champ ne bloque plus l'enregistrement), et un champ
    // masqué (prix d'achat pour un caissier) n'est jamais renvoyé.
    const p = editingProduct
    const next: Record<string, unknown> = {
      name: data.name, category_id: data.category_id || null, supplier_id: data.supplier_id || null,
      buying_price: data.buying_price ?? 0, selling_price: data.selling_price, unit: data.unit || 'piece',
      low_stock_threshold: data.low_stock_threshold || null, sku: data.sku?.trim() || null, image_url: data.image_url || null,
    }
    const prev: Record<string, unknown> = {
      name: p.name, category_id: p.category_id || null, supplier_id: p.supplier_id || null,
      buying_price: p.buying_price ?? 0, selling_price: p.selling_price, unit: p.unit || 'piece',
      low_stock_threshold: p.low_stock_threshold || null, sku: p.sku?.trim() || null, image_url: p.image_url || null,
    }
    const NUMERIC = ['buying_price', 'selling_price', 'low_stock_threshold']
    const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) =>
      NUMERIC.includes(k) ? (v === null ? null : Number(v)) !== (prev[k] === null ? null : Number(prev[k])) : v !== prev[k]))
    if (Object.keys(changes).length === 0) { setEditingProduct(null); return }
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, shop_id: p.shop_id, ...changes }),
      }))
      const json = await res.json()
      if (!res.ok) {
        if (json.field === 'sku' && json.error) return { field: 'sku', message: json.error }
        toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return
      }
      toast({ title: t('toast.product_updated'), variant: 'success' })
      setEditingProduct(null)
      fetchProducts()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Réapprovisionner : fournisseur habituel du produit proposé d'office (s'il existe encore dans sa boutique)
  const restockDefaults = (p: Product): RestockFormData => {
    const usual = (p as any).supplier_id && suppliers.some(s => s.id === (p as any).supplier_id && s.shop_id === p.shop_id) ? (p as any).supplier_id as string : undefined
    return { product_id: p.id, quantity: 1, ...(usual ? { supplier_id: usual } : {}) } as RestockFormData
  }

  const onRestock = async (data: RestockFormData) => {
    if (!restockProduct || !shop?.id) return
    if (!(await pastExpiry.confirm([data.expiry_date]))) return
    setSaving(true)

    // Offline path — save to IndexedDB and update local cache optimistically
    if (!navigator.onLine) {
      const localId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await savePendingMovement({
        local_id: localId,
        shop_id: restockProduct.shop_id,
        product_id: restockProduct.id,
        product_name: restockProduct.name,
        current_quantity: restockProduct.quantity,
        quantity_to_add: data.quantity,
        supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
        supplier_id: data.supplier_id || null,
        // Jamais de prix d'achat sur l'appareil : le serveur prend le coût déjà connu à la synchronisation
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
          // La boutique DU produit (en « Toutes les boutiques », elle peut différer de la boutique active)
          shop_id: restockProduct.shop_id,
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
            body: JSON.stringify({ id: promoBatch.id, shop_id: promoBatch.shop_id, promo_price: price, promo_until: until, promo_start: start }),
          }))
        : await withTimeout(fetch('/api/products', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: promoProduct.id,
              shop_id: promoProduct.shop_id,
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
      refreshProductDetail()
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
            body: JSON.stringify({ id: promoBatch.id, shop_id: promoBatch.shop_id, promo_price: null, promo_until: null, promo_start: null }),
          }))
        : await withTimeout(fetch('/api/products', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: promoProduct.id, shop_id: promoProduct.shop_id, promo_price: null, promo_until: null, promo_start: null, promo_reason: null }),
          }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setPromoProduct(null)
      setPromoBatch(null)
      setPromoSuggestionReason(null)
      setPromoSuggestionKey(null)
      fetchProducts()
      refreshProductDetail()
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSavingPromo(false)
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
        // Produit avec historique : archivé pour garder la traçabilité, pas supprimé (179)
        const json = await res.json().catch(() => ({}))
        toast({ title: json.archived ? t('products.archived_history_toast') : t('toast.product_deleted'), variant: 'success' })
        setDeleteConfirmProduct(null)
        fetchProducts()
      }
    } catch (err: any) {
      toast({ title: err.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  // Export : mêmes colonnes que le modèle d'import (fichier réimportable), puis catégorie et statut
  const productsExport = useTableExport()
  const exportProducts = (format: 'xlsx' | 'csv') => {
    const col = (f: string) => t(`import.xlsx.col.${f}.header` as any)
    const unitLabel = (u: string) => (PRODUCT_UNITS as readonly string[]).includes(u) ? t(`import.xlsx.units.${u}` as any) : u
    productsExport.run({
      kind: productsExport.kind('products'),
      shopName: shop?.name || 'StockShop',
      columns: [
        { header: col('name') }, { header: `${col('selling_price')} (${currencySymbol})`, type: 'money' }, { header: `${col('buying_price')} (${currencySymbol})`, type: 'money' },
        { header: col('quantity'), type: 'int' }, { header: col('unit') }, { header: col('sku') }, { header: col('low_stock_threshold'), type: 'int' },
        { header: t('exports.col_category') }, { header: t('exports.col_status') },
      ],
      rows: filtered.map(p => {
        const threshold = p.low_stock_threshold || shopById[p.shop_id]?.low_stock_threshold || shop?.low_stock_threshold || 10
        const level = levelOf(p)
        const status = level === 'out' ? t('status.out_of_stock') : level === 'low' ? t('status.low_stock') : t('status.in_stock')
        return [p.name, p.selling_price, p.buying_price, p.quantity, unitLabel(p.unit || 'piece'), p.sku || '', p.low_stock_threshold ?? '', (p as any).categories?.name || '', status]
      }),
    }, format)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)))
    }
  }

  // Sélection répartie par boutique DU PRODUIT : en « Toutes les boutiques », une sélection peut mêler
  // plusieurs boutiques ; chaque boutique reçoit sa propre requête (avec ses propres droits), jamais la
  // boutique active cachée
  const selectionByShop = () => {
    const by = new Map<string, string[]>()
    for (const id of Array.from(selectedIds)) {
      const p = products.find(x => x.id === id)
      if (!p?.shop_id) continue
      by.set(p.shop_id, [...(by.get(p.shop_id) ?? []), id])
    }
    return Array.from(by.entries()).map(([shopId, ids]) => ({ shopId, ids }))
  }

  const bulkDelete = async () => {
    const isAll = bulkDeleteAll
    // « Tout supprimer » : seulement quand l'en-tête est sur UNE boutique (le bouton n'est pas proposé sinon)
    if (isAll && effectiveShopIds.length !== 1) return
    // Pour « tout supprimer », le mot de confirmation est exigé par la ConfirmModal
    setBulkDeleting(true)
    const payloads = isAll
      ? [{ shop_id: effectiveShopIds[0], all: true }]
      : selectionByShop().map(g => ({ shop_id: g.shopId, ids: g.ids }))
    let count = 0, archivedCount = 0
    let failure: string | null = null
    for (const payload of payloads) {
      try {
        const res = await withTimeout(fetch('/api/products', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }), 30_000) // bulk/all delete can legitimately take longer on a large catalog
        const json = await res.json()
        if (!res.ok) { failure = json.error || t('toast.error'); continue }
        count += json.deleted ?? 0
        archivedCount += json.archived ?? 0
      } catch (err: any) {
        failure = err.message || t('toast.error')
      }
    }
    setBulkDeleting(false)
    if (failure) toast({ title: failure, variant: 'destructive' })
    if (failure && count === 0 && archivedCount === 0) { fetchProducts(); return }
    toast({
      title: isAll ? t('products.all_deleted_toast') : t('products.bulk_deleted_toast', { count }),
      // Produits avec historique : archivés pour garder la traçabilité (179)
      description: archivedCount ? t('products.bulk_archived_history', { count: archivedCount }) : undefined,
      variant: 'success',
    })
    setBulkDeleteDialog(false)
    setBulkDeleteAll(false)
    setSelectedIds(new Set())
    setSelectionMode(false)
    fetchProducts()
  }

  // Une catégorie appartient à UNE boutique : l'attribution groupée n'est possible que pour des produits
  // d'une même boutique (le panneau l'explique sinon), avec les catégories de cette boutique
  const bulkCategoryShops = selectionByShop()
  const bulkCategoryShopId = bulkCategoryShops.length === 1 ? bulkCategoryShops[0].shopId : null
  const bulkAssignCategory = async () => {
    if (!bulkCategoryShopId || selectedIds.size === 0) return
    setBulkAssigningCategory(true)
    try {
      const res = await withTimeout(fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: bulkCategoryShopId, ids: Array.from(selectedIds), category_id: bulkCategoryId }),
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
    if (selectedIds.size === 0) return
    const pct = Number(bulkPromoPercent)
    if (!pct || pct <= 0 || pct >= 100 || !bulkPromoUntil) {
      toast({ title: t('products.promo_invalid'), variant: 'destructive' })
      return
    }
    setBulkApplyingPromo(true)
    try {
      const until = new Date(`${bulkPromoUntil}T23:59:59`).toISOString()
      const start = bulkPromoStart ? new Date(`${bulkPromoStart}T00:00:00`).toISOString() : null
      // Une requête par boutique des produits choisis (jamais la boutique active cachée)
      let updated = 0
      let failure: string | null = null
      for (const group of selectionByShop()) {
        const items = group.ids
          .map(id => products.find(p => p.id === id))
          .filter((p): p is Product => !!p)
          .map(p => ({ id: p.id, promo_price: Math.max(1, Math.round(p.selling_price * (1 - pct / 100))) }))
        const res = await withTimeout(fetch('/api/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop_id: group.shopId, items, promo_until: until, promo_start: start, percent: pct }),
        }), 30_000)
        const json = await res.json()
        if (!res.ok) { failure = json.error || t('toast.error'); continue }
        updated += json.updated ?? items.length
      }
      if (failure) toast({ title: failure, variant: 'destructive' })
      if (failure && updated === 0) return
      toast({ title: t('products.bulk_promo_applied_toast', { count: updated }), variant: 'success' })
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
    const threshold = product.low_stock_threshold || shopById[product.shop_id]?.low_stock_threshold || shop?.low_stock_threshold || 10
    // Disponible = vendable − réservé (expiredQtyByProduct = part non vendable, lib/stock/signals)
    const cardExpired = Math.min(product.quantity, expiredQtyByProduct[product.id] || 0)
    const cardReserved = reservedQtyByProduct[product.id] || 0
    const cardAvailable = availableQty(product.quantity, cardExpired, cardReserved)
    const isSelected = selectedIds.has(product.id)
    const promoActive = isPromoActive(product)
    const expiry = expiryByProduct[product.id]
    const expired = expiry ? expiry < todayOf(product) : false
    const expiringSoonBadge = expiry && !expired ? expiry <= getExpiryCutoffFor(product) : false
    return (
      <div
        key={product.id}
        // Apparition en CSS (tailwindcss-animate) : framer-motion n'est plus
        // chargé pour cette page, 113 Ko de JavaScript en moins à l'ouverture
        // Toute la carte ouvre la fiche (grande zone tactile) ; ses boutons ne font que leur action
        data-product-card={product.id}
        className={`animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards rounded-lg border bg-card shadow-sm p-4 space-y-2 transition-colors cursor-pointer ${
          selectionMode ? 'select-none' : 'active:bg-muted/50 sm:hover:border-stockshop-blue/40 sm:hover:shadow-md focus-within:border-stockshop-blue/40'
        } ${isSelected ? 'border-stockshop-blue/60 dark:border-blue-500 bg-stockshop-blue-muted/60 dark:bg-blue-950/25' : ''}`}
        style={{
          animationDelay: `${Math.min(idx, 20) * 20}ms`,
          ...(!isSelected && product.categories?.color ? { borderTopColor: product.categories.color, borderTopWidth: 3 } : {}),
        }}
        onClick={selectionMode ? () => setSelectedIds(prev => {
          const next = new Set(prev)
          next.has(product.id) ? next.delete(product.id) : next.add(product.id)
          return next
        }) : e => { if (isNeutralClick(e)) openProductDetail(product) }}
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
            {selectionMode ? (
              <ProductThumbnail src={product.image_url} alt={product.name} className="h-10 w-10" />
            ) : (
              <button type="button" onClick={() => openProductDetail(product)} className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('product_detail.open', { name: product.name })}>
                <ProductThumbnail src={product.image_url} alt="" className="h-10 w-10" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              {selectionMode ? (
                <p className="font-medium text-sm truncate">{product.name}</p>
              ) : (
                <button type="button" onClick={() => openProductDetail(product)} data-product-name className="block max-w-full truncate rounded text-left text-sm font-medium hover:text-stockshop-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-400">{product.name}</button>
              )}
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
                    {t('products.expiring_badge', { date: new Date(expiry!).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short' }) })}
                  </button>
                )}
              </div>
            </div>
          </div>
          <StockBadge quantity={cardAvailable} threshold={threshold} />
        </div>
        {/* Prix à gauche, disponible à droite : l'état du produit se lit sur une ligne */}
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {promoActive ? (
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.promo_price!)}</span>
              <span className="text-xs text-muted-foreground line-through">{formatNaira(product.selling_price)}</span>
            </span>
          ) : (
            <span className="font-bold text-stockshop-blue dark:text-blue-400">{formatNaira(product.selling_price)}</span>
          )}
          <span className="whitespace-nowrap" data-card-qty>
            <span className={`font-bold ${cardAvailable === 0 ? 'text-red-500' : cardAvailable <= threshold ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
              {cardAvailable}
            </span>{' '}
            <span className="text-muted-foreground text-xs">{unitLabelFor(product.unit, cardAvailable)}</span>
          </span>
        </div>
        {/* Précisions de stock : seulement quand il y en a (périmés, réservés, à venir) */}
        {(() => {
          const inc = pipelineFor(product)
          if (!cardExpired && !cardReserved && !inc.inTransit && !inc.onOrder) return null
          return (
            <p className="flex flex-wrap justify-end gap-x-2 text-xs font-medium" data-card-notes>
              {cardExpired > 0 && <span className="text-red-600 dark:text-red-400" title={t('products.expired_qty_hint')}>{t('products.expired_qty', { count: cardExpired })}</span>}
              {cardReserved > 0 && <span className="text-stockshop-blue dark:text-blue-400" title={t('products.reserved_hint')}>{t('products.reserved_qty', { count: cardReserved })}</span>}
              {!!inc.inTransit && <span className="text-stockshop-blue dark:text-blue-400" title={t('products.in_transit_hint')}>{t('products.incoming_transit', { count: inc.inTransit })}</span>}
              {!!inc.onOrder && <span className="text-stockshop-blue dark:text-blue-400" title={t('products.on_order_hint')}>{t('products.incoming_order', { count: inc.onOrder })}</span>}
            </p>
          )
        })()}
        {/* Dernière ligne, seulement si elle a un contenu : le coût (droit de voir les coûts) et les actions.
            UNE action visible — Réapprovisionner ; les autres sont dans « … » et dans la fiche du produit. */}
        {(() => {
          const showCost = canViewCost && product.buying_price != null
          const low = cardAvailable <= threshold
          const hasActions = !selectionMode && (canWriteStock || fullStock || (canOrderStock && low))
          if (!showCost && !hasActions) return null
          return (
            <div className="flex items-center justify-between gap-2" data-card-footer>
              {showCost ? <span className="min-w-0 truncate text-xs text-muted-foreground" data-card-cost>{t('products.cost_label')}: {formatNaira(product.buying_price!)}</span> : <span />}
              {hasActions && (
                <div className="flex shrink-0 items-center gap-1">
                  {canWriteStock && (
                    <Button
                      variant="outline" size="sm" className="h-8 px-2.5 text-xs"
                      disabled={saving}
                      data-card-restock
                      onClick={() => { setEditingProduct(null); setShowAddModal(false); setRestockProduct(product); restockForm.reset(restockDefaults(product)); setShowRestockModal(true) }}
                    >
                      <ArrowDown className="h-3.5 w-3.5 mr-1" />
                      {t('actions.restock')}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" disabled={saving} title={t('products.more_actions')} data-card-menu>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">{t('products.more_actions')}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      {canOrderStock && low && (
                        <DropdownMenuItem onClick={() => { const href = `/${locale}/stock/replenishment?product=${product.id}`; startNavigationProgress(href); router.push(href) }}>
                          <ShoppingCart className="mr-2 h-4 w-4" /> {t('actions.order')}
                        </DropdownMenuItem>
                      )}
                      {canWriteStock && (
                        <DropdownMenuItem onClick={() => { setShowAddModal(false); setShowRestockModal(false); setEditingProduct(product) }}>
                          <Edit2 className="mr-2 h-4 w-4" /> {t('actions.edit')}
                        </DropdownMenuItem>
                      )}
                      {canWriteStock && (
                        <DropdownMenuItem onClick={() => openPromoDialog(product)} data-card-promo>
                          <Tag className="mr-2 h-4 w-4" /> {t('products.promo_action')}
                          {!promoActive && suggestPromo(product) && <span className="ml-auto pl-3 text-[11px] font-medium text-amber-600 dark:text-amber-400" data-promo-suggested>{t('products.promo_suggested_tag')}</span>}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => openProductBatches(product)}>
                        <History className="mr-2 h-4 w-4" /> {t('products.view_batches')}
                      </DropdownMenuItem>
                      {fullStock && (
                        <DropdownMenuItem onClick={() => setArchiveConfirmProduct(product)} className="text-amber-700 focus:text-amber-700 dark:text-amber-400 dark:focus:text-amber-400">
                          <Archive className="mr-2 h-4 w-4" /> {t('products.archive_label')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          )
        })()}
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
    const draftShop = userShops.find(x => x.id === (draft as any).shopId) ?? null
    if (!draftShop) return
    setCreateShop(draftShop)
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
  const thresholdFor = (p: Product) => p.low_stock_threshold || shopById[p.shop_id]?.low_stock_threshold || shop?.low_stock_threshold || 10
  // Produit de la fiche, dans sa version la plus récente de la liste (nom, prix, quantité après une modification)
  const detailProduct = batchesProduct ? products.find(p => p.id === batchesProduct.id) ?? batchesProduct : null
  const detailStatusLabel: Record<ProductStatus, string> = { out: t('status.out_of_stock'), low: t('status.low_stock'), dormant: t('products.card_dormant'), ok: t('status.in_stock') }
  const tableProps = {
    thresholdFor,
    statusFor: (p: Product): ProductStatus =>
      levelOf(p) !== 'ok' ? (levelOf(p) as ProductStatus) : isDormant(p) ? 'dormant' : 'ok',
    soldQty: (p: Product) => (soldQtyLoaded ? soldQtyByProduct[p.id] || 0 : null),
    pipelineFor,
    expiredQty: (p: Product) => expiredQtyByProduct[p.id] || 0,
    reservedQty: (p: Product) => reservedQtyByProduct[p.id] || 0,
    expiryFor: (p: Product) => {
      const exp = expiryByProduct[p.id]
      if (!exp) return null
      const expired = exp < todayOf(p)
      return { date: exp, expired, soon: !expired && exp <= getExpiryCutoffFor(p) }
    },
    isPromoActive,
    promoStale,
    promoSuggestion: (p: Product) => (isPromoActive(p) ? null : suggestPromo(p)?.reason ?? null),
    formatPrice: formatNaira,
    fullRights: fullStock,
    canWriteStock,
    canOrderStock,
    busy: saving,
    selectedIds,
    onToggleSelect: toggleSelectOne,
    onToggleSelectMany: toggleSelectMany,
    sort: tableSort,
    onSortChange: setTableSort,
    // Colonnes financières (coût, valeur) : seulement avec le droit de voir les prix d'achat (canViewCost)
    columns: tableColumns.filter(k => canViewCost || !OPTIONAL_COLUMNS.find(c => c.key === k)?.fullRightsOnly),
    onOrder: (p: Product) => { const href = `/${locale}/stock/replenishment?product=${p.id}`; startNavigationProgress(href); router.push(href) },
    onRestock: (p: Product) => { setEditingProduct(null); setShowAddModal(false); setRestockProduct(p); restockForm.reset(restockDefaults(p)); setShowRestockModal(true) },
    onEdit: (p: Product) => { setShowAddModal(false); setShowRestockModal(false); setEditingProduct(p) },
    onPromo: openPromoDialog,
    onBatches: openProductBatches,
    onOpen: (p: Product) => openProductDetail(p),
    onArchive: (p: Product) => setArchiveConfirmProduct(p),
  }

  // Options des filtres. Une boutique dans l'en-tête : liste simple. « Toutes les boutiques » : un groupe
  // titré par boutique — deux « Alimentation » de deux boutiques restent deux options distinctes.
  const groupByShop = effectiveShopIds.length > 1
  const shopRefs = userShops.filter(s => effectiveShopIds.includes(s.id)).map(s => ({ id: s.id, name: s.name }))
  const uncategorizedCount = products.filter(p => !p.category_id).length
  const categoryGroups: FilterGroup[] = [
    ...(uncategorizedCount ? [{ id: 'none', options: [{ value: 'uncategorized', label: t('categories.uncategorized'), hint: String(uncategorizedCount) }] }] : []),
    ...shopScopedGroups(categories, { id: c => c.id, label: c => c.name, shopId: c => (c as any).shop_id, color: c => c.color }, shopRefs, groupByShop, locale),
  ]
  const supplierGroups = shopScopedGroups(
    suppliers.filter((s: any) => effectiveShopIds.includes(s.shop_id)),
    { id: s => s.id, label: s => s.name, shopId: s => (s as any).shop_id }, shopRefs, groupByShop, locale,
  )
  const statusLabels: Record<string, string> = {
    ok: t('status.in_stock'), low: t('status.low_stock'), out: t('status.out_of_stock'),
    expiry: t('products.card_expiry'), dormant: t('products.card_dormant'), promo: t('products.promo_badge'),
    archived: t('products.tab_archived'),
  }
  const statusGroups: FilterGroup[] = [{
    id: 'status',
    options: statusValues.map(v => ({ value: v, label: statusLabels[v], hint: v === 'archived' && archivedProducts.length ? String(archivedProducts.length) : undefined })),
  }]

  // Créer (fiche, ajout rapide) : la boutique de l'en-tête si elle en désigne une, sinon un choix explicite
  const startCreate = async (open: () => void) => {
    const target = await scope.requireOneShop({ title: t('products.pick_shop_title') })
    if (!target) return
    setCreateShop(target)
    open()
  }
  const openJournal = async () => {
    const target = await scope.requireOneShop({ title: t('products.pick_shop_journal') })
    if (!target) return
    setJournalShop(target)
    setJournalOpen(true)
  }
  const createShopLabel = multiShopAccount && createShop ? t('scope.shop_label', { name: createShop.name }) : undefined
  // Listes du formulaire de création : celles de la boutique de création
  const formShopId = createShop?.id ?? scope.shopId ?? undefined

  const productFormProps = {
    categories: categories.filter((c: any) => !formShopId || c.shop_id === formShopId),
    suppliers: suppliers.filter((s: any) => !formShopId || s.shop_id === formShopId),
    currency: currencySymbol,
    fullRights: canViewCostIn(formShopId),
    shopId: formShopId,
  }
  const resetAddForm = () => { setShowAddModal(false); setSessionAddCount(0); setAddFormState({ dirty: false, busy: false }) }

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.products')} description={t('page_header.stock_products')} />
      <>
      {/* Zone du haut, du plus important au moins important :
            1. la recherche et « Ajouter » (seule action pleine) ;
            2. les filtres courants (catégorie, statut), « Plus de filtres », et le menu « … » des actions
               occasionnelles (export, sélection, journal) ;
            3. le compteur, avec la bascule cartes / liste et les colonnes du tableau.
          Trois rangées sur téléphone, une ligne et demie sur ordinateur. La boutique n'est pas un filtre de cette
          page : c'est le sélecteur de l'en-tête. */}
      <div className="space-y-2" data-testid="products-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative order-1 min-w-0 flex-1 basis-40 xl:w-72 xl:flex-none xl:basis-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={narrow ? t('products.search_placeholder_short') : t('products.search_placeholder')} className="h-9 pl-9" aria-label={t('products.search_placeholder')} />
          </div>
          {canWriteStock && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="stockshop" size="sm" className="order-2 h-9 shrink-0 gap-1.5 xl:order-last" disabled={saving} data-tour="add-product-menu">
                  <Plus className="h-4 w-4" />
                  {t('products.add_menu')}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[230px]">
                <DropdownMenuItem data-tour="add-product-item" onClick={() => startCreate(() => { setEditingProduct(null); setShowRestockModal(false); setSessionAddCount(0); setAddFormKey(k => k + 1); setShowAddModal(true) })}>
                  <Plus className="mr-2 h-4 w-4" /> {t('actions.add_product')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => startCreate(() => setShowBulkModal(true))}><Zap className="mr-2 h-4 w-4" /> {t('products.add_quick')}</DropdownMenuItem>
                <DropdownMenuItem data-tour="add-product-import" onClick={() => setShowImportModal(true)}><Upload className="mr-2 h-4 w-4" /> {t('products.add_import')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="order-3 flex w-full basis-full items-center gap-1.5 sm:gap-2 xl:w-auto xl:flex-1 xl:basis-auto">
            {/* Choix multiples : « Catégorie » / « Alimentation » / « Catégorie · 2 » */}
            <MultiSelectFilter
              label={t('products.category')}
              allLabel={t('products.all_categories')}
              groups={categoryGroups}
              selected={categoryFilter}
              onChange={v => setFilter({ categoryIds: v })}
              className="flex-1 sm:w-auto sm:max-w-[240px] sm:flex-none sm:min-w-[150px]"
              testId="filter-category"
            />
            <MultiSelectFilter
              label={t('products.status_label')}
              allLabel={t('products.all_statuses')}
              groups={statusGroups}
              selected={statusFilter}
              onChange={v => setFilter({ statuses: v })}
              exclusive={['archived']}
              searchable={false}
              optionIcon={v => (v === 'archived' ? <Archive aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null)}
              className="flex-1 sm:w-auto sm:max-w-[220px] sm:flex-none sm:min-w-[140px]"
              testId="filter-status"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 px-2.5 sm:px-3" aria-label={t('products.more_filters')} title={t('products.more_filters')} data-testid="products-more-filters">
                  <SlidersHorizontal className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden sm:inline">{t('products.more_filters')}</span>
                  {extraFilterCount > 0 && (
                    <span className="rounded-full bg-stockshop-blue px-1.5 text-[11px] font-semibold leading-5 text-white">{extraFilterCount}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3">
                {/* Fournisseur : même liste à choix multiple, posée directement dans ce panneau
                    (pas de fenêtre ouverte dans une autre) ; groupée par boutique en « Toutes les boutiques » */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('products.filter_supplier')}</Label>
                  <MultiSelectList
                    label={t('products.filter_supplier')}
                    allLabel={t('products.all_suppliers')}
                    groups={supplierGroups}
                    selected={supplierFilter}
                    onToggle={v => setFilter({ supplierIds: toggleValue(supplierFilter, v) })}
                    onClear={() => setFilter({ supplierIds: [] })}
                    maxHeightClass="max-h-56"
                    testId="filter-supplier"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={noSku} onChange={e => setFilter({ noSku: e.target.checked })} />
                  {t('products.filter_no_sku')}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={noImage} onChange={e => setFilter({ noImage: e.target.checked })} />
                  {t('products.filter_no_image')}
                </label>
                {/* Vide en un geste les filtres de ce panneau (fournisseurs choisis, sans code, sans image) */}
                <div className="border-t pt-2">
                  <button
                    type="button"
                    onClick={() => setFilter({ supplierIds: [], noSku: false, noImage: false })}
                    disabled={extraFilterCount === 0}
                    className="h-12 rounded-md px-3 text-sm font-medium text-stockshop-blue hover:bg-muted disabled:opacity-40 dark:text-blue-400 sm:h-10"
                    data-testid="more-filters-reset"
                  >
                    {t('filters.reset')}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            {/* Actions occasionnelles : exports, sélection (cartes), journal d'activité (propriétaire) */}
            {(canWriteStock || fullStock || (viewMode === 'cards' && canSelectProducts && !selectionMode)) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 w-9 shrink-0 p-0 xl:ml-auto" title={t('products.more_actions')} data-testid="products-more-actions">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">{t('products.more_actions')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                  {canWriteStock && (
                    <>
                      <DropdownMenuItem onClick={() => exportProducts('xlsx')} data-testid="export-xlsx"><FileSpreadsheet className="mr-2 h-4 w-4" /> {t('exports.excel')}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportProducts('csv')} data-testid="export-csv"><FileDown className="mr-2 h-4 w-4" /> {t('exports.csv')}</DropdownMenuItem>
                    </>
                  )}
                  {viewMode === 'cards' && canSelectProducts && !selectionMode && (
                    <DropdownMenuItem onClick={() => setSelectionMode(true)}><CheckSquare className="mr-2 h-4 w-4" /> {t('products.select_action')}</DropdownMenuItem>
                  )}
                  {fullStock && (
                    <DropdownMenuItem onClick={openJournal}><History className="mr-2 h-4 w-4" /> {t('products.activity_journal')}</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Compteur à gauche ; à droite, ce qui règle l'affichage (jamais au premier plan) */}
        <div className="flex min-h-9 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {/* Pas de « 0 produit » trompeur tant que la liste se charge sans cache */}
            <span data-testid="products-count">{loading && products.length === 0 ? '…' : t('products.stats_count', { count: showArchived ? archivedProducts.length : filtered.length })}</span>
            {anyFilterActive && (
              <button type="button" onClick={resetFilters} className="text-xs underline hover:text-foreground">
                {t('products.reset_filters')}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Sélection en cours (cartes) : annulation visible en un geste */}
            {viewMode === 'cards' && selectionMode && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setSelectionMode(false); setSelectedIds(new Set()) }}>
                <Square className="h-3.5 w-3.5" /> {t('actions.cancel')}
              </Button>
            )}
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
                  {OPTIONAL_COLUMNS.filter(c => canViewCost || !c.fullRightsOnly).map(c => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60">
                      <input type="checkbox" className="h-4 w-4 rounded accent-stockshop-blue" checked={tableColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                      {t(c.labelKey as any)}
                    </label>
                  ))}
                  <p className="mt-2 border-t pt-2 text-xs leading-snug text-muted-foreground">{t('products.available_explain')}</p>
                  {tableColumns.length > 0 && (
                    <button type="button" onClick={() => setTableColumns([])} className="mt-2 text-xs text-muted-foreground underline hover:text-foreground">
                      {t('products.columns_default')}
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            )}
            {/* Cartes / tableau */}
            <div className="flex h-[50px] rounded-lg border bg-muted/30 p-0.5 sm:h-9" role="group" aria-label={t('products.view_label')}>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                aria-pressed={viewMode === 'cards'}
                title={t('products.view_cards')}
                className={`flex h-full w-11 items-center justify-center rounded-md transition-colors sm:w-8 ${viewMode === 'cards' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="sr-only">{t('products.view_cards')}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                title={t('products.view_table')}
                className={`flex h-full w-11 items-center justify-center rounded-md transition-colors sm:w-8 ${viewMode === 'table' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List className="h-4 w-4" />
                <span className="sr-only">{t('products.view_table')}</span>
              </button>
            </div>
          </div>
        </div>
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
          {canDeleteProducts && products.length > 0 && effectiveShopIds.length === 1 && (
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
      ) : products.length === 0 ? (
        <EmptyGuide icon={Package} title={t('onboarding.empty.products.title')} body={t('onboarding.empty.products.body')} tour={canWriteStock ? 'add_product' : undefined} />
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
                      {t('products.archived_on', { date: new Date((product as any).updated_at).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short', year: 'numeric' }) })}
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

      {/* Journal d'activité (panneau latéral, « Stock : modification ») */}
      <ProductActivityJournal
        open={journalOpen}
        onOpenChange={setJournalOpen}
        shopId={journalShop?.id}
        shopLabel={multiShopAccount && journalShop ? t('scope.shop_label', { name: journalShop.name }) : undefined}
        productExists={id => products.some(p => p.id === id)}
        onOpenProduct={id => {
          const p = products.find(x => x.id === id)
          if (!p) return false
          openProductDetail(p)
          return true
        }}
      />

      {/* Bulk Add Modal */}
      {createShop && (
        <BulkAddModal
          open={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          shopId={createShop.id}
          shopLabel={createShopLabel}
          currency={currencySymbol}
          fullRights={canViewCostIn(createShop.id)}
          onSaved={(count) => { fetchProducts() }}
        />
      )}

      {/* Import Products Modal */}
      {shop?.id && (
        <ImportProductsModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          shopId={shop.id}
          // Le panneau reste ouvert sur le bilan (importés, déjà en stock, à corriger) ; la liste se met à jour derrière
          onImported={() => { fetchProducts() }}
        />
      )}

      {/* Panneau « Ajouter un produit » : formulaire en sections, pied fixe
          (Annuler · Enregistrer et ajouter un autre · Enregistrer), garde de
          fermeture tant que la saisie n'est pas enregistrée */}
      <FormDrawer
        open={showAddModal}
        onOpenChange={open => { if (!open) resetAddForm() }}
        category={createShopLabel}
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
          // Modification : catégories et fournisseurs de la boutique DU produit (en « Toutes les boutiques »,
          // elle peut différer de la boutique active) — le serveur refuse ceux d'une autre boutique
          <ProductForm key={editingProduct.id} {...productFormProps} isEdit productId={editingProduct.id}
            categories={categories.filter((c: any) => c.shop_id === editingProduct.shop_id)}
            suppliers={suppliers.filter((s: any) => s.shop_id === editingProduct.shop_id)}
            shopId={editingProduct.shop_id}
            fullRights={canViewCostIn(editingProduct.shop_id)}
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
        {multiShopAccount && deleteConfirmProduct && (
          <p className="text-sm font-medium" data-testid="delete-product-shop">{t('scope.shop_label', { name: shopById[deleteConfirmProduct.shop_id]?.name ?? '' })}</p>
        )}
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
      <PremiumDialog open={showRestockModal} onOpenChange={setShowRestockModal} category={multiShopAccount && restockProduct ? `${t('products.restock_title')} · ${shopById[restockProduct.shop_id]?.name ?? ''}` : t('products.restock_title')} title={restockProduct?.name || ''} icon={<ArrowDown className="h-4 w-4" />} dirty={restockForm.formState.isDirty}>
        <form onSubmit={restockForm.handleSubmit(onRestock)}>
          <PremiumDialogBody>
            <input type="hidden" {...restockForm.register('product_id')} />
            <div className="space-y-1.5">
              <Label>{t('products.quantity_to_add')} *</Label>
              <Input type="number" min={1} {...restockForm.register('quantity')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('products.supplier')}</Label>
              <Select value={restockForm.watch('supplier_id') || undefined} onValueChange={v => restockForm.setValue('supplier_id', v, { shouldDirty: true })}>
                <SelectTrigger data-testid="restock-supplier"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                {/* Seulement les fournisseurs de la boutique du produit — même en « Toutes les boutiques » */}
                <SelectContent>{suppliers.filter(s => s.shop_id === restockProduct?.shop_id).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Prix d'achat : avec le droit au coût, et en ligne seulement (aucun coût n'est gardé sur l'appareil) */}
            {canViewCostIn(restockProduct?.shop_id) && isOnline && (
              <div className="space-y-1.5">
                <Label>{t('products.restock_buying_price')}</Label>
                <Input type="number" {...restockForm.register('buying_price')} placeholder={String(restockProduct?.buying_price)} />
              </div>
            )}
            {/* Chaque réassort crée un NOUVEAU lot, avec sa propre date (facultative) */}
            <ExpiryDateField id="restock-expiry-date" value={restockForm.watch('expiry_date')} onChange={v => restockForm.setValue('expiry_date', v, { shouldDirty: true })} />
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
        dirty={!!promoProduct && !!promoInitial && JSON.stringify([promoPrice, promoUntil, promoStart]) !== promoInitial}
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
                      ? new Date(promoBatch.expiry_date).toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short' })
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

      {/* Fiche produit : quantités, réservations, lots, ventes, mouvements, achat. Les lots n'ont qu'UNE
          implémentation (section de la fiche) ; leurs actions ouvrent les petites fenêtres ci-dessous. */}
      <ProductDetailDrawer
        product={detailProduct}
        shopName={multiShopAccount && detailProduct ? shopById[detailProduct.shop_id]?.name : undefined}
        onClose={() => setBatchesProduct(null)}
        section={detailSection}
        refreshKey={detailRefreshKey}
        fallbackQuantities={detailProduct ? stockQuantities({
          physical: detailProduct.quantity,
          expired: expiredQtyByProduct[detailProduct.id],
          reserved: reservedQtyByProduct[detailProduct.id],
          inTransit: pipelineFor(detailProduct).inTransit,
          onOrder: pipelineFor(detailProduct).onOrder,
        }) : null}
        status={detailProduct ? tableProps.statusFor(detailProduct) : 'ok'}
        statusLabels={detailStatusLabel}
        promoActive={!!detailProduct && isPromoActive(detailProduct)}
        promoSuggestion={detailProduct && canWriteStock && !isPromoActive(detailProduct) ? suggestPromo(detailProduct)?.reason ?? null : null}
        formatPrice={formatNaira}
        batches={{
          batches: productBatches,
          loading: loadingBatches,
          canWrite: canWriteStock,
          onAdjust: b => setAdjustBatch(b),
          onPromo: b => {
            setPromoProduct(batchesProduct)
            setPromoBatch(b)
            setPromoInputMode('price')
            setPromoPrice(b.promo_price ? String(b.promo_price) : '')
            setPromoUntil(b.promo_until ? b.promo_until.slice(0, 10) : '')
            setPromoStart(b.promo_start ? b.promo_start.slice(0, 10) : '')
            setPromoSuggestionReason(null)
            setPromoSuggestionKey(null)
          },
          onDelete: b => setDeleteBatchConfirm(b),
          onEditExpiry: b => setExpiryBatch(b),
        }}
        actions={{
          // Mêmes fenêtres et mêmes routes que la liste ; chaque action n'est proposée qu'à qui peut la faire
          onRestock: canWriteStock ? tableProps.onRestock : undefined,
          onEdit: canWriteStock ? tableProps.onEdit : undefined,
          onPromo: canWriteStock ? openPromoDialog : undefined,
          onOrder: canOrderStock && detailProduct && levelOf(detailProduct) !== 'ok' ? tableProps.onOrder : undefined,
          onArchive: fullStock ? (p: Product) => { setBatchesProduct(null); setArchiveConfirmProduct(p) } : undefined,
        }}
        onChanged={fetchStockSignals}
      />

      {/* Fenêtres de lot COMMUNES avec Stock › Lots (batch-dialogs) : date, quantité, retrait — mêmes routes,
          note et motifs de l'historique des lots dès que la migration 179 est présente */}
      <BatchExpiryDialog batch={expiryBatch} onClose={() => setExpiryBatch(null)} onSaved={() => { fetchStockSignals(); refreshProductDetail() }} />
      {pastExpiry.dialog}
      <BatchAdjustDialog batch={adjustBatch} onClose={() => setAdjustBatch(null)} onSaved={() => { fetchProducts(); fetchStockSignals(); refreshProductDetail() }} />
      <BatchRemoveConfirm batch={deleteBatchConfirm} onClose={() => setDeleteBatchConfirm(null)} onSaved={() => { fetchProducts(); fetchStockSignals(); refreshProductDetail() }} />
      {/* Bulk category assignment dialog */}
      <PremiumDialog
        open={bulkCategoryDialog}
        onOpenChange={open => { if (!open) { setBulkCategoryDialog(false); setBulkCategoryId(null) } }}
        title={t('products.assign_category_title', { count: selectedIds.size })}
        icon={<Settings2 className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          {!bulkCategoryShopId ? (
            <p className="text-sm text-muted-foreground" data-testid="bulk-category-one-shop">{t('products.bulk_category_one_shop')}</p>
          ) : (
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
            {categories.filter(c => c.shop_id === bulkCategoryShopId).map(c => (
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
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => { setBulkCategoryDialog(false); setBulkCategoryId(null) }}
          cancelLabel={t('actions.cancel')}
          onConfirm={bulkAssignCategory}
          confirmLabel={bulkAssigningCategory ? t('payment.saving') : t('actions.save')}
          confirmLoading={bulkAssigningCategory}
          confirmDisabled={!bulkCategoryShopId}
        />
      </PremiumDialog>

      {/* Bulk promo dialog */}
      <PremiumDialog
        open={bulkPromoDialog}
        dirty={bulkPromoDialog && !!(bulkPromoPercent || bulkPromoUntil || bulkPromoStart)}
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
              {canWrite('categories') && (
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
