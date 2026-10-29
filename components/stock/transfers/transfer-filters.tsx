'use client'

// Filtres de Stock › Transferts : panneau « Filtrer » (statut, boutique de départ, boutique d'arrivée, période,
// produit, créé par) avec les listes à choix multiple communes (OU dans une dimension, ET entre dimensions), et
// pastilles des filtres actifs avec « Effacer les filtres ». Le panneau garde un brouillon jusqu'à « Appliquer ».
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { SlidersHorizontal, X } from 'lucide-react'
import { AppDrawer } from '@/components/ui/app-drawer'
import { Button } from '@/components/ui/button'
import { MultiSelectList } from '@/components/ui/multi-select-filter'
import { FOOTER_CANCEL_CLASS, FOOTER_PRIMARY_CLASS, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { collatorFor, toggleValue, type FilterGroup } from '@/lib/filters/multi-select'
import { activeFilterCount, EMPTY_TRANSFER_FILTERS, type TransferFilters, type TransferPeriod } from '@/lib/stock/transfers-view'
import type { TransferListRow } from './transfer-card'
import { cn } from '@/lib/utils/cn'

const PERIODS: TransferPeriod[] = ['all', 'today', '7d', '30d', 'month']
const STATUSES = ['draft', 'sent', 'received', 'cancelled'] as const
type ListKey = 'statuses' | 'sources' | 'destinations' | 'products' | 'creators'

/** Options de chaque dimension, tirées des transferts accessibles (identifiants réels, jamais fusionnés par libellé) */
export function useTransferFilterOptions(rows: TransferListRow[]) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  return useMemo(() => {
    const col = collatorFor(locale)
    const sorted = (m: Map<string, string>) => Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) => col.compare(a.label, b.label))
    const src = new Map<string, string>(), dst = new Map<string, string>(), prod = new Map<string, string>(), who = new Map<string, string>()
    for (const r of rows) {
      src.set(r.source_shop_id, r.source_shop_name || '')
      dst.set(r.destination_shop_id, r.destination_shop_name || '')
      if (r.created_by) who.set(r.created_by, r.created_by_name || '')
      for (const it of r.stock_transfer_items || []) if (it.source_product_id) prod.set(it.source_product_id, it.product_name)
    }
    const one = (options: { value: string; label: string }[]): FilterGroup[] => [{ id: 'all', options }]
    return {
      statuses: one(STATUSES.map(s => ({ value: s, label: t(`status_${s}` as any) }))),
      sources: one(sorted(src)),
      destinations: one(sorted(dst)),
      products: one(sorted(prod)),
      creators: one(sorted(who)),
    } as Record<ListKey, FilterGroup[]>
  }, [rows, locale, t])
}

export function TransferFiltersButton({ count, onClick }: { count: number; onClick: () => void }) {
  const t = useTranslations('transfers')
  return (
    <Button variant="outline" className="relative h-11 shrink-0 gap-2 px-3" onClick={onClick} aria-label={t('filter_button')} data-testid="transfers-filter">
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{t('filter_button')}</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-stockshop-blue px-1 text-[11px] font-bold text-white ring-2 ring-card dark:bg-blue-500" data-testid="transfers-filter-count">
          {count}
        </span>
      )}
    </Button>
  )
}

export function TransferFiltersDrawer({ open, onOpenChange, value, onApply, options }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: TransferFilters
  onApply: (next: TransferFilters) => void
  options: Record<ListKey, FilterGroup[]>
}) {
  const t = useTranslations('transfers')
  const [draft, setDraft] = useState<TransferFilters>(value)
  useEffect(() => { if (open) setDraft(value) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const section = (key: ListKey, label: string, allLabel: string, searchable = false) => (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      <MultiSelectList
        label={label} allLabel={allLabel} groups={options[key]} selected={draft[key]} large searchable={searchable}
        maxHeightClass="max-h-56"
        onToggle={v => setDraft(d => ({ ...d, [key]: toggleValue(d[key], v) }))}
        onClear={() => setDraft(d => ({ ...d, [key]: [] }))}
        testId={`transfers-filter-${key}`}
      />
    </section>
  )
  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('filters_title')}
      icon={<SlidersHorizontal className="h-4 w-4" />}
      width="sm"
      mobile="sheet"
      testId="transfers-filters-drawer"
      footer={() => (
        <div className={FOOTER_ROW_CLASS}>
          <Button variant="outline" className={FOOTER_CANCEL_CLASS} onClick={() => setDraft(EMPTY_TRANSFER_FILTERS)}>{t('reset_filters')}</Button>
          <Button variant="stockshop" className={FOOTER_PRIMARY_CLASS} onClick={() => { onApply(draft); onOpenChange(false) }} data-testid="transfers-filter-apply">{t('apply_filters')}</Button>
        </div>
      )}
    >
      <div className="space-y-5">
        {section('statuses', t('filter_status'), t('all_statuses'))}
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">{t('filter_period')}</h3>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('filter_period')}>
            {PERIODS.map(p => (
              <button key={p} type="button" role="radio" aria-checked={draft.period === p}
                onClick={() => setDraft(d => ({ ...d, period: p }))}
                className={cn('h-10 rounded-full border px-3.5 text-sm transition-colors',
                  draft.period === p ? 'border-stockshop-blue bg-stockshop-blue-muted text-stockshop-blue dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted')}>
                {t(`period_${p}` as any)}
              </button>
            ))}
          </div>
        </section>
        {section('sources', t('filter_source'), t('all_shops'))}
        {section('destinations', t('filter_destination'), t('all_shops'))}
        {section('products', t('filter_product'), t('all_products'), true)}
        {section('creators', t('filter_creator'), t('all_creators'))}
      </div>
    </AppDrawer>
  )
}

/** Pastilles des filtres actifs (une par dimension) + « Effacer les filtres » */
export function TransferFilterChips({ value, onChange, options }: {
  value: TransferFilters
  onChange: (next: TransferFilters) => void
  options: Record<ListKey, FilterGroup[]>
}) {
  const t = useTranslations('transfers')
  if (!activeFilterCount(value)) return null
  const labelOf = (key: ListKey) => {
    const opts = options[key].flatMap(g => g.options)
    const sel = value[key]
    const first = opts.find(o => o.value === sel[0])?.label ?? ''
    return sel.length > 1 ? `${first} +${sel.length - 1}` : first
  }
  const chips: { id: string; text: string; clear: () => void }[] = []
  for (const key of ['statuses', 'sources', 'destinations', 'products', 'creators'] as ListKey[]) {
    if (value[key].length) chips.push({ id: key, text: labelOf(key), clear: () => onChange({ ...value, [key]: [] }) })
    if (key === 'statuses' && value.period !== 'all') chips.push({ id: 'period', text: t(`period_${value.period}` as any), clear: () => onChange({ ...value, period: 'all' }) })
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="transfers-chips">
      {chips.map(c => (
        <span key={c.id} className="inline-flex h-9 items-center gap-1 rounded-full bg-stockshop-blue-muted pl-3 pr-1 text-sm font-medium text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">
          {c.text}
          <button type="button" onClick={c.clear} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/60 dark:hover:bg-white/10" aria-label={`${t('clear_filters')} : ${c.text}`}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onChange(EMPTY_TRANSFER_FILTERS)} className="ml-auto text-sm font-medium text-stockshop-blue hover:underline dark:text-blue-400" data-testid="transfers-clear-filters">
        {t('clear_filters')}
      </button>
    </div>
  )
}
