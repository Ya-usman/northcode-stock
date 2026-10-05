'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Archive, Edit2, History, Plus, RotateCcw, Search, Tag, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useCurrency } from '@/lib/hooks/use-currency'
import { normalize } from '@/lib/utils/normalize'
import { withTimeout } from '@/lib/utils/with-timeout'
import { Input } from '@/components/ui/input'
import { DetailDrawer } from '@/components/ui/detail-drawer'

// Journal d'activité du catalogue (création, modification de prix, promo,
// archivage, restauration, suppression) : ce sont des actions utilisateur,
// pas des mouvements de stock (ceux-là ont leur onglet). Ancien sous-onglet
// « Journal » de la page Stock, déplacé tel quel dans un panneau latéral
// ouvert depuis la barre d'actions de Produits. Propriétaire uniquement.

const ACTIONS = [
  'delete_product', 'bulk_delete_products', 'delete_all_products', 'create_product', 'update_product',
  'archive_product', 'restore_product', 'update_batch_promo', 'bulk_update_promo',
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  shopId: string | undefined
}

export function ProductActivityJournal({ open, onOpenChange, shopId }: Props) {
  const t = useTranslations()
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const supabase = createClient() as any

  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  // Ventes pendant une promo passée : calculé à la demande (bouton par
  // entrée), pas au chargement, pour éviter une requête par ligne.
  const [promoSales, setPromoSales] = useState<Record<string, { loading: boolean; qty: number | null }>>({})

  const fetchLogs = async () => {
    if (!shopId) return
    setLoading(true)
    let query = supabase
      .from('audit_logs')
      .select('*')
      .eq('shop_id', shopId)
      .in('action', ACTIONS)
      .order('created_at', { ascending: false })
      .limit(100)
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)
    try {
      // Borné : une session périmée après un passage en arrière-plan ne doit
      // jamais laisser le journal tourner indéfiniment.
      const { data } = await withTimeout<any>(query, 20_000, 'Chargement du journal trop lent — réessayez.')
      setLogs(data || [])
    } catch {
      // le journal reste vide ou tel quel : information secondaire
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) fetchLogs() }, [open, shopId, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const filteredLogs = search.trim()
    ? logs.filter((log: any) => {
        const meta = log.metadata || {}
        const names = [meta.product_name, ...((meta.products_snapshot || []) as any[]).map(p => p.name)].filter(Boolean)
        return names.some(n => normalize(n).includes(normalize(search)))
      })
    : logs

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('products.activity_journal')}
      description={t('products.activity_journal_hint')}
      icon={<History className="h-4 w-4" />}
      width="lg"
      testId="journal-drawer"
    >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('products.search_placeholder')} className="h-9 pl-8 text-sm" />
            </div>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="h-9 w-[140px] text-sm" />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="h-9 w-[140px] text-sm" />
            {(dateFrom || dateTo || search) && (
              <button className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => { setDateFrom(''); setDateTo(''); setSearch('') }}>
                {t('products.reset_filters')}
              </button>
            )}
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('team.journal_loading')}</p>
          ) : filteredLogs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('team.journal_empty')}</p>
          ) : (
            <div className="space-y-1.5">
              {filteredLogs.map((log: any) => {
                const meta = log.metadata || {}
                const actor = meta.actor_name || log.actor_email || '—'
                const when = new Date(log.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                let label = ''
                let detail = ''
                let Icon = Trash2
                let iconColor = 'text-red-400'
                if (log.action === 'delete_product') {
                  label = t('products.journal_deleted')
                  detail = meta.product_name || log.target_id || '—'
                } else if (log.action === 'bulk_delete_products') {
                  label = t('products.journal_bulk_delete')
                  const names = (meta.products_snapshot || []).map((p: any) => p.name).join(', ')
                  detail = t('products.journal_bulk_delete_detail', { count: meta.count, names: names ? ` · ${names}` : '' })
                } else if (log.action === 'create_product') {
                  Icon = Plus
                  iconColor = 'text-green-500'
                  label = meta.product_name || t('products.journal_created')
                  detail = t('products.journal_created_detail', { price: formatNaira(meta.selling_price), qty: meta.quantity })
                } else if (log.action === 'update_product') {
                  Icon = Edit2
                  iconColor = 'text-blue-400'
                  label = meta.product_name || t('products.journal_updated')
                  const changes = meta.changes || {}
                  const parts: string[] = []
                  if (changes.name) parts.push(`${t('products.journal_field_name')}: "${changes.name.from}" → "${changes.name.to}"`)
                  if (changes.selling_price) parts.push(`${t('products.journal_field_selling_price')}: ${changes.selling_price.from} → ${changes.selling_price.to} ${currencySymbol}`)
                  if (changes.buying_price) parts.push(`${t('products.journal_field_buying_price')}: ${changes.buying_price.from} → ${changes.buying_price.to} ${currencySymbol}`)
                  if (changes.low_stock_threshold) parts.push(`${t('products.journal_field_threshold')}: ${changes.low_stock_threshold.from ?? '—'} → ${changes.low_stock_threshold.to ?? '—'}`)
                  if (changes.sku) parts.push(`${t('products.journal_field_sku')}: ${changes.sku.from || '—'} → ${changes.sku.to || '—'}`)
                  if (changes.category_id) parts.push(`${t('products.journal_field_category')}: ${changes.category_id.from || '—'} → ${changes.category_id.to || '—'}`)
                  if (changes.supplier_id) parts.push(`${t('products.journal_field_supplier')}: ${changes.supplier_id.from || '—'} → ${changes.supplier_id.to || '—'}`)
                  if (changes.promo_price) parts.push(`${t('products.journal_field_promo_price')}: ${changes.promo_price.from ? formatNaira(changes.promo_price.from) : '—'} → ${changes.promo_price.to ? formatNaira(changes.promo_price.to) : '—'}`)
                  if (changes.promo_until) parts.push(`${t('products.journal_field_promo_until')}: ${changes.promo_until.from ? new Date(changes.promo_until.from).toLocaleDateString('fr-FR') : '—'} → ${changes.promo_until.to ? new Date(changes.promo_until.to).toLocaleDateString('fr-FR') : '—'}`)
                  detail = parts.join(' · ')
                } else if (log.action === 'archive_product') {
                  Icon = Archive
                  iconColor = 'text-amber-500'
                  label = t('products.journal_archived')
                  detail = meta.product_name || log.target_id || '—'
                } else if (log.action === 'restore_product') {
                  Icon = RotateCcw
                  iconColor = 'text-green-500'
                  label = t('products.journal_restored')
                  detail = meta.product_name || log.target_id || '—'
                } else if (log.action === 'update_batch_promo') {
                  Icon = Tag
                  iconColor = 'text-purple-500'
                  label = meta.product_name || t('products.journal_batch_promo_updated')
                  detail = meta.new_price
                    ? t('products.journal_batch_promo_detail_set', { price: formatNaira(meta.new_price), date: meta.new_until ? new Date(meta.new_until).toLocaleDateString('fr-FR') : '—' })
                    : t('products.journal_batch_promo_detail_cleared')
                } else if (log.action === 'bulk_update_promo') {
                  Icon = Tag
                  iconColor = 'text-purple-500'
                  label = t('products.journal_bulk_promo_updated')
                  detail = t('products.journal_bulk_promo_detail', { count: meta.count, percent: meta.percent ?? 0 })
                } else {
                  label = t('products.all_deleted_toast')
                  detail = t('products.journal_all_deleted_detail', { count: meta.count })
                }

                // « Ventes pendant la promo » : seulement pour une entrée qui
                // active concrètement une promo sur UN produit précis.
                let promoQuery: { productId: string; from: string; until: string } | null = null
                if (log.action === 'update_product' && meta.changes?.promo_price?.to && meta.changes?.promo_until?.to) {
                  promoQuery = { productId: log.target_id, from: log.created_at, until: meta.changes.promo_until.to }
                } else if (log.action === 'update_batch_promo' && meta.new_price && meta.new_until && meta.product_id) {
                  promoQuery = { productId: meta.product_id, from: log.created_at, until: meta.new_until }
                }
                const sales = promoSales[log.id]

                return (
                  <div key={log.id} className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm">
                    <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground/90">{label}</p>
                      <p className="truncate text-xs text-muted-foreground">{detail}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground/70">{actor} · {when}</p>
                      {promoQuery && (
                        sales ? (
                          <p className="mt-1 text-xs font-medium text-purple-600 dark:text-purple-400">
                            {sales.loading
                              ? t('products.journal_promo_sales_loading')
                              : sales.qty !== null
                                ? t('products.journal_promo_sales_result', { count: sales.qty })
                                : t('products.journal_promo_sales_error')}
                          </p>
                        ) : (
                          <button
                            className="mt-1 text-xs text-purple-600 hover:underline dark:text-purple-400"
                            onClick={() => promoQuery && fetchPromoSales(log.id, promoQuery.productId, promoQuery.from, promoQuery.until)}
                          >
                            {t('products.journal_promo_sales_button')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
    </DetailDrawer>
  )
}
