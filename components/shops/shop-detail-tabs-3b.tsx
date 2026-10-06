'use client'

// Onglets Horaires et Paramètres de la fiche boutique (phase 3, lot 3B).
//  - Horaires : MÊME formulaire que Paramètres (ShopHoursEditor), enregistré
//    par /api/shops/settings (propriétaire, journalisé) ; état du jour et
//    prolongation selon la règle du bandeau de fermeture (30 dernières minutes,
//    2 par jour, droit « Prolonger l'heure de fermeture »).
//  - Paramètres : résumé en lecture ; la modification reste dans Paramètres,
//    ouverts sur cette boutique avec une bascule visible.

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Bell, Clock, Receipt, Save, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getMsUntilClosing } from '@/lib/saas/shop-hours'
import { useShopStatus } from '@/lib/shops/shop-insights'
import { cn } from '@/lib/utils/cn'
import { Section } from '@/components/shops/shop-detail-tabs'
import { ShopHoursEditor, hoursValueOf, hoursPayload, hoursRangeInvalid, type ShopHoursValue } from '@/components/shops/shop-hours-editor'
import type { Shop } from '@/lib/types/database'

const EXTEND_MINUTES = [15, 30, 45, 60] as const
const EXTEND_WINDOW_MS = 30 * 60_000

export function ShopHoursTab({ shop, isOwner, canExtend }: { shop: Shop; isOwner: boolean; canExtend: boolean }) {
  const t = useTranslations()
  const locale = useLocale()
  const { toast } = useToast()
  const { patchShop } = useAuthContext()
  const { hoursOf } = useShopStatus()
  const saved = useMemo(() => hoursValueOf(shop), [shop.hours_enabled, shop.opening_time, shop.closing_time, shop.hours_manual_override]) // eslint-disable-line react-hooks/exhaustive-deps
  const [value, setValue] = useState<ShopHoursValue>(saved)
  const [saving, setSaving] = useState(false)
  const [extending, setExtending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setValue(saved) }, [saved])
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i) }, [])

  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  const status = hoursOf(shop)
  const msLeft = getMsUntilClosing(shop.hours_enabled, shop.opening_time, shop.closing_time, shop.hours_manual_override, shop.hours_extension_until)
  const used = shop.hours_extension_count ?? 0
  const remaining = Math.max(0, 2 - used)
  const extensionActive = !!shop.hours_extension_until && new Date(shop.hours_extension_until).getTime() > now
  // Même règle que le bandeau de fermeture : 30 dernières minutes, sans dérogation, 2 par jour
  const canOfferExtend = canExtend && !shop.hours_manual_override && remaining > 0 && msLeft !== null && msLeft <= EXTEND_WINDOW_MS

  const save = async () => {
    if (hoursRangeInvalid(value)) { toast({ title: t('settings.hours_invalid_range'), variant: 'destructive' }); return }
    setSaving(true)
    try {
      const res = await withTimeout<Response>(fetch('/api/shops/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id, ...hoursPayload(value) }),
      }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || t('toast.error'))
      // Le serveur annule la prolongation du jour quand l'horaire change
      patchShop(shop.id, { ...hoursPayload(value), hours_extension_until: null, hours_extension_count: 0 } as any)
      toast({ title: t('shop_detail.hours_saved'), variant: 'success' })
    } catch (e: any) {
      toast({ title: e.message || t('toast.network_error'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const extend = async (minutes: number) => {
    setExtending(true)
    try {
      const res = await withTimeout<Response>(fetch('/api/shops/extend-hours', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shop_id: shop.id, minutes }),
      }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || t('toast.error'))
      patchShop(shop.id, { hours_extension_until: json.hours_extension_until, hours_extension_count: json.hours_extension_count } as any)
      toast({ title: t('shop_hours.extend_success', { minutes }), variant: 'success' })
    } catch (e: any) {
      toast({ title: e.message || t('toast.network_error'), variant: 'destructive' })
    } finally { setExtending(false) }
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="shop-hours-tab">
      <Section title={t('settings.hours_title')} icon={Clock} summary={t('settings.hours_desc')} testId="shop-hours-form"
        action={isOwner ? (
          <Button variant="stockshop" size="sm" className="h-9 gap-1.5" onClick={save} disabled={!dirty || saving || hoursRangeInvalid(value)} data-testid="shop-hours-save">
            <Save className="h-3.5 w-3.5" />{saving ? t('shop_detail.saving') : t('shop_detail.hours_save')}
          </Button>
        ) : undefined}>
        <div className="py-3">
          <ShopHoursEditor value={value} onChange={setValue} disabled={!isOwner || saving} />
          {!isOwner && <p className="mt-3 text-xs text-muted-foreground">{t('shop_detail.hours_owner_only')}</p>}
        </div>
      </Section>

      <Section title={t('shop_detail.hours_today')} icon={Clock} testId="shop-hours-today">
        <div className="space-y-2 py-3 text-sm">
          {!shop.hours_enabled ? <p className="text-muted-foreground">{t('shops.hours_disabled')}</p> : (
            <>
              <p className={cn('font-medium', status?.open ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')} data-testid="shop-hours-status">{status?.text}</p>
              {shop.hours_manual_override && <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.hours_override_warning')}</p>}
              {extensionActive && <p className="text-xs">{t('shop_detail.extension_until', { time: time(shop.hours_extension_until!) })}</p>}
              <p className="text-xs text-muted-foreground">{t('shop_detail.extensions_used', { count: used })}</p>
              {canOfferExtend ? (
                <div className="flex flex-wrap gap-2 pt-1" data-testid="shop-hours-extend">
                  {EXTEND_MINUTES.map(m => (
                    <Button key={m} variant="outline" size="sm" className="h-9" disabled={extending} onClick={() => extend(m)}>+{m} min</Button>
                  ))}
                </div>
              ) : canExtend && remaining > 0 && !shop.hours_manual_override ? (
                <p className="text-xs text-muted-foreground">{t('shop_detail.extend_hint')}</p>
              ) : null}
            </>
          )}
        </div>
      </Section>
    </div>
  )
}

export function ShopSettingsTab({ shop, onOpenSettings }: { shop: Shop; onOpenSettings: () => void }) {
  const t = useTranslations()
  const s = shop as any
  const onOff = (v: boolean | null | undefined) => (
    <span className={cn('text-xs font-medium', v !== false ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>{v !== false ? t('shop_detail.on') : t('shop_detail.off')}</span>
  )
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[60%] whitespace-pre-line break-words text-right">{value ?? <span className="text-muted-foreground">{t('shop_detail.not_set')}</span>}</span>
    </div>
  )
  // Rôles dont l'accès a été personnalisé pour cette boutique ; fonctions coupées pour tous
  const perms = (shop.role_permissions || {}) as Record<string, Record<string, boolean>>
  const customRoles = Object.keys(perms).filter(r => r !== 'general' && perms[r] && Object.keys(perms[r]).length > 0)
  const generalOff = Object.values(perms.general || {}).filter(v => v === false).length

  return (
    <div className="space-y-4" data-testid="shop-settings-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t('shop_detail.settings_intro')}</p>
        <Button variant="stockshop" className="h-10 w-full gap-2 sm:w-auto" onClick={onOpenSettings} data-testid="shop-open-settings">
          <Settings2 className="h-4 w-4" />{t('shop_detail.open_settings')}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('settings.receipt_section')} icon={Receipt} testId="shop-settings-receipts">
          <div className="divide-y">
            {row(t('settings.receipt_tagline'), s.receipt_tagline)}
            {row(t('settings.receipt_legal_ids'), s.receipt_legal_ids)}
            {row(t('settings.receipt_footer'), s.receipt_footer)}
          </div>
        </Section>
        <Section title={t('shop_detail.settings_thresholds')} icon={SlidersHorizontal}>
          <div className="divide-y">
            {row(t('settings.low_stock_threshold'), s.low_stock_threshold ?? null)}
            {row(t('settings.expiry_alert_days'), s.expiry_alert_days != null ? t('shop_detail.days', { count: s.expiry_alert_days }) : null)}
            {row(t('settings.default_credit_term_days'), s.default_credit_term_days != null ? t('shop_detail.days', { count: s.default_credit_term_days }) : null)}
            {row(t('settings.tax_rate'), s.tax_rate != null ? `${s.tax_rate} %` : null)}
          </div>
        </Section>
        <Section title={t('settings.notifications')} icon={Bell}>
          <div className="divide-y">
            {row(`${t('settings.email_section_label')} · ${t('settings.alert_low_stock')}`, onOff(s.notify_email_low_stock))}
            {row(`${t('settings.email_section_label')} · ${t('settings.alert_daily')}`, onOff(s.notify_email_daily))}
            {row(`${t('settings.email_section_label')} · ${t('settings.alert_expiry')}`, onOff(s.notify_email_expiry))}
            {row(t('settings.push_new_sale_label'), onOff(s.notify_push_new_sale))}
            {row(t('settings.push_new_expense_label'), onOff(s.notify_push_new_expense))}
          </div>
        </Section>
        <Section title={t('settings.role_permissions')} icon={ShieldCheck}>
          <div className="py-2 text-sm" data-testid="shop-settings-roles">
            {customRoles.length === 0 && generalOff === 0 ? <p className="text-muted-foreground">{t('shop_detail.roles_default')}</p> : (
              <>
                {customRoles.length > 0 && <p>{t('shop_detail.roles_custom', { roles: customRoles.map(r => t(`roles.${r}` as any)).join(', ') })}</p>}
                {generalOff > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('shop_detail.roles_general_off', { count: generalOff })}</p>}
              </>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
