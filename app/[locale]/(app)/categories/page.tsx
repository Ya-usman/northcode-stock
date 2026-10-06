'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, Trash2, Tag, Search, RotateCcw, ChevronDown, ChevronRight, Package, Store, Edit2, Check, ExternalLink, Save, ArrowUpDown } from 'lucide-react'
import { CATEGORY_COLORS } from '@/lib/constants/category-colors'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useCurrency } from '@/lib/hooks/use-currency'
import { normalize } from '@/lib/utils/normalize'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { emitOnboarding } from '@/lib/onboarding/events'
import { EmptyGuide } from '@/components/onboarding/empty-guide'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { RequiredMark } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils/cn'
import type { Category, Product } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'
import { fetchSoldQty30d, lowStockThresholdOf } from '@/lib/stock/signals'
import { presetPersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { startNavigationProgress } from '@/components/layout/navigation-progress'

// Catégories : repères par catégorie (produits, ruptures, stock bas, ventes
// 30 j, valeur du stock pour le propriétaire), part dans le stock, tri, liens
// vers la liste Produits filtrée ; une seule modale pour ajouter / modifier ;
// suppression avec déplacement des produits ; restauration confirmée.

type SortKey = 'name' | 'products' | 'value' | 'sales'

interface CatStats { count: number; out: number; low: number; value: number; sold: number }

function ColorPicker({ value, onChange }: { value: string | null; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {CATEGORY_COLORS.map(color => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          onClick={() => onChange(color)}
          className={cn('h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', value === color && 'ring-2 ring-offset-2 ring-foreground/40')}
          style={{ backgroundColor: color }}
          aria-label={color}
        >
          {value === color && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  )
}

export default function CategoriesPage() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const { shop, profile, roleInActiveShop, effectiveShopIds, userShops } = useAuthContext()
  const { fmt } = useCurrency()
  const { isOnline } = useOffline()
  const isMultiShop = effectiveShopIds.length > 1
  const supabase = createClient()
  const { toast } = useToast()

  const [categories, setCategories] = useState<Category[]>(() => {
    const c = getPageCache<{ categories: Category[]; products: Product[] }>(`categories_${effectiveShopIds.join(',')}`)
    return c?.categories || []
  })
  const [products, setProducts] = useState<Product[]>(() => {
    const c = getPageCache<{ categories: Category[]; products: Product[] }>(`categories_${effectiveShopIds.join(',')}`)
    return c?.products || []
  })
  const [soldQty, setSoldQty] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(() => !getPageCache(`categories_${effectiveShopIds.join(',')}`))
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Formulaire unique : ajout (editingCat = null) ou modification
  const [formOpen, setFormOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState<string | null>(null)
  const [formAlertDays, setFormAlertDays] = useState('')
  const [formInitial, setFormInitial] = useState('')
  const [saving, setSaving] = useState(false)

  // Suppression avec déplacement facultatif des produits
  const [deleteCat, setDeleteCat] = useState<Category | null>(null)
  const [deleteMode, setDeleteMode] = useState<'leave' | 'move'>('leave')
  const [moveTarget, setMoveTarget] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [restoreOpen, setRestoreOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const fetchData = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `categories_${effectiveShopIds.join(',')}`
    const cached = getPageCache<any>(cacheKey)
    if (cached) { setCategories(cached.categories); setProducts(cached.products); setLoading(false) }
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const [catData, prodData] = await withTimeout(Promise.all([
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
        supabase.from('products').select('id, name, selling_price, buying_price, quantity, unit, category_id, shop_id, low_stock_threshold').in('shop_id', effectiveShopIds).eq('is_active', true).order('name'),
      ]), 20_000, 'Chargement des catégories trop lent — réessayez.')
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — check explicitly so the catch below preserves the cache
      // already on screen instead of zeroing it out.
      if (catData.error || prodData.error) throw catData.error || prodData.error
      const fetchedCategories = (catData.data || []) as Category[]
      const fetchedProducts = (prodData.data || []) as unknown as Product[]
      setCategories(fetchedCategories)
      setProducts(fetchedProducts)
      setPageCache(cacheKey, { categories: fetchedCategories, products: fetchedProducts })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
    // Ventes des 30 derniers jours par produit (repère secondaire, sans bloquer la liste)
    fetchSoldQty30d(supabase, effectiveShopIds).then(setSoldQty).catch(() => {})
  }

  useEffect(() => { fetchData() }, [effectiveShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when the user comes back to this tab — catches categories/products
  // added or edited by other team members while this page sat in the background.
  useRefetchOnVisible(fetchData)
  useRefetchOnReconnect(fetchData, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const effectiveRole = roleInActiveShop ?? profile?.role
  // Règle unique : niveau « modification » de Catégories (même règle que /api/categories)
  const { canWrite } = useRolePermissions()
  const canEdit = canWrite('categories')
  // Valeur du stock (coût d'achat) : propriétaire seulement, comme dans le Stock
  const showValue = effectiveRole === 'owner' || effectiveRole === 'super_admin'

  // Catégorie effective d'un produit : seulement si elle appartient à SA boutique
  // (un produit rattaché à la catégorie d'une autre boutique compte comme « sans catégorie »)
  const catShop = useMemo(() => new Map(categories.map(c => [c.id, c.shop_id])), [categories])
  const catOf = (p: { category_id: string | null; shop_id: string }) => (p.category_id && catShop.get(p.category_id) === p.shop_id ? p.category_id : null)

  // Repères par catégorie (clé « __none__<shop> » pour les produits sans catégorie)
  const statsByCat = useMemo(() => {
    const map: Record<string, CatStats> = {}
    for (const p of products as any[]) {
      const key = catOf(p) || `__none__${p.shop_id}`
      const s = map[key] || (map[key] = { count: 0, out: 0, low: 0, value: 0, sold: 0 })
      const qty = Number(p.quantity) || 0
      s.count++
      if (qty <= 0) s.out++
      else if (qty <= lowStockThresholdOf(p, shop?.low_stock_threshold)) s.low++
      s.value += qty * (Number(p.buying_price) || 0)
      s.sold += soldQty?.[p.id] || 0
    }
    return map
  }, [products, soldQty, shop?.low_stock_threshold, catShop]) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => {
    const all = Object.values(statsByCat)
    return { count: all.reduce((a, s) => a + s.count, 0), value: all.reduce((a, s) => a + s.value, 0) }
  }, [statsByCat])
  const statsOf = (key: string): CatStats => statsByCat[key] || { count: 0, out: 0, low: 0, value: 0, sold: 0 }

  const filtered = useMemo(() => {
    const list = categories.filter(c => normalize(c.name).includes(normalize(search)))
    const by = (c: Category) => statsOf(c.id)
    return [...list].sort((a, b) => {
      if (sortKey === 'products') return by(b).count - by(a).count || a.name.localeCompare(b.name, locale)
      if (sortKey === 'value') return by(b).value - by(a).value || a.name.localeCompare(b.name, locale)
      if (sortKey === 'sales') return by(b).sold - by(a).sold || a.name.localeCompare(b.name, locale)
      return a.name.localeCompare(b.name, locale)
    })
  }, [categories, search, sortKey, statsByCat, locale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Liste Produits filtrée (catégorie, ou « sans catégorie »)
  const openInProducts = (categoryId: string) => {
    presetPersistedFilters('stock', shop?.id, { categoryFilter: categoryId, statusFilter: 'all', search: '' })
    const href = `/${locale}/stock/products`
    startNavigationProgress(href)
    router.push(href)
  }

  // ── Formulaire ajouter / modifier ─────────────────────────────────────────
  const snap = (n: string, c: string | null, d: string) => JSON.stringify([n.trim(), c, d])
  const openForm = (cat: Category | null) => {
    const name = cat?.name ?? ''
    const color = cat?.color || CATEGORY_COLORS[0]
    const days = cat?.expiry_alert_days != null ? String(cat.expiry_alert_days) : ''
    setEditingCat(cat)
    setFormName(name); setFormColor(color); setFormAlertDays(days)
    setFormInitial(snap(name, color, days))
    setFormOpen(true)
  }
  const formDirty = formOpen && snap(formName, formColor, formAlertDays) !== formInitial

  const submitForm = async () => {
    if (!shop?.id || !formName.trim()) return
    setSaving(true)
    try {
      const body = { name: formName.trim(), color: formColor, expiry_alert_days: formAlertDays ? Number(formAlertDays) : null }
      const res = await withTimeout(fetch('/api/categories', {
        method: editingCat ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Modification : la boutique de la catégorie (vue multi-boutiques)
        body: JSON.stringify(editingCat ? { id: editingCat.id, shop_id: editingCat.shop_id, ...body } : { shop_id: shop.id, ...body }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      if (!editingCat) emitOnboarding('category_created') // tour guidé « Créer une catégorie »
      toast({ title: editingCat ? t('categories.updated') : t('categories.added'), variant: 'success' })
      setFormOpen(false)
      setEditingCat(null)
      fetchData()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Suppression (avec déplacement facultatif des produits) ───────────────
  const openDelete = (cat: Category) => {
    setDeleteCat(cat)
    setDeleteMode('leave')
    setMoveTarget('')
  }
  const deleteProductIds = deleteCat ? products.filter(p => catOf(p) === deleteCat.id).map(p => p.id) : []
  const moveOptions = deleteCat ? categories.filter(c => c.id !== deleteCat.id && c.shop_id === deleteCat.shop_id) : []

  const confirmDelete = async () => {
    const cat = deleteCat
    if (!cat) return
    setDeleting(true)
    try {
      if (deleteMode === 'move' && moveTarget && deleteProductIds.length > 0) {
        // Affectation groupée existante (même route que « Changer de catégorie » dans Produits)
        const moveRes = await withTimeout(fetch('/api/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop_id: cat.shop_id, ids: deleteProductIds, category_id: moveTarget }),
        }), 30_000)
        if (!moveRes.ok) {
          const json = await moveRes.json().catch(() => ({}))
          toast({ title: json.error || t('categories.delete_error'), variant: 'destructive' })
          return
        }
      }
      const res = await withTimeout(fetch(`/api/categories?id=${cat.id}&shop_id=${cat.shop_id}`, { method: 'DELETE' }))
      if (!res.ok) { toast({ title: t('categories.delete_error'), variant: 'destructive' }); return }
      setDeleteCat(null)
      fetchData()
      toast({ title: t('categories.deleted') })
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  // ── Restauration des catégories par défaut (confirmée) ────────────────────
  const restoreDefaults = async () => {
    if (!shop?.id) return
    setSeeding(true)
    try {
      const res = await withTimeout(fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id }),
      }), 30_000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      setRestoreOpen(false)
      await fetchData()
      toast({
        title: t('categories.restored'),
        description: t('categories.restore_result', { created: json.categoriesCreated ?? 0, assigned: json.productsAssigned ?? 0 }),
        variant: 'success',
      })
    } catch (err: any) {
      toast({ title: err?.message || t('toast.error'), variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  // ── Rendu d'une carte ─────────────────────────────────────────────────────
  const shareBar = (s: CatStats) => {
    const pct = showValue && totals.value > 0
      ? Math.round((s.value / totals.value) * 100)
      : totals.count > 0 ? Math.round((s.count / totals.count) * 100) : 0
    return (
      <div className="space-y-1" title={showValue ? t('categories.share_value', { pct }) : t('categories.share_products', { pct })}>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-stockshop-blue/70 dark:bg-blue-500/70" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground">{showValue ? t('categories.share_value', { pct }) : t('categories.share_products', { pct })}</p>
      </div>
    )
  }

  const statLine = (s: CatStats) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" data-testid="category-stats">
      <span>{t('categories.products_count', { count: s.count })}</span>
      {s.out > 0 && <span className="font-medium text-red-600 dark:text-red-400">{t('categories.out_count', { count: s.out })}</span>}
      {s.low > 0 && <span className="font-medium text-amber-600 dark:text-amber-400">{t('categories.low_count', { count: s.low })}</span>}
      {soldQty && <span>{t('categories.sold_30d', { count: s.sold })}</span>}
      {showValue && <span>{t('categories.stock_value', { amount: fmt(s.value) })}</span>}
    </div>
  )

  const productRows = (list: any[]) => (
    list.length === 0 ? (
      <p className="text-xs text-muted-foreground text-center py-4">{t('categories.no_products_in_cat')}</p>
    ) : (
      <div className="divide-y divide-border/50">
        {list.map((p: any) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm truncate">{p.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <span className={cn('text-xs', Number(p.quantity) <= 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{p.quantity} {p.unit}</span>
              <span className="text-sm font-semibold text-stockshop-blue dark:text-blue-400">{fmt(p.selling_price)}</span>
            </div>
          </div>
        ))}
      </div>
    )
  )

  const renderCategory = (cat: Category) => {
    const s = statsOf(cat.id)
    const isExpanded = expandedId === cat.id
    return (
      <div key={cat.id} className="rounded-lg border bg-card shadow-sm overflow-hidden" data-testid="category-card">
        <div className="flex items-start gap-2 px-4 py-3">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setExpandedId(isExpanded ? null : cat.id)}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            <div
              className={cn('mt-0.5 h-8 w-8 rounded-md flex items-center justify-center shrink-0', !cat.color && 'bg-stockshop-blue-muted dark:bg-blue-950/30')}
              style={cat.color ? { backgroundColor: `${cat.color}20` } : undefined}
            >
              <Tag className={cn('h-4 w-4', !cat.color && 'text-stockshop-blue dark:text-blue-400')} style={cat.color ? { color: cat.color } : undefined} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{cat.name}</span>
                <Badge variant="secondary" className="text-xs shrink-0">{s.count}</Badge>
              </div>
              {statLine(s)}
              {shareBar(s)}
            </div>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {s.count > 0 && (
              <button type="button" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title={t('categories.view_products')} aria-label={t('categories.view_products')} onClick={() => openInProducts(cat.id)} data-testid="category-view-products">
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            {canEdit && (
              <>
                <button type="button" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" aria-label={t('categories.edit_dialog_title')} onClick={() => openForm(cat)} data-testid="category-edit">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" aria-label={t('actions.delete')} onClick={() => openDelete(cat)} data-testid="category-delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button type="button" className="p-1.5 text-muted-foreground" aria-label={t('actions.view')} onClick={() => setExpandedId(isExpanded ? null : cat.id)}>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {isExpanded && <div className="border-t bg-muted/10">{productRows(products.filter(p => catOf(p) === cat.id))}</div>}
      </div>
    )
  }

  const renderUncategorized = (list: any[], shopId: string) => {
    const key = `__none__${shopId}`
    const isExpanded = expandedId === key
    return (
      <div key={key} className="rounded-lg border border-dashed bg-card shadow-sm overflow-hidden" data-testid="uncategorized-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedId(isExpanded ? null : key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <div className="h-8 w-8 rounded-md bg-stockshop-blue-muted/50 dark:bg-blue-950/20 flex items-center justify-center shrink-0">
              <Tag className="h-4 w-4 text-stockshop-blue/60 dark:text-blue-400/60" />
            </div>
            <span className="font-medium text-sm text-muted-foreground">{t('categories.uncategorized')}</span>
            <Badge variant="outline" className="text-xs">{list.length}</Badge>
          </button>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openInProducts('uncategorized')} data-testid="classify-products">
            <ExternalLink className="h-3 w-3" />{t('categories.classify')}
          </Button>
          <button type="button" className="p-1.5 text-muted-foreground" aria-label={t('actions.view')} onClick={() => setExpandedId(isExpanded ? null : key)}>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {isExpanded && <div className="border-t bg-muted/10">{productRows(list)}</div>}
      </div>
    )
  }

  const uncategorized = products.filter(p => !catOf(p))

  return (
    <div className="space-y-4">
      {/* Recherche, tri, actions */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('categories.search_placeholder')} aria-label={t('categories.search_placeholder')} className="pl-9 h-9" />
        </div>
        <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-9 w-[180px] text-xs" aria-label={t('categories.sort_label')} data-testid="category-sort">
            <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t('categories.sort_name')}</SelectItem>
            <SelectItem value="products">{t('categories.sort_products')}</SelectItem>
            {showValue && <SelectItem value="value">{t('categories.sort_value')}</SelectItem>}
            <SelectItem value="sales">{t('categories.sort_sales')}</SelectItem>
          </SelectContent>
        </Select>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => setRestoreOpen(true)} className="gap-1.5 h-9 px-3 text-sm text-muted-foreground" title={t('categories.restore_hint')} aria-label={t('categories.restore')}>
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t('categories.restore')}</span>
            </Button>
            <Button variant="stockshop" onClick={() => openForm(null)} className="gap-1.5 h-9 px-3 text-sm" data-tour="add-category">
              <Plus className="h-4 w-4" />
              {t('categories.add')}
            </Button>
          </div>
        )}
      </div>

      {/* Aucune catégorie encore : on explique à quoi elles servent (les produits
          non rangés restent listés dessous) */}
      {!loading && !search && filtered.length === 0 && (
        <EmptyGuide icon={Tag} title={t('onboarding.empty.categories.title')} body={t('onboarding.empty.categories.body')} tour={canEdit ? 'add_category' : undefined} />
      )}

      {/* Liste */}
      <div className="space-y-2">
        {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
          <LoadErrorFallback />
        ) : loading ? (
          [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
        ) : filtered.length === 0 && !search && uncategorized.length === 0 ? null : filtered.length === 0 && (search || uncategorized.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Tag className="h-10 w-10 mb-3 opacity-30 text-stockshop-blue dark:text-blue-400" />
            <p className="text-sm">{search ? t('categories.no_results') : t('categories.none')}</p>
            {canEdit && !search && <p className="text-xs mt-1">{t('categories.add_hint')}</p>}
          </div>
        ) : isMultiShop ? (
          userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopCats = filtered.filter(c => c.shop_id === shopEntry.id)
            const shopUncategorized = !search ? products.filter(p => p.shop_id === shopEntry.id && !catOf(p)) : []
            if (shopCats.length === 0 && shopUncategorized.length === 0) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-2">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopCats.map(renderCategory)}
                {shopUncategorized.length > 0 && renderUncategorized(shopUncategorized, shopEntry.id)}
              </div>
            )
          })
        ) : (
          <>
            {filtered.map(renderCategory)}
            {!search && uncategorized.length > 0 && renderUncategorized(uncategorized, shop?.id || '')}
          </>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('categories.count', { count: filtered.length })} · {products.length} {t('categories.products_total')}
        </p>
      )}

      {/* Ajouter / modifier : une seule modale */}
      <PremiumDialog
        open={formOpen}
        onOpenChange={open => { if (!open) { setFormOpen(false); setEditingCat(null) } }}
        title={editingCat ? t('categories.edit_dialog_title') : t('categories.add_dialog_title')}
        description={editingCat?.name}
        icon={editingCat ? <Edit2 className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
        maxWidth="max-w-md"
        dirty={formDirty}
        testId="category-dialog"
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t('categories.name_label')}<RequiredMark /></Label>
            <Input
              id="cat-name"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder={t('categories.add_placeholder')}
              onKeyDown={e => e.key === 'Enter' && submitForm()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('categories.color_label')}</Label>
            <ColorPicker value={formColor} onChange={setFormColor} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-alert-days">{t('categories.expiry_alert_days_label')}</Label>
            <Input
              id="cat-alert-days"
              type="number"
              min={1}
              value={formAlertDays}
              onChange={e => setFormAlertDays(e.target.value)}
              placeholder={t('categories.expiry_alert_days_placeholder', { days: shop?.expiry_alert_days ?? 14 })}
            />
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => { setFormOpen(false); setEditingCat(null) }}
          cancelLabel={t('actions.cancel')}
          onConfirm={submitForm}
          confirmLabel={editingCat ? t('actions.save') : t('categories.add')}
          confirmDisabled={!formName.trim()}
          confirmLoading={saving}
          confirmIcon={editingCat ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        />
      </PremiumDialog>

      {/* Suppression : laisser les produits sans catégorie ou les déplacer */}
      <ConfirmModal
        open={!!deleteCat}
        onOpenChange={open => { if (!open && !deleting) setDeleteCat(null) }}
        category={t('actions.delete')}
        title={deleteCat ? t('categories.delete_confirm_title', { name: deleteCat.name }) : ''}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('actions.delete')}
        loading={deleting}
        disabled={deleteMode === 'move' && !moveTarget}
        onConfirm={confirmDelete}
        maxWidth="max-w-md"
      >
        {deleteProductIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('categories.delete_no_products')}</p>
        ) : (
          <div className="space-y-3" data-testid="category-delete-options">
            <p className="text-sm font-medium">{t('categories.delete_products_question', { count: deleteProductIds.length })}</p>
            <div className="space-y-2" role="radiogroup">
              {(['leave', 'move'] as const).map(mode => (
                <label key={mode} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors', deleteMode === mode ? 'border-stockshop-blue bg-stockshop-blue-muted dark:border-blue-700 dark:bg-blue-950/40' : 'hover:bg-muted/50', mode === 'move' && moveOptions.length === 0 && 'pointer-events-none opacity-50')}>
                  <input type="radio" name="delete-mode" className="accent-stockshop-blue" checked={deleteMode === mode} disabled={mode === 'move' && moveOptions.length === 0} onChange={() => setDeleteMode(mode)} />
                  {mode === 'leave' ? t('categories.delete_leave') : t('categories.delete_move')}
                </label>
              ))}
            </div>
            {deleteMode === 'move' && (
              <div className="space-y-1.5">
                <Label>{t('categories.delete_move_target')}<RequiredMark /></Label>
                <Select value={moveTarget} onValueChange={setMoveTarget}>
                  <SelectTrigger className="h-10" data-testid="category-move-target"><SelectValue placeholder={t('form.select_placeholder')} /></SelectTrigger>
                  <SelectContent>
                    {moveOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </ConfirmModal>

      {/* Restauration des catégories par défaut : confirmation explicative */}
      <ConfirmModal
        open={restoreOpen}
        onOpenChange={open => { if (!open && !seeding) setRestoreOpen(false) }}
        title={t('categories.restore_title')}
        description={t('categories.restore_confirm')}
        icon={<RotateCcw className="h-4 w-4" />}
        tone="primary"
        confirmLabel={t('categories.restore')}
        loading={seeding}
        onConfirm={restoreDefaults}
        maxWidth="max-w-md"
      />
    </div>
  )
}
