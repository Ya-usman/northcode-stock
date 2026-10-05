'use client'

// « Nouvelle boutique » / « Modifier la boutique » — panneau UNIQUE (décision
// du 5 oct. 2026 : ajout et modification en panneau). Champs : nom, code,
// ville, adresse, pays (création seulement — la devise en dépend et se règle
// dans Paramètres), téléphone, e-mail. Même validation que le serveur
// (lib/saas/shop-identity.ts), erreurs sous les champs, garde de fermeture.

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Store, Plus, Save } from 'lucide-react'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { RequiredMark } from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CountrySelect } from '@/components/ui/country-select'
import { useToast } from '@/components/ui/use-toast'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { currencySymbol, currencyCodeForCountry } from '@/lib/saas/currencies'
import { validateShopIdentity } from '@/lib/saas/shop-identity'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { CountryCode } from '@/lib/saas/countries'
import type { Shop } from '@/lib/types/database'

const PhoneInput = dynamic(() => import('@/components/ui/phone-input').then(m => ({ default: m.PhoneInput })), {
  ssr: false,
  loading: () => <div className="h-10 w-full animate-pulse rounded-md border border-input bg-muted/40" />,
})

type Field = 'name' | 'code' | 'city' | 'address' | 'phone' | 'email'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Boutique à modifier ; absente = création */
  shop?: Shop | null
  onSaved?: (shop: Shop) => void
}

export function ShopFormDrawer({ open, onOpenChange, shop, onSaved }: Props) {
  const t = useTranslations()
  const { toast } = useToast()
  const { activeShop, userShops, refreshShop, switchShop, setDashboardShopFilter, patchShop } = useAuthContext()
  const editing = !!shop
  const initial = useMemo(() => ({
    name: shop?.name ?? '',
    code: (shop as any)?.code ?? '',
    city: shop?.city ?? '',
    address: (shop as any)?.address ?? '',
    phone: (shop as any)?.phone ?? '',
    email: (shop as any)?.email ?? '',
    country: (shop?.country || activeShop?.country || 'NG') as CountryCode,
  }), [shop?.id, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [phoneValid, setPhoneValid] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => { if (open) { setValues(initial); setErrors({}); setServerError(null); setPhoneValid(true) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = open && JSON.stringify(values) !== JSON.stringify(initial)
  const set = (k: keyof typeof values) => (v: string) => { setValues(x => ({ ...x, [k]: v })); if (errors[k as Field]) setErrors(e => ({ ...e, [k]: undefined })) }

  const submit = async () => {
    const e: Partial<Record<Field, string>> = {}
    if (!values.name.trim()) e.name = t('api_errors.name_required')
    const identity = validateShopIdentity({ code: values.code, address: values.address, phone: values.phone, email: values.email })
    for (const [f, key] of Object.entries(identity.errors)) e[f as Field] = t(`api_errors.${key}` as any)
    if (values.phone && !phoneValid) e.phone = t('api_errors.shop_phone_invalid')
    setErrors(e)
    if (Object.values(e).some(Boolean)) return

    setSaving(true); setServerError(null)
    try {
      const body = {
        name: values.name.trim(), city: values.city.trim(),
        code: values.code, address: values.address, phone: values.phone, email: values.email,
      }
      const res = await withTimeout(fetch(editing ? '/api/shops/settings' : '/api/shops', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { shop_id: shop!.id, ...body } : { ...body, country: values.country }),
      }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.field && ['code', 'address', 'phone', 'email', 'name'].includes(json.field)) setErrors({ [json.field]: json.error })
        else setServerError(json.error || t('errors.generic'))
        return
      }
      if (editing) {
        const patch = { ...body, ...identity.values } as Partial<Shop>
        patchShop(shop!.id, patch)
        toast({ title: t('shops.updated'), variant: 'success' })
        onSaved?.({ ...shop!, ...patch })
      } else {
        await refreshShop()
        switchShop(json.shop.id)
        setDashboardShopFilter(json.shop.id)
        toast({ title: t('shops.created'), variant: 'success' })
        onSaved?.(json.shop)
      }
      onOpenChange(false)
    } catch (err: any) {
      setServerError(err?.message || t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (f: Field) => errors[f] && <p className="text-xs text-destructive">{errors[f]}</p>

  return (
    <FormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t('shops.edit_title') : t('shops.new_form_title')}
      description={editing ? shop!.name : undefined}
      icon={<Store className="h-4 w-4" />}
      width="md"
      dirty={dirty}
      onSubmit={submit}
      submitting={saving}
      submitLabel={editing ? t('actions.save') : t('shops.create')}
      submitIcon={editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      submitDisabled={!values.name.trim()}
      error={serverError}
      testId="shop-form"
    >
      <div className="space-y-4">
        <DrawerSection title={t('shops.sheet_info')}>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="shop-name">{t('shops.name')}<RequiredMark /></Label>
              <Input id="shop-name" value={values.name} onChange={e => set('name')(e.target.value)} placeholder={t('shops.name_placeholder')} aria-invalid={!!errors.name} />
              {fieldError('name')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop-code">{t('shops.code')}</Label>
              <Input id="shop-code" value={values.code} onChange={e => set('code')(e.target.value.toUpperCase())} placeholder={t('shops.code_placeholder')} maxLength={20} aria-invalid={!!errors.code} />
              {fieldError('code')}
            </div>
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>{t('shops.country')}</Label>
              <CountrySelect value={values.country} onChange={c => setValues(x => ({ ...x, country: c as CountryCode }))} className="h-10" />
              <p className="text-[11px] text-muted-foreground">{t('shops.currency')} : {currencySymbol(currencyCodeForCountry(values.country))}</p>
            </div>
          )}
        </DrawerSection>
        <DrawerSection title={t('shops.section_address')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="shop-city">{t('shops.city')}</Label>
              <Input id="shop-city" value={values.city} onChange={e => set('city')(e.target.value)} placeholder={t('shops.city_placeholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop-address">{t('shops.address')}</Label>
              <Input id="shop-address" value={values.address} onChange={e => set('address')(e.target.value)} placeholder={t('shops.address_placeholder')} maxLength={200} aria-invalid={!!errors.address} />
              {fieldError('address')}
            </div>
          </div>
        </DrawerSection>
        <DrawerSection title={t('shops.section_contact')}>
          <div className="space-y-1.5">
            <Label htmlFor="shop-phone">{t('shops.phone')}</Label>
            <PhoneInput id="shop-phone" value={values.phone} defaultCountry={editing ? shop!.country : values.country}
              preferredCountries={userShops.map(s => s.country)} invalid={!!errors.phone}
              onChange={(v, valid) => { set('phone')(v); setPhoneValid(valid) }} />
            {fieldError('phone')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shop-email">{t('shops.email')}</Label>
            <Input id="shop-email" type="email" value={values.email} onChange={e => set('email')(e.target.value)} placeholder="contact@boutique.com" aria-invalid={!!errors.email} />
            {fieldError('email')}
          </div>
        </DrawerSection>
      </div>
    </FormDrawer>
  )
}
