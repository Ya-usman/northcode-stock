'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { DetailDrawer } from '@/components/ui/detail-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { RequiredMark } from '@/components/ui/input-group'
import { CountrySelect } from '@/components/ui/country-select'
import { ShopLogo } from '@/components/shop/shop-logo'
import { Plus, Store, Users, CheckCircle2, Trash2, ChevronRight, Settings, ArrowLeftRight, CreditCard, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { resolveCurrencyCode, currencySymbol, currencyCodeForCountry } from '@/lib/saas/currencies'
import { formatCurrency } from '@/lib/utils/currency'
import { isShopOpenNow, getMsUntilClosing } from '@/lib/saas/shop-hours'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { Shop } from '@/lib/types/database'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { startNavigationProgress } from '@/components/layout/navigation-progress'

const supabase = createClient()

// Repères d'une boutique : ventes du jour et des 30 derniers jours (ventes
// actives), produits actifs, ruptures. Calculés côté client sur des colonnes
// minimales ; aucune migration.
interface ShopStats { today: number; last30: number; products: number; out: number }

const DAY = 86_400_000

export default function ShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const { user, userShops, activeShop, switchShop, setDashboardShopFilter, profile, refreshShop } = useAuthContext()
  const { isOnline } = useOffline()
  const { toast } = useToast()
  const router = useRouter()
  const t = useTranslations()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const defaultCountry = ((activeShop?.country as CountryCode) || 'NG') as CountryCode
  const [newCountry, setNewCountry] = useState<CountryCode>(defaultCountry)
  const [loading, setLoading] = useState(false)
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [stats, setStats] = useState<Record<string, ShopStats>>({})
  const [sheetShopId, setSheetShopId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null)
  const [deleting, setDeleting] = useState(false)

  const shopIdsKey = userShops.map(s => s.id).join(',')

  const fetchMemberCounts = useCallback(() => {
    if (userShops.length === 0) return
    // Bounded so a stale connection/session after the app sat backgrounded a
    // while can never leave a hung request retried forever.
    withTimeout(Promise.all(
      userShops.map(s =>
        supabase.from('shop_members').select('id', { count: 'exact', head: true })
          .eq('shop_id', s.id).eq('is_active', true)
          .then(({ count, error }) => {
            // A transient auth/RLS hiccup can resolve with count: null instead
            // of throwing — throw explicitly so the outer .catch() below
            // preserves the last known badge values instead of zeroing one out.
            if (error) throw error
            return [s.id, count ?? 0] as [string, number]
          })
      )
    ), 20_000).then(entries => setMemberCounts(Object.fromEntries(entries))).catch(() => {
      // member count badges just keep showing their last known values
    })
  }, [userShops])

  const fetchStats = useCallback(async () => {
    const ids = userShops.map(s => s.id)
    if (!ids.length) return
    const since = new Date(Date.now() - 30 * DAY).toISOString()
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    try {
      const [salesRes, prodRes] = await withTimeout(Promise.all([
        (supabase as any).from('sales').select('shop_id, total, created_at').in('shop_id', ids).eq('sale_status', 'active').gte('created_at', since),
        (supabase as any).from('products').select('shop_id, quantity').in('shop_id', ids).eq('is_active', true),
      ]), 20_000)
      if (salesRes.error || prodRes.error) throw salesRes.error || prodRes.error
      const next: Record<string, ShopStats> = {}
      for (const id of ids) next[id] = { today: 0, last30: 0, products: 0, out: 0 }
      for (const s of (salesRes.data || []) as { shop_id: string; total: number; created_at: string }[]) {
        const st = next[s.shop_id]; if (!st) continue
        st.last30 += Number(s.total) || 0
        if (new Date(s.created_at) >= startToday) st.today += Number(s.total) || 0
      }
      for (const p of (prodRes.data || []) as { shop_id: string; quantity: number }[]) {
        const st = next[p.shop_id]; if (!st) continue
        st.products++
        if (Number(p.quantity) <= 0) st.out++
      }
      setStats(next)
    } catch {
      // repères absents : la liste reste utilisable
    }
  }, [shopIdsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchMemberCounts(); fetchStats() }, [fetchMemberCounts, fetchStats])

  // Refresh when the user comes back to this tab or regains connectivity —
  // member counts and sales can change from another device while this tab sits open.
  const refreshAll = useCallback(() => { fetchMemberCounts(); fetchStats() }, [fetchMemberCounts, fetchStats])
  useRefetchOnVisible(refreshAll)
  useRefetchOnReconnect(refreshAll, isOnline)

  const resetCreate = () => { setCreating(false); setNewName(''); setNewCity(''); setNewCountry(defaultCountry) }

  const handleCreate = async () => {
    if (!newName.trim() || !user) return
    setLoading(true)
    try {
      const res = await withTimeout(fetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), city: newCity.trim(), country: newCountry }),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      const shop = json.shop

      await refreshShop()
      switchShop((shop as Shop).id)
      setDashboardShopFilter((shop as Shop).id)
      toast({ title: t('shops.created'), variant: 'success' })
      resetCreate()
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    const target = deleteTarget
    if (!target) return
    setDeleting(true)
    try {
      const res = await withTimeout(fetch(`/api/shops/${target.id}`, { method: 'DELETE' }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      toast({ title: t('shops.deleted'), variant: 'success' })
      setDeleteTarget(null)
      setSheetShopId(null)
      if (activeShop?.id === target.id) {
        const next = userShops.find(s => s.id !== target.id)
        if (next) { switchShop(next.id); setDashboardShopFilter(next.id) }
      }
      await refreshShop()
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'

  const fmtFor = (s: Shop) => (n: number) => formatCurrency(n, resolveCurrencyCode(s.currency, s.country))
  const planLabel = (plan: string | null | undefined) => {
    const p = plan || 'trial'
    return ['trial', 'starter', 'pro', 'business'].includes(p) ? t(`shops.plan_${p}` as any) : p
  }

  // État de l'abonnement : jours restants d'essai ou date de renouvellement ;
  // ambre à moins de 7 jours, rouge une fois dépassé.
  const subscriptionOf = (s: Shop): { text: string; tone: 'ok' | 'warn' | 'bad' } | null => {
    const now = Date.now()
    if ((s.plan || 'trial') === 'trial') {
      if (!s.trial_ends_at) return null
      const days = Math.ceil((new Date(s.trial_ends_at).getTime() - now) / DAY)
      if (days <= 0) return { text: t('shops.sub_trial_ended'), tone: 'bad' }
      return { text: t('shops.sub_trial_left', { count: days }), tone: days <= 7 ? 'warn' : 'ok' }
    }
    if (!s.plan_expires_at) return null
    const end = new Date(s.plan_expires_at)
    const days = Math.ceil((end.getTime() - now) / DAY)
    if (days <= 0) return { text: t('shops.sub_expired', { plan: planLabel(s.plan) }), tone: 'bad' }
    return { text: t('shops.sub_until', { plan: planLabel(s.plan), date: end.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }), tone: days <= 7 ? 'warn' : 'ok' }
  }

  // Ouverte / fermée maintenant (seulement si les horaires sont activés)
  const hoursOf = (s: Shop): { text: string; open: boolean } | null => {
    if (!s.hours_enabled) return null
    const open = isShopOpenNow(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until)
    if (!open) return { text: t('shops.closed_now'), open: false }
    const ms = getMsUntilClosing(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until)
    if (ms == null) return { text: t('shops.open_now'), open: true }
    const closeAt = new Date(Date.now() + ms)
    return { text: t('shops.open_until', { time: closeAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }), open: true }
  }

  const toneClass = { ok: 'text-muted-foreground', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400' }

  const goTo = (s: Shop, path: string) => {
    if (s.id !== activeShop?.id) { switchShop(s.id); setDashboardShopFilter(s.id) }
    const href = `/${locale}/${path}`
    startNavigationProgress(href)
    router.push(href)
  }

  const sheetShop = useMemo(() => userShops.find(s => s.id === sheetShopId) ?? null, [userShops, sheetShopId])

  // inSheet : grille 2 × 2 (le panneau est trop étroit pour 4 montants complets)
  const kpiTiles = (s: Shop, inSheet = false) => {
    const st = stats[s.id]
    const fmt = fmtFor(s)
    const tiles = [
      { label: t('shops.kpi_today'), value: st ? fmt(st.today) : '—' },
      { label: t('shops.kpi_30d'), value: st ? fmt(st.last30) : '—' },
      { label: t('shops.kpi_products'), value: st ? String(st.products) : '—' },
      { label: t('shops.kpi_out'), value: st ? String(st.out) : '—', tone: st && st.out > 0 ? 'text-red-600 dark:text-red-400' : '' },
    ]
    return (
      <div className={cn('grid grid-cols-2 gap-2', !inSheet && 'sm:grid-cols-4')} data-testid="shop-kpis">
        {tiles.map(k => (
          <div key={k.label} className="rounded-lg border bg-background px-2.5 py-2">
            <p className="truncate text-[10px] text-muted-foreground">{k.label}</p>
            <p className={cn('truncate text-sm font-bold tabular-nums', k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">{t('shops.title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('shops.count', { count: userShops.length })}</p>
          </div>
          {isOwner && (
            <Button variant="stockshop" onClick={() => { setNewCountry(defaultCountry); setCreating(true) }} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('shops.new')}
            </Button>
          )}
        </div>
      </div>

      {/* Nouvelle boutique : formulaire court → modale */}
      <PremiumDialog
        open={creating}
        onOpenChange={open => { if (!open) resetCreate() }}
        title={t('shops.new_form_title')}
        icon={<Store className="h-4 w-4" />}
        maxWidth="max-w-md"
        dirty={!!newName.trim() || !!newCity.trim()}
        testId="shop-create-dialog"
      >
        <PremiumDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="shop-name">{t('shops.name')}<RequiredMark /></Label>
            <Input
              id="shop-name"
              placeholder={t('shops.name_placeholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shop-city">{t('shops.city')}</Label>
            <Input
              id="shop-city"
              placeholder={t('shops.city_placeholder')}
              value={newCity}
              onChange={e => setNewCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('shops.country')}</Label>
            <CountrySelect value={newCountry} onChange={setNewCountry} className="h-10" />
            <p className="text-[11px] text-muted-foreground">{t('shops.currency')} : {currencySymbol(currencyCodeForCountry(newCountry))}</p>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={resetCreate}
          cancelLabel={t('actions.cancel')}
          onConfirm={handleCreate}
          confirmLabel={t('shops.create')}
          confirmLoading={loading}
          confirmDisabled={!newName.trim() || loading}
          confirmIcon={<Plus className="h-4 w-4" />}
        />
      </PremiumDialog>

      {/* Liste des boutiques : un clic ouvre la fiche */}
      <div className="space-y-3">
        {userShops.map(shop => {
          const isActive = shop.id === activeShop?.id
          const sub = subscriptionOf(shop)
          const hours = hoursOf(shop)
          return (
            <button
              type="button"
              key={shop.id}
              onClick={() => setSheetShopId(shop.id)}
              data-testid="shop-card"
              className={cn(
                'w-full space-y-3 rounded-xl border-2 bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'border-stockshop-blue dark:border-blue-500' : 'border-border'
              )}
            >
              <div className="flex items-center gap-3">
                <ShopLogo src={shop.logo_url} name={shop.name} size="md" className="rounded-lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm truncate">{shop.name}</p>
                    {isActive && (
                      <Badge className="bg-stockshop-blue text-white text-[10px] px-1.5 py-0.5 flex items-center gap-1 flex-shrink-0">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {t('shops.active')}
                      </Badge>
                    )}
                    <Badge variant={(shop.plan || 'trial') === 'trial' ? 'warning' : 'success'} className="text-[10px] flex-shrink-0">
                      {planLabel(shop.plan)}
                    </Badge>
                    {hours && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', hours.open ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' : 'bg-muted text-muted-foreground')}>
                        <Clock className="h-2.5 w-2.5" />{hours.text}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                    {shop.country && <span>{COUNTRIES[shop.country as CountryCode]?.flag ?? '🌐'}</span>}
                    {shop.city && <span className="truncate">{shop.city}</span>}
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Users className="h-3 w-3" />
                      {t('shops.members', { count: memberCounts[shop.id] ?? 0 })}
                    </span>
                    {sub && <span className={cn('font-medium', toneClass[sub.tone])} data-testid="shop-subscription">· {sub.text}</span>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              </div>
              {kpiTiles(shop)}
            </button>
          )
        })}
      </div>

      {userShops.length === 0 && (
        <div className="rounded-xl border bg-card p-8 shadow-sm text-center">
          <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-foreground">{t('shops.no_shops')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('shops.no_shops_detail')}</p>
        </div>
      )}

      {/* Fiche d'une boutique */}
      <DetailDrawer
        open={!!sheetShop}
        onOpenChange={open => { if (!open) setSheetShopId(null) }}
        title={sheetShop?.name || ''}
        description={sheetShop ? [sheetShop.city, COUNTRIES[sheetShop.country as CountryCode]?.name].filter(Boolean).join(' · ') || undefined : undefined}
        icon={<Store className="h-4 w-4" />}
        width="md"
        testId="shop-sheet"
        meta={sheetShop ? kpiTiles(sheetShop, true) : undefined}
        actions={sheetShop ? (
          <div className={FOOTER_ROW_CLASS}>
            {isOwner && userShops.length > 1 && (
              <Button
                type="button"
                variant="outline"
                className="h-11 min-w-0 rounded-lg border-red-200 px-3 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
                aria-label={t('actions.delete')}
                onClick={() => setDeleteTarget(sheetShop)}
                data-testid="shop-delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {sheetShop.id !== activeShop?.id ? (
              <Button type="button" variant="stockshop" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-5 font-semibold sm:flex-none" onClick={() => { switchShop(sheetShop.id); setDashboardShopFilter(sheetShop.id); setSheetShopId(null) }} data-testid="shop-switch">
                <ArrowLeftRight className="h-4 w-4" />{t('shops.switch_to')}
              </Button>
            ) : (
              <Button type="button" variant="outline" className="h-11 min-w-0 flex-1 gap-2 rounded-lg px-4 sm:flex-none" onClick={() => goTo(sheetShop, 'settings')}>
                <Settings className="h-4 w-4" />{t('shops.settings')}
              </Button>
            )}
          </div>
        ) : undefined}
      >
        {sheetShop && (() => {
          const sub = subscriptionOf(sheetShop)
          const hours = hoursOf(sheetShop)
          const code = resolveCurrencyCode(sheetShop.currency, sheetShop.country)
          return (
            <div className="space-y-4">
              <DrawerSection title={t('shops.sheet_info')}>
                <div className="flex items-center gap-3">
                  <ShopLogo src={sheetShop.logo_url} name={sheetShop.name} size="lg" className="rounded-xl" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{sheetShop.name}</p>
                    {sheetShop.id === activeShop?.id && <p className="text-xs font-medium text-stockshop-blue dark:text-blue-400">{t('shops.active')}</p>}
                  </div>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('shops.city')}</dt><dd>{sheetShop.city || '—'}</dd>
                  <dt className="text-muted-foreground">{t('shops.country')}</dt><dd>{COUNTRIES[sheetShop.country as CountryCode] ? `${COUNTRIES[sheetShop.country as CountryCode].flag} ${t(`countries.${sheetShop.country}` as any)}` : '—'}</dd>
                  <dt className="text-muted-foreground">{t('shops.currency')}</dt><dd>{currencySymbol(code)} · {code}</dd>
                  <dt className="text-muted-foreground">{t('shops.members_label')}</dt><dd>{memberCounts[sheetShop.id] ?? 0}</dd>
                  <dt className="text-muted-foreground">{t('shops.plan')}</dt>
                  <dd>
                    {planLabel(sheetShop.plan)}
                    {sub && <span className={cn('block text-xs', toneClass[sub.tone])}>{sub.text}</span>}
                  </dd>
                  {hours && (<><dt className="text-muted-foreground">{t('shops.hours')}</dt><dd className={hours.open ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}>{hours.text}</dd></>)}
                  <dt className="text-muted-foreground">{t('shops.created_on')}</dt><dd>{new Date(sheetShop.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo(sheetShop, 'team')}><Users className="h-3.5 w-3.5" />{t('shops.team')}</Button>
                  {sheetShop.id !== activeShop?.id && <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo(sheetShop, 'settings')}><Settings className="h-3.5 w-3.5" />{t('shops.settings')}</Button>}
                  {isOwner && <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => goTo(sheetShop, 'billing')}><CreditCard className="h-3.5 w-3.5" />{t('shops.sub_manage')}</Button>}
                </div>
              </DrawerSection>
            </div>
          )
        })()}
      </DetailDrawer>

      {/* Suppression : action la plus destructrice → saisie du nom exigée */}
      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null) }}
        category={t('actions.delete')}
        title={deleteTarget ? t('shops.delete_confirm_title', { name: deleteTarget.name }) : ''}
        description={t('shops.delete_warning')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('shops.confirm_delete_yes')}
        loading={deleting}
        onConfirm={handleDelete}
        requireText={deleteTarget?.name}
      />
    </div>
  )
}
