'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Archive, ChevronDown, Edit2, ExternalLink, History, Plus, RotateCcw, Search, Tag, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useCurrency } from '@/lib/hooks/use-currency'
import { withTimeout } from '@/lib/utils/with-timeout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { cn } from '@/lib/utils/cn'

// Journal d'activité du catalogue (création, modification, promo, archivage,
// restauration, suppression) : actions des utilisateurs, pas des mouvements de
// stock (ceux-là ont leur onglet). Panneau latéral ouvert depuis Produits,
// propriétaire uniquement.
// Filtres : recherche par produit (côté serveur), période (raccourcis ou dates
// « Du / Au »), type d'action ; pagination par 50. Entrées regroupées par jour ;
// un clic déplie le détail sur place (qui, quand, tableau Avant / Après, liste
// des produits d'une suppression groupée, ventes pendant une promo, lien vers
// la fiche du produit).

const PAGE = 50

type ActionGroup = 'all' | 'created' | 'updated' | 'promo' | 'archived' | 'deleted'
type Period = 'all' | 'today' | '7d' | '30d' | 'custom'

const GROUPS: Record<Exclude<ActionGroup, 'all'>, string[]> = {
  created: ['create_product'],
  updated: ['update_product'],
  promo: ['update_batch_promo', 'bulk_update_promo'],
  archived: ['archive_product', 'restore_product'],
  deleted: ['delete_product', 'bulk_delete_products', 'delete_all_products'],
}
const ALL_ACTIONS = Object.values(GROUPS).flat()

// Pastille par type d'action : icône + couleurs (fond doux, texte)
const KIND: Record<string, { icon: typeof Plus; tone: string }> = {
  create_product: { icon: Plus, tone: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' },
  update_product: { icon: Edit2, tone: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400' },
  update_batch_promo: { icon: Tag, tone: 'bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400' },
  bulk_update_promo: { icon: Tag, tone: 'bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400' },
  archive_product: { icon: Archive, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400' },
  restore_product: { icon: RotateCcw, tone: 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' },
  delete_product: { icon: Trash2, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
  bulk_delete_products: { icon: Trash2, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
  delete_all_products: { icon: Trash2, tone: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
}

const PRICE_FIELDS = new Set(['selling_price', 'buying_price', 'promo_price'])
const DATE_FIELDS = new Set(['promo_until', 'promo_start'])
const FIELD_KEYS: Record<string, string> = {
  name: 'products.journal_field_name',
  selling_price: 'products.journal_field_selling_price',
  buying_price: 'products.journal_field_buying_price',
  low_stock_threshold: 'products.journal_field_threshold',
  sku: 'products.journal_field_sku',
  category_id: 'products.journal_field_category',
  supplier_id: 'products.journal_field_supplier',
  promo_price: 'products.journal_field_promo_price',
  promo_until: 'products.journal_field_promo_until',
  promo_start: 'activity_journal.field_promo_start',
  unit: 'products.unit',
  quantity: 'products.quantity',
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shopId: string | undefined
  /** Ouvre la fiche du produit si elle existe encore (renvoie false sinon) */
  onOpenProduct?: (productId: string) => boolean
  /** Le produit est-il encore présent dans la liste ? */
  productExists?: (productId: string) => boolean
}

export function ProductActivityJournal({ open, onOpenChange, shopId, onOpenProduct, productExists }: Props) {
  const t = useTranslations()
  const tj = useTranslations('activity_journal')
  const locale = useLocale()
  const { fmt: formatMoney } = useCurrency()
  const supabase = createClient() as any

  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [group, setGroup] = useState<ActionGroup>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Ventes pendant une promo passée : calculé à la demande, pas au chargement
  const [promoSales, setPromoSales] = useState<Record<string, { loading: boolean; qty: number | null }>>({})

  useEffect(() => { const id = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(id) }, [search])
  // Nouveaux filtres : on repart de la première page
  useEffect(() => { setLimit(PAGE) }, [debounced, period, dateFrom, dateTo, group])

  const range = useMemo((): { from?: string; to?: string } => {
    const now = new Date()
    const start = (daysBack: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysBack); return d.toISOString() }
    if (period === 'today') return { from: start(0) }
    if (period === '7d') return { from: start(6) }
    if (period === '30d') return { from: start(29) }
    if (period === 'custom') return {
      from: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
      to: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
    }
    return {}
  }, [period, dateFrom, dateTo])

  const fetchLogs = async () => {
    if (!shopId) return
    setLoading(true)
    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('shop_id', shopId)
      .in('action', group === 'all' ? ALL_ACTIONS : GROUPS[group])
      .order('created_at', { ascending: false })
      .range(0, limit - 1)
    if (range.from) query = query.gte('created_at', range.from)
    if (range.to) query = query.lte('created_at', range.to)
    if (debounced) query = query.ilike('metadata->>product_name', `%${debounced.replace(/[%_\\]/g, m => `\\${m}`)}%`)
    try {
      // Borné : une session périmée après un passage en arrière-plan ne doit
      // jamais laisser le journal tourner indéfiniment.
      const { data, count } = await withTimeout<any>(query, 20_000, 'Chargement du journal trop lent — réessayez.')
      setLogs(data || [])
      setTotal(typeof count === 'number' ? count : null)
    } catch {
      // le journal reste tel quel : information secondaire
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) fetchLogs() }, [open, shopId, limit, debounced, range.from, range.to, group]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) setExpanded(null) }, [open])

  const fetchPromoSales = async (logId: string, productId: string, from: string, until: string) => {
    setPromoSales(prev => ({ ...prev, [logId]: { loading: true, qty: null } }))
    try {
      const { data } = await withTimeout<any>(
        supabase
          .from('sale_items')
          .select('quantity, sales!inner(created_at, sale_status)')
          .eq('product_id', productId)
          .gte('sales.created_at', from)
          .lte('sales.created_at', until)
          .eq('sales.sale_status', 'active'),
        15_000,
      )
      const qty = (data || []).reduce((sum: number, row: any) => sum + row.quantity, 0)
      setPromoSales(prev => ({ ...prev, [logId]: { loading: false, qty } }))
    } catch {
      setPromoSales(prev => ({ ...prev, [logId]: { loading: false, qty: null } }))
    }
  }

  const fieldLabel = (key: string) => (FIELD_KEYS[key] ? t(FIELD_KEYS[key] as any) : key)
  const fmtValue = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—'
    if (PRICE_FIELDS.has(key)) return formatMoney(Number(v))
    if (DATE_FIELDS.has(key)) return new Date(String(v)).toLocaleDateString(locale)
    return String(v)
  }
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const fmtFull = (iso: string) => new Date(iso).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // Titre + résumé court d'une entrée (ligne repliée)
  const describe = (log: any): { title: string; summary: string } => {
    const meta = log.metadata || {}
    switch (log.action) {
      case 'create_product':
        return { title: meta.product_name || t('products.journal_created'), summary: tj('summary_created') }
      case 'update_product': {
        const keys = Object.keys(meta.changes || {})
        return { title: meta.product_name || t('products.journal_updated'), summary: keys.length ? tj('summary_updated', { fields: keys.map(fieldLabel).join(' · ') }) : t('products.journal_updated') }
      }
      case 'archive_product':
        return { title: meta.product_name || '—', summary: t('products.journal_archived') }
      case 'restore_product':
        return { title: meta.product_name || '—', summary: t('products.journal_restored') }
      case 'delete_product':
        return { title: meta.product_name || '—', summary: t('products.journal_deleted') }
      case 'update_batch_promo':
        return { title: meta.product_name || t('products.journal_batch_promo_updated'), summary: meta.new_price ? tj('summary_batch_promo_set') : tj('summary_batch_promo_cleared') }
      case 'bulk_update_promo':
        return { title: t('products.journal_bulk_promo_updated'), summary: t('products.journal_bulk_promo_detail', { count: meta.count, percent: meta.percent ?? 0 }) }
      case 'bulk_delete_products':
        return { title: t('products.journal_bulk_delete'), summary: tj('summary_count', { count: meta.count ?? 0 }) }
      default:
        return { title: t('products.all_deleted_toast'), summary: tj('summary_count', { count: meta.count ?? 0 }) }
    }
  }

  // Regroupement par jour : « Aujourd'hui », « Hier », sinon la date
  const groups = useMemo(() => {
    const today = isoDay(new Date())
    const y = new Date(); y.setDate(y.getDate() - 1)
    const yesterday = isoDay(y)
    const thisYear = new Date().getFullYear()
    const out: { key: string; label: string; items: any[] }[] = []
    for (const log of logs) {
      const d = new Date(log.created_at)
      const day = isoDay(d)
      let g = out[out.length - 1]
      if (!g || g.key !== day) {
        const label = day === today ? tj('today') : day === yesterday ? tj('yesterday')
          : d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === thisYear ? undefined : 'numeric' })
        g = { key: day, label, items: [] }
        out.push(g)
      }
      g.items.push(log)
    }
    return out
  }, [logs, locale, tj])

  const filtersActive = !!search || period !== 'all' || group !== 'all'
  const resetFilters = () => { setSearch(''); setPeriod('all'); setDateFrom(''); setDateTo(''); setGroup('all') }

  const renderDetail = (log: any) => {
    const meta = log.metadata || {}
    const changes: Record<string, { from: unknown; to: unknown }> = meta.changes || {}
    const productId: string | null = log.action === 'update_batch_promo' ? meta.product_id || null : (log.target_type === 'product' ? log.target_id : null)
    const deleted = log.action === 'delete_product' || log.action === 'bulk_delete_products' || log.action === 'delete_all_products'
    const canOpen = !!productId && !!onOpenProduct && !deleted && (!productExists || productExists(productId))

    let promoQuery: { productId: string; from: string; until: string } | null = null
    if (log.action === 'update_product' && changes.promo_price?.to && changes.promo_until?.to) {
      promoQuery = { productId: log.target_id, from: log.created_at, until: String(changes.promo_until.to) }
    } else if (log.action === 'update_batch_promo' && meta.new_price && meta.new_until && meta.product_id) {
      promoQuery = { productId: meta.product_id, from: log.created_at, until: meta.new_until }
    }
    const sales = promoSales[log.id]

    const rows: { label: string; from?: string; to: string }[] = []
    if (log.action === 'update_product') {
      for (const [k, v] of Object.entries(changes)) rows.push({ label: fieldLabel(k), from: fmtValue(k, v?.from), to: fmtValue(k, v?.to) })
    } else if (log.action === 'create_product') {
      rows.push({ label: fieldLabel('selling_price'), to: fmtValue('selling_price', meta.selling_price) })
      if (meta.buying_price != null) rows.push({ label: fieldLabel('buying_price'), to: fmtValue('buying_price', meta.buying_price) })
      rows.push({ label: fieldLabel('quantity'), to: fmtValue('quantity', meta.quantity) })
    } else if (log.action === 'update_batch_promo') {
      rows.push({ label: fieldLabel('promo_price'), from: fmtValue('promo_price', meta.old_price), to: fmtValue('promo_price', meta.new_price) })
      rows.push({ label: fieldLabel('promo_until'), from: fmtValue('promo_until', meta.old_until), to: fmtValue('promo_until', meta.new_until) })
    } else if (log.action === 'delete_product') {
      if (meta.sku) rows.push({ label: fieldLabel('sku'), to: String(meta.sku) })
      if (meta.selling_price != null) rows.push({ label: fieldLabel('selling_price'), to: fmtValue('selling_price', meta.selling_price) })
      if (meta.quantity != null) rows.push({ label: tj('stock_at_deletion'), to: String(meta.quantity) })
    } else if (log.action === 'bulk_update_promo') {
      rows.push({ label: tj('discount'), to: `${meta.percent ?? 0} %` })
      rows.push({ label: tj('products_affected'), to: String(meta.count ?? 0) })
    }
    const hasBefore = rows.some(r => r.from !== undefined)
    const snapshot: any[] = meta.products_snapshot || []

    return (
      <div className="space-y-3 border-t border-border bg-muted/30 px-3 py-3 text-sm" data-testid="journal-detail">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{tj('who')}</dt>
          <dd className="font-medium">{meta.actor_name || log.actor_email || '—'}</dd>
          <dt className="text-muted-foreground">{tj('when')}</dt>
          <dd className="first-letter:uppercase">{fmtFull(log.created_at)}</dd>
        </dl>

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{tj('field')}</th>
                  {hasBefore && <th className="px-3 py-2 text-left font-medium">{tj('before')}</th>}
                  <th className="px-3 py-2 text-left font-medium">{hasBefore ? tj('after') : tj('value')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.label}>
                    <td className="px-3 py-2 text-muted-foreground">{r.label}</td>
                    {hasBefore && <td className="px-3 py-2 tabular-nums text-muted-foreground line-through decoration-muted-foreground/50">{r.from ?? '—'}</td>}
                    <td className="px-3 py-2 font-medium tabular-nums">{r.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {snapshot.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{tj('deleted_products')}</p>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background text-xs">
              {snapshot.map((p, i) => (
                <li key={p.id || i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="truncate">{p.name}</span>
                  {p.quantity != null && <span className="tabular-nums text-muted-foreground">{tj('qty_short', { count: p.quantity })}</span>}
                </li>
              ))}
            </ul>
            {(meta.count ?? 0) > snapshot.length && (
              <p className="text-xs text-muted-foreground">{tj('and_more', { count: meta.count - snapshot.length })}</p>
            )}
          </div>
        )}

        {(promoQuery || canOpen) && (
          <div className="flex flex-wrap items-center gap-2">
            {promoQuery && (
              sales ? (
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  {sales.loading ? t('products.journal_promo_sales_loading')
                    : sales.qty !== null ? t('products.journal_promo_sales_result', { count: sales.qty })
                    : t('products.journal_promo_sales_error')}
                </span>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                  onClick={() => promoQuery && fetchPromoSales(log.id, promoQuery.productId, promoQuery.from, promoQuery.until)}>
                  {t('products.journal_promo_sales_button')}
                </Button>
              )
            )}
            {canOpen && (
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="journal-view-product"
                onClick={() => { if (productId && onOpenProduct?.(productId)) onOpenChange(false) }}>
                <ExternalLink className="h-3.5 w-3.5" /> {tj('view_product')}
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('products.activity_journal')}
      description={t('products.activity_journal_hint')}
      icon={<History className="h-4 w-4" />}
      width="lg"
      testId="journal-drawer"
      meta={(
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={tj('search_placeholder')} aria-label={tj('search_placeholder')} className="pl-9 pr-9" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label={t('actions.clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tj('period_label')}</Label>
              <Select value={period} onValueChange={v => setPeriod(v as Period)}>
                <SelectTrigger className="h-10" data-testid="journal-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tj('period_all')}</SelectItem>
                  <SelectItem value="today">{tj('today')}</SelectItem>
                  <SelectItem value="7d">{tj('period_7d')}</SelectItem>
                  <SelectItem value="30d">{tj('period_30d')}</SelectItem>
                  <SelectItem value="custom">{tj('period_custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{tj('action_label')}</Label>
              <Select value={group} onValueChange={v => setGroup(v as ActionGroup)}>
                <SelectTrigger className="h-10" data-testid="journal-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tj('action_all')}</SelectItem>
                  <SelectItem value="created">{tj('action_created')}</SelectItem>
                  <SelectItem value="updated">{tj('action_updated')}</SelectItem>
                  <SelectItem value="promo">{tj('action_promo')}</SelectItem>
                  <SelectItem value="archived">{tj('action_archived')}</SelectItem>
                  <SelectItem value="deleted">{tj('action_deleted')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {period === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="journal-from" className="text-xs text-muted-foreground">{tj('from')}</Label>
                <Input id="journal-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="journal-to" className="text-xs text-muted-foreground">{tj('to')}</Label>
                <Input id="journal-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span data-testid="journal-count">{total !== null ? tj('count', { count: total }) : ' '}</span>
            {filtersActive && (
              <button type="button" onClick={resetFilters} className="font-medium text-stockshop-blue hover:underline dark:text-blue-400">
                {tj('reset')}
              </button>
            )}
          </div>
        </div>
      )}
    >
      {loading && logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('team.journal_loading')}</p>
      ) : logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{filtersActive ? tj('empty_filtered') : t('team.journal_empty')}</p>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <section key={g.key} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h4>
              <div className="space-y-2">
                {g.items.map(log => {
                  const kind = KIND[log.action] || KIND.delete_product
                  const Icon = kind.icon
                  const { title, summary } = describe(log)
                  const isOpen = expanded === log.id
                  const actor = log.metadata?.actor_name || log.actor_email || '—'
                  return (
                    <div key={log.id} className={cn('overflow-hidden rounded-lg border bg-card transition-shadow', isOpen && 'shadow-sm ring-1 ring-stockshop-blue/20')}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        data-testid="journal-entry"
                      >
                        <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', kind.tone)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground/80">{actor} · {fmtTime(log.created_at)}</span>
                        </span>
                        <ChevronDown className={cn('mt-1.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && renderDetail(log)}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          {total !== null && logs.length < total && (
            <div className="flex justify-center pt-1">
              <Button type="button" variant="outline" className="h-10" loading={loading} onClick={() => setLimit(l => l + PAGE)}>
                {tj('load_more', { shown: logs.length, total })}
              </Button>
            </div>
          )}
        </div>
      )}
    </DetailDrawer>
  )
}
