'use client'

// Stock › Transferts V1 (conception validée le 30 oct. 2026, maquette de l'utilisateur) : 3 compteurs cliquables
// (Tous / En transit / Reçus), recherche (référence, boutiques, produits), « Filtrer » (OU dans une dimension, ET
// entre dimensions) avec pastilles, « Scanner » (QR d'un transfert : ouvre la réception, ne réceptionne jamais),
// « + Nouveau transfert », cartes entièrement cliquables avec menu « … » (QR, bon, partage, e-mail, WhatsApp,
// annulation). Contexte : une boutique ou « Toutes les boutiques » ; chaque action utilise les boutiques RÉELLES du
// transfert ; une création depuis « Toutes » demande la boutique source. Le serveur revérifie tous les droits.
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, Download, FileEdit, MessageCircle, Plus, QrCode, ScanLine, Search, Send, Share2, Truck } from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { useFilterScope } from '@/lib/filters/use-filter-scope'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'
import { generateStockTransferPDF } from '@/lib/utils/pdf'
import { isCapacitor } from '@/lib/utils/native-share'
import { formatLocaleDate } from '@/lib/i18n/date-format'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'
import { activeFilterCount, filterTransfers, searchTransfers, transferKpis, type TransferFilters } from '@/lib/stock/transfers-view'
import { MoreButton, TransferCard, type TransferListRow } from './transfers/transfer-card'
import { TransferFilterChips, TransferFiltersButton, TransferFiltersDrawer, useTransferFilterOptions } from './transfers/transfer-filters'
import { TransferDetailDrawer } from './transfers/transfer-detail-drawer'
import { TransferCreateDrawer, type TransferDraftInput, type TransferPrefill } from './transfers/transfer-create-drawer'
import { TransferRequestsPanel, type TransferRequestRow } from './transfers/transfer-requests-panel'
import { TransferQrDialog, TransferScanDialog, fetchTransferQrUrl, qrDataUrl } from './transfers/transfer-qr'

type Kpi = 'all' | 'sent' | 'received'
const FILTER_DEFAULTS = { search: '', statuses: [] as string[], sources: [] as string[], destinations: [] as string[], products: [] as string[], creators: [] as string[], period: 'all' as TransferFilters['period'] }

export function StockTransfersTab() {
  const t = useTranslations('transfers')
  const tRoot = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const unitLabel = useUnitLabel()
  const { shop, userShops } = useAuth()
  const { isOnline } = useOffline()
  const { toast } = useToast()
  const { canWrite } = useRolePermissions()
  const canCreate = canWrite('transfers')

  const scope = useShopScope()
  const scopeKey = scope.shopIds.join(',')
  const filterScope = useFilterScope()
  const [rows, setRows] = useState<TransferListRow[]>(() => getPageCache<TransferListRow[]>(`transfers_${scopeKey}`) || [])
  const [workflow, setWorkflow] = useState(false)
  const [loading, setLoading] = useState(() => !getPageCache(`transfers_${scopeKey}`))
  const [saved, setFilter] = usePersistedFilters('transfers_v1', filterScope, FILTER_DEFAULTS, { keepPerScope: true })
  const filters: TransferFilters = { statuses: saved.statuses, sources: saved.sources, destinations: saved.destinations, products: saved.products, creators: saved.creators, period: saved.period }

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<{ id: string; reference: string } | null>(null)
  const [create, setCreate] = useState<{ source: any; draft: TransferDraftInput | null; prefill?: TransferPrefill | null } | null>(null)
  // Demandes de transfert (190) : relues après une décision ou un transfert créé depuis une demande
  const [requestsKey, setRequestsKey] = useState(0)
  const acceptRequest = (req: TransferRequestRow) => {
    const source = userShops.find(s => s.id === req.source_shop_id)
    if (!source) return
    setCreate({ source, draft: null, prefill: {
      request_id: req.id, destination_shop_id: req.requesting_shop_id, destination_name: req.requesting_shop_name, notes: req.note,
      items: [{ source_product_id: req.source_product_id, product_name: req.product_name, unit: req.unit, quantity_sent: req.quantity }],
    } })
  }
  const [busy, setBusy] = useState<string | null>(null)

  const fetchRows = async () => {
    if (!scope.shopIds.length) return
    const cacheKey = `transfers_${scopeKey}`
    const cached = getPageCache<TransferListRow[]>(cacheKey)
    if (cached) { setRows(cached); setLoading(false) }
    if (!isOnline) { if (!cached) setLoading(false); return }
    try {
      const res = await withTimeout(fetch(`/api/stock-transfers?shop_ids=${scopeKey}`), 20_000, tRoot('transfers.load_timeout'))
      if (!res.ok) return
      const json = await res.json()
      setRows(json.data || [])
      setWorkflow(!!json.workflow)
      setPageCache(cacheKey, json.data || [])
    } catch { /* cache déjà appliqué */ } finally { setLoading(false) }
  }
  useEffect(() => { fetchRows() }, [scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Changement de contexte : panneaux en cours fermés
  useEffect(() => { setCreate(null); setDetailId(null); setQrFor(null) }, [scopeKey])
  useRefetchOnVisible(() => { fetchRows() })
  useRefetchOnReconnect(() => { fetchRows() }, isOnline)

  const options = useTransferFilterOptions(rows)
  // Compteurs : sur la liste cherchée et filtrée HORS statut ; la liste applique aussi le statut
  const base = useMemo(() => filterTransfers(searchTransfers(rows, saved.search), { ...filters, statuses: [] }), [rows, saved.search, saved.sources, saved.destinations, saved.products, saved.creators, saved.period]) // eslint-disable-line react-hooks/exhaustive-deps
  const kpis = transferKpis(base)
  const list = useMemo(() => filterTransfers(base, { ...filters, sources: [], destinations: [], products: [], creators: [], period: 'all' }), [base, saved.statuses]) // eslint-disable-line react-hooks/exhaustive-deps
  const kpiActive: Kpi | null = !filters.statuses.length ? 'all' : filters.statuses.length === 1 && (filters.statuses[0] === 'sent' || filters.statuses[0] === 'received') ? filters.statuses[0] as Kpi : null
  const setKpi = (k: Kpi) => setFilter({ statuses: k === 'all' ? [] : [k] })

  // ── Actions ───────────────────────────────────────────────────────────────
  const openCreate = async () => {
    const source = await scope.requireOneShop({ title: tRoot('transfers.pick_source_title') })
    if (!source) return
    setCreate({ source, draft: null })
  }
  const openEdit = (tr: any) => {
    const source = userShops.find(s => s.id === tr.source_shop_id)
    if (!source) return
    setDetailId(null)
    setCreate({ source, draft: { id: tr.id, destination_shop_id: tr.destination_shop_id, notes: tr.notes, updated_at: tr.updated_at, items: tr.stock_transfer_items } })
  }
  const goReceive = (tr: { id: string }) => router.push(`/${locale}/stock/transfers/${tr.id}/receive`)
  const sendDraft = async (tr: any) => {
    setBusy(`send:${tr.id}`)
    try {
      const res = await fetch('/api/stock-transfers/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_id: tr.id }) })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || tRoot('toast.error'), variant: 'destructive' }); return }
      toast({ title: tRoot('transfers.created_toast', { reference: tr.reference }), variant: 'success' })
      setDetailId(null); fetchRows()
    } finally { setBusy(null) }
  }
  // Annulation : confirmation commune (rouge) nommant le transfert et ses deux boutiques, jamais le confirm() du navigateur
  const [cancelAsk, setCancelAsk] = useState<any | null>(null)
  const cancelTransfer = (tr: any) => setCancelAsk(tr)
  const doCancel = async () => {
    const tr = cancelAsk
    if (!tr) return
    setBusy(`cancel:${tr.id}`)
    try {
      const res = await fetch('/api/stock-transfers/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transfer_id: tr.id }) })
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || tRoot('toast.error'), variant: 'destructive' }); return }
      toast({ title: tRoot('transfers.cancelled_toast') })
      setCancelAsk(null); setDetailId(null); fetchRows()
    } finally { setBusy(null) }
  }
  const downloadNote = async (tr: TransferListRow) => {
    const url = tr.status === 'sent' ? await fetchTransferQrUrl(tr.id, locale) : null
    await generateStockTransferPDF({
      sourceShopName: tr.source_shop_name || '', destinationShopName: tr.destination_shop_name || '', reference: tr.reference,
      dateStr: formatLocaleDate(tr.sent_at || tr.created_at, locale, { day: 'numeric', month: 'long', year: 'numeric' }),
      notes: (tr as any).notes,
      items: (tr.stock_transfer_items || []).map(it => ({ name: it.product_name, quantity: it.quantity_sent, unit: unitLabel((it as any).unit, it.quantity_sent) })),
      qrDataUrl: url ? await qrDataUrl(url, 360) : null,
      qrCaption: url ? t('qr_hint') : undefined,
    })
  }
  const shareText = async (tr: TransferListRow) => {
    const url = tr.status === 'sent' ? await fetchTransferQrUrl(tr.id, locale) : null
    return [tr.reference, `${tr.source_shop_name} → ${tr.destination_shop_name}`, tRoot('transfers.items_count', { count: (tr.stock_transfer_items || []).length }), url].filter(Boolean).join('\n')
  }
  const share = async (tr: TransferListRow) => {
    const text = await shareText(tr)
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) await (navigator as any).share({ title: tr.reference, text })
      else { await navigator.clipboard.writeText(text); toast({ title: tRoot('suppliers.po_copied', { label: tr.reference }), variant: 'success' }) }
    } catch { /* partage annulé */ }
  }
  const whatsapp = async (tr: TransferListRow) => window.open(`https://wa.me/?text=${encodeURIComponent(await shareText(tr))}`, '_blank', 'noopener')

  const menuFor = (tr: TransferListRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><MoreButton /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {tr.status === 'sent' && <DropdownMenuItem onClick={() => setQrFor({ id: tr.id, reference: tr.reference })}><QrCode className="mr-2 h-4 w-4" />{t('action_show_qr')}</DropdownMenuItem>}
        {tr.status === 'draft' && tr.can_manage_source && workflow && <DropdownMenuItem onClick={() => sendDraft(tr)}><Send className="mr-2 h-4 w-4" />{t('action_send')}</DropdownMenuItem>}
        {tr.status === 'draft' && tr.can_manage_source && workflow && <DropdownMenuItem onClick={() => setDetailId(tr.id)}><FileEdit className="mr-2 h-4 w-4" />{t('action_edit')}</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => downloadNote(tr)}>{isCapacitor() ? <Share2 className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}{t('action_download')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => share(tr)}><Share2 className="mr-2 h-4 w-4" />{t('action_share')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => whatsapp(tr)}><MessageCircle className="mr-2 h-4 w-4" />{t('action_whatsapp')}</DropdownMenuItem>
        {(tr.status === 'draft' || tr.status === 'sent') && tr.can_manage_source && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => cancelTransfer(tr)}><Ban className="mr-2 h-4 w-4" />{t('action_cancel')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!shop) return null
  // Destinations : mes boutiques ; pour une demande acceptée, aussi la boutique qui demande (même si je n'en suis pas membre)
  const destShops = [
    ...userShops.filter(s => s.id !== create?.source?.id),
    ...(create?.prefill && !userShops.some(s => s.id === create.prefill!.destination_shop_id)
      ? [{ id: create.prefill.destination_shop_id, name: create.prefill.destination_name ?? '' } as any] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Demandes de transfert reçues / envoyées (absent s'il n'y en a pas) */}
      <TransferRequestsPanel shopIds={scope.shopIds} refreshKey={requestsKey} onAccept={acceptRequest} />

      {/* Compteurs : filtres rapides par statut */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label={t('filter_status')}>
        {([['all', kpis.all, Truck, 'text-stockshop-blue bg-stockshop-blue-muted dark:bg-blue-950/40 dark:text-blue-400', 'border-stockshop-blue/40'],
           ['sent', kpis.in_transit, Truck, 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400', 'border-orange-300 dark:border-orange-800'],
           ['received', kpis.received, CheckCircle2, 'text-green-600 bg-green-50 dark:bg-green-950/40 dark:text-green-400', 'border-green-300 dark:border-green-800']] as const).map(([k, n, Icon, iconCls, activeCls]) => (
          <button key={k} type="button" onClick={() => setKpi(k)} aria-pressed={kpiActive === k} data-testid={`transfers-kpi-${k}`}
            className={cn('flex min-h-[64px] items-center gap-2 rounded-xl border bg-card px-2.5 py-2 text-left shadow-sm transition-colors sm:gap-3 sm:px-4',
              kpiActive === k ? activeCls : 'hover:bg-muted/40')}>
            <span className={cn('hidden h-9 w-9 shrink-0 items-center justify-center rounded-full min-[380px]:flex', iconCls)}><Icon className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0">
              <span className="block text-lg font-bold leading-tight tabular-nums text-foreground">{n}</span>
              <span className="block truncate text-xs text-muted-foreground sm:text-sm">{k === 'all' ? t('kpi_all') : k === 'sent' ? t('kpi_in_transit') : t('kpi_received')}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Recherche, filtres, scan, création */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={saved.search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('search_placeholder')} className="h-11 pl-9" data-testid="transfers-search" />
        </div>
        <TransferFiltersButton count={activeFilterCount(filters)} onClick={() => setFiltersOpen(true)} />
        {workflow && (
          <Button variant="outline" className="h-11 shrink-0 gap-2 px-3" onClick={() => setScanOpen(true)} data-testid="transfers-scan" aria-label={t('scan_button')}>
            <ScanLine className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">{t('scan_button')}</span>
          </Button>
        )}
        {canCreate && userShops.length > 1 && (
          <Button variant="stockshop" className="h-11 w-full gap-2 sm:w-auto" onClick={openCreate} data-testid="transfers-new">
            <Plus className="h-4 w-4" />{tRoot('transfers.new_transfer')}
          </Button>
        )}
      </div>
      <TransferFilterChips value={filters} onChange={next => setFilter(next)} options={options} />

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : list.length === 0 ? (
        <div className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? tRoot('transfers.no_transfers') : tRoot('transfers.no_search_results')}
        </div>
      ) : (
        <div className="space-y-3" data-testid="transfers-list">
          {list.map(tr => (
            <TransferCard key={tr.id} tr={tr as TransferListRow} onOpen={() => setDetailId(tr.id)} onReceive={() => goReceive(tr)} menu={menuFor(tr as TransferListRow)} />
          ))}
        </div>
      )}

      <TransferFiltersDrawer open={filtersOpen} onOpenChange={setFiltersOpen} value={filters} onApply={next => setFilter(next)} options={options} />
      <TransferScanDialog open={scanOpen} onOpenChange={setScanOpen} activeShopId={scope.isAllShops ? null : scope.shopIds[0] ?? null} />
      <TransferQrDialog transfer={qrFor} onOpenChange={open => { if (!open) setQrFor(null) }} />
      <TransferDetailDrawer
        id={detailId} onOpenChange={open => { if (!open) setDetailId(null) }} busy={busy}
        onReceive={goReceive} onSend={sendDraft} onEdit={openEdit} onCancel={cancelTransfer} onShowQr={tr => setQrFor({ id: tr.id, reference: tr.reference })}
      />
      <TransferCreateDrawer
        open={!!create} onOpenChange={open => { if (!open) setCreate(null) }}
        source={create?.source ?? null} shops={destShops} workflow={workflow} draft={create?.draft ?? null} prefill={create?.prefill ?? null}
        onDone={({ reference, sent }) => {
          toast({ title: sent ? tRoot('transfers.created_toast', { reference }) : tRoot('transfers.draft_saved_toast', { reference }), variant: 'success' })
          fetchRows()
          setRequestsKey(k => k + 1)
        }}
      />

      {/* E-mail : assistant existant (objet et corps à copier, ou application de messagerie) */}
      <ConfirmModal
        open={!!cancelAsk} onOpenChange={o => { if (!o && !busy) setCancelAsk(null) }}
        tone="danger" icon={<Ban className="h-4 w-4" />}
        title={t('action_cancel')}
        description={cancelAsk ? tRoot('transfers.confirm_cancel_shops', { reference: cancelAsk.reference, from: cancelAsk.source_shop_name, to: cancelAsk.destination_shop_name }) : undefined}
        confirmLabel={t('action_cancel')} cancelLabel={tRoot('actions.back')}
        loading={!!cancelAsk && busy === `cancel:${cancelAsk.id}`}
        onConfirm={doCancel}
      />
    </div>
  )
}
