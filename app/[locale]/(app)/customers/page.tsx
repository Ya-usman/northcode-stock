'use client'

import { useState, useEffect, useMemo } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { normalize } from '@/lib/utils/normalize'
import { useTranslations } from 'next-intl'
import { Search, Plus, Edit2, Trash2, Phone, MapPin, Store, User, Merge, AlertTriangle, Save } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter, FOOTER_PRIMARY_CLASS } from '@/components/ui/premium-dialog'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { InputGroup, RequiredMark } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrency } from '@/lib/hooks/use-currency'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createCustomerSchema, type CustomerFormData } from '@/lib/validations/customer'
import type { Customer } from '@/lib/types/database'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { useShopLoadTimeout } from '@/lib/hooks/use-shop-load-timeout'
import { LoadErrorFallback } from '@/components/ui/load-error-fallback'
import { withTimeout } from '@/lib/utils/with-timeout'
import { phoneDigits, phoneMatches } from '@/lib/phone/compare'
import dynamic from 'next/dynamic'

// Champ téléphone international : métadonnées de numérotation chargées à l'usage
const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => ({ default: m.PhoneInput })), {
  ssr: false,
  loading: () => <div className="h-10 w-full animate-pulse rounded-md border border-input bg-muted/40" />,
})

function CustomerCard({ customer, profile, formatNaira, setEditingCustomer, form, setShowModal, deleteCustomer, t }: any) {
  return (
    <div className="rounded-lg border bg-card shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{customer.name}</p>
            {customer.total_debt > 0 && (
              <Badge
                variant={customer.credit_limit != null && customer.total_debt > customer.credit_limit ? 'destructive' : 'danger'}
                className="text-[10px]"
              >
                {t('customers.total_debt')}: {formatNaira(customer.total_debt)}
                {customer.credit_limit != null && ` / ${formatNaira(customer.credit_limit)}`}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {customer.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />{customer.phone}
              </span>
            )}
            {customer.city && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{customer.city}
              </span>
            )}
          </div>
        </div>
        {profile?.role === 'owner' && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
              onClick={() => { setEditingCustomer(customer); form.reset({ name: customer.name, phone: customer.phone || '', city: customer.city || '', credit_limit: customer.credit_limit != null ? String(customer.credit_limit) : '' }); setShowModal(true) }}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => deleteCustomer(customer)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CustomersPage() {
  const t = useTranslations()
  const { profile, shop, effectiveShopIds, userShops } = useAuth()
  const isMultiShop = effectiveShopIds.length > 1
  const { fmt: formatNaira, symbol: currencySymbol } = useCurrency()
  const { isOnline } = useOffline()
  const supabase = createClient() as any
  const { toast } = useToast()

  const [customers, setCustomers] = useState<Customer[]>(() =>
    getPageCache<Customer[]>(`customers_${effectiveShopIds.join(',')}`) || []
  )
  const [loading, setLoading] = useState(() =>
    !getPageCache(`customers_${effectiveShopIds.join(',')}`)
  )
  const [{ search }, setFilter] = usePersistedFilters('customers', shop?.id, { search: '' })
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  // Suppression : confirmation commune (ConfirmModal) au lieu du confirm() natif
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Messages de validation traduits (le schéma par défaut est en anglais)
  const customerSchema = useMemo(() => createCustomerSchema({
    name_required: t('errors.customer_name_required'),
    phone_invalid: t('errors.phone_invalid'),
    credit_limit_invalid: t('errors.credit_limit_invalid'),
  }), [t])
  const form = useForm<CustomerFormData>({ resolver: zodResolver(customerSchema) })
  // Validité du numéro pour le pays choisi (remontée par PhoneInput)
  const [phoneValid, setPhoneValid] = useState(true)
  // Pays des boutiques de l'utilisateur, épinglés en tête de la liste des indicatifs
  const shopCountries = useMemo(() => userShops.map(s => s.country), [userShops])
  useEffect(() => { if (showModal) setPhoneValid(true) }, [showModal])

  const fetchCustomers = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `customers_${effectiveShopIds.join(',')}`
    const cached = getPageCache<Customer[]>(cacheKey)
    if (cached) { setCustomers(cached); setLoading(false) }
    try {
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const { data, error } = await withTimeout<any>(
        supabase.from('customers').select('*').in('shop_id', effectiveShopIds).order('name'),
        20_000, 'Chargement des clients trop lent — réessayez.'
      )
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — check explicitly so the catch below preserves the cache
      // already on screen instead of zeroing it out.
      if (error) throw error
      setCustomers((data || []) as Customer[])
      setPageCache(cacheKey, data || [])
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCustomers() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches customers/debts
  // added or edited by other team members while this page sat in the background.
  useRefetchOnVisible(fetchCustomers)
  useRefetchOnReconnect(fetchCustomers, isOnline)
  const shopLoadTimedOut = useShopLoadTimeout(effectiveShopIds.length)

  const filtered = customers.filter(c => {
    if (c.deleted_at) return false // fiches supprimées ou fusionnées : conservées en base, jamais listées
    if (!search) return true
    const q = normalize(search)
    return normalize(c.name).includes(q) || phoneMatches(c.phone, search) || normalize(c.city ?? '').includes(q)
  })

  // ── Doublons : même nom (accents et majuscules ignorés) ou même numéro, par
  // boutique. Détection seulement : la fusion est une décision du commerçant.
  const canMerge = ['owner', 'manager', 'shop_manager', 'super_admin'].includes(profile?.role || '')
  const duplicateGroups = useMemo(() => {
    const byKey = new Map<string, Customer[]>()
    const add = (key: string, c: Customer) => { const list = byKey.get(key) || []; if (!list.includes(c)) list.push(c); byKey.set(key, list) }
    for (const c of customers) {
      if (c.deleted_at) continue
      const name = normalize(c.name)
      if (name) add(`${c.shop_id}|n|${name}`, c)
      // Même numéro sous deux formes (« 0753… » et « +33 753… ») : comparaison
      // sur les 9 derniers chiffres, indicatif et zéro initial ignorés
      const digits = phoneDigits(c.phone)
      if (digits.length >= 6) add(`${c.shop_id}|p|${digits.slice(-9)}`, c)
    }
    const seen = new Set<string>()
    const groups: Customer[][] = []
    for (const list of Array.from(byKey.values())) {
      if (list.length < 2 || list.every(c => seen.has(c.id))) continue
      list.forEach(c => seen.add(c.id))
      groups.push([...list].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    }
    return groups
  }, [customers])
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [mergeGroup, setMergeGroup] = useState<Customer[] | null>(null)
  const [keepId, setKeepId] = useState('')
  const [salesCounts, setSalesCounts] = useState<Record<string, number>>({})
  const [merging, setMerging] = useState(false)

  const openMerge = async (group: Customer[]) => {
    // Fiche proposée : celle qui a un téléphone, sinon la plus ancienne
    const preferred = group.find(c => c.phone) || group[0]
    setKeepId(preferred.id); setMergeGroup(group); setSalesCounts({})
    try {
      const { data } = await withTimeout<any>(supabase.from('sales').select('customer_id').in('customer_id', group.map(c => c.id)))
      const counts: Record<string, number> = {}
      for (const r of (data || []) as { customer_id: string }[]) counts[r.customer_id] = (counts[r.customer_id] || 0) + 1
      group.forEach(c => { counts[c.id] = counts[c.id] || 0 })
      setSalesCounts(counts)
    } catch { /* récapitulatif sans le nombre de ventes */ }
  }

  const runMerge = async () => {
    if (!mergeGroup || !keepId) return
    const keep = mergeGroup.find(c => c.id === keepId)
    if (!keep) return
    setMerging(true)
    try {
      for (const dup of mergeGroup.filter(c => c.id !== keepId)) {
        const res = await withTimeout(fetch('/api/customers/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop_id: keep.shop_id, keep_id: keep.id, merge_id: dup.id }),
        }))
        const json = await res.json()
        if (!res.ok) { toast({ title: json.error || t('toast.error'), variant: 'destructive' }); return }
      }
      toast({ title: t('customers.merge_done', { name: keep.name }), variant: 'success' })
      setMergeGroup(null)
      fetchCustomers()
    } catch (err: any) {
      toast({ title: err.message || t('toast.network_error'), variant: 'destructive' })
    } finally {
      setMerging(false)
    }
  }

  const onSubmit = async (data: CustomerFormData) => {
    setSaving(true)
    supabase.auth.getSession().catch(() => {})
    try {
      const payload = { ...data, credit_limit: data.credit_limit ? Number(data.credit_limit) : null }
      if (editingCustomer) {
        const { error } = await withTimeout<any>(supabase.from('customers').update(payload).eq('id', editingCustomer.id))
        if (error) { toast({ title: error.message, variant: 'destructive' }); return }
        toast({ title: t('toast.customer_updated'), variant: 'success' })
      } else {
        const { error } = await withTimeout<any>(supabase.from('customers').insert({ ...payload, shop_id: shop!.id }))
        if (error) { toast({ title: error.message, variant: 'destructive' }); return }
        toast({ title: t('toast.customer_added'), variant: 'success' })
      }
      setShowModal(false)
      setEditingCustomer(null)
      form.reset({ name: '', phone: '', city: '', credit_limit: '' })
      fetchCustomers()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
      setTimeout(() => fetchCustomers(), 3_000)
    } finally {
      setSaving(false)
    }
  }

  const deleteCustomer = (c: Customer) => {
    if (c.total_debt > 0) {
      toast({ title: t('toast.customer_has_debt', { name: c.name, amount: formatNaira(c.total_debt) }), variant: 'destructive' })
      return
    }
    setDeleteTarget(c)
  }

  const confirmDeleteCustomer = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      // Soft delete — preserves all sales and payment history
      const { error } = await withTimeout<any>(supabase.from('customers').update({ deleted_at: new Date().toISOString() } as any).eq('id', deleteTarget.id))
      if (error) { toast({ title: error.message, variant: 'destructive' }); return }
      toast({ title: t('toast.customer_deleted') })
      setDeleteTarget(null)
      fetchCustomers()
    } catch (err: any) {
      toast({ title: err.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const closeCustomerForm = () => {
    setShowModal(false)
    setEditingCustomer(null)
    form.reset({ name: '', phone: '', city: '', credit_limit: '' })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setFilter({ search: e.target.value })} placeholder={t('actions.search')} className="pl-9 h-9" />
        </div>
        {(profile?.role === 'owner' || profile?.role === 'cashier') && (
          <Button
            variant="stockshop"
            className="h-9 gap-1"
            size="sm"
            onClick={() => { form.reset({ name: '', phone: '', city: '', credit_limit: '' }); setEditingCustomer(null); setShowModal(true) }}
          >
            <Plus className="h-4 w-4" />
            {t('customers.add_customer')}
          </Button>
        )}
      </div>

      {canMerge && !loading && duplicateGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/60 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {t(duplicateGroups.length === 1 ? 'customers.duplicates_banner_one' : 'customers.duplicates_banner_other', { count: duplicateGroups.length })}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('customers.duplicates_hint')}</p>
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowDuplicates(v => !v)}>
            {t(showDuplicates ? 'customers.duplicates_hide' : 'customers.duplicates_show')}
          </Button>
        </div>
      )}

      {loading && shopLoadTimedOut && effectiveShopIds.length === 0 ? (
        <LoadErrorFallback />
      ) : loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : showDuplicates && canMerge && duplicateGroups.length > 0 ? (
        <div className="space-y-4">
          {duplicateGroups.map((group, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800/60 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{group[0].name} <span className="font-normal text-muted-foreground">× {group.length}</span></p>
                <Button size="sm" variant="stockshop" className="h-8 gap-1.5" disabled={!isOnline} title={!isOnline ? t('customers.merge_offline') : undefined} onClick={() => openMerge(group)}>
                  <Merge className="h-3.5 w-3.5" /> {t('customers.merge')}
                </Button>
              </div>
              {group.map(customer => <CustomerCard key={customer.id} customer={customer} profile={profile} formatNaira={formatNaira} setEditingCustomer={setEditingCustomer} form={form} setShowModal={setShowModal} deleteCustomer={deleteCustomer} t={t} />)}
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
          {t('customers.no_customers')}
        </div>
      ) : isMultiShop ? (
        <div className="space-y-4">
          {userShops.filter(s => effectiveShopIds.includes(s.id)).map(shopEntry => {
            const shopCustomers = filtered.filter(c => c.shop_id === shopEntry.id)
            if (!shopCustomers.length) return null
            return (
              <div key={shopEntry.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <Store className="h-3.5 w-3.5 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-stockshop-blue dark:text-blue-400 uppercase tracking-wide">{shopEntry.name}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {shopCustomers.map(customer => <CustomerCard key={customer.id} customer={customer} profile={profile} formatNaira={formatNaira} setEditingCustomer={setEditingCustomer} form={form} setShowModal={setShowModal} deleteCustomer={deleteCustomer} t={t} />)}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(customer => <CustomerCard key={customer.id} customer={customer} profile={profile} formatNaira={formatNaira} setEditingCustomer={setEditingCustomer} form={form} setShowModal={setShowModal} deleteCustomer={deleteCustomer} t={t} />)}
        </div>
      )}

      {/* Fiche client (ajout / modification) : formulaire court → modale,
          boutons sous le contenu, garde de fermeture */}
      <PremiumDialog
        open={showModal}
        onOpenChange={open => { if (!open) closeCustomerForm() }}
        title={editingCustomer ? t('customers.edit_customer') : t('customers.add_customer')}
        description={editingCustomer?.name}
        icon={<User className="h-4 w-4" />}
        maxWidth="max-w-lg"
        dirty={form.formState.isDirty}
        testId="customer-dialog"
      >
        <form
          id="customer-form"
          onSubmit={form.handleSubmit(data => {
            if (data.phone && !phoneValid) { form.setError('phone', { message: t('errors.phone_invalid') }); return }
            return onSubmit(data)
          })}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <PremiumDialogBody>
            <div className="space-y-1.5">
              <Label htmlFor="customer-name">{t('customers.name')}<RequiredMark /></Label>
              <Input id="customer-name" {...form.register('name')} placeholder={t('customers.name_placeholder')} aria-invalid={!!form.formState.errors.name} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-[3fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">{t('customers.phone')}</Label>
                <PhoneInput
                  id="customer-phone"
                  value={form.watch('phone')}
                  onChange={(v, valid) => {
                    form.setValue('phone', v, { shouldDirty: true })
                    setPhoneValid(valid)
                    if (form.formState.errors.phone) form.clearErrors('phone')
                  }}
                  defaultCountry={shop?.country}
                  preferredCountries={shopCountries}
                  invalid={!!form.formState.errors.phone}
                />
                {form.formState.errors.phone && <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-city">{t('customers.city')}</Label>
                <Input id="customer-city" {...form.register('city')} placeholder={t('customers.city_placeholder')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-credit-limit">{t('customers.credit_limit')} <span className="text-muted-foreground font-normal">({t('form.optional')})</span></Label>
              <InputGroup suffix={currencySymbol}>
                <Input id="customer-credit-limit" {...form.register('credit_limit')} type="number" min="0" placeholder={t('customers.credit_limit_placeholder')} aria-invalid={!!form.formState.errors.credit_limit} />
              </InputGroup>
              {form.formState.errors.credit_limit && <p className="text-xs text-destructive">{form.formState.errors.credit_limit.message}</p>}
            </div>
          </PremiumDialogBody>
          <PremiumDialogFooter onCancel={closeCustomerForm} cancelLabel={t('actions.cancel')}>
            <Button type="submit" variant="stockshop" className={FOOTER_PRIMARY_CLASS} loading={saving} data-testid="dialog-submit">
              {!saving && <Save className="h-4 w-4" />}
              {editingCustomer ? t('actions.update') : t('actions.save')}
            </Button>
          </PremiumDialogFooter>
        </form>
      </PremiumDialog>

      {/* Suppression (douce) : confirmation commune, bouton rouge */}
      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null) }}
        category={t('actions.delete')}
        title={deleteTarget?.name || ''}
        description={t('customers.delete_hint')}
        icon={<Trash2 className="h-4 w-4" />}
        tone="danger"
        confirmLabel={t('actions.delete')}
        loading={deleting}
        onConfirm={confirmDeleteCustomer}
      />

      {/* Fusion de doublons : choix de la fiche gardée, récapitulatif, puis serveur (transaction + journal) */}
      <ConfirmModal
        open={!!mergeGroup}
        onOpenChange={open => { if (!open && !merging) setMergeGroup(null) }}
        title={t('customers.merge_title')}
        icon={<Merge className="h-4 w-4" />}
        maxWidth="max-w-md"
        confirmLabel={t('customers.merge_confirm')}
        loading={merging}
        disabled={!isOnline || !mergeGroup || mergeGroup.filter(c => c.id !== (mergeGroup.find(x => x.id === keepId) || mergeGroup[0]).id).length === 0}
        onConfirm={runMerge}
      >
        {mergeGroup && (() => {
          const keep = mergeGroup.find(c => c.id === keepId) || mergeGroup[0]
          const others = mergeGroup.filter(c => c.id !== keep.id)
          const sales = others.reduce((s, c) => s + (salesCounts[c.id] || 0), 0)
          const debt = others.reduce((s, c) => s + Number(c.total_debt || 0), 0)
          return (
            <>
                <p className="text-sm font-medium">{t('customers.merge_keep')}</p>
                <div className="space-y-2">
                  {mergeGroup.map(c => (
                    <label key={c.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors', c.id === keep.id ? 'border-stockshop-blue bg-stockshop-blue-muted dark:border-blue-700 dark:bg-blue-950/40' : 'border-border hover:bg-muted/50')}>
                      <input type="radio" name="merge-keep" className="mt-1 accent-stockshop-blue" checked={c.id === keep.id} onChange={() => setKeepId(c.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.phone || t('sales.no_phone')}{c.city ? ` · ${c.city}` : ''}
                          {' · '}{t('customers.merge_sales_count', { count: salesCounts[c.id] ?? '…' })}
                          {Number(c.total_debt) > 0 ? ` · ${t('customers.total_debt')}: ${formatNaira(c.total_debt)}` : ''}
                          {' · '}{t('customers.merge_created', { date: new Date(c.created_at).toLocaleDateString() })}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p className="font-medium">{t('customers.merge_summary', { name: keep.name, sales, debt: formatNaira(debt) })}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('customers.merge_note')}</p>
                </div>
            </>
          )
        })()}
      </ConfirmModal>
    </div>
  )
}
