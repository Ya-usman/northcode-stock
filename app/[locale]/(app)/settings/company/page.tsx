'use client'

// Paramètres → ENTREPRISE (migration 153, 5 oct. 2026). L'entreprise est le
// client de StockShop : nom, coordonnées, propriétaire (une personne),
// facturation et abonnement. Le propriétaire modifie ; la gestion d'équipe
// (Manager, Responsable) consulte, sans la facturation. Les reçus et tickets
// gardent le nom de chaque boutique.

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowLeft, Building2, Save, UserRound, Receipt, CreditCard, CheckCircle2, AlertTriangle, Store, Users } from 'lucide-react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { RequiredMark } from '@/components/ui/input-group'
import { useToast } from '@/components/ui/use-toast'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { useShopStatus } from '@/lib/shops/shop-insights'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import { cn } from '@/lib/utils/cn'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { Shop } from '@/lib/types/database'

const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => ({ default: m.PhoneInput })), {
  ssr: false,
  loading: () => <div className="h-10 w-full animate-pulse rounded-md border border-input bg-muted/40" />,
})

type Field = 'name' | 'address' | 'city' | 'phone' | 'email' | 'billing_contact_name' | 'billing_email' | 'billing_phone' | 'billing_address' | 'billing_city' | 'tax_id'
const FIELDS: Field[] = ['name', 'address', 'city', 'phone', 'email', 'billing_contact_name', 'billing_email', 'billing_phone', 'billing_address', 'billing_city', 'tax_id']

interface EntityView {
  id: string; name: string; name_confirmed: boolean; country: string | null
  address: string | null; city: string | null; phone: string | null; email: string | null
  establishment_count: number; owner_name: string | null
  billing_contact_name?: string | null; billing_email?: string | null; billing_phone?: string | null
  billing_address?: string | null; billing_city?: string | null; billing_country?: string | null; tax_id?: string | null
  plan?: string; plan_expires_at?: string | null; trial_ends_at?: string | null
  /** Limites effectives (formule + gestes commerciaux) ; *_offered = part offerte */
  quota?: { shops_used: number; shops_limit: number; shops_offered?: number; members_used: number; members_limit: number; members_offered?: number }
}

export default function CompanySettingsPage() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const { shop, userShops } = useAuthContext()
  const { planLabel, subscriptionOf, toneClass } = useShopStatus()

  const [entity, setEntity] = useState<EntityView | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [values, setValues] = useState<Record<Field, string>>({} as any)
  const [initial, setInitial] = useState<Record<Field, string>>({} as any)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!shop?.id) return
    try {
      const res = await withTimeout(fetch(`/api/entity?shop_id=${shop.id}`), 20_000)
      if (res.status === 403) { setForbidden(true); return }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEntity(json.entity); setCanEdit(!!json.can_edit)
      const v = Object.fromEntries(FIELDS.map(f => [f, json.entity[f] ?? ''])) as Record<Field, string>
      setValues(v); setInitial(v)
    } catch (err: any) {
      toast({ title: err?.message || t('toast.retry_error'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [shop?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = FIELDS.some(f => (values[f] ?? '') !== (initial[f] ?? ''))
  const set = (f: Field) => (v: string) => { setValues(x => ({ ...x, [f]: v })); if (errors[f]) setErrors(e => ({ ...e, [f]: undefined })) }

  const save = async (opts?: { confirmOnly?: boolean }) => {
    if (!shop?.id || !entity) return
    if (!values.name?.trim()) { setErrors({ name: t('api_errors.entity_name_required') }); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = opts?.confirmOnly
        ? { confirm_name: true }
        : Object.fromEntries(FIELDS.filter(f => (values[f] ?? '') !== (initial[f] ?? '')).map(f => [f, values[f]]))
      if (!opts?.confirmOnly && !entity.name_confirmed) body.name = values.name
      const res = await withTimeout(fetch(`/api/entity?shop_id=${shop.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.field) setErrors({ [json.field]: json.error })
        else toast({ title: json.error || t('toast.retry_error'), variant: 'destructive' })
        return
      }
      toast({ title: opts?.confirmOnly ? t('entity.confirmed_toast') : t('entity.saved'), variant: 'success' })
      await load()
    } finally {
      setSaving(false)
    }
  }

  const country = entity?.country ? COUNTRIES[entity.country as CountryCode] : null
  const billingCountry = entity?.billing_country ? COUNTRIES[entity.billing_country as CountryCode] : null
  const sub = entity?.plan ? subscriptionOf({ plan: entity.plan, plan_expires_at: entity.plan_expires_at, trial_ends_at: entity.trial_ends_at } as Shop) : null
  const preferred = useMemo(() => userShops.map(s => s.country), [userShops])

  const field = (f: Field, label: string, opts?: { required?: boolean; placeholder?: string; type?: string; hint?: string }) => (
    <div className="space-y-1.5">
      <Label htmlFor={`entity-${f}`}>{label}{opts?.required && <RequiredMark />}</Label>
      {f === 'phone' || f === 'billing_phone' ? (
        <PhoneInput id={`entity-${f}`} value={values[f]} defaultCountry={entity?.country} preferredCountries={preferred} disabled={!canEdit}
          invalid={!!errors[f]} onChange={(v) => set(f)(v)} />
      ) : (
        <Input id={`entity-${f}`} type={opts?.type} value={values[f] ?? ''} disabled={!canEdit} placeholder={opts?.placeholder}
          aria-invalid={!!errors[f]} onChange={e => set(f)(e.target.value)} />
      )}
      {errors[f] ? <p className="text-xs text-destructive">{errors[f]}</p> : opts?.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
    </div>
  )
  const section = (Icon: typeof Building2, title: string, children: React.ReactNode, hint?: string, testId?: string) => (
    <section className="rounded-xl border bg-card shadow-sm" data-testid={testId}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="space-y-4 p-4">
        {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </section>
  )

  if (loading) return <div className="mx-auto max-w-3xl space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
  if (forbidden || !entity) {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('entity.not_available')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24" data-testid="company-page">
      <Link href={`/${locale}/settings`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />{t('settings.title')}
      </Link>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400"><Building2 className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('entity.label')}</p>
          <h1 className="truncate text-xl font-bold" data-testid="company-name">{entity.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('entity.establishments_count', { count: entity.establishment_count })}
            {entity.owner_name && <> · {t('roles.owner')} : {entity.owner_name}</>}
          </p>
        </div>
        {!entity.name_confirmed && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t('entity.name_to_confirm')}</span>}
      </div>

      {!entity.name_confirmed && canEdit && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/30" data-testid="company-confirm">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{t('entity.confirm_title')}</p>
            <p className="text-sm text-amber-800 dark:text-amber-300">{t('entity.confirm_body', { name: entity.name })}</p>
          </div>
          <Button variant="stockshop" className="gap-2" loading={saving} disabled={dirty} onClick={() => save({ confirmOnly: true })} data-testid="company-confirm-name">
            <CheckCircle2 className="h-4 w-4" />{t('entity.confirm_action')}
          </Button>
        </div>
      )}

      {!canEdit && <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{t('entity.read_only')}</p>}

      {section(Building2, t('entity.general'), (
        <>
          {field('name', t('entity.name'), { required: true, hint: t('entity.name_hint') })}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('shops.country')}</Label>
              <p className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{country ? `${country.flag} ${t(`countries.${entity.country}` as any)}` : '—'}</p>
            </div>
            {field('city', t('shops.city'))}
          </div>
          {field('address', t('shops.address'), { placeholder: t('shops.address_placeholder') })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('phone', t('entity.phone'))}
            {field('email', t('entity.email'), { type: 'email', placeholder: 'contact@entreprise.com' })}
          </div>
        </>
      ), undefined, 'company-general')}

      {section(UserRound, t('roles.owner'), (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stockshop-blue text-sm font-bold text-white dark:bg-blue-500">
            {(entity.owner_name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium" data-testid="company-owner">{entity.owner_name || '—'}</p>
            <p className="text-xs text-muted-foreground">{t('entity.owner_hint')}</p>
          </div>
        </div>
      ), undefined, 'company-owner-section')}

      {canEdit && section(Receipt, t('entity.billing'), (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('billing_contact_name', t('entity.billing_contact'))}
            {field('billing_email', t('entity.billing_email'), { type: 'email' })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('billing_phone', t('entity.billing_phone'))}
            {field('tax_id', t('entity.tax_id'), { placeholder: t('entity.tax_id_placeholder') })}
          </div>
          {field('billing_address', t('entity.billing_address'))}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('billing_city', t('shops.city'))}
            <div className="space-y-1.5">
              <Label>{t('entity.billing_country')}</Label>
              <p className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{billingCountry ? `${billingCountry.flag} ${t(`countries.${entity.billing_country}` as any)}` : '—'}</p>
              <p className="text-xs text-muted-foreground">{t('entity.billing_country_locked')}</p>
            </div>
          </div>
        </>
      ), t('entity.billing_hint'), 'company-billing')}

      {canEdit && entity.quota && section(CreditCard, t('entity.subscription'), (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold" data-testid="company-plan">{planLabel(entity.plan)}</p>
              {sub && <p className={cn('text-xs', toneClass[sub.tone])}>{sub.text}</p>}
            </div>
            <Button variant="outline" className="gap-2" onClick={() => { startNavigationProgress(`/${locale}/billing`); router.push(`/${locale}/billing`) }}>
              <CreditCard className="h-4 w-4" />{t('shops.sub_manage')}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="company-quota">
            {([[Store, t('entity.usage_establishments'), entity.quota.shops_used, entity.quota.shops_limit, entity.quota.shops_offered ?? 0], [Users, t('entity.usage_members'), entity.quota.members_used, entity.quota.members_limit, entity.quota.members_offered ?? 0]] as const).map(([Icon, label, used, limit, offered]) => (
              <div key={label} className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
                <p className={cn('mt-1 text-lg font-bold tabular-nums', limit !== -1 && used >= limit && 'text-amber-600 dark:text-amber-400')}>
                  {limit === -1 ? used : `${used} / ${limit}`}
                  {limit !== -1 && offered > 0 && <span className="ml-1.5 text-xs font-medium text-muted-foreground" data-testid="company-quota-offered">({t('plan_usage.offered', { count: offered })})</span>}
                </p>
                {limit !== -1 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', used >= limit ? 'bg-amber-500' : 'bg-stockshop-blue dark:bg-blue-500')} style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('entity.quota_hint')}</p>
        </>
      ), undefined, 'company-subscription')}

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <div className="mx-auto flex max-w-3xl justify-end">
            <Button variant="stockshop" className="h-11 w-full gap-2 md:w-auto" loading={saving} disabled={!dirty} onClick={() => save()} data-testid="company-save">
              <Save className="h-4 w-4" />{t('actions.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
