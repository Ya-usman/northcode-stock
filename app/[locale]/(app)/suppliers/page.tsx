'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations, useLocale } from 'next-intl'
import dynamic from 'next/dynamic'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Package, Store, ChevronDown, ChevronRight, X, ArrowRightLeft, FileText, Download, Send, CheckCircle2, Ban, Mail, Copy, Share2, History, RotateCcw, ShoppingCart, MessageCircle, Save, Clock, AlertTriangle, Banknote, TrendingDown, FileDown, FileSpreadsheet, Table2, Upload } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useTableExport } from '@/lib/export/use-table-export'
import { isCapacitor } from '@/lib/utils/native-share'
import { shareViaWhatsApp, normalizeWhatsAppNumber } from '@/lib/utils/whatsapp'
import { getCountry } from '@/lib/saas/countries'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatInputValue } from '@/lib/utils/currency'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter, FOOTER_PRIMARY_CLASS, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { InputGroup, RequiredMark } from '@/components/ui/input-group'
import { SupplierSheet, PO_STATUS_STYLES, poTotalOf } from '@/components/suppliers/supplier-sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSupplierSchema, type SupplierFormData } from '@/lib/validations/customer'

// Champ téléphone international (indicatif dans une liste) : chargé à l'usage
// Import Excel / CSV : chargé à l'ouverture (ExcelJS n'alourdit pas la page)
const ImportDrawer = dynamic(() => import('@/components/import/import-drawer').then(m => ({ default: m.ImportDrawer })), { ssr: false })
const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => ({ default: m.PhoneInput })), {
  ssr: false,
  loading: () => <div className="h-10 w-full animate-pulse rounded-md border border-input bg-muted/40" />,
})
import type { Supplier, Product, PurchaseOrder } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { generatePurchaseOrderPDF } from '@/lib/utils/pdf'
import { withTimeout } from '@/lib/utils/with-timeout'

// Carte d'un fournisseur : un clic ouvre la fiche en panneau latéral ;
// crayon et corbeille restent accessibles directement. Le solde dû est
// visible sur la carte, comme pour les clients.
function SupplierCard({ supplier, productCount, canManage, onOpen, onEdit, onDelete, t, fmt }: {
  supplier: Supplier; productCount: number; canManage: boolean
  onOpen: (s: Supplier) => void; onEdit: (s: Supplier) => void; onDelete: (s: Supplier) => void
  t: (key: any, values?: any) => string; fmt: (n: number) => string
}) {
  const owed = Number(supplier.total_owed || 0)
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden" data-testid="supplier-card">
      <div className="flex items-center gap-2 p-4">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpen(supplier)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{supplier.name}</p>
            {owed > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                {t('suppliers.owed_badge', { amount: fmt(owed) })}
              </span>
            )}
          </div>
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
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {canManage && (
            <>
              <button
                type="button"
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
                title={t('suppliers.edit_supplier')}
                aria-label={t('suppliers.edit_supplier')}
                onClick={() => onEdit(supplier)}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                title={t('actions.delete')}
                aria-label={t('actions.delete')}
                onClick={() => onDelete(supplier)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button type="button" className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:bg-accent" aria-label={t('actions.view')} onClick={() => onOpen(supplier)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersPage() {
  const t = useTranslations()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { profile, shop, roleInActiveShop, effectiveShopIds, userShops } = useAuth()
  const { isOnline } = useOffline()
  const { fmt, symbol } = useCurrency()
  const suppliersExport = useTableExport()
  const [showImport, setShowImport] = useState(false)
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient() as any
  const { toast } = useToast()

  const effectiveRole = roleInActiveShop ?? profile?.role
  // Règle unique : niveau « modification » de Fournisseurs (fiches, prix,
  // bons de commande) — même règle que les routes /api/suppliers et /api/purchase-orders
  const { canWrite } = useRolePermissions()
  const canManage = canWrite('suppliers')

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
  // Fiche fournisseur (panneau latéral) et suppression (confirmation commune)
  const [sheetSupplier, setSheetSupplier] = useState<Supplier | null>(null)
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState<Supplier | null>(null)
  const [deletingSupplier, setDeletingSupplier] = useState(false)
  // Validité du numéro pour le pays choisi (remontée par PhoneInput)
  const [phoneValid, setPhoneValid] = useState(true)
  const shopCountries = useMemo(() => userShops.map(s => s.country), [userShops])

  // ── Comparateur de prix par produit ─────────────────────────────────────
  // ?view=purchase_orders : ouverture directe sur les bons de commande (fiche boutique → Stock)
  const [view, setView] = useState<'suppliers' | 'by_product' | 'purchase_orders'>(() => searchParams.get('view') === 'purchase_orders' ? 'purchase_orders' : 'suppliers')
  const [productSearch, setProductSearch] = useState('')
  const [productPrices, setProductPrices] = useState<{ id: string; product_id: string; supplier_id: string; price: number; updated_at?: string }[]>([])
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
  // Produits ajoutés manuellement à un BC en cours de création depuis le
  // comparateur de prix — pas forcément assignés à ce fournisseur-là (le
  // comparateur permet justement de commander un produit chez un fournisseur
  // moins cher que son fournisseur habituel), donc poSupplierProducts doit
  // les inclure explicitement en plus de son filtre normal par supplier_id.
  const [poExtraProductIds, setPoExtraProductIds] = useState<Set<string>>(new Set())
  // Override manuel du prix catalogue pour cette commande précise (prix
  // négocié ponctuellement) — vide = on garde priceFor(p, poSupplierId).
  const [poPriceOverrides, setPoPriceOverrides] = useState<Record<string, string>>({})
  const [poNotes, setPoNotes] = useState('')
  const [poDeliveryDate, setPoDeliveryDate] = useState('')
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
  // Gardes de fermeture des panneaux : état d'origine pour comparer
  const [editOriginal, setEditOriginal] = useState('')
  const [reorderOriginal, setReorderOriginal] = useState('')
  const [receiveTouched, setReceiveTouched] = useState(false)
  // Tuile « En retard » : filtre les bons envoyés dont la date prévue est dépassée
  const [poOverdueOnly, setPoOverdueOnly] = useState(false)

  // Messages de validation traduits (le schéma par défaut est en anglais)
  const supplierSchema = useMemo(() => createSupplierSchema({
    name_required: t('errors.supplier_name_required'),
    phone_invalid: t('errors.phone_invalid'),
    email_invalid: t('errors.email_invalid'),
  }), [t])
  const form = useForm<SupplierFormData>({ resolver: zodResolver(supplierSchema) })
  useEffect(() => { if (showModal) setPhoneValid(true) }, [showModal])

  const openSupplierForm = (s: Supplier | null) => {
    setEditingSupplier(s)
    form.reset(s ? { name: s.name, phone: s.phone || '', city: s.city || '', email: s.email || '' } : { name: '', phone: '', city: '', email: '' })
    setShowModal(true)
  }
  const closeSupplierForm = () => {
    setShowModal(false)
    setEditingSupplier(null)
    form.reset({ name: '', phone: '', city: '', email: '' })
  }

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
  useRefetchOnVisible(() => { fetchSuppliers(); fetchProductPrices(); fetchPurchaseOrders() })
  useRefetchOnReconnect(() => { fetchSuppliers(); fetchProductPrices(); fetchPurchaseOrders() }, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

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

  // Export : colonnes du modèle d'import (fichier réimportable), puis le solde dû pour information
  const exportSuppliers = (fmtOut: 'xlsx' | 'csv') => {
    const col = (k: string) => t(`import.suppliers.xlsx.col.${k}.header` as any)
    suppliersExport.run({
      kind: t('nav.suppliers'),
      shopName: userShops.filter(x => effectiveShopIds.includes(x.id)).map(x => x.name).join(', ') || shop?.name || 'StockShop',
      columns: [
        { header: col('name') }, { header: col('phone') }, { header: col('email') }, { header: col('city') },
        { header: `${t('suppliers.supplier_journal_owed')} (${symbol})`, type: 'money' },
      ],
      rows: filtered.map(x => [x.name, x.phone || '', (x as any).email || '', x.city || '', Number(x.total_owed) || 0]),
      totals: [t('exports.total'), null, null, null, totalOwedAll],
    }, fmtOut)
  }

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? '—'
  // Solde dû cumulé des fournisseurs affichés (boutiques visibles)
  const totalOwedAll = useMemo(() => filtered.reduce((s, sup) => s + Number(sup.total_owed || 0), 0), [filtered])

  const isPoOverdue = (po: any) =>
    po.status === 'sent' && !!po.expected_delivery_date && new Date(po.expected_delivery_date) < new Date(new Date().toDateString())

  // Repères en tête des bons : en cours (envoyés), en retard, montant attendu
  const poKpis = useMemo(() => {
    const sent = purchaseOrders.filter((po: any) => po.status === 'sent')
    return {
      inProgress: sent.length,
      overdue: sent.filter(isPoOverdue).length,
      expected: sent.reduce((s: number, po: any) => s + poTotalOf(po), 0),
    }
  }, [purchaseOrders])

  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter((po: any) => {
      if (poSearch.trim()) {
        const q = normalize(poSearch)
        const supplier = po.suppliers?.name || supplierName(po.supplier_id) || ''
        if (!normalize(po.reference || '').includes(q) && !normalize(supplier).includes(q)) return false
      }
      if (poOverdueOnly && !isPoOverdue(po)) return false
      if (poStatusFilter && po.status !== poStatusFilter) return false
      if (poDateFrom && po.created_at < poDateFrom) return false
      if (poDateTo && po.created_at.slice(0, 10) > poDateTo) return false
      return true
    })
  }, [purchaseOrders, poSearch, poStatusFilter, poDateFrom, poDateTo, poOverdueOnly])

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
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const deleteSupplier = (s: Supplier) => {
    if (productCounts[s.id] > 0) {
      toast({ title: t('toast.supplier_has_products', { name: s.name, count: productCounts[s.id] }), variant: 'destructive' })
      return
    }
    setDeleteSupplierTarget(s)
  }

  const confirmDeleteSupplier = async () => {
    const s = deleteSupplierTarget
    if (!s) return
    setDeletingSupplier(true)
    try {
      const res = await withTimeout(fetch(`/api/suppliers?id=${s.id}&shop_id=${s.shop_id}`, { method: 'DELETE' }))
      if (!res.ok) { const json = await res.json().catch(() => ({})); toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('toast.supplier_deleted') })
      setDeleteSupplierTarget(null)
      if (sheetSupplier?.id === s.id) setSheetSupplier(null)
      fetchSuppliers()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeletingSupplier(false)
    }
  }

  // Envoi du bon par WhatsApp : au numéro du fournisseur (format international)
  // ou, sans numéro, sur le choix du contact dans WhatsApp.
  const sendPoWhatsApp = (po: any) => {
    const { subject, body } = buildPoEmailContent(po)
    const message = `*${subject}*\n\n${body}`
    const phone = po.suppliers?.phone || suppliers.find(s => s.id === po.supplier_id)?.phone || ''
    if (phone) shareViaWhatsApp(normalizeWhatsAppNumber(phone, getCountry(shop?.country).phonePrefix), message)
    else window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
  }

  // Depuis la fiche fournisseur : paiement de son solde dans Crédit et paiements
  const goRecordPayment = (s: Supplier) => {
    const href = `/${locale}/payments?pay_supplier=${s.id}`
    startNavigationProgress(href)
    router.push(href)
  }

  const filteredProducts = productSearch.trim()
    ? products.filter(p => normalize(p.name).includes(normalize(productSearch)))
    : []

  // Produits où un fournisseur moins cher que l'actuel est déjà connu — permet
  // au comparateur de proposer des opportunités sans recherche préalable,
  // plutôt que d'exiger que l'utilisateur sache déjà quoi chercher. Aucune
  // donnée supplémentaire : products/productPrices sont déjà en mémoire.
  const priceOpportunities = useMemo(() => {
    return products
      .map((p: any) => {
        if (!p.supplier_id) return null
        const currentPrice = Number(p.buying_price || 0)
        const cheaper = productPrices
          .filter(e => e.product_id === p.id && e.supplier_id !== p.supplier_id && e.price < currentPrice)
          .sort((a, b) => a.price - b.price)[0]
        if (!cheaper) return null
        return { product: p as Product, savings: currentPrice - cheaper.price }
      })
      .filter((x): x is { product: Product; savings: number } => x !== null)
      .sort((a, b) => b.savings - a.savings)
  }, [products, productPrices])

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
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
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

  // Prix effectif d'une ligne de BC en cours de création : l'override manuel
  // s'il est renseigné et valide, sinon le prix catalogue habituel.
  const poUnitPrice = (p: any) => {
    const override = poPriceOverrides[p.id]
    if (override != null && override !== '' && !Number.isNaN(Number(override))) return Number(override)
    return priceFor(p, poSupplierId)
  }

  const poSupplierProducts = products.filter((p: any) => p.supplier_id === poSupplierId || poExtraProductIds.has(p.id))
  const poVisibleProducts = poShowAll ? poSupplierProducts : poSupplierProducts.filter(isLowOrOut)
  const poTotal = poVisibleProducts
    .filter((p: any) => poChecked[p.id])
    .reduce((sum: number, p: any) => sum + poUnitPrice(p) * (Number(poQuantities[p.id]) || 0), 0)

  const openCreatePo = () => {
    setPoSupplierId('')
    setPoShowAll(false)
    setPoChecked({})
    setPoQuantities({})
    setPoExtraProductIds(new Set())
    setPoPriceOverrides({})
    setPoNotes('')
    setPoDeliveryDate('')
    setShowPoDialog(true)
  }

  const onPoSupplierChange = (supplierId: string) => {
    setPoSupplierId(supplierId)
    setPoExtraProductIds(new Set())
    setPoPriceOverrides({})
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

  // Depuis une ligne du comparateur de prix : ouvre le BC pré-rempli avec ce
  // produit chez ce fournisseur précis (potentiellement différent de son
  // fournisseur habituel), coché et visible même s'il n'est pas en stock bas.
  const orderFromComparator = (product: any, supplierId: string) => {
    setPoSupplierId(supplierId)
    setPoExtraProductIds(new Set([product.id]))
    setPoPriceOverrides({})
    setPoNotes('')
    setPoDeliveryDate('')
    const supplierProducts = products.filter((p: any) => p.supplier_id === supplierId)
    const checked: Record<string, boolean> = {}
    const quantities: Record<string, string> = {}
    supplierProducts.filter(isLowOrOut).forEach((p: any) => {
      checked[p.id] = true
      const threshold = lowStockThreshold(p)
      quantities[p.id] = String(Math.max(threshold * 2 - p.quantity, threshold))
    })
    checked[product.id] = true
    if (!quantities[product.id]) {
      const threshold = lowStockThreshold(product)
      quantities[product.id] = String(Math.max(threshold * 2 - (product.quantity || 0), threshold, 1))
    }
    setPoChecked(checked)
    setPoQuantities(quantities)
    setPoShowAll(true)
    setShowPoDialog(true)
  }

  // Lien profond depuis la page Stock (bouton "Commander" sur un produit en
  // rupture/stock bas) : ?order_product=<id> ouvre le BC pré-rempli avec ce
  // produit, chez son fournisseur habituel s'il en a un — sinon le dialogue
  // s'ouvre quand même, le champ fournisseur reste simplement à choisir.
  const orderProductId = searchParams.get('order_product')
  useEffect(() => {
    if (!orderProductId || !products.length) return
    const product = products.find((p: any) => p.id === orderProductId)
    if (product) {
      setView('purchase_orders')
      orderFromComparator(product, product.supplier_id || '')
    }
    router.replace(pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderProductId, products])

  const submitCreatePo = async () => {
    if (!shop?.id || !poSupplierId) return
    const items = poVisibleProducts
      .filter((p: any) => poChecked[p.id])
      .map((p: any) => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit,
        quantity_ordered: Number(poQuantities[p.id]) || 1,
        unit_price: poUnitPrice(p),
      }))
    if (items.length === 0) {
      toast({ title: t('transfers.select_at_least_one_product'), variant: 'destructive' })
      return
    }
    setCreatingPo(true)
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id, supplier_id: poSupplierId, items,
          notes: poNotes.trim() || null,
          expected_delivery_date: poDeliveryDate || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      toast({ title: t('suppliers.po_created'), variant: 'success' })
      setShowPoDialog(false)
      fetchPurchaseOrders()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
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
    setReceiveTouched(false)
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
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
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
    const items = (po.purchase_order_items || []).map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      product_name: it.product_name,
      unit: it.unit,
      quantity_ordered: String(it.quantity_ordered),
      unit_price: it.unit_price != null ? String(it.unit_price) : '',
    }))
    setEditItems(items)
    setEditOriginal(JSON.stringify(items))
    setEditingPo(po)
  }

  const submitEditPo = async () => {
    if (!shop?.id || !editingPo) return
    if (editItems.length === 0) {
      toast({ title: t('suppliers.po_must_have_product'), variant: 'destructive' })
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
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setSavingEditPo(false)
    }
  }

  const openReorderPo = (po: any) => {
    const shortfall = (po.purchase_order_items || [])
      .map((it: any) => ({ ...it, missing: it.quantity_ordered - (it.quantity_received ?? 0) }))
      .filter((it: any) => it.missing > 0)
    const items = shortfall.map((it: any) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      unit: it.unit,
      quantity_ordered: String(it.missing),
      unit_price: it.unit_price != null ? String(it.unit_price) : '',
    }))
    setReorderItems(items)
    setReorderOriginal(JSON.stringify(items))
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
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
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

  // Une carte "produit" du comparateur de prix — partagée entre les résultats
  // de recherche et la liste d'opportunités (produits déjà moins chers ailleurs).
  const renderPriceCard = (p: any) => {
    const entries = productPrices.filter(e => e.product_id === p.id)
    const currentSupplierId = p.supplier_id as string | null
    const currentPrice = currentSupplierId ? Number(p.buying_price || 0) : null
    const sellingPrice = Number(p.selling_price || 0)
    const rows = [
      ...(currentSupplierId ? [{ supplierId: currentSupplierId, price: currentPrice as number, isCurrent: true, entryId: null as string | null, updatedAt: null as string | null }] : []),
      ...entries.filter(e => e.supplier_id !== currentSupplierId).map(e => ({ supplierId: e.supplier_id, price: e.price, isCurrent: false, entryId: e.id, updatedAt: e.updated_at ?? null })),
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
            {rows.map(row => {
              const marginAmount = sellingPrice > 0 ? sellingPrice - row.price : null
              const marginPct = sellingPrice > 0 ? Math.round((marginAmount! / sellingPrice) * 100) : null
              const savings = !row.isCurrent && currentPrice != null ? currentPrice - row.price : null
              const showSavings = savings != null && savings > 0
              const savingsPct = showSavings && currentPrice ? Math.round((savings / currentPrice) * 100) : null
              return (
                <div key={row.supplierId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm truncate">{supplierName(row.supplierId)}</span>
                      {row.isCurrent && (
                        <span className="text-[10px] font-medium rounded-full bg-stockshop-blue-muted dark:bg-blue-950/40 text-stockshop-blue dark:text-blue-400 px-2 py-0.5 shrink-0">
                          {t('suppliers.current_price_label')}
                        </span>
                      )}
                      {showSavings && (
                        <span className="flex items-center gap-0.5 text-[10px] font-medium rounded-full bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 px-2 py-0.5 shrink-0">
                          <TrendingDown className="h-2.5 w-2.5" />
                          {t('suppliers.savings_label')} {fmt(savings)}{savingsPct != null ? ` (-${savingsPct}%)` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {marginAmount != null && (
                        <span>{t('suppliers.margin_label')} {fmt(marginAmount)}{marginPct != null ? ` (${marginPct}%)` : ''}</span>
                      )}
                      {row.updatedAt && (
                        <span>
                          {marginAmount != null ? ' · ' : ''}
                          {t('suppliers.price_updated_on', { date: new Date(row.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) })}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0 sm:ml-2">
                    <span className="text-sm font-semibold">{fmt(row.price)}</span>
                    {!row.isCurrent && canManage && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => usePrice(p, row.supplierId, row.price)}>
                          {t('suppliers.use_this_price')}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => orderFromComparator(p, row.supplierId)}>
                          <ShoppingCart className="h-3 w-3" />{t('suppliers.order_button')}
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
              )
            })}
          </div>
        )}
      </div>
    )
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" loading={suppliersExport.exporting} aria-label={t('products.import_export')} title={t('products.import_export')} data-testid="suppliers-files">
              <FileDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {canManage && shop?.id && (<>
              <DropdownMenuItem onClick={() => setShowImport(true)} className="gap-2.5" data-testid="suppliers-import">
                <Upload className="h-4 w-4 flex-shrink-0" />{t('import.suppliers.title')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>)}
            <DropdownMenuItem onClick={() => exportSuppliers('xlsx')} className="gap-2.5" data-testid="export-xlsx">
              <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />{t('exports.excel')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportSuppliers('csv')} className="gap-2.5" data-testid="export-csv">
              <Table2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />{t('exports.csv')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canManage && (
          <Button
            variant="stockshop"
            className="h-9 gap-1"
            size="sm"
            onClick={() => openSupplierForm(null)}
          >
            <Plus className="h-4 w-4" />
            {t('suppliers.add_supplier')}
          </Button>
        )}
      </div>

      {shop?.id && <ImportDrawer kind="suppliers" open={showImport} onClose={() => setShowImport(false)} shopId={shop.id} onImported={() => { fetchSuppliers() }} />}

      {totalOwedAll > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30" data-testid="suppliers-total-owed">
          <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><Banknote className="h-4 w-4" />{t('suppliers.total_owed_all')}</span>
          <span className="font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmt(totalOwedAll)}</span>
        </div>
      )}

      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
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
                  <SupplierCard key={supplier.id} supplier={supplier} productCount={productCounts[supplier.id] || 0} canManage={canManage}
                    onOpen={setSheetSupplier} onEdit={openSupplierForm} onDelete={deleteSupplier} t={t} fmt={fmt} />
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(supplier => (
            <SupplierCard key={supplier.id} supplier={supplier} productCount={productCounts[supplier.id] || 0} canManage={canManage}
              onOpen={setSheetSupplier} onEdit={openSupplierForm} onDelete={deleteSupplier} t={t} fmt={fmt} />
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

          {productSearch.trim() ? (
            filteredProducts.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
                {t('suppliers.no_suppliers')}
              </div>
            ) : (
              <div className="space-y-2">{filteredProducts.map(renderPriceCard)}</div>
            )
          ) : priceOpportunities.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground px-1">
                {t('suppliers.opportunities_hint', { count: priceOpportunities.length })}
              </p>
              {priceOpportunities.map(({ product }) => renderPriceCard(product))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm text-center px-6">
              {t('suppliers.search_product_hint')}
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
            <>
              {/* Repères : cliquer « En cours » ou « En retard » filtre la liste */}
              <div className="grid grid-cols-3 gap-2" data-testid="po-kpis">
                <button
                  type="button"
                  onClick={() => { setPoOverdueOnly(false); setPoFilter({ status: poStatusFilter === 'sent' && !poOverdueOnly ? '' : 'sent' }) }}
                  aria-pressed={poStatusFilter === 'sent' && !poOverdueOnly}
                  className={`rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 ${poStatusFilter === 'sent' && !poOverdueOnly ? 'ring-2 ring-stockshop-blue/30' : ''}`}
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock className="h-3.5 w-3.5" />{t('suppliers.kpi_in_progress')}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums">{poKpis.inProgress}</p>
                </button>
                <button
                  type="button"
                  onClick={() => { const next = !poOverdueOnly; setPoOverdueOnly(next); setPoFilter({ status: next ? 'sent' : '' }) }}
                  aria-pressed={poOverdueOnly}
                  className={`rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40 ${poOverdueOnly ? 'ring-2 ring-red-300' : ''}`}
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />{t('suppliers.kpi_overdue')}</p>
                  <p className={`mt-0.5 text-lg font-bold tabular-nums ${poKpis.overdue > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{poKpis.overdue}</p>
                </button>
                <div className="rounded-xl border bg-card px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Banknote className="h-3.5 w-3.5" />{t('suppliers.kpi_expected_amount')}</p>
                  <p className="mt-0.5 truncate text-lg font-bold tabular-nums">{fmt(poKpis.expected)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={poSearch}
                    onChange={e => setPoFilter({ search: e.target.value })}
                    placeholder={t('suppliers.po_search_placeholder')}
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={poStatusFilter || 'all'} onValueChange={v => { setPoOverdueOnly(false); setPoFilter({ status: v === 'all' ? '' : v }) }}>
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
                <div className="flex items-end gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="po-from" className="text-[10px] font-normal text-muted-foreground">{t('suppliers.from')}</Label>
                    <Input id="po-from" type="date" value={poDateFrom} max={poDateTo || undefined} onChange={e => setPoFilter({ dateFrom: e.target.value })} className="h-9 w-[130px] text-xs" />
                  </div>
                  <div className="space-y-0.5">
                    <Label htmlFor="po-to" className="text-[10px] font-normal text-muted-foreground">{t('suppliers.to')}</Label>
                    <Input id="po-to" type="date" value={poDateTo} min={poDateFrom || undefined} onChange={e => setPoFilter({ dateTo: e.target.value })} className="h-9 w-[130px] text-xs" />
                  </div>
                </div>
              </div>
            </>
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
                const isOverdue = isPoOverdue(po)
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
                          {isOverdue && (
                            <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
                              {t('suppliers.po_overdue_badge')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {po.suppliers?.name || supplierName(po.supplier_id)} · {t('suppliers.po_items_count', { count: itemCount })} · {fmt(total)}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                          {new Date(po.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {po.expected_delivery_date && (
                            <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                              {' · '}
                              {t('suppliers.po_expected_delivery', {
                                date: new Date(po.expected_delivery_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
                              })}
                            </span>
                          )}
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
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEmailPo(po)} data-testid="po-send">
                          <Send className="h-3 w-3" />{t('suppliers.po_send')}
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
                              className="h-8 gap-1.5 text-xs flex-1 text-stockshop-blue border-stockshop-blue/20 dark:border-blue-800 dark:text-blue-400"
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

      {/* Fiche fournisseur (ajout / modification) : formulaire court → modale */}
      <PremiumDialog
        open={showModal}
        onOpenChange={open => { if (!open) closeSupplierForm() }}
        title={editingSupplier ? t('suppliers.edit_title') : t('suppliers.add_supplier')}
        description={editingSupplier?.name}
        icon={<Package className="h-4 w-4" />}
        maxWidth="max-w-lg"
        dirty={form.formState.isDirty}
        testId="supplier-dialog"
      >
        <form
          id="supplier-form"
          onSubmit={form.handleSubmit(data => {
            if (data.phone && !phoneValid) { form.setError('phone', { message: t('errors.phone_invalid') }); return }
            return onSubmit(data)
          })}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <PremiumDialogBody>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-name">{t('suppliers.name')}<RequiredMark /></Label>
              <Input id="supplier-name" {...form.register('name')} placeholder={t('suppliers.name_placeholder')} aria-invalid={!!form.formState.errors.name} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-[3fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="supplier-phone">{t('suppliers.phone')}</Label>
                <PhoneInput
                  id="supplier-phone"
                  value={form.watch('phone')}
                  onChange={(v, valid) => {
                    form.setValue('phone', v, { shouldDirty: true })
                    setPhoneValid(valid)
                    if (form.formState.errors.phone) form.clearErrors('phone')
                  }}
                  defaultCountry={shop?.country}
                  preferredCountries={shopCountries}
                  invalid={!!form.formState.errors.phone}
                />
                {form.formState.errors.phone && <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="supplier-city">{t('suppliers.city')}</Label>
                <Input id="supplier-city" {...form.register('city')} placeholder={t('suppliers.city_placeholder')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-email">{t('suppliers.email')}</Label>
              <Input id="supplier-email" {...form.register('email')} placeholder="fournisseur@example.com" type="email" aria-invalid={!!form.formState.errors.email} />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={closeSupplierForm} cancelLabel={t('actions.cancel')}>
            <Button type="submit" variant="stockshop" className={FOOTER_PRIMARY_CLASS} loading={saving} data-testid="dialog-submit">
              {!saving && <Save className="h-4 w-4" />}
              {editingSupplier ? t('actions.update') : t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>

      {/* Suppression (douce) d'un fournisseur */}
      <ConfirmModal
        open={!!deleteSupplierTarget}
        onOpenChange={open => { if (!open && !deletingSupplier) setDeleteSupplierTarget(null) }}
        category={t('actions.delete')}
        title={deleteSupplierTarget?.name || ''}
        description={t('suppliers.delete_hint')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('actions.delete')}
        loading={deletingSupplier}
        onConfirm={confirmDeleteSupplier}
      />

      {/* Fiche fournisseur : panneau de consultation */}
      <SupplierSheet
        supplier={sheetSupplier}
        open={!!sheetSupplier}
        onOpenChange={open => { if (!open) setSheetSupplier(null) }}
        products={products.filter((p: any) => p.supplier_id === sheetSupplier?.id)}
        orders={purchaseOrders.filter((po: any) => po.supplier_id === sheetSupplier?.id)}
        canManage={canManage}
        shopCountry={shop?.country}
        fmt={fmt}
        onEdit={s => { setSheetSupplier(null); openSupplierForm(s) }}
        onNewPo={s => { setSheetSupplier(null); openCreatePo(); onPoSupplierChange(s.id) }}
        onOpenPo={po => setJournalPo(po)}
        onRecordPayment={goRecordPayment}
      />

      {/* Ajouter un prix fournisseur : deux champs → modale */}
      <PremiumDialog
        open={!!addPriceProduct}
        onOpenChange={open => { if (!open) setAddPriceProduct(null) }}
        title={t('suppliers.add_price')}
        description={addPriceProduct?.name}
        icon={<ArrowRightLeft className="h-4 w-4" />}
        maxWidth="max-w-md"
        dirty={!!addPriceSupplierId || !!addPriceValue}
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label>{t('nav.suppliers')}<RequiredMark /></Label>
            <Select value={addPriceSupplierId} onValueChange={setAddPriceSupplierId}>
              <SelectTrigger className="h-10"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
              <SelectContent>
                {suppliers
                  .filter(s => s.shop_id === addPriceProduct?.shop_id && s.id !== (addPriceProduct as any)?.supplier_id)
                  .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-price-value">{t('suppliers.price_label')}<RequiredMark /></Label>
            <InputGroup suffix={symbol}>
              <Input id="add-price-value" type="number" min={0} inputMode="numeric" value={addPriceValue} onChange={e => setAddPriceValue(e.target.value)} placeholder="0" />
            </InputGroup>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setAddPriceProduct(null)}
          cancelLabel={t('actions.cancel')}
          onConfirm={submitAddPrice}
          confirmLabel={t('actions.save')}
          confirmLoading={savingPrice}
          confirmDisabled={!addPriceSupplierId || !addPriceValue || Number(addPriceValue) <= 0}
          confirmIcon={<Save className="h-4 w-4" />}
        />
      </PremiumDialog>

      {/* Nouveau bon de commande : panneau de formulaire en sections */}
      <FormDrawer
        open={showPoDialog}
        onOpenChange={open => { if (!open) setShowPoDialog(false) }}
        title={t('suppliers.new_po')}
        description={poSupplierId ? supplierName(poSupplierId) : undefined}
        icon={<FileText className="h-4 w-4" />}
        width="lg"
        onSubmit={submitCreatePo}
        submitting={creatingPo}
        submitDisabled={!poSupplierId}
        dirty={!!poSupplierId || !!poNotes.trim() || !!poDeliveryDate}
        testId="po-drawer"
        footerExtra={poSupplierId ? (
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-sm font-medium">{t('suppliers.po_total_label')}</span>
            <span className="text-base font-bold tabular-nums text-stockshop-blue dark:text-blue-400" data-testid="po-total">{fmt(poTotal)}</span>
          </div>
        ) : undefined}
      >
        <DrawerSection title={t('suppliers.section_supplier')}>
          <Select value={poSupplierId} onValueChange={onPoSupplierChange}>
            <SelectTrigger className="h-10" data-testid="po-supplier"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
            <SelectContent>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </DrawerSection>

        {poSupplierId && (
          <>
            <DrawerSection title={t('suppliers.section_products')}>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={poShowAll} onChange={e => setPoShowAll(e.target.checked)} className="h-4 w-4 accent-stockshop-blue" />
                {t('suppliers.po_show_all_products')}
              </label>
              {poVisibleProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{t('suppliers.po_no_products')}</p>
              ) : (
                <div className="space-y-1.5">
                  {poVisibleProducts.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2" data-testid="po-line">
                      <input
                        type="checkbox"
                        checked={!!poChecked[p.id]}
                        onChange={e => setPoChecked(prev => ({ ...prev, [p.id]: e.target.checked }))}
                        className="h-4 w-4 accent-stockshop-blue"
                        aria-label={p.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t('suppliers.po_stock_label')}: {p.quantity} {p.unit}
                        </p>
                      </div>
                      <div className="flex items-end gap-1.5 shrink-0">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[9px] text-muted-foreground">{t('suppliers.po_qty_short')}</span>
                          <Input
                            type="number" min={1} inputMode="numeric"
                            value={poQuantities[p.id] ?? ''}
                            onChange={e => setPoQuantities(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-14 h-8 text-center text-xs"
                          />
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[9px] text-muted-foreground">{t('suppliers.po_price_short')}</span>
                          <Input
                            type="number" min={0} inputMode="decimal"
                            value={poPriceOverrides[p.id] ?? String(priceFor(p, poSupplierId))}
                            onChange={e => setPoPriceOverrides(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-20 h-8 text-center text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            <DrawerSection title={t('suppliers.section_delivery')}>
              <div className="space-y-1.5">
                <Label htmlFor="po-delivery">{t('suppliers.po_delivery_date_label')}</Label>
                <Input
                  id="po-delivery"
                  type="date"
                  value={poDeliveryDate}
                  onChange={e => setPoDeliveryDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-notes">{t('suppliers.po_notes_label')}</Label>
                <textarea
                  id="po-notes"
                  value={poNotes}
                  onChange={e => setPoNotes(e.target.value)}
                  placeholder={t('suppliers.po_notes_placeholder')}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                />
              </div>
            </DrawerSection>
          </>
        )}
      </FormDrawer>

      {/* Modifier un bon (brouillon) : lignes en panneau */}
      <FormDrawer
        open={!!editingPo}
        onOpenChange={open => { if (!open) setEditingPo(null) }}
        title={t('suppliers.po_edit_title')}
        description={editingPo?.reference}
        icon={<Edit2 className="h-4 w-4" />}
        width="lg"
        onSubmit={submitEditPo}
        submitting={savingEditPo}
        submitDisabled={editItems.length === 0}
        dirty={JSON.stringify(editItems) !== editOriginal}
        testId="po-edit-drawer"
      >
        <DrawerSection title={t('suppliers.section_products')}>
          <div className="space-y-2">
            {editItems.map((it, idx) => (
              <div key={it.id ?? idx} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
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
                  type="button"
                  aria-label={t('actions.remove')}
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
        </DrawerSection>
      </FormDrawer>

      {/* Commander le reste d'une livraison partielle */}
      <FormDrawer
        open={!!reorderPo}
        onOpenChange={open => { if (!open) setReorderPo(null) }}
        title={t('suppliers.po_reorder_title')}
        description={reorderPo ? t('suppliers.po_reorder_hint', { reference: reorderPo.reference }) : undefined}
        icon={<RotateCcw className="h-4 w-4" />}
        width="lg"
        onSubmit={submitReorder}
        submitting={creatingReorder}
        submitDisabled={reorderItems.length === 0}
        submitLabel={t('suppliers.po_reorder_confirm')}
        submitIcon={<RotateCcw className="h-4 w-4" />}
        dirty={JSON.stringify(reorderItems) !== reorderOriginal}
        testId="po-reorder-drawer"
      >
        <DrawerSection title={t('suppliers.section_products')}>
          <div className="space-y-2">
            {reorderItems.map((it, idx) => (
              <div key={it.product_id ?? idx} className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
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
                  type="button"
                  aria-label={t('actions.remove')}
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
        </DrawerSection>
      </FormDrawer>

      {/* Suppression d'un bon (brouillon) */}
      <ConfirmModal
        open={!!deletePoConfirm}
        onOpenChange={open => { if (!open && !deletingPo) setDeletePoConfirm(null) }}
        category={t('actions.delete')}
        title={deletePoConfirm?.reference || ''}
        description={t('suppliers.po_delete_confirm')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('actions.delete')}
        loading={deletingPo}
        onConfirm={confirmDeletePo}
      />

      {/* Envoyer le bon : WhatsApp (numéro international) ou e-mail */}
      <PremiumDialog
        open={!!emailPo}
        onOpenChange={open => { if (!open) setEmailPo(null) }}
        title={t('suppliers.po_send_title')}
        description={emailPo ? `${emailPo.reference} · ${emailPo.suppliers?.name || supplierName(emailPo.supplier_id)}` : undefined}
        icon={<Send className="h-4 w-4" />}
        maxWidth="max-w-lg"
        testId="po-send-dialog"
      >
        {emailPo && (() => {
          const { subject, body } = buildPoEmailContent(emailPo)
          const supplierEmail = emailPo.suppliers?.email || ''
          const supplierPhone = emailPo.suppliers?.phone || suppliers.find(s => s.id === emailPo.supplier_id)?.phone || ''
          const mailtoHref = `mailto:${encodeURIComponent(supplierEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
          return (
            <>
              <PremiumDialogBody>
                <p className="text-xs text-muted-foreground">{t('suppliers.po_send_hint')}</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{t('suppliers.po_email_subject')}</Label>
                    <button type="button" className="flex items-center gap-1 text-xs text-stockshop-blue dark:text-blue-400 hover:underline" onClick={() => copyToClipboard(subject, t('suppliers.po_email_subject'))}>
                      <Copy className="h-3 w-3" />{t('suppliers.po_copy')}
                    </button>
                  </div>
                  <Input readOnly value={subject} onFocus={e => e.target.select()} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{t('suppliers.po_email_body')}</Label>
                    <button type="button" className="flex items-center gap-1 text-xs text-stockshop-blue dark:text-blue-400 hover:underline" onClick={() => copyToClipboard(body, t('suppliers.po_email_body'))}>
                      <Copy className="h-3 w-3" />{t('suppliers.po_copy')}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={body}
                    onFocus={e => e.target.select()}
                    rows={8}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
                {!supplierPhone && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t('suppliers.po_no_supplier_phone')}</p>
                )}
                {!supplierEmail && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t('suppliers.po_no_supplier_email')}</p>
                )}
              </PremiumDialogBody>
              <div className={`flex-shrink-0 border-t border-border bg-background px-5 py-4 ${FOOTER_ROW_CLASS}`}>
                <Button variant="outline" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-4 font-medium sm:flex-none sm:min-w-[150px]" asChild>
                  <a href={mailtoHref}><Mail className="h-4 w-4 flex-shrink-0" /><span className="truncate">{t('suppliers.po_send_email')}</span></a>
                </Button>
                <Button
                  type="button"
                  className="h-11 min-w-0 flex-1 gap-2 rounded-lg border-0 bg-green-600 px-4 font-semibold text-white hover:bg-green-700 sm:flex-none sm:min-w-[180px]"
                  onClick={() => sendPoWhatsApp(emailPo)}
                  data-testid="po-send-whatsapp"
                >
                  <MessageCircle className="h-4 w-4 flex-shrink-0" /><span className="truncate">{t('suppliers.po_send_whatsapp')}</span>
                </Button>
              </div>
            </>
          )
        })()}
      </PremiumDialog>

      {/* Réceptionner un bon : quantités reçues puis paiement, en panneau */}
      <FormDrawer
        open={!!receivingPo}
        onOpenChange={open => { if (!open) setReceivingPo(null) }}
        title={t('suppliers.po_receive_title')}
        description={receivingPo ? `${receivingPo.reference} · ${receivingPo.suppliers?.name || supplierName(receivingPo.supplier_id)}` : undefined}
        icon={<CheckCircle2 className="h-4 w-4" />}
        width="lg"
        onSubmit={submitReceivePo}
        submitting={receivingLoading}
        submitLabel={t('suppliers.po_confirm_receipt')}
        submitIcon={<CheckCircle2 className="h-4 w-4" />}
        dirty={receiveTouched}
        testId="po-receive-drawer"
        footerExtra={(
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-sm font-medium">{t('suppliers.po_total_label')}</span>
            <span className="text-base font-bold tabular-nums text-stockshop-blue dark:text-blue-400">{fmt(receiveTotal)}</span>
          </div>
        )}
      >
        {receivingPo && (
          <>
            <DrawerSection title={t('suppliers.section_quantities')} description={t('suppliers.po_receive_hint')}>
              <div className="space-y-2">
                {(receivingPo.purchase_order_items || []).map((it: any) => {
                  const received = Number(receiveQuantities[it.id])
                  const isShort = receiveQuantities[it.id] !== undefined && !isNaN(received) && received < it.quantity_ordered
                  return (
                    <div key={it.id} className="rounded-lg border bg-background px-2.5 py-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{it.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">{t('suppliers.po_ordered_label')}: {it.quantity_ordered} {it.unit || ''}</p>
                        </div>
                        <Input
                          type="number" min={0} inputMode="numeric"
                          value={receiveQuantities[it.id] ?? ''}
                          onChange={e => { setReceiveTouched(true); setReceiveQuantities(prev => ({ ...prev, [it.id]: e.target.value })) }}
                          className="w-20 h-9 text-center flex-shrink-0"
                          aria-label={it.product_name}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground shrink-0">{t('products.expiry_date_label')}</span>
                        <Input
                          type="date"
                          value={receiveExpiryDates[it.id] ?? ''}
                          onChange={e => { setReceiveTouched(true); setReceiveExpiryDates(prev => ({ ...prev, [it.id]: e.target.value })) }}
                          className="h-8 text-xs flex-1"
                        />
                      </div>
                      {isShort && (
                        <Input
                          value={receiveNotes[it.id] ?? ''}
                          onChange={e => { setReceiveTouched(true); setReceiveNotes(prev => ({ ...prev, [it.id]: e.target.value })) }}
                          placeholder={t('suppliers.po_receipt_note_placeholder')}
                          className="h-8 text-xs"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </DrawerSection>

            <DrawerSection title={t('suppliers.section_payment')}>
              <div className="grid grid-cols-3 gap-1.5">
                {(['paid', 'partial', 'credit'] as const).map(status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => { setReceiveTouched(true); setReceivePaymentStatus(status) }}
                    aria-pressed={receivePaymentStatus === status}
                    className={`h-10 rounded-lg text-xs font-medium border transition-colors ${
                      receivePaymentStatus === status
                        ? status === 'paid' ? 'bg-green-600 border-green-600 text-white'
                          : status === 'partial' ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-muted-foreground/80 border-muted-foreground/80 text-white'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {t(`suppliers.po_payment_status_${status}`)}
                  </button>
                ))}
              </div>
              {receivePaymentStatus === 'partial' && (
                <InputGroup suffix={symbol}>
                  <Input
                    inputMode="numeric"
                    value={formatInputValue(receivePaymentAmount, symbol)}
                    onChange={e => { setReceiveTouched(true); setReceivePaymentAmount(e.target.value.replace(/\D/g, '')) }}
                    placeholder={t('suppliers.po_payment_amount_placeholder')}
                  />
                </InputGroup>
              )}
              {receivePaymentStatus !== 'credit' && (
                <Select value={receivePaymentMethod} onValueChange={v => { setReceiveTouched(true); setReceivePaymentMethod(v) }}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
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
            </DrawerSection>
          </>
        )}
      </FormDrawer>

      {/* Historique d'un bon : panneau de consultation */}
      <DetailDrawer
        open={!!journalPo}
        onOpenChange={open => { if (!open) setJournalPo(null) }}
        category={t('suppliers.po_journal_title')}
        title={journalPo?.reference || ''}
        description={journalPo ? `${journalPo.suppliers?.name || supplierName(journalPo.supplier_id)} · ${fmt(poTotalOf(journalPo))}` : undefined}
        icon={<History className="h-4 w-4" />}
        width="md"
        testId="po-journal-drawer"
      >
        {journalPo && (() => {
          const events: { key: string; label: string; date: string; Icon: any; color: string; actorName?: string | null }[] = [
            { key: 'created', label: t('suppliers.po_journal_created'), date: journalPo.created_at, Icon: FileText, color: 'text-muted-foreground border-border bg-muted', actorName: journalPo.created_by_name },
          ]
          if (journalPo.sent_at) {
            events.push({ key: 'sent', label: t('suppliers.po_journal_sent'), date: journalPo.sent_at, Icon: Send, color: 'text-stockshop-blue border-stockshop-blue/20 bg-stockshop-blue-muted dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800', actorName: journalPo.sent_by_name })
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
            <div className="space-y-4">
              <DrawerSection>
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
                          {new Date(ev.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {ev.actorName && <> · {t('suppliers.po_journal_by', { name: ev.actorName })}</>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </DrawerSection>
              {items.length > 0 && (
                <DrawerSection title={t('suppliers.po_journal_items_title')}>
                  <div className="space-y-1.5">
                    {items.map((it: any) => {
                      const received = (journalPo.status === 'received' || journalPo.status === 'partial')
                      return (
                        <div key={it.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="truncate">{it.product_name}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {received ? `${it.quantity_received ?? it.quantity_ordered}/${it.quantity_ordered}` : it.quantity_ordered} {it.unit || ''}
                            {it.unit_price != null && <> · {fmt(it.unit_price * it.quantity_ordered)}</>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </DrawerSection>
              )}
            </div>
          )
        })()}
      </DetailDrawer>
    </div>
  )
}
