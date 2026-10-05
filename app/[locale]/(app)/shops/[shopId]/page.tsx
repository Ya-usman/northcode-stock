'use client'

// FICHE BOUTIQUE — page dédiée à sous-onglets (refonte du 5 oct. 2026).
// Phase 2 : Vue d'ensemble + Équipe. (Stock, Caisse, Horaires, Paramètres,
// Historique : phase 3.) Données réelles uniquement (lib/shops/shop-insights.ts).
// L'onglet Équipe n'a AUCUNE logique propre : mêmes données (useTeamPeople),
// même fiche (MemberSheet), mêmes fenêtres (AssignDialog, InviteDialog) que
// la page Équipe globale.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft, Store, Pencil, ArrowLeftRight, Trash2, Plus, Wallet, ShoppingCart, TrendingUp, Package, AlertTriangle, PackageX, Users,
  MapPin, Phone, Mail, Hash, Globe, Coins, CalendarDays, Clock, CreditCard, BarChart2, History, UserPlus, Store as StoreIcon, ChevronRight, LayoutGrid,
} from 'lucide-react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { ShopLogo } from '@/components/shop/shop-logo'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/currency'
import { resolveCurrencyCode, currencySymbol } from '@/lib/saas/currencies'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { withTimeout } from '@/lib/utils/with-timeout'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { isTeamManager, isAccountOwner, manageableRoles, ROLE_ORDER } from '@/lib/team/roles'
import { useTeamPeople, type TeamPerson } from '@/lib/team/use-team-people'
import { useShopStats, useShopStatus } from '@/lib/shops/shop-insights'
import { PersonAvatar, PresenceText, RoleBadge } from '@/components/team/team-ui'
import { MemberSheet } from '@/components/team/member-sheet'
import { AssignDialog } from '@/components/team/assign-dialog'
import { InviteDialog } from '@/components/team/invite-dialog'
import { ShopFormDrawer } from '@/components/shops/shop-form-drawer'
import type { UserRole } from '@/lib/types/database'

type Tab = 'overview' | 'team'

export default function ShopDetailPage({ params: { shopId } }: { params: { shopId: string } }) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { isOnline } = useOffline()
  const { userShops, activeShop, roleByShop, profile, switchShop, setDashboardShopFilter, refreshShop, loading: authLoading } = useAuthContext()

  const managedShops = useMemo(() => userShops.filter(s => isTeamManager(roleByShop[s.id])), [userShops, roleByShop])
  const managedIds = useMemo(() => managedShops.map(s => s.id), [managedShops])
  const shop = managedShops.find(s => s.id === shopId) ?? null
  const myRole = roleByShop[shopId]
  const isOwner = isAccountOwner(myRole)
  const ownerShopCount = userShops.filter(s => isAccountOwner(roleByShop[s.id])).length
  const multi = managedShops.length > 1

  const tab: Tab = searchParams.get('tab') === 'team' ? 'team' : 'overview'
  const setTab = (next: Tab) => router.replace(`/${locale}/shops/${shopId}${next === 'team' ? '?tab=team' : ''}`, { scroll: false })

  const shopList = useMemo(() => (shop ? [shop] : []), [shop])
  const { stats, loaded, refresh: refreshStats } = useShopStats(shopList)
  // Équipe : toutes les boutiques gérées (pour proposer l'affectation d'une personne d'une autre boutique)
  const { people, loading: peopleLoading, refresh: refreshPeople } = useTeamPeople(managedIds, shop ? shopId : null)
  const { planLabel, subscriptionOf, hoursOf, statusOf, toneClass } = useShopStatus()

  const refreshAll = () => { refreshStats(); refreshPeople() }
  useRefetchOnVisible(refreshAll)
  useRefetchOnReconnect(refreshAll, isOnline)

  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sheetUserId, setSheetUserId] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  if (authLoading) {
    return <div className="mx-auto max-w-5xl space-y-3"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-10 w-64 rounded-lg" /><Skeleton className="h-64 rounded-xl" /></div>
  }
  if (!shop) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center shadow-sm" data-testid="shop-not-found">
        <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium">{t('shops.not_found')}</p>
        <Link href={`/${locale}/shops`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-stockshop-blue hover:underline dark:text-blue-400"><ArrowLeft className="h-4 w-4" />{t('shops.title')}</Link>
      </div>
    )
  }

  const code = resolveCurrencyCode(shop.currency, shop.country)
  const fmt = (n: number) => formatCurrency(n, code)
  const st = stats[shopId]
  const status = statusOf(shop)
  const hours = hoursOf(shop)
  const sub = subscriptionOf(shop)
  const isActive = activeShop?.id === shopId

  // Équipe de CETTE boutique
  const inShop = (p: TeamPerson) => p.memberships.some(m => m.shop_id === shopId) || (!p.accountActive && p.suspendedMemberships.some(m => m.shop_id === shopId))
  const roleHere = (p: TeamPerson): UserRole => (p.memberships.find(m => m.shop_id === shopId) ?? p.suspendedMemberships.find(m => m.shop_id === shopId))!.role
  const team = people.filter(p => inShop(p) && (isOwner || roleHere(p) !== 'owner'))
  const nonOwnerCount = team.filter(p => p.accountActive && roleHere(p) !== 'owner').length
  const leads = team.filter(p => p.accountActive && (roleHere(p) === 'manager' || roleHere(p) === 'shop_manager'))
    .sort((a, b) => ROLE_ORDER.indexOf(roleHere(b)) - ROLE_ORDER.indexOf(roleHere(a)))
  const groups = ROLE_ORDER.map(role => ({ role, list: team.filter(p => roleHere(p) === role) })).filter(g => g.list.length)
  const canAssign = manageableRoles(myRole).length > 0
  const sheetPerson = sheetUserId ? people.find(p => p.user_id === sheetUserId) ?? null : null

  // Liens vers les modules existants, filtrés sur cette boutique
  const goTo = (path: string) => {
    if (!isActive) switchShop(shopId)
    setDashboardShopFilter(shopId)
    const href = `/${locale}/${path}`
    startNavigationProgress(href)
    router.push(href)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await withTimeout(fetch(`/api/shops/${shopId}`, { method: 'DELETE' }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      toast({ title: t('shops.deleted'), variant: 'success' })
      if (isActive) {
        const next = userShops.find(s => s.id !== shopId)
        if (next) { switchShop(next.id); setDashboardShopFilter(next.id) }
      }
      await refreshShop()
      router.replace(`/${locale}/shops`)
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const kpi = (Icon: typeof Store, label: string, value: React.ReactNode, hint?: React.ReactNode, tone?: string) => (
    <div className="rounded-xl border bg-card p-3.5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className={cn('mt-1 truncate text-lg font-bold tabular-nums', tone)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
  const infoRow = (Icon: typeof Store, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="break-words text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
      </div>
    </div>
  )
  const card = (title: string, children: React.ReactNode, action?: React.ReactNode) => (
    <section className="rounded-xl border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>{action}
      </header>
      <div className="px-4 py-2">{children}</div>
    </section>
  )
  const country = COUNTRIES[shop.country as CountryCode]

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {multi && (
        <Link href={`/${locale}/shops`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="shop-back">
          <ArrowLeft className="h-4 w-4" />{t('shops.all_shops')}
        </Link>
      )}

      {/* En-tête de la fiche */}
      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5" data-testid="shop-header">
        <div className="flex flex-wrap items-start gap-4">
          <ShopLogo src={shop.logo_url} name={shop.name} size="lg" className="rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold">{shop.name}</h1>
              {shop.code && <span className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{shop.code}</span>}
              {isActive && <span className="rounded-full bg-stockshop-blue px-2 py-0.5 text-[10px] font-medium text-white dark:bg-blue-500">{t('shops.active')}</span>}
            </div>
            <p className="text-sm text-muted-foreground">{[shop.city, country ? t(`countries.${shop.country}` as any) : null].filter(Boolean).join(' · ') || '—'}</p>
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              status.tone === 'bad' ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : status.tone === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' : 'bg-muted text-muted-foreground')}>
              {shop.hours_enabled && status.tone !== 'bad' && <Clock className="h-3 w-3" />}{status.text}
            </span>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {!isActive && (
              <Button variant="stockshop" className="h-10 flex-1 gap-2 sm:flex-none" onClick={() => { switchShop(shopId); setDashboardShopFilter(shopId) }} data-testid="shop-switch">
                <ArrowLeftRight className="h-4 w-4" />{t('shops.switch_to')}
              </Button>
            )}
            {isOwner && (
              <Button variant="outline" className="h-10 flex-1 gap-2 sm:flex-none" onClick={() => setEditOpen(true)} data-testid="shop-edit">
                <Pencil className="h-4 w-4" />{t('actions.edit')}
              </Button>
            )}
            {isOwner && !multi && (
              <Button variant="outline" className="h-10 flex-1 gap-2 sm:flex-none" onClick={() => setCreateOpen(true)} data-testid="shop-create">
                <Plus className="h-4 w-4" />{t('shops.new')}
              </Button>
            )}
            {isOwner && ownerShopCount > 1 && (
              <Button variant="outline" className="h-10 w-10 border-red-200 p-0 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20" aria-label={t('actions.delete')} title={t('actions.delete')} onClick={() => setDeleteOpen(true)} data-testid="shop-delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Sous-onglets (phase 2 : Vue d'ensemble, Équipe) */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-lg border bg-muted/30 p-1 sm:w-fit" role="tablist">
        {([['overview', LayoutGrid, t('shops.tab_overview')], ['team', Users, t('shops.tab_team')]] as const).map(([key, Icon, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`shop-tab-${key}`}
            className={cn('flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none', tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Icon className="h-3.5 w-3.5" />{label}{key === 'team' && <span className="text-xs text-muted-foreground">{nonOwnerCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4" data-testid="shop-overview">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpi(Wallet, t('shops.kpi_cash_today'), loaded && st ? fmt(st.cashToday) : '…')}
            {kpi(ShoppingCart, t('shops.kpi_sales_today'), loaded && st ? st.salesTodayCount : '…', loaded && st ? fmt(st.salesToday) : undefined)}
            {kpi(TrendingUp, t('shops.kpi_30d'), loaded && st ? fmt(st.sales30) : '…')}
            {kpi(Users, t('shops.members_label'), nonOwnerCount, leads[0] ? leads.map(p => p.full_name).slice(0, 2).join(', ') : undefined)}
            {kpi(Package, t('shops.kpi_products'), loaded && st ? st.products : '…')}
            {kpi(PackageX, t('shops.kpi_out'), loaded && st ? st.out : '…', undefined, st?.out ? 'text-red-600 dark:text-red-400' : undefined)}
            {kpi(AlertTriangle, t('shops.kpi_low'), loaded && st ? st.low : '…', undefined, st?.low ? 'text-amber-600 dark:text-amber-400' : undefined)}
            {isOwner && kpi(Coins, t('shops.kpi_stock_value'), loaded && st ? fmt(st.stockValue) : '…')}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo('reports')}><BarChart2 className="h-3.5 w-3.5" />{t('shops.see_reports')}</Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo('stock')}><Package className="h-3.5 w-3.5" />{t('shops.see_stock')}</Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo('sales/history')}><History className="h-3.5 w-3.5" />{t('shops.see_sales')}</Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {card(t('shops.sheet_info'), (
              <div className="divide-y" data-testid="shop-info">
                {infoRow(Hash, t('shops.code'), shop.code)}
                {infoRow(MapPin, t('shops.address'), [shop.address, shop.city].filter(Boolean).join(', '))}
                {infoRow(Globe, t('shops.country'), country ? `${country.flag} ${t(`countries.${shop.country}` as any)}` : null)}
                {infoRow(Phone, t('shops.phone'), shop.phone ? <a href={`tel:${shop.phone}`} className="hover:underline">{shop.phone}</a> : null)}
                {infoRow(Mail, t('shops.email'), shop.email ? <a href={`mailto:${shop.email}`} className="hover:underline">{shop.email}</a> : null)}
                {infoRow(Coins, t('shops.currency'), `${currencySymbol(code)} · ${code}`)}
                {infoRow(CalendarDays, t('shops.created_on'), new Date(shop.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }))}
              </div>
            ), isOwner ? <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" />{t('actions.edit')}</Button> : undefined)}

            <div className="space-y-4">
              {card(t('shops.leads_title'), (
                <div className="py-1" data-testid="shop-leads">
                  {peopleLoading && !people.length ? <Skeleton className="my-2 h-10 rounded-lg" /> : leads.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">{t('shops.no_lead')}</p>
                  ) : leads.map(p => (
                    <button key={p.user_id} type="button" onClick={() => setSheetUserId(p.user_id)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-muted/40">
                      <PersonAvatar person={p} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.full_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(' · ') || t(`roles.${roleHere(p)}` as any)}</span>
                      </span>
                      <RoleBadge role={roleHere(p)} size="xs" />
                    </button>
                  ))}
                </div>
              ))}
              {card(t('shops.hours'), (
                <div className="py-2 text-sm" data-testid="shop-hours">
                  {shop.hours_enabled ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{(shop.opening_time || '').slice(0, 5)} – {(shop.closing_time || '').slice(0, 5)}</span>
                      {hours && <span className={hours.open ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>{hours.text}</span>}
                    </div>
                  ) : <p className="text-muted-foreground">{t('shops.hours_disabled')}</p>}
                </div>
              ))}
              {isOwner && card(t('shops.plan'), (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{planLabel(shop.plan)}</span>
                    {sub && <span className={cn('block text-xs', toneClass[sub.tone])}>{sub.text}</span>}
                  </span>
                  <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { startNavigationProgress(`/${locale}/billing`); router.push(`/${locale}/billing`) }}>
                    <CreditCard className="h-3.5 w-3.5" />{t('shops.sub_manage')}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-4" data-testid="shop-team">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('shops.team_count', { count: nonOwnerCount })}</p>
            {canAssign && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="h-10 gap-2" onClick={() => setInviteOpen(true)} data-testid="shop-team-invite"><UserPlus className="h-4 w-4" />{t('team.invite_btn')}</Button>
                <Button variant="stockshop" className="h-10 gap-2" onClick={() => setAssignOpen(true)} data-testid="shop-team-assign"><StoreIcon className="h-4 w-4" />{t('team.assign_member_btn')}</Button>
              </div>
            )}
          </div>
          {peopleLoading && !people.length ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
              <Users className="h-6 w-6 opacity-40" />{t('shops.team_empty')}
            </div>
          ) : groups.map(g => (
            <section key={g.role} className="space-y-2" data-testid="shop-team-group">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`roles.${g.role}` as any)} · {g.list.length}</h3>
              {g.list.map(p => {
                const others = p.memberships.filter(m => m.shop_id !== shopId).length
                return (
                  <button key={p.user_id} type="button" onClick={() => setSheetUserId(p.user_id)} data-testid="shop-team-member"
                    className={cn('flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/40', !p.accountActive && 'opacity-60')}>
                    <PersonAvatar person={p} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{p.full_name}</span>
                        {p.user_id === profile?.id && <span className="rounded border px-1 text-[9px] text-muted-foreground">{t('team.me')}</span>}
                        {!p.accountActive && <span className="rounded-full bg-red-100 px-1.5 text-[9px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400">{t('team.account_deactivated_badge')}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <PresenceText person={p} />
                        {multi && others > 0 && <span className="text-[10px] text-muted-foreground">{t('team.other_shops', { count: others })}</span>}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      )}

      <MemberSheet
        person={sheetPerson}
        onOpenChange={o => { if (!o) setSheetUserId(null) }}
        shops={managedShops}
        roleByShop={roleByShop}
        myUserId={profile?.id}
        people={people}
        onChanged={refreshPeople}
      />
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        shops={managedShops}
        roleByShop={roleByShop}
        people={people}
        fixedShopId={shopId}
        myUserId={profile?.id}
        onDone={refreshPeople}
        onInviteNew={() => setInviteOpen(true)}
      />
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        shops={managedShops}
        fixedShopId={shopId}
        roleByShop={roleByShop}
        onDone={refreshPeople}
      />
      <ShopFormDrawer open={editOpen} onOpenChange={setEditOpen} shop={shop} />
      <ShopFormDrawer open={createOpen} onOpenChange={setCreateOpen} onSaved={s => { startNavigationProgress(`/${locale}/shops/${s.id}`); router.push(`/${locale}/shops/${s.id}`) }} />
      <ConfirmModal
        open={deleteOpen}
        onOpenChange={o => { if (!o && !deleting) setDeleteOpen(false) }}
        category={t('actions.delete')}
        title={t('shops.delete_confirm_title', { name: shop.name })}
        description={t('shops.delete_warning')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('shops.confirm_delete_yes')}
        loading={deleting}
        onConfirm={handleDelete}
        requireText={shop.name}
      />
    </div>
  )
}
