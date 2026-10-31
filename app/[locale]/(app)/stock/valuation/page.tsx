'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Coins, Layers, Tag, TrendingUp, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useShopScope } from '@/lib/shops/use-shop-scope'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils/cn'

// Stock › Valorisation (étape 7, 31 oct. 2026) : la valeur du stock au prix d'achat, au coût moyen et en FIFO (chaque
// lot à son prix), la valeur de vente, les produits sans prix d'achat, la répartition par catégorie et les produits
// qui pèsent le plus. Réservé à qui voit le prix d'achat (le serveur vérifie, boutique par boutique). Lecture seule.

interface Block {
  currency: string
  average: number; fifo: number; selling: number; potential_margin: number
  quantity: number; products: number; unknown_cost: number
  categories: { id: string | null; name: string | null; color: string | null; quantity: number; average: number }[]
  top: { id: string; name: string; quantity: number; average: number; fifo: number }[]
  unknown: { id: string; name: string; quantity: number }[]
  mismatch: { id: string; name: string; quantity: number; average: number; fifo: number }[]
  mismatch_count: number
}

function Card({ icon: Icon, label, value, hint, tone = 'neutral', testId }: { icon: any; label: string; value: string; hint?: string; tone?: 'neutral' | 'blue' | 'green'; testId?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-sm', tone === 'blue' && 'border-stockshop-blue/30 bg-stockshop-blue-muted/60 dark:bg-blue-950/30')} data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className={cn('h-4 w-4 shrink-0', tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-stockshop-blue dark:text-blue-400')} />
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground" data-value>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default function StockValuationPage() {
  const t = useTranslations('valuation')
  const tNav = useTranslations('nav')
  const tPage = useTranslations('page_header')
  const { canAccess, canViewCost } = useRolePermissions()
  const scope = useShopScope()
  const scopeKey = scope.shopIds.join(',')
  const [data, setData] = useState<Block[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!scopeKey || !canViewCost) return
    let cancelled = false
    setData(null); setError(false)
    fetch(`/api/stock/valuation?shop_ids=${encodeURIComponent(scopeKey)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (!cancelled) setData(j.by_currency || []) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [scopeKey, canViewCost])

  if (!canAccess('stock') || !canViewCost) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center" data-testid="valuation-no-access">
        <Wallet className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">{canAccess('stock') ? t('cost_only') : tNav('no_access')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={tNav('valuation')} description={tPage('stock_valuation')} />
      {error ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{t('load_error')}</p>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : data.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="valuation-empty">{t('empty')}</p>
      ) : data.map(b => {
        const fmt = (n: number) => formatCurrency(n, b.currency)
        const gap = b.fifo - b.average
        return (
          <section key={b.currency} className="space-y-4" data-testid="valuation-block" data-currency={b.currency}>
            {data.length > 1 && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('currency_title', { currency: b.currency })}</h2>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card icon={Wallet} tone="blue" label={t('average_label')} value={fmt(b.average)} hint={t('average_hint')} testId="valuation-average" />
              <Card icon={Layers} label={t('fifo_label')} value={fmt(b.fifo)}
                hint={Math.abs(gap) < 1 ? t('fifo_same') : t(gap > 0 ? 'fifo_more' : 'fifo_less', { amount: fmt(Math.abs(gap)) })} testId="valuation-fifo" />
              <Card icon={Tag} label={t('selling_label')} value={fmt(b.selling)} hint={t('selling_hint', { count: b.products })} testId="valuation-selling" />
              <Card icon={TrendingUp} tone="green" label={t('margin_label')} value={fmt(b.potential_margin)} hint={t('margin_hint')} testId="valuation-margin" />
            </div>

            {b.unknown_cost > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="valuation-unknown">
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />{t('unknown_title', { count: b.unknown_cost })}</p>
                <p className="mt-1 text-xs">{t('unknown_hint')}</p>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {b.unknown.slice(0, 8).map(u => <li key={u.id} className="flex justify-between gap-3"><span className="truncate">{u.name}</span><span className="tabular-nums">{u.quantity}</span></li>)}
                </ul>
              </div>
            )}

            {b.mismatch_count > 0 && (
              <div className="rounded-xl border bg-card p-4 text-sm shadow-sm" data-testid="valuation-mismatch">
                <p className="flex items-center gap-2 font-semibold"><Layers className="h-4 w-4 shrink-0 text-stockshop-blue dark:text-blue-400" />{t('mismatch_title', { count: b.mismatch_count })}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('mismatch_hint')}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {b.mismatch.slice(0, 8).map(m => (
                    <li key={m.id} className="flex flex-wrap justify-between gap-x-3"><span className="truncate font-medium">{m.name}</span><span className="tabular-nums text-muted-foreground">{t('mismatch_values', { average: fmt(m.average), fifo: fmt(m.fifo) })}</span></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="valuation-categories">
                <h3 className="mb-3 text-sm font-semibold">{t('categories_title')}</h3>
                <ul className="space-y-2">
                  {b.categories.map(c => {
                    const share = b.average > 0 ? Math.round((c.average / b.average) * 100) : 0
                    return (
                      <li key={c.id ?? 'none'} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color || '#94a3b8' }} /><span className="truncate">{c.name ?? t('no_category')}</span></span>
                          <span className="shrink-0 tabular-nums font-medium">{fmt(c.average)} <span className="text-xs text-muted-foreground">· {share} %</span></span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-stockshop-blue dark:bg-blue-500" style={{ width: `${Math.max(share, 1)}%` }} /></div>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="valuation-top">
                <h3 className="mb-3 text-sm font-semibold">{t('top_title')}</h3>
                <ol className="space-y-2">
                  {b.top.map((p, i) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-baseline gap-2"><span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span><span className="truncate">{p.name}</span></span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums font-medium">{fmt(p.average)}</span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">{t('top_quantity', { count: p.quantity })}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <Coins className="mt-0.5 h-4 w-4 shrink-0" />{t('method_note')}
            </p>
          </section>
        )
      })}
    </div>
  )
}
