'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { CalendarClock, CheckCircle2, Edit2, FileSpreadsheet, FileText, MoreHorizontal, PackageMinus, Search, Store, Table2, Tag, X } from 'lucide-react'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { useTableExport } from '@/lib/export/use-table-export'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { fetchCosts } from '@/lib/costs/client'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'
import { isNeutralClick } from '@/lib/utils/open-on-click'
import { cn } from '@/lib/utils/cn'
import { getExpiryAlertDays } from '@/lib/utils/expiry'
import { generateReportPDFBlob } from '@/lib/utils/pdf'
import { saveFile } from '@/lib/utils/save-file'
import { batchExpiryStatus, compareBatchesForDisplay, fefoHeadIds, type BatchExpiryStatus } from '@/lib/stock/batch-status'
import { localToday } from '@/lib/stock/signals'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StockTabs } from '@/components/stock/stock-tabs'
import { ProductThumbnail } from '@/components/stock/product-thumbnail'
import { ProductSheetViewer } from '@/components/stock/product-sheet-viewer'
import { LotDetailDrawer, LotStatusBadge, countdownTone, useLotTexts, type LotRow } from '@/components/stock/lot-detail-drawer'
import { BatchAdjustDialog, BatchExpiryDialog, BatchPromoDialog, BatchRemoveConfirm } from '@/components/stock/batch-dialogs'
import type { Category } from '@/lib/types/database'

// Lots & péremptions : l'écran où l'on descend dans le détail des alertes de la
// Vue d'ensemble. « Quel lot demande mon attention ? » — produit, lot,
// péremption, quantité, statut, et rien d'autre dans la liste : la catégorie
// reste un filtre, la valeur et les actions vivent dans le détail du lot
// (LotDetailDrawer). Cartes sur téléphone et tablette, tableau sur ordinateur.
// La boutique est celle du sélecteur de l'en-tête, jamais un filtre local.
// Un lot n'a ni numéro ni réception d'origine enregistrés : il se désigne par
// sa date d'entrée. Les lots épuisés ne sont pas listés.

type StatusFilter = 'all' | 'attention' | BatchExpiryStatus
const STATUS_FILTERS: StatusFilter[] = ['all', 'attention', 'expired', 'expiring', 'ok', 'none']
/** Le tableau a besoin de place : en dessous, les cartes se lisent mieux (téléphone, tablette) */
const TABLE_MIN_WIDTH = '(min-width: 1280px)'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function ExpiryPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const texts = useLotTexts()
  const unitLabel = useUnitLabel()
  const { shop, effectiveShopIds, userShops } = useAuth()
  const { canAccess, canWrite, canViewCost } = useRolePermissions()
  // Coût de chaque lot : demandé au serveur seulement avec le droit de voir les prix d'achat (jamais lu par le
  // navigateur). Sans lui : ni valeur dans le détail, ni total à risque, ni valeur dans les exports.
  const [batchCosts, setBatchCosts] = useState<Record<string, number> | null>(null)
  const showValue = canViewCost && batchCosts !== null
  const valueOf = (b: { id: string; quantity: number }) => b.quantity * ((batchCosts || {})[b.id] || 0)
  /** Retire la colonne « Valeur » (la 4e) d'une ligne d'export quand elle n'est pas due */
  const exportCols = <T,>(row: T[]): T[] => (showValue ? row : row.filter((_, i) => i !== 3))
  // Règle unique : niveau « modification » de Produits / Stock
  const canWriteStock = canWrite('stock')
  const canSeeSuppliers = canAccess('suppliers')
  const { fmt: formatMoney, symbol } = useCurrency()
  const expiryExport = useTableExport()
  const supabase = createClient()
  const { toast } = useToast()
  const { isOnline } = useOffline()

  const [batches, setBatches] = useState<LotRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [{ search, categoryFilter, statusFilter }, setFilter] = usePersistedFilters(
    'expiry', shop?.id, { search: '', categoryFilter: 'all', statusFilter: 'all' as string }
  )
  const [exporting, setExporting] = useState(false)
  // Détail ouvert : seul l'identifiant est gardé, le lot affiché est toujours celui de la liste à jour
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetProductId, setSheetProductId] = useState<string | null>(null)
  const [adjustLot, setAdjustLot] = useState<LotRow | null>(null)
  const [expiryLot, setExpiryLot] = useState<LotRow | null>(null)
  const [promoLot, setPromoLot] = useState<LotRow | null>(null)
  const [removeLot, setRemoveLot] = useState<LotRow | null>(null)

  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(TABLE_MIN_WIDTH)
    const apply = () => setWide(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const fetchData = async () => {
    if (effectiveShopIds.length === 0) return
    try {
      const [batchesRes, categoriesRes] = await withTimeout(Promise.all([
        supabase
          .from('product_batches')
          // Le fournisseur du lot n'est lu qu'avec le droit de voir les fournisseurs
          .select(`id, shop_id, product_id, quantity, initial_quantity, expiry_date, received_at, source, promo_price, promo_until, promo_start${canSeeSuppliers ? ', suppliers(name)' : ''}, products(name, unit, sku, image_url, selling_price, category_id, categories(name, color, expiry_alert_days))`)
          .in('shop_id', effectiveShopIds)
          // Les lots épuisés ne sont pas listés
          .gt('quantity', 0)
          .order('expiry_date', { ascending: true, nullsFirst: false })
          .order('received_at', { ascending: true }),
        supabase.from('categories').select('*').in('shop_id', effectiveShopIds).order('name'),
      ]), 20_000, t('errors.generic'))
      if (batchesRes.error) throw batchesRes.error
      setBatches((batchesRes.data || []) as unknown as LotRow[])
      setCategories((categoriesRes.data || []) as Category[])
      if (canViewCost) fetchCosts(effectiveShopIds, { batches: true }).then(c => setBatchCosts(c ? c.batches : null)).catch(() => setBatchCosts(null))
      else setBatchCosts(null)
    } catch (err: any) {
      toast({ title: err.message || t('errors.generic'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [effectiveShopIds.join(','), canViewCost, canSeeSuppliers]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lien profond (Vue d'ensemble) : /stock/expiry?status=attention applique le
  // filtre Statut puis nettoie l'URL (replaceState natif, synchronisé avec le
  // routeur de Next 14), même mécanisme que la page Produits.
  const searchParams = useSearchParams()
  useEffect(() => {
    const s = searchParams.get('status')
    if (!s) return
    if ((STATUS_FILTERS as string[]).includes(s)) setFilter({ statusFilter: s })
    window.history.replaceState(window.history.state, '', `/${locale}/stock/expiry`)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps
  useRefetchOnVisible(() => fetchData())
  useRefetchOnReconnect(() => fetchData(), isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const today = localToday()
  const multiShop = effectiveShopIds.length > 1
  const shopById = useMemo(() => Object.fromEntries((userShops || []).map(s => [s.id, s])), [userShops])
  // Seuil « bientôt » : celui de la catégorie, sinon celui de la boutique DU LOT, sinon 14 jours
  const statusOf = (b: LotRow): BatchExpiryStatus =>
    batchExpiryStatus(b.expiry_date, getExpiryAlertDays(b.products?.categories?.expiry_alert_days, (shopById[b.shop_id] as any)?.expiry_alert_days ?? shop?.expiry_alert_days), today)
  const fefoHeads = useMemo(() => fefoHeadIds(batches), [batches])

  const currentStatus: StatusFilter = (STATUS_FILTERS as string[]).includes(statusFilter) ? statusFilter as StatusFilter : 'all'
  const needle = fold(search.trim())
  const filtered = batches.filter(b => {
    if (categoryFilter !== 'all' && b.products?.category_id !== categoryFilter) return false
    const status = statusOf(b)
    if (currentStatus === 'attention' ? !(status === 'expired' || status === 'expiring') : currentStatus !== 'all' && status !== currentStatus) return false
    if (!needle) return true
    // Un seul champ : produit, SKU / code-barres, fournisseur, et le lot par ce qui le désigne (date d'entrée, origine)
    const haystack = [b.products?.name, b.products?.sku, b.suppliers?.name, texts.lotLabel(b.received_at), t(`products.batch_source_${b.source}` as any)]
    return haystack.some(v => v && fold(String(v)).includes(needle))
  }).sort(compareBatchesForDisplay(statusOf))

  const filtersActive = !!needle || categoryFilter !== 'all' || currentStatus !== 'all'
  const resetFilters = () => setFilter({ search: '', categoryFilter: 'all', statusFilter: 'all' })
  const selected = selectedId ? batches.find(b => b.id === selectedId) ?? null : null

  // « À risque » = lots périmés ou proches de péremption parmi les lots affichés
  // (les lots sains ou sans date n'ont rien à risquer)
  const totalAtRisk = filtered.reduce((sum, b) => {
    const s = statusOf(b)
    return s === 'expired' || s === 'expiring' ? sum + valueOf(b) : sum
  }, 0)

  const exportRows = () => filtered.map(b => exportCols([
    b.products?.name || '—',
    b.products?.categories?.name || '—',
    String(b.quantity),
    formatMoney(valueOf(b)),
    format(new Date(b.received_at), 'dd/MM/yyyy'),
    b.expiry_date ? format(new Date(b.expiry_date), 'dd/MM/yyyy') : '—',
    texts.status(statusOf(b)),
  ]))

  const exportPDF = async () => {
    if (!shop) return
    setExporting(true)
    try {
      const result = await generateReportPDFBlob({
        shopName: shop.name,
        dateRange: format(new Date(), 'dd/MM/yyyy'),
        sections: [{
          title: t('expiry.title'),
          headers: exportCols([
            t('expiry.col_product'), t('expiry.col_category'), t('expiry.col_quantity'),
            t('expiry.col_value'), t('expiry.col_received'), t('expiry.col_expiry'), t('expiry.col_status'),
          ]),
          rows: exportRows(),
        }],
      })
      await saveFile(result.blob, `StockShop - Péremptions - ${shop.name}.pdf`)
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  // Export Excel / CSV des lots affichés : quantités et valeurs en nombres, vraies dates
  const exportExpiry = (fmtOut: 'xlsx' | 'csv') => {
    expiryExport.run({
      kind: expiryExport.kind('expiry'),
      shopName: (userShops || []).filter(x => effectiveShopIds.includes(x.id)).map(x => x.name).join(', ') || shop?.name || 'StockShop',
      columns: exportCols<any>([
        { header: t('expiry.col_product') }, { header: t('expiry.col_category') }, { header: t('expiry.col_quantity'), type: 'int' },
        { header: `${t('expiry.col_value')} (${symbol})`, type: 'money' }, { header: t('expiry.col_received'), type: 'date' },
        { header: t('expiry.col_expiry'), type: 'date' }, { header: t('expiry.col_status') },
      ]),
      rows: filtered.map(b => exportCols<any>([
        b.products?.name || '—', b.products?.categories?.name || '', b.quantity, valueOf(b),
        b.received_at ? new Date(b.received_at) : null, b.expiry_date ? new Date(b.expiry_date) : null, texts.status(statusOf(b)),
      ])),
      totals: exportCols<any>([t('exports.total'), null, filtered.reduce((n, b) => n + b.quantity, 0), filtered.reduce((n, b) => n + valueOf(b), 0), null, null, null]),
    }, fmtOut)
  }

  const statusFilterLabel = (s: StatusFilter) => (s === 'all' ? t('expiry.status_all') : s === 'attention' ? t('expiry.status_attention') : texts.status(s))
  // État vide : dit ce qui manque — et le dit comme une bonne nouvelle quand c'en est une
  const emptyState = (): { text: string; good: boolean } => {
    if (batches.length === 0) return { text: t('expiry.empty_all'), good: false }
    if (needle) return { text: t('expiry.empty_search'), good: false }
    if (categoryFilter === 'all') {
      if (currentStatus === 'attention') return { text: t('expiry.empty_attention'), good: true }
      if (currentStatus === 'expired') return { text: t('expiry.empty_expired'), good: true }
      if (currentStatus === 'expiring') return { text: t('expiry.empty_expiring'), good: true }
    }
    return { text: t('expiry.empty_filtered'), good: false }
  }

  const lotMenu = (b: LotRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('products.more_actions')} title={t('products.more_actions')} data-lot-menu>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={() => setAdjustLot(b)} className="gap-2.5"><Edit2 className="h-4 w-4 shrink-0" />{t('products.adjust_quantity_action')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setExpiryLot(b)} className="gap-2.5"><CalendarClock className="h-4 w-4 shrink-0" />{t('products.edit_expiry_action')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPromoLot(b)} className="gap-2.5"><Tag className="h-4 w-4 shrink-0" />{t('products.promo_action')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setRemoveLot(b)} className="gap-2.5 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"><PackageMinus className="h-4 w-4 shrink-0" />{t('expiry.action_remove')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const empty = !loading && filtered.length === 0 ? emptyState() : null

  return (
    <div className="space-y-3">
      <StockTabs locale={locale} />

      {/* Le titre est déjà dans l'en-tête et dans l'onglet : ici, une ligne suffit */}
      <h1 className="sr-only">{t('expiry.title')}</h1>
      <p className="text-sm text-muted-foreground" data-testid="lots-subtitle">{t('expiry.subtitle')}</p>

      <div className="flex flex-wrap items-center gap-2" data-testid="lots-toolbar">
        {/* Recherche sur sa propre ligne tant que la place manque (téléphone, tablette avec le menu latéral) */}
        <div className="relative min-w-0 basis-full lg:basis-0 lg:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search" value={search} onChange={e => setFilter({ search: e.target.value })}
            placeholder={t('expiry.search_placeholder')} aria-label={t('expiry.search_placeholder')}
            className="h-12 pl-9 pr-9 sm:h-9 [&::-webkit-search-cancel-button]:hidden" data-testid="lots-search"
          />
          {search && (
            <button type="button" onClick={() => setFilter({ search: '' })} aria-label={t('products.reset_filters')} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground sm:h-7 sm:w-7">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={categoryFilter} onValueChange={v => setFilter({ categoryFilter: v })}>
          <SelectTrigger className="h-12 min-w-0 flex-1 sm:h-9 lg:w-[190px] lg:flex-none" aria-label={t('products.category')} data-testid="lots-category">
            {/* Au repos, le sélecteur porte son nom (« Toutes catégories » ne tient pas sur un téléphone) */}
            <SelectValue>{categoryFilter === 'all' ? t('products.category') : <span className="truncate">{categories.find(c => c.id === categoryFilter)?.name ?? t('products.category')}</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">{t('expiry.all_categories')}</SelectItem>
            {categories.map(c => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-1.5">
                  {c.color && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: c.color }} />}
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={currentStatus} onValueChange={v => setFilter({ statusFilter: v })}>
          <SelectTrigger className="h-12 min-w-0 flex-1 sm:h-9 lg:w-[170px] lg:flex-none" aria-label={t('products.status_label')} data-testid="lots-status">
            {/* « Tous » seul ne dit pas de quoi : le sélecteur au repos porte son nom */}
            <SelectValue>{currentStatus === 'all' ? t('products.status_label') : statusFilterLabel(currentStatus)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map(s => <SelectItem key={s} value={s}>{statusFilterLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-12 w-12 flex-shrink-0 sm:h-9 sm:w-9" loading={exporting || expiryExport.exporting} aria-label={t('products.more_actions')} title={t('products.more_actions')} data-testid="lots-more-actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => exportExpiry('xlsx')} className="gap-2.5 py-2.5" data-testid="export-xlsx">
                <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
                {t('exports.excel')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportExpiry('csv')} className="gap-2.5 py-2.5" data-testid="export-csv">
                <Table2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                {t('exports.csv')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPDF} className="gap-2.5 py-2.5" data-testid="export-pdf">
                <FileText className="h-4 w-4 flex-shrink-0 text-red-500" />
                {t('actions.export_pdf')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!loading && batches.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span data-testid="lots-count">{t('expiry.count', { count: filtered.length })}</span>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="font-medium text-stockshop-blue hover:underline dark:text-blue-400" data-testid="lots-reset">
              {t('products.reset_filters')}
            </button>
          )}
        </div>
      )}

      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-2 xl:grid-cols-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl xl:h-14" />)}</div>
      ) : empty ? (
        <div className="py-14 text-center text-sm text-muted-foreground" data-testid="lots-empty" data-good={empty.good}>
          {empty.good
            ? <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600 dark:text-green-400" />
            : <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-40" />}
          <p className={empty.good ? 'font-medium text-foreground' : undefined}>{empty.text}</p>
          {filtersActive && batches.length > 0 && (
            <button type="button" onClick={resetFilters} className="mt-2 font-medium text-stockshop-blue hover:underline dark:text-blue-400">{t('products.reset_filters')}</button>
          )}
        </div>
      ) : (
        <>
          {wide ? (
            <div className="overflow-hidden rounded-xl border" data-testid="lots-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">{t('expiry.col_product')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('expiry.col_lot')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('expiry.col_expiry')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('expiry.col_remaining')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('expiry.col_status')}</th>
                    {canWriteStock && <th className="w-12 px-2 py-2"><span className="sr-only">{t('products.more_actions')}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(b => {
                    const status = statusOf(b)
                    const p = b.products
                    return (
                      <tr
                        key={b.id} data-lot={b.id} data-lot-row data-status={status}
                        onClick={e => { if (isNeutralClick(e)) setSelectedId(b.id) }}
                        className="group cursor-pointer border-b transition-colors last:border-0 focus-within:bg-muted/40 hover:bg-muted/40"
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <ProductThumbnail src={p?.image_url} alt={p?.name || ''} className="h-9 w-9 shrink-0" />
                            <div className="min-w-0">
                              <button type="button" onClick={() => setSelectedId(b.id)} data-lot-name className="block max-w-full truncate rounded text-left font-medium hover:text-stockshop-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-400">
                                {p?.name || '—'}
                              </button>
                              {(p?.sku || multiShop) && (
                                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                  {p?.sku && <span className="font-mono">{p.sku}</span>}
                                  {multiShop && shopById[b.shop_id] && <span className="inline-flex items-center gap-1" data-lot-shop><Store className="h-3 w-3 shrink-0" />{shopById[b.shop_id].name}</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <p data-lot-label>{texts.lotLabel(b.received_at)}</p>
                          <p className="text-xs text-muted-foreground">{t(`products.batch_source_${b.source}` as any)}</p>
                        </td>
                        <td className="px-3 py-2">
                          {b.expiry_date ? (
                            <>
                              <p className={cn('font-medium', countdownTone(status))} data-lot-countdown>{texts.countdown(b.expiry_date, today)}</p>
                              <p className="text-xs text-muted-foreground" data-lot-date>{texts.day(b.expiry_date)}</p>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums" data-lot-qty>{b.quantity} <span className="font-normal text-muted-foreground">{unitLabel(p?.unit, b.quantity)}</span></td>
                        <td className="px-3 py-2"><LotStatusBadge status={status} /></td>
                        {canWriteStock && <td className="px-2 py-2 text-right">{lotMenu(b)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            // Autant de colonnes que la place le permet : une sur téléphone et tablette en portrait, deux au-delà
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-2" data-testid="lots-cards">
              {filtered.map(b => {
                const status = statusOf(b)
                const p = b.products
                return (
                  <li key={b.id} className="min-w-0">
                    {/* La carte entière ouvre le détail : aucune action dessus */}
                    <button
                      type="button" data-lot={b.id} data-lot-card data-status={status} onClick={() => setSelectedId(b.id)}
                      className="flex h-full w-full items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-stockshop-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue/50 active:bg-muted/60"
                    >
                      <ProductThumbnail src={p?.image_url} alt={p?.name || ''} className="h-11 w-11 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-sm font-semibold leading-snug" data-lot-name>{p?.name || '—'}</span>
                            <span className="block truncate text-xs text-muted-foreground" data-lot-label>{texts.lotLabel(b.received_at)}</span>
                            {multiShop && shopById[b.shop_id] && (
                              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground" data-lot-shop><Store className="h-3 w-3 shrink-0" />{shopById[b.shop_id].name}</span>
                            )}
                          </span>
                          <LotStatusBadge status={status} />
                        </span>
                        <span className="mt-2 flex items-end justify-between gap-3">
                          <span className="text-sm font-semibold tabular-nums" data-lot-qty>{b.quantity} {unitLabel(p?.unit, b.quantity)}</span>
                          {b.expiry_date && (
                            <span className="min-w-0 text-right">
                              <span className={cn('block text-sm font-medium', countdownTone(status))} data-lot-countdown>{texts.countdown(b.expiry_date, today)}</span>
                              <span className="block text-xs text-muted-foreground" data-lot-date>{texts.day(b.expiry_date)}</span>
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {showValue && (
            <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-2.5" data-testid="expiry-total-at-risk">
              <span className="text-sm text-muted-foreground">{t('expiry.total_at_risk')}</span>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(totalAtRisk)}</span>
            </div>
          )}
        </>
      )}

      <LotDetailDrawer
        lot={selected}
        status={selected ? statusOf(selected) : 'none'}
        today={today}
        onClose={() => setSelectedId(null)}
        shopName={selected && multiShop ? shopById[selected.shop_id]?.name : null}
        cost={selected && showValue && batchCosts && selected.id in batchCosts ? batchCosts[selected.id] : null}
        formatPrice={formatMoney}
        fefoFirst={!!selected && fefoHeads.has(selected.id)}
        canWrite={canWriteStock}
        onViewProduct={canAccess('stock') ? id => setSheetProductId(id) : undefined}
        onAdjust={setAdjustLot}
        onEditExpiry={setExpiryLot}
        onPromo={setPromoLot}
        onRemove={setRemoveLot}
      />
      <ProductSheetViewer productId={sheetProductId} onClose={() => setSheetProductId(null)} />

      {/* Fenêtres d'action : routes existantes, la liste se recharge sans quitter l'écran ni perdre filtres et défilement */}
      <BatchAdjustDialog batch={adjustLot} onClose={() => setAdjustLot(null)} onSaved={fetchData} />
      <BatchExpiryDialog batch={expiryLot} onClose={() => setExpiryLot(null)} onSaved={fetchData} />
      <BatchPromoDialog
        batch={promoLot ? { ...promoLot, productName: promoLot.products?.name || '', sellingPrice: Number(promoLot.products?.selling_price) || 0, cost: showValue && batchCosts ? batchCosts[promoLot.id] ?? null : null } : null}
        onClose={() => setPromoLot(null)} onSaved={fetchData} formatPrice={formatMoney}
      />
      <BatchRemoveConfirm batch={removeLot} expired={!!removeLot && statusOf(removeLot) === 'expired'} onClose={() => setRemoveLot(null)} onSaved={fetchData} />
    </div>
  )
}
