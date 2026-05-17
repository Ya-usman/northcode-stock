export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'
import { formatCurrency, formatAdminRevenue } from '@/lib/utils/currency'
import { CountryFilter } from '@/components/admin/country-filter'
import { PaymentsControls } from '@/components/admin/payments-controls'
import { CsvExportBtn } from '@/components/admin/csv-export-btn'
import { COUNTRIES } from '@/lib/saas/countries'
import { Suspense } from 'react'

const PLAN_COLORS: Record<string, string> = {
  starter: 'text-blue-400 bg-blue-400/10',
  pro: 'text-purple-400 bg-purple-400/10',
  business: 'text-amber-400 bg-amber-400/10',
}

const PAGE_SIZE = 25

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: { country?: string; search?: string; page?: string }
}) {
  const supabase = createAdminClient()

  const countryFilter = searchParams.country || 'all'
  const search = (searchParams.search || '').trim().toLowerCase()
  const page = Math.max(1, Number(searchParams.page || '1'))

  // Load all shops (small dataset — max a few thousand)
  const { data: allShops } = await supabase.from('shops').select('id, name, city, country, currency')
  const shops = (allShops || []) as any[]
  const shopMap: Record<string, any> = {}
  for (const s of shops) shopMap[s.id] = s

  const availableCountries = Array.from(new Set(shops.map((s: any) => s.country || 'NG').filter(Boolean))).sort() as string[]

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

  // Early exit if filter yields no shops
  if (filteredShopIds !== null && filteredShopIds.length === 0) {
    return (
      <div className="space-y-5 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Paiements</h1>
            <p className="text-muted-foreground text-sm mt-1">0 paiement(s)</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CsvExportBtn href="/api/admin/export/payments" />
            <Suspense><CountryFilter current={countryFilter} availableCountries={availableCountries} /></Suspense>
          </div>
        </div>
        <p className="text-center text-muted-foreground py-16 text-sm">
          Aucune boutique correspondant à cette recherche.
        </p>
      </div>
    )
  }

  // Count total matching payments
  let countQuery: any = supabase.from('subscriptions').select('id', { count: 'exact', head: true })
  if (filteredShopIds !== null) countQuery = countQuery.in('shop_id', filteredShopIds)
  const { count: totalCount } = await countQuery

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Fetch paginated payments
  let dataQuery: any = supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).range(from, to)
  if (filteredShopIds !== null) dataQuery = dataQuery.in('shop_id', filteredShopIds)
  const { data: payments } = await dataQuery

  // Revenue summary (all matching, not just this page)
  let summaryQuery: any = supabase.from('subscriptions').select('shop_id, amount')
  if (filteredShopIds !== null) summaryQuery = summaryQuery.in('shop_id', filteredShopIds)
  const { data: allMatchingPayments } = await summaryQuery

  let totalNGN = 0, totalCFA = 0
  for (const p of allMatchingPayments || []) {
    const currency = shopMap[p.shop_id]?.currency || '₦'
    if (currency.includes('CFA') || currency === 'FCFA') totalCFA += Number(p.amount)
    else totalNGN += Number(p.amount)
  }

  const exportUrl = `/api/admin/export/payments${countryFilter !== 'all' ? `?country=${countryFilter}` : ''}`

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Paiements</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalCount ?? 0} paiement(s) ·{' '}
            {countryFilter === 'all' ? 'tous pays' : (COUNTRIES[countryFilter as keyof typeof COUNTRIES]?.name || countryFilter)}
            {search && <span className="ml-1">· "{search}"</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CsvExportBtn href={exportUrl} />
          <Suspense><CountryFilter current={countryFilter} availableCountries={availableCountries} /></Suspense>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 col-span-2 md:col-span-1">
          <p className="text-muted-foreground text-xs mb-1">Revenus collectés</p>
          <p className="text-xl font-bold text-green-400">{formatAdminRevenue(totalNGN, totalCFA)}</p>
          {totalNGN > 0 && totalCFA > 0 && <p className="text-xs text-muted-foreground mt-1">🇳🇬 ₦ + 🇨🇲 FCFA</p>}
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-muted-foreground text-xs mb-1">Paiements</p>
          <p className="text-2xl font-bold text-foreground">{totalCount ?? 0}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-muted-foreground text-xs mb-1">Boutiques distinctes</p>
          <p className="text-2xl font-bold text-foreground">
            {new Set((allMatchingPayments || []).map((p: any) => p.shop_id)).size}
          </p>
        </div>
      </div>

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
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Montant</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Statut</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Référence</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Date</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Expiration</th>
              </tr>
            </thead>
            <tbody>
              {(payments || []).length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-sm">Aucun paiement</td></tr>
              )}
              {(payments || []).map((p: any) => {
                const shop = shopMap[p.shop_id]
                const planLabel = PLANS[p.plan as keyof typeof PLANS]?.name || p.plan
                const colorClass = PLAN_COLORS[p.plan] || 'text-muted-foreground bg-muted'
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
