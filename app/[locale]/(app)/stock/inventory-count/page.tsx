'use client'

// ── Stock › Inventaires : inventaire physique en session (migration 175) ──────────────────────────────────────────
// Démarrer → compter (à l'aveugle) → vérifier les écarts → motiver → finaliser → stock ajusté → historique.
// Règle absolue : la quantité RÉELLE n'est jamais préremplie. Le serveur n'envoie même pas le stock enregistré des
// produits non comptés ; le théorique n'apparaît qu'une fois le produit compté (il est noté par le serveur À CET
// INSTANT). Rien ne touche au stock avant la finalisation, qui applique l'ÉCART au stock du moment (une vente faite
// pendant l'inventaire n'est jamais effacée). Une session par boutique, reprise après fermeture, par tout employé
// qui a le droit « Inventaire » ; deux appareils ne s'écrasent jamais sans le savoir (contrôle de version).
// Contexte : la boutique de l'en-tête ; en « Toutes les boutiques », choix explicite (jamais la boutique cachée).

import { PageHeader } from '@/components/layout/page-header'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Search, ClipboardCheck, Store, Scan, CheckCircle2, AlertTriangle, History, RotateCcw, ChevronRight, ArrowLeft } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { useShopPermissions } from '@/lib/hooks/use-role-permissions'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { useToast } from '@/components/ui/use-toast'
import { normalize } from '@/lib/utils/normalize'
import { withTimeout } from '@/lib/utils/with-timeout'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { cn } from '@/lib/utils/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ExpiryDateField, usePastExpiryConfirm } from '@/components/stock/expiry-date-field'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="mt-1 h-12 rounded-xl bg-muted animate-pulse" /> }
)

// Motifs existants (bloc « products ») — aucune deuxième liste. Une erreur de comptage se corrige en recomptant.
const REASONS = ['correction', 'damage', 'loss', 'theft', 'expiry', 'other'] as const

type Filter = 'all' | 'todo' | 'counted' | 'diff'
interface InvProduct { id: string; name: string; unit: string | null; sku: string | null; category_id: string | null }
interface InvCount {
  id: string; product_id: string | null; product_name: string; unit: string | null
  theoretical_qty: number; counted_qty: number; delta: number
  reason_code: string | null; surplus_expiry_date: string | null; recount_requested_at: string | null
  counted_by_name?: string | null; counted_at: string
  applied_before?: number | null; applied_after?: number | null; applied_delta?: number | null
}
interface InvSession { id: string; reference: string; status: string; started_by_name: string | null; started_at: string; products_total: number }
interface InvState {
  session: InvSession | null; counts: InvCount[]; products: InvProduct[]; categories: { id: string; name: string }[]
  last_completed: { id: string; reference: string; completed_at: string; legacy: boolean } | null
  has_history: boolean; can_write: boolean
}
interface HistoryRow {
  id: string; reference: string; status: string; started_at: string; completed_at: string | null; cancelled_at: string | null
  counted_total: number | null; discrepancy_total: number | null; legacy: boolean; by_name: string | null
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

export default function InventoryCountPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('inventoryCount')
  const tProducts = useTranslations('products')
  const tRoot = useTranslations()
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const { userShops, switchShop } = useAuth()
  const scope = useShopScope()
  const { canAccessIn } = useShopPermissions()
  const pastExpiry = usePastExpiryConfirm()

  // Boutique inventoriée : celle de l'en-tête ; en « Toutes », celle choisie explicitement
  const [chosenShopId, setChosenShopId] = useState<string | null>(null)
  const shop = (scope.shopId ? userShops.find(x => x.id === scope.shopId) : userShops.find(x => x.id === chosenShopId)) ?? null
  const multiShopAccount = userShops.length > 1
  // Droit « Inventaire » évalué DANS la boutique (jamais sur la boutique cachée)
  const isAuthorized = shop ? canAccessIn(shop.id, 'inventory_count') : scope.shopIds.some(id => canAccessIn(id, 'inventory_count'))

  const [data, setData] = useState<InvState | null>(null)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<'count' | 'review'>('count')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [recounting, setRecounting] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [conflict, setConflict] = useState<{ productId: string; qty: number; current: any } | null>(null)
  const [busy, setBusy] = useState<'start' | 'finalize' | 'cancel' | null>(null)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [recountList, setRecountList] = useState<any[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [detail, setDetail] = useState<{ session: any; counts: InvCount[] } | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Changement de contexte dans l'en-tête : choix fait en « Toutes », saisies et étapes oubliés — jamais repris
  const scopeKey = `${scope.mode}:${scope.shopIds.join(',')}`
  useEffect(() => {
    setChosenShopId(null); setData(null); setPhase('count'); setDrafts({}); setRecounting(new Set())
    setRecountList(null); setHistoryOpen(false); setDetail(null); setShowScanner(false)
  }, [scopeKey])

  const load = useCallback(async (quiet = false) => {
    if (!shop?.id) return
    if (!quiet) setLoading(true)
    try {
      const res = await withTimeout(fetch(`/api/stock/inventory-sessions?shop_id=${shop.id}`), 20_000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      setData(json)
      if (!json.session) setPhase('count')
    } catch {
      if (!quiet) toast({ title: t('error'), variant: 'destructive' })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [shop?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isAuthorized && shop?.id) load() }, [shop?.id, isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps
  // Retour sur l'onglet : comptages des autres employés relus (les saisies en cours restent)
  useRefetchOnVisible(() => { if (isAuthorized && shop?.id) load(true) })

  const chooseShop = async () => {
    const target = await scope.requireOneShop({ title: t('pick_shop_title'), eligible: s => canAccessIn(s.id, 'inventory_count') })
    if (!target) return
    setChosenShopId(target.id)
    switchShop(target.id) // boutique active interne alignée ; l'en-tête reste sur « Toutes »
  }

  const session = data?.session ?? null
  const canWrite = !!data?.can_write
  const countByProduct = useMemo(() => {
    const m = new Map<string, InvCount>()
    for (const c of data?.counts ?? []) if (c.product_id) m.set(c.product_id, c)
    return m
  }, [data?.counts])
  const products = data?.products ?? []
  const countedTotal = products.filter(p => countByProduct.has(p.id)).length
  const remaining = products.length - countedTotal
  const diffs = (data?.counts ?? []).filter(c => c.delta !== 0)
  const conformCount = (data?.counts ?? []).filter(c => c.delta === 0).length

  const visible = useMemo(() => {
    const q = normalize(search.trim())
    return products.filter(p => {
      const c = countByProduct.get(p.id)
      if (filter === 'todo' && c) return false
      if (filter === 'counted' && !c) return false
      if (filter === 'diff' && !(c && c.delta !== 0)) return false
      if (categoryFilter !== 'all' && p.category_id !== categoryFilter) return false
      if (q && !normalize(p.name).includes(q) && !normalize(p.sku || '').includes(q)) return false
      return true
    })
  }, [products, countByProduct, filter, categoryFilter, search])

  // ── Démarrer / reprendre ───────────────────────────────────────────────────
  const start = async () => {
    if (!shop) return
    setBusy('start')
    try {
      const res = await fetch('/api/stock/inventory-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id }) })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      await load(true)
    } finally { setBusy(null) }
  }

  // ── Compter un produit ─────────────────────────────────────────────────────
  const focusNext = (fromId: string) => {
    const idx = visible.findIndex(p => p.id === fromId)
    const next = visible.slice(idx + 1).find(p => !countByProduct.has(p.id) && p.id !== fromId)
    if (next) setTimeout(() => { inputRefs.current[next.id]?.focus(); inputRefs.current[next.id]?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 50)
  }
  const sendCount = async (productId: string, qty: number, expectedId: string | null) => {
    if (!shop || !session) return
    setSavingId(productId)
    try {
      const res = await fetch(`/api/stock/inventory-sessions/${session.id}/count`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shop.id, product_id: productId, counted_qty: qty, expected_count_id: expectedId }),
      })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      const r = json.data
      if (r.conflict) { setConflict({ productId, qty, current: r.current }); return }
      const product = products.find(p => p.id === productId)
      const line: InvCount = {
        id: r.id, product_id: productId, product_name: product?.name ?? '', unit: product?.unit ?? null,
        theoretical_qty: r.theoretical_qty, counted_qty: r.counted_qty, delta: r.delta,
        reason_code: null, surplus_expiry_date: null, recount_requested_at: null, counted_at: new Date().toISOString(),
      }
      setData(d => d ? { ...d, counts: [...d.counts.filter(c => c.product_id !== productId), line] } : d)
      setDrafts(m => { const n = { ...m }; delete n[productId]; return n })
      setRecounting(s => { const n = new Set(s); n.delete(productId); return n })
      focusNext(productId)
    } catch {
      toast({ title: t('error'), variant: 'destructive' })
    } finally { setSavingId(null) }
  }
  const submitCount = (productId: string) => {
    const raw = (drafts[productId] ?? '').trim()
    if (!/^\d+$/.test(raw)) { toast({ title: t('quantity_invalid'), variant: 'destructive' }); return }
    sendCount(productId, Number(raw), countByProduct.get(productId)?.id ?? null)
  }
  const startRecount = (productId: string) => {
    setRecounting(s => new Set(s).add(productId))
    setTimeout(() => inputRefs.current[productId]?.focus(), 50)
  }

  // ── Scanner : retrouver le produit, ouvrir son champ ───────────────────────
  const onScan = useCallback((code: string) => {
    setShowScanner(false)
    const value = code.trim()
    const p = products.find(x => (x.sku || '').trim() === value)
    if (!p) { toast({ title: t('scan_not_found', { code: value }), variant: 'destructive' }); return }
    setFilter('all'); setSearch(''); setCategoryFilter('all')
    if (countByProduct.has(p.id)) setRecounting(s => new Set(s).add(p.id))
    setTimeout(() => { inputRefs.current[p.id]?.focus(); inputRefs.current[p.id]?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 80)
  }, [products, countByProduct]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vérification des écarts : motif, date facultative d'un surplus ─────────
  const saveDetails = async (c: InvCount, patch: { reason_code?: string; surplus_expiry_date?: string | null }) => {
    if (!shop || !session) return
    const next = { ...c, ...patch }
    setData(d => d ? { ...d, counts: d.counts.map(x => x.id === c.id ? next : x) } : d)
    const res = await fetch(`/api/stock/inventory-sessions/${session.id}/details`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shop.id, count_id: c.id, reason: next.reason_code, surplus_expiry_date: next.delta > 0 ? (next.surplus_expiry_date || null) : null }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast({ title: json.error || t('error'), variant: 'destructive' })
      load(true)
    }
  }
  const missingReasons = diffs.filter(c => !c.reason_code).length

  // ── Finaliser ──────────────────────────────────────────────────────────────
  const openFinalize = async () => {
    if (!(await pastExpiry.confirm(diffs.filter(c => c.delta > 0).map(c => c.surplus_expiry_date)))) return
    setFinalizeOpen(true)
  }
  const finalize = async () => {
    if (!shop || !session) return
    setBusy('finalize')
    try {
      const res = await fetch(`/api/stock/inventory-sessions/${session.id}/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id }) })
      const json = await res.json()
      setFinalizeOpen(false)
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      const r = json.data
      if (r.status === 'recount_required') {
        setRecountList(r.conflicts || [])
        setPhase('count'); setFilter('diff')
        await load(true)
        return
      }
      toast({ title: t('finalized_toast', { reference: session.reference, adjusted: r.adjusted ?? 0 }), variant: 'success' })
      setPhase('count'); setFilter('all'); setRecountList(null)
      await load(true)
    } finally { setBusy(null) }
  }
  const cancelSession = async () => {
    if (!shop || !session) return
    setBusy('cancel')
    try {
      const res = await fetch(`/api/stock/inventory-sessions/${session.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id }) })
      const json = await res.json().catch(() => ({}))
      setCancelOpen(false)
      if (!res.ok) { toast({ title: json.error || t('error'), variant: 'destructive' }); return }
      toast({ title: t('abandon_done') })
      setPhase('count'); setRecountList(null); setDrafts({})
      await load(true)
    } finally { setBusy(null) }
  }

  // ── Historique ─────────────────────────────────────────────────────────────
  const openHistory = async () => {
    if (!shop) return
    setHistoryOpen(true); setHistory(null)
    const res = await fetch(`/api/stock/inventory-sessions/history?shop_id=${shop.id}`)
    const json = await res.json().catch(() => ({}))
    setHistory(res.ok ? json.data || [] : [])
  }
  const openDetail = async (id: string) => {
    if (!shop) return
    const res = await fetch(`/api/stock/inventory-sessions/${id}?shop_id=${shop.id}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setDetail(json)
    else toast({ title: json.error || t('error'), variant: 'destructive' })
  }

  const fmtDate = (v: string, withTime = false) => formatLocaleDate(v, locale, withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })

  if (!isAuthorized) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ClipboardCheck className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('no_access')}</p>
        </div>
      </div>
    )
  }

  const filterChips: { key: Filter; label: string }[] = [
    { key: 'all', label: t('filter_all') },
    { key: 'todo', label: t('filter_todo') },
    { key: 'counted', label: t('filter_counted') },
    { key: 'diff', label: t('filter_diff') },
  ]

  return (
    <div className="space-y-4 pb-28">
      {/* Pastille remplacée par l'indication explicite « Inventaire : … » juste dessous */}
      <PageHeader badge={false} title={tRoot('nav.inventory_count')} description={tRoot('page_header.stock_inventory')} />
      {/* Boutique inventoriée : toujours visible (compte à plusieurs boutiques) */}
      {shop && multiShopAccount && (
        <div className="flex flex-wrap items-center gap-2" data-testid="inventory-shop">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stockshop-blue/30 bg-stockshop-blue-muted px-3 py-1 text-xs font-semibold text-stockshop-blue dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-300">
            <Store aria-hidden className="h-3.5 w-3.5 shrink-0" />{t('counting_in', { name: shop.name })}
          </span>
          {!scope.shopId && !session && (
            <button type="button" onClick={chooseShop} className="min-h-10 text-xs font-medium text-stockshop-blue underline dark:text-blue-400" data-testid="inventory-change-shop">
              {t('change_shop')}
            </button>
          )}
        </div>
      )}

      {!shop && (
        <div className="rounded-xl border bg-card p-5 text-center" data-testid="inventory-pick-shop">
          <Store aria-hidden className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('pick_shop_explain')}</p>
          <Button variant="stockshop" className="mt-4 h-11" onClick={chooseShop}>{t('pick_shop_button')}</Button>
        </div>
      )}

      {shop && (loading || !data) && (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      )}

      {/* ── Aucun inventaire en cours ── */}
      {shop && data && !loading && !session && (
        <div className="rounded-xl border bg-card p-5 sm:p-6" data-testid="inventory-idle">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">
              <ClipboardCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{t('intro_title')}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('intro_text')}</p>
              <p className="mt-2 text-xs text-muted-foreground" data-testid="inventory-last">
                {data.last_completed ? t('last_inventory', { date: fmtDate(data.last_completed.completed_at) }) : t('no_inventory_yet')}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {canWrite && (
              <Button variant="stockshop" className="h-11 sm:min-w-[220px]" onClick={start} loading={busy === 'start'} data-testid="inventory-start">
                {t('start')}
              </Button>
            )}
            {data.has_history && (
              <Button variant="outline" className="h-11 gap-2" onClick={openHistory} data-testid="inventory-history">
                <History className="h-4 w-4" aria-hidden />{t('history_button')}
              </Button>
            )}
          </div>
          {!canWrite && <p className="mt-3 text-xs text-muted-foreground">{t('read_only_note')}</p>}
        </div>
      )}

      {/* ── Inventaire en cours : comptage ── */}
      {shop && data && !loading && session && phase === 'count' && (
        <>
          <div className="rounded-xl border bg-card p-4" data-testid="inventory-session">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t('in_progress_title', { reference: session.reference })}</p>
                <p className="text-xs text-muted-foreground">
                  {session.started_by_name
                    ? t('started_by', { name: session.started_by_name, date: fmtDate(session.started_at, true) })
                    : t('started_on', { date: fmtDate(session.started_at, true) })}
                </p>
              </div>
              {canWrite && (
                <button type="button" onClick={() => setCancelOpen(true)} className="min-h-10 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-destructive hover:underline" data-testid="inventory-abandon">
                  {t('abandon')}
                </button>
              )}
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium" data-testid="inventory-progress">{t('progress_v2', { counted: countedTotal, total: products.length })}</span>
                {remaining > 0 && <span className="text-xs text-muted-foreground">{t('remaining', { count: remaining })}</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-stockshop-blue transition-all dark:bg-blue-500" style={{ width: `${products.length ? Math.round((countedTotal / products.length) * 100) : 0}%` }} />
              </div>
            </div>
          </div>

          {recountList && recountList.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40" data-testid="inventory-recount-required">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{t('recount_required_title')}
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{t('recount_required_desc')}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
                {recountList.map((c: any) => (
                  <li key={c.count_id}>{t('recount_line', { name: c.product_name, counted: c.counted_qty, current: c.current_qty })}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recherche, scan, filtres simples */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search_placeholder_v2')} aria-label={t('search_placeholder_v2')} className="h-11 pl-9 sm:h-10" data-testid="inventory-search" />
              </div>
              {canWrite && (
                <Button variant="outline" className="h-11 gap-2 sm:h-10" onClick={() => setShowScanner(v => !v)} aria-pressed={showScanner} aria-label={t('scan')} title={t('scan')} data-testid="inventory-scan">
                  <Scan className="h-4 w-4" aria-hidden /><span className="hidden min-[400px]:inline">{t('scan')}</span>
                </Button>
              )}
            </div>
            {showScanner && <BarcodeScanner onDetected={onScan} onClose={() => setShowScanner(false)} />}
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedTabs value={filter} onChange={k => setFilter(k as Filter)} testId="inventory-filters"
                items={filterChips.map(f => ({ key: f.key, label: f.label, attrs: { 'data-filter': f.key } }))} />
              {(data.categories.length > 0) && (
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 w-[170px]" aria-label={tProducts('category')}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="all">{t('all_categories')}</SelectItem>
                    {data.categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Liste : une carte par produit — aucun prix, coût ni valeur */}
          {visible.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">{t('no_products')}</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="inventory-list">
              {visible.map(p => {
                const c = countByProduct.get(p.id)
                const editing = !c || recounting.has(p.id)
                const draft = drafts[p.id] ?? ''
                return (
                  <div key={p.id} data-product-id={p.id} data-state={!c ? 'todo' : c.delta === 0 ? 'conform' : 'diff'}
                    className={cn('rounded-xl border bg-card p-3', c && c.delta !== 0 && 'border-amber-300 dark:border-amber-700', c?.recount_requested_at && 'ring-2 ring-amber-400/60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{unitLabel(p.unit, 2)}{p.sku ? ` · ${p.sku}` : ''}</p>
                      </div>
                      {c?.recount_requested_at && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">{t('to_recount')}</span>}
                    </div>

                    {c && !editing && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm" data-testid="inventory-result">
                          <span className="font-semibold">{t('counted_n', { count: c.counted_qty })}</span>
                          {c.delta === 0 ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t('conform')}</span>
                          ) : (
                            <span className="ml-2 font-semibold text-amber-700 dark:text-amber-400">{t('gap', { value: signed(c.delta) })}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">{t('theoretical', { value: c.theoretical_qty })}</span>
                        </div>
                        {canWrite && (
                          <button type="button" onClick={() => startRecount(p.id)} className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-stockshop-blue dark:text-blue-400" data-testid="inventory-recount">
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />{t('recount')}
                          </button>
                        )}
                      </div>
                    )}

                    {editing && canWrite && (
                      <form className="mt-2 flex items-end gap-2" onSubmit={e => { e.preventDefault(); submitCount(p.id) }}>
                        <label className="min-w-0 flex-1">
                          <span className="mb-1 block text-xs text-muted-foreground">{t('counted_label')}</span>
                          {/* Champ VIDE au départ : jamais le stock enregistré, ni en valeur ni en exemple */}
                          <Input
                            ref={el => { inputRefs.current[p.id] = el }}
                            inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                            value={draft}
                            onChange={e => setDrafts(m => ({ ...m, [p.id]: e.target.value.replace(/[^\d]/g, '') }))}
                            className="h-11 text-base tabular-nums"
                            aria-label={`${t('counted_label')} — ${p.name}`}
                            data-testid="inventory-qty"
                          />
                        </label>
                        <Button type="submit" variant="stockshop" className="h-11 min-w-[96px]" loading={savingId === p.id} disabled={draft === ''} data-testid="inventory-validate">
                          {t('count_button')}
                        </Button>
                        {c && (
                          <Button type="button" variant="ghost" className="h-11 px-3" onClick={() => setRecounting(s => { const n = new Set(s); n.delete(p.id); return n })}>
                            {t('cancel')}
                          </Button>
                        )}
                      </form>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {canWrite && countedTotal > 0 && (
            <div className="fixed bottom-20 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-4 sm:bottom-6">
              <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-xl">
                <span className="flex-1 text-sm">{t('progress_v2', { counted: countedTotal, total: products.length })}</span>
                <Button variant="stockshop" className="h-11" onClick={() => { setPhase('review'); window.scrollTo({ top: 0 }) }} data-testid="inventory-review">
                  {t('review_button')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Vérification des écarts ── */}
      {shop && data && !loading && session && phase === 'review' && (
        <div className="space-y-3" data-testid="inventory-review-step">
          <button type="button" onClick={() => setPhase('count')} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-stockshop-blue dark:text-blue-400">
            <ArrowLeft className="h-4 w-4" aria-hidden />{t('back_to_count')}
          </button>
          <div className="rounded-xl border bg-card p-4">
            <h2 className="text-base font-semibold">{t('review_title')}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{diffs.length ? t('review_intro') : t('review_none')}</p>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="inventory-review-summary">
              {t('conform_count', { count: conformCount })}{remaining > 0 ? ` · ${t('uncounted_note', { count: remaining })}` : ''}
            </p>
          </div>
          {diffs.map(c => (
            <div key={c.id} className="rounded-xl border border-amber-300 bg-card p-4 dark:border-amber-700" data-diff-id={c.id}>
              <p className="text-sm font-semibold">{c.product_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {t('theoretical', { value: c.theoretical_qty })} · {t('counted_value', { value: c.counted_qty })} · <span className="font-semibold text-amber-700 dark:text-amber-400">{t('gap', { value: signed(c.delta) })}</span>
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium">{t('reason_label')}</span>
                  {/* Liste native : fiable sur téléphone et dans les vues intégrées */}
                  <select
                    value={c.reason_code ?? ''}
                    onChange={e => saveDetails(c, { reason_code: e.target.value })}
                    className={cn('h-11 w-full rounded-md border bg-background px-3 text-sm sm:h-10', !c.reason_code && 'border-amber-400')}
                    aria-label={`${t('reason_label')} — ${c.product_name}`}
                    data-testid="inventory-reason"
                  >
                    <option value="" disabled>{t('reason_placeholder')}</option>
                    {REASONS.map(r => <option key={r} value={r}>{tProducts(r)}</option>)}
                  </select>
                </div>
                {c.delta > 0 && (
                  <ExpiryDateField id={`surplus-${c.id}`} value={c.surplus_expiry_date} onChange={v => saveDetails(c, { surplus_expiry_date: v || null })} />
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {missingReasons > 0 && <p className="text-xs text-amber-700 dark:text-amber-400 sm:mr-auto sm:self-center">{t('reasons_missing', { count: missingReasons })}</p>}
            <Button variant="stockshop" className="h-11 sm:min-w-[240px]" disabled={missingReasons > 0 || countedTotal === 0} onClick={openFinalize} data-testid="inventory-finalize">
              {t('finalize')}
            </Button>
          </div>
        </div>
      )}

      {/* Comptage déjà fait par quelqu'un d'autre : jamais d'écrasement silencieux */}
      <ConfirmModal
        open={!!conflict}
        onOpenChange={o => { if (!o) setConflict(null) }}
        title={t('conflict_title')}
        description={conflict ? (conflict.current
          ? t('conflict_desc', { name: conflict.current.counted_by_name || t('someone'), qty: conflict.current.counted_qty, time: fmtDate(conflict.current.counted_at, true), mine: conflict.qty })
          : t('conflict_desc_removed', { mine: conflict.qty })) : undefined}
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="warning"
        confirmLabel={t('conflict_confirm')}
        onConfirm={() => { const c = conflict; setConflict(null); if (c) sendCount(c.productId, c.qty, c.current?.id ?? null) }}
      />

      <ConfirmModal
        open={finalizeOpen}
        onOpenChange={o => { if (!o && busy !== 'finalize') setFinalizeOpen(false) }}
        title={multiShopAccount && shop ? t('confirm_title_shop', { name: shop.name }) : t('finalize_title')}
        icon={<ClipboardCheck className="h-4 w-4" />}
        confirmLabel={t('finalize')}
        loading={busy === 'finalize'}
        onConfirm={finalize}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="inventory-finalize-points">
          <li>{t('finalize_point_adjust', { count: diffs.length })}</li>
          <li>{t('finalize_point_close')}</li>
          <li>{t('finalize_point_history')}</li>
        </ul>
      </ConfirmModal>

      <ConfirmModal
        open={cancelOpen}
        onOpenChange={o => { if (!o && busy !== 'cancel') setCancelOpen(false) }}
        title={t('abandon_title')}
        description={t('abandon_desc')}
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('abandon')}
        loading={busy === 'cancel'}
        onConfirm={cancelSession}
      />

      {pastExpiry.dialog}

      {/* Historique : liste puis détail en lecture seule (panneau commun) */}
      <DetailDrawer open={historyOpen && !detail} onOpenChange={o => { if (!o) setHistoryOpen(false) }} title={t('history_title')} icon={<History className="h-4 w-4" />} testId="inventory-history-drawer">
        {!history ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('history_empty')}</p>
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <button key={h.id} type="button" onClick={() => openDetail(h.id)} data-history-id={h.id}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{h.reference} · {fmtDate(h.completed_at || h.cancelled_at || h.started_at)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`status_${h.status}` as any)}{h.by_name ? ` · ${t('by', { name: h.by_name })}` : ''}
                    {h.status === 'completed' && <> · {t('products_counted', { count: h.counted_total ?? 0 })} · {t('gaps_count', { count: h.discrepancy_total ?? 0 })}</>}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={!!detail}
        onOpenChange={o => { if (!o) setDetail(null) }}
        title={detail ? t('detail_title', { reference: detail.session.reference }) : ''}
        icon={<ClipboardCheck className="h-4 w-4" />}
        testId="inventory-detail-drawer"
        meta={detail && (
          <div className="text-xs text-muted-foreground">
            {t(`status_${detail.session.status}` as any)} · {fmtDate(detail.session.completed_at || detail.session.cancelled_at || detail.session.started_at, true)}
            {(detail.session.completed_by_name || detail.session.cancelled_by_name) && <> · {t('by', { name: detail.session.completed_by_name || detail.session.cancelled_by_name })}</>}
            {detail.session.legacy && <p className="mt-1">{t('legacy_note')}</p>}
          </div>
        )}
      >
        {detail && (
          <DrawerSection title={t('products_counted', { count: detail.counts.length })}>
            <ul className="divide-y">
              {detail.counts.map(c => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('theoretical', { value: c.theoretical_qty })} · {t('counted_value', { value: c.counted_qty })}
                      {c.delta !== 0 && c.reason_code && <> · {tProducts(c.reason_code as any)}</>}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-xs font-semibold', c.delta === 0 ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400')}>
                    {c.delta === 0 ? t('conform') : signed(c.delta)}
                  </span>
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}
      </DetailDrawer>
    </div>
  )
}
