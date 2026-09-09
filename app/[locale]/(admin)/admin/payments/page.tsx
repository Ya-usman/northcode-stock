export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { PLANS, hasActiveSubscription } from '@/lib/saas/plans'
import { formatCurrency, formatAdminRevenue } from '@/lib/utils/currency'
import { CountryFilter } from '@/components/admin/country-filter'
import { GatewayFilter, GATEWAY_LABELS } from '@/components/admin/gateway-filter'
import { PaymentsControls } from '@/components/admin/payments-controls'
import { CsvExportBtn } from '@/components/admin/csv-export-btn'
import { COUNTRIES } from '@/lib/saas/countries'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { KpiTile } from '@/components/admin/ui/kpi-tile'
import { Wallet, Users, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react'
import { Suspense } from 'react'

const PLAN_COLORS: Record<string, string> = {
  starter: 'text-blue-400 bg-blue-400/10',
  pro: 'text-purple-400 bg-purple-400/10',
  business: 'text-amber-400 bg-amber-400/10',
}

const PAGE_SIZE = 25

export default async function AdminPaymentsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { country?: string; search?: string; page?: string; gateway?: string }
}) {
  const supabase = createAdminClient()

  const countryFilter = searchParams.country || 'all'
  const gatewayFilter = searchParams.gateway || 'all'
  const search = (searchParams.search || '').trim().toLowerCase()
  const page = Math.max(1, Number(searchParams.page || '1'))

  // Load all shops (small dataset — max a few thousand)
  const { data: allShops } = await supabase.from('shops').select('id, name, city, country, currency, owner_id')
  const shops = (allShops || []) as any[]
  const shopMap: Record<string, any> = {}
  for (const s of shops) shopMap[s.id] = s

  const availableCountries = Array.from(new Set(shops.map((s: any) => s.country || 'NG').filter(Boolean))).sort() as string[]

  // Facturation au niveau propriétaire (voir lib/saas/resolve-owner-plan.ts)
  // — "abonnements actifs" compte des propriétaires distincts, pas des
  // lignes subscriptions ni des boutiques.
  const { data: ownerProfiles } = await supabase.from('profiles').select('id, plan, plan_expires_at').eq('role', 'owner')
  const activeOwners = (ownerProfiles || []).filter((o: any) => hasActiveSubscription(o.plan, o.plan_expires_at)).length

  // Determine which shop IDs to include based on filters
  let filteredShopIds: string[] | null = null
  if (countryFilter !== 'all' || search) {
    let matched = shops as any[]
    if (countryFilter !== 'all') {
      matched = matched.filter((s: any) => (s.country || 'NG') === countryFilter)
    }
    if (search) {
      matched = matched.filter((s: any) =>
        s.name?.toLowerCase().includes(search) || s.city?.toLowerCase().includes(search)
      )
    }
    filteredShopIds = matched.map((s: any) => s.id)
  }

  const applyFilters = (q: any) => {
    if (filteredShopIds !== null) q = q.in('shop_id', filteredShopIds)
    // 'legacy' = lignes d'avant la colonne `gateway` (migration 071) — NULL
    // en base, donc .is() et pas .eq() (PostgREST : eq.null ne matche rien).
    if (gatewayFilter !== 'all') q = gatewayFilter === 'legacy' ? q.is('gateway', null) : q.eq('gateway', gatewayFilter)
    return q
  }

  // Early exit if filter yields no shops
  if (filteredShopIds !== null && filteredShopIds.length === 0) {
    return (
      <div className="space-y-5 max-w-6xl">
        <AdminPageHeader title="Facturation" description="0 paiement(s)" actions={<CsvExportBtn href="/api/admin/export/payments" />} />
        <p className="text-center text-muted-foreground py-16 text-sm">
          Aucune boutique correspondant à cette recherche.
        </p>
      </div>
    )
  }

  // Count total matching payments
  const { count: totalCount } = await applyFilters(supabase.from('subscriptions').select('id', { count: 'exact', head: true }))

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Fetch paginated payments
  const { data: payments } = await applyFilters(supabase.from('subscriptions').select('*').order('created_at', { ascending: false })).range(from, to)

  // Full matching set (not just this page) — revenus, répartition fournisseurs, renouvellements à risque
  const { data: allMatching } = await applyFilters(
    supabase.from('subscriptions').select('shop_id, amount, gateway, status, auto_renew, renewal_failures, plan, expires_at')
  )
  const matchingRows = (allMatching || []) as any[]

  let totalNGN = 0, totalCFA = 0
  for (const p of matchingRows) {
    const currency = shopMap[p.shop_id]?.currency || '₦'
    if (currency.includes('CFA') || currency === 'FCFA') totalCFA += Number(p.amount)
    else totalNGN += Number(p.amount)
  }

  // Renouvellement — calculé sur les abonnements actuellement actifs
  // (une ligne 'active' par boutique, écrite/mise à jour par le cron
  // app/api/cron/renewal-check).
  const activeSubs = matchingRows.filter(p => p.status === 'active')
  const autoRenewOn = activeSubs.filter(p => p.auto_renew).length
  const atRisk = activeSubs.filter(p => (p.renewal_failures || 0) > 0)

  // Répartition par fournisseur
  const gatewayStats: Record<string, { count: number; ngn: number; cfa: number }> = {}
  for (const p of matchingRows) {
    const key = p.gateway || 'legacy'
    if (!gatewayStats[key]) gatewayStats[key] = { count: 0, ngn: 0, cfa: 0 }
    gatewayStats[key].count++
    const currency = shopMap[p.shop_id]?.currency || '₦'
    if (currency.includes('CFA') || currency === 'FCFA') gatewayStats[key].cfa += Number(p.amount)
    else gatewayStats[key].ngn += Number(p.amount)
  }
  const gatewayRows = Object.entries(gatewayStats).sort((a, b) => b[1].count - a[1].count)

  const exportUrl = `/api/admin/export/payments${countryFilter !== 'all' ? `?country=${countryFilter}` : ''}`

  return (
    <div className="space-y-5 max-w-6xl">
      <AdminPageHeader
        title="Facturation"
        description={
          `${totalCount ?? 0} paiement(s) ·${' '}` +
          (countryFilter === 'all' ? 'tous pays' : (COUNTRIES[countryFilter as keyof typeof COUNTRIES]?.name || countryFilter)) +
          (search ? ` · "${search}"` : '')
        }
        actions={
          <>
            <CsvExportBtn href={exportUrl} />
            <Suspense><CountryFilter current={countryFilter} availableCountries={availableCountries} /></Suspense>
            <Suspense><GatewayFilter current={gatewayFilter} /></Suspense>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Revenus collectés" value={formatAdminRevenue(totalNGN, totalCFA)} icon={Wallet} tone="success" />
        <KpiTile label="Abonnements payants actifs" value={activeOwners} icon={Users} tone="default" />
        <KpiTile label="Renouvellement auto activé" value={`${autoRenewOn}/${activeSubs.length || 0}`} icon={RefreshCw} tone="default" />
        <KpiTile
          label="Échecs de renouvellement"
          value={atRisk.length}
          icon={AlertTriangle}
          tone={atRisk.length > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* Répartition par fournisseur */}
      {gatewayRows.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Répartition par fournisseur</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gatewayRows.map(([key, stats]) => {
              const label = GATEWAY_LABELS[key] || { name: key, color: 'text-muted-foreground bg-muted' }
              const share = (totalCount ?? 0) > 0 ? Math.round((stats.count / matchingRows.length) * 100) : 0
              return (
                <div key={key} className="flex items-center justify-between gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${label.color}`}>{label.name}</span>
                    <p className="text-xs text-muted-foreground mt-1">{stats.count} paiement(s) · {share}%</p>
                  </div>
                  <span className="text-sm font-bold text-green-400 flex-shrink-0">{formatAdminRevenue(stats.ngn, stats.cfa)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Renouvellements à risque */}
      {atRisk.length > 0 && (
        <div className="bg-card rounded-xl border border-red-500/30 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-red-500/10 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
            <h3 className="text-sm font-semibold text-foreground">Renouvellements à risque ({atRisk.length})</h3>
          </div>
          <div className="divide-y divide-border/50">
            {atRisk.map((p: any) => {
              const shop = shopMap[p.shop_id]
              const label = GATEWAY_LABELS[p.gateway || 'legacy'] || { name: p.gateway || '—', color: 'text-muted-foreground bg-muted' }
              return (
                <Link
                  key={p.shop_id}
                  href={`/${locale}/admin/shops/${p.shop_id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{shop?.name || '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(p.renewal_failures || 0)} échec(s) · <span className={`px-1.5 py-0.5 rounded ${label.color}`}>{label.name}</span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Search + top pagination */}
      <Suspense>
        <PaymentsControls
          search={searchParams.search || ''}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount ?? 0}
          pageSize={PAGE_SIZE}
        />
      </Suspense>

      {/* Mobile cards */}
      <div className="md:hidden bg-card rounded-xl border border-border shadow-sm divide-y divide-border/50">
        {(payments || []).length === 0 && (
          <p className="px-5 py-10 text-center text-muted-foreground text-sm">Aucun paiement</p>
        )}
        {(payments || []).map((p: any) => {
          const shop = shopMap[p.shop_id]
          const planLabel = PLANS[p.plan as keyof typeof PLANS]?.name || p.plan
          const colorClass = PLAN_COLORS[p.plan] || 'text-muted-foreground bg-muted'
          const gwLabel = GATEWAY_LABELS[p.gateway || 'legacy'] || { name: p.gateway || '—', color: 'text-muted-foreground bg-muted' }
          const isExpired = p.expires_at && new Date(p.expires_at) < new Date()
          const currency = shop?.currency || '₦'
          const countryConfig = shop?.country ? COUNTRIES[shop.country as keyof typeof COUNTRIES] : null
          const flag = countryConfig?.flag || '🌐'
          return (
            <div key={p.id} className="px-4 py-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{shop?.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{flag} {shop?.city || '—'}</p>
                </div>
                <span className="font-bold text-green-400 text-sm flex-shrink-0">{formatCurrency(p.amount, currency)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colorClass}`}>{planLabel}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${gwLabel.color}`}>{gwLabel.name}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.status === 'active' ? 'text-green-400 bg-green-400/10' : 'text-muted-foreground bg-muted'}`}>{p.status}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {p.expires_at && <span className={isExpired ? 'text-red-400' : ''}>Exp. {new Date(p.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                {p.paystack_reference && <span className="font-mono truncate max-w-[160px]">{p.paystack_reference}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Boutique</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Plan</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Fournisseur</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Montant</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Statut</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Référence</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Date</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Expiration</th>
              </tr>
            </thead>
            <tbody>
              {(payments || []).length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground text-sm">Aucun paiement</td></tr>
              )}
              {(payments || []).map((p: any) => {
                const shop = shopMap[p.shop_id]
                const planLabel = PLANS[p.plan as keyof typeof PLANS]?.name || p.plan
                const colorClass = PLAN_COLORS[p.plan] || 'text-muted-foreground bg-muted'
                const gwLabel = GATEWAY_LABELS[p.gateway || 'legacy'] || { name: p.gateway || '—', color: 'text-muted-foreground bg-muted' }
                const isExpired = p.expires_at && new Date(p.expires_at) < new Date()
                const currency = shop?.currency || '₦'
                const countryConfig = shop?.country ? COUNTRIES[shop.country as keyof typeof COUNTRIES] : null
                const flag = countryConfig?.flag || '🌐'
                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">{shop?.name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{flag} {shop?.city}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colorClass}`}>{planLabel}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${gwLabel.color}`}>{gwLabel.name}</span>
                    </td>
                    <td className="px-5 py-3 font-bold text-green-400">{formatCurrency(p.amount, currency)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.status === 'active' ? 'text-green-400 bg-green-400/10' : 'text-muted-foreground bg-muted'}`}>{p.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px] block">{p.paystack_reference || '—'}</span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">
                      {new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      {p.expires_at
                        ? <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-foreground'}`}>{new Date(p.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <Suspense>
          <PaymentsControls
            search={searchParams.search || ''}
            page={page}
            totalPages={totalPages}
            totalCount={totalCount ?? 0}
            pageSize={PAGE_SIZE}
          />
        </Suspense>
      )}
    </div>
  )
}
