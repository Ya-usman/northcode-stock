'use client'

import { useState, useEffect, useMemo, Fragment, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useTranslations } from 'next-intl'
import {
  Search, FileDown, FileText, Table2, ChevronDown, ChevronUp,
  XCircle, CheckCircle2, Printer, Share2, Store, CornerDownLeft, Activity, Edit2, Trash2, Plus, Clock, ShoppingCart, FileSpreadsheet,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { ShopScopeBadge } from '@/components/shops/shop-scope-badge'
import { useFilterScope } from '@/lib/filters/use-filter-scope'
import { EmptyGuide } from '@/components/onboarding/empty-guide'
import { useTableExport } from '@/lib/export/use-table-export'
import { isManagerial } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useCurrency } from '@/lib/hooks/use-currency'
import { formatCurrency } from '@/lib/utils/currency'
import { resolveCurrencyCode, currencySymbol } from '@/lib/saas/currencies'
import { sharePDFNative, isCapacitor } from '@/lib/utils/native-share'
import { getCountry, getPaymentMethodLabel } from '@/lib/saas/countries'
import { useLocale } from 'next-intl'
import { describeSaleLog } from '@/lib/sales/journal'
import { dateFnsLocale, dateLocaleTag } from '@/lib/i18n/date-format'
import { readTicketSettings } from '@/lib/receipt/print-settings'
import { printSaleTicket, ticketErrorKey } from '@/lib/receipt/print-ticket'
import { ticketLabelsFromT } from '@/lib/receipt/ticket'
import { receiptUrl } from '@/lib/receipt/receipt-link'
import { receiptLabelsFromT } from '@/lib/receipt/receipt-labels'
import { hideStockShopBranding } from '@/lib/receipt/branding'
import { normalize } from '@/lib/utils/normalize'
import { withTimeout } from '@/lib/utils/with-timeout'
import { format, parseISO, startOfDay, endOfDay, subDays, subMonths, startOfWeek, startOfMonth, startOfYear } from 'date-fns'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Sale } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { getPendingSales, type PendingSale } from '@/lib/offline/db'
import { invalidateSalesData } from '@/lib/query-keys'
import { queryClient } from '@/lib/query-client'
import { onSalesDataChanged } from '@/lib/data-refresh'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'


const supabase = createClient() as any

const statusVariant: Record<string, any> = {
  paid: 'success', partial: 'warning', pending: 'danger',
}

type DialogType = 'cancel' | 'validate'

export default function SalesHistoryPage() {
  const t = useTranslations()
  const { profile, effectiveShopIds, userShops, roleByShop } = useAuth()
  // Contexte boutique : l'en-tête décide de ce que l'on voit ; une vente existante agit dans SA boutique (droits,
  // devise, pays, produits et clients proposés en modification) — jamais la boutique active cachée.
  const scope = useShopScope()
  const scopeKey = scope.shopIds.join(',')
  const filterScope = useFilterScope()
  const isMultiShop = effectiveShopIds.length > 1
  const shopOf = (shopId?: string | null) => userShops.find(x => x.id === shopId) ?? null

  // Libellé d'un mode de paiement dans le pays de la boutique DE LA VENTE. Traduit d'abord (Espèces / Cash, Carte,
  // Virement, Crédit) ; sinon nom de marque du pays (Orange Money, MTN MoMo…)
  const payMethodLabel = (method: string, shopId?: string | null) => {
    if (!method) return ''
    if (t.has(`payment.${method}` as any)) return t(`payment.${method}` as any)
    const m = getCountry(shopOf(shopId)?.country).paymentMethods.find(x => x.id === method)
    return m?.label ?? getPaymentMethodLabel(method) ?? method
  }

  // Collect all mobile-money method IDs across every shop the user has access to
  const mobileMoneyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of userShops || []) {
      getCountry(s.country).paymentMethods
        .filter(m => m.type === 'mobile_money')
        .forEach(m => ids.add(m.id))
    }
    return Array.from(ids)
  }, [userShops])

  // Même liste que Nouvelle vente : l'ancienne, incomplète, laissait le PDF en anglais par endroits
  const receiptLabels = receiptLabelsFromT(t)

  const locale = useLocale()
  // « Reçu PDF » : s'ouvre / se partage (l'impression, c'est le ticket)
  const printSale = async (sale: Sale) => {
    // Boutique DE LA VENTE (même règle que le ticket), jamais la boutique active
    const saleShop = userShops.find(x => x.id === (sale as any).shop_id)
    if (!saleShop) return
    const { generateReceiptPDFBlob } = await import('@/lib/utils/pdf')
    const blob = await generateReceiptPDFBlob({
      sale: sale as any,
      shop: saleShop,
      cashierName: cashierMap[(sale as any).cashier_id] || t('sales.cashier'),
      customerName: (sale as any).customers?.name || undefined,
      labels: receiptLabels,
      locale,
      hideBranding: hideStockShopBranding(saleShop),
    })
    try {
      await sharePDFNative(blob, `Recu-${sale.sale_number}.pdf`, `Recu-${sale.sale_number}`)
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: err?.message || 'Erreur', variant: 'destructive' })
    }
  }
  // Réimpression du ticket de caisse (mêmes réglages par appareil que Nouvelle vente).
  // Le montant reçu / la monnaie rendue ne sont pas conservés : la ligne n'apparaît pas.
  const printTicket = async (sale: Sale) => {
    const s: any = sale
    // Boutique DE LA VENTE : en « Toutes les boutiques », la boutique active peut être une autre boutique
    // (son nom, son logo, ses mentions et sa devise n'ont rien à faire sur ce ticket)
    const saleShop = userShops.find(x => x.id === s.shop_id)
    if (!saleShop) return
    const code = resolveCurrencyCode(saleShop.currency, saleShop.country)
    try {
      await printSaleTicket({
        settings: readTicketSettings(),
        fileName: `Ticket-${sale.sale_number}.pdf`,
        logoUrl: saleShop.logo_url,
        data: {
          shop: { name: saleShop.name, city: saleShop.city, state: saleShop.state, whatsapp: saleShop.whatsapp, tagline: saleShop.receipt_tagline, legalIds: saleShop.receipt_legal_ids },
          footerMessage: saleShop.receipt_footer,
          receiptUrl: receiptUrl(sale.receipt_token),
          saleNumber: sale.sale_number,
          createdAt: sale.created_at,
          items: (s.sale_items || []).map((i: any) => ({ name: i.product_name, qty: Number(i.quantity), unitPrice: Number(i.unit_price), subtotal: Number(i.subtotal) })),
          subtotal: Number(sale.subtotal), discount: Number(sale.discount), tax: Number(sale.tax), total: Number(sale.total),
          amountPaid: Number(sale.amount_paid), balance: Number(sale.balance),
          paymentLabel: (sale.payment_method as string) === 'mixed' ? t('receipt.method_mixed') : payMethodLabel(sale.payment_method, s.shop_id),
          cashierName: cashierMap[s.cashier_id] || t('sales.cashier'),
          customerName: s.customers?.name || undefined,
          locale,
          fmt: n => code === 'NGN' ? `NGN ${Math.round(n).toLocaleString('en-NG')}` : formatCurrency(n, code),
          fmtShort: n => Math.round(n).toLocaleString(locale),
          labels: ticketLabelsFromT(t),
          hideBranding: hideStockShopBranding(saleShop),
        },
      })
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: t(ticketErrorKey(err)), variant: 'destructive' })
    }
  }
  // Totaux agrégés : devise d'affichage actuelle (décision D1, lot 5). Montants d'une vente : devise de SA boutique.
  const { fmt: formatNaira } = useCurrency()
  const fmtIn = (shopId?: string | null) => {
    const sh = shopOf(shopId)
    return sh ? (v: number) => formatCurrency(v, resolveCurrencyCode(sh.currency, sh.country)) : formatNaira
  }
  const symbolIn = (shopId?: string | null) => {
    const sh = shopOf(shopId)
    return sh ? currencySymbol(resolveCurrencyCode(sh.currency, sh.country)) : ''
  }
  // Périmètre réel (titres des exports) : « Toutes les boutiques » ou la boutique de l'en-tête
  const scopeTitle = scope.isAllShops && scope.multiShop ? t('scope.all_shops') : (scope.shopName || userShops[0]?.name || 'StockShop')
  const { toast } = useToast()

  const PAGE_SIZE = 100
  const SEARCH_LIMIT = 500

  const [view, setView] = useState<'sales' | 'repayments' | 'logs'>('sales')
  const [cashierMap, setCashierMap] = useState<Record<string, string>>({})
  const [repayments, setRepayments] = useState<any[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [salesOffset, setSalesOffset] = useState(0)
  const [hasMoreSales, setHasMoreSales] = useState(false)
  const [periodStats, setPeriodStats] = useState<{ count: number; ca: number; collected: number; balance: number } | null>(null)
  const [persistedFilters, setPersistedFilter] = usePersistedFilters(
    'sales_history', filterScope,
    { search: '', dateFilter: 'today', methodFilter: 'all', statusFilter: 'all', saleStatusFilter: 'all' as 'all' | 'active' | 'cancelled', customStart: '', customEnd: '' },
    { keepPerScope: true }
  )
  // Vente CIBLÉE (?sale_id=…, « Voir la vente » depuis Stock › Mouvements) : relue avec les droits de l'utilisateur
  // (base + règle « ses propres ventes » du caissier), dans le contexte de l'en-tête — jamais une boutique cachée.
  // Ses filtres (jour de la vente + numéro) sont TEMPORAIRES : rien n'est mémorisé tant que l'utilisateur ne
  // change pas lui-même un filtre ; ses préférences restent intactes. Vente introuvable ou inaccessible : message
  // générique, aucun détail.
  const router = useRouter()
  const pathname = usePathname()
  const targetSaleId = useSearchParams().get('sale_id')
  const [target, setTarget] = useState<{ id: string; number: string; day: string } | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)
  const targetOverride = target ? {
    search: target.number, dateFilter: 'custom', customStart: target.day, customEnd: target.day,
    methodFilter: 'all', statusFilter: 'all', saleStatusFilter: 'all' as 'all' | 'active' | 'cancelled',
  } : null
  const { search, dateFilter, methodFilter, statusFilter, saleStatusFilter, customStart, customEnd } = targetOverride ? { ...persistedFilters, ...targetOverride } : persistedFilters
  const dropTarget = () => {
    setTarget(null); setTargetMissing(false)
    if (targetSaleId) router.replace(pathname)
  }
  // Un changement de filtre par l'utilisateur part de ce qu'il voit, puis quitte le mode « vente ciblée »
  const setFilter = (updates: Partial<typeof persistedFilters>) => {
    if (targetOverride) { setPersistedFilter({ ...targetOverride, ...updates }); dropTarget() }
    else setPersistedFilter(updates)
  }
  // Lazy initializers: read cache synchronously so first render shows cached data, not a skeleton.
  // Search mode fetches a different row count (SEARCH_LIMIT, unpaginated)
  // than normal browsing (PAGE_SIZE) — the cache key carries a distinct
  // suffix for it so a paginated cache never gets served (and truncates
  // results) under search, or vice versa, while still caching both modes
  // instead of skipping the cache entirely whenever search is active.
  const _sfx = dateFilter === 'custom' ? `_${customStart}_${customEnd}` : ''
  const _salesCacheKey = `sales_history_v2_${effectiveShopIds.join(',')}_${dateFilter}${_sfx}_${methodFilter}_${statusFilter}_${saleStatusFilter}${search.trim() ? '_search' : ''}`
  const [sales, setSales] = useState<Sale[]>(() => getPageCache<Sale[]>(_salesCacheKey) || [])
  const [loading, setLoading] = useState(() => !getPageCache(_salesCacheKey))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Dialog state
  const [dialog, setDialog] = useState<{ type: DialogType; sale: Sale } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [validateAmount, setValidateAmount] = useState('')
  const [validateMethod, setValidateMethod] = useState('cash')
  const [actionLoading, setActionLoading] = useState(false)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const { isOnline, pendingCount } = useOffline()
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstSearchRender = useRef(true)

  // Edit dialog state
  type EditItem = { product_id: string | null; product_name: string; quantity: number; unit_price: number }
  const [editDialog, setEditDialog] = useState<Sale | null>(null)
  // Garde « modifications non enregistrées » : photo du formulaire prise à l'ouverture
  const [editInitial, setEditInitial] = useState('')
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null)
  const [editCustomerQuery, setEditCustomerQuery] = useState('')
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash')
  const [editNotes, setEditNotes] = useState('')
  const [editProductQuery, setEditProductQuery] = useState('')
  const [editProducts, setEditProducts] = useState<any[]>([])
  const [editCustomers, setEditCustomers] = useState<any[]>([])
  const [editSaving, setEditSaving] = useState(false)


  // Droits évalués dans la boutique DE LA VENTE avec le rôle de la personne DANS cette boutique : direction avec
  // « Historique des ventes » en modification (même règle que /api/sales/edit et /api/sales/cancel) ; un caissier
  // garde sa vente du jour. Boutique sans rôle = aucun droit.
  const { canWriteIn, canAccessIn } = useShopPermissions()
  const isOwnerIn = (id?: string | null) => !!id && isManagerial(roleByShop[id]) && canWriteIn(id, 'sales_history')
  const isCashierIn = (id?: string | null) => !!id && roleByShop[id] === 'cashier'
  // Résumés et exports : direction dans au moins une boutique du contexte
  const isOwner = scope.shopIds.some(id => isOwnerIn(id))
  // Journal : direction ET « Historique des ventes » en consultation (même règle que /api/sales/logs)
  const canSeeLogs = scope.shopIds.some(id => isManagerial(roleByShop[id]) && canAccessIn(id, 'sales_history'))
  // Caissier : seulement ses propres ventes, dans les boutiques où il est caissier (avant : appliqué à TOUTES les
  // boutiques selon le rôle de la boutique cachée)
  const cashierShopIds = effectiveShopIds.filter(id => isCashierIn(id))
  const otherShopIds = effectiveShopIds.filter(id => !isCashierIn(id))
  const onlyMine = (q: any, col: string) => {
    if (!cashierShopIds.length || !profile?.id) return q
    if (!otherShopIds.length) return q.eq(col, profile.id)
    return q.or(`${col}.eq.${profile.id},shop_id.in.(${otherShopIds.join(',')})`)
  }

  // Vente ciblée : lue par la base sous les droits de l'utilisateur, limitée au contexte et aux ventes qu'il voit
  useEffect(() => {
    if (!targetSaleId) { setTarget(null); setTargetMissing(false); return }
    if (!effectiveShopIds.length) return
    let cancelled = false
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetSaleId)
    const read = valid
      ? onlyMine(supabase.from('sales').select('id, sale_number, created_at').eq('id', targetSaleId).in('shop_id', effectiveShopIds).in('sale_status', ['active', 'cancelled']), 'cashier_id').maybeSingle()
      : Promise.resolve({ data: null })
    Promise.resolve(read).then(({ data }: any) => {
      if (cancelled) return
      if (!data) { setTarget(null); setTargetMissing(true); return }
      const d = new Date(data.created_at)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      setTargetMissing(false); setView('sales'); setTarget({ id: data.id, number: data.sale_number, day })
    }).catch(() => { if (!cancelled) { setTarget(null); setTargetMissing(true) } })
    return () => { cancelled = true }
  }, [targetSaleId, effectiveShopIds.join(','), cashierShopIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  // La vente ciblée, une fois chargée dans la liste, est dépliée (détail existant) et amenée à l'écran
  useEffect(() => {
    if (!target || loading || !sales.some(s => s.id === target.id)) return
    setExpandedId(target.id)
    requestAnimationFrame(() => document.querySelector(`[data-sale-row="${target.id}"]`)?.scrollIntoView({ block: 'center' }))
  }, [target?.id, loading, sales]) // eslint-disable-line react-hooks/exhaustive-deps

  // Écran vide guidé : seulement si la boutique n'a JAMAIS vendu (une journée
  // sans vente chez un commerçant installé garde le message court habituel)
  const [neverSold, setNeverSold] = useState(false)
  const soldShopsKey = effectiveShopIds.join(',')
  useEffect(() => {
    if (loading || sales.length > 0 || !soldShopsKey) { setNeverSold(false); return }
    let cancelled = false
    supabase.from('sales').select('id', { count: 'exact', head: true }).in('shop_id', soldShopsKey.split(','))
      .then(({ count, error }: any) => { if (!cancelled) setNeverSold(!error && count === 0) })
    return () => { cancelled = true }
  }, [loading, sales.length, soldShopsKey])

  const getDateBounds = () => {
    const now = new Date()
    let start: Date
    let end = endOfDay(now)
    switch (dateFilter) {
      case 'today': start = startOfDay(now); break
      case 'week': start = startOfWeek(now, { weekStartsOn: 1 }); break
      case 'month': start = startOfMonth(now); break
      case 'quarter': start = subMonths(now, 3); break
      case 'semester': start = subMonths(now, 6); break
      case 'year': start = startOfYear(now); break
      case 'yesterday':
        start = startOfDay(subDays(now, 1))
        end   = endOfDay(subDays(now, 1))
        break
      case 'custom':
        // « AAAA-MM-JJ » lu à minuit LOCAL (new Date(…) le lisait en UTC : un jour plus tôt dans un fuseau négatif)
        start = customStart ? startOfDay(parseISO(customStart)) : startOfDay(subDays(now, 1))
        end   = customEnd   ? endOfDay(parseISO(customEnd))     : endOfDay(now)
        break
      default: start = startOfDay(now)
    }
    return { start, end }
  }

  const buildSalesQuery = (start: Date, end: Date, offset: number, searchMode = false) => {
    let query = supabase
      .from('sales')
      .select('*, customers(name, phone), sale_items(product_id, product_name, quantity, unit_price, subtotal, stock_shortfall, products(image_url))')
      .in('shop_id', effectiveShopIds)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })

    if (searchMode) {
      query = query.limit(SEARCH_LIMIT)
    } else {
      query = query.range(offset, offset + PAGE_SIZE - 1)
    }

    query = onlyMine(query, 'cashier_id')
    if (methodFilter === 'mobile_money') query = query.in('payment_method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') query = query.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter)
    // « Toutes » = ventes actives et annulées — jamais les reprises de dette (pas des ventes, migration 168)
    if (saleStatusFilter !== 'all') query = query.eq('sale_status', saleStatusFilter)
    else query = query.in('sale_status', ['active', 'cancelled'])
    return query
  }

  // Aggregate query for accurate period totals (not limited by page size).
  // sale_status must mirror buildSalesQuery's own filter exactly — the "Vente"
  // dropdown defaults to "all" (active + cancelled together, like the list
  // below), so hardcoding 'active' here made the summary count/CA never match
  // the number of rows actually shown whenever a cancelled sale existed in
  // the period.
  const buildStatsQuery = (start: Date, end: Date) => {
    let q = supabase
      .from('sales')
      .select('total, amount_paid, balance, sale_status')
      .in('shop_id', effectiveShopIds)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
    if (saleStatusFilter !== 'all') q = q.eq('sale_status', saleStatusFilter)
    else q = q.in('sale_status', ['active', 'cancelled'])
    q = onlyMine(q, 'cashier_id')
    if (methodFilter === 'mobile_money') q = q.in('payment_method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') q = q.eq('payment_method', methodFilter)
    if (statusFilter !== 'all') q = q.eq('payment_status', statusFilter)
    return q
  }

  // Cash actually collected during the period — sourced from the payments
  // ledger (paid_at), not from sales.amount_paid (created_at). A debt
  // repayment collected today retroactively bumps the ORIGINAL sale's
  // amount_paid, which stays dated to when the sale was created — so a
  // stats query keyed on sales.created_at silently attributes that cash to
  // the wrong day (or misses it entirely from "today"). Querying payments
  // directly by paid_at attributes every cash-in event (initial payment or
  // later repayment alike) to the day it was actually received.
  const buildCollectedQuery = (start: Date, end: Date, shopIds: string[] = effectiveShopIds, mine = false) => {
    let q = supabase
      .from('payments')
      .select('amount, sales!inner(shop_id, sale_status)')
      .in('sales.shop_id', shopIds.length ? shopIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('is_cancelled', false)
      .eq('is_write_off', false)
      .gte('paid_at', start.toISOString())
      .lte('paid_at', end.toISOString())
    if (saleStatusFilter !== 'all') q = q.eq('sales.sale_status', saleStatusFilter)
    if (mine) q = q.eq('received_by', profile!.id)
    if (methodFilter === 'mobile_money') q = q.in('method', mobileMoneyIds.length ? mobileMoneyIds : ['__none__'])
    else if (methodFilter !== 'all') q = q.eq('method', methodFilter)
    return q
  }

  const enrichCashiers = async (salesData: Sale[], existingMap: Record<string, string> = {}) => {
    const ids = Array.from(new Set(salesData.map((s: any) => s.cashier_id).filter((id: string) => id && !existingMap[id]))) as string[]
    if (!ids.length) return existingMap
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
    const map = { ...existingMap }
    for (const p of (profiles || [])) map[p.id] = p.full_name
    return map
  }

  const fetchSales = async () => {
    if (!effectiveShopIds.length) return
    setSalesOffset(0)
    const isSearchMode = search.trim().length > 0
    const customSuffix = dateFilter === 'custom' ? `_${customStart}_${customEnd}` : ''
    const cacheKey = `sales_history_v2_${effectiveShopIds.join(',')}_${dateFilter}${customSuffix}_${methodFilter}_${statusFilter}_${saleStatusFilter}${isSearchMode ? '_search' : ''}`
    const cached = getPageCache<Sale[]>(cacheKey)
    if (cached) {
      setSales(cached)
      setHasMoreSales(false)
      setLoading(false)
      // Enrich cashier names in background — don't block render
      enrichCashiers(cached).then(map => setCashierMap(map))
    } else {
      setLoading(true)
    }
    if (!isOnline) {
      // This exact filter combination (period + method + status + sale
      // status all together form the cache key) was never cached, and
      // there's no network to fetch it fresh — without this, loading stayed
      // true forever (the skeleton spun indefinitely) while count/CA/encaissé
      // kept showing whatever the LAST successfully fetched filter left
      // behind, mismatched against the empty table underneath.
      if (!cached) {
        setSales([])
        setHasMoreSales(false)
        setPeriodStats({ count: 0, ca: 0, collected: 0, balance: 0 })
        setLoading(false)
      }
      return
    }
    try {
      const { start, end } = getDateBounds()
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const mixed = cashierShopIds.length > 0 && otherShopIds.length > 0
      const [listResult, statsResult, collectedResult, collectedMine] = await withTimeout(Promise.all([
        buildSalesQuery(start, end, 0, isSearchMode),
        buildStatsQuery(start, end),
        cashierShopIds.length && !mixed ? buildCollectedQuery(start, end, cashierShopIds, true) : buildCollectedQuery(start, end, mixed ? otherShopIds : effectiveShopIds),
        mixed ? buildCollectedQuery(start, end, cashierShopIds, true) : Promise.resolve({ data: [], error: null }),
      ]), 20_000, 'Chargement des ventes trop lent — réessayez.')
      // A transient auth/RLS hiccup can resolve statsResult/collectedResult
      // with data: null instead of throwing — without this, listResult.error
      // alone let a failure limited to just these two silently reset the
      // owner-facing summary bar (count/CA/encaissé/solde) to zero while the
      // sales table underneath still looked fine.
      if (listResult.error || statsResult.error || collectedResult.error || collectedMine.error) {
        throw listResult.error || statsResult.error || collectedResult.error || collectedMine.error
      }
      const salesData = (listResult.data || []) as Sale[]
      const statsRows = (statsResult.data || []) as Array<{ total: number; amount_paid: number; balance: number; sale_status: string }>
      const collectedRows = [...(collectedResult.data || []), ...(collectedMine.data || [])] as Array<{ amount: number }>
      setSales(salesData)
      setHasMoreSales(!isSearchMode && salesData.length === PAGE_SIZE)
      setCashierMap(await enrichCashiers(salesData))
      setPageCache(cacheKey, salesData)
      setPeriodStats({
        count:     statsRows.length,
        ca:        statsRows.reduce((s, r) => s + Number(r.total), 0),
        collected: collectedRows.reduce((s, r) => s + Number(r.amount), 0),
        // A cancelled sale's balance is never real debt — cancelling already
        // reverses customers.total_debt (cancel_sale RPC), but sales.balance
        // itself is a generated column (total - amount_paid) that keeps
        // reflecting the sale's own arithmetic regardless of sale_status.
        // Summing it blindly here would double-count debt that no longer
        // exists whenever "Toutes ventes" includes cancelled rows.
        balance:   statsRows.filter(r => r.sale_status !== 'cancelled').reduce((s, r) => s + Number(r.balance), 0),
      })
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  const loadMoreSales = async () => {
    if (!effectiveShopIds.length || loadingMore) return
    setLoadingMore(true)
    const nextOffset = salesOffset + PAGE_SIZE
    const { start, end } = getDateBounds()
    const { data } = await buildSalesQuery(start, end, nextOffset)
    const more = (data || []) as Sale[]
    setSales(prev => [...prev, ...more])
    setSalesOffset(nextOffset)
    setHasMoreSales(more.length === PAGE_SIZE)
    setCashierMap(await enrichCashiers(more, cashierMap))
    setLoadingMore(false)
  }

  const fetchRepayments = async () => {
    if (!effectiveShopIds.length) return
    const customSuffix = dateFilter === 'custom' ? `_${customStart}_${customEnd}` : ''
    const cacheKey = `sales_history_repayments_${effectiveShopIds.join(',')}_${dateFilter}${customSuffix}_${methodFilter}`
    const cached = getPageCache<any[]>(cacheKey)
    if (cached) {
      setRepayments(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      const { start, end } = getDateBounds()

      let query = supabase
        .from('payments')
        .select('id, amount, paid_at, method, sales!inner(shop_id, sale_number, created_at, customers(name))')
        .in('sales.shop_id', effectiveShopIds)
        .eq('is_repayment', true)
        .gte('paid_at', start.toISOString())
        .lte('paid_at', end.toISOString())
        .order('paid_at', { ascending: false })

      if (methodFilter !== 'all') query = query.eq('method', methodFilter)

      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const { data, error } = await withTimeout<any>(query, 20_000, 'Chargement des remboursements trop lent — réessayez.')
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — without this check nothing ever threw, so the catch
      // block's "preserve on failure" comment below was dead code: this line
      // always ran and unconditionally overwrote good data with [].
      if (error) throw error
      const filtered = (data || []).filter((p: any) => effectiveShopIds.includes(p.sales?.shop_id))
      setRepayments(filtered)
      setPageCache(cacheKey, filtered)
    } catch {
      // No cache for this exact filter combo — clear rather than leave a
      // stale list from whatever filter was viewed previously on screen.
      if (!cached) setRepayments([])
    } finally {
      setLoading(false)
    }
  }

  const openEditDialog = (sale: Sale) => {
    const s = sale as any
    const items = (s.sale_items || []).map((item: any) => ({
      product_id: item.product_id || null,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
    }))
    setEditItems(items)
    setEditInitial(JSON.stringify({ items, customer: s.customer_id || null, method: s.payment_method || 'cash', notes: s.notes || '' }))
    setEditCustomerId(s.customer_id || null)
    setEditCustomerQuery(s.customers?.name || '')
    setEditPaymentMethod(s.payment_method || 'cash')
    setEditNotes(s.notes || '')
    setEditProductQuery('')
    setEditProducts([])
    setEditCustomers([])
    setEditDialog(sale)
  }

  // Produits et clients proposés : ceux de la boutique DE LA VENTE (avant : toutes les boutiques du contexte)
  const searchEditProducts = async (q: string) => {
    const saleShopId = (editDialog as any)?.shop_id
    if (!q.trim() || !saleShopId) { setEditProducts([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, name, selling_price, quantity')
      .eq('shop_id', saleShopId)
      .eq('is_active', true)
      .ilike('name', `%${normalize(q)}%`)
      .order('name').limit(8)
    setEditProducts(data || [])
  }

  const searchEditCustomers = async (q: string) => {
    const saleShopId = (editDialog as any)?.shop_id
    if (!q.trim() || !saleShopId) { setEditCustomers([]); return }
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('shop_id', saleShopId)
      .is('deleted_at', null)
      .ilike('name', `%${q}%`)
      .limit(6)
    setEditCustomers(data || [])
  }

  const doEdit = async () => {
    if (!editDialog || editItems.length === 0) return
    setEditSaving(true)
    try {
      const res = await withTimeout(fetch('/api/sales/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: editDialog.id,
          customer_id: editCustomerId,
          payment_method: editPaymentMethod,
          notes: editNotes,
          items: editItems,
        }),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: json.message, variant: 'success' })
      setEditDialog(null)
      invalidateSalesData(queryClient)
      fetchSales()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setEditSaving(false)
    }
  }

  const fetchLogs = async () => {
    if (!effectiveShopIds.length || !canSeeLogs) return
    setLoadingLogs(true)
    const { start, end } = getDateBounds()
    try {
      const params = new URLSearchParams({
        shop_ids: effectiveShopIds.join(','),
        from: start.toISOString(),
        to: end.toISOString(),
      })
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave the journal spinning forever.
      const res = await withTimeout(fetch(`/api/sales/logs?${params}`), 20_000, 'Chargement du journal trop lent — réessayez.')
      const json = await res.json()
      setLogs(json.logs || [])
    } catch {
      // ignore
    } finally {
      setLoadingLogs(false)
    }
  }

  const shopKey = effectiveShopIds.join(',')
  // Changement de contexte : modification, annulation / encaissement et vente dépliée fermés — aucune boutique reprise
  const scopeKeyRef = useRef(scopeKey)
  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    scopeKeyRef.current = scopeKey
    setEditDialog(null); setDialog(null); setExpandedId(null); setEditProducts([]); setEditCustomers([])
  }, [scopeKey])
  // Plus aucun droit au journal dans ce contexte : retour aux ventes
  useEffect(() => { if (view === 'logs' && !canSeeLogs) setView('sales') }, [view, canSeeLogs])

  useEffect(() => {
    if (view === 'sales') fetchSales()
    else if (view === 'repayments') fetchRepayments()
    else fetchLogs()
  }, [shopKey, dateFilter, customStart, customEnd, methodFilter, statusFilter, saleStatusFilter, view])

  // A sale created elsewhere (sales/new checkout, or synced from the
  // offline queue) calls notifySalesDataChanged() — refetch so this page
  // doesn't need a hard reload to show it, whether already mounted or
  // freshly visited.
  useEffect(() => {
    if (view !== 'sales') return
    return onSalesDataChanged(() => fetchSales())
  }, [view])

  // Ventes hors-ligne pas encore synchronisées — getPendingSales() ne renvoie
  // que les non-synchronisées, donc une vente disparaît naturellement d'ici
  // dès qu'elle a réellement rejoint la liste normale au-dessus.
  useEffect(() => {
    if (!effectiveShopIds.length) return
    let cancelled = false
    Promise.all(effectiveShopIds.map(id => getPendingSales(id))).then(results => {
      if (!cancelled) setPendingSales(results.flat())
    }).catch(() => {})
    return () => { cancelled = true }
  }, [shopKey, pendingCount])

  // Debounced re-fetch when search changes: skip first render (main effect handles it)
  useEffect(() => {
    if (isFirstSearchRender.current) { isFirstSearchRender.current = false; return }
    if (view !== 'sales') return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => { fetchSales() }, 350)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search])

  const filteredRepayments = repayments.filter(p => {
    if (!search) return true
    const q = normalize(search)
    return (
      normalize(p.sales?.customers?.name ?? '').includes(q) ||
      normalize(p.sales?.sale_number ?? '').includes(q)
    )
  })

  // Refresh when tab regains focus (e.g. after recording a payment on the debts page)
  useRefetchOnVisible(fetchSales)
  useRefetchOnReconnect(fetchSales, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const filtered = sales.filter(s => {
    if (!search) return true
    const q = normalize(search)
    return (
      normalize(s.sale_number ?? '').includes(q) ||
      normalize((s as any).customers?.name ?? '').includes(q) ||
      normalize(cashierMap[(s as any).cashier_id] ?? '').includes(q)
    )
  })

  // periodStats comes from accurate server-side aggregates (payments ledger
  // for "collected", not just amount_paid) and has no notion of the search
  // text — it stayed correct for the date/method/status filters but silently
  // kept showing period-wide totals while the table below was narrowed by
  // search, disagreeing with what's on screen. When search is active, swap
  // to a search-scoped summary computed from the same rows the table shows.
  const searchActive = search.trim().length > 0
  const searchStats = searchActive ? {
    count: filtered.length,
    total: filtered.reduce((s, x) => s + Number(x.total), 0),
    paid: filtered.reduce((s, x) => s + Number(x.amount_paid), 0),
    // Same rule as periodStats: a cancelled sale's balance was already
    // reversed off the customer's real debt — never sum it as owed.
    balance: filtered.filter(x => x.sale_status !== 'cancelled').reduce((s, x) => s + Number(x.balance), 0),
  } : null

  // Export Excel / CSV : période en tête, montants en nombres, totaux des ventes actives
  const salesExport = useTableExport()
  const exportSales = (fmtOut: 'xlsx' | 'csv') => {
    setExportMenuOpen(false)
    // Mode de paiement dans le pays de la boutique DE CHAQUE vente
    const translateMethod = (method: string, shopId?: string | null) => {
      const m = getCountry(shopOf(shopId)?.country).paymentMethods.find(x => x.id === method)
      return m?.label ?? (method ? t(`payment.${method}` as any, { defaultValue: method }) : '')
    }
    const shopNameOf = (id: string) => userShops.find(x => x.id === id)?.name || ''
    const { start, end } = getDateBounds()
    const active = filtered.filter(x => x.sale_status !== 'cancelled')
    const sum = (k: 'total' | 'amount_paid' | 'balance') => active.reduce((acc, x) => acc + Number((x as any)[k] || 0), 0)
    // « Toutes » : pas de symbole commun dans l'en-tête (colonne Boutique) ; totaux agrégés : D1, lot 5
    const money = (h: string) => (scope.isAllShops && scope.multiShop ? h : `${h} (${symbolIn(scope.shopId)})`)
    salesExport.run({
      kind: salesExport.kind('sales'),
      shopName: scopeTitle,
      period: salesExport.range(start, end),
      columns: [
        { header: t('sales.sale_number') }, { header: t('sales.date'), type: 'datetime' },
        ...(isMultiShop ? [{ header: t('team.shop') }] : []),
        { header: t('sales.customer') }, { header: money(t('sales.total')), type: 'money' }, { header: money(t('payment.amount_paid')), type: 'money' },
        { header: money(t('payment.balance')), type: 'money' }, { header: t('sales.col_payment_method') }, { header: t('sales.col_payment_status') }, { header: t('sales.col_sale_status') },
      ],
      rows: filtered.map(x => [
        x.sale_number, new Date(x.created_at),
        ...(isMultiShop ? [shopNameOf((x as any).shop_id)] : []),
        (x as any).customers?.name || t('sales.walk_in'),
        Number(x.total), Number(x.amount_paid), Number(x.balance),
        translateMethod(x.payment_method, (x as any).shop_id),
        x.payment_status ? t(`status.${x.payment_status}` as any, { defaultValue: x.payment_status }) : '',
        x.sale_status ? t(`status.${x.sale_status}` as any, { defaultValue: x.sale_status }) : t('status.active'),
      ]),
      totals: [salesExport.total, null, ...(isMultiShop ? [null] : []), null, sum('total'), sum('amount_paid'), sum('balance'), null, null, null],
    }, fmtOut)
  }

  const exportPDF = async () => {
    if (!filtered.length) return
    setExportingPDF(true)
    setExportMenuOpen(false)
    try {
      const { generateSalesReportPDF } = await import('@/lib/utils/pdf')
      const fmtAmt = (n: number) => formatNaira(Math.round(n))
      const now = new Date()
      const periodLabel = dateFilter === 'today'
        ? format(now, 'dd/MM/yyyy')
        : dateFilter === 'week'
        ? `${format(startOfWeek(now, { weekStartsOn: 1 }), 'dd/MM')} – ${format(now, 'dd/MM/yyyy')}`
        : dateFilter === 'month'
        ? format(startOfMonth(now), 'MMMM yyyy')
        : dateFilter === 'custom' && customStart && customEnd
        ? `${format(new Date(customStart), 'dd/MM/yyyy')} – ${format(new Date(customEnd), 'dd/MM/yyyy')}`
        : dateFilter === 'yesterday'
        ? format(subDays(new Date(), 1), 'dd/MM/yyyy')
        : t('sales.filter_today')
      const withShop = scope.isAllShops && scope.multiShop
      await generateSalesReportPDF({
        shopName: scopeTitle,
        period: periodLabel,
        // Same figure already shown on screen as "Encaissé" — sourced from
        // the payments ledger (paid_at), not sales.amount_paid, so a debt
        // repayment collected this period isn't misattributed to whatever
        // month the underlying sale was originally created in.
        totalCollected: periodStats?.collected,
        sales: filtered.map(s => ({
          date: s.created_at,
          sale_number: s.sale_number,
          customer: (s as any).customers?.name || t('sales.walk_in'),
          total: Number(s.total),
          amount_paid: Number(s.amount_paid),
          payment_method: s.payment_method,
          payment_status: s.payment_status,
          sale_status: s.sale_status || 'active',
          // Montants de CETTE vente dans la devise de sa boutique ; boutique rappelée en « Toutes »
          fmtAmt: (n: number) => fmtIn((s as any).shop_id)(Math.round(n)),
          ...(withShop ? { shop: shopOf((s as any).shop_id)?.name || '' } : {}),
        })),
        pmLabels: {
          cash: t('payment.cash'),
          transfer: t('payment.transfer'),
          mobile_money: t('payment.mobile_money'),
          credit: t('payment.credit'),
        },
        statusLabels: {
          paid: t('status.paid'),
          partial: t('status.partial'),
          pending: t('status.pending'),
          cancelled: t('status.cancelled'),
        },
        fmtAmt,
        labels: {
          title: t('sales.pdf_title'),
          colDate: t('sales.date'),
          colSale: t('sales.pdf_col_sale'),
          colClient: t('sales.pdf_col_client'),
          colTotal: t('sales.total'),
          colPaid: t('payment.amount_paid'),
          colMethod: t('sales.pdf_col_method'),
          colStatus: t('sales.pdf_col_status'),
          colShop: t('team.shop'),
          summary: t('sales.pdf_summary'),
          totalSales: t('sales.pdf_total_sales'),
          totalRevenue: t('sales.pdf_total_revenue'),
          cancelledCount: t('sales.pdf_cancelled_count'),
          generatedBy: t('sales.pdf_generated_by'),
          page: t('sales.pdf_page'),
          of: t('sales.pdf_of'),
        },
      })
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: err.message || 'Erreur export PDF', variant: 'destructive' })
    } finally {
      setExportingPDF(false)
    }
  }

  // Vente hors ligne « à vérifier » → vérifiée (propriétaire / gestion)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const markReviewed = async (saleId: string) => {
    setReviewingId(saleId)
    try {
      const res = await withTimeout(fetch('/api/sales/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sale_id: saleId }),
      }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      toast({ title: t('sales.review_marked'), variant: 'success' })
      invalidateSalesData(queryClient)
      fetchSales()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setReviewingId(null)
    }
  }

  const doAction = async () => {
    if (!dialog) return
    setActionLoading(true)
    try {
      if (dialog.type === 'cancel') {
        const res = await withTimeout(fetch('/api/sales/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, reason: cancelReason }),
        }))
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast({ title: json.message, variant: 'success' })
      } else if (dialog.type === 'validate') {
        const res = await withTimeout(fetch('/api/sales/validate-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: dialog.sale.id, amount: validateAmount, method: validateMethod }),
        }))
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast({ title: json.message, variant: 'success' })
      }
      setDialog(null)
      setCancelReason(''); setValidateAmount('')
      invalidateSalesData(queryClient)
      fetchSales()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  const renderSaleRow = (sale: Sale) => {
    const isCancelled = sale.sale_status === 'cancelled'
    const isPending = sale.payment_status === 'pending' || sale.payment_status === 'partial'
    // Vente hors ligne enregistrée « à vérifier » (migration 159) — motifs séparés par des virgules
    const reviewReasons: string[] = (sale as any).review_reason ? String((sale as any).review_reason).split(',').filter(Boolean) : []
    const toReview = !isCancelled && reviewReasons.length > 0 && !(sale as any).reviewed_at
    const saleShopId = (sale as any).shop_id as string | undefined
    const fmtS = fmtIn(saleShopId)
    const canCancelThis = !isCancelled && (
      isOwnerIn(saleShopId) ||
      (isCashierIn(saleShopId) && sale.cashier_id === profile?.id && new Date(sale.created_at) >= startOfDay(new Date()))
    )
    return (
      <Fragment key={sale.id}>
        <TableRow
          className={`cursor-pointer ${isCancelled ? 'opacity-50 bg-red-50/30 dark:bg-red-950/20' : 'hover:bg-muted/30'}`}
          onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
          data-sale-row={sale.id} data-sale-shop={saleShopId} aria-expanded={expandedId === sale.id}
        >
          <TableCell className="font-mono text-xs font-medium text-stockshop-blue dark:text-blue-400">
            #{sale.sale_number}
            {isCancelled && (
              <span className="ml-1.5 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded px-1">{t('sales.cancelled_badge')}</span>
            )}
            {toReview && (
              <span className="ml-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded px-1" data-testid="sale-review-badge">{t('sales.review_badge')}</span>
            )}
          </TableCell>
          <TableCell className="text-sm">{(sale as any).customers?.name || t('sales.walk_in_short')}</TableCell>
          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
            {cashierMap[(sale as any).cashier_id] || '—'}
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
            {format(new Date(sale.created_at), 'dd MMM · HH:mm', { locale: dateFnsLocale(locale) })}
          </TableCell>
          <TableCell className="text-right font-medium">{fmtS(sale.total)}</TableCell>
          <TableCell className="hidden md:table-cell text-right text-green-600 dark:text-green-400">{fmtS(sale.amount_paid)}</TableCell>
          <TableCell className="hidden md:table-cell text-right">
            {Number(sale.balance) > 0
              ? <span className="text-red-500">{fmtS(sale.balance)}</span>
              : <span className="text-muted-foreground">—</span>}
          </TableCell>
          <TableCell>
            <div className="flex gap-1 flex-wrap">
              {!isCancelled && (
                <Badge variant={statusVariant[sale.payment_status]} className="text-[10px] px-1.5">
                  {t(`status.${sale.payment_status}`)}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 hidden sm:inline-flex">
                {payMethodLabel(sale.payment_method ?? '', saleShopId)}
              </Badge>
            </div>
          </TableCell>
          <TableCell>
            {expandedId === sale.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </TableCell>
        </TableRow>
        {expandedId === sale.id && (
          <TableRow key={`${sale.id}-expand`}>
            <TableCell colSpan={9} className="bg-muted/20 p-0">
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('sales.items')}</p>
                {(sale as any).sale_items?.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.products?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.products.image_url} alt={item.product_name} loading="lazy" decoding="async" className="h-8 w-8 rounded object-cover border border-border shrink-0" />
                      )}
                      <span className="truncate">{item.product_name} × {item.quantity} @ {fmtS(item.unit_price)}</span>
                      {Number(item.stock_shortfall) > 0 && (
                        <span className="shrink-0 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t('sales.review_shortfall', { count: item.stock_shortfall })}</span>
                      )}
                    </div>
                    <span className="font-medium shrink-0">{fmtS(item.subtotal)}</span>
                  </div>
                ))}
                {reviewReasons.length > 0 && !isCancelled && (
                  <div className={`rounded-md border p-2.5 text-xs ${toReview ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40' : 'border-border bg-muted/30'}`} data-testid="sale-review-box" onClick={e => e.stopPropagation()}>
                    <p className={`font-semibold ${toReview ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>
                      {toReview ? t('sales.review_title') : `${t('sales.reviewed_label')} · ${t('sales.review_title')}`}
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-foreground/80">
                      {reviewReasons.map(r => <li key={r}>{t(`sales.review_reason_${r}` as any)}</li>)}
                    </ul>
                    {toReview && <p className="mt-1 text-muted-foreground">{t('sales.review_hint')}</p>}
                    {toReview && isOwnerIn(saleShopId) && (
                      <Button size="sm" variant="outline" className="mt-2 h-7 gap-1.5 text-xs" disabled={reviewingId === sale.id} onClick={() => markReviewed(sale.id)} data-testid="sale-review-mark">
                        <CheckCircle2 className="h-3 w-3" /> {t('sales.review_mark')}
                      </Button>
                    )}
                  </div>
                )}
                {sale.notes && (
                  <p className="text-xs text-muted-foreground pt-2 border-t">{t('sales.note_label')}: {sale.notes}</p>
                )}
                {isCancelled && sale.cancel_reason && (
                  <p className="text-xs text-red-500 pt-2 border-t">{t('sales.cancel_reason_label')}: {sale.cancel_reason}</p>
                )}
                <div className="flex flex-wrap gap-2 pt-2 border-t" onClick={e => e.stopPropagation()}>
                  {!isCancelled && isPending && canWriteIn(saleShopId, 'payments') && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-green-300 dark:border-green-700/60 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40"
                      onClick={() => { setDialog({ type: 'validate', sale }); setValidateAmount(String(sale.balance)) }}
                    >
                      <CheckCircle2 className="h-3 w-3" /> {t('sales.validate_payment_action')}
                    </Button>
                  )}
                  {canCancelThis && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-stockshop-blue/40 text-stockshop-blue dark:text-blue-400 hover:bg-stockshop-blue-muted dark:hover:bg-blue-950/40"
                      onClick={() => openEditDialog(sale)}
                    >
                      <Edit2 className="h-3 w-3" /> {t('actions.edit')}
                    </Button>
                  )}
                  {canCancelThis && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-amber-300 dark:border-amber-700/60 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      onClick={() => { setDialog({ type: 'cancel', sale }); setCancelReason('') }}
                    >
                      <XCircle className="h-3 w-3" /> {t('actions.cancel')}
                    </Button>
                  )}
                  {!isCancelled && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => printTicket(sale)}>
                        <Printer className="h-3 w-3" /> {t('sales.print_ticket')}
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => printSale(sale)}>
                        {isCapacitor() ? <Share2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                        {t('sales.receipt_pdf')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    )
  }

  const salesTableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead>{t('sales.sale_number')}</TableHead>
        <TableHead>{t('sales.customer')}</TableHead>
        <TableHead className="hidden lg:table-cell">{t('sales.cashier')}</TableHead>
        <TableHead className="hidden sm:table-cell">{t('sales.date')}</TableHead>
        <TableHead className="text-right">{t('sales.total')}</TableHead>
        <TableHead className="hidden md:table-cell text-right">{t('payment.amount_paid')}</TableHead>
        <TableHead className="hidden md:table-cell text-right">{t('payment.balance')}</TableHead>
        <TableHead>{t('status.active')}</TableHead>
        <TableHead className="w-8"></TableHead>
      </TableRow>
    </TableHeader>
  )

  return (
    <div className="space-y-4">
      {scope.isAllShops && scope.multiShop && <div><ShopScopeBadge /></div>}
      {/* View toggle */}
      <SegmentedTabs value={view} onChange={v => setView(v as typeof view)} testId="sales-history-tabs" items={[
        { key: 'sales', label: t('sales.sales_tab') },
        { key: 'repayments', label: t('sales.repayments_tab'), icon: CornerDownLeft },
        ...(canSeeLogs ? [{ key: 'logs', label: t('sales.logs_tab'), icon: Activity }] : []),
      ]} />

      {/* Filters row */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('sales.search_history')} className="pl-9 h-9" />
        </div>

        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('reports.date_range')}</Label>
          <Select
            value={dateFilter}
            onValueChange={v => {
              if (v === 'custom') {
                const today = format(new Date(), 'yyyy-MM-dd')
                const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
                setFilter({
                  dateFilter: v,
                  customStart: customStart || monthStart,
                  customEnd:   customEnd   || today,
                })
              } else {
                setFilter({ dateFilter: v })
              }
            }}
          >
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t('sales.filter_today')}</SelectItem>
              <SelectItem value="yesterday">{t('sales.filter_yesterday')}</SelectItem>
              <SelectItem value="week">{t('sales.filter_week')}</SelectItem>
              <SelectItem value="month">{t('sales.filter_month')}</SelectItem>
              <SelectItem value="quarter">{t('sales.filter_quarter')}</SelectItem>
              <SelectItem value="semester">{t('sales.filter_semester')}</SelectItem>
              <SelectItem value="year">{t('sales.filter_year')}</SelectItem>
              <SelectItem value="custom">{t('sales.filter_custom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {dateFilter === 'custom' && (
          <>
            <Input
              type="date"
              value={customStart}
              max={customEnd || format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setFilter({ customStart: e.target.value })}
              className="h-9 w-[140px]"
            />
            <Input
              type="date"
              value={customEnd}
              min={customStart}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setFilter({ customEnd: e.target.value })}
              className="h-9 w-[140px]"
            />
          </>
        )}

        <div className="flex flex-col gap-0.5">
          <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('sales.filter_method_label')}</Label>
          <Select value={methodFilter} onValueChange={v => setFilter({ methodFilter: v })}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('sales.all_methods')}</SelectItem>
              <SelectItem value="cash">{t('payment.cash')}</SelectItem>
              <SelectItem value="mobile_money">{t('payment.mobile_money')}</SelectItem>
              <SelectItem value="transfer">{t('payment.transfer')}</SelectItem>
              <SelectItem value="credit">{t('payment.credit')}</SelectItem>
              <SelectItem value="paystack">{t('payment.paystack')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {view === 'sales' && (
          <>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('sales.filter_status_label')}</Label>
              <Select value={statusFilter} onValueChange={v => setFilter({ statusFilter: v })}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.all_statuses')}</SelectItem>
                  <SelectItem value="paid">{t('status.paid')}</SelectItem>
                  <SelectItem value="partial">{t('status.partial')}</SelectItem>
                  <SelectItem value="pending">{t('status.pending')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-0.5">
              <Label className="text-[10px] font-normal text-muted-foreground px-0.5">{t('sales.filter_sale_label')}</Label>
              <Select value={saleStatusFilter} onValueChange={v => setFilter({ saleStatusFilter: v as any })}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('sales.filter_all')}</SelectItem>
                  <SelectItem value="active">{t('sales.filter_active')}</SelectItem>
                  <SelectItem value="cancelled">{t('sales.filter_cancelled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {isOwner && (
          <div className="relative flex-shrink-0">
            {/* Export : menu déroulant commun (Échap, retour Android, clavier) */}
            <DropdownMenu open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9" loading={exportingPDF || salesExport.exporting} aria-label={t('actions.export_pdf')}>
                  <FileDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => exportPDF()} className="gap-2.5 py-2.5">
                  <FileText className="h-4 w-4 flex-shrink-0 text-red-500" />{t('actions.export_pdf')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportSales('xlsx')} className="gap-2.5 py-2.5" data-testid="export-xlsx">
                  <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />{t('exports.excel')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportSales('csv')} className="gap-2.5 py-2.5" data-testid="export-csv">
                  <Table2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />{t('exports.csv')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Date range label */}
      {dateFilter !== 'custom' && (() => {
        const { start, end } = getDateBounds()
        const fmt = (d: Date) => format(d, 'd MMM yyyy', { locale: dateFnsLocale(locale) })
        const startStr = fmt(start)
        const endStr   = fmt(end)
        const label = startStr === endStr ? startStr : `${startStr} – ${endStr}`
        return <p className="text-xs text-muted-foreground -mt-1">{label}</p>
      })()}

      {/* ── Repayments view ─────────────────────────────────── */}
      {view === 'repayments' && (() => {
        const repaymentTableHeader = (
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.customer')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('sales.sale_number')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('sales.date')}</TableHead>
              <TableHead>{t('payment.method')}</TableHead>
              <TableHead className="text-right">{t('sales.total')}</TableHead>
            </TableRow>
          </TableHeader>
        )
        const renderRepaymentRow = (p: any) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium text-sm">
              <CornerDownLeft className="inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 mr-1.5" />
              {p.sales?.customers?.name || '—'}
            </TableCell>
            <TableCell className="hidden sm:table-cell font-mono text-xs text-stockshop-blue dark:text-blue-400">
              #{p.sales?.sale_number}
            </TableCell>
            <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
              {format(new Date(p.paid_at), 'dd MMM · HH:mm', { locale: dateFnsLocale(locale) })}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] px-1.5 border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400">
                {payMethodLabel(p.method, p.sales?.shop_id)}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
              +{fmtIn(p.sales?.shop_id)(p.amount)}
            </TableCell>
          </TableRow>
        )
        if (loading) return (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          </div>
        )

        const repaymentTotal = filteredRepayments.reduce((s: number, p: any) => s + Number(p.amount), 0)

        return (
          <div className="space-y-2">
            {isOwner && filteredRepayments.length > 0 && (
              <div className="flex gap-4 text-sm flex-wrap">
                <span className="text-muted-foreground">
                  {filteredRepayments.length} {t('sales.repayments_tab').toLowerCase()} ·{' '}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{formatNaira(repaymentTotal)}
                  </span>
                </span>
              </div>
            )}

            {filteredRepayments.length === 0 ? (
              <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">{t('sales.no_repayments')}</div>
              </div>
            ) : isMultiShop ? (
              <div className="space-y-4">
                {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
                  const shopRepayments = filteredRepayments.filter((p: any) => p.sales?.shop_id === shopEntry.id)
                  if (!shopRepayments.length) return null
                  const shopTotal = shopRepayments.reduce((s: number, p: any) => s + Number(p.amount), 0)
                  return (
                    <div key={shopEntry.id} className="space-y-2">
                      <div className="flex items-center gap-2 pt-1">
                        <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">+{fmtIn(shopEntry.id)(shopTotal)}</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                        <Table>{repaymentTableHeader}<TableBody>{shopRepayments.map(renderRepaymentRow)}</TableBody></Table>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                <Table>{repaymentTableHeader}<TableBody>{filteredRepayments.map(renderRepaymentRow)}</TableBody></Table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Sales view ──────────────────────────────────────── */}
      {view === 'sales' && isOwner && searchActive && searchStats && (
        <div className="flex gap-x-4 gap-y-0.5 text-sm flex-wrap">
          <span className="text-muted-foreground">
            {t('sales.search_results_count', { count: searchStats.count })} ·{' '}
            <span className="font-semibold text-foreground">{formatNaira(searchStats.paid)}</span>
            <span className="text-muted-foreground font-normal"> {t('sales.paid_label_inline')}</span>
          </span>
          {searchStats.total !== searchStats.paid && (
            <span className="text-muted-foreground text-xs self-center">
              {t('sales.revenue_inline')} {formatNaira(searchStats.total)}
            </span>
          )}
          {searchStats.balance > 0 && (
            <span className="text-red-500">
              {t('sales.balance_summary')}: {formatNaira(searchStats.balance)}
            </span>
          )}
        </div>
      )}
      {view === 'sales' && isOwner && !searchActive && periodStats !== null && (
        <div className="flex gap-x-4 gap-y-0.5 text-sm flex-wrap">
          <span className="text-muted-foreground">
            {periodStats.count} {t('sales.sales_count_label')} ·{' '}
            <span className="font-semibold text-foreground">{formatNaira(periodStats.collected)}</span>
            <span className="text-muted-foreground font-normal"> {t('sales.collected_inline')}</span>
          </span>
          {periodStats.ca !== periodStats.collected && (
            <span className="text-muted-foreground text-xs self-center">
              {t('sales.revenue_inline')} {formatNaira(periodStats.ca)}
            </span>
          )}
          {periodStats.balance > 0 && (
            <span className="text-red-500">
              {t('sales.balance_summary')}: {formatNaira(periodStats.balance)}
            </span>
          )}
        </div>
      )}

      {/* Ventes hors-ligne en attente de synchronisation */}
      {view === 'sales' && pendingSales.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-amber-200 dark:border-amber-800">
            <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
              {t('sales.pending_sync_title', { count: pendingSales.length })}
            </span>
          </div>
          <div className="divide-y divide-amber-100 dark:divide-amber-900">
            {pendingSales.map(sale => (
              <div key={sale.local_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{sale.customer_name || t('sales.walk_in_short')}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(sale.created_at), 'dd MMM · HH:mm', { locale: dateFnsLocale(locale) })}
                    {/* Pourquoi elle est restée sur l'appareil (enregistré depuis le 5 oct. 2026) */}
                    {sale.offline_reason && <> · {t(`sales.offline_reason_${sale.offline_reason.startsWith('server_') ? 'server' : sale.offline_reason}` as any)}</>}
                  </p>
                  {sale.sync_error && <p className="truncate text-[11px] text-red-600 dark:text-red-400">{sale.sync_error}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium">{fmtIn(sale.shop_id)(sale.total)}</span>
                  <Badge variant="warning" className="text-[10px] px-1.5">{t('sales.pending_sync_badge')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vente ciblée (« Voir la vente ») : rappel, ou message générique si elle n'est pas accessible */}
      {view === 'sales' && (target || targetMissing) && (
        <div role="status" data-testid={target ? 'sale-target-banner' : 'sale-target-missing'}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm ${target ? 'border-stockshop-blue/30 bg-stockshop-blue-muted text-stockshop-blue dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>
          <span>{target ? t('sales.target_shown', { number: target.number }) : t('sales.target_unavailable')}</span>
          <Button variant="outline" size="sm" className="h-10" onClick={dropTarget} data-testid="sale-target-clear">{t('sales.target_clear')}</Button>
        </div>
      )}

      {/* Table */}
      {view === 'sales' && (
        loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
          <LoadErrorFallback />
        ) : loading ? (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          </div>
        ) : filtered.length === 0 && neverSold ? (
          <EmptyGuide icon={ShoppingCart} title={t('onboarding.empty.history.title')} body={t('onboarding.empty.history.body')} tour={scope.shopIds.some(id => canAccessIn(id, 'new_sale')) ? 'first_sale' : undefined} />
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">{t('sales.no_sales')}</div>
          </div>
        ) : isMultiShop ? (
          <div className="space-y-4">
            {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
              const shopSales = filtered.filter(s => (s as any).shop_id === shopEntry.id)
              if (!shopSales.length) return null
              return (
                <div key={shopEntry.id} className="space-y-2">
                  <div className="flex items-center gap-2 pt-1">
                    <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {/* shopSales already reflects the "Vente" filter (saleStatusFilter)
                          via the server query behind `filtered` — hardcoding "active only"
                          here made this badge disagree with the rows shown right below it
                          whenever the filter was set to "all" or "cancelled" (same bug
                          already fixed for the page-level periodStats summary bar). */}
                      {shopSales.length} {t('sales.sales_count_label')} ·{' '}
                      {fmtIn(shopEntry.id)(shopSales.reduce((acc, s) => acc + Number(s.total), 0))}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                    <Table>
                      {salesTableHeader}
                      <TableBody>{shopSales.map(renderSaleRow)}</TableBody>
                    </Table>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <Table>
              {salesTableHeader}
              <TableBody>{filtered.map(renderSaleRow)}</TableBody>
            </Table>
          </div>
        )
      )}

      {/* Load more */}
      {view === 'sales' && !loading && hasMoreSales && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" size="sm" onClick={loadMoreSales} loading={loadingMore}>
            {t('actions.load_more')}
          </Button>
        </div>
      )}

      {/* ── Activity log view ───────────────────────────────── */}
      {view === 'logs' && (
        loadingLogs ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border bg-card shadow-sm flex h-32 items-center justify-center text-muted-foreground text-sm">
            {t('sales.no_logs')}
          </div>
        ) : (
          <div className="rounded-lg border bg-card shadow-sm divide-y overflow-hidden">
            {logs.map(log => {
              // Une règle par action (lib/sales/journal) : jamais une action inconnue
              // présentée comme un paiement, jamais un identifiant technique en numéro.
              const entry = describeSaleLog(log)
              const isCancel   = entry.kind === 'cancel'
              const isValidate = entry.kind === 'validate'
              const isEdit     = entry.kind === 'edit'
              const saleNum = entry.number
              const iconCls = entry.tone === 'red'
                ? 'bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400'
                : entry.tone === 'blue'
                  ? 'bg-stockshop-blue-muted dark:bg-blue-950/50 text-stockshop-blue dark:text-blue-400'
                  : entry.tone === 'green'
                    ? 'bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400'
                    : 'bg-muted text-muted-foreground'
              const actionLabel = t(entry.labelKey as any)
              const dueDay = (d?: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString(dateLocaleTag(locale), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
              return (
                <div key={log.id} className="flex items-start gap-3 p-3">
                  <div className={`mt-0.5 flex-shrink-0 rounded-full p-1.5 ${iconCls}`}>
                    {entry.tone === 'red' ? <XCircle className="h-3.5 w-3.5" /> : entry.kind === 'postpone' ? <Clock className="h-3.5 w-3.5" /> : entry.tone === 'green' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{log.actor_name}</span>{' '}
                        <span className="text-muted-foreground">{actionLabel}</span>{' '}
                        {isMultiShop && shopOf(log.shop_id) && <span className="text-xs text-muted-foreground" data-log-shop>· {shopOf(log.shop_id)!.name} </span>}
                        {saleNum && (
                          <span className="font-mono text-xs font-semibold text-stockshop-blue dark:text-blue-400">
                            #{saleNum}
                          </span>
                        )}
                      </p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 mt-0.5">
                        {format(new Date(log.created_at), 'dd MMM · HH:mm', { locale: dateFnsLocale(locale) })}
                      </span>
                    </div>
                    {entry.kind === 'postpone' && log.metadata?.new_due_date && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('sales.log_due_date_change', { from: dueDay(log.metadata.old_due_date), to: dueDay(log.metadata.new_due_date) })}
                        {log.metadata.reason ? ` · ${log.metadata.reason}` : ''}
                      </p>
                    )}
                    {entry.kind === 'opening_created' && log.metadata?.amount != null && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtIn(log.shop_id)(log.metadata.amount)}{log.metadata.party_name ? ` · ${log.metadata.party_name}` : ''}
                      </p>
                    )}
                    {isCancel && log.metadata?.reason && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('sales.log_reason_label')} {log.metadata.reason}
                      </p>
                    )}
                    {isValidate && log.metadata?.amount != null && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                        +{fmtIn(log.shop_id)(log.metadata.amount)}
                        {log.metadata.method ? ` · ${payMethodLabel(log.metadata.method, log.shop_id)}` : ''}
                      </p>
                    )}
                    {isEdit && log.metadata?.new_total != null && (
                      <p className="text-xs text-stockshop-blue dark:text-blue-400 mt-0.5">
                        {fmtIn(log.shop_id)(log.metadata.old_total)} → {fmtIn(log.shop_id)(log.metadata.new_total)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── Edit sale dialog ───────────────────────────────── */}
      {/* Modifier une vente : formulaire long (articles, client, paiement, note) → panneau en sections, avec garde */}
      <FormDrawer
        open={!!editDialog}
        onOpenChange={open => { if (!open) setEditDialog(null) }}
        title={t('sales.edit_sale_title')}
        description={(editDialog as any)?.sale_number ? `#${(editDialog as any).sale_number}` : undefined}
        icon={<Edit2 className="h-4 w-4" />}
        width="lg"
        testId="edit-sale-drawer"
        dirty={!!editDialog && !editSaving && JSON.stringify({ items: editItems, customer: editCustomerId, method: editPaymentMethod, notes: editNotes }) !== editInitial}
        onSubmit={doEdit}
        submitting={editSaving}
        submitLabel={t('sales.edit_save')}
        submitDisabled={editItems.length === 0 || Number((editDialog as any)?.amount_paid || 0) > editItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)}
      >

          {editDialog && (() => {
            const fmtE = fmtIn((editDialog as any).shop_id)
            const amountPaid = Number((editDialog as any).amount_paid || 0)
            const editNewTotal = editItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
            const overCollected = amountPaid > editNewTotal && editItems.length > 0

            return (
              <div className="space-y-4">
                {/* Items */}
                <DrawerSection title={t('sales.edit_items_section')}>
                <div className="space-y-2">
                  {editItems.map((item, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-b-0" data-testid="edit-sale-line">
                      <span className="min-w-0 flex-1 basis-full truncate text-sm font-medium sm:basis-auto">{item.product_name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                          onClick={() => setEditItems(prev => prev.map((it, i) => i === idx && it.quantity > 1 ? { ...it, quantity: it.quantity - 1 } : it))}
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={e => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, Number(e.target.value) || 1) } : it))}
                          className="h-9 w-14 rounded-md border bg-background text-center text-sm"
                          aria-label={t('sales.edit_qty_label', { name: item.product_name })}
                        />
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                          onClick={() => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it))}
                        >+</button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={item.unit_price}
                        onChange={e => setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, unit_price: Number(e.target.value) || 0 } : it))}
                        className="h-9 w-24 rounded-md border bg-background px-2 text-right text-sm"
                        aria-label={t('sales.edit_price_label', { name: item.product_name })}
                      />
                      <span className="ml-auto w-24 shrink-0 text-right text-sm font-semibold">
                        {fmtE(item.quantity * item.unit_price)}
                      </span>
                      <button
                        type="button"
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                        aria-label={t('sales.edit_remove_line', { name: item.product_name })}
                        onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Product search to add items */}
                  <div className="relative mt-1">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={editProductQuery}
                        onChange={e => { setEditProductQuery(e.target.value); searchEditProducts(e.target.value) }}
                        placeholder={t('sales.edit_product_search')}
                        className="h-10 pl-8 text-sm"
                      />
                    </div>
                    {editProducts.length > 0 && (
                      <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                        {editProducts.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted text-left"
                            onClick={() => {
                              setEditItems(prev => {
                                const existing = prev.findIndex(it => it.product_id === p.id)
                                if (existing >= 0) return prev.map((it, i) => i === existing ? { ...it, quantity: it.quantity + 1 } : it)
                                return [...prev, { product_id: p.id, product_name: p.name, quantity: 1, unit_price: p.selling_price }]
                              })
                              setEditProductQuery('')
                              setEditProducts([])
                            }}
                          >
                            <span className="truncate">{p.name}</span>
                            <span className="ml-2 shrink-0 text-muted-foreground">{t('sales.edit_product_option', { price: fmtE(p.selling_price), qty: p.quantity })}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                </DrawerSection>

                {/* New total */}
                <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${overCollected ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400' : 'bg-muted/50'}`}>
                  <span>{t('sales.edit_new_total')}</span>
                  <span>{fmtE(editNewTotal)}</span>
                </div>
                {overCollected && (
                  <p className="text-xs text-red-500">{t('sales.edit_amount_paid_warning')}</p>
                )}

                <DrawerSection title={t('sales.edit_details_section')}>
                <div className="space-y-4">
                {/* Customer */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('sales.edit_customer_section')}</Label>
                  <div className="relative">
                    <Input
                      value={editCustomerQuery}
                      onChange={e => {
                        setEditCustomerQuery(e.target.value)
                        if (!e.target.value) { setEditCustomerId(null); setEditCustomers([]) }
                        else searchEditCustomers(e.target.value)
                      }}
                      placeholder={t('sales.edit_customer_placeholder')}
                      className="h-10 text-sm"
                    />
                    {editCustomers.length > 0 && (
                      <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden">
                        {editCustomers.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted text-left"
                            onClick={() => { setEditCustomerId(c.id); setEditCustomerQuery(c.name); setEditCustomers([]) }}
                          >
                            <span>{c.name}</span>
                            {c.phone && <span className="text-muted-foreground">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment method */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('payment.method')}</Label>
                  <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                    <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getCountry(shopOf((editDialog as any).shop_id)?.country).paymentMethods.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('sales.note_label')}</Label>
                  <Input
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder={t('sales.edit_notes_placeholder')}
                    className="h-10 text-sm"
                  />
                </div>
                </div>
                </DrawerSection>
              </div>
            )
          })()}

      </FormDrawer>

      {/* Action dialog */}
      <PremiumDialog
        open={!!dialog}
        onOpenChange={open => !open && setDialog(null)}
        title={dialog?.type === 'cancel' ? t('sales.cancel_sale_dialog_title') : t('sales.validate_payment_dialog_title')}
        icon={dialog?.type === 'cancel' ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-3">
          {dialog?.type === 'cancel' && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('confirm.cancel_sale')} <strong>#{dialog.sale.sale_number}</strong>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t('sales.cancel_reason_label')} ({t('form.optional')})</Label>
                <Input
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder={t('sales.cancel_reason_placeholder')}
                  autoFocus
                />
              </div>
            </>
          )}

          {dialog?.type === 'validate' && dialog.sale && (
            <>
              <p className="text-sm text-muted-foreground">
                {t('sales.remaining_balance_label')}: <strong>{fmtIn((dialog.sale as any).shop_id)(dialog.sale.balance)}</strong>
              </p>
              <div className="space-y-1">
                <Label className="text-xs">{t('payment.amount_paid')}</Label>
                <Input
                  type="number"
                  value={validateAmount}
                  onChange={e => setValidateAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('payment.method')}</Label>
                <Select value={validateMethod} onValueChange={setValidateMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {getCountry(shopOf((dialog.sale as any).shop_id)?.country).paymentMethods.filter(m => m.type !== 'credit').map(m => (
                      <SelectItem key={m.id} value={m.id}>{payMethodLabel(m.id, (dialog.sale as any).shop_id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => setDialog(null)}
          cancelLabel={t('actions.cancel')}
        >
          <Button
            className={`flex-1 h-11 rounded-lg font-semibold text-white border-0 ${dialog?.type === 'cancel' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
            loading={actionLoading}
            onClick={doAction}
          >
            {dialog?.type === 'cancel' ? t('actions.confirm') : t('sales.validate_payment_action')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}
