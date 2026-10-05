'use client'

// BOUTIQUES — centre de gestion des établissements (refonte du 5 oct. 2026).
// Vue d'ensemble consolidée (plusieurs boutiques seulement) + liste :
// Boutique · Ville · Responsable · Membres · Encaissé aujourd'hui · Alertes
// stock · Statut. Un clic ouvre la fiche (page dédiée /shops/[shopId]).
// Compte mono-boutique : accès direct à la fiche, sans vue de comparaison.
// Accès : Propriétaire (toutes ses boutiques), Manager et Responsable (leurs
// boutiques seulement). Création réservée au propriétaire.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Plus, Store, ChevronRight, CheckCircle2, CreditCard, AlertTriangle, Users, Wallet, ShoppingCart, Package, Clock } from 'lucide-react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ShopLogo } from '@/components/shop/shop-logo'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import { resolveCurrencyCode } from '@/lib/saas/currencies'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { isTeamManager, isAccountOwner } from '@/lib/team/roles'
import { useTeamPeople } from '@/lib/team/use-team-people'
import { useTeamQuota } from '@/lib/team/use-team-quota'
import { useShopStats, useShopStatus } from '@/lib/shops/shop-insights'
import { ShopFormDrawer } from '@/components/shops/shop-form-drawer'
import type { Shop } from '@/lib/types/database'

export default function ShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations()
  const router = useRouter()
  const { userShops, activeShop, roleByShop, loading: authLoading } = useAuthContext()
  const { isOnline } = useOffline()

  const shops = useMemo(() => userShops.filter(s => isTeamManager(roleByShop[s.id])), [userShops, roleByShop])
  const ids = useMemo(() => shops.map(s => s.id), [shops])
  const isOwner = shops.some(s => isAccountOwner(roleByShop[s.id]))
  const multi = shops.length > 1
  const contextShopId = ids.includes(activeShop?.id ?? '') ? activeShop!.id : ids[0] ?? null

  const { stats, loaded, refresh: refreshStats } = useShopStats(shops)
  const { people, refresh: refreshPeople } = useTeamPeople(ids, null)
  const quota = useTeamQuota(isOwner ? contextShopId : null)
  const { planLabel, subscriptionOf, statusOf, toneClass } = useShopStatus()
  const [createOpen, setCreateOpen] = useState(false)

  const refreshAll = () => { refreshStats(); refreshPeople(); quota.refresh() }
  useRefetchOnVisible(refreshAll)
  useRefetchOnReconnect(refreshAll, isOnline)

  const open = (id: string) => {
    const href = `/${locale}/shops/${id}`
    startNavigationProgress(href)
    router.push(href)
  }

  // Mono-boutique : directement la fiche (rien à comparer)
  useEffect(() => {
    if (!authLoading && shops.length === 1) router.replace(`/${locale}/shops/${shops[0].id}`)
  }, [authLoading, shops.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Équipe par boutique (déduite des rôles existants) : responsables et membres actifs
  const teamOf = (shopId: string) => {
    const inShop = people.filter(p => p.accountActive && p.memberships.some(m => m.shop_id === shopId && m.role !== 'owner'))
    const leads = people.filter(p => p.accountActive && p.memberships.some(m => m.shop_id === shopId && m.role === 'manager'))
    return { members: inShop.length, leads }
  }
  const leadsText = (shopId: string) => {
    const { leads } = teamOf(shopId)
    if (!leads.length) return '—'
    if (leads.length <= 2) return leads.map(p => p.full_name).join(', ')
    return t('shops.leads_count', { count: leads.length })
  }

  const codeOf = (s: Shop) => resolveCurrencyCode(s.currency, s.country)
  /** Somme par devise (boutiques de pays différents) : « 1 200 F CFA · ₦50 000 » */
  const sumByCurrency = (pick: (id: string) => number) => {
    const by: Record<string, number> = {}
    for (const s of shops) by[codeOf(s)] = (by[codeOf(s)] || 0) + pick(s.id)
    return Object.entries(by).map(([code, n]) => formatCurrency(n, code)).join(' · ')
  }
  const sub = shops[0] ? subscriptionOf(shops[0]) : null // formule = niveau compte
  const totals = useMemo(() => ({
    salesCount: shops.reduce((a, s) => a + (stats[s.id]?.salesTodayCount || 0), 0),
    out: shops.reduce((a, s) => a + (stats[s.id]?.out || 0), 0),
    low: shops.reduce((a, s) => a + (stats[s.id]?.low || 0), 0),
    open: shops.filter(s => s.hours_enabled && statusOf(s).tone === 'ok').length,
    withHours: shops.filter(s => s.hours_enabled).length,
  }), [shops, stats]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = (Icon: typeof Store, label: string, value: React.ReactNode, hint?: React.ReactNode, tone?: string) => (
    <div className="rounded-xl border bg-card p-3.5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className={cn('mt-1 truncate text-lg font-bold tabular-nums', tone)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )

  const alertCell = (id: string) => {
    const st = stats[id]
    if (!st) return <span className="text-muted-foreground">—</span>
    if (!st.out && !st.low) return <span className="text-muted-foreground">0</span>
    return (
      <span className="inline-flex flex-wrap gap-x-2 text-xs">
        {st.out > 0 && <span className="font-medium text-red-600 dark:text-red-400">{t('shops.out_count', { count: st.out })}</span>}
        {st.low > 0 && <span className="font-medium text-amber-600 dark:text-amber-400">{t('shops.low_count', { count: st.low })}</span>}
      </span>
    )
  }
  const statusCell = (s: Shop) => {
    const st = statusOf(s)
    return (
      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        st.tone === 'bad' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : st.tone === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' : 'bg-muted text-muted-foreground')}>
        {s.hours_enabled && st.tone !== 'bad' && <Clock className="h-3 w-3" />}{st.text}
      </span>
    )
  }

  if (!authLoading && shops.length === 1) {
    return <div className="mx-auto max-w-5xl space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5 shadow-sm">
        <div className="min-w-0">
          {/* Entreprise propriétaire des établissements (migration 153) */}
          {shops[0]?.entity_name && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="shops-entity-name">{t('entity.label')} · {shops[0].entity_name}</p>
          )}
          <h1 className="text-lg font-bold">{t('shops.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('shops.count', { count: shops.length })}
            {isOwner && sub && <span className={cn('ml-1', toneClass[sub.tone])}>· {sub.text}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwner && (
            <Button variant="outline" className="gap-2" onClick={() => { startNavigationProgress(`/${locale}/billing`); router.push(`/${locale}/billing`) }}>
              <CreditCard className="h-4 w-4" />{t('shops.sub_manage')}
            </Button>
          )}
          {isOwner && (
            <Button variant="stockshop" className="gap-2" onClick={() => setCreateOpen(true)} data-testid="shop-create">
              <Plus className="h-4 w-4" />{t('shops.new')}
            </Button>
          )}
        </div>
      </div>

      {/* Vue d'ensemble consolidée — seulement s'il y a plusieurs boutiques à comparer */}
      {multi && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="shops-overview">
          {kpi(Store, t('shops.kpi_shops'), shops.length, totals.withHours ? t('shops.open_count', { count: totals.open }) : undefined)}
          {kpi(Wallet, t('shops.kpi_cash_today'), loaded ? sumByCurrency(id => stats[id]?.cashToday || 0) : '…')}
          {kpi(ShoppingCart, t('shops.kpi_sales_today'), loaded ? totals.salesCount : '…', loaded ? sumByCurrency(id => stats[id]?.salesToday || 0) : undefined)}
          {isOwner && kpi(Package, t('shops.kpi_stock_value'), loaded ? sumByCurrency(id => stats[id]?.stockValue || 0) : '…')}
          {kpi(Users, t('shops.kpi_team'), quota.data ? (quota.data.limit === -1 ? quota.data.used : `${quota.data.used} / ${quota.data.limit}`) : new Set(people.filter(p => p.accountActive && p.memberships.some(m => m.role !== 'owner')).map(p => p.user_id)).size, quota.data ? planLabel(quota.data.plan) : undefined)}
          {kpi(AlertTriangle, t('shops.kpi_alerts'), loaded ? totals.out + totals.low : '…', loaded ? `${t('shops.out_count', { count: totals.out })} · ${t('shops.low_count', { count: totals.low })}` : undefined, totals.out ? 'text-red-600 dark:text-red-400' : undefined)}
        </div>
      )}

      {shops.length === 0 && !authLoading ? (
        <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
          <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">{t('shops.no_shops')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('shops.no_shops_detail')}</p>
        </div>
      ) : (
        <>
          {/* Tableau (ordinateur) */}
          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm md:block">
            <table className="w-full text-sm" data-testid="shops-table">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">{t('shops.col_shop')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('shops.city')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('shops.col_lead')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('shops.members_label')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('shops.kpi_cash_today')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('shops.col_alerts')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('shops.col_status')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {shops.map(s => (
                  <tr key={s.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => open(s.id)} data-testid="shop-row"
                    tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(s.id) }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ShopLogo src={s.logo_url} name={s.name} size="sm" className="rounded-md" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            {s.name}
                            {s.id === activeShop?.id && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-stockshop-blue dark:text-blue-400" aria-label={t('shops.active')} />}
                          </p>
                          {s.code && <p className="font-mono text-[11px] text-muted-foreground">{s.code}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{s.city || '—'}</td>
                    <td className="max-w-[180px] truncate px-3 py-3">{leadsText(s.id)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{teamOf(s.id).members}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{stats[s.id] ? formatCurrency(stats[s.id].cashToday, codeOf(s)) : '—'}</td>
                    <td className="px-3 py-3">{alertCell(s.id)}</td>
                    <td className="px-3 py-3">{statusCell(s)}</td>
                    <td className="pr-3"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cartes (téléphone) */}
          <div className="space-y-3 md:hidden">
            {shops.map(s => (
              <button type="button" key={s.id} onClick={() => open(s.id)} data-testid="shop-card"
                className={cn('w-full space-y-3 rounded-xl border-2 bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/30', s.id === activeShop?.id ? 'border-stockshop-blue dark:border-blue-500' : 'border-border')}>
                <div className="flex items-center gap-3">
                  <ShopLogo src={s.logo_url} name={s.name} size="md" className="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}{s.code && <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">{s.code}</span>}</p>
                    <p className="truncate text-xs text-muted-foreground">{[s.city, leadsText(s.id) !== '—' ? leadsText(s.id) : null].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border bg-background px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">{t('shops.kpi_cash_today')}</p>
                    <p className="truncate text-sm font-bold tabular-nums">{stats[s.id] ? formatCurrency(stats[s.id].cashToday, codeOf(s)) : '—'}</p>
                  </div>
                  <div className="rounded-lg border bg-background px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">{t('shops.members_label')}</p>
                    <p className="text-sm font-bold tabular-nums">{teamOf(s.id).members}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">{statusCell(s)}{alertCell(s.id)}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <ShopFormDrawer open={createOpen} onOpenChange={setCreateOpen} onSaved={shop => open(shop.id)} />
    </div>
  )
}
